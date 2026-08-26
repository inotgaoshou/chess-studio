use super::*;
use crate::manual_service::commit_move;

pub(crate) fn link_status_dto(session: &LinkSession) -> LinkSessionStatusDto {
    LinkSessionStatusDto {
        source: session.source,
        mode: session.mode,
        state: session.state,
        reason: session.reason.clone(),
        phase: session.phase.clone(),
        last_error: session.last_error.clone(),
        started_at: session.started_at.as_ref().map(|value| value.to_rfc3339()),
        last_heartbeat_at: session
            .last_heartbeat_at
            .as_ref()
            .map(|value| value.to_rfc3339()),
        recognition_attempts: session.recognition_attempts,
        last_detection_summary: session.last_detection_summary.clone(),
        turn_indicator: session.turn_indicator.clone(),
        manual_turn_override: session.manual_turn_override.map(color_name),
        pending_external_move: session.pending_external_move.clone(),
        capture_preview_kind: session.capture_preview_kind.clone(),
        frame_rate: session.frame_rate,
        confidence: session.confidence,
        confidence_threshold: session.confidence_threshold,
        stable_frames: session.stable_frames,
        required_stable_frames: session.required_stable_frames,
        latest_fen: session.latest_fen.clone(),
        last_move: session.last_move.clone(),
        last_move_detail: session.last_move_detail.clone(),
        initial_position_seen: session.initial_position_seen,
        auto_side: session.auto_side.map(color_name),
        board_orientation: session.board_orientation,
        capture_running: session.capture_running,
        target_window: session.target_window.clone(),
        capture_backend: session.capture_backend.clone(),
        capture_dpi: session.capture_dpi,
        click_available: session.click_available,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_link_target_dto(target: windows_link::BrowserWindow) -> LinkTargetWindowDto {
    LinkTargetWindowDto {
        id: target.id.to_string(),
        title: target.title,
        process_name: target.process_name,
        client_width: target.client_width,
        client_height: target.client_height,
        dpi: target.dpi,
        available: true,
        unavailable_reason: None,
    }
}

#[tauri::command]
pub(crate) fn list_link_target_windows() -> Result<Vec<LinkTargetWindowDto>, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok(windows_link::list_browser_windows()
            .into_iter()
            .map(windows_link_target_dto)
            .collect());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(Vec::new())
}

pub(crate) fn link_live_session_has_stable_position(session: &LinkSession) -> bool {
    session.capture_running
        && session.initial_position_seen
        && matches!(
            session.source,
            CaptureSource::WindowLink | CaptureSource::DesktopDetect
        )
}

pub(crate) fn reset_link_stability_progress(session: &mut LinkSession) {
    session.stable_frames = 0;
    session.required_stable_frames = session.gate.required_frames();
    reset_link_side_change_stability(session);
}

pub(crate) fn set_link_stability_progress(session: &mut LinkSession, frames: u8, required: u8) {
    let required = required.max(1);
    session.stable_frames = frames.min(required);
    session.required_stable_frames = required;
}

pub(crate) fn mark_link_stability_accepted(session: &mut LinkSession) {
    let required = session.gate.required_frames();
    set_link_stability_progress(
        session,
        session.gate.matching_frames().max(required),
        required,
    );
    reset_link_side_change_stability(session);
}

pub(crate) fn reset_link_side_change_stability(session: &mut LinkSession) {
    session.side_change_candidate = None;
    session.side_change_candidate_frames = 0;
}

pub(crate) fn observe_link_side_change_stability(session: &mut LinkSession, side: Color) -> u8 {
    if session.side_change_candidate == Some(side) {
        session.side_change_candidate_frames =
            session.side_change_candidate_frames.saturating_add(1);
    } else {
        session.side_change_candidate = Some(side);
        session.side_change_candidate_frames = 1;
    }
    session.side_change_candidate_frames
}

pub(crate) fn clear_link_recognition_candidate(session: &mut LinkSession) {
    if link_live_session_has_stable_position(session) {
        return;
    }
    session.latest_fen = None;
    session.last_move = None;
    session.last_move_detail = None;
}

pub(crate) fn live_side_change_required_frames(session: &LinkSession) -> u8 {
    if link_live_session_has_stable_position(session) {
        session.gate.required_frames().max(4)
    } else {
        session.gate.required_frames()
    }
}

pub(crate) fn live_position_jump_required_frames(session: &LinkSession) -> u8 {
    if link_live_session_has_stable_position(session) {
        session.gate.required_frames().max(5)
    } else {
        session.gate.required_frames()
    }
}

pub(crate) fn wait_for_link_recognition_stability(
    session: &mut LinkSession,
    phase: &str,
    reason: String,
    required_frames: u8,
) -> LinkObservationDto {
    set_link_stability_progress(session, session.gate.matching_frames(), required_frames);
    session.state = LinkSessionState::WaitingStableFrames;
    session.phase = Some(phase.into());
    session.reason = Some(reason);
    LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: session.reason.clone(),
        board: None,
        orientation: session.board_orientation,
        capture_preview_available: session.capture_preview.is_some(),
    }
}

pub(crate) fn wait_for_link_candidate_stability(
    session: &mut LinkSession,
    phase: &str,
    reason: String,
    matching_frames: u8,
    required_frames: u8,
) -> LinkObservationDto {
    set_link_stability_progress(session, matching_frames, required_frames);
    session.state = LinkSessionState::WaitingStableFrames;
    session.phase = Some(phase.into());
    session.reason = Some(reason);
    LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: session.reason.clone(),
        board: None,
        orientation: session.board_orientation,
        capture_preview_available: session.capture_preview.is_some(),
    }
}

pub(crate) fn effective_link_confidence_threshold(value: u8) -> f32 {
    let migrated = if value == 70 { 55 } else { value };
    migrated.clamp(10, 100) as f32 / 100.0
}

pub(crate) fn desktop_link_confidence_threshold(state: &DesktopState) -> f32 {
    state
        .model
        .lock()
        .ok()
        .and_then(|model| model.store.desktop_preferences().ok())
        .map(|preferences| {
            effective_link_confidence_threshold(preferences.link_confidence_threshold)
        })
        .unwrap_or(0.55)
}

pub(crate) fn emit_link_session_updated(app: &tauri::AppHandle) {
    let _ = app.emit("link-session-updated", ());
}

pub(crate) fn apply_link_capture_timeout(session: &mut LinkSession) {
    if !session.capture_running
        || matches!(
            session.state,
            LinkSessionState::Stopped
                | LinkSessionState::Paused
                | LinkSessionState::Tracking
                | LinkSessionState::NeedsManualCorrection
        )
        || session.recognition_attempts > 0
        || session.latest_fen.is_some()
    {
        return;
    }
    let Some(started_at) = session.started_at.as_ref() else {
        return;
    };
    let now = Utc::now();
    let elapsed = now
        .signed_duration_since(started_at.to_owned())
        .num_seconds();
    let heartbeat_elapsed = session
        .last_heartbeat_at
        .as_ref()
        .map(|value| now.signed_duration_since(value.to_owned()).num_seconds());
    let message = if session.last_heartbeat_at.is_none() && elapsed >= 8 {
        Some("识别线程启动后 8 秒没有 heartbeat，可能模型加载/线程启动已异常；请重新框选或重启应用。".to_owned())
    } else if elapsed >= 12 && heartbeat_elapsed.is_some_and(|value| value >= 8) {
        Some("识别线程 12 秒内没有产出首个识别结果，可能卡在模型推理或屏幕采集；请重新框选，若反复出现请更换更清晰的棋盘区域。".to_owned())
    } else if elapsed >= 12 {
        Some("启动后 12 秒仍无首个识别结果；请重新框选棋盘，或重启应用后再试。".to_owned())
    } else {
        None
    };
    if let Some(message) = message {
        session.state = LinkSessionState::NeedsManualCorrection;
        session.capture_running = false;
        session.phase = Some("timeout".into());
        session.last_error = Some(message.clone());
        session.reason = Some(message);
        session.frame_rate = 0.0;
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn apply_link_region_selection_failure(
    session: &mut LinkSession,
    generation: u64,
    phase: &str,
    message: String,
) {
    if session.capture_generation == generation {
        session.state = LinkSessionState::NeedsManualCorrection;
        session.capture_running = false;
        session.phase = Some(phase.into());
        session.last_error = Some(message.clone());
        session.reason = Some(message);
        session.frame_rate = 0.0;
    }
}

pub(crate) fn initialize_link_session_for_request(
    session: &mut LinkSession,
    request: &StartLinkSessionRequest,
    generation: u64,
    confidence_threshold: f32,
    policy: CapturePolicy,
) {
    session.source = request.source;
    session.recognition_mode = request.recognition_mode;
    session.mode = request.mode;
    session.capture_preview = None;
    session.capture_preview_kind = None;
    session.reason = Some(match request.source {
        CaptureSource::WindowLink => "等待框选第三方棋盘区域…".into(),
        CaptureSource::DesktopDetect => "正在自动扫描桌面上的最大象棋棋盘…".into(),
        CaptureSource::ImageImport => "请选择截图/照片后识别局面…".into(),
        CaptureSource::CameraBoard => "请选择实体棋盘拍照图片后识别局面…".into(),
    });
    session.phase = Some(match request.source {
        CaptureSource::WindowLink => "selecting_region".into(),
        _ => "starting".into(),
    });
    session.last_error = None;
    session.started_at = Some(Utc::now());
    session.last_heartbeat_at = None;
    session.recognition_attempts = 0;
    session.last_detection_summary = None;
    session.turn_indicator = None;
    session.manual_turn_override = None;
    session.pending_external_move = None;
    session.pending_expected_fen = None;
    session.screenshot_move_marker = None;
    session.screenshot_resolution_before_fen = None;
    session.screenshot_resolution_generation = None;
    session.screenshot_resolution_mode = None;
    session.screenshot_resolution_game_id = None;
    session.screenshot_resolution_current_node = None;
    session.screenshot_resolution_allowed_moves.clear();
    session.state = match request.source {
        CaptureSource::ImageImport | CaptureSource::CameraBoard => {
            LinkSessionState::DetectingCorners
        }
        CaptureSource::WindowLink => LinkSessionState::Calibrating,
        CaptureSource::DesktopDetect => LinkSessionState::ClassifyingSquares,
    };
    // A caller may ask for more confirmation, but never less than the source-safe default.
    session.gate = StabilityGate::new(request.stable_frames.max(policy.stable_frames));
    reset_link_stability_progress(session);
    session.confidence = None;
    session.confidence_threshold = confidence_threshold;
    session.frame_rate = 0.0;
    session.latest_fen = None;
    session.last_move = None;
    session.last_move_detail = None;
    session.initial_position_seen = false;
    session.auto_side = match request.auto_side.as_deref() {
        Some("red") => Some(Color::Red),
        Some("black") => Some(Color::Black),
        _ => None,
    };
    session.capture_running = matches!(request.source, CaptureSource::DesktopDetect);
    session.board_bounds = None;
    session.piece_click_centers.clear();
    session.board_capture_signature = None;
    session.target_region = None;
    session.target_window = None;
    session.capture_backend = None;
    session.capture_dpi = None;
    session.capture_window_geometry = None;
    session.click_available = false;
    session.board_orientation = BoardOrientation::RedAtBottom;
    session.capture_generation = generation;
}

#[tauri::command]
pub(crate) fn prepare_link_selection_window(app: tauri::AppHandle) -> Result<(), String> {
    prepare_window_link_selection(&app);
    std::thread::sleep(Duration::from_millis(300));
    Ok(())
}

#[tauri::command]
pub(crate) fn start_link_session(
    request: StartLinkSessionRequest,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<LinkObservationDto, String> {
    let policy = CapturePolicy::for_source(request.source);
    if request.recognition_mode != policy.recognition_mode {
        return Err("当前采集来源必须使用对应的识别模式".into());
    }
    if !policy.allows_external_click && !matches!(request.mode, LinkMode::Spectate) {
        return Err("截图、照片和实体棋盘仅支持识别、跟盘与分析，不能控制第三方窗口".into());
    }
    #[cfg(target_os = "windows")]
    if matches!(request.mode, LinkMode::AutoPlay) {
        return Err("Windows 不支持自动代走；请使用观战跟盘或每步确认走子".into());
    }
    #[cfg(target_os = "windows")]
    if matches!(request.source, CaptureSource::DesktopDetect)
        && !matches!(request.mode, LinkMode::Spectate)
    {
        return Err(
            "Windows 桌面自动识别只支持观战跟盘。确认走子必须先选择 Chrome 或 Edge 目标窗口".into(),
        );
    }
    #[cfg(target_os = "windows")]
    let selected_target_window = if matches!(request.source, CaptureSource::WindowLink) {
        let target_id = request
            .target_window_id
            .as_deref()
            .ok_or("请先选择 Chrome 或 Edge 中的天天象棋网页窗口")?
            .parse::<u64>()
            .map_err(|_| "目标窗口标识无效，请重新选择浏览器窗口")?;
        Some(windows_link::validate_browser_window(target_id)?)
    } else {
        None
    };
    let confidence_threshold = desktop_link_confidence_threshold(&state);
    let generation = {
        let _resolution_guard = state
            .screenshot_resolution_guard
            .lock()
            .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
        let generation = state.link_capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        initialize_link_session_for_request(
            &mut session,
            &request,
            generation,
            confidence_threshold,
            policy,
        );
        generation
    };
    emit_link_session_updated(&app);

    if matches!(request.source, CaptureSource::WindowLink) {
        #[cfg(target_os = "windows")]
        {
            let target = selected_target_window.ok_or("目标浏览器窗口已失效，请重新选择窗口")?;
            if let Ok(mut session) = state.link_session.lock() {
                if session.capture_generation == generation {
                    session.target_window = Some(windows_link_target_dto(target.clone()));
                    session.capture_backend = Some("Windows 原生窗口采集（实验）".into());
                    session.capture_dpi = Some(target.dpi);
                    session.click_available = matches!(request.mode, LinkMode::ConfirmPlay);
                    session.capture_running = true;
                    session.phase = Some("target_selected".into());
                    session.reason = Some(format!(
                        "已绑定 {}：{}，正在加载识别模型…",
                        target.process_name, target.title
                    ));
                }
            }
            emit_link_session_updated(&app);
            if let Err(error) = start_window_link_capture(app.clone(), None, generation, None) {
                set_link_capture_error(&app, generation, error.clone());
                return Err(error);
            }
            let session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Err(error) = start_window_link_selection_worker(app.clone(), generation) {
                restore_link_window_or_main(&app);
                if let Ok(mut session) = state.link_session.lock() {
                    apply_link_region_selection_failure(
                        &mut session,
                        generation,
                        "region_selection_error",
                        format!("{error}；可重新启动连线或重新框选。"),
                    );
                }
                emit_link_session_updated(&app);
                return Err(error);
            }
            let session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
    }
    let capture_preview: Option<LinkCapturePreview> = None;
    let initial_frame = capture_preview.as_ref().map(|preview| preview.png.clone());
    let capture_region = capture_preview.as_ref().and_then(|preview| preview.region);
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    session.capture_preview = capture_preview.map(|preview| preview.data_uri);
    session.capture_preview_kind = session
        .capture_preview
        .as_ref()
        .map(|_| "框选预览".to_owned());
    session.reason = Some(match request.source {
        CaptureSource::WindowLink => "已框选棋盘区域，正在识别并同步局面…".into(),
        CaptureSource::DesktopDetect => "正在自动扫描桌面上的最大象棋棋盘…".into(),
        CaptureSource::ImageImport => "请选择截图/照片后识别局面…".into(),
        CaptureSource::CameraBoard => "请选择实体棋盘拍照图片后识别局面…".into(),
    });
    session.phase = Some("starting".into());
    session.state = match request.source {
        CaptureSource::ImageImport | CaptureSource::CameraBoard => {
            LinkSessionState::DetectingCorners
        }
        CaptureSource::WindowLink | CaptureSource::DesktopDetect => {
            LinkSessionState::ClassifyingSquares
        }
    };
    session.capture_running = matches!(
        request.source,
        CaptureSource::WindowLink | CaptureSource::DesktopDetect
    );
    session.target_region = capture_region;
    drop(session);
    emit_link_session_updated(&app);
    if matches!(
        request.source,
        CaptureSource::WindowLink | CaptureSource::DesktopDetect
    ) {
        if let Err(error) =
            start_window_link_capture(app.clone(), initial_frame, generation, capture_region)
        {
            set_link_capture_error(&app, generation, error.clone());
            return Err(error);
        }
    }
    let session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    Ok(LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: session.reason.clone(),
        board: None,
        orientation: session.board_orientation,
        capture_preview_available: session.capture_preview.is_some(),
    })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn start_window_link_selection_worker(
    app: tauri::AppHandle,
    generation: u64,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("xiangqi-link-region".into())
        .spawn(move || {
            let app_for_error = app.clone();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                let state = app.state::<DesktopState>();
                set_link_capture_progress(
                    &app,
                    generation,
                    "selecting_region",
                    "等待框选第三方棋盘区域…请拖出网页/客户端棋盘范围。",
                );
                match capture_window_link_preview(&app, &state) {
                    Ok(Some(preview)) => {
                        let initial_frame = preview.png.clone();
                        let capture_region = preview.region;
                        let confidence_threshold = desktop_link_confidence_threshold(&state);
                        let mut active_generation = false;
                        if let Ok(mut session) = state.link_session.lock() {
                            if session.capture_generation == generation {
                                active_generation = true;
                                session.gate.reset();
                                session.capture_preview = Some(preview.data_uri);
                                session.capture_preview_kind = Some("框选预览".into());
                                session.state = LinkSessionState::ClassifyingSquares;
                                session.capture_running = true;
                                session.reason = Some("已框选棋盘区域，正在识别并同步局面…".into());
                                session.phase = Some("preview_ready".into());
                                session.last_error = None;
                                session.started_at = Some(Utc::now());
                                session.last_heartbeat_at = None;
                                session.recognition_attempts = 0;
                                session.last_detection_summary = None;
                                session.turn_indicator = None;
                                session.manual_turn_override = None;
                                session.pending_external_move = None;
                                session.pending_expected_fen = None;
                                session.latest_fen = None;
                                session.confidence = None;
                                session.confidence_threshold = confidence_threshold;
                                session.frame_rate = 0.0;
                                reset_link_stability_progress(&mut session);
                                session.target_region = capture_region;
                            }
                        }
                        if !active_generation {
                            return;
                        }
                        if let Some(region) = capture_region {
                            relocate_link_hint_window_away_from_region(&app, region);
                        }
                        restore_link_hint_window(&app);
                        emit_link_session_updated(&app);
                        if let Err(error) = start_window_link_capture(
                            app.clone(),
                            Some(initial_frame),
                            generation,
                            capture_region,
                        ) {
                            set_link_capture_error(&app, generation, error);
                            restore_link_hint_window(&app);
                        }
                    }
                    Ok(None) => {
                        restore_link_window_or_main(&app);
                        if let Ok(mut session) = state.link_session.lock() {
                            apply_link_region_selection_failure(
                                &mut session,
                                generation,
                                "region_selection_cancelled",
                                "已取消棋盘区域框选；可重新启动连线或重新框选。".into(),
                            );
                        }
                        emit_link_session_updated(&app);
                    }
                    Err(error) => {
                        restore_link_window_or_main(&app);
                        if let Ok(mut session) = state.link_session.lock() {
                            apply_link_region_selection_failure(
                                &mut session,
                                generation,
                                "region_selection_error",
                                format!("{error}；可重新启动连线或重新框选。"),
                            );
                        }
                        emit_link_session_updated(&app);
                    }
                }
            }));
            if let Err(payload) = result {
                let detail = payload
                    .downcast_ref::<&str>()
                    .map(|value| (*value).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "未知 panic".to_owned());
                restore_link_window_or_main(&app_for_error);
                if let Ok(mut session) = app_for_error.state::<DesktopState>().link_session.lock() {
                    apply_link_region_selection_failure(
                        &mut session,
                        generation,
                        "region_selection_error",
                        format!("框选线程异常退出：{detail}；可重新启动连线或重新框选。"),
                    );
                }
                emit_link_session_updated(&app_for_error);
            }
        })
        .map_err(|error| format!("无法启动棋盘框选线程：{error}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn stop_link_session(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<LinkObservationDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    state.link_capture_generation.fetch_add(1, Ordering::SeqCst);
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    session.state = LinkSessionState::Stopped;
    session.gate.reset();
    session.reason = None;
    session.capture_preview = None;
    session.capture_preview_kind = None;
    session.capture_running = false;
    session.latest_fen = None;
    session.confidence = None;
    session.phase = None;
    session.last_error = None;
    session.started_at = None;
    session.last_heartbeat_at = None;
    session.recognition_attempts = 0;
    session.last_detection_summary = None;
    session.turn_indicator = None;
    session.manual_turn_override = None;
    session.pending_external_move = None;
    session.pending_expected_fen = None;
    session.screenshot_move_marker = None;
    session.screenshot_resolution_before_fen = None;
    session.screenshot_resolution_generation = None;
    session.screenshot_resolution_mode = None;
    session.screenshot_resolution_game_id = None;
    session.screenshot_resolution_current_node = None;
    session.screenshot_resolution_allowed_moves.clear();
    session.board_bounds = None;
    session.piece_click_centers.clear();
    session.board_capture_signature = None;
    session.target_region = None;
    session.target_window = None;
    session.capture_backend = None;
    session.capture_dpi = None;
    session.capture_window_geometry = None;
    session.click_available = false;
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
    Ok(LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: None,
        board: None,
        orientation: session.board_orientation,
        capture_preview_available: false,
    })
}

#[tauri::command]
pub(crate) fn get_link_session_status(
    state: State<'_, DesktopState>,
) -> Result<LinkSessionStatusDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    apply_link_capture_timeout(&mut session);
    Ok(link_status_dto(&session))
}

#[tauri::command]
pub(crate) fn pause_link_session(
    state: State<'_, DesktopState>,
) -> Result<LinkSessionStatusDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    state.link_capture_generation.fetch_add(1, Ordering::SeqCst);
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if !matches!(session.state, LinkSessionState::Stopped) {
        session.state = LinkSessionState::Paused;
        session.capture_running = false;
        session.reason = Some("连线已暂停，未写入任何新着法".into());
        session.phase = Some("paused".into());
        invalidate_screenshot_move_resolution(&mut session);
    }
    Ok(link_status_dto(&session))
}

#[tauri::command]
pub(crate) fn recalibrate_link_session(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<LinkSessionStatusDto, String> {
    let source = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?
        .source;
    if matches!(source, CaptureSource::WindowLink) {
        #[cfg(target_os = "windows")]
        {
            let (target_window_id, recognition_mode, mode, stable_frames, auto_side) = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())
                .and_then(|session| {
                    Ok((
                        session
                            .target_window
                            .as_ref()
                            .map(|target| target.id.clone())
                            .ok_or("当前会话没有绑定浏览器窗口，请停止后重新选择窗口")?,
                        session.recognition_mode,
                        session.mode,
                        session.gate.required_frames(),
                        session.auto_side.map(color_name),
                    ))
                })?;
            let target_id = target_window_id
                .parse::<u64>()
                .map_err(|_| "目标窗口标识已失效，请停止后重新选择窗口")?;
            let target = windows_link::validate_browser_window(target_id)
                .map_err(|error| format!("{error}。请停止连线后重新选择窗口"))?;
            let generation = state.link_capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
            let confidence_threshold = desktop_link_confidence_threshold(&state);
            let request = StartLinkSessionRequest {
                source: CaptureSource::WindowLink,
                recognition_mode,
                mode,
                stable_frames,
                auto_side,
                target_window_id: Some(target_window_id),
            };
            let policy = CapturePolicy::for_source(CaptureSource::WindowLink);
            let mut session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            initialize_link_session_for_request(
                &mut session,
                &request,
                generation,
                confidence_threshold,
                policy,
            );
            session.target_window = Some(windows_link_target_dto(target.clone()));
            session.capture_backend = Some("Windows 原生窗口采集（实验）".into());
            session.capture_dpi = Some(target.dpi);
            session.click_available = matches!(mode, LinkMode::ConfirmPlay);
            session.capture_running = true;
            session.phase = Some("recalibrating_target".into());
            session.reason = Some(format!(
                "正在重新标定 {}：{}，窗口移动或缩放后会重新计算棋盘坐标…",
                target.process_name, target.title
            ));
            drop(session);
            emit_link_session_updated(&app);
            if let Err(error) = start_window_link_capture(app.clone(), None, generation, None) {
                set_link_capture_error(&app, generation, error.clone());
                return Err(error);
            }
            let session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            return Ok(link_status_dto(&session));
        }
        #[cfg(not(target_os = "windows"))]
        {
            let generation = state.link_capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
            let confidence_threshold = desktop_link_confidence_threshold(&state);
            let mut session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            let recognition_mode = session.recognition_mode;
            let mode = session.mode;
            let stable_frames = session.gate.required_frames();
            let auto_side = session.auto_side.map(color_name);
            let request = StartLinkSessionRequest {
                source: CaptureSource::WindowLink,
                recognition_mode,
                mode,
                stable_frames,
                auto_side,
                target_window_id: None,
            };
            let policy = CapturePolicy::for_source(CaptureSource::WindowLink);
            initialize_link_session_for_request(
                &mut session,
                &request,
                generation,
                confidence_threshold,
                policy,
            );
            session.gate.reset();
            session.reason = Some("等待重新框选第三方棋盘区域…".into());
            session.phase = Some("selecting_region".into());
            session.capture_generation = generation;
            drop(session);
            emit_link_session_updated(&app);
            if let Err(error) = start_window_link_selection_worker(app.clone(), generation) {
                restore_link_window_or_main(&app);
                if let Ok(mut session) = state.link_session.lock() {
                    apply_link_region_selection_failure(
                        &mut session,
                        generation,
                        "region_selection_error",
                        format!("{error}；可重新启动连线或重新框选。"),
                    );
                }
                emit_link_session_updated(&app);
                return Err(error);
            }
            let session = state
                .link_session
                .lock()
                .map_err(|_| "link session lock poisoned".to_owned())?;
            return Ok(link_status_dto(&session));
        }
    }
    if matches!(source, CaptureSource::DesktopDetect) {
        let generation = state.link_capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let confidence_threshold = desktop_link_confidence_threshold(&state);
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        session.gate.reset();
        session.state = LinkSessionState::ClassifyingSquares;
        session.capture_running = true;
        session.reason = Some("正在重新扫描桌面上的最大象棋棋盘…".into());
        session.phase = Some("recalibrating".into());
        session.last_error = None;
        session.started_at = Some(Utc::now());
        session.last_heartbeat_at = None;
        session.recognition_attempts = 0;
        session.last_detection_summary = None;
        session.turn_indicator = None;
        session.manual_turn_override = None;
        session.pending_external_move = None;
        session.pending_expected_fen = None;
        session.screenshot_move_marker = None;
        session.screenshot_resolution_before_fen = None;
        session.screenshot_resolution_generation = None;
        session.screenshot_resolution_mode = None;
        session.screenshot_resolution_game_id = None;
        session.screenshot_resolution_current_node = None;
        session.screenshot_resolution_allowed_moves.clear();
        session.latest_fen = None;
        session.confidence = None;
        session.confidence_threshold = confidence_threshold;
        session.frame_rate = 0.0;
        reset_link_stability_progress(&mut session);
        session.capture_generation = generation;
        drop(session);
        if let Err(error) = start_window_link_capture(app.clone(), None, generation, None) {
            set_link_capture_error(&app, generation, error.clone());
            restore_link_hint_window(&app);
            return Err(error);
        }
        restore_link_hint_window(&app);
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        return Ok(link_status_dto(&session));
    }
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if matches!(session.state, LinkSessionState::Stopped) {
        return Err("请先启动连线会话".into());
    }
    session.gate.reset();
    session.state = LinkSessionState::Calibrating;
    session.reason = Some("请重新框选第三方窗口中的棋盘区域".into());
    session.phase = Some("recalibrating".into());
    Ok(link_status_dto(&session))
}

#[tauri::command]
pub(crate) fn get_link_capture_preview(
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    Ok(state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?
        .capture_preview
        .clone())
}

#[tauri::command]
pub(crate) fn recognize_link_image_file(
    path: String,
    source: CaptureSource,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<LinkObservationDto, String> {
    if !matches!(
        source,
        CaptureSource::ImageImport | CaptureSource::CameraBoard
    ) {
        return Err("只有截图/照片和实体棋盘相机模式支持选择图片识别".into());
    }
    // Invalidate before any filesystem or model work. An unreadable or
    // oversized replacement image must never leave the prior screenshot's
    // confirmation token usable in the backend.
    let generation = {
        let _resolution_guard = state
            .screenshot_resolution_guard
            .lock()
            .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
        let generation = state.link_capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        session.source = source;
        session.board_orientation = BoardOrientation::RedAtBottom;
        session.capture_generation = generation;
        session.capture_preview = None;
        session.capture_preview_kind = None;
        session.last_move = None;
        session.last_move_detail = None;
        session.board_bounds = None;
        session.piece_click_centers.clear();
        session.board_capture_signature = None;
        session.target_region = None;
        session.target_window = None;
        session.capture_backend = None;
        session.capture_dpi = None;
        session.capture_window_geometry = None;
        session.click_available = false;
        invalidate_screenshot_move_resolution(&mut session);
        session.state = LinkSessionState::ClassifyingSquares;
        session.phase = Some("image_preflight".into());
        session.reason = Some("正在准备识别截图/照片局面…".into());
        session.last_error = None;
        session.capture_running = false;
        session.last_heartbeat_at = Some(Utc::now());
        generation
    };
    emit_link_session_updated(&app);
    let image_path = PathBuf::from(path);
    if !image_path.is_file() {
        let error = "未找到要识别的图片文件".to_owned();
        set_link_capture_error(&app, generation, error.clone());
        return Err(error);
    }
    let bytes = match fs::read(&image_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let error = format!("无法读取图片：{error}");
            set_link_capture_error(&app, generation, error.clone());
            return Err(error);
        }
    };
    if bytes.len() > 16 * 1024 * 1024 {
        let error = "图片过大，请裁剪到只包含棋盘后重试".to_owned();
        set_link_capture_error(&app, generation, error.clone());
        return Err(error);
    }
    let confidence_threshold = desktop_link_confidence_threshold(&state);
    {
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        session.source = source;
        session.recognition_mode = RecognitionMode::YoloBoard;
        session.mode = LinkMode::Spectate;
        session.capture_preview = Some(format!(
            "data:{};base64,{}",
            image_mime_type(&image_path),
            BASE64.encode(&bytes)
        ));
        session.capture_preview_kind = Some("图片预览".into());
        session.reason = Some(match source {
            CaptureSource::CameraBoard => "正在识别实体棋盘拍照图片…".into(),
            _ => "正在识别截图/照片局面…".into(),
        });
        session.phase = Some("image_inference".into());
        session.last_error = None;
        session.started_at = Some(Utc::now());
        session.last_heartbeat_at = Some(Utc::now());
        session.recognition_attempts = 0;
        session.last_detection_summary = None;
        session.turn_indicator = None;
        session.manual_turn_override = None;
        session.pending_external_move = None;
        session.pending_expected_fen = None;
        // A new image invalidates every marker and proposal from the prior
        // image before inference begins.  Otherwise a failed second image
        // could leave an old move visibly actionable in the dialog.
        session.screenshot_move_marker = None;
        session.screenshot_resolution_before_fen = None;
        session.screenshot_resolution_generation = None;
        session.screenshot_resolution_mode = None;
        session.screenshot_resolution_game_id = None;
        session.screenshot_resolution_current_node = None;
        session.screenshot_resolution_allowed_moves.clear();
        session.state = LinkSessionState::ClassifyingSquares;
        session.gate = StabilityGate::new(1);
        reset_link_stability_progress(&mut session);
        session.confidence = None;
        session.confidence_threshold = confidence_threshold;
        session.frame_rate = 0.0;
        session.latest_fen = None;
        session.last_move = None;
        session.last_move_detail = None;
        session.initial_position_seen = false;
        session.auto_side = None;
        session.capture_running = false;
        session.board_bounds = None;
        session.piece_click_centers.clear();
        session.board_capture_signature = None;
        session.target_region = None;
        session.capture_generation = generation;
    }
    emit_link_session_updated(&app);

    let model_path = match link_model_path(&app) {
        Ok(path) => path,
        Err(error) => {
            set_link_capture_error(&app, generation, error.clone());
            return Err(error);
        }
    };
    if let Err(error) = validate_link_model(&model_path) {
        set_link_capture_error(&app, generation, error.clone());
        return Err(error);
    }
    let mut detector = match link_vision::Yolo11Detector::open(&model_path) {
        Ok(detector) => detector,
        Err(error) => {
            let error = format!("模型加载失败：{error}");
            set_link_capture_error(&app, generation, error.clone());
            return Err(error);
        }
    };
    let board = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .board
        .clone();
    let detections = match detector.detect_png(&bytes) {
        Ok(detections) => detections,
        Err(error) => {
            let reason = format!("图片棋盘识别未完成：{error}");
            set_link_capture_error(&app, generation, reason.clone());
            let current_board = {
                let model = state
                    .model
                    .lock()
                    .map_err(|_| "state lock poisoned".to_owned())?;
                recognized_board_snapshot(&model, &model.board)?
            };
            return Ok(LinkObservationDto {
                state: LinkSessionState::NeedsManualCorrection,
                accepted: false,
                move_iccs: None,
                reason: Some(reason),
                board: Some(current_board),
                orientation: BoardOrientation::RedAtBottom,
                capture_preview_available: true,
            });
        }
    };
    set_link_capture_detection_summary(&app, generation, "图片识别", &detections);
    if let Some(bounds) = link_vision::board_bounds(&detections) {
        if let Ok(mut session) = state.link_session.lock() {
            if session.capture_generation == generation {
                session.board_bounds = Some(bounds);
            }
        }
    }
    let recognition = match link_vision::recognition_from_detections(&detections, &board) {
        Ok(recognition) => recognition,
        Err(error) => {
            let reason = format!("图片未识别到可同步棋盘：{error}");
            set_link_capture_error(&app, generation, reason.clone());
            // Recognition failure is not a reason to strand the user without
            // a legal recovery board.  The recovery board is the current
            // document, never an approximate position reconstructed from the
            // failed image.
            let current_board = {
                let model = state
                    .model
                    .lock()
                    .map_err(|_| "state lock poisoned".to_owned())?;
                recognized_board_snapshot(&model, &model.board)?
            };
            return Ok(LinkObservationDto {
                state: LinkSessionState::NeedsManualCorrection,
                accepted: false,
                move_iccs: None,
                reason: Some(reason),
                board: Some(current_board),
                orientation: BoardOrientation::RedAtBottom,
                capture_preview_available: true,
            });
        }
    };
    let turn_indicator =
        link_vision::detect_turn_indicator_from_png(&bytes, &detections, recognition.orientation)
            .unwrap_or(None);
    let manual_turn_override = state.link_session.lock().ok().and_then(|session| {
        (session.capture_generation == generation)
            .then_some(session.manual_turn_override)
            .flatten()
    });
    let recognition = if manual_turn_override.is_some() {
        link_vision::recognition_with_side_to_move(recognition, board.side_to_move())
    } else if let Some(side) = turn_indicator.as_ref().map(|indicator| indicator.side) {
        link_vision::recognition_with_side_to_move(recognition, side)
    } else {
        recognition
    };
    let screenshot_move_marker = link_vision::detect_screenshot_move_marker_from_png(
        &bytes,
        &detections,
        recognition.orientation,
    )
    .unwrap_or(None);
    if let Ok(mut session) = state.link_session.lock() {
        if session.capture_generation == generation {
            session.board_orientation = recognition.orientation;
            if let Some(bounds) = link_vision::board_bounds(&detections) {
                session.piece_click_centers = link_piece_click_centers(
                    &detections,
                    bounds,
                    recognition.orientation,
                    None,
                    None,
                );
            }
            session.turn_indicator = Some(link_turn_indicator_message(
                manual_turn_override,
                turn_indicator.as_ref(),
            ));
            session.screenshot_move_marker = screenshot_move_marker;
            session.phase = Some("recognized".into());
            session.reason = Some("图片局面已识别；正在和当前棋谱逐一核对合法上一着…".into());
        }
    }
    // A file import is evidence for a position, not an instruction to alter the
    // current manual tree. The recognized FEN is used to filter all legal
    // one-ply continuations before any white marker can influence their order.
    let recognized_board = match Board::from_fen(&recognition.fen) {
        Ok(board) => board,
        Err(error) => {
            let reason = format!("图片局面无法通过棋规校验：{error}");
            set_link_capture_error(&app, generation, reason.clone());
            let current_board = {
                let model = state
                    .model
                    .lock()
                    .map_err(|_| "state lock poisoned".to_owned())?;
                recognized_board_snapshot(&model, &model.board)?
            };
            return Ok(LinkObservationDto {
                state: LinkSessionState::NeedsManualCorrection,
                accepted: false,
                move_iccs: None,
                reason: Some(reason),
                board: Some(current_board),
                orientation: recognition.orientation,
                capture_preview_available: true,
            });
        }
    };
    let board = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        recognized_board_snapshot(&model, &recognized_board)?
    };
    if let Ok(mut session) = state.link_session.lock() {
        if session.capture_generation == generation {
            session.latest_fen = Some(recognition.fen);
            session.state = LinkSessionState::Tracking;
            session.phase = Some("awaiting_move_confirmation".into());
            session.reason =
                Some("图片局面已识别；请核对待确认的上一着，或手工点选起点和终点".into());
        }
    }
    let observation = LinkObservationDto {
        state: LinkSessionState::Tracking,
        accepted: false,
        move_iccs: None,
        reason: Some("图片局面已识别；正在按当前棋谱的合法一步核对上一着".into()),
        board: Some(board),
        orientation: recognition.orientation,
        capture_preview_available: true,
    };
    emit_link_session_updated(&app);
    Ok(observation)
}

pub(crate) fn image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    }
}

pub(crate) fn png_data_uri(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", BASE64.encode(bytes))
}

#[tauri::command]
pub(crate) fn complete_link_region_selection(
    selection: LinkRegionSelectionDto,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let window = app
        .get_webview_window("link-selection")
        .ok_or("选区窗口已关闭，请重新启动连线")?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let origin = window.outer_position().map_err(|error| error.to_string())?;
    let inner = window.inner_size().map_err(|error| error.to_string())?;
    let selector_width = inner.width as f64 / scale;
    let selector_height = inner.height as f64 / scale;
    let x = (origin.x as f64 / scale + selection.x).round() as i32;
    let y = (origin.y as f64 / scale + selection.y).round() as i32;
    let width = selection.width.round() as i32;
    let height = selection.height.round() as i32;
    if width < 80 || height < 80 {
        return Err("框选区域过小，请至少覆盖完整棋盘".into());
    }
    let region = LinkCaptureRegion {
        x,
        y,
        width,
        height,
        selection_x: selection.x,
        selection_y: selection.y,
        selection_width: selection.width,
        selection_height: selection.height,
        selector_width,
        selector_height,
    };
    let (lock, cvar) = &state.link_region_selection;
    *lock
        .lock()
        .map_err(|_| "link selection lock poisoned".to_owned())? = Some(Ok(region));
    cvar.notify_all();
    let _ = window.destroy();
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_link_region_selection(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (lock, cvar) = &state.link_region_selection;
    *lock
        .lock()
        .map_err(|_| "link selection lock poisoned".to_owned())? =
        Some(Err("已取消棋盘区域框选".into()));
    cvar.notify_all();
    if let Some(window) = app.get_webview_window("link-selection") {
        let _ = window.destroy();
    }
    restore_main_window(&app);
    restore_link_hint_window(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_link_region_selection_background(
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    state
        .link_region_selection_background
        .lock()
        .map(|background| background.clone())
        .map_err(|_| "link selection background lock poisoned".to_owned())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn capture_window_link_preview(
    app: &tauri::AppHandle,
    state: &DesktopState,
) -> Result<Option<LinkCapturePreview>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        prepare_window_link_selection(app);
        #[cfg(target_os = "macos")]
        std::thread::sleep(Duration::from_millis(250));
        let desktop_snapshot = capture_display_frame(None)?;
        set_link_region_selection_background(state, Some(png_data_uri(&desktop_snapshot)))?;
        reset_link_region_selection(state)?;
        open_link_region_selection_window(app)?;
        let Some(region) = wait_for_link_region_selection(state, Duration::from_secs(60))? else {
            if let Some(window) = app.get_webview_window("link-selection") {
                let _ = window.destroy();
            }
            set_link_region_selection_background(state, None)?;
            return Ok(None);
        };
        let bytes = match crop_link_capture_frame(&desktop_snapshot, region) {
            Ok(bytes) => bytes,
            Err(error) => {
                restore_link_hint_window(app);
                set_link_region_selection_background(state, None)?;
                return Err(error);
            }
        };
        restore_link_hint_window(app);
        set_link_region_selection_background(state, None)?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("框选图片过大，请只选择棋盘区域后重试".into());
        }
        Ok(Some(LinkCapturePreview {
            data_uri: png_data_uri(&bytes),
            png: bytes,
            region: Some(region),
        }))
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = (app, state);
        Err("当前平台尚未接入系统框选；请先使用截图/照片导入".into())
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn reset_link_region_selection(state: &DesktopState) -> Result<(), String> {
    let (lock, _) = &state.link_region_selection;
    *lock
        .lock()
        .map_err(|_| "link selection lock poisoned".to_owned())? = None;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn set_link_region_selection_background(
    state: &DesktopState,
    background: Option<String>,
) -> Result<(), String> {
    *state
        .link_region_selection_background
        .lock()
        .map_err(|_| "link selection background lock poisoned".to_owned())? = background;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn wait_for_link_region_selection(
    state: &DesktopState,
    timeout: Duration,
) -> Result<Option<LinkCaptureRegion>, String> {
    let (lock, cvar) = &state.link_region_selection;
    let started = Instant::now();
    let mut guard = lock
        .lock()
        .map_err(|_| "link selection lock poisoned".to_owned())?;
    loop {
        if let Some(result) = guard.take() {
            return result.map(Some);
        }
        let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
            return Ok(None);
        };
        let (next_guard, wait) = cvar
            .wait_timeout(guard, remaining)
            .map_err(|_| "link selection lock poisoned".to_owned())?;
        guard = next_guard;
        if wait.timed_out() {
            return Ok(None);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn open_link_region_selection_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("link-selection") {
        let _ = window.destroy();
    }
    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("未找到可用于框选的主显示器")?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let position = monitor.position();
    tauri::WebviewWindowBuilder::new(
        app,
        "link-selection",
        tauri::WebviewUrl::App("index.html?linkRegionSelector=1".into()),
    )
    .title("Xiangqi Studio · 选择棋盘区域")
    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
    .position(position.x as f64 / scale, position.y as f64 / scale)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window("link-selection") {
        let _ = window.set_focus();
    }
    Ok(())
}

pub(crate) fn prepare_window_link_selection(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.hide();
    }
}

pub(crate) fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

pub(crate) fn restore_link_hint_window(app: &tauri::AppHandle) {
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.show();
        let _ = link_window.set_focus();
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn restore_link_window_or_main(app: &tauri::AppHandle) {
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.show();
        let _ = link_window.set_focus();
    } else {
        restore_main_window(app);
    }
}

pub(crate) fn rects_intersect(left: (f64, f64, f64, f64), right: (f64, f64, f64, f64)) -> bool {
    let (left_x, left_y, left_width, left_height) = left;
    let (right_x, right_y, right_width, right_height) = right;
    left_x < right_x + right_width
        && left_x + left_width > right_x
        && left_y < right_y + right_height
        && left_y + left_height > right_y
}

pub(crate) fn link_region_rect(region: LinkCaptureRegion) -> (f64, f64, f64, f64) {
    (
        region.x as f64,
        region.y as f64,
        region.width.max(1) as f64,
        region.height.max(1) as f64,
    )
}

pub(crate) fn link_region_monitor_origin(region: LinkCaptureRegion) -> (f64, f64) {
    (
        region.x as f64 - region.selection_x,
        region.y as f64 - region.selection_y,
    )
}

pub(crate) fn link_region_from_screen_rect(
    reference: LinkCaptureRegion,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> LinkCaptureRegion {
    let (origin_x, origin_y) = link_region_monitor_origin(reference);
    let selector_width = reference.selector_width.max(1.0);
    let selector_height = reference.selector_height.max(1.0);
    let selection_x = (x - origin_x).clamp(0.0, selector_width - 1.0);
    let selection_y = (y - origin_y).clamp(0.0, selector_height - 1.0);
    let selection_width = width
        .max(16.0)
        .min((selector_width - selection_x).max(16.0));
    let selection_height = height
        .max(16.0)
        .min((selector_height - selection_y).max(16.0));
    LinkCaptureRegion {
        x: (origin_x + selection_x).round() as i32,
        y: (origin_y + selection_y).round() as i32,
        width: selection_width.round() as i32,
        height: selection_height.round() as i32,
        selection_x,
        selection_y,
        selection_width,
        selection_height,
        selector_width,
        selector_height,
    }
}

pub(crate) fn expand_link_capture_region(region: LinkCaptureRegion) -> LinkCaptureRegion {
    let width = region.width.max(1) as f64;
    let height = region.height.max(1) as f64;
    let margin_left = (width * 0.22).max(72.0);
    // 天天象棋横屏界面的轮走提示在棋盘右侧玩家头像处；用户只框棋盘时，
    // 持续采集帧需要向右多留一段空间，才能读到绿色头像高亮。
    let margin_right = (width * 0.85).max(220.0);
    let margin_y = (height * 0.45).max(96.0);
    link_region_from_screen_rect(
        region,
        region.x as f64 - margin_left,
        region.y as f64 - margin_y,
        width + margin_left + margin_right,
        height + margin_y * 2.0,
    )
}

pub(crate) fn link_capture_guard_region(region: LinkCaptureRegion) -> LinkCaptureRegion {
    let width = region.width.max(1) as f64;
    let height = region.height.max(1) as f64;
    // Guard only the real board body. The actual capture area is intentionally
    // wider/taller so 天天象棋 side avatars can be read, but touching that
    // expanded margin should not freeze live board sync after the user drags
    // the floating link panel.
    let inset_x = (width * 0.06).min(28.0);
    let inset_y = (height * 0.06).min(28.0);
    link_region_from_screen_rect(
        region,
        region.x as f64 + inset_x,
        region.y as f64 + inset_y,
        (width - inset_x * 2.0).max(16.0),
        (height - inset_y * 2.0).max(16.0),
    )
}

pub(crate) fn select_link_capture_frame_region(
    tracking_region: Option<LinkCaptureRegion>,
    expanded_region_overlaps_floating_panel: bool,
) -> Option<LinkCaptureRegion> {
    let Some(region) = tracking_region else {
        return None;
    };
    if expanded_region_overlaps_floating_panel {
        Some(region)
    } else {
        Some(expand_link_capture_region(region))
    }
}

pub(crate) fn link_region_around_board_bounds(
    reference: LinkCaptureRegion,
    bounds: (f32, f32, f32, f32),
) -> LinkCaptureRegion {
    let (x, y, width, height) = (
        bounds.0 as f64,
        bounds.1 as f64,
        bounds.2.max(16.0) as f64,
        bounds.3.max(16.0) as f64,
    );
    let margin_x = (width * 0.08).max(18.0);
    let margin_y = (height * 0.08).max(18.0);
    link_region_from_screen_rect(
        reference,
        x - margin_x,
        y - margin_y,
        width + margin_x * 2.0,
        height + margin_y * 2.0,
    )
}

pub(crate) fn link_window_rect(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let scale = window.scale_factor().ok()?.max(0.01);
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

pub(crate) fn link_window_intersects_region(
    window: &tauri::WebviewWindow,
    region: LinkCaptureRegion,
) -> bool {
    link_window_rect(window)
        .map(|window_rect| rects_intersect(window_rect, link_region_rect(region)))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn relocate_link_hint_window_away_from_region(
    app: &tauri::AppHandle,
    region: LinkCaptureRegion,
) {
    let Some(window) = app.get_webview_window("compact-link") else {
        return;
    };
    if !link_window_intersects_region(&window, region) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    let window_width = window_size.width as f64 / scale;
    let window_height = window_size.height as f64 / scale;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let monitor_scale = monitor.scale_factor().max(0.01);
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let monitor_x = monitor_position.x as f64 / monitor_scale;
    let monitor_y = monitor_position.y as f64 / monitor_scale;
    let monitor_width = monitor_size.width as f64 / monitor_scale;
    let monitor_height = monitor_size.height as f64 / monitor_scale;
    let margin = 20.0;
    let clamp_x = |value: f64| {
        value.clamp(
            monitor_x + margin,
            (monitor_x + monitor_width - window_width - margin).max(monitor_x + margin),
        )
    };
    let clamp_y = |value: f64| {
        value.clamp(
            monitor_y + margin,
            (monitor_y + monitor_height - window_height - margin).max(monitor_y + margin),
        )
    };
    let region_rect = link_region_rect(region);
    let candidates = [
        (
            region.x as f64 - window_width - margin,
            region.y as f64 + region.height as f64 - window_height,
        ),
        (
            region.x as f64 + region.width as f64 + margin,
            region.y as f64 + region.height as f64 - window_height,
        ),
        (region.x as f64 - window_width - margin, region.y as f64),
        (
            region.x as f64 + region.width as f64 + margin,
            region.y as f64,
        ),
        (
            monitor_x + margin,
            monitor_y + monitor_height - window_height - margin,
        ),
    ];
    let (x, y) = candidates
        .into_iter()
        .map(|(x, y)| (clamp_x(x), clamp_y(y)))
        .find(|(x, y)| !rects_intersect((*x, *y, window_width, window_height), region_rect))
        .unwrap_or((
            monitor_x + margin,
            monitor_y + monitor_height - window_height - margin,
        ));
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
}

pub(crate) fn link_hint_window_overlaps_region(
    app: &tauri::AppHandle,
    region: Option<LinkCaptureRegion>,
) -> bool {
    let Some(region) = region else {
        return false;
    };
    let Some(window) = app.get_webview_window("compact-link") else {
        return false;
    };
    if !link_window_intersects_region(&window, region) {
        return false;
    }
    true
}

pub(crate) fn color_name(color: Color) -> String {
    match color {
        Color::Red => "red".into(),
        Color::Black => "black".into(),
    }
}

pub(crate) fn link_move_detail(board: &Board, mv: Move) -> Result<LinkMoveDetailDto, String> {
    let moved_by = board
        .piece_at(mv.from)
        .ok_or_else(|| "move source is empty".to_owned())?
        .color;
    Ok(LinkMoveDetailDto {
        iccs: mv.to_iccs(),
        notation: board
            .chinese_move_notation(mv)
            .map_err(|error| error.to_string())?,
        moved_by: side_label(moved_by),
        from: SquareDto {
            row: mv.from.row,
            col: mv.from.col,
        },
        to: SquareDto {
            row: mv.to.row,
            col: mv.to.col,
        },
    })
}

pub(crate) fn link_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    candidates.extend(link_vision_candidates(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .as_path(),
    ));
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(link_vision_candidates(&resource_dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(link_vision_candidates(parent));
            candidates.extend(link_vision_candidates(&parent.join("../Resources")));
        }
    }
    let attempted = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("；");
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("YOLO11 模型资源路径异常，未找到随包模型；已尝试：{attempted}"))
}

pub(crate) fn link_vision_candidates(base: &Path) -> Vec<PathBuf> {
    [
        "link-vision/yolov11.onnx",
        "resources/link-vision/yolov11.onnx",
    ]
    .into_iter()
    .map(|relative| base.join(relative))
    .collect()
}

pub(crate) fn validate_link_model(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let actual = format!("{:x}", digest.finalize());
    const EXPECTED: &str = "099c4ef0cbfbd07f680037bb1aabf59024f5c0243964b36aeec7c7a57f7213e1";
    if actual == EXPECTED {
        Ok(())
    } else {
        Err("YOLO11 模型哈希校验失败，已拒绝启动连线识别".into())
    }
}

pub(crate) fn start_window_link_capture(
    app: tauri::AppHandle,
    initial_frame: Option<Vec<u8>>,
    generation: u64,
    capture_region: Option<LinkCaptureRegion>,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("xiangqi-link-capture".into())
        .spawn(move || {
            let app_for_error = app.clone();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                set_link_capture_progress(
                    &app,
                    generation,
                    "load_model",
                    "正在加载本地棋盘识别模型，首次启动可能需要几秒…",
                );
                let path = match link_model_path(&app).and_then(|path| {
                    validate_link_model(&path)?;
                    Ok(path)
                }) {
                    Ok(path) => path,
                    Err(error) => {
                        set_link_capture_error(&app, generation, error);
                        return;
                    }
                };
                let mut detector = match link_vision::Yolo11Detector::open(&path) {
                    Ok(detector) => detector,
                    Err(error) => {
                        set_link_capture_error(&app, generation, format!("模型加载失败：{error}"));
                        return;
                    }
                };
                let mut tracking_region = capture_region;
                if let Some(frame) = initial_frame {
                    set_link_capture_progress(
                        &app,
                        generation,
                        "preview_inference",
                        "模型已加载，正在识别框选预览…",
                    );
                    if let Some(next_region) = process_link_capture_frame(
                        &app,
                        generation,
                        &mut detector,
                        &frame,
                        false,
                        capture_region,
                        None,
                        None,
                        "框选预览",
                    ) {
                        tracking_region = Some(next_region);
                    }
                }
                let mut previous = Instant::now();
                loop {
                    let should_run = app
                        .state::<DesktopState>()
                        .link_session
                        .lock()
                        .map(|session| {
                            session.capture_generation == generation
                                && session.capture_running
                                && !matches!(session.state, LinkSessionState::Stopped)
                        })
                        .unwrap_or(false);
                    if !should_run {
                        break;
                    }
                    let started = Instant::now();
                    set_link_capture_progress(
                        &app,
                        generation,
                        "screen_capture",
                        "正在跟踪框选区域附近的棋盘；若网页棋盘位置变化，请重新框选。",
                    );
                    let guard_region = tracking_region.map(link_capture_guard_region);
                    if link_hint_window_overlaps_region(&app, guard_region) {
                        set_link_capture_waiting(
                            &app,
                            generation,
                            "连线浮窗挡住棋盘主体，已暂停本帧截图；拖离棋盘后会自动继续。".into(),
                        );
                        if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                            if session.capture_generation == generation {
                                session.frame_rate = 0.0;
                                session.last_heartbeat_at = Some(Utc::now());
                            }
                        }
                        emit_link_session_updated(&app);
                        std::thread::sleep(Duration::from_millis(333));
                        continue;
                    }
                    let expanded_region = tracking_region.map(expand_link_capture_region);
                    let expanded_region_overlaps_floating_panel =
                        link_hint_window_overlaps_region(&app, expanded_region);
                    let frame_region = select_link_capture_frame_region(
                        tracking_region,
                        expanded_region_overlaps_floating_panel,
                    );
                    if expanded_region_overlaps_floating_panel {
                        set_link_capture_progress(
                            &app,
                            generation,
                            "screen_capture",
                            "连线浮窗靠近扩展识别区，已自动改为只采集棋盘主体以保持同步。",
                        );
                    }
                    match capture_live_link_frame(&app, frame_region) {
                        Ok(frame) => {
                            if let Some(dpi) = frame.dpi {
                                if let Ok(mut session) =
                                    app.state::<DesktopState>().link_session.lock()
                                {
                                    if session.capture_generation == generation {
                                        session.capture_dpi = Some(dpi);
                                    }
                                }
                            }
                            if let Some(next_region) = process_link_capture_frame(
                                &app,
                                generation,
                                &mut detector,
                                &frame.png,
                                true,
                                frame_region,
                                frame.screen_origin,
                                frame.target_geometry,
                                if frame.screen_origin.is_some() {
                                    "目标窗口采集"
                                } else {
                                    "屏幕采集"
                                },
                            ) {
                                tracking_region = Some(next_region);
                            }
                        }
                        Err(error) => set_link_capture_error(&app, generation, error),
                    }
                    let elapsed = previous.elapsed().as_secs_f32();
                    previous = Instant::now();
                    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                        if session.capture_generation == generation {
                            session.frame_rate = if elapsed > 0.0 { 1.0 / elapsed } else { 0.0 };
                            session.last_heartbeat_at = Some(Utc::now());
                        }
                    }
                    emit_link_session_updated(&app);
                    let delay = Duration::from_millis(333).saturating_sub(started.elapsed());
                    std::thread::sleep(delay);
                }
            }));
            if let Err(payload) = result {
                let detail = payload
                    .downcast_ref::<&str>()
                    .map(|value| (*value).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "未知 panic".to_owned());
                set_link_capture_error(
                    &app_for_error,
                    generation,
                    format!("识别线程异常退出：{detail}"),
                );
            }
        })
        .map_err(|error| format!("无法启动连线识别线程：{error}"))?;
    Ok(())
}

pub(crate) fn process_link_capture_frame(
    app: &tauri::AppHandle,
    generation: u64,
    detector: &mut link_vision::Yolo11Detector,
    frame: &[u8],
    update_bounds: bool,
    capture_region: Option<LinkCaptureRegion>,
    capture_screen_origin: Option<(i32, i32)>,
    capture_window_geometry: Option<LinkWindowGeometry>,
    source_label: &str,
) -> Option<LinkCaptureRegion> {
    if !link_capture_generation_is_active(app, generation) {
        return None;
    }
    set_link_capture_progress(
        app,
        generation,
        "model_inference",
        &format!("{source_label}正在进行模型推理…"),
    );
    let board = match app.state::<DesktopState>().model.lock() {
        Ok(model) => model.board.clone(),
        Err(_) => {
            set_link_capture_error(app, generation, "棋谱状态暂时不可用".into());
            return None;
        }
    };
    let detections = match detector.detect_png(frame) {
        Ok(detections) => detections,
        Err(error) => {
            set_link_capture_waiting(
                app,
                generation,
                format!("{source_label}未识别到可同步棋盘：{error}"),
            );
            return None;
        }
    };
    set_link_capture_detection_summary(app, generation, source_label, &detections);
    let board_bounds = link_vision::board_bounds(&detections);
    if let Some(bounds) = board_bounds {
        set_link_capture_board_preview(app, generation, frame, bounds, source_label);
    }
    let frame_dimensions = capture_region.and_then(|_| png_dimensions(frame).ok());
    let screen_bounds = update_bounds
        .then(|| {
            board_bounds.map(|bounds| {
                if let Some(region) = capture_region {
                    map_capture_bounds_to_screen(bounds, region, frame_dimensions)
                } else if let Some((origin_x, origin_y)) = capture_screen_origin {
                    (
                        bounds.0 + origin_x as f32,
                        bounds.1 + origin_y as f32,
                        bounds.2,
                        bounds.3,
                    )
                } else {
                    bounds
                }
            })
        })
        .flatten();
    let next_region = capture_region
        .zip(screen_bounds)
        .map(|(region, bounds)| link_region_around_board_bounds(region, bounds));
    let board_capture_signature = capture_window_geometry
        .zip(board_bounds)
        .and_then(|(_, bounds)| link_capture_board_signature(frame, bounds).ok());
    match link_vision::recognition_from_detections(&detections, &board) {
        Ok(recognition) => {
            let turn_indicator = link_vision::detect_turn_indicator_from_png(
                frame,
                &detections,
                recognition.orientation,
            )
            .unwrap_or(None);
            let manual_turn_override = app
                .state::<DesktopState>()
                .link_session
                .lock()
                .ok()
                .and_then(|session| {
                    (session.capture_generation == generation)
                        .then_some(session.manual_turn_override)
                        .flatten()
                });
            let recognition = if manual_turn_override.is_some() {
                link_vision::recognition_with_side_to_move(recognition, board.side_to_move())
            } else if let Some(side) = turn_indicator.as_ref().map(|indicator| indicator.side) {
                link_vision::recognition_with_side_to_move(recognition, side)
            } else {
                recognition
            };
            let recognized_piece_click_centers = board_bounds
                .map(|bounds| {
                    link_piece_click_centers(
                        &detections,
                        bounds,
                        recognition.orientation,
                        capture_region,
                        frame_dimensions,
                    )
                })
                .unwrap_or_default()
                .into_iter()
                .map(|mut center| {
                    if capture_region.is_none() {
                        if let Some((origin_x, origin_y)) = capture_screen_origin {
                            center.x += origin_x as f32;
                            center.y += origin_y as f32;
                        }
                    }
                    center
                })
                .collect::<Vec<_>>();
            if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                if session.capture_generation != generation {
                    return next_region;
                }
                session.turn_indicator = Some(link_turn_indicator_message(
                    manual_turn_override,
                    turn_indicator.as_ref(),
                ));
                session.phase = Some("recognized".into());
                if source_label == "框选预览" {
                    session.reason = Some("框选预览已识别，等待稳定帧同步与引擎分析…".into());
                }
            }
            let fen = recognition.fen.clone();
            match observe_link_recognition(app, generation, fen, recognition.confidence) {
                Ok(observation) => {
                    if observation.accepted {
                        if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                            if session.capture_generation == generation {
                                session.board_orientation = recognition.orientation;
                                session.piece_click_centers = recognized_piece_click_centers;
                                session.board_bounds = screen_bounds;
                                session.capture_window_geometry = capture_window_geometry;
                                session.board_capture_signature = board_capture_signature;
                                if let Some(region) = next_region {
                                    session.target_region = Some(region);
                                }
                            }
                        }
                    }
                }
                Err(error) => set_link_capture_error(app, generation, error),
            }
        }
        Err(error) => set_link_capture_waiting(
            app,
            generation,
            format!("{source_label}未识别到可同步棋盘：{error}"),
        ),
    }
    next_region
}

pub(crate) fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let image = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    Ok((image.width(), image.height()))
}

pub(crate) fn link_capture_board_signature(
    frame: &[u8],
    bounds: (f32, f32, f32, f32),
) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(frame).map_err(|error| error.to_string())?;
    let (x, y, width, height) = bounds;
    let left = x.floor().clamp(0.0, source.width() as f32) as u32;
    let top = y.floor().clamp(0.0, source.height() as f32) as u32;
    let right = (x + width).ceil().clamp(0.0, source.width() as f32) as u32;
    let bottom = (y + height).ceil().clamp(0.0, source.height() as f32) as u32;
    let width = right.saturating_sub(left);
    let height = bottom.saturating_sub(top);
    if width < 16 || height < 16 {
        return Err("当前棋盘区域过小，无法核对确认走子".into());
    }
    let board = source.crop_imm(left, top, width, height).to_rgba8();
    let mut digest = Sha256::new();
    digest.update(board.as_raw());
    Ok(digest.finalize().to_vec())
}

pub(crate) fn crop_png_by_bounds(
    frame: &[u8],
    bounds: (f32, f32, f32, f32),
    margin_ratio: f32,
) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(frame).map_err(|error| error.to_string())?;
    let image_width = source.width();
    let image_height = source.height();
    if image_width == 0 || image_height == 0 {
        return Err("截图尺寸异常，无法生成棋盘预览".into());
    }
    let (x, y, width, height) = bounds;
    let margin_x = (width * margin_ratio).max(4.0);
    let margin_y = (height * margin_ratio).max(4.0);
    let left = (x - margin_x).floor().clamp(0.0, image_width as f32) as u32;
    let top = (y - margin_y).floor().clamp(0.0, image_height as f32) as u32;
    let right = (x + width + margin_x).ceil().clamp(0.0, image_width as f32) as u32;
    let bottom = (y + height + margin_y)
        .ceil()
        .clamp(0.0, image_height as f32) as u32;
    let crop_width = right.saturating_sub(left);
    let crop_height = bottom.saturating_sub(top);
    if crop_width < 16 || crop_height < 16 {
        return Err("棋盘预览裁剪后过小".into());
    }
    let cropped = source.crop_imm(left, top, crop_width, crop_height);
    let mut output = Cursor::new(Vec::new());
    cropped
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

pub(crate) fn link_region_crop_rect(
    region: LinkCaptureRegion,
    image_width: u32,
    image_height: u32,
) -> Result<(u32, u32, u32, u32), String> {
    if image_width == 0 || image_height == 0 {
        return Err("屏幕截图尺寸异常，无法裁剪框选区域".into());
    }
    if region.selector_width <= 0.0 || region.selector_height <= 0.0 {
        return Err("框选窗口尺寸异常，请重新启动连线".into());
    }
    let clamp_x = |value: f64| value.round().clamp(0.0, image_width as f64) as u32;
    let clamp_y = |value: f64| value.round().clamp(0.0, image_height as f64) as u32;
    let left = clamp_x(region.selection_x / region.selector_width * image_width as f64);
    let top = clamp_y(region.selection_y / region.selector_height * image_height as f64);
    let right = clamp_x(
        (region.selection_x + region.selection_width) / region.selector_width * image_width as f64,
    );
    let bottom = clamp_y(
        (region.selection_y + region.selection_height) / region.selector_height
            * image_height as f64,
    );
    let width = right.saturating_sub(left);
    let height = bottom.saturating_sub(top);
    if width < 16 || height < 16 {
        return Err("框选区域裁剪后过小，请重新框选完整棋盘".into());
    }
    Ok((left, top, width, height))
}

pub(crate) fn crop_link_capture_frame(
    frame: &[u8],
    region: LinkCaptureRegion,
) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(frame).map_err(|error| error.to_string())?;
    let (left, top, width, height) =
        link_region_crop_rect(region, source.width(), source.height())?;
    let cropped = source.crop_imm(left, top, width, height);
    let mut output = Cursor::new(Vec::new());
    cropped
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

pub(crate) fn map_capture_bounds_to_screen(
    bounds: (f32, f32, f32, f32),
    region: LinkCaptureRegion,
    frame_dimensions: Option<(u32, u32)>,
) -> (f32, f32, f32, f32) {
    let (frame_width, frame_height) =
        frame_dimensions.unwrap_or((region.width.max(1) as u32, region.height.max(1) as u32));
    let scale_x = (frame_width as f32 / region.width.max(1) as f32).max(0.01);
    let scale_y = (frame_height as f32 / region.height.max(1) as f32).max(0.01);
    (
        region.x as f32 + bounds.0 / scale_x,
        region.y as f32 + bounds.1 / scale_y,
        bounds.2 / scale_x,
        bounds.3 / scale_y,
    )
}

pub(crate) fn map_capture_point_to_screen(
    point: (f32, f32),
    region: Option<LinkCaptureRegion>,
    frame_dimensions: Option<(u32, u32)>,
) -> (f32, f32) {
    let Some(region) = region else {
        return point;
    };
    let (frame_width, frame_height) =
        frame_dimensions.unwrap_or((region.width.max(1) as u32, region.height.max(1) as u32));
    let scale_x = (frame_width as f32 / region.width.max(1) as f32).max(0.01);
    let scale_y = (frame_height as f32 / region.height.max(1) as f32).max(0.01);
    (
        region.x as f32 + point.0 / scale_x,
        region.y as f32 + point.1 / scale_y,
    )
}

pub(crate) fn link_piece_click_centers(
    detections: &[link_vision::Detection],
    board_bounds: (f32, f32, f32, f32),
    orientation: BoardOrientation,
    capture_region: Option<LinkCaptureRegion>,
    frame_dimensions: Option<(u32, u32)>,
) -> Vec<LinkPieceClickCenter> {
    let (board_left, board_top, board_width, board_height) = board_bounds;
    let board_right = board_left + board_width;
    let board_bottom = board_top + board_height;
    let cell_width = (board_width / 8.0).max(1.0);
    let cell_height = (board_height / 9.0).max(1.0);
    let margin_x = cell_width * 0.45;
    let margin_y = cell_height * 0.45;
    let mut by_square: HashMap<Square, LinkPieceClickCenter> = HashMap::new();
    for detection in detections.iter().filter(|item| item.label != '0') {
        if detection.center_x < board_left - margin_x
            || detection.center_x > board_right + margin_x
            || detection.center_y < board_top - margin_y
            || detection.center_y > board_bottom + margin_y
        {
            continue;
        }
        let visual_col = ((detection.center_x - board_left) / cell_width).round() as i32;
        let visual_row = ((detection.center_y - board_top) / cell_height).round() as i32;
        if !(0..9).contains(&visual_col) || !(0..10).contains(&visual_row) {
            continue;
        }
        let square = match orientation {
            BoardOrientation::RedAtBottom => Square {
                row: visual_row as u8,
                col: visual_col as u8,
            },
            BoardOrientation::BlackAtBottom => Square {
                row: 9 - visual_row as u8,
                col: 8 - visual_col as u8,
            },
        };
        let (x, y) = map_capture_point_to_screen(
            (detection.center_x, detection.center_y),
            capture_region,
            frame_dimensions,
        );
        let center = LinkPieceClickCenter {
            square,
            x,
            y,
            confidence: detection.confidence,
        };
        if by_square
            .get(&square)
            .is_none_or(|existing| existing.confidence < center.confidence)
        {
            by_square.insert(square, center);
        }
    }
    by_square.into_values().collect()
}

pub(crate) fn capture_display_frame(region: Option<LinkCaptureRegion>) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        if !macos_screen_capture_access_granted() {
            return Err(macos_screen_capture_permission_message(
                "未授予屏幕录制权限",
            ));
        }
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let path = directory.path().join("xiangqi-link-frame.png");
        let mut command = ProcessCommand::new("/usr/sbin/screencapture");
        command.args(["-x", "-o"]);
        let output = command
            .arg(&path)
            .output()
            .map_err(|error| format!("无法采集屏幕：{error}"))?;
        if !output.status.success() {
            return Err(macos_screen_capture_permission_message("屏幕录制失败"));
        }
        let frame = fs::read(path).map_err(|error| error.to_string())?;
        if let Some(region) = region {
            crop_link_capture_frame(&frame, region)
        } else {
            Ok(frame)
        }
    }
    #[cfg(target_os = "windows")]
    {
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let path = directory.path().join("xiangqi-link-frame.png");
        capture_windows_display_png(&path)?;
        let frame = fs::read(path).map_err(|error| error.to_string())?;
        if let Some(region) = region {
            crop_link_capture_frame(&frame, region)
        } else {
            Ok(frame)
        }
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = region;
        Err("当前持续连线采集尚未接入此平台".into())
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn capture_windows_display_png(path: &Path) -> Result<(), String> {
    let output_path = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$bitmap.Save('{output_path}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()"#,
    );
    let output = ProcessCommand::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| format!("无法调用 Windows 屏幕采集：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Windows 屏幕采集失败；请确认桌面未被系统安全界面遮挡后重试。".into())
    }
}

pub(crate) fn capture_display_frame_for_link(
    _app: &tauri::AppHandle,
    region: Option<LinkCaptureRegion>,
) -> Result<Vec<u8>, String> {
    capture_display_frame(region)
}

pub(crate) fn capture_live_link_frame(
    app: &tauri::AppHandle,
    region: Option<LinkCaptureRegion>,
) -> Result<LiveLinkCaptureFrame, String> {
    #[cfg(target_os = "windows")]
    {
        let target = app
            .state::<DesktopState>()
            .link_session
            .lock()
            .ok()
            .and_then(|session| {
                (session.source == CaptureSource::WindowLink)
                    .then(|| {
                        session
                            .target_window
                            .as_ref()
                            .map(|target| target.id.clone())
                    })
                    .flatten()
            });
        if let Some(target) = target {
            let frame = windows_link::capture_browser_window(
                target
                    .parse::<u64>()
                    .map_err(|_| "目标窗口标识已失效，请重新选择浏览器窗口")?,
            )?;
            return Ok(LiveLinkCaptureFrame {
                png: frame.png,
                screen_origin: Some((frame.geometry.origin_x, frame.geometry.origin_y)),
                dpi: Some(frame.geometry.dpi),
                target_geometry: Some(LinkWindowGeometry {
                    origin_x: frame.geometry.origin_x,
                    origin_y: frame.geometry.origin_y,
                    client_width: frame.geometry.client_width,
                    client_height: frame.geometry.client_height,
                    dpi: frame.geometry.dpi,
                }),
            });
        }
    }
    Ok(LiveLinkCaptureFrame {
        png: capture_display_frame_for_link(app, region)?,
        screen_origin: None,
        dpi: None,
        target_geometry: None,
    })
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_screen_capture_access_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_screen_capture_permission_message(prefix: &str) -> String {
    format!("{prefix}，屏幕采集暂不可用；已停止本轮采集，不会继续触发系统授权弹窗。")
}

pub(crate) fn link_capture_generation_is_active(app: &tauri::AppHandle, generation: u64) -> bool {
    app.state::<DesktopState>()
        .link_session
        .lock()
        .map(|session| {
            session.capture_generation == generation
                && session.capture_running
                && !matches!(
                    session.state,
                    LinkSessionState::Stopped | LinkSessionState::Paused
                )
        })
        .unwrap_or(false)
}

pub(crate) fn set_link_capture_preview(
    app: &tauri::AppHandle,
    generation: u64,
    frame: &[u8],
    preview_kind: &str,
) {
    if frame.len() > 10 * 1024 * 1024 {
        return;
    }
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        if session.capture_generation == generation {
            session.capture_preview = Some(png_data_uri(frame));
            session.capture_preview_kind = Some(preview_kind.into());
        }
    }
    emit_link_session_updated(app);
}

pub(crate) fn set_link_capture_board_preview(
    app: &tauri::AppHandle,
    generation: u64,
    frame: &[u8],
    bounds: (f32, f32, f32, f32),
    source_label: &str,
) {
    let preview = crop_png_by_bounds(frame, bounds, 0.04).unwrap_or_else(|_| frame.to_vec());
    set_link_capture_preview(
        app,
        generation,
        &preview,
        if source_label == "框选预览" {
            "框选棋盘预览"
        } else {
            "实时棋盘预览"
        },
    );
}

pub(crate) fn set_link_capture_detection_summary(
    app: &tauri::AppHandle,
    generation: u64,
    source_label: &str,
    detections: &[link_vision::Detection],
) {
    let board_boxes = detections.iter().filter(|item| item.label == '0').count();
    let pieces = detections.iter().filter(|item| item.label != '0').count();
    let average_confidence = if detections.is_empty() {
        0.0
    } else {
        detections.iter().map(|item| item.confidence).sum::<f32>() / detections.len() as f32
    };
    let summary = format!(
        "{source_label}检测：棋盘框 {board_boxes} 个，棋子 {pieces} 个，平均置信度 {:.0}%",
        average_confidence * 100.0
    );
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        if session.capture_generation == generation {
            session.recognition_attempts = session.recognition_attempts.saturating_add(1);
            session.last_detection_summary = Some(summary);
            session.last_heartbeat_at = Some(Utc::now());
        }
    }
    emit_link_session_updated(app);
}

pub(crate) fn link_turn_indicator_message(
    manual_turn_override: Option<Color>,
    turn_indicator: Option<&link_vision::TurnIndicator>,
) -> String {
    if manual_turn_override.is_some() {
        return match turn_indicator {
            Some(indicator) => format!(
                "轮走校正：手动模式已开启，使用当前棋盘轮走方（自动识别：{}，已忽略）",
                indicator.detail
            ),
            None => "轮走校正：手动模式已开启，使用当前棋盘轮走方（未识别到平台头像高亮）".into(),
        };
    }
    turn_indicator
        .map(|indicator| indicator.detail.clone())
        .unwrap_or_else(|| "轮走识别：未识别到平台头像高亮，沿用当前轮走方".into())
}

pub(crate) fn set_link_capture_waiting(app: &tauri::AppHandle, generation: u64, reason: String) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        if session.capture_generation == generation
            && !matches!(
                session.state,
                LinkSessionState::Paused | LinkSessionState::Stopped
            )
        {
            session.state = LinkSessionState::ClassifyingSquares;
            session.phase = Some("waiting_recognition".into());
            session.reason = Some(reason);
            session.gate.reset();
            reset_link_stability_progress(&mut session);
            session.last_heartbeat_at = Some(Utc::now());
        }
    }
    emit_link_session_updated(app);
}

pub(crate) fn set_link_capture_progress(
    app: &tauri::AppHandle,
    generation: u64,
    phase: &str,
    reason: &str,
) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        if session.capture_generation == generation
            && matches!(
                session.state,
                LinkSessionState::ClassifyingSquares | LinkSessionState::Calibrating
            )
        {
            session.phase = Some(phase.into());
            session.last_heartbeat_at = Some(Utc::now());
            if session.recognition_attempts == 0
                || !matches!(
                    session.phase.as_deref(),
                    Some("screen_capture" | "model_inference")
                )
            {
                session.reason = Some(reason.into());
            }
        }
    }
    emit_link_session_updated(app);
}

pub(crate) fn set_link_capture_error(app: &tauri::AppHandle, generation: u64, reason: String) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        apply_link_capture_error(&mut session, generation, reason);
    }
    emit_link_session_updated(app);
}

pub(crate) fn invalidate_screenshot_move_resolution(session: &mut LinkSession) {
    session.latest_fen = None;
    session.screenshot_move_marker = None;
    session.screenshot_resolution_before_fen = None;
    session.screenshot_resolution_generation = None;
    session.screenshot_resolution_mode = None;
    session.screenshot_resolution_game_id = None;
    session.screenshot_resolution_current_node = None;
    session.screenshot_resolution_allowed_moves.clear();
}

pub(crate) fn active_screenshot_resolution(
    session: &LinkSession,
) -> Result<ScreenshotResolutionBinding, String> {
    if !matches!(
        session.source,
        CaptureSource::ImageImport | CaptureSource::CameraBoard
    ) {
        return Err("当前不是截图识别会话，不能确认写入上一着".into());
    }
    Ok(ScreenshotResolutionBinding {
        recognized_after_fen: session.latest_fen.clone(),
        before_fen: session
            .screenshot_resolution_before_fen
            .clone()
            .ok_or_else(|| "截图上一着解析已失效，请重新选择图片".to_owned())?,
        generation: session
            .screenshot_resolution_generation
            .ok_or_else(|| "截图上一着解析已失效，请重新选择图片".to_owned())?,
        mode: session
            .screenshot_resolution_mode
            .ok_or_else(|| "截图上一着解析尚未完成，请重新选择图片".to_owned())?,
        game_id: session
            .screenshot_resolution_game_id
            .ok_or_else(|| "截图上一着解析已失效，请重新选择图片".to_owned())?,
        current_node: session
            .screenshot_resolution_current_node
            .ok_or_else(|| "截图上一着解析已失效，请重新选择图片".to_owned())?,
        allowed_moves: session.screenshot_resolution_allowed_moves.clone(),
    })
}

pub(crate) fn validate_screenshot_resolution_binding(
    model: &AppModel,
    binding: &ScreenshotResolutionBinding,
) -> Result<(), String> {
    if model.game_id != binding.game_id || model.current_node != binding.current_node {
        return Err("截图对应的棋谱或节点已变化，请重新选择图片后再确认上一着".into());
    }
    if model.board.to_fen() != binding.before_fen {
        return Err("截图对应的当前棋谱节点已变化。请先跳转到对应局面，或重新选择图片。".into());
    }
    Ok(())
}

pub(crate) fn validate_screenshot_resolution_move(
    binding: &ScreenshotResolutionBinding,
    iccs: &str,
) -> Result<(), String> {
    if binding.allowed_moves.iter().any(|allowed| allowed == iccs) {
        Ok(())
    } else {
        Err("该走法不在本次截图确认的合法候选中，请重新核对或手工点选。".into())
    }
}

pub(crate) fn apply_link_capture_error(session: &mut LinkSession, generation: u64, reason: String) {
    if session.capture_generation != generation {
        return;
    }
    let target_capture_error = matches!(session.source, CaptureSource::WindowLink)
        && session.target_window.is_some()
        && ["目标浏览器", "客户区", "窗口采集"]
            .iter()
            .any(|fragment| reason.contains(fragment));
    session.state = LinkSessionState::NeedsManualCorrection;
    session.phase = Some(
        if target_capture_error {
            "target_unavailable"
        } else {
            "error"
        }
        .into(),
    );
    session.last_error = Some(reason.clone());
    session.reason = Some(reason);
    session.capture_running = false;
    session.frame_rate = 0.0;
    session.last_heartbeat_at = Some(Utc::now());
    // An image failure has no trustworthy post-move position. Invalidate a
    // prior screenshot resolution so only the current-document manual path
    // can be offered after the user sees the error.
    if matches!(
        session.source,
        CaptureSource::ImageImport | CaptureSource::CameraBoard
    ) {
        invalidate_screenshot_move_resolution(session);
    }
}

/// The vision adapter submits a corrected FEN only after image recognition. This command is
/// deliberately independent from capture/model implementations so all inputs share one guard.
#[tauri::command]
pub(crate) fn submit_link_position(
    fen: String,
    state: State<'_, DesktopState>,
) -> Result<LinkObservationDto, String> {
    observe_link_recognition_inner(&state, fen, None, None)
}

#[tauri::command]
pub(crate) fn set_link_side_to_move(
    side: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<BoardDto, String> {
    let side = match side.as_str() {
        "red" => Color::Red,
        "black" => Color::Black,
        _ => return Err("未知行棋方".into()),
    };
    let board = {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model.board = model.board.with_side_to_move(side);
        if model.current_node.is_none() {
            model.starting_fen = model.board.to_fen();
        }
        board_dto(&model)?
    };
    {
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        session.latest_fen = Some(board.fen.clone());
        session.reason = Some(format!("已手动校正为{}行棋", side_label(side)));
        session.manual_turn_override = Some(side);
        session.turn_indicator = Some(format!(
            "轮走校正：手动锁定{}行棋，自动头像识别暂不覆盖",
            side_label(side)
        ));
        session.phase = Some("turn_corrected".into());
        session.last_error = None;
    }
    let _ = app.emit("board-navigated", &board);
    emit_link_session_updated(&app);
    Ok(board)
}

/// Executes a reviewed engine move only against the currently stable visible board. The move is
/// intentionally not committed here: the normal recognition/reconciliation path must observe the
/// expected position before SQLite is changed.
#[tauri::command]
pub(crate) fn confirm_link_engine_move(
    iccs: String,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<bool, String> {
    let (
        bounds,
        orientation,
        piece_click_centers,
        mode,
        latest_fen,
        auto_side,
        target_window_id,
        capture_window_geometry,
        board_capture_signature,
    ) = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        if !matches!(session.state, LinkSessionState::Tracking) {
            return Err("外部局面尚未稳定，不能执行走子".into());
        }
        if session.pending_external_move.is_some() {
            return Err("正在等待上一条确认走子的识别回读，请勿重复确认".into());
        }
        (
            session.board_bounds.ok_or("未获得棋盘坐标，请重新框选")?,
            session.board_orientation,
            session.piece_click_centers.clone(),
            session.mode,
            session.latest_fen.clone(),
            session.auto_side,
            session
                .target_window
                .as_ref()
                .map(|target| target.id.clone()),
            session.capture_window_geometry,
            session.board_capture_signature.clone(),
        )
    };
    #[cfg(not(target_os = "windows"))]
    let _ = (
        &target_window_id,
        capture_window_geometry,
        &board_capture_signature,
    );
    if !matches!(mode, LinkMode::ConfirmPlay | LinkMode::AutoPlay) {
        return Err("当前为观战跟盘模式，不能执行外部点击".into());
    }
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    if latest_fen.as_deref() != Some(&model.board.to_fen()) {
        return Err("外部局面已变化，已拒绝使用过期引擎建议".into());
    }
    if matches!(mode, LinkMode::AutoPlay) && auto_side != Some(model.board.side_to_move()) {
        return Err("当前回合不属于设置的自动执棋方".into());
    }
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let move_notation = model
        .board
        .chinese_move_notation(mv)
        .unwrap_or_else(|_| iccs.clone());
    let move_display = if move_notation == iccs {
        iccs.clone()
    } else {
        format!("{move_notation}（{iccs}）")
    };
    let expected = model
        .board
        .apply_move(mv)
        .map_err(|_| "引擎建议已过期或不是当前局面的合法着法".to_string())?;
    drop(model);
    let detected_from = piece_click_centers
        .iter()
        .filter(|center| center.square == mv.from)
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
        .copied();
    #[cfg(target_os = "windows")]
    let click_target = target_window_id.is_some();
    #[cfg(not(target_os = "windows"))]
    let click_target = matches!(mode, LinkMode::AutoPlay);
    let click_points = link_move_click_points_for_click(bounds, orientation, mv, detected_from);
    let expected_fen = expected.to_fen();
    {
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        if !matches!(session.state, LinkSessionState::Tracking)
            || session.pending_external_move.is_some()
            || session.latest_fen != latest_fen
            || session.board_bounds != Some(bounds)
            || session.capture_window_geometry != capture_window_geometry
            || session.board_capture_signature != board_capture_signature
        {
            return Err("连线局面刚刚更新，已取消本次确认走子；请等待稳定后重新确认".into());
        }
        session.pending_external_move = Some(iccs.clone());
        session.pending_expected_fen = Some(expected_fen.clone());
        session.phase = Some("confirming_external_move".into());
        session.reason = Some("正在复核目标网页棋盘和窗口坐标…".into());
    }
    emit_link_session_updated(&app);
    #[cfg(target_os = "windows")]
    {
        let click_result = (|| -> Result<(), String> {
            if let Some(target_window_id) = target_window_id.as_deref() {
                let target_window_id = target_window_id
                    .parse::<u64>()
                    .map_err(|_| "目标浏览器窗口标识已失效，请重新选择窗口")?;
                let expected_geometry = capture_window_geometry
                    .ok_or("尚未获得目标浏览器的稳定棋盘坐标，请等待识别完成后再确认走子")?;
                let expected_signature = board_capture_signature
                    .as_deref()
                    .ok_or("尚未获得稳定棋盘画面，请等待识别完成后再确认走子")?;
                let fresh_frame = windows_link::capture_browser_window(target_window_id)?;
                let fresh_geometry = LinkWindowGeometry {
                    origin_x: fresh_frame.geometry.origin_x,
                    origin_y: fresh_frame.geometry.origin_y,
                    client_width: fresh_frame.geometry.client_width,
                    client_height: fresh_frame.geometry.client_height,
                    dpi: fresh_frame.geometry.dpi,
                };
                if fresh_geometry != expected_geometry {
                    Err("目标浏览器窗口刚刚移动、缩放或切换了显示缩放。已拒绝过期点击，等待下一帧重新标定后再确认走子。".into())
                } else {
                    let local_bounds = (
                        bounds.0 - expected_geometry.origin_x as f32,
                        bounds.1 - expected_geometry.origin_y as f32,
                        bounds.2,
                        bounds.3,
                    );
                    let fresh_signature =
                        link_capture_board_signature(&fresh_frame.png, local_bounds)?;
                    if fresh_signature != expected_signature {
                        Err(
                            "目标网页棋盘局面刚刚变化，已拒绝过期点击；等待稳定识别后再确认走子。"
                                .into(),
                        )
                    } else {
                        // Windows never auto-plays.  The user's confirm action sends both
                        // endpoints to the verified browser window.
                        windows_link::click_browser_points(
                            target_window_id,
                            windows_link::WindowGeometry {
                                origin_x: expected_geometry.origin_x,
                                origin_y: expected_geometry.origin_y,
                                client_width: expected_geometry.client_width,
                                client_height: expected_geometry.client_height,
                                dpi: expected_geometry.dpi,
                            },
                            click_points.0,
                            click_points.1,
                        )
                    }
                }
            } else {
                click_external_move(bounds, orientation, mv, detected_from, click_target)
                    .map(|_| ())
            }
        })();
        if let Err(error) = click_result {
            reject_pending_link_confirmation(&state, &app, &iccs, &error);
            return Err(error);
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Err(error) = click_external_move(bounds, orientation, mv, detected_from, click_target) {
        reject_pending_link_confirmation(&state, &app, &iccs, &error);
        return Err(error);
    }
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if session.pending_external_move.as_deref() != Some(iccs.as_str()) {
        return Err("连线会话已停止或更新，已不再等待本次确认走子的回读".into());
    }
    let ((from_x, from_y), (to_x, to_y)) = click_points;
    let click_basis = if detected_from.is_some() {
        "按识别到的棋子中心"
    } else {
        "按棋盘网格估算"
    };
    session.reason = Some(if click_target {
        format!(
            "已按箭头1自动执行 {move_display}：{}点击起点({from_x:.0},{from_y:.0})，再点击目标({to_x:.0},{to_y:.0})；等待识别确认预期局面 {}",
            click_basis, expected_fen
        )
    } else {
        format!(
            "已按箭头1选中起点 {move_display}：{}点击({from_x:.0},{from_y:.0})；请在网页棋盘确认目标({to_x:.0},{to_y:.0})，完成后等待同步 {}",
            click_basis, expected_fen
        )
    });
    session.pending_external_move = Some(iccs);
    session.pending_expected_fen = Some(expected_fen);
    session.phase = Some("pending_external_move".into());
    session.gate.reset();
    reset_link_stability_progress(&mut session);
    drop(session);
    emit_link_session_updated(&app);
    Ok(true)
}

pub(crate) fn reject_pending_link_confirmation(
    state: &DesktopState,
    app: &tauri::AppHandle,
    iccs: &str,
    error: &str,
) {
    let needs_recalibration = error.contains("窗口刚刚移动")
        || error.contains("稳定棋盘")
        || error.contains("目标网页棋盘局面刚刚变化");
    if let Ok(mut session) = state.link_session.lock() {
        if session.pending_external_move.as_deref() != Some(iccs) {
            return;
        }
        session.pending_external_move = None;
        session.pending_expected_fen = None;
        session.last_error = Some(error.into());
        session.reason = Some(error.into());
        if needs_recalibration {
            session.state = LinkSessionState::Calibrating;
            session.capture_running = true;
            session.phase = Some("recalibrating_target".into());
            session.board_bounds = None;
            session.piece_click_centers.clear();
            session.board_capture_signature = None;
            session.capture_window_geometry = None;
        } else {
            session.phase = Some("click_rejected".into());
        }
    }
    emit_link_session_updated(app);
}

pub(crate) fn link_move_click_points(
    bounds: (f32, f32, f32, f32),
    orientation: link_core::BoardOrientation,
    mv: Move,
) -> ((f32, f32), (f32, f32)) {
    let (left, top, width, height) = bounds;
    let point = |square: Square| -> (f32, f32) {
        let (row, col) = match orientation {
            link_core::BoardOrientation::RedAtBottom => (square.row, square.col),
            link_core::BoardOrientation::BlackAtBottom => (9 - square.row, 8 - square.col),
        };
        (
            left + col as f32 * width / 8.0,
            top + row as f32 * height / 9.0,
        )
    };
    (point(mv.from), point(mv.to))
}

pub(crate) fn link_move_click_points_for_click(
    bounds: (f32, f32, f32, f32),
    orientation: link_core::BoardOrientation,
    mv: Move,
    detected_from: Option<LinkPieceClickCenter>,
) -> ((f32, f32), (f32, f32)) {
    let mut click_points = link_move_click_points(bounds, orientation, mv);
    if let Some(center) = detected_from {
        click_points.0 = (center.x, center.y);
    }
    click_points
}

pub(crate) fn click_external_move(
    bounds: (f32, f32, f32, f32),
    orientation: link_core::BoardOrientation,
    mv: Move,
    detected_from: Option<LinkPieceClickCenter>,
    click_target: bool,
) -> Result<((f32, f32), (f32, f32)), String> {
    let click_points = link_move_click_points_for_click(bounds, orientation, mv, detected_from);
    #[cfg(target_os = "macos")]
    {
        if !macos_accessibility_access_granted() {
            return Err("未授予辅助功能权限，已跳过外部点击，不会继续触发系统授权弹窗。".into());
        }
        let ((from_x, from_y), (to_x, to_y)) = click_points;
        let script = macos_link_click_script(from_x, from_y, to_x, to_y, click_target);
        let output = ProcessCommand::new("/usr/bin/osascript")
            .args(["-e", &script])
            .output()
            .map_err(|error| format!("无法请求 macOS 辅助功能点击：{error}"))?;
        if output.status.success() {
            Ok(click_points)
        } else {
            Err("外部点击被 macOS 拒绝；请确认辅助功能权限后重试。".into())
        }
    }
    #[cfg(target_os = "windows")]
    {
        let ((from_x, from_y), (to_x, to_y)) = click_points;
        windows_external_click(from_x, from_y)?;
        if click_target {
            std::thread::sleep(Duration::from_millis(260));
            windows_external_click(to_x, to_y)?;
        }
        Ok(click_points)
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = (bounds, orientation, mv, click_points, click_target);
        Err("当前平台尚未接入外部鼠标点击".into())
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_external_click(x: f32, y: f32) -> Result<(), String> {
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class XiangqiStudioMouse {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}}
'@
[XiangqiStudioMouse]::SetCursorPos({x:.0}, {y:.0}) | Out-Null
Start-Sleep -Milliseconds 110
[XiangqiStudioMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[XiangqiStudioMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)"#,
    );
    let output = ProcessCommand::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| format!("无法调用 Windows 外部点击：{error}"))?;
    output
        .status
        .success()
        .then_some(())
        .ok_or_else(|| "Windows 外部点击失败；请以相同权限运行目标棋局窗口和棋研。".into())
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_accessibility_access_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_link_click_script(
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
    click_target: bool,
) -> String {
    let target_click = if click_target {
        format!("\ndelay 0.26\nclick at {{{to_x:.0}, {to_y:.0}}}")
    } else {
        String::new()
    };
    format!(
        r#"set targetX to {from_x:.0}
set targetY to {from_y:.0}
tell application "System Events"
  set activatedTarget to false
  repeat with proc in application processes
    if activatedTarget then exit repeat
    try
      if (name of proc is not "Xiangqi Studio") then
        repeat with win in windows of proc
          if activatedTarget then exit repeat
          try
            set winPosition to position of win
            set winSize to size of win
            set winX to item 1 of winPosition
            set winY to item 2 of winPosition
            set winW to item 1 of winSize
            set winH to item 2 of winSize
            if targetX >= winX and targetX <= (winX + winW) and targetY >= winY and targetY <= (winY + winH) then
              set frontmost of proc to true
              set activatedTarget to true
            end if
          end try
        end repeat
      end if
    end try
  end repeat
  delay 0.12
  click at {{{from_x:.0}, {from_y:.0}}}{target_click}
end tell"#
    )
}

pub(crate) fn observe_link_recognition(
    app: &tauri::AppHandle,
    generation: u64,
    fen: String,
    confidence: f32,
) -> Result<LinkObservationDto, String> {
    let state = app.state::<DesktopState>();
    let observation =
        observe_link_recognition_inner(&state, fen, Some(confidence), Some(generation))?;
    if let Some(board) = &observation.board {
        let _ = app.emit("board-navigated", board);
    }
    emit_link_session_updated(app);
    Ok(observation)
}

pub(crate) fn observe_link_recognition_inner(
    state: &DesktopState,
    fen: String,
    confidence: Option<f32>,
    expected_generation: Option<u64>,
) -> Result<LinkObservationDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if expected_generation.is_some_and(|generation| generation != session.capture_generation) {
        return Err("旧连线识别结果已忽略".into());
    }
    if matches!(session.state, LinkSessionState::Stopped) {
        return Err("请先启动连线会话".into());
    }
    if matches!(session.state, LinkSessionState::Paused) {
        return Ok(LinkObservationDto {
            state: session.state,
            accepted: false,
            move_iccs: None,
            reason: session.reason.clone(),
            board: None,
            orientation: session.board_orientation,
            capture_preview_available: session.capture_preview.is_some(),
        });
    }
    if let Some(confidence) = confidence {
        session.confidence = Some(confidence);
        if confidence < session.confidence_threshold {
            let threshold = session.confidence_threshold;
            session.state = LinkSessionState::ClassifyingSquares;
            session.phase = Some("low_confidence".into());
            session.reason = Some(if session.capture_running {
                format!(
                    "识别置信度 {:.0}% 低于 {:.0}%，继续采集中；请保持棋盘完整可见或重新框选",
                    confidence * 100.0,
                    threshold * 100.0
                )
            } else {
                format!(
                    "识别置信度 {:.0}% 低于 {:.0}%；请重新选择更清晰、棋盘更完整的图片",
                    confidence * 100.0,
                    threshold * 100.0
                )
            });
            session.last_error = None;
            clear_link_recognition_candidate(&mut session);
            session.gate.reset();
            reset_link_stability_progress(&mut session);
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
    }
    let recognized_board = match Board::from_fen(&fen) {
        Ok(board) => board,
        Err(error) => {
            session.state = LinkSessionState::NeedsManualCorrection;
            session.phase = Some("invalid_recognition".into());
            session.reason = Some(format!(
                "识别未通过，主棋盘未更新：识别局面格式无效：{error}"
            ));
            session.last_error = session.reason.clone();
            clear_link_recognition_candidate(&mut session);
            session.gate.reset();
            reset_link_stability_progress(&mut session);
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
    };
    if let Err(reason) = link_core::validate_board(&recognized_board) {
        session.state = if session.capture_running {
            LinkSessionState::ClassifyingSquares
        } else {
            LinkSessionState::NeedsManualCorrection
        };
        session.phase = Some("invalid_recognition".into());
        session.reason = Some(format!("识别未通过，主棋盘未更新：{reason}"));
        session.last_error = session.reason.clone();
        clear_link_recognition_candidate(&mut session);
        session.gate.reset();
        reset_link_stability_progress(&mut session);
        return Ok(LinkObservationDto {
            state: session.state,
            accepted: false,
            move_iccs: None,
            reason: session.reason.clone(),
            board: None,
            orientation: session.board_orientation,
            capture_preview_available: session.capture_preview.is_some(),
        });
    }
    let recognized_side_to_move = recognized_board.side_to_move();
    let stable = match session.gate.observe(&fen) {
        Ok(value) => value,
        Err(error) => {
            session.state = LinkSessionState::NeedsManualCorrection;
            session.phase = Some("invalid_recognition".into());
            session.reason = Some(error.to_string());
            session.last_error = session.reason.clone();
            clear_link_recognition_candidate(&mut session);
            session.gate.reset();
            reset_link_stability_progress(&mut session);
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
    };
    if !stable {
        let required = session.gate.required_frames();
        let matching = session.gate.matching_frames();
        return Ok(wait_for_link_recognition_stability(
            &mut session,
            "waiting_stable_frames",
            format!("等待连续稳定识别帧 {matching}/{required}"),
            required,
        ));
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    match link_core::reconcile_position(&model.board, &fen) {
        ReconcileDecision::Unchanged => {
            let side_changed = model.board.side_to_move() != recognized_side_to_move;
            if side_changed && session.pending_external_move.is_some() {
                reset_link_side_change_stability(&mut session);
                let pending_move_display = session
                    .pending_external_move
                    .as_deref()
                    .map(|value| {
                        Move::from_iccs(value)
                            .ok()
                            .and_then(|mv| model.board.chinese_move_notation(mv).ok())
                            .filter(|notation| notation != value)
                            .map(|notation| format!("{notation}（{value}）"))
                            .unwrap_or_else(|| value.to_owned())
                    })
                    .unwrap_or_default();
                session.state = LinkSessionState::Tracking;
                session.initial_position_seen = true;
                mark_link_stability_accepted(&mut session);
                session.latest_fen = Some(model.board.to_fen());
                session.phase = Some("pending_external_move".into());
                session.reason = Some(format!(
                    "已点击箭头1{}，等待网页棋盘完成走子；暂不采用识别到的{}行棋闪烁",
                    if pending_move_display.is_empty() {
                        String::new()
                    } else {
                        format!(" {pending_move_display}")
                    },
                    side_label(recognized_side_to_move)
                ));
                return Ok(LinkObservationDto {
                    state: session.state,
                    accepted: false,
                    move_iccs: None,
                    reason: session.reason.clone(),
                    board: None,
                    orientation: session.board_orientation,
                    capture_preview_available: session.capture_preview.is_some(),
                });
            }
            if side_changed {
                let required = live_side_change_required_frames(&session);
                let matching =
                    observe_link_side_change_stability(&mut session, recognized_side_to_move);
                if matching < required {
                    return Ok(wait_for_link_candidate_stability(
                        &mut session,
                        "waiting_side_stability",
                        format!(
                            "识别到{}行棋，等待轮走方连续稳定 {}/{} 后再更新",
                            side_label(recognized_side_to_move),
                            matching,
                            required
                        ),
                        matching,
                        required,
                    ));
                }
            } else {
                reset_link_side_change_stability(&mut session);
            }
            if side_changed {
                model.board = model.board.with_side_to_move(recognized_side_to_move);
                if model.current_node.is_none() {
                    model.starting_fen = model.board.to_fen();
                }
                reset_link_side_change_stability(&mut session);
            }
            let board = if side_changed {
                Some(board_dto(&model)?)
            } else {
                None
            };
            session.state = LinkSessionState::Tracking;
            session.initial_position_seen = true;
            mark_link_stability_accepted(&mut session);
            session.latest_fen = Some(model.board.to_fen());
            session.phase = Some("tracking".into());
            session.reason = Some(if side_changed {
                format!(
                    "局面已同步，识别到{}行棋",
                    side_label(recognized_side_to_move)
                )
            } else {
                "局面已同步，正在跟踪外部棋盘变化".into()
            });
            Ok(LinkObservationDto {
                state: session.state,
                accepted: side_changed,
                move_iccs: None,
                reason: session.reason.clone(),
                board,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
        ReconcileDecision::ApplyMove(mv) => {
            let iccs = mv.to_iccs();
            let last_move_detail = link_move_detail(&model.board, mv)?;
            let last_move_display = format!("{}（{}）", last_move_detail.notation, iccs);
            let board = commit_move(&mut model, &iccs)?;
            session.pending_external_move = None;
            session.pending_expected_fen = None;
            session.state = LinkSessionState::Tracking;
            session.initial_position_seen = true;
            mark_link_stability_accepted(&mut session);
            session.last_move = Some(iccs.clone());
            session.last_move_detail = Some(last_move_detail);
            session.latest_fen = Some(board.fen.clone());
            session.phase = Some("move_synced".into());
            session.reason = Some(format!("已同步外部走子 {last_move_display}"));
            Ok(LinkObservationDto {
                state: session.state,
                accepted: true,
                move_iccs: Some(iccs),
                reason: session.reason.clone(),
                board: Some(board),
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
        ReconcileDecision::NeedsManualCorrection { reason } => {
            let should_sync_as_position_jump = session.initial_position_seen
                && session.capture_running
                && matches!(
                    session.source,
                    CaptureSource::WindowLink | CaptureSource::DesktopDetect
                );
            if !session.initial_position_seen || should_sync_as_position_jump {
                if should_sync_as_position_jump {
                    let required = live_position_jump_required_frames(&session);
                    let matching = session.gate.matching_frames();
                    if matching < required {
                        return Ok(wait_for_link_recognition_stability(
                            &mut session,
                            "waiting_jump_stability",
                            format!(
                                "识别到非一步衔接局面，等待连续稳定 {}/{} 后再按网页跳转同步",
                                matching, required
                            ),
                            required,
                        ));
                    }
                }
                let mut document =
                    ManualDocument::new(fen.clone()).map_err(|error| error.to_string())?;
                document.metadata.title = if should_sync_as_position_jump {
                    format!("连线跳转 {}", Utc::now().format("%Y-%m-%d %H:%M:%S"))
                } else {
                    format!("连线记录 {}", Utc::now().format("%Y-%m-%d %H:%M"))
                };
                document.note = if should_sync_as_position_jump {
                    format!("网页棋谱跳转到非一步衔接局面，已按当前识别局面同步。原原因：{reason}")
                } else {
                    "首次连线局面与原棋谱不一致，已新建连线记录，不会覆盖原棋谱。".into()
                };
                install_document(&mut model, document, None, Some("window-link".into()))?;
                let board = board_dto(&model)?;
                session.state = LinkSessionState::Tracking;
                session.initial_position_seen = true;
                mark_link_stability_accepted(&mut session);
                session.latest_fen = Some(board.fen.clone());
                session.last_move = None;
                session.last_move_detail = None;
                session.last_error = None;
                session.phase = Some(if should_sync_as_position_jump {
                    "position_jump_synced".into()
                } else {
                    "tracking".into()
                });
                session.reason = Some(if should_sync_as_position_jump {
                    "已同步网页棋谱跳转局面，正在触发当前局面引擎分析".into()
                } else {
                    "外部初始局面已保存为新的“连线记录”棋局".into()
                });
                return Ok(LinkObservationDto {
                    state: session.state,
                    accepted: true,
                    move_iccs: None,
                    reason: session.reason.clone(),
                    board: Some(board),
                    orientation: session.board_orientation,
                    capture_preview_available: session.capture_preview.is_some(),
                });
            }
            session.state = LinkSessionState::NeedsManualCorrection;
            session.phase = Some("needs_manual_correction".into());
            session.reason = Some(reason);
            session.last_error = session.reason.clone();
            clear_link_recognition_candidate(&mut session);
            session.gate.reset();
            reset_link_stability_progress(&mut session);
            Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: session.reason.clone(),
                board: None,
                orientation: session.board_orientation,
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
    }
}

#[tauri::command]
pub(crate) fn import_recognized_position(
    fen: String,
    title: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let board = Board::from_fen(&fen).map_err(|error| format!("识别局面格式无效：{error}"))?;
    link_core::validate_board(&board).map_err(|reason| format!("识别局面需要校正：{reason}"))?;
    let mut document = ManualDocument::new(fen).map_err(|error| error.to_string())?;
    document.metadata.title = title.unwrap_or_else(|| "识别导入棋局".into());
    document.note = "由图片/照片识别导入，请在开始分析前确认局面。".into();
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, Some("recognized".into()))?;
    board_dto(&model)
}
