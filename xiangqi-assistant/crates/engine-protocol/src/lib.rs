use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Protocol {
    Uci,
    Ucci,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SearchLimit {
    Depth(u32),
    MoveTime(u64),
    Nodes(u64),
    Infinite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineInfo {
    pub depth: Option<u32>,
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    pub nps: Option<u64>,
    pub time_ms: Option<u64>,
    pub multipv: u32,
    pub pv: Vec<String>,
}

impl Default for EngineInfo {
    fn default() -> Self {
        Self {
            depth: None,
            score_cp: None,
            mate: None,
            nps: None,
            time_ms: None,
            multipv: 1,
            pv: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineEvent {
    Ready(Protocol),
    Info(EngineInfo),
    BestMove {
        best: String,
        ponder: Option<String>,
    },
    Unknown(String),
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("failed to start engine: {0}")]
    Start(#[source] std::io::Error),
    #[error("engine did not expose stdin or stdout")]
    MissingPipe,
    #[error("engine did not complete UCI/UCCI handshake")]
    HandshakeTimeout,
    #[error("engine I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("engine process exited")]
    Exited,
}

pub fn position_command(fen: &str, moves: &[String]) -> String {
    let mut command = format!("position fen {fen}");
    if !moves.is_empty() {
        command.push_str(" moves ");
        command.push_str(&moves.join(" "));
    }
    command
}

pub fn go_command(limit: SearchLimit) -> String {
    match limit {
        SearchLimit::Depth(depth) => format!("go depth {depth}"),
        SearchLimit::MoveTime(ms) => format!("go movetime {ms}"),
        SearchLimit::Nodes(nodes) => format!("go nodes {nodes}"),
        SearchLimit::Infinite => "go infinite".to_owned(),
    }
}

pub fn go_command_with_options(
    limit: SearchLimit,
    search_moves: &[String],
    ponder: bool,
) -> String {
    let base = go_command(limit);
    let mut parts = base.split_whitespace();
    let _ = parts.next();
    let rest = parts.collect::<Vec<_>>().join(" ");
    let mut command = if ponder {
        if rest.is_empty() {
            "go ponder".to_owned()
        } else {
            format!("go ponder {rest}")
        }
    } else {
        base
    };
    if !search_moves.is_empty() {
        command.push_str(" searchmoves ");
        command.push_str(&search_moves.join(" "));
    }
    command
}

pub fn parse_engine_line(line: &str) -> EngineEvent {
    let trimmed = line.trim();
    match trimmed {
        "uciok" => return EngineEvent::Ready(Protocol::Uci),
        "ucciok" => return EngineEvent::Ready(Protocol::Ucci),
        _ => {}
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.first() == Some(&"bestmove") {
        let best = tokens.get(1).copied().unwrap_or_default().to_owned();
        let ponder = tokens
            .windows(2)
            .find(|pair| pair[0] == "ponder")
            .map(|pair| pair[1].to_owned());
        return EngineEvent::BestMove { best, ponder };
    }
    if tokens.first() != Some(&"info") {
        return EngineEvent::Unknown(trimmed.to_owned());
    }

    let mut info = EngineInfo::default();
    let mut index = 1;
    while index < tokens.len() {
        match tokens[index] {
            "depth" => info.depth = tokens.get(index + 1).and_then(|v| v.parse().ok()),
            "nps" => info.nps = tokens.get(index + 1).and_then(|v| v.parse().ok()),
            "time" => info.time_ms = tokens.get(index + 1).and_then(|v| v.parse().ok()),
            "multipv" => {
                info.multipv = tokens
                    .get(index + 1)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1)
            }
            "score" => {
                if let (Some(kind), Some(value)) = (
                    tokens.get(index + 1),
                    tokens.get(index + 2).and_then(|v| v.parse::<i32>().ok()),
                ) {
                    match *kind {
                        "cp" => info.score_cp = Some(value),
                        "mate" => info.mate = Some(value),
                        _ => {}
                    }
                }
            }
            "pv" => {
                info.pv = tokens[index + 1..]
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect();
                break;
            }
            _ => {}
        }
        index += 1;
    }
    EngineEvent::Info(info)
}

pub struct EngineSession {
    protocol: Protocol,
    child: Child,
    control: EngineControl,
    lines: Lines<BufReader<ChildStdout>>,
}

#[derive(Clone)]
pub struct EngineControl {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl EngineControl {
    pub async fn stop(&self) -> Result<(), EngineError> {
        self.send("stop").await
    }

    async fn send(&self, command: &str) -> Result<(), EngineError> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(command.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }
}

impl EngineSession {
    pub async fn launch(
        path: impl AsRef<Path>,
        handshake_timeout: Duration,
    ) -> Result<Self, EngineError> {
        let mut child = Command::new(path.as_ref())
            .current_dir(path.as_ref().parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(EngineError::Start)?;
        let stdin = child.stdin.take().ok_or(EngineError::MissingPipe)?;
        let stdout = child.stdout.take().ok_or(EngineError::MissingPipe)?;
        let mut session = Self {
            protocol: Protocol::Uci,
            child,
            control: EngineControl {
                stdin: Arc::new(Mutex::new(stdin)),
            },
            lines: BufReader::new(stdout).lines(),
        };

        session.send("uci").await?;
        if session.wait_ready(Protocol::Uci, handshake_timeout).await? {
            return Ok(session);
        }
        session.send("ucci").await?;
        if session
            .wait_ready(Protocol::Ucci, handshake_timeout)
            .await?
        {
            session.protocol = Protocol::Ucci;
            return Ok(session);
        }
        Err(EngineError::HandshakeTimeout)
    }

    pub fn protocol(&self) -> Protocol {
        self.protocol
    }

    pub fn control(&self) -> EngineControl {
        self.control.clone()
    }

    pub async fn configure(&mut self, name: &str, value: &str) -> Result<(), EngineError> {
        let command = match self.protocol {
            Protocol::Uci => format!("setoption name {name} value {value}"),
            Protocol::Ucci => format!("setoption {name} {value}"),
        };
        self.send(&command).await
    }

    pub async fn analyze(
        &mut self,
        fen: &str,
        moves: &[String],
        limit: SearchLimit,
    ) -> Result<(), EngineError> {
        self.send(&position_command(fen, moves)).await?;
        self.send(&go_command(limit)).await
    }

    pub async fn search(
        &mut self,
        fen: &str,
        moves: &[String],
        limit: SearchLimit,
        search_moves: &[String],
        ponder: bool,
    ) -> Result<(), EngineError> {
        self.send(&position_command(fen, moves)).await?;
        self.send(&go_command_with_options(limit, search_moves, ponder))
            .await
    }

    pub async fn ponder_hit(&mut self) -> Result<(), EngineError> {
        self.send("ponderhit").await
    }

    pub async fn stop(&mut self) -> Result<(), EngineError> {
        self.control.stop().await
    }

    pub async fn next_event(&mut self) -> Result<EngineEvent, EngineError> {
        self.lines
            .next_line()
            .await?
            .map(|line| parse_engine_line(&line))
            .ok_or(EngineError::Exited)
    }

    pub async fn close(mut self) -> Result<(), EngineError> {
        let _ = self.send("quit").await;
        match timeout(Duration::from_secs(2), self.child.wait()).await {
            Ok(result) => {
                result?;
            }
            Err(_) => {
                self.child.kill().await?;
            }
        }
        Ok(())
    }

    async fn send(&mut self, command: &str) -> Result<(), EngineError> {
        self.control.send(command).await
    }

    async fn wait_ready(
        &mut self,
        expected: Protocol,
        duration: Duration,
    ) -> Result<bool, EngineError> {
        let future = async {
            while let Some(line) = self.lines.next_line().await? {
                if parse_engine_line(&line) == EngineEvent::Ready(expected) {
                    return Ok(true);
                }
            }
            Ok::<bool, std::io::Error>(false)
        };
        match timeout(duration, future).await {
            Ok(result) => Ok(result?),
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn mock_engine() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let engine = directory.path().join("mock-uci.sh");
        let log = directory.path().join("commands.log");
        let script = format!(
            r#"#!/bin/sh
log='{}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    uci) printf 'id name Mock UCI\nuciok\n' ;;
    'go depth 1') printf 'info depth 1 score cp 12 multipv 1 pv a0a1\nbestmove a0a1\n' ;;
    'go depth 2') printf 'info depth 2 score cp 24 multipv 1 pv b0b1\nbestmove b0b1\n' ;;
    'go infinite') ;;
    stop) printf 'info depth 3 score cp 36 multipv 1 pv c0c1\nbestmove c0c1\n' ;;
    'go nodes 99') exit 7 ;;
    quit) exit 0 ;;
  esac
done
"#,
            log.display()
        );
        std::fs::write(&engine, script).unwrap();
        let mut permissions = std::fs::metadata(&engine).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&engine, permissions).unwrap();
        (directory, engine, log)
    }

    #[test]
    fn builds_position_and_search_commands() {
        assert_eq!(
            position_command("fen-value", &["a0a1".into(), "a9a8".into()]),
            "position fen fen-value moves a0a1 a9a8"
        );
        assert_eq!(go_command(SearchLimit::Depth(18)), "go depth 18");
        assert_eq!(go_command(SearchLimit::MoveTime(1500)), "go movetime 1500");
        assert_eq!(go_command(SearchLimit::Infinite), "go infinite");
    }

    #[test]
    fn builds_node_limited_and_forced_move_searches() {
        assert_eq!(go_command(SearchLimit::Nodes(250_000)), "go nodes 250000");
        assert_eq!(
            go_command_with_options(
                SearchLimit::Depth(18),
                &["h2e2".into(), "b2e2".into()],
                false,
            ),
            "go depth 18 searchmoves h2e2 b2e2"
        );
        assert_eq!(
            go_command_with_options(SearchLimit::Infinite, &[], true),
            "go ponder infinite"
        );
    }

    #[test]
    fn parses_multi_pv_engine_output() {
        let event = parse_engine_line(
            "info depth 16 score cp 38 nps 120000 time 530 multipv 2 pv h2e2 h9g7",
        );
        assert_eq!(
            event,
            EngineEvent::Info(EngineInfo {
                depth: Some(16),
                score_cp: Some(38),
                mate: None,
                nps: Some(120000),
                time_ms: Some(530),
                multipv: 2,
                pv: vec!["h2e2".into(), "h9g7".into()]
            })
        );
    }

    #[test]
    fn parses_bestmove_and_protocol_readiness() {
        assert_eq!(
            parse_engine_line("ucciok"),
            EngineEvent::Ready(Protocol::Ucci)
        );
        assert_eq!(
            parse_engine_line("bestmove h2e2 ponder h9g7"),
            EngineEvent::BestMove {
                best: "h2e2".into(),
                ponder: Some("h9g7".into())
            }
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn one_mock_process_runs_searches_serially_and_stops_infinite_search() {
        let (_directory, engine, log) = mock_engine();
        let mut session = EngineSession::launch(&engine, Duration::from_secs(1))
            .await
            .unwrap();

        session
            .search("fen-one", &[], SearchLimit::Depth(1), &[], false)
            .await
            .unwrap();
        assert!(matches!(
            session.next_event().await.unwrap(),
            EngineEvent::Info(_)
        ));
        assert_eq!(
            session.next_event().await.unwrap(),
            EngineEvent::BestMove {
                best: "a0a1".into(),
                ponder: None
            }
        );

        session
            .search("fen-two", &[], SearchLimit::Depth(2), &[], false)
            .await
            .unwrap();
        assert!(matches!(
            session.next_event().await.unwrap(),
            EngineEvent::Info(_)
        ));
        assert!(matches!(
            session.next_event().await.unwrap(),
            EngineEvent::BestMove { ref best, .. } if best == "b0b1"
        ));

        session
            .search("fen-three", &[], SearchLimit::Infinite, &[], false)
            .await
            .unwrap();
        session.control().stop().await.unwrap();
        assert!(matches!(
            session.next_event().await.unwrap(),
            EngineEvent::Info(_)
        ));
        assert!(matches!(
            session.next_event().await.unwrap(),
            EngineEvent::BestMove { ref best, .. } if best == "c0c1"
        ));
        session.close().await.unwrap();

        let commands = std::fs::read_to_string(log).unwrap();
        let expected = [
            "position fen fen-one",
            "go depth 1",
            "position fen fen-two",
            "go depth 2",
            "position fen fen-three",
            "go infinite",
            "stop",
        ];
        let mut offset = 0;
        for command in expected {
            let index = commands[offset..].find(command).unwrap() + offset;
            offset = index + command.len();
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_when_mock_engine_exits_during_search() {
        let (_directory, engine, _log) = mock_engine();
        let mut session = EngineSession::launch(&engine, Duration::from_secs(1))
            .await
            .unwrap();
        session
            .search("fen", &[], SearchLimit::Nodes(99), &[], false)
            .await
            .unwrap();
        assert!(matches!(
            session.next_event().await,
            Err(EngineError::Exited)
        ));
    }
}
