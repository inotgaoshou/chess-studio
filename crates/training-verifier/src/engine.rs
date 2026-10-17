//! Bounded native search adapter. Dropping the future kills its UCI child.
use crate::{pending, searches, verify, Evidence, Line, Request, ResultDto, Search};
use engine_protocol::{EngineEvent, EngineSession};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub async fn fingerprint(engine: &Path, nnue: Option<&Path>) -> Result<String, String> {
    type Entry = (Vec<(PathBuf, u64, std::time::SystemTime)>, String);
    static CACHE: std::sync::OnceLock<tokio::sync::Mutex<Vec<Entry>>> = std::sync::OnceLock::new();
    let mut resources = Vec::new();
    for path in std::iter::once(engine).chain(nnue) {
        let meta = tokio::fs::metadata(path)
            .await
            .map_err(|_| "验证引擎资源不可读取")?;
        resources.push((
            path.to_path_buf(),
            meta.len(),
            meta.modified().map_err(|_| "验证引擎资源不可读取")?,
        ));
    }
    let mut cache = CACHE.get_or_init(Default::default).lock().await;
    if let Some((_, value)) = cache.iter().find(|(key, _)| key == &resources) {
        return Ok(value.clone());
    }
    let mut hash = Sha256::new();
    for path in std::iter::once(engine).chain(nnue) {
        hash.update(
            tokio::fs::read(path)
                .await
                .map_err(|_| "验证引擎资源不可读取")?,
        );
    }
    let value = format!("{:x}", hash.finalize());
    if cache.len() >= 16 {
        cache.remove(0);
    }
    cache.push((resources, value.clone()));
    Ok(value)
}
pub async fn search(session: &mut EngineSession, spec: &Search) -> Result<Line, String> {
    // Both limits apply: a shallow timeout is evidence of uncertainty, never wrong.
    session
        .search_bounded(&spec.fen, spec.depth, spec.move_time_ms, &spec.search_moves)
        .await
        .map_err(|_| "验证搜索启动失败")?;
    let mut latest = None;
    loop {
        match session.next_event().await.map_err(|_| "验证引擎已退出")? {
            EngineEvent::Info(info) if info.multipv == 1 && !info.pv.is_empty() => {
                latest = Some(Line {
                    depth: info.depth.unwrap_or(0),
                    score_cp: info.score_cp,
                    mate: info.mate,
                    bound: info.score_bound,
                    pv: info.pv,
                });
            }
            EngineEvent::BestMove { .. } => {
                return latest.ok_or_else(|| "验证引擎未返回评估证据".into())
            }
            _ => {}
        }
    }
}
pub async fn run(
    r: &Request,
    path: PathBuf,
    nnue: Option<PathBuf>,
    engine_fingerprint: String,
) -> (ResultDto, Evidence) {
    let mut evidence = Evidence {
        engine_fingerprint,
        ..Default::default()
    };
    let plans = match searches(r) {
        Ok(p) => p,
        Err(_) => return (verify(r, &evidence), evidence),
    };
    if plans.is_empty() {
        return (verify(r, &evidence), evidence);
    }
    let work = async {
        let mut session = EngineSession::launch(&path, Duration::from_secs(2))
            .await
            .map_err(|_| "皮卡鱼启动失败")?;
        for (name, value) in [("Threads", "2"), ("Hash", "128"), ("MultiPV", "1")] {
            session
                .configure(name, value)
                .await
                .map_err(|_| "皮卡鱼配置失败")?;
        }
        if let Some(nnue) = nnue {
            session
                .configure("EvalFile", nnue.to_str().ok_or("NNUE 配置无效")?)
                .await
                .map_err(|_| "NNUE 加载失败")?;
        }
        for spec in plans {
            evidence
                .lines
                .insert(spec.key.clone(), search(&mut session, &spec).await?);
        }
        let _ = session.close().await;
        Ok::<_, String>(())
    };
    match tokio::time::timeout(Duration::from_secs(13), work).await {
        Ok(Ok(())) => {
            let request = r.clone();
            let proof_evidence = evidence.clone();
            let out = tokio::task::spawn_blocking(move || verify(&request, &proof_evidence))
                .await
                .unwrap_or_else(|_| pending(r, "待复核：验证暂时不可用"));
            (out, evidence)
        }
        _ => (
            pending(r, "待复核：皮卡鱼暂时不可用或搜索超时，错误次数未增加"),
            evidence,
        ),
    }
}
