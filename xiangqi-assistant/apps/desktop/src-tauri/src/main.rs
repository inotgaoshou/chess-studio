use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use std::time::Instant;

use chrono::Utc;
use engine_protocol::{EngineControl, EngineEvent, EngineSession, Protocol, SearchLimit};
use local_store::{AnalysisSummary, LocalGame, LocalStore};
use serde::Serialize;
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    SetMainlinePayload, UpdateCommentPayload,
};
use tauri::{Manager, State};
use uuid::Uuid;
use xiangqi_core::{Board, Color, GameStatus, PieceKind, STARTING_FEN, Square};
use xiangqi_manual::ManualTree;

struct AppModel {
    board: Board,
    starting_fen: String,
    tree: ManualTree,
    current_node: Option<Uuid>,
    game_id: Uuid,
    device_id: Uuid,
    lamport: u64,
    store: LocalStore,
}

struct DesktopState {
    model: Mutex<AppModel>,
    engine: tokio::sync::Mutex<Option<EngineControl>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PieceDto {
    row: u8,
    col: u8,
    color: &'static str,
    kind: &'static str,
    label: &'static str,
}

#[derive(Serialize)]
struct SquareDto {
    row: u8,
    col: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveDto {
    id: Uuid,
    iccs: String,
    notation: String,
    moved_by: &'static str,
    from: SquareDto,
    to: SquareDto,
    score_cp: Option<i32>,
    mate: Option<i32>,
    comment: String,
    is_mainline: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardDto {
    fen: String,
    side_to_move: &'static str,
    status: &'static str,
    pieces: Vec<PieceDto>,
    history: Vec<MoveDto>,
    branches: Vec<MoveDto>,
    current_node: Option<Uuid>,
}

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisLine {
    depth: Option<u32>,
    score_cp: Option<i32>,
    mate: Option<i32>,
    nps: Option<u64>,
    time_ms: Option<u64>,
    multipv: u32,
    #[serde(default)]
    notation: Vec<String>,
    pv: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    uploaded: usize,
    downloaded: usize,
    cursor: u64,
}

#[tauri::command]
fn get_state(state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    board_dto(&model)
}

#[tauri::command]
fn play_move(iccs: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mv = xiangqi_core::Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let next = model
        .board
        .apply_move(mv)
        .map_err(|error| error.to_string())?;
    let parent = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let node_id = model
        .tree
        .add_move(parent, mv, "")
        .map_err(|error| error.to_string())?;
    model.lamport += 1;
    let operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: node_id,
        game_id: model.game_id,
        kind: OperationKind::AddMove,
        payload: serde_json::to_value(AddMovePayload {
            node_id,
            parent_id: parent,
            move_iccs: iccs,
            order_key: model
                .tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .order_key,
            is_mainline: model
                .tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .is_mainline,
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: Utc::now(),
    };
    let node = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .clone();
    let game_id = model.game_id;
    model
        .store
        .save_move_with_operation(
            node.id,
            game_id,
            Some(node.parent_id),
            &node.mv.to_iccs(),
            &node.comment,
            node.order_key,
            node.is_mainline,
            &operation,
        )
        .map_err(|error| error.to_string())?;
    model.current_node = Some(node_id);
    model.board = next;
    board_dto(&model)
}

#[tauri::command]
fn new_game(fen: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model.board = board;
    model.starting_fen = fen.clone();
    model.tree = ManualTree::new();
    model.current_node = None;
    model.game_id = Uuid::new_v4();
    model.lamport += 1;
    let operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: model.game_id,
        game_id: model.game_id,
        kind: OperationKind::CreateGame,
        payload: serde_json::to_value(CreateGamePayload {
            title: "New study".into(),
            fen: fen.clone(),
            root_id: model.tree.root_id(),
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: Utc::now(),
    };
    let game_id = model.game_id;
    let root_id = model.tree.root_id();
    model
        .store
        .save_game_with_operation(game_id, "New study", &fen, root_id, &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
fn navigate_to(node_id: Option<Uuid>, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model.board = board_at(&model.starting_fen, &model.tree, node_id)?;
    model.current_node = node_id;
    let game_id = model.game_id;
    model
        .store
        .set_current_node(game_id, node_id)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
fn update_comment(
    node_id: Uuid,
    comment: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .tree
        .update_comment(node_id, comment.clone())
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::UpdateComment,
        serde_json::to_value(UpdateCommentPayload { node_id, comment })
            .map_err(|error| error.to_string())?,
    );
    let comment = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .comment
        .clone();
    model
        .store
        .update_comment_with_operation(node_id, &comment, &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
fn set_mainline(node_id: Uuid, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .parent_id;
    model
        .tree
        .set_mainline(parent_id, node_id)
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::SetMainline,
        serde_json::to_value(SetMainlinePayload { parent_id, node_id })
            .map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .set_mainline_with_operation(game_id, parent_id, node_id, &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
fn delete_node(node_id: Uuid, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .parent_id;
    let affects_current_line = model
        .current_node
        .and_then(|current| model.tree.active_line(current).ok())
        .is_some_and(|line| line.iter().any(|node| node.id == node_id));
    model
        .tree
        .remove(node_id)
        .map_err(|error| error.to_string())?;
    if affects_current_line {
        model.current_node = (parent_id != model.tree.root_id()).then_some(parent_id);
        model.board = board_at(&model.starting_fen, &model.tree, model.current_node)?;
    }
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::DeleteNode,
        serde_json::to_value(DeleteNodePayload { node_id }).map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    let current_node = model.current_node;
    model
        .store
        .delete_node_with_operation(game_id, node_id, current_node, &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
async fn analyze_position(
    engine_path: String,
    fen: String,
    search_mode: String,
    search_value: u64,
    threads: u32,
    hash_mb: u32,
    multipv: u32,
    state: State<'_, DesktopState>,
) -> Result<Vec<AnalysisLine>, String> {
    let analysis_board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let (analysis_game_id, analysis_node_id) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        if model.board.to_fen() != fen {
            return Err("analysis FEN does not match the current position".into());
        }
        (model.game_id, model.current_node)
    };
    let limit = match search_mode.as_str() {
        "time" => SearchLimit::MoveTime(search_value.clamp(100, 30_000)),
        "depth" => SearchLimit::Depth(search_value.clamp(1, 100) as u32),
        "infinite" => SearchLimit::Infinite,
        _ => return Err("unsupported search mode".into()),
    };
    let multipv = multipv.clamp(1, 10);
    let mut session = EngineSession::launch(&engine_path, Duration::from_secs(2))
        .await
        .map_err(|error| error.to_string())?;
    let protocol = session.protocol();
    let threads = threads.clamp(1, 64);
    let hash_mb = hash_mb.clamp(16, 4096);
    session
        .configure("Threads", &threads.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("Hash", &hash_mb.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("MultiPV", &multipv.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .analyze(&fen, &[], limit)
        .await
        .map_err(|error| error.to_string())?;
    {
        let mut active = state.engine.lock().await;
        if active.is_some() {
            let _ = session.close().await;
            return Err("an engine analysis is already running".into());
        }
        *active = Some(session.control());
    }
    let started = Instant::now();
    let mut lines = BTreeMap::new();
    let mut read_error = None;
    loop {
        match session.next_event().await {
            Ok(EngineEvent::Info(info)) if !info.pv.is_empty() => {
                lines.insert(
                    info.multipv,
                    AnalysisLine {
                        depth: info.depth,
                        score_cp: info.score_cp,
                        mate: info.mate,
                        nps: info.nps,
                        time_ms: info.time_ms,
                        multipv: info.multipv,
                        notation: analysis_board
                            .chinese_pv_notation(&info.pv)
                            .unwrap_or_default(),
                        pv: info.pv,
                    },
                );
            }
            Ok(EngineEvent::BestMove { .. }) => break,
            Err(error) => {
                read_error = Some(error.to_string());
                break;
            }
            _ => {}
        }
    }
    let _ = session.close().await;
    *state.engine.lock().await = None;
    if let Some(error) = read_error {
        return Err(error);
    }
    let lines: Vec<_> = lines.into_values().collect();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let engine_name = Path::new(&engine_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Local engine");
    model
        .store
        .save_engine_profile(engine_name, &engine_path, protocol_name(protocol))
        .map_err(|error| error.to_string())?;
    let config_hash =
        format!("{search_mode}:{search_value}:threads:{threads}:hash:{hash_mb}:multipv:{multipv}");
    let primary = lines.first();
    model
        .store
        .save_analysis(
            analysis_game_id,
            analysis_node_id,
            &engine_path,
            &config_hash,
            lines.iter().filter_map(|line| line.depth).max(),
            primary.and_then(|line| line.score_cp),
            primary.and_then(|line| line.mate),
            &serde_json::to_string(&lines).map_err(|error| error.to_string())?,
            elapsed_ms,
        )
        .map_err(|error| error.to_string())?;
    Ok(lines)
}

#[tauri::command]
fn detect_pikafish(app: tauri::AppHandle) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PIKAFISH_PATH") {
        candidates.push(PathBuf::from(path));
    }

    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from(
        "/Applications/TCHESS.app/Contents/pikafish/pikafish-apple-silicon",
    ));

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(pikafish_candidates(&resource_dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(pikafish_candidates(parent));
            candidates.extend(pikafish_candidates(&parent.join("../Resources")));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) {
            candidates.push(directory.join("pikafish"));
            candidates.push(directory.join("pikafish.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

fn pikafish_candidates(base: &Path) -> Vec<PathBuf> {
    [
        "pikafish",
        "pikafish.exe",
        "pikafish/pikafish",
        "pikafish/pikafish.exe",
        "pikafish/pikafish-apple-silicon",
        "resources/pikafish/pikafish",
        "resources/pikafish/pikafish.exe",
    ]
    .into_iter()
    .map(|relative| base.join(relative))
    .collect()
}

#[tauri::command]
async fn stop_analysis(state: State<'_, DesktopState>) -> Result<bool, String> {
    let control = state.engine.lock().await.clone();
    if let Some(control) = control {
        control.stop().await.map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn get_saved_analysis(state: State<'_, DesktopState>) -> Result<Vec<AnalysisLine>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let saved = model
        .store
        .load_latest_analysis(model.game_id, model.current_node)
        .map_err(|error| error.to_string())?;
    let mut lines: Vec<AnalysisLine> = saved
        .map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
        .transpose()
        .map(Option::unwrap_or_default)?;
    for line in &mut lines {
        if line.notation.is_empty() {
            line.notation = model
                .board
                .chinese_pv_notation(&line.pv)
                .unwrap_or_default();
        }
    }
    Ok(lines)
}

fn protocol_name(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Uci => "uci",
        Protocol::Ucci => "ucci",
    }
}

#[tauri::command]
async fn sync_now(
    server_url: String,
    token: String,
    state: State<'_, DesktopState>,
) -> Result<SyncResult, String> {
    let pending = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .pending_operations(500)
            .map_err(|error| error.to_string())?
    };
    let client = reqwest::Client::new();
    let base = server_url.trim_end_matches('/');
    let push: sync_protocol::PushResponse = client
        .post(format!("{base}/api/v1/sync/push"))
        .bearer_auth(&token)
        .json(&sync_protocol::PushRequest {
            operations: pending.clone(),
        })
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let cursor = {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .mark_uploaded(&push.accepted)
            .map_err(|error| error.to_string())?;
        model
            .store
            .remote_cursor()
            .map_err(|error| error.to_string())?
    };
    let pull: sync_protocol::PullResponse = client
        .get(format!("{base}/api/v1/sync/pull?cursor={cursor}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        for item in &pull.operations {
            model.lamport = model.lamport.max(item.operation.lamport);
            model
                .store
                .apply_remote_operation(&item.operation, item.sequence)
                .map_err(|error| error.to_string())?;
        }
        if pull
            .operations
            .iter()
            .any(|item| item.operation.game_id == model.game_id)
        {
            let game = model
                .store
                .load_game(model.game_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "synchronized game is unavailable".to_owned())?;
            let (board, tree) = restore_game(&model.store, &game)?;
            model.board = board;
            model.starting_fen = game.starting_fen;
            model.tree = tree;
            model.current_node = game.current_node_id;
        }
    }
    Ok(SyncResult {
        uploaded: pending.len(),
        downloaded: pull.operations.len(),
        cursor: pull.cursor,
    })
}

fn board_dto(model: &AppModel) -> Result<BoardDto, String> {
    let analysis = model
        .store
        .load_latest_analysis_summaries(model.game_id)
        .map_err(|error| error.to_string())?;
    let mut pieces = Vec::new();
    for row in 0..10 {
        for col in 0..9 {
            if let Some(piece) = model.board.piece_at(Square { row, col }) {
                let (kind, red_label, black_label) = match piece.kind {
                    PieceKind::King => ("king", "帅", "将"),
                    PieceKind::Advisor => ("advisor", "仕", "士"),
                    PieceKind::Elephant => ("elephant", "相", "象"),
                    PieceKind::Horse => ("horse", "马", "马"),
                    PieceKind::Rook => ("rook", "车", "车"),
                    PieceKind::Cannon => ("cannon", "炮", "炮"),
                    PieceKind::Pawn => ("pawn", "兵", "卒"),
                };
                pieces.push(PieceDto {
                    row,
                    col,
                    color: if piece.color == Color::Red {
                        "red"
                    } else {
                        "black"
                    },
                    kind,
                    label: if piece.color == Color::Red {
                        red_label
                    } else {
                        black_label
                    },
                });
            }
        }
    }
    let mut history = Vec::new();
    if let Some(node) = model.current_node {
        let mut board = Board::from_fen(&model.starting_fen).map_err(|error| error.to_string())?;
        for node in model
            .tree
            .active_line(node)
            .map_err(|error| error.to_string())?
        {
            history.push(move_dto(node, &board, analysis.get(&node.id))?);
            board = board
                .apply_move(node.mv)
                .map_err(|error| error.to_string())?;
        }
    }
    let branch_parent = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let branches = model
        .tree
        .branches(branch_parent)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|node| move_dto(node, &model.board, analysis.get(&node.id)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(BoardDto {
        fen: model.board.to_fen(),
        side_to_move: if model.board.side_to_move() == Color::Red {
            "红方"
        } else {
            "黑方"
        },
        status: match model.board.status() {
            GameStatus::Ongoing => "进行中",
            GameStatus::Check => "将军",
            GameStatus::Checkmate => "将死",
        },
        pieces,
        history,
        branches,
        current_node: model.current_node,
    })
}

fn move_dto(
    node: &xiangqi_manual::MoveNode,
    board: &Board,
    analysis: Option<&AnalysisSummary>,
) -> Result<MoveDto, String> {
    let moved_by = board
        .piece_at(node.mv.from)
        .ok_or_else(|| "move source is empty".to_owned())?
        .color;
    Ok(MoveDto {
        id: node.id,
        iccs: node.mv.to_iccs(),
        notation: board
            .chinese_move_notation(node.mv)
            .map_err(|error| error.to_string())?,
        moved_by: if moved_by == Color::Red {
            "红方"
        } else {
            "黑方"
        },
        from: SquareDto {
            row: node.mv.from.row,
            col: node.mv.from.col,
        },
        to: SquareDto {
            row: node.mv.to.row,
            col: node.mv.to.col,
        },
        score_cp: analysis.and_then(|summary| summary.score_cp),
        mate: analysis.and_then(|summary| summary.mate),
        comment: node.comment.clone(),
        is_mainline: node.is_mainline,
    })
}

fn board_at(starting_fen: &str, tree: &ManualTree, node_id: Option<Uuid>) -> Result<Board, String> {
    let mut board = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    if let Some(node_id) = node_id {
        for mv in tree.line_to(node_id).map_err(|error| error.to_string())? {
            board = board.apply_move(mv).map_err(|error| error.to_string())?;
        }
    }
    Ok(board)
}

fn restore_game(store: &LocalStore, game: &LocalGame) -> Result<(Board, ManualTree), String> {
    let mut tree = ManualTree::with_root(game.root_id);
    for node in store
        .load_move_nodes(game.id)
        .map_err(|error| error.to_string())?
    {
        tree.restore_node(node).map_err(|error| error.to_string())?;
    }
    let board = board_at(&game.starting_fen, &tree, game.current_node_id)?;
    Ok((board, tree))
}

fn next_operation(
    model: &mut AppModel,
    entity_id: Uuid,
    kind: OperationKind,
    payload: serde_json::Value,
) -> Operation {
    model.lamport += 1;
    Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id,
        game_id: model.game_id,
        kind,
        payload,
        lamport: model.lamport,
        created_at: Utc::now(),
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut store = LocalStore::open(data_dir.join("xiangqi.sqlite3"))?;
            let device_id = store.device_id()?;
            let mut lamport = store.max_lamport()?;
            let (board, starting_fen, tree, current_node, game_id) =
                if let Some(game) = store.load_latest_game()? {
                    let mut tree = ManualTree::with_root(game.root_id);
                    for node in store.load_move_nodes(game.id)? {
                        tree.restore_node(node)?;
                    }
                    let mut board = Board::from_fen(&game.starting_fen)?;
                    if let Some(current) = game.current_node_id {
                        for mv in tree.line_to(current)? {
                            board = board.apply_move(mv)?;
                        }
                    }
                    (
                        board,
                        game.starting_fen,
                        tree,
                        game.current_node_id,
                        game.id,
                    )
                } else {
                    let game_id = Uuid::new_v4();
                    let tree = ManualTree::new();
                    lamport += 1;
                    let operation = Operation {
                        op_id: Uuid::new_v4(),
                        device_id,
                        entity_id: game_id,
                        game_id,
                        kind: OperationKind::CreateGame,
                        payload: serde_json::to_value(CreateGamePayload {
                            title: "New study".into(),
                            fen: STARTING_FEN.into(),
                            root_id: tree.root_id(),
                        })?,
                        lamport,
                        created_at: Utc::now(),
                    };
                    store.save_game_with_operation(
                        game_id,
                        "New study",
                        STARTING_FEN,
                        tree.root_id(),
                        &operation,
                    )?;
                    (
                        Board::from_fen(STARTING_FEN)?,
                        STARTING_FEN.into(),
                        tree,
                        None,
                        game_id,
                    )
                };
            app.manage(DesktopState {
                model: Mutex::new(AppModel {
                    board,
                    starting_fen,
                    tree,
                    current_node,
                    game_id,
                    device_id,
                    lamport,
                    store,
                }),
                engine: tokio::sync::Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            play_move,
            new_game,
            navigate_to,
            update_comment,
            set_mainline,
            delete_node,
            detect_pikafish,
            analyze_position,
            stop_analysis,
            get_saved_analysis,
            sync_now
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Xiangqi Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_dto_formats_history_and_attaches_saved_scores() {
        let mut board = Board::from_fen(STARTING_FEN).unwrap();
        let mut tree = ManualTree::new();
        let first_move = xiangqi_core::Move::from_iccs("h2e2").unwrap();
        let first = tree.add_move(tree.root_id(), first_move, "").unwrap();
        board = board.apply_move(first_move).unwrap();
        let second_move = xiangqi_core::Move::from_iccs("h9g7").unwrap();
        let second = tree.add_move(first, second_move, "").unwrap();
        board = board.apply_move(second_move).unwrap();
        let game_id = Uuid::new_v4();
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .save_analysis(
                game_id,
                Some(first),
                "/engine",
                "depth:12",
                Some(12),
                Some(42),
                None,
                "[]",
                10,
            )
            .unwrap();
        let model = AppModel {
            board,
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(second),
            game_id,
            device_id: Uuid::new_v4(),
            lamport: 0,
            store,
        };

        let dto = board_dto(&model).unwrap();
        assert_eq!(dto.history[0].notation, "炮二平五");
        assert_eq!(dto.history[0].moved_by, "红方");
        assert_eq!(dto.history[0].score_cp, Some(42));
        assert_eq!(dto.history[1].notation, "马8进7");
        assert_eq!(dto.history[1].moved_by, "黑方");
        assert_eq!(dto.history[1].score_cp, None);
    }
}
