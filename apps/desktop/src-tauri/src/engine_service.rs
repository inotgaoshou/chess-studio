use super::*;
use crate::{
    link_service::effective_link_confidence_threshold,
    manual_service::commit_move,
    report_service::{
        decorate_known_pikafish_nnue_version, file_sha256, probe_pikafish_runtime_metadata,
        protocol_name, report_engine_fingerprint,
    },
    sync_service::sync_account_dto,
};

#[tauri::command]
pub(crate) async fn analyze_position(
    engine_path: String,
    engine_id: Option<String>,
    engine_name: Option<String>,
    analysis_session_id: Option<u64>,
    fen: String,
    search_mode: String,
    search_value: u64,
    threads: u32,
    hash_mb: u32,
    multipv: u32,
    search_moves: Vec<String>,
    exclude_move: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Vec<AnalysisLine>, String> {
    if state.report_running.load(Ordering::SeqCst) {
        return Err("整局报告正在生成，请先取消报告分析".into());
    }
    let analysis_generation = state.analysis_generation.load(Ordering::SeqCst);
    let analysis_board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let analysis_target = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        (model.board.to_fen() == fen).then_some((model.game_id, model.current_node))
    };
    let limit = match search_mode.as_str() {
        "time" => SearchLimit::MoveTime(search_value.clamp(100, 30_000)),
        "depth" => SearchLimit::Depth(search_value.clamp(1, 100) as u32),
        "nodes" => SearchLimit::Nodes(search_value.clamp(1_000, 100_000_000)),
        "infinite" => SearchLimit::Infinite,
        _ => return Err("unsupported search mode".into()),
    };
    let multipv = multipv.max(1);
    let mut search_moves = search_moves
        .into_iter()
        .take(90)
        .map(|value| {
            let mv = xiangqi_core::Move::from_iccs(&value).map_err(|error| error.to_string())?;
            analysis_board
                .apply_move(mv)
                .map_err(|_| format!("强制搜索包含非法着法：{value}"))?;
            Ok(value)
        })
        .collect::<Result<Vec<_>, String>>()?;
    if search_moves.is_empty() {
        if let Some(excluded) = exclude_move.as_deref() {
            search_moves = analysis_board
                .legal_moves()
                .into_iter()
                .map(|mv| mv.to_iccs())
                .filter(|value| value != excluded)
                .collect();
            if search_moves.is_empty() {
                return Err("当前局面没有可替代的合法着法".into());
            }
        }
    }
    let resolved_engine_path = resolve_engine_path(&app, &engine_path)?;
    let resolved_engine_path_text = resolved_engine_path.to_string_lossy().into_owned();
    // Analysis sessions are intentionally short-lived and independent so multiple
    // configured engines can search the same position concurrently.
    let session = EngineSession::launch(&resolved_engine_path, Duration::from_secs(2))
        .await
        .map_err(|error| error.to_string())?;
    let mut runtime = EngineRuntime {
        path: resolved_engine_path_text.clone(),
        session,
        pondering_fen: None,
        state: EngineRuntimeState::Idle,
    };
    let protocol = runtime.session.protocol();
    let threads = threads.clamp(1, 64);
    let hash_mb = hash_mb.clamp(16, 4096);
    configure_engine_for_xiangqi(&mut runtime.session, &resolved_engine_path).await?;
    runtime
        .session
        .configure("Threads", &threads.to_string())
        .await
        .map_err(|error| error.to_string())?;
    runtime
        .session
        .configure("Hash", &hash_mb.to_string())
        .await
        .map_err(|error| error.to_string())?;
    runtime
        .session
        .configure("MultiPV", &multipv.to_string())
        .await
        .map_err(|error| error.to_string())?;
    runtime
        .session
        .search(&fen, &[], limit, &search_moves, false)
        .await
        .map_err(|error| error.to_string())?;
    runtime.state = EngineRuntimeState::Analyzing;
    state
        .engine
        .lock()
        .await
        .insert(resolved_engine_path_text.clone(), runtime.session.control());
    emit_engine_state(&app, runtime.state);
    let started = Instant::now();
    let mut lines = BTreeMap::new();
    let mut read_error = None;
    loop {
        match runtime.session.next_event().await {
            Ok(EngineEvent::Info(info)) if !info.pv.is_empty() => {
                let line = analysis_line_from_engine_info(&analysis_board, info);
                if state.analysis_generation.load(Ordering::SeqCst) == analysis_generation {
                    emit_engine_event(
                        &app,
                        EngineRuntimeEvent::AnalysisInfo {
                            engine_id: engine_id.clone(),
                            engine_name: engine_name.clone(),
                            analysis_session_id,
                            fen: fen.clone(),
                            line: line.clone(),
                        },
                    );
                }
                lines.insert(line.multipv, line);
            }
            Ok(EngineEvent::BestMove { best, ponder }) => {
                let best = normalize_engine_move_for_board(&analysis_board, &best).unwrap_or(best);
                let ponder = ponder.and_then(|value| {
                    let best_move = Move::from_iccs(&best).ok()?;
                    let board = analysis_board.apply_move(best_move).ok()?;
                    normalize_engine_move_for_board(&board, &value).or(Some(value))
                });
                if state.analysis_generation.load(Ordering::SeqCst) == analysis_generation {
                    emit_engine_event(
                        &app,
                        EngineRuntimeEvent::Bestmove {
                            fen: fen.clone(),
                            best,
                            ponder,
                        },
                    );
                }
                break;
            }
            Err(error) => {
                read_error = Some(error.to_string());
                break;
            }
            _ => {}
        }
    }
    state.engine.lock().await.remove(&resolved_engine_path_text);
    if let Some(error) = read_error {
        runtime.state = EngineRuntimeState::Faulted;
        emit_engine_state(&app, runtime.state);
        if state.analysis_generation.load(Ordering::SeqCst) == analysis_generation {
            emit_engine_event(
                &app,
                EngineRuntimeEvent::Error {
                    message: error.clone(),
                },
            );
        }
        let _ = runtime.session.close().await;
        return Err(error);
    }
    runtime.state = EngineRuntimeState::Idle;
    emit_engine_state(&app, runtime.state);
    let _ = runtime.session.close().await;
    let lines: Vec<_> = lines.into_values().collect();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let engine_name = resolved_engine_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Local engine");
    model
        .store
        .save_engine_profile(
            engine_name,
            &resolved_engine_path_text,
            protocol_name(protocol),
        )
        .map_err(|error| error.to_string())?;
    if state.analysis_generation.load(Ordering::SeqCst) != analysis_generation {
        return Ok(lines);
    }
    let config_hash = format!(
        "{search_mode}:{search_value}:threads:{threads}:hash:{hash_mb}:multipv:{multipv}:searchmoves:{}",
        search_moves.join(",")
    );
    let primary = lines.first();
    if let Some((analysis_game_id, analysis_node_id)) = analysis_target {
        model
            .store
            .save_analysis(
                analysis_game_id,
                analysis_node_id,
                &resolved_engine_path_text,
                &config_hash,
                lines.iter().filter_map(|line| line.depth).max(),
                primary.and_then(|line| line.score_cp),
                primary.and_then(|line| line.mate),
                &serde_json::to_string(&lines).map_err(|error| error.to_string())?,
                elapsed_ms,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(lines)
}

#[tauri::command]
pub(crate) async fn engine_play_move(
    engine_path: String,
    move_time_ms: u64,
    threads: u32,
    hash_mb: u32,
    ponder: bool,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<EngineMoveDto, String> {
    if state.report_running.load(Ordering::SeqCst) {
        return Err("整局报告正在生成，请先取消报告分析".into());
    }
    let play_generation = state.play_generation.load(Ordering::SeqCst);
    let (fen, expected_game, expected_node) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        if !model.playable {
            return Err("当前研究局面不可对弈".into());
        }
        (model.board.to_fen(), model.game_id, model.current_node)
    };
    let stale_controls = state
        .engine
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    if !stale_controls.is_empty() {
        emit_engine_state(&app, EngineRuntimeState::Stopping);
        for control in stale_controls {
            let _ = control.stop().await;
        }
        state.engine.lock().await.clear();
        emit_engine_state(&app, EngineRuntimeState::Idle);
    }
    let resolved_engine_path = resolve_engine_path(&app, &engine_path)?;
    let resolved_engine_path_text = resolved_engine_path.to_string_lossy().into_owned();
    let mut slot = state.play_session.lock().await;
    if slot
        .as_ref()
        .is_some_and(|play| play.path != resolved_engine_path_text)
    {
        if let Some(play) = slot.take() {
            let _ = play.session.close().await;
        }
    }
    if slot.as_ref().is_some_and(|play| {
        !matches!(
            play.state,
            EngineRuntimeState::Idle | EngineRuntimeState::Pondering
        )
    }) {
        if let Some(play) = slot.take() {
            let _ = play.session.close().await;
        }
    }
    if slot.is_none() {
        let session = EngineSession::launch(&resolved_engine_path, Duration::from_secs(2))
            .await
            .map_err(|error| error.to_string())?;
        *slot = Some(EngineRuntime {
            path: resolved_engine_path_text.clone(),
            session,
            pondering_fen: None,
            state: EngineRuntimeState::Idle,
        });
    }
    let play = slot.as_mut().expect("engine session was initialized");
    let mut ponder_hit = false;
    if let Some(predicted_fen) = play.pondering_fen.take() {
        if predicted_fen == fen {
            play.session
                .ponder_hit()
                .await
                .map_err(|error| error.to_string())?;
            ponder_hit = true;
        } else {
            play.session
                .stop()
                .await
                .map_err(|error| error.to_string())?;
            loop {
                match play.session.next_event().await {
                    Ok(EngineEvent::BestMove { .. }) => break,
                    Ok(_) => {}
                    Err(error) => {
                        slot.take();
                        return Err(error.to_string());
                    }
                }
            }
        }
    }
    if !ponder_hit {
        configure_engine_for_xiangqi(&mut play.session, &resolved_engine_path).await?;
        play.session
            .configure("Threads", &threads.clamp(1, 64).to_string())
            .await
            .map_err(|error| error.to_string())?;
        play.session
            .configure("Hash", &hash_mb.clamp(16, 4096).to_string())
            .await
            .map_err(|error| error.to_string())?;
        play.session
            .configure("MultiPV", "1")
            .await
            .map_err(|error| error.to_string())?;
        play.session
            .configure("Ponder", if ponder { "true" } else { "false" })
            .await
            .map_err(|error| error.to_string())?;
        play.session
            .search(
                &fen,
                &[],
                SearchLimit::MoveTime(move_time_ms.clamp(100, 30_000)),
                &[],
                false,
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    play.state = EngineRuntimeState::Thinking;
    state
        .engine
        .lock()
        .await
        .insert(resolved_engine_path_text.clone(), play.session.control());
    emit_engine_state(&app, play.state);
    let (best_move, ponder_move) = loop {
        match play.session.next_event().await {
            Ok(EngineEvent::BestMove { best, ponder }) => {
                break (best, ponder);
            }
            Ok(EngineEvent::Info(info)) if !info.pv.is_empty() => {
                if state.play_generation.load(Ordering::SeqCst) != play_generation {
                    continue;
                }
                let board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
                emit_engine_event(
                    &app,
                    EngineRuntimeEvent::Info {
                        fen: fen.clone(),
                        line: analysis_line_from_engine_info(&board, info),
                    },
                );
            }
            Ok(_) => {}
            Err(error) => {
                state.engine.lock().await.remove(&resolved_engine_path_text);
                if state.play_generation.load(Ordering::SeqCst) != play_generation {
                    play.state = EngineRuntimeState::Stopping;
                    slot.take();
                    return Err("引擎对弈已停止，本次输出已丢弃".into());
                }
                play.state = EngineRuntimeState::Faulted;
                emit_engine_state(&app, play.state);
                emit_engine_event(
                    &app,
                    EngineRuntimeEvent::Error {
                        message: error.to_string(),
                    },
                );
                slot.take();
                return Err(error.to_string());
            }
        }
    };
    state.engine.lock().await.remove(&resolved_engine_path_text);
    let board_before_best = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let best_move =
        normalize_engine_move_for_board(&board_before_best, &best_move).unwrap_or(best_move);
    let board_after_best = Move::from_iccs(&best_move)
        .ok()
        .and_then(|mv| board_before_best.apply_move(mv).ok());
    let ponder_move = ponder_move.and_then(|predicted| {
        board_after_best
            .as_ref()
            .and_then(|board| normalize_engine_move_for_board(board, &predicted))
            .or(Some(predicted))
    });
    let predicted_fen = if ponder {
        ponder_move.as_deref().and_then(|predicted| {
            let board = board_before_best.clone();
            let best = Move::from_iccs(&best_move).ok()?;
            let board = board.apply_move(best).ok()?;
            let predicted = Move::from_iccs(predicted).ok()?;
            board.apply_move(predicted).ok().map(|board| board.to_fen())
        })
    } else {
        None
    };
    let board = {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        if model.game_id != expected_game
            || model.current_node != expected_node
            || model.board.to_fen() != fen
            || state.play_generation.load(Ordering::SeqCst) != play_generation
        {
            play.state = EngineRuntimeState::Stopping;
            emit_engine_state(&app, play.state);
            return Err("引擎完成前棋盘已变化，本次着法已丢弃".into());
        }
        commit_move(&mut model, &best_move)?
    };
    let rule_blocks_play = matches!(
        board.rule_verdict,
        "checkmate"
            | "stalemate"
            | "drawByNaturalLimit"
            | "pendingRepetition"
            | "pendingAsianRepetition"
            | "lossByPerpetualCheck"
            | "lossByPerpetualChase"
            | "drawByRepetitionMvp"
    );
    let ponder_move = if rule_blocks_play { None } else { ponder_move };
    let predicted_fen = if rule_blocks_play {
        None
    } else {
        predicted_fen
    };
    emit_engine_event(
        &app,
        EngineRuntimeEvent::Bestmove {
            fen,
            best: best_move.clone(),
            ponder: ponder_move.clone(),
        },
    );
    if let Some(predicted_fen) = predicted_fen {
        play.session
            .search(
                &predicted_fen,
                &[],
                SearchLimit::MoveTime(move_time_ms.clamp(100, 30_000)),
                &[],
                true,
            )
            .await
            .map_err(|error| error.to_string())?;
        play.pondering_fen = Some(predicted_fen);
        play.state = EngineRuntimeState::Pondering;
    } else {
        play.state = EngineRuntimeState::Idle;
    }
    emit_engine_state(&app, play.state);
    Ok(EngineMoveDto {
        board,
        ponder: ponder_move,
    })
}

#[tauri::command]
pub(crate) async fn stop_engine_play(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<bool, String> {
    state.play_generation.fetch_add(1, Ordering::SeqCst);
    emit_engine_state(&app, EngineRuntimeState::Stopping);
    for control in state
        .engine
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>()
    {
        let _ = control.stop().await;
    }
    let mut slot = state.play_session.lock().await;
    let should_close = slot.as_ref().is_some_and(|runtime| {
        runtime.pondering_fen.is_some() || !matches!(runtime.state, EngineRuntimeState::Idle)
    });
    if !should_close {
        emit_engine_state(&app, EngineRuntimeState::Idle);
        return Ok(false);
    }
    if let Some(play) = slot.take() {
        state.engine.lock().await.clear();
        play.session
            .close()
            .await
            .map_err(|error| error.to_string())?;
        emit_engine_state(&app, EngineRuntimeState::Idle);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) async fn move_now(state: State<'_, DesktopState>) -> Result<bool, String> {
    let control = state.engine.lock().await.values().next().cloned();
    if let Some(control) = control {
        control.stop().await.map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) fn detect_pikafish(app: tauri::AppHandle) -> Option<String> {
    if bundled_pikafish_path(&app).is_some() {
        return Some(BUILTIN_ENGINE_PATH.into());
    }
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

pub(crate) fn bundled_pikafish_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(pikafish_candidates(&resource_dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(pikafish_candidates(parent));
            candidates.extend(pikafish_candidates(&parent.join("../Resources")));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

pub(crate) fn pikafish_candidates(base: &Path) -> Vec<PathBuf> {
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

pub(crate) fn resolve_engine_path(app: &tauri::AppHandle, value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed == BUILTIN_ENGINE_PATH {
        return bundled_pikafish_path(app)
            .or_else(|| {
                std::env::var_os("PIKAFISH_PATH")
                    .map(PathBuf::from)
                    .filter(|path| path.is_file())
            })
            .ok_or_else(|| {
                "安装包内未找到内置 Pikafish；开发模式请设置 PIKAFISH_PATH，或手动选择外部引擎"
                    .to_owned()
            });
    }
    Err("当前版本仅支持随应用安装的内置 Pikafish".into())
}

pub(crate) fn preferred_nnue_path(engine_path: &Path) -> Option<PathBuf> {
    let path = engine_path.parent()?.join("pikafish.nnue");
    path.is_file().then_some(path)
}

pub(crate) async fn configure_engine_nnue(
    session: &mut EngineSession,
    engine_path: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(nnue_path) = preferred_nnue_path(engine_path) else {
        return Ok(None);
    };
    let nnue_sha256 = file_sha256(&nnue_path)?;
    if nnue_sha256 != PIKAFISH_260720_NNUE_SHA256 {
        return Err(format!(
            "Pikafish NNUE 哈希不匹配：期望 {PIKAFISH_260720_NNUE_SHA256}，实际 {nnue_sha256}"
        ));
    }
    session
        .configure("EvalFile", &nnue_path.to_string_lossy())
        .await
        .map_err(|error| format!("Pikafish 未能加载 NNUE {}：{error}", nnue_path.display()))?;
    Ok(Some(nnue_path))
}

pub(crate) fn normalize_engine_move_for_board(board: &Board, value: &str) -> Option<String> {
    Move::from_iccs(value)
        .ok()
        .filter(|mv| board.apply_move(*mv).is_ok())
        .map(|_| value.to_owned())
}

pub(crate) fn normalize_engine_pv_for_board(board: &Board, pv: &[String]) -> Vec<String> {
    let mut current = board.clone();
    let mut normalized = Vec::with_capacity(pv.len());
    for raw in pv {
        let Some(candidate) = normalize_engine_move_for_board(&current, raw) else {
            normalized.push(raw.clone());
            break;
        };
        let Ok(mv) = Move::from_iccs(&candidate) else {
            normalized.push(raw.clone());
            break;
        };
        let Ok(next) = current.apply_move(mv) else {
            normalized.push(raw.clone());
            break;
        };
        normalized.push(candidate);
        current = next;
    }
    normalized
}

pub(crate) fn normalize_pv_and_notation(
    board: &Board,
    pv: &[String],
) -> (Vec<String>, Vec<String>) {
    let notation = board.chinese_pv_notation(pv).unwrap_or_default();
    (pv.to_vec(), notation)
}

pub(crate) fn analysis_line_from_engine_info(
    board: &Board,
    info: engine_protocol::EngineInfo,
) -> AnalysisLine {
    let pv = normalize_engine_pv_for_board(board, &info.pv);
    AnalysisLine {
        depth: info.depth,
        score_cp: info.score_cp,
        mate: info.mate,
        nps: info.nps,
        time_ms: info.time_ms,
        hashfull: info.hashfull,
        multipv: info.multipv,
        notation: board.chinese_pv_notation(&pv).unwrap_or_default(),
        pv,
    }
}

pub(crate) async fn configure_engine_for_xiangqi(
    session: &mut EngineSession,
    engine_path: &Path,
) -> Result<Option<PathBuf>, String> {
    configure_engine_nnue(session, engine_path).await
}

pub(crate) async fn next_arena_bestmove(
    session: &mut EngineSession,
    board: &Board,
    move_time_ms: u64,
) -> Result<String, String> {
    session
        .search(
            &board.to_fen(),
            &[],
            SearchLimit::MoveTime(move_time_ms.clamp(100, 30_000)),
            &[],
            false,
        )
        .await
        .map_err(|error| error.to_string())?;
    let search = async {
        loop {
            match session
                .next_event()
                .await
                .map_err(|error| error.to_string())?
            {
                EngineEvent::BestMove { best, .. } => {
                    let best = normalize_engine_move_for_board(board, &best)
                        .ok_or_else(|| format!("引擎返回非法着法：{best}"))?;
                    return Ok(best);
                }
                _ => {}
            }
        }
    };
    timeout(
        Duration::from_millis(move_time_ms.clamp(100, 30_000) + 5_000),
        search,
    )
    .await
    .map_err(|_| "引擎搜索超时".to_owned())?
}

pub(crate) async fn launch_arena_engine(
    app: &tauri::AppHandle,
    player: &EngineArenaPlayerDto,
    threads: u32,
    hash_mb: u32,
) -> Result<EngineSession, String> {
    let path = resolve_engine_path(app, &player.engine_path)?;
    let mut session = EngineSession::launch(&path, Duration::from_secs(3))
        .await
        .map_err(|error| format!("{} 启动失败：{error}", player.name))?;
    configure_engine_for_xiangqi(&mut session, &path).await?;
    session
        .configure("Threads", &threads.clamp(1, 64).to_string())
        .await
        .map_err(|error| format!("{} 设置线程失败：{error}", player.name))?;
    session
        .configure("Hash", &hash_mb.clamp(16, 4096).to_string())
        .await
        .map_err(|error| format!("{} 设置 Hash 失败：{error}", player.name))?;
    session
        .configure("MultiPV", "1")
        .await
        .map_err(|error| format!("{} 设置 MultiPV 失败：{error}", player.name))?;
    Ok(session)
}

pub(crate) fn arena_score(name: &str, games: &[EngineArenaGameDto]) -> EngineArenaScoreDto {
    let mut wins = 0;
    let mut draws = 0;
    let mut losses = 0;
    for game in games {
        match game.winner.as_deref() {
            Some(winner) if winner == name => wins += 1,
            Some(_) => losses += 1,
            None => draws += 1,
        }
    }
    EngineArenaScoreDto {
        name: name.to_owned(),
        wins,
        draws,
        losses,
        points: wins as f32 + draws as f32 * 0.5,
    }
}

pub(crate) fn arena_rule_outcome(
    verdict: RuleVerdict,
    mode: RuleMode,
    red: &EngineArenaPlayerDto,
    black: &EngineArenaPlayerDto,
) -> Option<(String, Option<String>, String)> {
    let loser = match verdict {
        RuleVerdict::Checkmate { loser }
        | RuleVerdict::Stalemate { loser }
        | RuleVerdict::LossByPerpetualCheck { loser }
        | RuleVerdict::LossByPerpetualChase { loser } => Some(loser),
        RuleVerdict::DrawByNaturalLimit => {
            return Some(("1/2-1/2".into(), None, rule_reason(verdict, mode)));
        }
        RuleVerdict::PendingRepetition => {
            return Some((
                "1/2-1/2".into(),
                None,
                rule_reason(RuleVerdict::DrawByRepetitionMvp, mode),
            ));
        }
        RuleVerdict::PendingAsianRepetition => {
            return Some((
                "1/2-1/2".into(),
                None,
                "亚洲规则复杂待判，MVP 按和棋计".into(),
            ));
        }
        RuleVerdict::DrawByRepetitionMvp => {
            return Some(("1/2-1/2".into(), None, rule_reason(verdict, mode)));
        }
        RuleVerdict::Ongoing | RuleVerdict::Check => None,
    }?;
    let (result, winner) = match loser {
        Color::Red => ("0-1".to_owned(), black.name.clone()),
        Color::Black => ("1-0".to_owned(), red.name.clone()),
    };
    Some((result, Some(winner), rule_reason(verdict, mode)))
}

pub(crate) async fn run_arena_game(
    app: &tauri::AppHandle,
    options: &EngineArenaOptionsDto,
    rule_mode: RuleMode,
    index: u32,
    swap_sides: bool,
) -> Result<EngineArenaGameDto, String> {
    let red = if swap_sides {
        &options.player_b
    } else {
        &options.player_a
    };
    let black = if swap_sides {
        &options.player_a
    } else {
        &options.player_b
    };
    let mut red_session = launch_arena_engine(app, red, options.threads, options.hash_mb).await?;
    let mut black_session =
        launch_arena_engine(app, black, options.threads, options.hash_mb).await?;
    let mut board = Board::from_fen(STARTING_FEN).map_err(|error| error.to_string())?;
    let mut rule_state = DomesticRuleState::new(&board);
    let mut moves = Vec::new();
    let mut result = "1/2-1/2".to_owned();
    let mut winner = None;
    let mut reason = "达到半回合上限，按和棋计".to_owned();

    for ply in 0..options.max_plies.clamp(20, 240) {
        let red_turn = ply % 2 == 0;
        let current_name = if red_turn { &red.name } else { &black.name };
        let current_session = if red_turn {
            &mut red_session
        } else {
            &mut black_session
        };
        let best = match next_arena_bestmove(current_session, &board, options.move_time_ms).await {
            Ok(best) => best,
            Err(error) => {
                let opponent = if red_turn { &black.name } else { &red.name };
                result = if red_turn { "0-1" } else { "1-0" }.to_owned();
                winner = Some(opponent.clone());
                reason = format!("{current_name} 搜索失败：{error}");
                break;
            }
        };
        let notation = board
            .chinese_pv_notation(std::slice::from_ref(&best))
            .ok()
            .and_then(|items| items.into_iter().next())
            .unwrap_or_else(|| best.clone());
        let mv = Move::from_iccs(&best).map_err(|error| error.to_string())?;
        let before = board.clone();
        board = match board.apply_move(mv) {
            Ok(next) => next,
            Err(_) => {
                let opponent = if red_turn { &black.name } else { &red.name };
                result = if red_turn { "0-1" } else { "1-0" }.to_owned();
                winner = Some(opponent.clone());
                reason = format!("{current_name} 返回非法着法 {best}");
                break;
            }
        };
        moves.push(format!(
            "{}{}",
            if red_turn { "红 " } else { "黑 " },
            notation
        ));
        rule_state
            .record_applied_move(&before, mv, &board)
            .map_err(|error| error.to_string())?;
        let verdict = rule_state.evaluate_with_mode(&board, rule_mode);
        if let Some(outcome) = arena_rule_outcome(verdict, rule_mode, red, black) {
            result = outcome.0;
            winner = outcome.1;
            reason = outcome.2;
            break;
        }
    }

    let _ = red_session.close().await;
    let _ = black_session.close().await;
    Ok(EngineArenaGameDto {
        index,
        red: red.name.clone(),
        black: black.name.clone(),
        result,
        winner,
        reason,
        plies: moves.len() as u32,
        moves,
    })
}

#[tauri::command]
pub(crate) async fn run_engine_arena(
    options: EngineArenaOptionsDto,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<EngineArenaResultDto, String> {
    if state.report_running.load(Ordering::SeqCst) {
        return Err("整局报告正在生成，请先取消报告分析".into());
    }
    if !state.engine.lock().await.is_empty() {
        return Err("引擎正在执行其他搜索，请先停止".into());
    }
    if options.player_a.engine_path == options.player_b.engine_path {
        return Err("擂台需要选择两个不同的引擎".into());
    }
    let rule_mode = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        rule_mode_from_code(&preferences.rule_mode)
    };
    let games_to_play = options.games.clamp(2, 20);
    let mut games = Vec::with_capacity(games_to_play as usize);
    for index in 0..games_to_play {
        games.push(run_arena_game(&app, &options, rule_mode, index + 1, index % 2 == 1).await?);
    }
    let player_a = arena_score(&options.player_a.name, &games);
    let player_b = arena_score(&options.player_b.name, &games);
    let summary = if player_a.points > player_b.points {
        format!(
            "{} 暂时领先，{} - {}",
            player_a.name, player_a.points, player_b.points
        )
    } else if player_b.points > player_a.points {
        format!(
            "{} 暂时领先，{} - {}",
            player_b.name, player_b.points, player_a.points
        )
    } else {
        format!("双方暂时打平，{} - {}", player_a.points, player_b.points)
    };
    Ok(EngineArenaResultDto {
        player_a,
        player_b,
        games,
        move_time_ms: options.move_time_ms.clamp(100, 30_000),
        max_plies: options.max_plies.clamp(20, 240),
        rule_name: rule_mode.name(),
        summary,
    })
}

pub(crate) fn rule_mode_from_code(value: &str) -> RuleMode {
    match value {
        "asianAxf" => RuleMode::AsianAxf,
        _ => RuleMode::Domestic2020,
    }
}

pub(crate) fn normalize_rule_mode(value: &str) -> String {
    rule_mode_from_code(value).code().into()
}

pub(crate) fn validate_server_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value.trim()).map_err(|_| "同步服务地址格式不正确")?;
    let host = url.host_str().ok_or("同步服务地址缺少主机名")?;
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("非本机同步服务必须使用 HTTPS".into());
    }
    Ok(())
}

pub(crate) fn normalize_desktop_preferences(preferences: &mut DesktopPreferences) {
    let legacy_analysis_defaults =
        (matches!(preferences.search_mode.as_str(), "time" | "infinite")
            && preferences.search_value == 1500)
            || (preferences.search_mode == "depth"
                && (preferences.search_value == 30 || preferences.search_value == 26));
    if matches!(preferences.search_mode.as_str(), "time" | "infinite")
        && preferences.search_value == 1500
    {
        preferences.search_mode = "depth".into();
        preferences.search_value = 24;
    }
    if preferences.search_mode == "depth"
        && (preferences.search_value == 30 || preferences.search_value == 26)
    {
        preferences.search_value = 24;
    }
    if preferences.candidate_line_moves == 6 {
        preferences.candidate_line_moves = 16;
    }
    if preferences.candidate_line_moves < 10 || preferences.candidate_line_moves > 16 {
        preferences.candidate_line_moves = 16;
    }
    if preferences.multipv < 1 {
        preferences.multipv = 2;
    }
    if preferences.report_depth == 30 || preferences.report_depth == 26 {
        preferences.report_depth = 24;
    }
    if legacy_analysis_defaults && preferences.auto_analyze {
        preferences.auto_analyze = false;
    }
    preferences.link_confidence_threshold = (effective_link_confidence_threshold(
        preferences.link_confidence_threshold,
    ) * 100.0)
        .round() as u8;
    preferences.engine_path = BUILTIN_ENGINE_PATH.into();
    preferences.active_engine_id = None;
    preferences.analysis_engine_mode = "single".into();
    preferences.parallel_engine_ids.clear();
    preferences.board_skin = normalize_skin_id(&preferences.board_skin);
    preferences.piece_skin = normalize_skin_id(&preferences.piece_skin);
    preferences.parallel_engine_paths.clear();
    preferences.rule_mode = normalize_rule_mode(&preferences.rule_mode);
    preferences.active_builtin_opening_book_id =
        pfbook_opening_book::normalize_book_id(&preferences.active_builtin_opening_book_id);
}

pub(crate) fn normalize_skin_id(value: &str) -> String {
    match value {
        "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun" => value.to_owned(),
        _ => "default".into(),
    }
}

pub(crate) fn validate_preferences(preferences: &DesktopPreferences) -> Result<(), String> {
    if !matches!(preferences.color_theme.as_str(), "light" | "dark") {
        return Err("不支持的颜色主题".into());
    }
    if !matches!(
        preferences.workspace_panel.as_str(),
        "moves" | "analysis" | "trend" | "summary" | "report"
    ) {
        return Err("不支持的工作区页面".into());
    }
    if !matches!(preferences.layout_mode.as_str(), "studio" | "compact") {
        return Err("不支持的工作台布局".into());
    }
    if !matches!(preferences.manual_view_mode.as_str(), "track" | "tree") {
        return Err("不支持的棋谱显示方式".into());
    }
    if !matches!(preferences.rule_mode.as_str(), "domestic2020" | "asianAxf") {
        return Err("不支持的棋规模式".into());
    }
    if !matches!(
        preferences.link_capture_source.as_str(),
        "windowLink" | "desktopDetect" | "imageImport" | "cameraBoard"
    ) {
        return Err("不支持的连线局面来源".into());
    }
    if !matches!(
        preferences.link_recognition_mode.as_str(),
        "yoloBoard" | "perspectiveGrid"
    ) {
        return Err("不支持的连线识别模式".into());
    }
    if !matches!(
        preferences.link_mode.as_str(),
        "spectate" | "confirmPlay" | "autoPlay"
    ) {
        return Err("不支持的连线模式".into());
    }
    if !(1..=5).contains(&preferences.link_stable_frames) {
        return Err("连线稳定帧必须在 1 到 5 之间".into());
    }
    if !(10..=100).contains(&preferences.link_confidence_threshold) {
        return Err("连线识别置信度必须在 10% 到 100% 之间".into());
    }
    if !matches!(
        preferences.board_skin.as_str(),
        "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun"
    ) {
        return Err("不支持的棋盘皮肤".into());
    }
    if !matches!(
        preferences.piece_skin.as_str(),
        "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun"
    ) {
        return Err("不支持的棋子皮肤".into());
    }
    if !matches!(
        preferences.branch_arrow_color.as_str(),
        "#2f80ed" | "#f2c94c" | "#27ae60" | "#9b51e0" | "#eb5757"
    ) {
        return Err("不支持的分支箭头颜色".into());
    }
    if !(1..=64).contains(&preferences.threads) {
        return Err("线程数必须在 1 到 64 之间".into());
    }
    if !(16..=4096).contains(&preferences.hash_mb) {
        return Err("Hash 必须在 16 到 4096 MB 之间".into());
    }
    if preferences.multipv < 1 {
        return Err("候选走法必须至少为 1 种".into());
    }
    if !(10..=16).contains(&preferences.candidate_line_moves) {
        return Err("每种后续必须在 5 到 8 个回合之间".into());
    }
    if !(100..=30_000).contains(&preferences.move_time_ms) {
        return Err("每步时间必须在 100 到 30000 毫秒之间".into());
    }
    if !(8..=40).contains(&preferences.report_depth) {
        return Err("整局复盘深度必须在 8 到 40 层之间".into());
    }
    if !matches!(
        preferences.search_mode.as_str(),
        "time" | "depth" | "nodes" | "infinite"
    ) {
        return Err("不支持的搜索模式".into());
    }
    if !matches!(
        preferences.analysis_engine_mode.as_str(),
        "single" | "parallel"
    ) {
        return Err("不支持的多引擎分析模式".into());
    }
    if !pfbook_opening_book::is_known_book_id(&preferences.active_builtin_opening_book_id) {
        return Err("不支持的内嵌开局库".into());
    }
    let limit_valid = match preferences.search_mode.as_str() {
        "time" => (100..=30_000).contains(&preferences.search_value),
        "depth" => (1..=100).contains(&preferences.search_value),
        "nodes" => (1_000..=100_000_000).contains(&preferences.search_value),
        "infinite" => true,
        _ => false,
    };
    if !limit_valid {
        return Err("搜索限制超出允许范围".into());
    }
    let cloud_url =
        reqwest::Url::parse(&preferences.cloud_book_url).map_err(|_| "云库地址格式不正确")?;
    if cloud_url.scheme() != "https" {
        return Err("云库地址必须使用 HTTPS".into());
    }
    validate_server_url(&preferences.server_url)
}

pub(crate) fn is_account_skin(value: &str) -> bool {
    matches!(value, "jingdian" | "xinghe")
}

pub(crate) fn validate_skin_access(
    current: &DesktopPreferences,
    preferences: &DesktopPreferences,
    signed_in: bool,
) -> Result<(), String> {
    if signed_in {
        return Ok(());
    }
    let selected_locked_board =
        is_account_skin(&preferences.board_skin) && preferences.board_skin != current.board_skin;
    let selected_locked_piece =
        is_account_skin(&preferences.piece_skin) && preferences.piece_skin != current.piece_skin;
    if selected_locked_board || selected_locked_piece {
        return Err("登录同步账号后才能使用登录专享皮肤".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_desktop_preferences(
    state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let before_normalize = preferences.clone();
    normalize_desktop_preferences(&mut preferences);
    if preferences != before_normalize {
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    Ok(preferences)
}

#[tauri::command]
pub(crate) fn save_desktop_preferences(
    mut preferences: DesktopPreferences,
    state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    normalize_desktop_preferences(&mut preferences);
    validate_preferences(&preferences)?;
    let signed_in = sync_account_dto(&state)?.status == "signedIn";
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let current = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    validate_skin_access(&current, &preferences, signed_in)?;
    if model
        .store
        .sync_account_binding()
        .map_err(|error| error.to_string())?
        .is_some()
        && current.server_url.trim_end_matches('/') != preferences.server_url.trim_end_matches('/')
    {
        return Err("本地棋谱库已绑定账号，不能修改同步服务地址".into());
    }
    model
        .store
        .save_desktop_preferences(&preferences)
        .map_err(|error| error.to_string())?;
    Ok(preferences)
}

#[tauri::command]
pub(crate) fn list_builtin_opening_books()
-> Result<pfbook_opening_book::BuiltinOpeningBookManifestDto, String> {
    pfbook_opening_book::manifest()
}

#[tauri::command]
pub(crate) async fn probe_engine(
    path: String,
    app: tauri::AppHandle,
) -> Result<EngineProbeDto, String> {
    let resolved_path = resolve_engine_path(&app, &path)?;
    let mut session = EngineSession::launch(&resolved_path, Duration::from_secs(5))
        .await
        .map_err(|error| format!("引擎握手失败：{error}"))?;
    let protocol = protocol_name(session.protocol());
    configure_engine_for_xiangqi(&mut session, &resolved_path).await?;
    let _ = session.close().await;
    let nnue_path = preferred_nnue_path(&resolved_path);
    let nnue_file = nnue_path
        .as_deref()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned);
    let nnue_sha256 = nnue_path.as_deref().map(file_sha256).transpose()?;
    let (engine_version, nnue_version) = probe_pikafish_runtime_metadata(&resolved_path).await;
    let nnue_version = decorate_known_pikafish_nnue_version(nnue_sha256.as_deref(), nnue_version);
    Ok(EngineProbeDto {
        path: match path.trim() {
            BUILTIN_ENGINE_PATH => BUILTIN_ENGINE_PATH.into(),
            _ => resolved_path.to_string_lossy().into_owned(),
        },
        protocol,
        engine_version,
        engine_sha256: Some(file_sha256(&resolved_path)?),
        nnue_file,
        nnue_version,
        nnue_sha256,
        fingerprint: report_engine_fingerprint(&resolved_path).ok(),
    })
}

#[tauri::command]
pub(crate) fn list_engine_profiles(
    state: State<'_, DesktopState>,
) -> Result<Vec<EngineProfileDto>, String> {
    let _ = state;
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn register_engine_profile(
    _name: String,
    _path: String,
    _app: tauri::AppHandle,
    _state: State<'_, DesktopState>,
) -> Result<EngineProfileDto, String> {
    Err("当前版本仅支持随应用安装的内置 Pikafish".into())
}

#[tauri::command]
pub(crate) fn set_active_engine_profile(
    _id: Uuid,
    _state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    Err("当前版本仅支持随应用安装的内置 Pikafish".into())
}

#[tauri::command]
pub(crate) fn delete_engine_profile(
    id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    model
        .store
        .delete_engine_profile(id)
        .map_err(|error| error.to_string())?;
    if preferences.active_engine_id == Some(id) {
        preferences.active_engine_id = None;
        // Removing an external active profile must leave the workspace with a
        // usable engine, rather than an empty path that ignores later analysis.
        preferences.engine_path = BUILTIN_ENGINE_PATH.into();
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    Ok(preferences)
}

#[tauri::command]
pub(crate) async fn query_cloud_opening_book(
    fen: String,
    state: State<'_, DesktopState>,
) -> Result<Vec<cloud_opening_book::CloudBookCandidateDto>, String> {
    let (enabled, url) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        (preferences.cloud_book_enabled, preferences.cloud_book_url)
    };
    if !enabled {
        return Ok(Vec::new());
    }
    let key = format!("{url}\n{fen}");
    if let Some(mut cached) = state
        .cloud_book_cache
        .lock()
        .map_err(|_| "cache lock poisoned".to_owned())?
        .get(&key)
        .cloned()
    {
        for candidate in &mut cached {
            candidate.cached = true;
        }
        return Ok(cached);
    }
    let candidates = cloud_opening_book::query(&url, &fen).await?;
    state
        .cloud_book_cache
        .lock()
        .map_err(|_| "cache lock poisoned".to_owned())?
        .insert(key, candidates.clone());
    Ok(candidates)
}
