use super::*;
use crate::engine_service::{
    analysis_line_from_engine_info, configure_engine_for_xiangqi, normalize_pv_and_notation,
    preferred_nnue_path, resolve_engine_path,
};

pub(crate) fn report_line_nodes(
    tree: &ManualTree,
    current_node: Option<Uuid>,
) -> Result<Vec<MoveNode>, String> {
    let mut nodes: Vec<MoveNode> = current_node
        .map(|node_id| {
            tree.active_line(node_id)
                .map(|line| line.into_iter().cloned().collect())
        })
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let mut parent = current_node.unwrap_or_else(|| tree.root_id());
    loop {
        let branches = tree.branches(parent).map_err(|error| error.to_string())?;
        let next = branches
            .iter()
            .find(|node| node.is_mainline)
            .or_else(|| branches.first())
            .copied();
        let Some(next) = next else { break };
        nodes.push(next.clone());
        parent = next.id;
    }
    Ok(nodes)
}

pub(crate) fn report_line_signature(
    tree: &ManualTree,
    current_node: Option<Uuid>,
) -> Result<String, String> {
    let mut ids = vec![tree.root_id().to_string()];
    ids.extend(
        report_line_nodes(tree, current_node)?
            .into_iter()
            .map(|node| node.id.to_string()),
    );
    Ok(ids.join(":"))
}

pub(crate) fn report_material(board: &Board) -> u32 {
    let mut total = 0;
    for row in 0..10 {
        for col in 0..9 {
            let Some(piece) = board.piece_at(Square { row, col }) else {
                continue;
            };
            total += match piece.kind {
                PieceKind::King => 0,
                PieceKind::Rook => 500,
                PieceKind::Horse | PieceKind::Cannon => 250,
                PieceKind::Advisor | PieceKind::Elephant => 120,
                PieceKind::Pawn => 70,
            };
        }
    }
    total
}

pub(crate) fn report_phase(ply: usize, material: u32) -> &'static str {
    if material <= 2547 || ply > 80 {
        "endgame"
    } else if ply <= 20 {
        "opening"
    } else {
        "middle"
    }
}

pub(crate) fn fen_starting_ply(fen: &str) -> usize {
    let fields = fen.split_whitespace().collect::<Vec<_>>();
    let fullmove = fields
        .get(5)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    (fullmove - 1) * 2 + usize::from(fields.get(1) == Some(&"b"))
}

pub(crate) fn terminal_report_mate(board: &Board) -> Option<i32> {
    (board.status() == GameStatus::Checkmate).then_some(-1)
}

pub(crate) fn update_fingerprint(hasher: &mut Sha256, path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("无法读取引擎或 NNUE 文件：{error}"))?;
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法读取引擎或 NNUE 文件：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(())
}

pub(crate) fn file_sha256(path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    update_fingerprint(&mut hasher, path)?;
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn report_engine_fingerprint(engine_path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(b"engine\0");
    update_fingerprint(&mut hasher, engine_path)?;

    if let Some(path) = preferred_nnue_path(engine_path) {
        hasher.update(b"nnue\0");
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            hasher.update(name.as_bytes());
        }
        hasher.update(b"\0");
        update_fingerprint(&mut hasher, &path)?;
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub(crate) async fn probe_pikafish_runtime_metadata(
    engine_path: &Path,
) -> (Option<String>, Option<String>) {
    let mut command = Command::new(engine_path);
    command
        .arg("bench")
        .arg("1")
        .current_dir(engine_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.as_std_mut().creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let Ok(mut child) = command.spawn() else {
        return (None, None);
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return (None, None);
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut engine_version = None;
    let mut nnue_version = None;
    let _ = timeout(Duration::from_secs(3), async {
        while let Some(line) = lines.next_line().await? {
            let trimmed = line.trim();
            if engine_version.is_none() {
                engine_version = parse_pikafish_version_line(trimmed);
            }
            if nnue_version.is_none() {
                nnue_version = parse_pikafish_nnue_metadata_line(trimmed);
            }
            if engine_version.is_some() && nnue_version.is_some() {
                break;
            }
        }
        Ok::<(), std::io::Error>(())
    })
    .await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    (engine_version, nnue_version)
}

pub(crate) fn parse_pikafish_version_line(line: &str) -> Option<String> {
    line.trim().strip_prefix("Pikafish ").map(|_| {
        line.trim()
            .split(" by ")
            .next()
            .unwrap_or(line.trim())
            .to_owned()
    })
}

pub(crate) fn parse_pikafish_nnue_metadata_line(line: &str) -> Option<String> {
    let metadata = line
        .trim()
        .strip_prefix("info string NNUE evaluation using ")?;
    metadata
        .split_once(' ')
        .map(|(_, version)| version.trim().to_owned())
}

pub(crate) fn decorate_known_pikafish_nnue_version(
    nnue_sha256: Option<&str>,
    runtime_version: Option<String>,
) -> Option<String> {
    match (nnue_sha256, runtime_version) {
        (Some(PIKAFISH_260720_NNUE_SHA256), Some(version))
            if !version.contains(PIKAFISH_260720_NNUE_LABEL) =>
        {
            Some(format!("{PIKAFISH_260720_NNUE_LABEL} · {version}"))
        }
        (Some(PIKAFISH_260720_NNUE_SHA256), None) => Some(PIKAFISH_260720_NNUE_LABEL.to_owned()),
        (_, version) => version,
    }
}

pub(crate) fn report_side(board: &Board) -> String {
    if board.side_to_move() == Color::Red {
        "红方"
    } else {
        "黑方"
    }
    .into()
}

pub(crate) fn report_positions(
    model: &AppModel,
) -> Result<(String, Vec<GameReportPositionDto>), String> {
    let nodes = report_line_nodes(&model.tree, model.current_node)?;
    let signature = report_line_signature(&model.tree, model.current_node)?;
    let mut board = Board::from_fen(&model.starting_fen).map_err(|error| error.to_string())?;
    let starting_ply = fen_starting_ply(&model.starting_fen);
    let root_material = report_material(&board);
    let mut positions = vec![GameReportPositionDto {
        fen: board.to_fen(),
        side_to_move: report_side(&board),
        ply: starting_ply,
        phase: report_phase(starting_ply, root_material).into(),
        material: root_material,
        score_cp: None,
        mate: None,
        depth: None,
        elapsed_ms: None,
        cached: false,
        best_iccs: None,
        best_notation: None,
        pv_notation: Vec::new(),
        opening: None,
        master_style_hints: Vec::new(),
        move_: None,
    }];
    for (index, node) in nodes.iter().enumerate() {
        let notation = board
            .chinese_move_notation(node.mv)
            .map_err(|error| error.to_string())?;
        let moved_by = if board.side_to_move() == Color::Red {
            "红方"
        } else {
            "黑方"
        };
        board = board
            .apply_move(node.mv)
            .map_err(|error| error.to_string())?;
        let material = report_material(&board);
        positions.push(GameReportPositionDto {
            fen: board.to_fen(),
            side_to_move: report_side(&board),
            ply: starting_ply + index + 1,
            phase: report_phase(starting_ply + index + 1, material).into(),
            material,
            score_cp: None,
            mate: None,
            depth: None,
            elapsed_ms: None,
            cached: false,
            best_iccs: None,
            best_notation: None,
            pv_notation: Vec::new(),
            opening: None,
            master_style_hints: Vec::new(),
            move_: Some(GameReportMoveDto {
                node_id: node.id,
                iccs: node.mv.to_iccs(),
                notation,
                moved_by: moved_by.into(),
            }),
        });
    }
    Ok((signature, positions))
}

pub(crate) fn emit_report_progress(app: &tauri::AppHandle, progress: GameReportProgressDto) {
    let _ = app.emit("game-report-progress", progress);
}

pub(crate) fn apply_report_line_to_position(
    position: &mut GameReportPositionDto,
    line: &AnalysisLine,
    cached: bool,
) -> Result<(), String> {
    let position_board = Board::from_fen(&position.fen).map_err(|error| error.to_string())?;
    let (pv, notation) = if line.pv.is_empty() {
        (Vec::new(), Vec::new())
    } else if line.notation.is_empty() {
        normalize_pv_and_notation(&position_board, &line.pv)
    } else {
        (line.pv.clone(), line.notation.clone())
    };
    position.score_cp = line.score_cp;
    position.mate = line.mate;
    position.depth = line.depth;
    position.elapsed_ms = line.time_ms;
    position.cached = cached;
    position.best_iccs = pv.first().cloned();
    position.best_notation = notation.first().cloned();
    position.pv_notation = notation.into_iter().take(12).collect();
    Ok(())
}

pub(crate) fn report_estimated_remaining_ms(
    elapsed_ms: u64,
    completed: usize,
    cached: usize,
    total: usize,
) -> Option<u64> {
    let searched = completed.saturating_sub(cached);
    if searched == 0 || completed >= total {
        return None;
    }
    Some(elapsed_ms / searched as u64 * (total - completed) as u64)
}

pub(crate) async fn wait_for_engine_idle(state: &DesktopState, duration: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + duration;
    loop {
        if state.engine.lock().await.is_empty() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tauri::command]
pub(crate) async fn stop_analysis(
    discard_result: bool,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<bool, String> {
    if discard_result {
        state.analysis_generation.fetch_add(1, Ordering::SeqCst);
    }
    let controls = state
        .engine
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    if !controls.is_empty() {
        emit_engine_state(&app, EngineRuntimeState::Stopping);
        for control in controls {
            control.stop().await.map_err(|error| error.to_string())?;
        }
        state.engine.lock().await.clear();
        emit_engine_state(&app, EngineRuntimeState::Idle);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) fn get_saved_analysis(
    state: State<'_, DesktopState>,
) -> Result<Vec<AnalysisLine>, String> {
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
            let (pv, notation) = normalize_pv_and_notation(&model.board, &line.pv);
            line.pv = pv;
            line.notation = notation;
        }
    }
    Ok(lines)
}

pub(crate) async fn generate_game_report_inner(
    engine_path: String,
    report_depth: u32,
    threads: u32,
    hash_mb: u32,
    generation: u64,
    app: &tauri::AppHandle,
    state: &DesktopState,
) -> Result<GameReportDatasetDto, String> {
    let resolved_engine_path = resolve_engine_path(app, &engine_path)?;
    let resolved_engine_path_text = resolved_engine_path.to_string_lossy().into_owned();
    let engine_fingerprint = report_engine_fingerprint(&resolved_engine_path)?;
    let report_depth = report_depth.clamp(8, 40);
    let limit = SearchLimit::Depth(report_depth);
    let threads = threads.clamp(1, 64);
    let hash_mb = hash_mb.clamp(16, 4096);
    let config_hash = format!(
        "report:engine:{engine_fingerprint}:depth:{report_depth}:threads:{threads}:hash:{hash_mb}:multipv:1"
    );
    let (game_id, line_anchor, line_signature, starting_fen, mut positions) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let (signature, positions) = report_positions(&model)?;
        (
            model.game_id,
            model.current_node,
            signature,
            model.starting_fen.clone(),
            positions,
        )
    };
    let started = Instant::now();
    let total = positions.len();
    let mut completed = 0;
    let mut cached_count = 0;

    {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        for position in &mut positions {
            let position_board =
                Board::from_fen(&position.fen).map_err(|error| error.to_string())?;
            if let Some(mate) = terminal_report_mate(&position_board) {
                position.mate = Some(mate);
                position.depth = Some(0);
                position.elapsed_ms = Some(0);
                completed += 1;
                continue;
            }
            let node_id = position.move_.as_ref().map(|mv| mv.node_id);
            let cached = model
                .store
                .load_analysis_for_config(game_id, node_id, &engine_fingerprint, &config_hash)
                .map_err(|error| error.to_string())?;
            let Some(cached) = cached else { continue };
            let lines: Vec<AnalysisLine> =
                serde_json::from_str(&cached).map_err(|error| error.to_string())?;
            if let Some(primary) = lines.iter().min_by_key(|line| line.multipv) {
                apply_report_line_to_position(position, primary, true)?;
                completed += 1;
                cached_count += 1;
            }
        }
    }
    opening_book::annotate_positions(&starting_fen, &mut positions)?;

    if state.report_generation.load(Ordering::SeqCst) != generation {
        emit_report_progress(
            app,
            GameReportProgressDto {
                completed,
                total,
                node_id: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
                target_depth: Some(report_depth),
                current_depth: None,
                cached: cached_count,
                estimated_remaining_ms: None,
                state: "cancelled",
            },
        );
        return Err("报告分析已取消".into());
    }

    emit_report_progress(
        app,
        GameReportProgressDto {
            completed,
            total,
            node_id: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            target_depth: Some(report_depth),
            current_depth: None,
            cached: cached_count,
            estimated_remaining_ms: None,
            state: "running",
        },
    );

    if completed < total {
        if !wait_for_engine_idle(state, Duration::from_secs(3)).await {
            return Err("引擎正在执行其他搜索，请先停止".into());
        }
        let mut slot = state.play_session.lock().await;
        if let Some(runtime) = slot.take() {
            let _ = runtime.session.close().await;
        }
        let mut session = EngineSession::launch(&resolved_engine_path, Duration::from_secs(5))
            .await
            .map_err(|error| format!("引擎握手失败：{error}"))?;
        configure_engine_for_xiangqi(&mut session, &resolved_engine_path).await?;
        session
            .configure("Threads", &threads.to_string())
            .await
            .map_err(|error| error.to_string())?;
        session
            .configure("Hash", &hash_mb.to_string())
            .await
            .map_err(|error| error.to_string())?;
        session
            .configure("MultiPV", "1")
            .await
            .map_err(|error| error.to_string())?;
        let protocol = session.protocol();
        *state.report_engine.lock().await = Some(session.control());

        let search_result: Result<(), String> = async {
            for position in &mut positions {
                if position.score_cp.is_some() || position.mate.is_some() {
                    continue;
                }
                if state.report_generation.load(Ordering::SeqCst) != generation {
                    emit_report_progress(
                        app,
                        GameReportProgressDto {
                            completed,
                            total,
                            node_id: position.move_.as_ref().map(|mv| mv.node_id),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                            target_depth: Some(report_depth),
                            current_depth: None,
                            cached: cached_count,
                            estimated_remaining_ms: report_estimated_remaining_ms(
                                started.elapsed().as_millis() as u64,
                                completed,
                                cached_count,
                                total,
                            ),
                            state: "cancelled",
                        },
                    );
                    return Err("报告分析已取消".into());
                }
                session
                    .search(&position.fen, &[], limit.clone(), &[], false)
                    .await
                    .map_err(|error| error.to_string())?;
                let mut primary = None;
                loop {
                    match session.next_event().await {
                        Ok(EngineEvent::Info(info))
                            if info.multipv == 1
                                && (!info.pv.is_empty() || info.mate.is_some()) =>
                        {
                            emit_report_progress(
                                app,
                                GameReportProgressDto {
                                    completed,
                                    total,
                                    node_id: position.move_.as_ref().map(|mv| mv.node_id),
                                    elapsed_ms: started.elapsed().as_millis() as u64,
                                    target_depth: Some(report_depth),
                                    current_depth: info.depth,
                                    cached: cached_count,
                                    estimated_remaining_ms: report_estimated_remaining_ms(
                                        started.elapsed().as_millis() as u64,
                                        completed,
                                        cached_count,
                                        total,
                                    ),
                                    state: "running",
                                },
                            );
                            let position_board = Board::from_fen(&position.fen)
                                .map_err(|error| error.to_string())?;
                            primary = Some(analysis_line_from_engine_info(&position_board, info));
                        }
                        Ok(EngineEvent::BestMove { .. }) => break,
                        Ok(_) => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
                if state.report_generation.load(Ordering::SeqCst) != generation {
                    emit_report_progress(
                        app,
                        GameReportProgressDto {
                            completed,
                            total,
                            node_id: position.move_.as_ref().map(|mv| mv.node_id),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                            target_depth: Some(report_depth),
                            current_depth: None,
                            cached: cached_count,
                            estimated_remaining_ms: report_estimated_remaining_ms(
                                started.elapsed().as_millis() as u64,
                                completed,
                                cached_count,
                                total,
                            ),
                            state: "cancelled",
                        },
                    );
                    return Err("报告分析已取消".into());
                }
                let mut line = primary.ok_or_else(|| "Pikafish 未返回有效报告分数".to_owned())?;
                if line.mate == Some(0) {
                    line.mate = Some(-1);
                }
                apply_report_line_to_position(position, &line, false)?;
                let node_id = position.move_.as_ref().map(|mv| mv.node_id);
                {
                    let mut model = state
                        .model
                        .lock()
                        .map_err(|_| "state lock poisoned".to_owned())?;
                    model
                        .store
                        .save_analysis(
                            game_id,
                            node_id,
                            &engine_fingerprint,
                            &config_hash,
                            line.depth,
                            line.score_cp,
                            line.mate,
                            &serde_json::to_string(&vec![line.clone()])
                                .map_err(|error| error.to_string())?,
                            position.elapsed_ms.unwrap_or_default(),
                        )
                        .map_err(|error| error.to_string())?;
                }
                completed += 1;
                emit_report_progress(
                    app,
                    GameReportProgressDto {
                        completed,
                        total,
                        node_id,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        target_depth: Some(report_depth),
                        current_depth: line.depth,
                        cached: cached_count,
                        estimated_remaining_ms: report_estimated_remaining_ms(
                            started.elapsed().as_millis() as u64,
                            completed,
                            cached_count,
                            total,
                        ),
                        state: "running",
                    },
                );
            }
            Ok(())
        }
        .await;
        *state.report_engine.lock().await = None;
        if let Err(error) = search_result {
            return Err(error);
        }
        *slot = Some(EngineRuntime {
            path: resolved_engine_path_text.clone(),
            session,
            pondering_fen: None,
            state: EngineRuntimeState::Idle,
        });
        let profile_result = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())
            .and_then(|mut model| {
                model
                    .store
                    .save_engine_profile(
                        "Pikafish report",
                        &resolved_engine_path_text,
                        protocol_name(protocol),
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            });
        profile_result?;
    }
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        for index in 0..positions.len() {
            let best_iccs = positions[index].best_iccs.as_deref();
            let hints = model
                .store
                .match_master_style_hints(
                    &positions[index].fen,
                    &positions[index].phase,
                    best_iccs,
                    3,
                )
                .map_err(|error| error.to_string())?;
            if !hints.is_empty() {
                if let Some(node_id) = positions
                    .get(index + 1)
                    .and_then(|position| position.move_.as_ref().map(|move_| move_.node_id))
                {
                    for hint in &hints {
                        model
                            .store
                            .record_master_style_match(game_id, &line_signature, node_id, hint)
                            .map_err(|error| error.to_string())?;
                    }
                }
                positions[index].master_style_hints = hints;
            }
        }
    }

    let _commit = state.report_commit.lock().await;
    if state.report_generation.load(Ordering::SeqCst) != generation {
        emit_report_progress(
            app,
            GameReportProgressDto {
                completed,
                total,
                node_id: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
                target_depth: Some(report_depth),
                current_depth: None,
                cached: cached_count,
                estimated_remaining_ms: report_estimated_remaining_ms(
                    started.elapsed().as_millis() as u64,
                    completed,
                    cached_count,
                    total,
                ),
                state: "cancelled",
            },
        );
        return Err("报告分析已取消".into());
    }

    let dataset = GameReportDatasetDto {
        game_id,
        line_signature: line_signature.clone(),
        engine_fingerprint: engine_fingerprint.clone(),
        config_hash: config_hash.clone(),
        generated_at: Utc::now().to_rfc3339(),
        stale: false,
        analysis_depth: Some(report_depth),
        cached_positions: cached_count,
        positions,
    };
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        if model.game_id != game_id
            || report_line_signature(&model.tree, line_anchor)? != line_signature
        {
            return Err("棋谱线路已变化，报告结果未覆盖当前线路".into());
        }
        model
            .store
            .save_game_report(
                game_id,
                &line_signature,
                &engine_fingerprint,
                &config_hash,
                &serde_json::to_string(&dataset).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    state.report_running.store(false, Ordering::SeqCst);
    emit_report_progress(
        app,
        GameReportProgressDto {
            completed: total,
            total,
            node_id: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            target_depth: Some(report_depth),
            current_depth: Some(report_depth),
            cached: cached_count,
            estimated_remaining_ms: None,
            state: "complete",
        },
    );
    Ok(dataset)
}

#[tauri::command]
pub(crate) async fn generate_game_report(
    engine_path: String,
    report_depth: u32,
    threads: u32,
    hash_mb: u32,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<GameReportDatasetDto, String> {
    let generation = state.report_generation.load(Ordering::SeqCst);
    if state
        .report_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("整局报告正在生成".into());
    }
    let result = generate_game_report_inner(
        engine_path,
        report_depth,
        threads,
        hash_mb,
        generation,
        &app,
        &state,
    )
    .await;
    state.report_running.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub(crate) async fn cancel_game_report(state: State<'_, DesktopState>) -> Result<bool, String> {
    let commit = state.report_commit.lock().await;
    if !state.report_running.load(Ordering::SeqCst) {
        return Ok(false);
    }
    state.report_generation.fetch_add(1, Ordering::SeqCst);
    let control = state.report_engine.lock().await.clone();
    drop(commit);
    if let Some(control) = control {
        control.stop().await.map_err(|error| error.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub(crate) fn get_game_report(
    state: State<'_, DesktopState>,
) -> Result<Option<GameReportDatasetDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let current_signature = report_line_signature(&model.tree, model.current_node)?;
    let Some(stored) = model
        .store
        .load_game_report(model.game_id, &current_signature)
        .and_then(|exact| match exact {
            Some(report) => Ok(Some(report)),
            None => model.store.load_latest_game_report(model.game_id),
        })
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let mut dataset: GameReportDatasetDto =
        serde_json::from_str(&stored.dataset_json).map_err(|error| error.to_string())?;
    dataset.stale = dataset.line_signature != current_signature;
    opening_book::annotate_positions(&model.starting_fen, &mut dataset.positions)?;
    for position in &mut dataset.positions {
        if position.master_style_hints.is_empty() {
            position.master_style_hints = model
                .store
                .match_master_style_hints(
                    &position.fen,
                    &position.phase,
                    position.best_iccs.as_deref(),
                    3,
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(Some(dataset))
}

#[tauri::command]
pub(crate) fn export_game_report_pdf(
    path: String,
    report: pdf_report::GameReportPresentationDto,
) -> Result<String, String> {
    let saved = pdf_report::write_report_pdf(Path::new(&path), &report)?;
    Ok(saved.to_string_lossy().into_owned())
}

pub(crate) fn protocol_name(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Uci => "uci",
        Protocol::Ucci => "ucci",
    }
}

pub(crate) fn repo_root_from_manifest() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

pub(crate) fn default_master_style_dir() -> PathBuf {
    repo_root_from_manifest()
        .join(".theory-work")
        .join("master-style")
}

pub(crate) fn master_style_seed_candidates(base: &Path) -> Vec<PathBuf> {
    ["master-style", "resources/master-style"]
        .into_iter()
        .map(|relative| base.join(relative))
        .collect()
}

pub(crate) fn bundled_master_style_seed_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    candidates.extend(master_style_seed_candidates(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .as_path(),
    ));
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(master_style_seed_candidates(&resource_dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(master_style_seed_candidates(parent));
            candidates.extend(master_style_seed_candidates(&parent.join("../Resources")));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.join("seed-manifest.json").is_file())
}

pub(crate) fn read_jsonl_values(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    fs::read_to_string(path)
        .map_err(|error| format!("读取 {} 失败：{error}", path.display()))?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .map_err(|error| format!("解析 {} 失败：{error}", path.display()))
        })
        .collect()
}

pub(crate) fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub(crate) fn json_i64(value: &serde_json::Value, key: &str) -> Option<i64> {
    value.get(key).and_then(serde_json::Value::as_i64)
}

pub(crate) fn json_bool(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn normalized_player_name(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

pub(crate) fn stable_master_style_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"|");
    }
    format!("{:x}", hasher.finalize())[..24].to_owned()
}

pub(crate) fn master_style_analysis_by_sample_id(
    path: &Path,
) -> Result<HashMap<String, serde_json::Value>, String> {
    Ok(read_jsonl_values(path)?
        .into_iter()
        .filter_map(|value| {
            let sample_id = json_string(&value, "sampleId")
                .or_else(|| json_i64(&value, "sampleId").map(|id| id.to_string()))?;
            Some((sample_id, value))
        })
        .collect())
}

pub(crate) fn imported_master_style_profiles_from_files(
    profile_path: &Path,
    samples_path: &Path,
    analysis_path: &Path,
) -> Result<Vec<(ImportedMasterStyleProfile, Vec<ImportedMasterStyleSample>)>, String> {
    let profile_text = fs::read_to_string(profile_path)
        .map_err(|error| format!("读取 {} 失败：{error}", profile_path.display()))?;
    let profile_values: Vec<serde_json::Value> = serde_json::from_str(&profile_text)
        .map_err(|error| format!("解析 {} 失败：{error}", profile_path.display()))?;
    let analysis_by_sample_id = master_style_analysis_by_sample_id(analysis_path)?;
    let samples = read_jsonl_values(samples_path)?;
    let mut grouped: HashMap<String, Vec<ImportedMasterStyleSample>> = HashMap::new();
    for sample in samples {
        let player_name = json_string(&sample, "playerName").unwrap_or_else(|| "赵鑫鑫".into());
        let normalized = normalized_player_name(&player_name);
        let profile_id = profile_values
            .iter()
            .find(|profile| {
                json_string(profile, "normalizedName").as_deref() == Some(normalized.as_str())
                    || json_string(profile, "playerName").as_deref() == Some(player_name.as_str())
            })
            .and_then(|profile| {
                json_string(profile, "profileId").or_else(|| json_string(profile, "id"))
            })
            .unwrap_or_else(|| stable_master_style_id(&["master-style-profile", &normalized]));
        let raw_sample_id = json_string(&sample, "sampleId")
            .or_else(|| json_i64(&sample, "sampleId").map(|id| id.to_string()))
            .unwrap_or_else(|| {
                stable_master_style_id(&[
                    &profile_id,
                    json_string(&sample, "gameId").as_deref().unwrap_or(""),
                    &json_i64(&sample, "ply").unwrap_or_default().to_string(),
                ])
            });
        let analysis = analysis_by_sample_id.get(&raw_sample_id);
        let candidates = analysis
            .and_then(|value| value.get("candidates"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        let merged_source = serde_json::json!({
            "sample": sample,
            "analysis": analysis,
            "licenseNote": "公开棋谱结构化样本，仅用于本地学习与风格启发，不包含原始网页 HTML。"
        });
        let imported = ImportedMasterStyleSample {
            id: stable_master_style_id(&["master-style-sample", &profile_id, &raw_sample_id]),
            profile_id: profile_id.clone(),
            player_name,
            source_game_id: json_string(&merged_source["sample"], "gameId").unwrap_or_default(),
            source_title: json_string(&merged_source["sample"], "title")
                .unwrap_or_else(|| "赵鑫鑫公开棋谱".into()),
            event_name: json_string(&merged_source["sample"], "eventName"),
            game_date: json_string(&merged_source["sample"], "gameDate"),
            ply: json_i64(&merged_source["sample"], "ply").unwrap_or_default(),
            phase: json_string(&merged_source["sample"], "phase")
                .unwrap_or_else(|| "middle".into()),
            before_fen: json_string(&merged_source["sample"], "beforeFen").unwrap_or_default(),
            played_move: json_string(&merged_source["sample"], "playedMove").unwrap_or_default(),
            played_move_rank: analysis.and_then(|value| json_i64(value, "playedMoveRank")),
            played_move_in_topn: analysis
                .map(|value| json_bool(value, "playedMoveInTopN"))
                .unwrap_or(false),
            best_move: analysis.and_then(|value| json_string(value, "bestMove")),
            best_score_cp: analysis.and_then(|value| json_i64(value, "bestScoreCp")),
            candidates_json: serde_json::to_string(&candidates)
                .map_err(|error| error.to_string())?,
            source_json: serde_json::to_string(&merged_source)
                .map_err(|error| error.to_string())?,
        };
        if imported.before_fen.is_empty() || imported.played_move.is_empty() {
            continue;
        }
        grouped.entry(profile_id).or_default().push(imported);
    }
    Ok(profile_values
        .into_iter()
        .filter_map(|profile| {
            let player_name = json_string(&profile, "playerName")?;
            let normalized = json_string(&profile, "normalizedName")
                .unwrap_or_else(|| normalized_player_name(&player_name));
            let profile_id = json_string(&profile, "profileId")
                .or_else(|| json_string(&profile, "id"))
                .unwrap_or_else(|| stable_master_style_id(&["master-style-profile", &normalized]));
            let samples = grouped.remove(&profile_id).unwrap_or_default();
            Some((
                ImportedMasterStyleProfile {
                    id: profile_id,
                    player_name,
                    normalized_name: normalized,
                    version: "master-style-training-v1".into(),
                    sample_count: json_i64(&profile, "sampledTrainingRows")
                        .unwrap_or(samples.len() as i64),
                    generated_at: json_string(&profile, "generatedAt")
                        .unwrap_or_else(|| Utc::now().to_rfc3339()),
                    profile_json: serde_json::to_string(&profile).unwrap_or_else(|_| "{}".into()),
                },
                samples,
            ))
        })
        .collect())
}

pub(crate) fn ensure_builtin_master_style_seed(
    app: &tauri::AppHandle,
    store: &mut LocalStore,
) -> Result<(), String> {
    const SEED_STATE_KEY: &str = "builtin_master_style_seed_id";
    let Some(seed_dir) = bundled_master_style_seed_dir(app) else {
        return Ok(());
    };
    let manifest_path = seed_dir.join("seed-manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("读取 {} 失败：{error}", manifest_path.display()))?;
    let manifest: MasterStyleSeedManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("解析 {} 失败：{error}", manifest_path.display()))?;
    let seed_id = manifest.seed_id.trim();
    if seed_id.is_empty() {
        return Err(format!("{} 缺少 seedId", manifest_path.display()));
    }
    if store
        .local_state_value(SEED_STATE_KEY)
        .map_err(|error| error.to_string())?
        .as_deref()
        == Some(seed_id)
    {
        return Ok(());
    }

    let imports = imported_master_style_profiles_from_files(
        &seed_dir.join("master-style-profiles.json"),
        &seed_dir.join("master-style-samples.jsonl"),
        &seed_dir.join("master-style-analysis.jsonl"),
    )?;
    let allowed_players = manifest
        .players
        .iter()
        .map(|player| normalized_player_name(player))
        .collect::<std::collections::HashSet<_>>();
    for (profile, samples) in imports {
        if !allowed_players.is_empty() && !allowed_players.contains(&profile.normalized_name) {
            continue;
        }
        store
            .upsert_master_style_profile(&profile, &samples)
            .map_err(|error| error.to_string())?;
    }
    store
        .set_local_state_value(SEED_STATE_KEY, seed_id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

const TRAINING_SYSTEM_SOURCE_TITLE: &str =
    "中国象棋特级大师核心训练秘诀（历代宗师+现役顶尖棋手通用体系）";
pub(crate) const TRAINING_SYSTEM_SOURCE_URL: &str =
    "https://mp.weixin.qq.com/s/x0jQq9Re8G_aGoTlk9N59w";

struct TrainingSystemSeedCard {
    id: &'static str,
    phase: &'static str,
    title: &'static str,
    summary: &'static str,
    applies_when: &'static str,
    risk: &'static str,
    tags: &'static [&'static str],
    engine_correlations: &'static [&'static str],
}

pub(crate) fn training_system_seed_cards() -> Vec<ImportedTheoryCard> {
    let cards = [
        TrainingSystemSeedCard {
            id: "training-system-endgame-foundation",
            phase: "endgame",
            title: "残局打底：先判胜和再选计划",
            summary: "每天保留短时间练基础残局，先说理论胜和、关键限制点和兑换方向，再看具体走法。",
            applies_when: "子力减少、兵卒或仕相结构决定结果时。",
            risk: "不要只背结论；必须把对方最强防守也说出来。",
            tags: &["残局打底", "残局处理", "深度复盘", "理论胜和"],
            engine_correlations: &["endgame", "conversion", "theoretical-win-draw"],
        },
        TrainingSystemSeedCard {
            id: "training-system-tactical-miscalculation",
            phase: "middle",
            title: "战术漏算：双方强制着先扫完",
            summary: "每个关键局面先扫双方将军、吃子、捉双和强制兑子，避免只计算自己的第一手。",
            applies_when: "线路打开、子力接触增多、局面评价大幅波动或出现漏杀时。",
            risk: "强制着只是候选入口，不能因为看起来凶就停止比较。",
            tags: &["战术漏算", "强制着", "反击检查", "漏杀/防杀"],
            engine_correlations: &["missed_tactic", "forcing-move", "mate-threat"],
        },
        TrainingSystemSeedCard {
            id: "training-system-candidate-calculation",
            phase: "middle",
            title: "候选着计算：走一思三",
            summary: "落子前至少提出一个首选和两个备选，并说明每个候选要防住什么反击。",
            applies_when: "局面没有唯一应手、MultiPV 出现多个可行方向时。",
            risk: "读秒或被将军时不硬凑三路，先确保合法应对和防漏。",
            tags: &["候选着计算", "候选着", "候选不足", "计算"],
            engine_correlations: &["missed_candidate", "multipv", "played-move-rank"],
        },
        TrainingSystemSeedCard {
            id: "training-system-personal-opening",
            phase: "opening",
            title: "专属布局：先少而稳",
            summary: "先手和后手各整理 2-3 套常用体系，用学习开局库和大师同类实战验证主线与备选。",
            applies_when: "开局阶段脱离体系、官着命中少或同类布局反复出错时。",
            risk: "不把大库所有分支都背下来；先固定主线、常见偏离和一条补救方案。",
            tags: &["专属布局", "开局失误", "脱离体系", "子力协调"],
            engine_correlations: &["opening_deviation", "development_lag", "opening-book"],
        },
        TrainingSystemSeedCard {
            id: "training-system-deep-review",
            phase: "middle",
            title: "深度复盘：赢棋也追亏分",
            summary: "复盘不只看胜负；胜局中只要有高亏分着法，也要生成下一次训练任务。",
            applies_when: "整局报告出现差错、漏杀或局势大幅摆动时。",
            risk: "复盘只保留一到两个核心原因，避免写成长篇流水账。",
            tags: &["深度复盘", "随手棋", "推荐着对比"],
            engine_correlations: &["evaluation-drop", "review-task", "best-move-comparison"],
        },
        TrainingSystemSeedCard {
            id: "training-system-slow-game",
            phase: "middle",
            title: "慢棋训练：把时间花在变化点",
            summary: "慢棋题重点训练计算深度，遇到将军、吃子、弃子、兵形变化和评价摆动时主动减速。",
            applies_when: "限时训练、比赛复盘或孩子出现随手棋时。",
            risk: "每步都长考会拖垮节奏；熟悉定式仍要做最短防漏检查。",
            tags: &["慢棋训练", "随手棋", "变化点", "比赛纪律"],
            engine_correlations: &["time-management", "evaluation-swing", "blunder"],
        },
        TrainingSystemSeedCard {
            id: "training-system-mental-note",
            phase: "middle",
            title: "心态管理：给失误贴状态标签",
            summary: "训练笔记只记录一个状态标签，如专注、急躁、优势放松或劣势抗压，和下一次落子提醒。",
            applies_when: "大优势失误、劣势急攻、连续漏算或高亏分着法后。",
            risk: "不把心态标签当责备；它只用来设计下一次更具体的行动。",
            tags: &["心态管理", "心态波动", "训练笔记"],
            engine_correlations: &["tilt", "large-blunder", "review-note"],
        },
    ];
    cards
        .into_iter()
        .map(|card| ImportedTheoryCard {
            external_id: card.id.into(),
            phase: card.phase.into(),
            course_name: "特级大师训练法".into(),
            lesson_title: "每日40分钟与每周复盘闭环".into(),
            source_path: format!("{TRAINING_SYSTEM_SOURCE_URL}#{}", card.id),
            fingerprint: format!("training-system-v1:{}", card.id),
            title: card.title.into(),
            summary: card.summary.into(),
            applies_when: card.applies_when.into(),
            risk: card.risk.into(),
            review_status: "approved".into(),
            source_book: Some(format!("{TRAINING_SYSTEM_SOURCE_TITLE} · 方法论参考")),
            source_page_start: None,
            source_page_end: None,
            tags: card.tags.iter().map(|tag| (*tag).into()).collect(),
            engine_correlations: card
                .engine_correlations
                .iter()
                .map(|signal| (*signal).into())
                .collect(),
        })
        .collect()
}

pub(crate) fn ensure_training_system_seed(store: &mut LocalStore) -> Result<(), String> {
    for card in training_system_seed_cards() {
        store
            .upsert_imported_theory_card(&card)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn import_master_style_profile(
    request: Option<ImportMasterStyleProfileRequest>,
    state: State<'_, DesktopState>,
) -> Result<MasterStyleImportResultDto, String> {
    let base = default_master_style_dir();
    let request = request.unwrap_or(ImportMasterStyleProfileRequest {
        profile_path: None,
        samples_path: None,
        analysis_path: None,
    });
    let profile_path = request
        .profile_path
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("master-style-profiles.json"));
    let samples_path = request
        .samples_path
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("master-style-samples.jsonl"));
    let analysis_path = request
        .analysis_path
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("master-style-analysis.jsonl"));
    let imports =
        imported_master_style_profiles_from_files(&profile_path, &samples_path, &analysis_path)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut profiles = Vec::new();
    let mut imported_samples = 0;
    for (profile, samples) in imports {
        imported_samples += samples.len();
        profiles.push(
            model
                .store
                .upsert_master_style_profile(&profile, &samples)
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(MasterStyleImportResultDto {
        profiles,
        imported_samples,
    })
}

#[tauri::command]
pub(crate) fn list_master_style_profiles(
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterStyleProfile>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .list_master_style_profiles()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn match_master_style_hints(
    fen: String,
    phase: String,
    best_iccs: Option<String>,
    limit: Option<usize>,
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterStyleHint>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .match_master_style_hints(&fen, &phase, best_iccs.as_deref(), limit.unwrap_or(3))
        .map_err(|error| error.to_string())
}
