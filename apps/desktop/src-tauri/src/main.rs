#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod cloud_opening_book;
mod credential_store;
mod gif_export;
mod link_vision;
mod manual_pdf;
mod opening_book;
mod pdf_report;
mod xqb_opening_book;

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::process::Command as ProcessCommand;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use chrono::Utc;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use credential_store::{SharedCredentialStore, SystemCredentialStore, TOKEN_KEY};
use engine_protocol::{EngineControl, EngineEvent, EngineSession, Protocol, SearchLimit};
use link_core::{
    CapturePolicy, CaptureSource, LinkMode, LinkSessionState, RecognitionMode, ReconcileDecision,
    StabilityGate,
};
use local_store::{
    AnalysisSummary, DesktopPreferences, EngineProfile, ImportedGame, LocalGame, LocalStore,
    StudySession, SyncAccountBinding, TheoryCard, TheoryLesson, TrainingTask,
};
use manual_format::{
    ManualDocument, ManualFormat, ManualMetadata, detect_format, export_chinese_text,
    export_dhtmlxq, export_mainline_pgn, export_pgn, import_document,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    ReorderBranchesPayload, SetMainlinePayload, UpdateCommentPayload, UpdateGameMetadataPayload,
};
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;
use xiangqi_core::{
    Board, Color, DomesticRuleState, GameStatus, Move, PieceKind, RuleMode, RuleVerdict,
    STARTING_FEN, Square,
};
use xiangqi_manual::{ManualTree, MoveNode};

const BUILTIN_ENGINE_PATH: &str = "builtin:pikafish";
const BUILTIN_FAIRY_ENGINE_PATH: &str = "builtin:fairy-stockfish";
const PIKAFISH_260720_NNUE_SHA256: &str =
    "sha256:3cd15292bf8c979884262f57fc723959fc0dea43b4d8d544f88db5ceb2479e24";
const PIKAFISH_260720_NNUE_LABEL: &str = "权重260720";
const THEORY_COURSE_ROOTS: [(&str, &str, &str); 3] = [
    (
        "opening",
        "赵鑫鑫布局棋理48讲",
        "/Users/chenyubin/Desktop/象棋学习/01赵鑫鑫布局棋理48讲",
    ),
    (
        "middle",
        "赵鑫鑫中局棋理48讲",
        "/Users/chenyubin/Desktop/象棋学习/02赵鑫鑫中局棋理48讲",
    ),
    (
        "endgame",
        "赵鑫鑫残局棋理48讲",
        "/Users/chenyubin/Desktop/象棋学习/03赵鑫鑫残局棋理48讲",
    ),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TheoryLibraryDto {
    lessons: Vec<TheoryLesson>,
    cards: Vec<TheoryCard>,
    downloading_files: usize,
}

struct AppModel {
    board: Board,
    starting_fen: String,
    tree: ManualTree,
    current_node: Option<Uuid>,
    game_id: Uuid,
    device_id: Uuid,
    lamport: u64,
    store: LocalStore,
    metadata: ManualMetadata,
    note: String,
    source_path: Option<String>,
    source_format: Option<String>,
    playable: bool,
}

struct DesktopState {
    model: Mutex<AppModel>,
    credentials: SharedCredentialStore,
    session_token: Mutex<Option<String>>,
    engine: tokio::sync::Mutex<HashMap<String, EngineControl>>,
    report_engine: tokio::sync::Mutex<Option<EngineControl>>,
    report_commit: tokio::sync::Mutex<()>,
    play_session: tokio::sync::Mutex<Option<EngineRuntime>>,
    analysis_generation: AtomicU64,
    play_generation: AtomicU64,
    report_generation: AtomicU64,
    report_running: AtomicBool,
    cloud_book_cache: Mutex<BTreeMap<String, Vec<cloud_opening_book::CloudBookCandidateDto>>>,
    link_session: Mutex<LinkSession>,
}

struct LinkSession {
    source: CaptureSource,
    recognition_mode: RecognitionMode,
    mode: LinkMode,
    state: LinkSessionState,
    gate: StabilityGate,
    reason: Option<String>,
    capture_preview: Option<String>,
    frame_rate: f32,
    confidence: Option<f32>,
    stable_frames: u8,
    latest_fen: Option<String>,
    last_move: Option<String>,
    initial_position_seen: bool,
    auto_side: Option<Color>,
    capture_running: bool,
    board_bounds: Option<(f32, f32, f32, f32)>,
    board_orientation: link_core::BoardOrientation,
}

impl Default for LinkSession {
    fn default() -> Self {
        Self {
            source: CaptureSource::ImageImport,
            recognition_mode: RecognitionMode::PerspectiveGrid,
            mode: LinkMode::Spectate,
            state: LinkSessionState::Stopped,
            gate: StabilityGate::new(1),
            reason: None,
            capture_preview: None,
            frame_rate: 0.0,
            confidence: None,
            stable_frames: 0,
            latest_fen: None,
            last_move: None,
            initial_position_seen: false,
            auto_side: None,
            capture_running: false,
            board_bounds: None,
            board_orientation: link_core::BoardOrientation::RedAtBottom,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncAccountDto {
    server_url: String,
    user_id: Option<Uuid>,
    email: Option<String>,
    status: &'static str,
    last_sync_result: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionDto {
    plan: String,
    status: String,
    source: String,
    starts_at: String,
    expires_at: String,
    cloud_analysis_quota: u32,
    cloud_analysis_used: u32,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct AuthResponse {
    user_id: Uuid,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineProbeDto {
    path: String,
    protocol: &'static str,
    engine_version: Option<String>,
    engine_sha256: Option<String>,
    nnue_file: Option<String>,
    nnue_version: Option<String>,
    nnue_sha256: Option<String>,
    fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineProfileDto {
    id: Uuid,
    name: String,
    executable_path: String,
    protocol: String,
    active: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineArenaPlayerDto {
    name: String,
    engine_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineArenaOptionsDto {
    player_a: EngineArenaPlayerDto,
    player_b: EngineArenaPlayerDto,
    games: u32,
    move_time_ms: u64,
    threads: u32,
    hash_mb: u32,
    max_plies: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineArenaGameDto {
    index: u32,
    red: String,
    black: String,
    result: String,
    winner: Option<String>,
    reason: String,
    plies: u32,
    moves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineArenaScoreDto {
    name: String,
    wins: u32,
    draws: u32,
    losses: u32,
    points: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineArenaResultDto {
    player_a: EngineArenaScoreDto,
    player_b: EngineArenaScoreDto,
    games: Vec<EngineArenaGameDto>,
    move_time_ms: u64,
    max_plies: u32,
    rule_name: &'static str,
    summary: String,
}

struct EngineRuntime {
    path: String,
    session: EngineSession,
    pondering_fen: Option<String>,
    state: EngineRuntimeState,
}

#[derive(Clone, Copy)]
enum EngineRuntimeState {
    Idle,
    Analyzing,
    Thinking,
    Pondering,
    Stopping,
    Faulted,
}

impl EngineRuntimeState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Analyzing => "analyzing",
            Self::Thinking => "thinking",
            Self::Pondering => "pondering",
            Self::Stopping => "stopping",
            Self::Faulted => "faulted",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EngineRuntimeEvent {
    State {
        state: &'static str,
    },
    Info {
        fen: String,
        line: AnalysisLine,
    },
    AnalysisInfo {
        engine_id: Option<String>,
        engine_name: Option<String>,
        analysis_session_id: Option<u64>,
        fen: String,
        line: AnalysisLine,
    },
    Bestmove {
        fen: String,
        best: String,
        ponder: Option<String>,
    },
    Error {
        message: String,
    },
}

fn emit_engine_event(app: &tauri::AppHandle, event: EngineRuntimeEvent) {
    let _ = app.emit("engine-runtime", event);
}

fn emit_engine_state(app: &tauri::AppHandle, state: EngineRuntimeState) {
    emit_engine_event(
        app,
        EngineRuntimeEvent::State {
            state: state.as_str(),
        },
    );
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

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ExportFormat {
    Pgn,
    Chinese,
    Dhtmlxq,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ReplayExportScope {
    CurrentSelection,
    Mainline,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Pgn => "pgn",
            Self::Chinese | Self::Dhtmlxq => "txt",
        }
    }

    fn export(self, document: &ManualDocument) -> Result<String, String> {
        match self {
            Self::Pgn => Ok(export_pgn(document)),
            Self::Chinese => export_chinese_text(document).map_err(|error| error.to_string()),
            Self::Dhtmlxq => export_dhtmlxq(document).map_err(|error| error.to_string()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardDto {
    fen: String,
    root_side_to_move: &'static str,
    root_score_cp: Option<i32>,
    root_mate: Option<i32>,
    side_to_move: &'static str,
    status: String,
    rule_name: &'static str,
    rule_verdict: &'static str,
    rule_reason: String,
    pieces: Vec<PieceDto>,
    history: Vec<MoveDto>,
    continuation: Vec<MoveDto>,
    branches: Vec<MoveDto>,
    sibling_branches: Vec<MoveDto>,
    manual_tree: Vec<ManualTreeNodeDto>,
    current_node: Option<Uuid>,
    title: String,
    note: String,
    source_path: Option<String>,
    source_format: Option<String>,
    playable: bool,
    #[serde(default)]
    xqb_candidates: Vec<xqb_opening_book::XqbCandidateDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManualTreeNodeDto {
    #[serde(rename = "move")]
    move_: MoveDto,
    children: Vec<ManualTreeNodeDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewLineStepDto {
    fen: String,
    notation: String,
    moved_by: &'static str,
    from: SquareDto,
    to: SquareDto,
    pieces: Vec<PieceDto>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameSummaryDto {
    id: Uuid,
    title: String,
    fen: String,
    updated_at: String,
    current: bool,
}

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisLine {
    depth: Option<u32>,
    score_cp: Option<i32>,
    mate: Option<i32>,
    nps: Option<u64>,
    time_ms: Option<u64>,
    hashfull: Option<u32>,
    multipv: u32,
    #[serde(default)]
    notation: Vec<String>,
    pv: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameReportMoveDto {
    node_id: Uuid,
    #[serde(default)]
    iccs: String,
    notation: String,
    moved_by: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpeningBookHitDto {
    code: String,
    name: String,
    ply: usize,
    source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameReportPositionDto {
    fen: String,
    side_to_move: String,
    ply: usize,
    phase: String,
    material: u32,
    score_cp: Option<i32>,
    mate: Option<i32>,
    depth: Option<u32>,
    elapsed_ms: Option<u64>,
    #[serde(default)]
    cached: bool,
    #[serde(default)]
    best_iccs: Option<String>,
    #[serde(default)]
    best_notation: Option<String>,
    #[serde(default)]
    pv_notation: Vec<String>,
    #[serde(default)]
    opening: Option<OpeningBookHitDto>,
    #[serde(rename = "move")]
    move_: Option<GameReportMoveDto>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameReportDatasetDto {
    game_id: Uuid,
    line_signature: String,
    engine_fingerprint: String,
    config_hash: String,
    generated_at: String,
    stale: bool,
    #[serde(default)]
    analysis_depth: Option<u32>,
    #[serde(default)]
    cached_positions: usize,
    positions: Vec<GameReportPositionDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameReportProgressDto {
    completed: usize,
    total: usize,
    node_id: Option<Uuid>,
    elapsed_ms: u64,
    target_depth: Option<u32>,
    current_depth: Option<u32>,
    cached: usize,
    estimated_remaining_ms: Option<u64>,
    state: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrainingTaskDto {
    id: Uuid,
    game_id: Uuid,
    node_id: Uuid,
    title: String,
    detail: String,
    completed_at: Option<String>,
    created_at: String,
}

impl From<TrainingTask> for TrainingTaskDto {
    fn from(task: TrainingTask) -> Self {
        Self {
            id: task.id,
            game_id: task.game_id,
            node_id: task.node_id,
            title: task.title,
            detail: task.detail,
            completed_at: task.completed_at,
            created_at: task.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    uploaded: usize,
    downloaded: usize,
    cursor: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineMoveDto {
    board: BoardDto,
    ponder: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartLinkSessionRequest {
    source: CaptureSource,
    recognition_mode: RecognitionMode,
    mode: LinkMode,
    stable_frames: u8,
    auto_side: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkObservationDto {
    state: LinkSessionState,
    accepted: bool,
    move_iccs: Option<String>,
    reason: Option<String>,
    board: Option<BoardDto>,
    capture_preview_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkSessionStatusDto {
    source: CaptureSource,
    mode: LinkMode,
    state: LinkSessionState,
    reason: Option<String>,
    frame_rate: f32,
    confidence: Option<f32>,
    stable_frames: u8,
    required_stable_frames: u8,
    latest_fen: Option<String>,
    last_move: Option<String>,
    auto_side: Option<String>,
    capture_running: bool,
}

#[tauri::command]
fn prepare_link_selection_window(app: tauri::AppHandle) -> Result<(), String> {
    prepare_window_link_selection(&app);
    std::thread::sleep(Duration::from_millis(300));
    Ok(())
}

#[tauri::command]
fn start_link_session(
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
    let capture_preview = if matches!(request.source, CaptureSource::WindowLink) {
        prepare_window_link_selection(&app);
        std::thread::sleep(Duration::from_millis(300));
        let preview = match capture_window_link_preview() {
            Ok(preview) => preview,
            Err(error) => {
                restore_main_window(&app);
                return Err(error);
            }
        };
        if preview.is_none() {
            restore_main_window(&app);
        }
        preview
    } else {
        None
    };
    if matches!(request.source, CaptureSource::WindowLink) && capture_preview.is_none() {
        return Err("未完成棋盘框选；请在系统选框中拖出第三方网页或客户端的棋盘区域".into());
    }
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    session.source = request.source;
    session.recognition_mode = request.recognition_mode;
    session.mode = request.mode;
    session.capture_preview = capture_preview;
    session.reason = None;
    session.state = match request.source {
        CaptureSource::ImageImport | CaptureSource::CameraBoard => {
            LinkSessionState::DetectingCorners
        }
        CaptureSource::WindowLink | CaptureSource::DesktopDetect => {
            LinkSessionState::ClassifyingSquares
        }
    };
    // A caller may ask for more confirmation, but never less than the source-safe default.
    session.gate = StabilityGate::new(request.stable_frames.max(policy.stable_frames));
    session.stable_frames = 0;
    session.confidence = None;
    session.frame_rate = 0.0;
    session.latest_fen = None;
    session.last_move = None;
    session.initial_position_seen = false;
    session.auto_side = match request.auto_side.as_deref() { Some("red") => Some(Color::Red), Some("black") => Some(Color::Black), _ => None };
    session.capture_running = matches!(request.source, CaptureSource::WindowLink);
    session.board_bounds = None;
    drop(session);
    if matches!(request.source, CaptureSource::WindowLink) {
        start_window_link_capture(app)?;
    }
    let session = state.link_session.lock().map_err(|_| "link session lock poisoned".to_owned())?;
    Ok(LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: session.reason.clone(),
        board: None,
        capture_preview_available: session.capture_preview.is_some(),
    })
}

#[tauri::command]
fn stop_link_session(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<LinkObservationDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    session.state = LinkSessionState::Stopped;
    session.gate.reset();
    session.reason = None;
    session.capture_preview = None;
    session.capture_running = false;
    session.latest_fen = None;
    session.confidence = None;
    if let Some(main_window) = app.get_webview_window("main") { let _ = main_window.show(); let _ = main_window.set_focus(); }
    Ok(LinkObservationDto {
        state: session.state,
        accepted: false,
        move_iccs: None,
        reason: None,
        board: None,
        capture_preview_available: false,
    })
}

#[tauri::command]
fn get_link_session_status(state: State<'_, DesktopState>) -> Result<LinkSessionStatusDto, String> {
    let session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    Ok(LinkSessionStatusDto {
        source: session.source,
        mode: session.mode,
        state: session.state,
        reason: session.reason.clone(),
        frame_rate: session.frame_rate,
        confidence: session.confidence,
        stable_frames: session.stable_frames,
        required_stable_frames: session.gate.required_frames(),
        latest_fen: session.latest_fen.clone(),
        last_move: session.last_move.clone(),
        auto_side: session.auto_side.map(color_name),
        capture_running: session.capture_running,
    })
}

#[tauri::command]
fn pause_link_session(state: State<'_, DesktopState>) -> Result<LinkSessionStatusDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if !matches!(session.state, LinkSessionState::Stopped) {
        session.state = LinkSessionState::Paused;
        session.capture_running = false;
        session.reason = Some("连线已暂停，未写入任何新着法".into());
    }
    Ok(LinkSessionStatusDto {
        source: session.source,
        mode: session.mode,
        state: session.state,
        reason: session.reason.clone(),
        frame_rate: session.frame_rate, confidence: session.confidence, stable_frames: session.stable_frames, required_stable_frames: session.gate.required_frames(), latest_fen: session.latest_fen.clone(), last_move: session.last_move.clone(), auto_side: session.auto_side.map(color_name), capture_running: session.capture_running,
    })
}

#[tauri::command]
fn recalibrate_link_session(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<LinkSessionStatusDto, String> {
    let source = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?
        .source;
    if matches!(source, CaptureSource::WindowLink) {
        prepare_window_link_selection(&app);
        std::thread::sleep(Duration::from_millis(300));
        let preview = match capture_window_link_preview() {
            Ok(preview) => preview,
            Err(error) => {
                restore_link_hint_window(&app);
                return Err(error);
            }
        };
        let Some(preview) = preview else {
            restore_link_hint_window(&app);
            return Err("未完成棋盘框选；请在系统选框中拖出第三方网页或客户端的棋盘区域".into());
        };
        let mut session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        session.gate.reset();
        session.capture_preview = Some(preview);
        session.state = LinkSessionState::Calibrating;
        session.capture_running = true;
        session.reason = Some("棋盘区域已重新框选；等待本机识别模型处理".into());
        drop(session);
        start_window_link_capture(app.clone())?;
        restore_link_hint_window(&app);
        let session = state.link_session.lock().map_err(|_| "link session lock poisoned".to_owned())?;
        return Ok(LinkSessionStatusDto {
            source: session.source,
            mode: session.mode,
            state: session.state,
            reason: session.reason.clone(),
            frame_rate: session.frame_rate, confidence: session.confidence, stable_frames: session.stable_frames, required_stable_frames: session.gate.required_frames(), latest_fen: session.latest_fen.clone(), last_move: session.last_move.clone(), auto_side: session.auto_side.map(color_name), capture_running: session.capture_running,
        });
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
    Ok(LinkSessionStatusDto {
        source: session.source,
        mode: session.mode,
        state: session.state,
        reason: session.reason.clone(),
        frame_rate: session.frame_rate, confidence: session.confidence, stable_frames: session.stable_frames, required_stable_frames: session.gate.required_frames(), latest_fen: session.latest_fen.clone(), last_move: session.last_move.clone(), auto_side: session.auto_side.map(color_name), capture_running: session.capture_running,
    })
}

#[tauri::command]
fn get_link_capture_preview(state: State<'_, DesktopState>) -> Result<Option<String>, String> {
    Ok(state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?
        .capture_preview
        .clone())
}

fn capture_window_link_preview() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let output_path = directory.path().join("xiangqi-link-selection.png");
        let output = ProcessCommand::new("/usr/sbin/screencapture")
            .args(["-i", "-x", "-o"])
            .arg(&output_path)
            .output()
            .map_err(|error| format!("无法启动 macOS 框选截图：{error}"))?;
        if !output.status.success() || !output_path.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(&output_path).map_err(|error| error.to_string())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("框选图片过大，请只选择棋盘区域后重试".into());
        }
        Ok(Some(format!("data:image/png;base64,{}", BASE64.encode(bytes))))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("当前平台尚未接入系统框选；请先使用截图/照片导入".into())
    }
}

fn prepare_window_link_selection(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }
}

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

fn restore_link_hint_window(app: &tauri::AppHandle) {
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.show();
        let _ = link_window.set_focus();
    }
}

fn color_name(color: Color) -> String { match color { Color::Red => "red".into(), Color::Black => "black".into() } }

fn link_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().resource_dir().map_err(|error| error.to_string())?.join("link-vision/yolov11.onnx");
    if path.is_file() { Ok(path) } else { Err("随包 YOLO11 模型不存在，请重新安装应用".into()) }
}

fn validate_link_model(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop { let count = file.read(&mut buffer).map_err(|error| error.to_string())?; if count == 0 { break; } digest.update(&buffer[..count]); }
    let actual = format!("{:x}", digest.finalize());
    const EXPECTED: &str = "099c4ef0cbfbd07f680037bb1aabf59024f5c0243964b36aeec7c7a57f7213e1";
    if actual == EXPECTED { Ok(()) } else { Err("YOLO11 模型哈希校验失败，已拒绝启动连线识别".into()) }
}

fn start_window_link_capture(app: tauri::AppHandle) -> Result<(), String> {
    let path = link_model_path(&app)?;
    validate_link_model(&path)?;
    std::thread::spawn(move || {
        let mut detector = match link_vision::Yolo11Detector::open(&path) {
            Ok(detector) => detector,
            Err(error) => { set_link_capture_error(&app, error); return; }
        };
        let mut previous = Instant::now();
        loop {
            let should_run = app.state::<DesktopState>().link_session.lock().map(|session| session.capture_running && !matches!(session.state, LinkSessionState::Stopped)).unwrap_or(false);
            if !should_run { break; }
            let started = Instant::now();
            match capture_primary_display() {
                Ok(frame) => {
                    let board = match app.state::<DesktopState>().model.lock() { Ok(model) => model.board.clone(), Err(_) => { set_link_capture_error(&app, "棋谱状态暂时不可用".into()); break; } };
                    match detector.detect_png(&frame).and_then(|detections| {
                        if let Some(bounds) = link_vision::board_bounds(&detections) { if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() { session.board_bounds = Some(bounds); } }
                        link_vision::recognition_from_detections(&detections, &board)
                    }) {
                        Ok(recognition) => {
                            if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() { session.board_orientation = recognition.orientation; }
                            let fen = recognition.fen.clone();
                            if let Err(error) = observe_link_recognition(&app, fen, recognition.confidence) { set_link_capture_error(&app, error); }
                        }
                        Err(error) => set_link_capture_waiting(&app, error),
                    }
                }
                Err(error) => set_link_capture_error(&app, error),
            }
            let elapsed = previous.elapsed().as_secs_f32(); previous = Instant::now();
            if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() { session.frame_rate = if elapsed > 0.0 { 1.0 / elapsed } else { 0.0 }; }
            let delay = Duration::from_millis(333).saturating_sub(started.elapsed());
            std::thread::sleep(delay);
        }
    });
    Ok(())
}

fn capture_primary_display() -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let path = directory.path().join("xiangqi-link-frame.png");
        let output = ProcessCommand::new("/usr/sbin/screencapture").args(["-x", "-o"]).arg(&path).output().map_err(|error| format!("无法采集屏幕：{error}"))?;
        if !output.status.success() { return Err("屏幕录制失败，请在系统设置中允许 Xiangqi Studio 使用屏幕录制".into()); }
        fs::read(path).map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { Err("当前持续连线采集尚未接入此平台".into()) }
}

fn set_link_capture_waiting(app: &tauri::AppHandle, reason: String) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        if !matches!(session.state, LinkSessionState::Paused | LinkSessionState::Stopped) { session.state = LinkSessionState::ClassifyingSquares; session.reason = Some(reason); session.stable_frames = 0; }
    }
}

fn set_link_capture_error(app: &tauri::AppHandle, reason: String) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        session.state = LinkSessionState::NeedsManualCorrection; session.reason = Some(reason); session.capture_running = false;
    }
}

/// The vision adapter submits a corrected FEN only after image recognition. This command is
/// deliberately independent from capture/model implementations so all inputs share one guard.
#[tauri::command]
fn submit_link_position(
    fen: String,
    state: State<'_, DesktopState>,
) -> Result<LinkObservationDto, String> {
    observe_link_recognition_inner(&state, fen, None)
}

/// Executes a reviewed engine move only against the currently stable visible board. The move is
/// intentionally not committed here: the normal recognition/reconciliation path must observe the
/// expected position before SQLite is changed.
#[tauri::command]
fn confirm_link_engine_move(iccs: String, state: State<'_, DesktopState>) -> Result<bool, String> {
    let (bounds, orientation, mode, latest_fen, auto_side) = {
        let session = state.link_session.lock().map_err(|_| "link session lock poisoned".to_owned())?;
        if !matches!(session.state, LinkSessionState::Tracking) { return Err("外部局面尚未稳定，不能执行走子".into()); }
        (session.board_bounds.ok_or("未获得棋盘坐标，请重新框选")?, session.board_orientation, session.mode, session.latest_fen.clone(), session.auto_side)
    };
    if !matches!(mode, LinkMode::ConfirmPlay | LinkMode::AutoPlay) { return Err("当前为观战跟盘模式，不能执行外部点击".into()); }
    let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    if latest_fen.as_deref() != Some(&model.board.to_fen()) { return Err("外部局面已变化，已拒绝使用过期引擎建议".into()); }
    if matches!(mode, LinkMode::AutoPlay) && auto_side != Some(model.board.side_to_move()) { return Err("当前回合不属于设置的自动执棋方".into()); }
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let expected = model.board.apply_move(mv).map_err(|_| "引擎建议已过期或不是当前局面的合法着法".to_string())?;
    drop(model);
    click_external_move(bounds, orientation, mv)?;
    let mut session = state.link_session.lock().map_err(|_| "link session lock poisoned".to_owned())?;
    session.reason = Some(format!("已执行 {iccs}，等待识别确认预期局面 {}", expected.to_fen()));
    session.gate.reset();
    session.stable_frames = 0;
    Ok(true)
}

fn click_external_move(bounds: (f32, f32, f32, f32), orientation: link_core::BoardOrientation, mv: Move) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (left, top, width, height) = bounds;
        let point = |square: Square| -> (f32, f32) { let (row, col) = match orientation { link_core::BoardOrientation::RedAtBottom => (square.row, square.col), link_core::BoardOrientation::BlackAtBottom => (9 - square.row, 8 - square.col) }; (left + col as f32 * width / 8.0, top + row as f32 * height / 9.0) };
        let (from_x, from_y) = point(mv.from); let (to_x, to_y) = point(mv.to);
        let script = format!("tell application \"System Events\" to click at {{{from_x:.0}, {from_y:.0}}}\ndelay 0.12\ntell application \"System Events\" to click at {{{to_x:.0}, {to_y:.0}}}");
        let output = ProcessCommand::new("/usr/bin/osascript").args(["-e", &script]).output().map_err(|error| format!("无法请求 macOS 辅助功能点击：{error}"))?;
        if output.status.success() { Ok(()) } else { Err("外部点击被 macOS 拒绝。请在 系统设置 > 隐私与安全性 > 辅助功能 中允许 Xiangqi Studio，然后重新框选。".into()) }
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (bounds, orientation, mv); Err("当前平台尚未接入外部鼠标点击".into()) }
}

fn observe_link_recognition(app: &tauri::AppHandle, fen: String, confidence: f32) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    observe_link_recognition_inner(&state, fen, Some(confidence)).map(|_| ())
}

fn observe_link_recognition_inner(
    state: &DesktopState,
    fen: String,
    confidence: Option<f32>,
) -> Result<LinkObservationDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if matches!(session.state, LinkSessionState::Stopped) {
        return Err("请先启动连线会话".into());
    }
    if matches!(session.state, LinkSessionState::Paused) { return Ok(LinkObservationDto { state: session.state, accepted: false, move_iccs: None, reason: session.reason.clone(), board: None, capture_preview_available: session.capture_preview.is_some() }); }
    session.latest_fen = Some(fen.clone());
    if let Some(confidence) = confidence { session.confidence = Some(confidence); if confidence < 0.70 { session.state = LinkSessionState::NeedsManualCorrection; session.capture_running = false; session.reason = Some(format!("识别置信度 {:.0}% 低于 70%，已暂停采集；请保持棋盘完整可见或重新框选", confidence * 100.0)); return Ok(LinkObservationDto { state: session.state, accepted: false, move_iccs: None, reason: session.reason.clone(), board: None, capture_preview_available: session.capture_preview.is_some() }); } }
    let stable = match session.gate.observe(&fen) {
        Ok(value) => value,
        Err(error) => {
            session.state = LinkSessionState::NeedsManualCorrection;
            return Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: Some(error.to_string()),
                board: None,
                capture_preview_available: session.capture_preview.is_some(),
            });
        }
    };
    if !stable {
        session.state = LinkSessionState::WaitingStableFrames;
        session.stable_frames = session.gate.matching_frames();
        return Ok(LinkObservationDto {
            state: session.state,
            accepted: false,
            move_iccs: None,
            reason: Some("等待连续稳定识别帧".into()),
            board: None,
            capture_preview_available: session.capture_preview.is_some(),
        });
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    match link_core::reconcile_position(&model.board, &fen) {
        ReconcileDecision::Unchanged => {
            session.state = LinkSessionState::Tracking;
            session.initial_position_seen = true;
            session.stable_frames = session.gate.matching_frames();
            Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: None,
                board: None,
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
        ReconcileDecision::ApplyMove(mv) => {
            let iccs = mv.to_iccs();
            let board = commit_move(&mut model, &iccs)?;
            session.state = LinkSessionState::Tracking;
            session.initial_position_seen = true;
            session.last_move = Some(iccs.clone());
            Ok(LinkObservationDto {
                state: session.state,
                accepted: true,
                move_iccs: Some(iccs),
                reason: None,
                board: Some(board),
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
        ReconcileDecision::NeedsManualCorrection { reason } => {
            if !session.initial_position_seen {
                let mut document = ManualDocument::new(fen.clone()).map_err(|error| error.to_string())?;
                document.metadata.title = format!("连线记录 {}", Utc::now().format("%Y-%m-%d %H:%M"));
                document.note = "首次连线局面与原棋谱不一致，已新建连线记录，不会覆盖原棋谱。".into();
                install_document(&mut model, document, None, Some("window-link".into()))?;
                let board = board_dto(&model)?;
                session.state = LinkSessionState::Tracking;
                session.initial_position_seen = true;
                session.reason = Some("外部初始局面已保存为新的“连线记录”棋局".into());
                return Ok(LinkObservationDto { state: session.state, accepted: true, move_iccs: None, reason: session.reason.clone(), board: Some(board), capture_preview_available: session.capture_preview.is_some() });
            }
            session.state = LinkSessionState::NeedsManualCorrection;
            Ok(LinkObservationDto {
                state: session.state,
                accepted: false,
                move_iccs: None,
                reason: Some(reason),
                board: None,
                capture_preview_available: session.capture_preview.is_some(),
            })
        }
    }
}

#[tauri::command]
fn import_recognized_position(
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

#[tauri::command]
fn get_state(state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    board_dto(&model)
}

#[tauri::command]
fn list_games(state: State<'_, DesktopState>) -> Result<Vec<GameSummaryDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|game| GameSummaryDto {
            id: game.id,
            title: game.title,
            fen: game.starting_fen,
            updated_at: game.updated_at,
            current: game.id == model.game_id,
        })
        .collect())
}

#[tauri::command]
fn open_game(game_id: Uuid, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game = model
        .store
        .load_game(game_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "棋谱不存在".to_owned())?;
    load_game_into_model(&mut model, game)?;
    board_dto(&model)
}

#[tauri::command]
fn play_move(iccs: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    commit_move(&mut model, &iccs)
}

#[tauri::command]
fn preview_line(fen: String, pv: Vec<String>) -> Result<Vec<PreviewLineStepDto>, String> {
    preview_line_steps(&fen, &pv)
}

fn preview_line_steps(fen: &str, pv: &[String]) -> Result<Vec<PreviewLineStepDto>, String> {
    let mut board = Board::from_fen(fen).map_err(|error| error.to_string())?;
    let mut steps = Vec::with_capacity(pv.len());
    for (index, iccs) in pv.iter().enumerate() {
        let mv = xiangqi_core::Move::from_iccs(iccs)
            .map_err(|error| format!("候选线路第 {} 步格式不正确：{}", index + 1, error))?;
        let piece = board
            .piece_at(mv.from)
            .ok_or_else(|| format!("候选线路第 {} 步非法：起点没有棋子", index + 1))?;
        let notation = board
            .chinese_move_notation(mv)
            .map_err(|error| format!("候选线路第 {} 步无法生成中文记谱：{}", index + 1, error))?;
        let next = board
            .apply_move(mv)
            .map_err(|error| format!("候选线路第 {} 步非法：{}", index + 1, error))?;
        steps.push(PreviewLineStepDto {
            fen: next.to_fen(),
            notation,
            moved_by: side_label(piece.color),
            from: SquareDto {
                row: mv.from.row,
                col: mv.from.col,
            },
            to: SquareDto {
                row: mv.to.row,
                col: mv.to.col,
            },
            pieces: board_pieces(&next),
            status: game_status_label(next.status()),
        });
        board = next;
    }
    Ok(steps)
}

fn commit_move(model: &mut AppModel, iccs: &str) -> Result<BoardDto, String> {
    if !model.playable {
        return Err("当前研究局面不可对弈，请先在局面编辑器中修正".into());
    };
    let mv = xiangqi_core::Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let next = model
        .board
        .apply_move(mv)
        .map_err(|error| error.to_string())?;
    let parent = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let mut next_tree = model.tree.clone();
    let node_id = next_tree
        .add_move(parent, mv, "")
        .map_err(|error| error.to_string())?;
    let operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: node_id,
        game_id: model.game_id,
        kind: OperationKind::AddMove,
        payload: serde_json::to_value(AddMovePayload {
            node_id,
            parent_id: parent,
            move_iccs: iccs.to_owned(),
            order_key: next_tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .order_key,
            is_mainline: next_tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .is_mainline,
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport + 1,
        created_at: Utc::now(),
    };
    let node = next_tree
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
    model.lamport = operation.lamport;
    model.tree = next_tree;
    model.current_node = Some(node_id);
    model.board = next;
    board_dto(model)
}

#[tauri::command]
fn new_game(
    fen: String,
    title: Option<String>,
    note: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut document = ManualDocument::new(fen).map_err(|error| error.to_string())?;
    document.metadata.title = title.unwrap_or_else(|| "新建棋谱".into());
    document.note = note.unwrap_or_default();
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, None)?;
    board_dto(&model)
}

#[tauri::command]
fn open_document(path: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("读取棋谱失败：{error}"))?;
    let hint = format_hint_from_path(&path);
    let format = detect_format(&bytes, hint);
    let document = import_document(&bytes, Some(format)).map_err(|error| error.to_string())?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(path),
        Some(format_name(format).into()),
    )?;
    board_dto(&model)
}

#[tauri::command]
fn import_xqb_opening_book(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let target = PathBuf::from(&path);
    xqb_opening_book::validate(&target)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences
        .xqb_book_paths
        .iter()
        .any(|existing| existing == &path)
    {
        preferences.xqb_book_paths.push(path);
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    board_dto(&model)
}

#[tauri::command]
fn import_text(text: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let document = if Board::from_fen(text.trim()).is_ok() {
        ManualDocument::new(text.trim()).map_err(|error| error.to_string())?
    } else {
        import_document(text.as_bytes(), Some(ManualFormat::Pgn))
            .map_err(|error| error.to_string())?
    };
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, None)?;
    board_dto(&model)
}

#[tauri::command]
fn export_text(mainline_only: bool, state: State<'_, DesktopState>) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let document = document_from_model(&model);
    if mainline_only {
        export_mainline_pgn(&document).map_err(|error| error.to_string())
    } else {
        Ok(export_pgn(&document))
    }
}

#[tauri::command]
fn export_document_text(
    format: ExportFormat,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    format.export(&document_from_model(&model))
}

#[tauri::command]
fn export_document_file(
    path: String,
    format: ExportFormat,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let contents = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        format.export(&document_from_model(&model))?
    };
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some(format.extension()) {
        return Err(format!("导出文件必须使用 .{} 扩展名", format.extension()));
    }
    std::fs::write(&target, contents).map_err(|error| format!("导出棋谱失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_replay_gif(
    path: String,
    scope: ReplayExportScope,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("gif") {
        return Err("动态图必须使用 .gif 扩展名".into());
    }
    let (document, current_node) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        (document_from_model(&model), model.current_node)
    };
    let scope = match scope {
        ReplayExportScope::CurrentSelection => gif_export::ReplayScope::CurrentSelection,
        ReplayExportScope::Mainline => gif_export::ReplayScope::Mainline,
    };
    gif_export::export_replay_gif(&target, &document, current_node, scope)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_mind_map_svg(path: String, svg: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("svg") {
        return Err("变招图必须使用 .svg 扩展名".into());
    }
    if !svg.trim_start().starts_with("<?xml") || !svg.contains("<svg") {
        return Err("变招图内容不是有效 SVG".into());
    }
    std::fs::write(&target, svg).map_err(|error| format!("导出变招图失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_text_file(path: String, contents: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("txt") {
        return Err("文本文件必须使用 .txt 扩展名".into());
    }
    std::fs::write(&target, contents).map_err(|error| format!("导出文本失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_manual_pdf(path: String, state: State<'_, DesktopState>) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("pdf") {
        return Err("棋谱 PDF 必须使用 .pdf 扩展名".into());
    }
    let document = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        document_from_model(&model)
    };
    let saved = manual_pdf::write_manual_pdf(&target, &document)?;
    Ok(saved.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_document(path: Option<String>, state: State<'_, DesktopState>) -> Result<String, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let target = match path {
        Some(path) => path,
        None if model.source_format.as_deref() == Some("pgn") => model
            .source_path
            .clone()
            .ok_or_else(|| "当前棋谱尚未关联文件，请使用另存为".to_owned())?,
        None => return Err("导入格式不可覆盖保存，请另存为 PGN".into()),
    };
    std::fs::write(&target, export_pgn(&document_from_model(&model)))
        .map_err(|error| format!("保存棋谱失败：{error}"))?;
    let game_id = model.game_id;
    model
        .store
        .set_game_source(game_id, Some(&target), Some("pgn"))
        .map_err(|error| error.to_string())?;
    model.source_path = Some(target.clone());
    model.source_format = Some("pgn".into());
    Ok(target)
}

#[tauri::command]
fn update_game_metadata(
    title: String,
    note: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game_id = model.game_id;
    let mut metadata = model.metadata.clone();
    metadata.title = title.clone();
    let payload = metadata_payload(&metadata, &note);
    let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_metadata_with_operation(game_id, &title, &note, &metadata_json, &operation)
        .map_err(|error| error.to_string())?;
    model.metadata = metadata;
    model.note = note;
    board_dto(&model)
}

#[tauri::command]
fn reorder_branches(
    node_ids: Vec<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let mut reordered_tree = model.tree.clone();
    reordered_tree
        .reorder_branches(parent_id, &node_ids)
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        parent_id,
        OperationKind::ReorderBranches,
        serde_json::to_value(ReorderBranchesPayload {
            parent_id,
            node_ids: node_ids.clone(),
        })
        .map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .reorder_branches_with_operation(game_id, parent_id, &node_ids, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = reordered_tree;
    board_dto(&model)
}

#[tauri::command]
fn navigate_to(
    node_id: Option<Uuid>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<BoardDto, String> {
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
    let board = board_dto(&model)?;
    let _ = app.emit("board-navigated", &board);
    Ok(board)
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
    let mut next_tree = model.tree.clone();
    next_tree
        .update_comment(node_id, comment.clone())
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::UpdateComment,
        serde_json::to_value(UpdateCommentPayload { node_id, comment })
            .map_err(|error| error.to_string())?,
    );
    let comment = next_tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .comment
        .clone();
    model
        .store
        .update_comment_with_operation(node_id, &comment, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = next_tree;
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
    let mut next_tree = model.tree.clone();
    next_tree
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
    model.tree = next_tree;
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
    let mut next_tree = model.tree.clone();
    next_tree
        .remove(node_id)
        .map_err(|error| error.to_string())?;
    let next_current_node = if affects_current_line {
        (parent_id != next_tree.root_id()).then_some(parent_id)
    } else {
        model.current_node
    };
    let next_board = if affects_current_line {
        Some(board_at(
            &model.starting_fen,
            &next_tree,
            next_current_node,
        )?)
    } else {
        None
    };
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::DeleteNode,
        serde_json::to_value(DeleteNodePayload { node_id }).map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .delete_node_with_operation(game_id, node_id, next_current_node, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = next_tree;
    model.current_node = next_current_node;
    if let Some(board) = next_board {
        model.board = board;
    }
    board_dto(&model)
}

#[tauri::command]
async fn analyze_position(
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
        "nodes" => SearchLimit::Nodes(search_value.clamp(1_000, 100_000_000)),
        "infinite" => SearchLimit::Infinite,
        _ => return Err("unsupported search mode".into()),
    };
    let multipv = multipv.clamp(1, 10);
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
    let resolved_engine_family = engine_family(&resolved_engine_path);
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
        .search(
            &fen,
            &[],
            limit,
            &engine_search_moves_for_family(&search_moves, resolved_engine_family),
            false,
        )
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
                let line =
                    analysis_line_from_engine_info(&analysis_board, info, resolved_engine_family);
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
                let best =
                    normalize_engine_move_for_board(&analysis_board, &best, resolved_engine_family)
                        .unwrap_or(best);
                let ponder = ponder.and_then(|value| {
                    let best_move = Move::from_iccs(&best).ok()?;
                    let board = analysis_board.apply_move(best_move).ok()?;
                    normalize_engine_move_for_board(&board, &value, resolved_engine_family)
                        .or(Some(value))
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
    Ok(lines)
}

#[tauri::command]
async fn engine_play_move(
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
    if !state.engine.lock().await.is_empty() {
        return Err("引擎正在执行其他搜索，请先停止".into());
    }
    let resolved_engine_path = resolve_engine_path(&app, &engine_path)?;
    let resolved_engine_path_text = resolved_engine_path.to_string_lossy().into_owned();
    let resolved_engine_family = engine_family(&resolved_engine_path);
    let mut slot = state.play_session.lock().await;
    if slot
        .as_ref()
        .is_some_and(|play| play.path != resolved_engine_path_text)
    {
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
                        line: analysis_line_from_engine_info(&board, info, resolved_engine_family),
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
        normalize_engine_move_for_board(&board_before_best, &best_move, resolved_engine_family)
            .unwrap_or(best_move);
    let board_after_best = Move::from_iccs(&best_move)
        .ok()
        .and_then(|mv| board_before_best.apply_move(mv).ok());
    let ponder_move = ponder_move.and_then(|predicted| {
        board_after_best
            .as_ref()
            .and_then(|board| {
                normalize_engine_move_for_board(board, &predicted, resolved_engine_family)
            })
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
async fn stop_engine_play(
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
async fn move_now(state: State<'_, DesktopState>) -> Result<bool, String> {
    let control = state.engine.lock().await.values().next().cloned();
    if let Some(control) = control {
        control.stop().await.map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn detect_pikafish(app: tauri::AppHandle) -> Option<String> {
    if bundled_pikafish_path(&app).is_some() {
        return Some(BUILTIN_ENGINE_PATH.into());
    }
    if bundled_fairy_stockfish_path(&app).is_some() {
        return Some(BUILTIN_FAIRY_ENGINE_PATH.into());
    }
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PIKAFISH_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = std::env::var_os("FAIRY_STOCKFISH_PATH") {
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
            candidates.push(directory.join("fairy-stockfish"));
            candidates.push(directory.join("fairy-stockfish.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_compact_floating_panel(app: tauri::AppHandle, panel: String) -> Result<bool, String> {
    let (label, title, width, height, min_width, min_height) = match panel.as_str() {
        "engine" => ("compact-engine", "引擎分析", 430.0, 520.0, 360.0, 320.0),
        "manual" => ("compact-manual", "棋谱", 430.0, 580.0, 360.0, 320.0),
        "cloud" => ("compact-cloud", "云库 / 评估信息", 520.0, 640.0, 360.0, 320.0),
        "link" => ("compact-link", "连线控制", 520.0, 260.0, 360.0, 200.0),
        _ => return Err("未知的浮动面板".into()),
    };
    if let Some(window) = app.get_webview_window(label) {
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(false);
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?floatingPanel={panel}").into()),
    )
    .title(format!("Xiangqi Studio · {title}"))
    .inner_size(width, height)
    .min_inner_size(min_width, min_height)
    .resizable(true)
    .decorations(true)
    .always_on_top(true)
    .build()
    .map_err(|error| error.to_string())?;

    Ok(true)
}

#[tauri::command]
fn return_compact_floating_panel(app: tauri::AppHandle, panel: String) -> Result<bool, String> {
    let label = match panel.as_str() {
        "engine" => "compact-engine",
        "manual" => "compact-manual",
        "cloud" => "compact-cloud",
        "link" => "compact-link",
        _ => return Err("未知的浮动面板".into()),
    };

    app.emit(
        "compact-panel-return",
        serde_json::json!({ "panel": panel }),
    )
    .map_err(|error| error.to_string())?;

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    if let Some(window) = app.get_webview_window(label) {
        window.destroy().map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

fn bundled_pikafish_path(app: &tauri::AppHandle) -> Option<PathBuf> {
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

fn bundled_fairy_stockfish_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    // During `tauri dev`, resources stay in the source resource directory.
    candidates.extend(fairy_stockfish_candidates(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .as_path(),
    ));
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(fairy_stockfish_candidates(&resource_dir));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(fairy_stockfish_candidates(parent));
            candidates.extend(fairy_stockfish_candidates(&parent.join("../Resources")));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
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

fn fairy_stockfish_candidates(base: &Path) -> Vec<PathBuf> {
    [
        "fairy-stockfish",
        "fairy-stockfish.exe",
        "fairy-stockfish/fairy-stockfish",
        "fairy-stockfish/fairy-stockfish.exe",
        "resources/fairy-stockfish/fairy-stockfish",
        "resources/fairy-stockfish/fairy-stockfish.exe",
    ]
    .into_iter()
    .map(|relative| base.join(relative))
    .collect()
}

fn resolve_engine_path(app: &tauri::AppHandle, value: &str) -> Result<PathBuf, String> {
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
    if trimmed == BUILTIN_FAIRY_ENGINE_PATH {
        return bundled_fairy_stockfish_path(app)
            .or_else(|| {
                std::env::var_os("FAIRY_STOCKFISH_PATH")
                    .map(PathBuf::from)
                    .filter(|path| path.is_file())
            })
            .ok_or_else(|| {
                "安装包内未找到内置 Fairy-Stockfish；开发模式请设置 FAIRY_STOCKFISH_PATH，或手动选择外部引擎"
                    .to_owned()
            });
    }
    if trimmed.is_empty() {
        return Err("请先选择 UCI/UCCI 象棋引擎".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_file() {
        return Err("引擎可执行文件不存在".into());
    }
    Ok(path)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EngineFamily {
    Pikafish,
    FairyStockfish,
    Unknown,
}

fn engine_family(engine_path: &Path) -> EngineFamily {
    let executable_name = engine_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if executable_name.contains("fairy-stockfish") || executable_name.contains("fairystockfish") {
        return EngineFamily::FairyStockfish;
    }
    if executable_name.contains("pikafish") {
        return EngineFamily::Pikafish;
    }

    for component in engine_path.components().rev().skip(1) {
        let component = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        if component.contains("fairy-stockfish") || component.contains("fairystockfish") {
            return EngineFamily::FairyStockfish;
        }
        if component.contains("pikafish") {
            return EngineFamily::Pikafish;
        }
    }

    EngineFamily::Unknown
}

fn nnue_matches_engine_family(file_name: &str, family: EngineFamily) -> bool {
    match family {
        EngineFamily::Pikafish => !file_name.contains("fairy"),
        EngineFamily::FairyStockfish => !file_name.contains("pikafish"),
        EngineFamily::Unknown => true,
    }
}

fn preferred_nnue_path(engine_path: &Path) -> Option<PathBuf> {
    let parent = engine_path.parent()?;
    let family = engine_family(engine_path);
    let mut nnue_files = std::fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("nnue"))
        })
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| nnue_matches_engine_family(&name.to_ascii_lowercase(), family))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    nnue_files.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        nnue_priority(&left_name)
            .cmp(&nnue_priority(&right_name))
            .then_with(|| left_name.cmp(&right_name))
    });
    nnue_files.into_iter().next()
}

fn nnue_priority(file_name: &str) -> u8 {
    if file_name.starts_with("xiangqi")
        || file_name.contains("-xiangqi")
        || file_name.contains("_xiangqi")
    {
        0
    } else if file_name.contains("fairy") {
        1
    } else if file_name.contains("pikafish") {
        2
    } else {
        3
    }
}

async fn configure_engine_nnue(
    session: &mut EngineSession,
    engine_path: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(nnue_path) = preferred_nnue_path(engine_path) else {
        return Ok(None);
    };
    session
        .configure("EvalFile", &nnue_path.to_string_lossy())
        .await
        .map_err(|error| format!("设置 NNUE EvalFile 失败：{error}"))?;
    Ok(Some(nnue_path))
}

fn engine_variant_option(engine_path: &Path) -> Option<&'static str> {
    match engine_family(engine_path) {
        EngineFamily::FairyStockfish => Some("xiangqi"),
        EngineFamily::Pikafish | EngineFamily::Unknown => None,
    }
}

fn fairy_rank_to_internal(rank: &str) -> Option<u8> {
    let rank = rank.parse::<u8>().ok()?;
    (1..=10).contains(&rank).then_some(rank - 1)
}

fn split_fairy_square_pair(value: &str) -> Option<(char, &str, char, &str)> {
    let mut chars = value.char_indices();
    let (_, from_file) = chars.next()?;
    if !matches!(from_file, 'a'..='i') {
        return None;
    }
    let from_rank_start = from_file.len_utf8();
    let (to_file_index, to_file) =
        value[from_rank_start..]
            .char_indices()
            .find_map(|(offset, character)| {
                matches!(character, 'a'..='i').then_some((from_rank_start + offset, character))
            })?;
    let to_rank_start = to_file_index + to_file.len_utf8();
    let from_rank = &value[from_rank_start..to_file_index];
    let to_rank = &value[to_rank_start..];
    if from_rank.is_empty() || to_rank.is_empty() {
        return None;
    }
    Some((from_file, from_rank, to_file, to_rank))
}

fn fairy_xiangqi_to_internal_iccs(value: &str) -> Option<String> {
    let (from_file, from_rank, to_file, to_rank) = split_fairy_square_pair(value)?;
    let from_rank = fairy_rank_to_internal(from_rank)?;
    let to_rank = fairy_rank_to_internal(to_rank)?;
    Some(format!("{from_file}{from_rank}{to_file}{to_rank}"))
}

fn internal_iccs_to_fairy_xiangqi(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 4
        || !matches!(bytes[0], b'a'..=b'i')
        || !matches!(bytes[2], b'a'..=b'i')
        || !matches!(bytes[1], b'0'..=b'9')
        || !matches!(bytes[3], b'0'..=b'9')
    {
        return None;
    }
    let from_rank = bytes[1] - b'0' + 1;
    let to_rank = bytes[3] - b'0' + 1;
    Some(format!(
        "{}{}{}{}",
        bytes[0] as char, from_rank, bytes[2] as char, to_rank
    ))
}

fn normalize_engine_move_for_board(
    board: &Board,
    value: &str,
    family: EngineFamily,
) -> Option<String> {
    let mut candidates = Vec::new();
    if family == EngineFamily::FairyStockfish {
        if let Some(converted) = fairy_xiangqi_to_internal_iccs(value) {
            candidates.push(converted);
        }
    }
    candidates.push(value.to_owned());

    candidates.into_iter().find(|candidate| {
        Move::from_iccs(candidate)
            .ok()
            .is_some_and(|mv| board.apply_move(mv).is_ok())
    })
}

fn normalize_engine_pv_for_board(
    board: &Board,
    pv: &[String],
    family: EngineFamily,
) -> Vec<String> {
    let mut current = board.clone();
    let mut normalized = Vec::with_capacity(pv.len());
    for raw in pv {
        let Some(candidate) = normalize_engine_move_for_board(&current, raw, family) else {
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

fn normalize_pv_and_notation_with_fairy_fallback(
    board: &Board,
    pv: &[String],
) -> (Vec<String>, Vec<String>) {
    if let Ok(notation) = board.chinese_pv_notation(pv) {
        return (pv.to_vec(), notation);
    }
    let normalized = normalize_engine_pv_for_board(board, pv, EngineFamily::FairyStockfish);
    let notation = board.chinese_pv_notation(&normalized).unwrap_or_default();
    (normalized, notation)
}

fn engine_search_moves_for_family(search_moves: &[String], family: EngineFamily) -> Vec<String> {
    if family != EngineFamily::FairyStockfish {
        return search_moves.to_vec();
    }
    search_moves
        .iter()
        .map(|value| internal_iccs_to_fairy_xiangqi(value).unwrap_or_else(|| value.clone()))
        .collect()
}

fn analysis_line_from_engine_info(
    board: &Board,
    info: engine_protocol::EngineInfo,
    family: EngineFamily,
) -> AnalysisLine {
    let pv = normalize_engine_pv_for_board(board, &info.pv, family);
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

async fn configure_engine_for_xiangqi(
    session: &mut EngineSession,
    engine_path: &Path,
) -> Result<Option<PathBuf>, String> {
    if session.protocol() == Protocol::Uci {
        if let Some(variant) = engine_variant_option(engine_path) {
            session
                .configure("UCI_Variant", variant)
                .await
                .map_err(|error| format!("设置 Fairy-Stockfish 象棋变体失败：{error}"))?;
        }
    }
    configure_engine_nnue(session, engine_path).await
}

async fn next_arena_bestmove(
    session: &mut EngineSession,
    engine_path: &Path,
    board: &Board,
    move_time_ms: u64,
) -> Result<String, String> {
    let family = engine_family(engine_path);
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
                    let best = normalize_engine_move_for_board(board, &best, family)
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

async fn launch_arena_engine(
    app: &tauri::AppHandle,
    player: &EngineArenaPlayerDto,
    threads: u32,
    hash_mb: u32,
) -> Result<(PathBuf, EngineSession), String> {
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
    Ok((path, session))
}

fn arena_score(name: &str, games: &[EngineArenaGameDto]) -> EngineArenaScoreDto {
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

fn arena_rule_outcome(
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

async fn run_arena_game(
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
    let (red_path, mut red_session) =
        launch_arena_engine(app, red, options.threads, options.hash_mb).await?;
    let (black_path, mut black_session) =
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
        let current_path = if red_turn { &red_path } else { &black_path };
        let current_session = if red_turn {
            &mut red_session
        } else {
            &mut black_session
        };
        let best =
            match next_arena_bestmove(current_session, current_path, &board, options.move_time_ms)
                .await
            {
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
async fn run_engine_arena(
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

fn report_line_nodes(
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

fn report_line_signature(tree: &ManualTree, current_node: Option<Uuid>) -> Result<String, String> {
    let mut ids = vec![tree.root_id().to_string()];
    ids.extend(
        report_line_nodes(tree, current_node)?
            .into_iter()
            .map(|node| node.id.to_string()),
    );
    Ok(ids.join(":"))
}

fn report_material(board: &Board) -> u32 {
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

fn report_phase(ply: usize, material: u32) -> &'static str {
    if material <= 2547 || ply > 80 {
        "endgame"
    } else if ply <= 20 {
        "opening"
    } else {
        "middle"
    }
}

fn fen_starting_ply(fen: &str) -> usize {
    let fields = fen.split_whitespace().collect::<Vec<_>>();
    let fullmove = fields
        .get(5)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    (fullmove - 1) * 2 + usize::from(fields.get(1) == Some(&"b"))
}

fn terminal_report_mate(board: &Board) -> Option<i32> {
    (board.status() == GameStatus::Checkmate).then_some(-1)
}

fn update_fingerprint(hasher: &mut Sha256, path: &Path) -> Result<(), String> {
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

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    update_fingerprint(&mut hasher, path)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn report_engine_fingerprint(engine_path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(b"engine\0");
    update_fingerprint(&mut hasher, engine_path)?;

    if let Some(variant) = engine_variant_option(engine_path) {
        hasher.update(b"variant\0");
        hasher.update(variant.as_bytes());
        hasher.update(b"\0");
    }

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

async fn probe_pikafish_runtime_metadata(engine_path: &Path) -> (Option<String>, Option<String>) {
    if engine_family(engine_path) != EngineFamily::Pikafish {
        return (None, None);
    }
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

fn parse_pikafish_version_line(line: &str) -> Option<String> {
    line.trim().strip_prefix("Pikafish ").map(|_| {
        line.trim()
            .split(" by ")
            .next()
            .unwrap_or(line.trim())
            .to_owned()
    })
}

fn parse_pikafish_nnue_metadata_line(line: &str) -> Option<String> {
    let metadata = line
        .trim()
        .strip_prefix("info string NNUE evaluation using ")?;
    metadata
        .split_once(' ')
        .map(|(_, version)| version.trim().to_owned())
}

fn decorate_known_pikafish_nnue_version(
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

fn report_side(board: &Board) -> String {
    if board.side_to_move() == Color::Red {
        "红方"
    } else {
        "黑方"
    }
    .into()
}

fn report_positions(model: &AppModel) -> Result<(String, Vec<GameReportPositionDto>), String> {
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

fn emit_report_progress(app: &tauri::AppHandle, progress: GameReportProgressDto) {
    let _ = app.emit("game-report-progress", progress);
}

fn apply_report_line_to_position(
    position: &mut GameReportPositionDto,
    line: &AnalysisLine,
    cached: bool,
) -> Result<(), String> {
    let position_board = Board::from_fen(&position.fen).map_err(|error| error.to_string())?;
    let (pv, notation) = if line.pv.is_empty() {
        (Vec::new(), Vec::new())
    } else if line.notation.is_empty() {
        normalize_pv_and_notation_with_fairy_fallback(&position_board, &line.pv)
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

fn report_estimated_remaining_ms(
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

async fn wait_for_engine_idle(state: &DesktopState, duration: Duration) -> bool {
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
async fn stop_analysis(
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
            let (pv, notation) =
                normalize_pv_and_notation_with_fairy_fallback(&model.board, &line.pv);
            line.pv = pv;
            line.notation = notation;
        }
    }
    Ok(lines)
}

async fn generate_game_report_inner(
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
    let resolved_engine_family = engine_family(&resolved_engine_path);
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
                            primary = Some(analysis_line_from_engine_info(
                                &position_board,
                                info,
                                resolved_engine_family,
                            ));
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
async fn generate_game_report(
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
async fn cancel_game_report(state: State<'_, DesktopState>) -> Result<bool, String> {
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
fn get_game_report(state: State<'_, DesktopState>) -> Result<Option<GameReportDatasetDto>, String> {
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
    Ok(Some(dataset))
}

#[tauri::command]
fn export_game_report_pdf(
    path: String,
    report: pdf_report::GameReportPresentationDto,
) -> Result<String, String> {
    let saved = pdf_report::write_report_pdf(Path::new(&path), &report)?;
    Ok(saved.to_string_lossy().into_owned())
}

fn protocol_name(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Uci => "uci",
        Protocol::Ucci => "ucci",
    }
}

fn rule_mode_from_code(value: &str) -> RuleMode {
    match value {
        "asianAxf" => RuleMode::AsianAxf,
        _ => RuleMode::Domestic2020,
    }
}

fn normalize_rule_mode(value: &str) -> String {
    rule_mode_from_code(value).code().into()
}

fn validate_server_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value.trim()).map_err(|_| "同步服务地址格式不正确")?;
    let host = url.host_str().ok_or("同步服务地址缺少主机名")?;
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("非本机同步服务必须使用 HTTPS".into());
    }
    Ok(())
}

fn normalize_desktop_preferences(preferences: &mut DesktopPreferences) {
    if matches!(preferences.search_mode.as_str(), "time" | "infinite")
        && preferences.search_value == 1500
    {
        preferences.search_mode = "depth".into();
        preferences.search_value = 30;
    }
    if preferences.candidate_line_moves == 6 {
        preferences.candidate_line_moves = 20;
    }
    if preferences.report_depth == 26 {
        preferences.report_depth = 30;
    }
    preferences.board_skin = normalize_skin_id(&preferences.board_skin);
    preferences.piece_skin = normalize_skin_id(&preferences.piece_skin);
    preferences.parallel_engine_paths.retain(|path| {
        matches!(
            path.as_str(),
            BUILTIN_ENGINE_PATH | BUILTIN_FAIRY_ENGINE_PATH
        )
    });
    preferences.parallel_engine_paths.sort();
    preferences.parallel_engine_paths.dedup();
    preferences.rule_mode = normalize_rule_mode(&preferences.rule_mode);
}

fn normalize_skin_id(value: &str) -> String {
    match value {
        "default" | "hongmu" | "jingdian" | "xinghe" => value.to_owned(),
        _ => "default".into(),
    }
}

fn validate_preferences(preferences: &DesktopPreferences) -> Result<(), String> {
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
        "default" | "hongmu" | "jingdian" | "xinghe"
    ) {
        return Err("不支持的棋盘皮肤".into());
    }
    if !matches!(
        preferences.piece_skin.as_str(),
        "default" | "hongmu" | "jingdian" | "xinghe"
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
    if !(1..=10).contains(&preferences.multipv) {
        return Err("MultiPV 必须在 1 到 10 之间".into());
    }
    if !(2..=20).contains(&preferences.candidate_line_moves) {
        return Err("后续走法必须在 2 到 20 个半回合之间".into());
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

fn is_account_skin(value: &str) -> bool {
    matches!(value, "jingdian" | "xinghe")
}

fn validate_skin_access(
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
fn get_desktop_preferences(state: State<'_, DesktopState>) -> Result<DesktopPreferences, String> {
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
    // Preserve older installations that only stored enginePath before profiles existed.
    if preferences.active_engine_id.is_none()
        && !preferences.engine_path.trim().is_empty()
        && !matches!(
            preferences.engine_path.as_str(),
            BUILTIN_ENGINE_PATH | BUILTIN_FAIRY_ENGINE_PATH
        )
    {
        let name = preferences
            .engine_path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("本地引擎");
        let id = model
            .store
            .save_engine_profile(name, &preferences.engine_path, "uci")
            .map_err(|error| error.to_string())?;
        preferences.active_engine_id = Some(id);
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    Ok(preferences)
}

#[tauri::command]
fn save_desktop_preferences(
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
async fn probe_engine(path: String, app: tauri::AppHandle) -> Result<EngineProbeDto, String> {
    let resolved_path = resolve_engine_path(&app, &path)?;
    let session = EngineSession::launch(&resolved_path, Duration::from_secs(5))
        .await
        .map_err(|error| format!("引擎握手失败：{error}"))?;
    let protocol = protocol_name(session.protocol());
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
            BUILTIN_FAIRY_ENGINE_PATH => BUILTIN_FAIRY_ENGINE_PATH.into(),
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

fn engine_profile_dto(profile: EngineProfile, active_engine_id: Option<Uuid>) -> EngineProfileDto {
    EngineProfileDto {
        id: profile.id,
        name: profile.name,
        executable_path: profile.executable_path,
        protocol: profile.protocol,
        active: active_engine_id == Some(profile.id),
    }
}

#[tauri::command]
fn list_engine_profiles(state: State<'_, DesktopState>) -> Result<Vec<EngineProfileDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    model
        .store
        .list_engine_profiles()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|profile| Ok(engine_profile_dto(profile, preferences.active_engine_id)))
        .collect()
}

#[tauri::command]
async fn register_engine_profile(
    name: String,
    path: String,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<EngineProfileDto, String> {
    let probe = probe_engine(path, app).await?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let display_name = if name.trim().is_empty() {
        probe
            .path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("本地引擎")
            .to_owned()
    } else {
        name.trim().to_owned()
    };
    let id = model
        .store
        .save_engine_profile(&display_name, &probe.path, probe.protocol)
        .map_err(|error| error.to_string())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    preferences.active_engine_id = Some(id);
    preferences.engine_path = probe.path.clone();
    model
        .store
        .save_desktop_preferences(&preferences)
        .map_err(|error| error.to_string())?;
    Ok(EngineProfileDto {
        id,
        name: display_name,
        executable_path: probe.path,
        protocol: probe.protocol.into(),
        active: true,
    })
}

#[tauri::command]
fn set_active_engine_profile(
    id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model
        .store
        .list_engine_profiles()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or("引擎档案不存在")?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    preferences.active_engine_id = Some(id);
    preferences.engine_path = profile.executable_path;
    model
        .store
        .save_desktop_preferences(&preferences)
        .map_err(|error| error.to_string())?;
    Ok(preferences)
}

#[tauri::command]
fn delete_engine_profile(
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
async fn query_cloud_opening_book(
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

#[tauri::command]
fn list_coach_reports(state: State<'_, DesktopState>) -> Result<Vec<GameReportDatasetDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(model
        .store
        .load_latest_game_reports()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|stored| {
            serde_json::from_str::<GameReportDatasetDto>(&stored.dataset_json).ok()
        })
        .filter(|report| !report.stale)
        .collect())
}

#[tauri::command]
fn list_training_tasks(state: State<'_, DesktopState>) -> Result<Vec<TrainingTaskDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())
        .map(|tasks| tasks.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn generate_training_tasks(state: State<'_, DesktopState>) -> Result<Vec<TrainingTaskDto>, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let Some(stored) = model
        .store
        .load_latest_game_report(model.game_id)
        .map_err(|error| error.to_string())?
    else {
        return Err("请先生成一份整局复盘报告".into());
    };
    let report: GameReportDatasetDto =
        serde_json::from_str(&stored.dataset_json).map_err(|_| "本地复盘报告无效".to_owned())?;
    for (index, position) in report.positions.iter().enumerate().skip(1) {
        let Some(moved) = position.move_.as_ref() else {
            continue;
        };
        let (Some(before), Some(after)) = (report.positions[index - 1].score_cp, position.score_cp)
        else {
            continue;
        };
        let loss = if moved.moved_by == "红方" {
            before - after
        } else {
            after - before
        };
        if loss < 150 {
            continue;
        }
        let move_number = (position.ply + 1) / 2;
        let best = position
            .best_notation
            .as_deref()
            .unwrap_or("重新寻找更稳健的着法");
        model
            .store
            .upsert_training_task(
                report.game_id,
                &report.line_signature,
                moved.node_id,
                &format!("复盘第 {move_number} 手：{}", moved.notation),
                &format!("本着评价变化约 {loss} 分。先自行计算，再比较推荐着法：{best}"),
            )
            .map_err(|error| error.to_string())?;
    }
    model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())
        .map(|tasks| tasks.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn complete_training_task(
    task_id: Uuid,
    completed: bool,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .complete_training_task(task_id, completed)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_study_sessions(state: State<'_, DesktopState>) -> Result<Vec<StudySession>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .study_sessions(model.game_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_study_session(
    reflection: String,
    tags: Vec<String>,
    state: State<'_, DesktopState>,
) -> Result<StudySession, String> {
    let reflection = reflection.trim();
    if reflection.is_empty() {
        return Err("请先写下本局要核验的问题或复盘结论".into());
    }
    if reflection.chars().count() > 2_000 {
        return Err("训练总结最多 2000 字".into());
    }
    let tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .take(8)
        .collect::<Vec<_>>();
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game_id = model.game_id;
    let node_id = model.current_node;
    model
        .store
        .save_study_session(game_id, node_id, reflection, &tags)
        .map_err(|error| error.to_string())
}

fn sync_account_dto(state: &DesktopState) -> Result<SyncAccountDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let binding = model
        .store
        .sync_account_binding()
        .map_err(|error| error.to_string())?;
    let expired = model
        .store
        .sync_token_expired()
        .map_err(|error| error.to_string())?;
    let last_sync_result = model
        .store
        .last_sync_result()
        .map_err(|error| error.to_string())?;
    drop(model);
    let has_token = active_sync_token(state)?.is_some();
    let status = match (&binding, expired, has_token) {
        (None, _, _) => "unbound",
        (Some(_), true, _) => "expired",
        (Some(_), false, true) => "signedIn",
        (Some(_), false, false) => "signedOut",
    };
    Ok(SyncAccountDto {
        server_url: preferences.server_url,
        user_id: binding.as_ref().map(|account| account.user_id),
        email: binding.map(|account| account.email),
        status,
        last_sync_result,
    })
}

fn active_sync_token(state: &DesktopState) -> Result<Option<String>, String> {
    if let Some(token) = state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())?
        .clone()
    {
        return Ok(Some(token));
    }
    let token = state.credentials.get(TOKEN_KEY)?;
    if let Some(token) = &token {
        *state
            .session_token
            .lock()
            .map_err(|_| "session token lock poisoned".to_owned())? = Some(token.clone());
    }
    Ok(token)
}

fn clear_sync_token(state: &DesktopState) -> Result<(), String> {
    state.credentials.delete(TOKEN_KEY)?;
    *state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())? = None;
    Ok(())
}

#[tauri::command]
fn get_sync_account(state: State<'_, DesktopState>) -> Result<SyncAccountDto, String> {
    sync_account_dto(&state)
}

async fn subscription_request(
    state: &DesktopState,
    endpoint: &str,
    code: Option<&str>,
) -> Result<SubscriptionDto, String> {
    let server_url = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?
        .server_url;
    validate_server_url(&server_url)?;
    let token = active_sync_token(state)?.ok_or("请先登录同步账号")?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/subscription{endpoint}",
        server_url.trim_end_matches('/')
    );
    let request = if let Some(code) = code {
        client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "code": code }))
    } else {
        client.get(url).bearer_auth(token)
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("订阅服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| format!("订阅服务返回错误 {status}"));
        return Err(message);
    }
    response
        .json()
        .await
        .map_err(|_| "订阅服务返回了无效数据".into())
}

#[tauri::command]
async fn get_subscription(state: State<'_, DesktopState>) -> Result<SubscriptionDto, String> {
    subscription_request(&state, "", None).await
}

#[tauri::command]
async fn redeem_subscription_code(
    code: String,
    state: State<'_, DesktopState>,
) -> Result<SubscriptionDto, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("请输入兑换码".into());
    }
    subscription_request(&state, "/redeem", Some(code)).await
}

async fn authenticate_sync_account(
    endpoint: &str,
    email: String,
    password: String,
    require_unbound: bool,
    state: &DesktopState,
) -> Result<SyncAccountDto, String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return Err("请输入有效邮箱".into());
    }
    if password.len() < 8 {
        return Err("密码至少需要 8 个字符".into());
    }
    let (server_url, binding) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        let binding = model
            .store
            .sync_account_binding()
            .map_err(|error| error.to_string())?;
        (preferences.server_url, binding)
    };
    validate_server_url(&server_url)?;
    if require_unbound && binding.is_some() {
        return Err("本地棋谱库已经绑定账号，请直接登录".into());
    }
    if let Some(existing) = &binding {
        if existing.email != email {
            return Err(format!(
                "本地棋谱库已绑定账号 {}，不能切换账号",
                existing.email
            ));
        }
    }
    let auth = request_auth(&server_url, endpoint, &email, &password).await?;
    let account = SyncAccountBinding {
        user_id: auth.user_id,
        email,
    };
    // Avoid persisting an account binding that cannot be logged into locally.
    state.credentials.set(TOKEN_KEY, &auth.token)?;
    *state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())? = Some(auth.token.clone());
    let binding_result = (|| -> Result<(), String> {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .bind_sync_account(&account)
            .map_err(|error| error.to_string())?;
        model
            .store
            .set_sync_token_expired(false)
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = binding_result {
        let _ = clear_sync_token(state);
        return Err(error);
    }
    sync_account_dto(state)
}

async fn request_auth(
    server_url: &str,
    endpoint: &str,
    email: &str,
    password: &str,
) -> Result<AuthResponse, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/v1/auth/{endpoint}",
            server_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let error_message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            });
        let duplicate_email = status.as_u16() == 409
            || error_message.as_deref().is_some_and(|message| {
                message.contains("email already registered")
                    || message.contains("duplicate")
                    || message.contains("Duplicate entry")
            });
        return Err(match status.as_u16() {
            401 => "邮箱或密码不正确".into(),
            _ if duplicate_email => "该邮箱已经注册，请直接登录".into(),
            _ => format!("账号服务返回错误 {status}"),
        });
    }
    response
        .json()
        .await
        .map_err(|_| "账号服务返回了无效数据".into())
}

#[tauri::command]
async fn register_sync_account(
    email: String,
    password: String,
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    authenticate_sync_account("register", email, password, true, &state).await
}

#[tauri::command]
async fn login_sync_account(
    email: String,
    password: String,
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    authenticate_sync_account("login", email, password, false, &state).await
}

#[tauri::command]
fn logout_sync_account(state: State<'_, DesktopState>) -> Result<SyncAccountDto, String> {
    clear_sync_token(&state)?;
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .set_sync_token_expired(false)
        .map_err(|error| error.to_string())?;
    sync_account_dto(&state)
}

#[tauri::command]
fn unbind_sync_account(state: State<'_, DesktopState>) -> Result<SyncAccountDto, String> {
    clear_sync_token(&state)?;
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .reset_sync_library()
            .map_err(|error| error.to_string())?;
        model.lamport = 0;
        let document = ManualDocument::new(STARTING_FEN).map_err(|error| error.to_string())?;
        install_document(&mut model, document, None, None)?;
    }
    sync_account_dto(&state)
}

#[tauri::command]
async fn sync_now(state: State<'_, DesktopState>) -> Result<SyncResult, String> {
    let (pending, server_url) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let pending = model
            .store
            .pending_operations(500)
            .map_err(|error| error.to_string())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        if model
            .store
            .sync_account_binding()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err("请先注册或登录同步账号".into());
        }
        (pending, preferences.server_url)
    };
    let token = active_sync_token(&state)?.ok_or("登录已退出，请重新登录")?;
    let client = reqwest::Client::new();
    let base = server_url.trim_end_matches('/');
    let push_response = client
        .post(format!("{base}/api/v1/sync/push"))
        .bearer_auth(&token)
        .json(&sync_protocol::PushRequest {
            operations: pending.clone(),
        })
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    if push_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_sync_token(&state)?;
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .set_sync_token_expired(true)
            .map_err(|error| error.to_string())?;
        return Err("登录已过期，请重新登录".into());
    }
    let push: sync_protocol::PushResponse = push_response
        .error_for_status()
        .map_err(|error| format!("同步上传失败：{error}"))?
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
    let pull_response = client
        .get(format!("{base}/api/v1/sync/pull?cursor={cursor}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    if pull_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_sync_token(&state)?;
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .set_sync_token_expired(true)
            .map_err(|error| error.to_string())?;
        return Err("登录已过期，请重新登录".into());
    }
    let pull: sync_protocol::PullResponse = pull_response
        .error_for_status()
        .map_err(|error| format!("同步下载失败：{error}"))?
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
            load_game_into_model(&mut model, game)?;
        }
    }
    let result = SyncResult {
        uploaded: pending.len(),
        downloaded: pull.operations.len(),
        cursor: pull.cursor,
    };
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .set_last_sync_result(&format!(
            "上传 {}，下载 {}",
            result.uploaded, result.downloaded
        ))
        .map_err(|error| error.to_string())?;
    Ok(result)
}

fn side_label(color: Color) -> &'static str {
    if color == Color::Red {
        "红方"
    } else {
        "黑方"
    }
}

fn game_status_label(status: GameStatus) -> &'static str {
    match status {
        GameStatus::Ongoing => "进行中",
        GameStatus::Check => "将军",
        GameStatus::Checkmate => "将死",
        GameStatus::Stalemate => "困毙",
    }
}

fn rule_verdict_code(verdict: RuleVerdict) -> &'static str {
    match verdict {
        RuleVerdict::Ongoing => "ongoing",
        RuleVerdict::Check => "check",
        RuleVerdict::Checkmate { .. } => "checkmate",
        RuleVerdict::Stalemate { .. } => "stalemate",
        RuleVerdict::DrawByNaturalLimit => "drawByNaturalLimit",
        RuleVerdict::PendingRepetition => "pendingRepetition",
        RuleVerdict::PendingAsianRepetition => "pendingAsianRepetition",
        RuleVerdict::LossByPerpetualCheck { .. } => "lossByPerpetualCheck",
        RuleVerdict::LossByPerpetualChase { .. } => "lossByPerpetualChase",
        RuleVerdict::DrawByRepetitionMvp => "drawByRepetitionMvp",
    }
}

fn rule_status_label(verdict: RuleVerdict) -> String {
    match verdict {
        RuleVerdict::Ongoing => "进行中".into(),
        RuleVerdict::Check => "将军".into(),
        RuleVerdict::Checkmate { .. } => "将死".into(),
        RuleVerdict::Stalemate { .. } => "困毙".into(),
        RuleVerdict::DrawByNaturalLimit => "自然限着和棋".into(),
        RuleVerdict::PendingRepetition => "待判局面：建议变着".into(),
        RuleVerdict::PendingAsianRepetition => "亚洲规则复杂待判".into(),
        RuleVerdict::LossByPerpetualCheck { loser } => {
            format!("{}长将判负", side_label(loser))
        }
        RuleVerdict::LossByPerpetualChase { loser } => {
            format!("{}长捉判负", side_label(loser))
        }
        RuleVerdict::DrawByRepetitionMvp => "重复待判和棋".into(),
    }
}

fn rule_reason(verdict: RuleVerdict, mode: RuleMode) -> String {
    match verdict {
        RuleVerdict::Ongoing => format!("{}：对局进行中", mode.name()),
        RuleVerdict::Check => format!("{}：当前为将军局面", mode.name()),
        RuleVerdict::Checkmate { loser } => {
            format!("{}被将死，按{}判负", side_label(loser), mode.name())
        }
        RuleVerdict::Stalemate { loser } => {
            format!("{}无合法着法，被困毙判负", side_label(loser))
        }
        RuleVerdict::DrawByNaturalLimit => "连续60回合未吃子，按自然限着判和".into(),
        RuleVerdict::PendingRepetition => {
            "重复局面达到三次，进入待判局面；MVP 暂不细分长杀/长捉，建议变着".into()
        }
        RuleVerdict::PendingAsianRepetition => {
            "亚洲规则复杂重复待判；MVP 暂不细分有根/假根/联合捉子".into()
        }
        RuleVerdict::LossByPerpetualCheck { loser } => {
            format!("{}单方长将，按{}判负", side_label(loser), mode.name())
        }
        RuleVerdict::LossByPerpetualChase { loser } => {
            format!(
                "{}稳定长捉同一无保护子，按{}判负",
                side_label(loser),
                mode.name()
            )
        }
        RuleVerdict::DrawByRepetitionMvp => match mode {
            RuleMode::Domestic2020 => "重复待判局面；擂台 MVP 未细分长杀/长捉，按和棋计".into(),
            RuleMode::AsianAxf => "重复局面双方不变，按亚洲规则 MVP 判和".into(),
        },
    }
}

fn board_pieces(board: &Board) -> Vec<PieceDto> {
    let mut pieces = Vec::new();
    for row in 0..10 {
        for col in 0..9 {
            if let Some(piece) = board.piece_at(Square { row, col }) {
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
    pieces
}

fn manual_tree_dto(
    tree: &ManualTree,
    parent_id: Uuid,
    board: &Board,
    analysis: &HashMap<Uuid, AnalysisSummary>,
) -> Result<Vec<ManualTreeNodeDto>, String> {
    tree.branches(parent_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|node| {
            let move_ = move_dto(node, board, analysis.get(&node.id))?;
            let next_board = board
                .apply_move(node.mv)
                .map_err(|error| error.to_string())?;
            Ok(ManualTreeNodeDto {
                move_,
                children: manual_tree_dto(tree, node.id, &next_board, analysis)?,
            })
        })
        .collect()
}

fn board_dto(model: &AppModel) -> Result<BoardDto, String> {
    let analysis = model
        .store
        .load_latest_analysis_summaries(model.game_id)
        .map_err(|error| error.to_string())?;
    let root_analysis = model
        .store
        .load_latest_analysis_summary(model.game_id, None)
        .map_err(|error| error.to_string())?;
    let root_board = Board::from_fen(&model.starting_fen).map_err(|error| error.to_string())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let rule_mode = rule_mode_from_code(&preferences.rule_mode);
    let manual_tree = manual_tree_dto(&model.tree, model.tree.root_id(), &root_board, &analysis)?;
    let pieces = board_pieces(&model.board);
    let mut history = Vec::new();
    let mut rule_state = DomesticRuleState::new(&root_board);
    if let Some(node) = model.current_node {
        let mut board = Board::from_fen(&model.starting_fen).map_err(|error| error.to_string())?;
        for node in model
            .tree
            .active_line(node)
            .map_err(|error| error.to_string())?
        {
            history.push(move_dto(node, &board, analysis.get(&node.id))?);
            let next = board
                .apply_move(node.mv)
                .map_err(|error| error.to_string())?;
            rule_state
                .record_applied_move(&board, node.mv, &next)
                .map_err(|error| error.to_string())?;
            board = next;
        }
    }
    let rule_verdict = if model.playable {
        rule_state.evaluate_with_mode(&model.board, rule_mode)
    } else {
        RuleVerdict::Ongoing
    };
    let branch_parent = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let mut continuation = Vec::new();
    let mut continuation_parent = branch_parent;
    let mut continuation_board = model.board.clone();
    loop {
        let next = model
            .tree
            .branches(continuation_parent)
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|node| node.is_mainline);
        let Some(node) = next else {
            break;
        };
        continuation.push(move_dto(node, &continuation_board, analysis.get(&node.id))?);
        continuation_board = continuation_board
            .apply_move(node.mv)
            .map_err(|error| error.to_string())?;
        continuation_parent = node.id;
    }
    let branches = model
        .tree
        .branches(branch_parent)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|node| move_dto(node, &model.board, analysis.get(&node.id)))
        .collect::<Result<Vec<_>, _>>()?;
    let sibling_branches = if let Some(current_node) = model.current_node {
        let parent_id = model
            .tree
            .node(current_node)
            .map_err(|error| error.to_string())?
            .parent_id;
        let parent_board = board_at(
            &model.starting_fen,
            &model.tree,
            (parent_id != model.tree.root_id()).then_some(parent_id),
        )?;
        model
            .tree
            .branches(parent_id)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|node| move_dto(node, &parent_board, analysis.get(&node.id)))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };
    let mut xqb_candidates = Vec::new();
    for path in preferences.xqb_book_paths {
        if preferences
            .disabled_xqb_book_paths
            .iter()
            .any(|disabled| disabled == &path)
        {
            continue;
        }
        match xqb_opening_book::query(Path::new(&path), &model.board) {
            Ok(mut candidates) => xqb_candidates.append(&mut candidates),
            Err(error) => eprintln!("忽略不可用的 XQB 开局库 {path}: {error}"),
        }
    }
    Ok(BoardDto {
        fen: model.board.to_fen(),
        root_side_to_move: side_label(root_board.side_to_move()),
        root_score_cp: root_analysis.as_ref().and_then(|summary| summary.score_cp),
        root_mate: root_analysis.as_ref().and_then(|summary| summary.mate),
        side_to_move: side_label(model.board.side_to_move()),
        status: if model.playable {
            rule_status_label(rule_verdict)
        } else {
            "不可对弈".into()
        },
        rule_name: rule_mode.name(),
        rule_verdict: rule_verdict_code(rule_verdict),
        rule_reason: rule_reason(rule_verdict, rule_mode),
        pieces,
        history,
        continuation,
        branches,
        sibling_branches,
        manual_tree,
        current_node: model.current_node,
        title: model.metadata.title.clone(),
        note: model.note.clone(),
        source_path: model.source_path.clone(),
        source_format: model.source_format.clone(),
        playable: model.playable,
        xqb_candidates,
    })
}

fn metadata_payload(metadata: &ManualMetadata, note: &str) -> UpdateGameMetadataPayload {
    UpdateGameMetadataPayload {
        title: metadata.title.clone(),
        note: note.to_owned(),
        event: Some(metadata.event.clone()),
        site: Some(metadata.site.clone()),
        date: Some(metadata.date.clone()),
        red: Some(metadata.red.clone()),
        black: Some(metadata.black.clone()),
        result: Some(metadata.result.clone()),
    }
}

fn install_document(
    model: &mut AppModel,
    document: ManualDocument,
    source_path: Option<String>,
    source_format: Option<String>,
) -> Result<(), String> {
    let board = Board::from_fen(&document.starting_fen).map_err(|error| error.to_string())?;
    let playable = position_is_playable(&board);
    let game_id = Uuid::new_v4();
    let root_id = document.tree.root_id();
    let nodes = collect_nodes(&document.tree)?;
    let mut operations = Vec::with_capacity(nodes.len() + 2);
    model.lamport += 1;
    operations.push(Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
        kind: OperationKind::CreateGame,
        payload: serde_json::to_value(CreateGamePayload {
            title: document.metadata.title.clone(),
            fen: document.starting_fen.clone(),
            root_id,
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: Utc::now(),
    });
    model.lamport += 1;
    operations.push(Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
        kind: OperationKind::UpdateGameMetadata,
        payload: serde_json::to_value(metadata_payload(&document.metadata, &document.note))
            .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: Utc::now(),
    });
    for node in &nodes {
        model.lamport += 1;
        operations.push(Operation {
            op_id: Uuid::new_v4(),
            device_id: model.device_id,
            entity_id: node.id,
            game_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id: node.id,
                parent_id: node.parent_id,
                move_iccs: node.mv.to_iccs(),
                order_key: node.order_key,
                is_mainline: node.is_mainline,
            })
            .map_err(|error| error.to_string())?,
            lamport: model.lamport,
            created_at: Utc::now(),
        });
        if !node.comment.is_empty() {
            model.lamport += 1;
            operations.push(Operation {
                op_id: Uuid::new_v4(),
                device_id: model.device_id,
                entity_id: node.id,
                game_id,
                kind: OperationKind::UpdateComment,
                payload: serde_json::to_value(UpdateCommentPayload {
                    node_id: node.id,
                    comment: node.comment.clone(),
                })
                .map_err(|error| error.to_string())?,
                lamport: model.lamport,
                created_at: Utc::now(),
            });
        }
    }
    let metadata_json =
        serde_json::to_string(&document.metadata).map_err(|error| error.to_string())?;
    model
        .store
        .import_game_with_operations(
            ImportedGame {
                id: game_id,
                title: &document.metadata.title,
                starting_fen: &document.starting_fen,
                root_id,
                current_node_id: None,
                note: &document.note,
                source_path: source_path.as_deref(),
                source_format: source_format.as_deref(),
                playable,
                metadata_json: &metadata_json,
            },
            &nodes,
            &operations,
        )
        .map_err(|error| error.to_string())?;
    model.board = board;
    model.starting_fen = document.starting_fen;
    model.tree = document.tree;
    model.current_node = None;
    model.game_id = game_id;
    model.metadata = document.metadata;
    model.note = document.note;
    model.source_path = source_path;
    model.source_format = source_format;
    model.playable = playable;
    Ok(())
}

fn collect_nodes(tree: &ManualTree) -> Result<Vec<xiangqi_manual::MoveNode>, String> {
    fn visit(
        tree: &ManualTree,
        parent_id: Uuid,
        nodes: &mut Vec<xiangqi_manual::MoveNode>,
    ) -> Result<(), String> {
        for node in tree
            .branches(parent_id)
            .map_err(|error| error.to_string())?
        {
            nodes.push(node.clone());
            visit(tree, node.id, nodes)?;
        }
        Ok(())
    }
    let mut nodes = Vec::new();
    visit(tree, tree.root_id(), &mut nodes)?;
    nodes.sort_by_key(|node| node.order_key);
    Ok(nodes)
}

fn document_from_model(model: &AppModel) -> ManualDocument {
    ManualDocument {
        metadata: model.metadata.clone(),
        starting_fen: model.starting_fen.clone(),
        note: model.note.clone(),
        tree: model.tree.clone(),
        warnings: Vec::new(),
    }
}

fn position_is_playable(board: &Board) -> bool {
    let mut red_king = None;
    let mut black_king = None;
    for row in 0..10 {
        for col in 0..9 {
            if let Some(piece) = board.piece_at(Square { row, col }) {
                if piece.kind == PieceKind::King {
                    match piece.color {
                        Color::Red if red_king.is_none() => red_king = Some(Square { row, col }),
                        Color::Black if black_king.is_none() => {
                            black_king = Some(Square { row, col })
                        }
                        _ => return false,
                    }
                }
            }
        }
    }
    let (Some(red_king), Some(black_king)) = (red_king, black_king) else {
        return false;
    };
    let red_in_palace = (7..=9).contains(&red_king.row) && (3..=5).contains(&red_king.col);
    let black_in_palace = black_king.row <= 2 && (3..=5).contains(&black_king.col);
    red_in_palace
        && black_in_palace
        && !(board.is_in_check(Color::Red) && board.is_in_check(Color::Black))
}

fn format_hint_from_path(path: &str) -> Option<ManualFormat> {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("pgn") => Some(ManualFormat::Pgn),
        Some("xqf") => Some(ManualFormat::Xqf),
        Some("cbr") => Some(ManualFormat::Cbr),
        _ => None,
    }
}

fn format_name(format: ManualFormat) -> &'static str {
    match format {
        ManualFormat::Pgn => "pgn",
        ManualFormat::Xqf => "xqf",
        ManualFormat::Cbr => "cbr",
    }
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
    tree.restore_nodes(
        store
            .load_move_nodes(game.id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let board = board_at(&game.starting_fen, &tree, game.current_node_id)?;
    Ok((board, tree))
}

fn load_game_into_model(model: &mut AppModel, game: LocalGame) -> Result<(), String> {
    let (board, tree) = restore_game(&model.store, &game)?;
    let metadata =
        serde_json::from_str::<ManualMetadata>(&game.metadata_json).unwrap_or_else(|_| {
            ManualMetadata {
                title: game.title.clone(),
                result: "*".into(),
                ..ManualMetadata::default()
            }
        });
    model
        .store
        .set_active_game_id(game.id)
        .map_err(|error| error.to_string())?;
    model.board = board;
    model.starting_fen = game.starting_fen;
    model.tree = tree;
    model.current_node = game.current_node_id;
    model.game_id = game.id;
    model.metadata = metadata;
    model.note = game.note;
    model.source_path = game.source_path;
    model.source_format = game.source_format;
    model.playable = game.playable;
    Ok(())
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

fn collect_theory_videos(
    directory: &Path,
    files: &mut Vec<PathBuf>,
    downloading: &mut usize,
) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("读取课程目录失败：{error}")),
    };
    for entry in entries {
        let path = entry
            .map_err(|error| format!("读取课程文件失败：{error}"))?
            .path();
        if path.is_dir() {
            collect_theory_videos(&path, files, downloading)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("mp4") {
            files.push(path);
        } else if path.to_string_lossy().ends_with(".baiduyun.p.downloading") {
            *downloading += 1;
        }
    }
    Ok(())
}

fn theory_fingerprint(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取课程文件信息失败：{error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    Ok(format!("{}:{modified}", metadata.len()))
}

fn theory_library_dto(
    store: &LocalStore,
    downloading_files: usize,
) -> Result<TheoryLibraryDto, String> {
    Ok(TheoryLibraryDto {
        lessons: store.theory_lessons().map_err(|error| error.to_string())?,
        cards: store.theory_cards().map_err(|error| error.to_string())?,
        downloading_files,
    })
}

#[tauri::command]
fn scan_theory_library(state: State<'_, DesktopState>) -> Result<TheoryLibraryDto, String> {
    let mut discovered = Vec::new();
    let mut downloading_files = 0;
    for (phase, course_name, root) in THEORY_COURSE_ROOTS {
        let root_path = Path::new(root);
        let mut videos = Vec::new();
        collect_theory_videos(root_path, &mut videos, &mut downloading_files)?;
        for path in videos {
            let title = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("未命名课程")
                .to_owned();
            discovered.push((phase, course_name, path, title));
        }
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    for (phase, course_name, path, title) in discovered {
        let source_path = path.to_string_lossy().into_owned();
        let fingerprint = theory_fingerprint(&path)?;
        model
            .store
            .upsert_theory_lesson(phase, course_name, &title, &source_path, &fingerprint)
            .map_err(|error| error.to_string())?;
    }
    theory_library_dto(&model.store, downloading_files)
}

#[tauri::command]
fn get_theory_library(state: State<'_, DesktopState>) -> Result<TheoryLibraryDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    theory_library_dto(&model.store, 0)
}

#[tauri::command]
fn review_theory_card(
    card: TheoryCard,
    state: State<'_, DesktopState>,
) -> Result<TheoryCard, String> {
    if !matches!(
        card.review_status.as_str(),
        "pending" | "approved" | "rejected"
    ) {
        return Err("无效的原则卡审核状态".into());
    }
    if card.title.trim().is_empty()
        || card.summary.trim().is_empty()
        || card.applies_when.trim().is_empty()
        || card.risk.trim().is_empty()
    {
        return Err("原则卡需要标题、短摘要、适用条件和风险说明".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .review_theory_card(&card)
        .map_err(|error| error.to_string())?;
    Ok(card)
}

#[tauri::command]
fn create_theory_card(
    lesson_id: i64,
    title: String,
    summary: String,
    applies_when: String,
    risk: String,
    timecode: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<TheoryCard, String> {
    if title.trim().is_empty()
        || summary.trim().is_empty()
        || applies_when.trim().is_empty()
        || risk.trim().is_empty()
    {
        return Err("原则卡需要标题、短摘要、适用条件和风险说明".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .create_theory_card(
            lesson_id,
            &title,
            &summary,
            &applies_when,
            &risk,
            timecode.as_deref(),
        )
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut store = LocalStore::open(data_dir.join("xiangqi.sqlite3"))?;
            let device_id = store.device_id()?;
            let mut lamport = store.max_lamport()?;
            let (
                board,
                starting_fen,
                tree,
                current_node,
                game_id,
                metadata,
                note,
                source_path,
                source_format,
                playable,
            ) = if let Some(game) = match store.active_game_id()? {
                Some(game_id) => store.load_game(game_id)?,
                None => None,
            }
            .or(store.load_latest_game()?)
            {
                let mut tree = ManualTree::with_root(game.root_id);
                tree.restore_nodes(store.load_move_nodes(game.id)?)?;
                let mut board = Board::from_fen(&game.starting_fen)?;
                if let Some(current) = game.current_node_id {
                    for mv in tree.line_to(current)? {
                        board = board.apply_move(mv)?;
                    }
                }
                let metadata =
                    serde_json::from_str(&game.metadata_json).unwrap_or_else(|_| ManualMetadata {
                        title: game.title.clone(),
                        result: "*".into(),
                        ..ManualMetadata::default()
                    });
                (
                    board,
                    game.starting_fen,
                    tree,
                    game.current_node_id,
                    game.id,
                    metadata,
                    game.note,
                    game.source_path,
                    game.source_format,
                    game.playable,
                )
            } else {
                let game_id = Uuid::new_v4();
                let tree = ManualTree::new();
                let metadata = ManualMetadata {
                    title: "新建棋谱".into(),
                    result: "*".into(),
                    ..ManualMetadata::default()
                };
                lamport += 1;
                let operation = Operation {
                    op_id: Uuid::new_v4(),
                    device_id,
                    entity_id: game_id,
                    game_id,
                    kind: OperationKind::CreateGame,
                    payload: serde_json::to_value(CreateGamePayload {
                        title: metadata.title.clone(),
                        fen: STARTING_FEN.into(),
                        root_id: tree.root_id(),
                    })?,
                    lamport,
                    created_at: Utc::now(),
                };
                store.save_game_with_operation(
                    game_id,
                    &metadata.title,
                    STARTING_FEN,
                    tree.root_id(),
                    &operation,
                )?;
                store.set_game_document_properties(
                    game_id,
                    &serde_json::to_string(&metadata)?,
                    true,
                )?;
                store.set_active_game_id(game_id)?;
                (
                    Board::from_fen(STARTING_FEN)?,
                    STARTING_FEN.into(),
                    tree,
                    None,
                    game_id,
                    metadata,
                    String::new(),
                    None,
                    None,
                    true,
                )
            };
            store.set_active_game_id(game_id)?;
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
                    metadata,
                    note,
                    source_path,
                    source_format,
                    playable,
                }),
                credentials: Arc::new(SystemCredentialStore),
                session_token: Mutex::new(None),
                engine: tokio::sync::Mutex::new(HashMap::new()),
                report_engine: tokio::sync::Mutex::new(None),
                report_commit: tokio::sync::Mutex::new(()),
                play_session: tokio::sync::Mutex::new(None),
                analysis_generation: AtomicU64::new(0),
                play_generation: AtomicU64::new(0),
                report_generation: AtomicU64::new(0),
                report_running: AtomicBool::new(false),
                cloud_book_cache: Mutex::new(BTreeMap::new()),
                link_session: Mutex::new(LinkSession::default()),
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            prepare_link_selection_window,
            start_link_session,
            stop_link_session,
            get_link_session_status,
            pause_link_session,
            recalibrate_link_session,
            get_link_capture_preview,
            submit_link_position,
            confirm_link_engine_move,
            import_recognized_position,
            list_games,
            open_game,
            play_move,
            preview_line,
            new_game,
            open_document,
            import_xqb_opening_book,
            import_text,
            export_text,
            export_document_text,
            export_document_file,
            export_replay_gif,
            export_mind_map_svg,
            export_text_file,
            export_manual_pdf,
            save_document,
            update_game_metadata,
            reorder_branches,
            navigate_to,
            update_comment,
            set_mainline,
            delete_node,
            detect_pikafish,
            open_compact_floating_panel,
            return_compact_floating_panel,
            analyze_position,
            run_engine_arena,
            engine_play_move,
            move_now,
            stop_engine_play,
            stop_analysis,
            get_saved_analysis,
            generate_game_report,
            cancel_game_report,
            get_game_report,
            export_game_report_pdf,
            get_desktop_preferences,
            save_desktop_preferences,
            probe_engine,
            list_engine_profiles,
            register_engine_profile,
            set_active_engine_profile,
            delete_engine_profile,
            query_cloud_opening_book,
            list_coach_reports,
            list_training_tasks,
            generate_training_tasks,
            complete_training_task,
            list_study_sessions,
            save_study_session,
            scan_theory_library,
            get_theory_library,
            review_theory_card,
            create_theory_card,
            get_sync_account,
            get_subscription,
            redeem_subscription_code,
            register_sync_account,
            login_sync_account,
            logout_sync_account,
            unbind_sync_account,
            sync_now
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Xiangqi Studio")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    let _ = main_window.show();
                    let _ = main_window.unminimize();
                    let _ = main_window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    async fn mock_auth_server(status: &str, body: String) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_owned();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let read = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("POST /api/v1/auth/login HTTP/1.1"));
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{address}")
    }

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
            metadata: ManualMetadata {
                title: "测试棋谱".into(),
                result: "*".into(),
                ..ManualMetadata::default()
            },
            note: "关键局面".into(),
            source_path: Some("/tmp/study.pgn".into()),
            source_format: Some("pgn".into()),
            playable: true,
        };

        let dto = board_dto(&model).unwrap();
        assert_eq!(dto.history[0].notation, "炮二平五");
        assert_eq!(dto.history[0].moved_by, "红方");
        assert_eq!(dto.history[0].score_cp, Some(42));
        assert_eq!(dto.history[1].notation, "马8进7");
        assert_eq!(dto.history[1].moved_by, "黑方");
        assert_eq!(dto.history[1].score_cp, None);
        assert_eq!(dto.title, "测试棋谱");
        assert_eq!(dto.note, "关键局面");
        assert_eq!(dto.source_path.as_deref(), Some("/tmp/study.pgn"));
        assert_eq!(dto.source_format.as_deref(), Some("pgn"));
        assert!(dto.playable);
        assert_eq!(dto.rule_name, xiangqi_core::DOMESTIC_RULE_NAME);
        assert_eq!(dto.rule_verdict, "ongoing");
        assert!(dto.rule_reason.contains("2020版导向"));
    }

    #[test]
    fn arena_rule_outcome_maps_domestic_rule_verdicts() {
        let red = EngineArenaPlayerDto {
            name: "红引擎".into(),
            engine_path: BUILTIN_ENGINE_PATH.into(),
        };
        let black = EngineArenaPlayerDto {
            name: "黑引擎".into(),
            engine_path: BUILTIN_FAIRY_ENGINE_PATH.into(),
        };

        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::LossByPerpetualCheck { loser: Color::Red },
                RuleMode::Domestic2020,
                &red,
                &black
            ),
            Some((
                "0-1".into(),
                Some("黑引擎".into()),
                "红方单方长将，按国内中国象棋规则（2020版导向）判负".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::PendingRepetition,
                RuleMode::Domestic2020,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "重复待判局面；擂台 MVP 未细分长杀/长捉，按和棋计".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::DrawByRepetitionMvp,
                RuleMode::AsianAxf,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "重复局面双方不变，按亚洲规则 MVP 判和".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::PendingAsianRepetition,
                RuleMode::AsianAxf,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "亚洲规则复杂待判，MVP 按和棋计".into()
            ))
        );
    }

    #[test]
    fn board_dto_keeps_mainline_continuation_after_navigating_to_an_old_node() {
        let mut tree = ManualTree::new();
        let first_move = xiangqi_core::Move::from_iccs("h2e2").unwrap();
        let first = tree.add_move(tree.root_id(), first_move, "").unwrap();
        let second_move = xiangqi_core::Move::from_iccs("h9g7").unwrap();
        let second = tree.add_move(first, second_move, "").unwrap();
        let third_move = xiangqi_core::Move::from_iccs("c3c4").unwrap();
        let third = tree.add_move(second, third_move, "").unwrap();
        let board = Board::from_fen(STARTING_FEN)
            .unwrap()
            .apply_move(first_move)
            .unwrap();
        let model = AppModel {
            board,
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(first),
            game_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            lamport: 0,
            store: LocalStore::open_in_memory().unwrap(),
            metadata: ManualMetadata::default(),
            note: String::new(),
            source_path: None,
            source_format: None,
            playable: true,
        };

        let dto = board_dto(&model).unwrap();

        assert_eq!(
            dto.history.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![first]
        );
        assert_eq!(
            dto.continuation
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![second, third]
        );
        assert_eq!(dto.continuation[0].notation, "马8进7");
        assert_eq!(dto.continuation[1].notation, "兵七进一");
    }

    #[test]
    fn preview_line_simulates_moves_without_model_state() {
        let steps =
            preview_line_steps(STARTING_FEN, &["h2e2".to_owned(), "h9g7".to_owned()]).unwrap();

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].notation, "炮二平五");
        assert_eq!(steps[0].moved_by, "红方");
        assert_eq!(steps[0].from.row, 7);
        assert_eq!(steps[0].to.col, 4);
        assert_eq!(steps[0].status, "进行中");
        assert_eq!(steps[1].notation, "马8进7");
        assert_eq!(steps[1].moved_by, "黑方");
        assert!(
            steps[1]
                .pieces
                .iter()
                .any(|piece| piece.row == 2 && piece.col == 6 && piece.label == "马")
        );
    }

    #[test]
    fn preview_line_rejects_illegal_candidate_move() {
        let error = preview_line_steps(STARTING_FEN, &["h2e2".to_owned(), "h2e2".to_owned()])
            .err()
            .unwrap();

        assert!(error.contains("第 2 步非法"));
    }

    #[test]
    fn only_legal_king_placements_are_playable() {
        assert!(position_is_playable(
            &Board::from_fen(STARTING_FEN).unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("9/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("9/9/9/4k4/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
    }

    #[test]
    fn report_line_uses_selected_path_then_mainline_continuation() {
        let mut tree = ManualTree::new();
        let first = tree
            .add_move(
                tree.root_id(),
                xiangqi_core::Move::from_iccs("h2e2").unwrap(),
                "",
            )
            .unwrap();
        let reply = tree
            .add_move(first, xiangqi_core::Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        let continuation = tree
            .add_move(reply, xiangqi_core::Move::from_iccs("h0g2").unwrap(), "")
            .unwrap();
        tree.add_move(first, xiangqi_core::Move::from_iccs("b9c7").unwrap(), "")
            .unwrap();

        let nodes = report_line_nodes(&tree, Some(first)).unwrap();
        assert_eq!(
            nodes.iter().map(|node| node.id).collect::<Vec<_>>(),
            vec![first, reply, continuation]
        );
        assert!(
            report_line_signature(&tree, Some(first))
                .unwrap()
                .starts_with(&tree.root_id().to_string())
        );
    }

    #[test]
    fn report_positions_include_root_chinese_moves_and_post_move_material() {
        let mut tree = ManualTree::new();
        let first = tree
            .add_move(
                tree.root_id(),
                xiangqi_core::Move::from_iccs("h2e2").unwrap(),
                "",
            )
            .unwrap();
        let second = tree
            .add_move(first, xiangqi_core::Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        let model = AppModel {
            board: Board::from_fen(STARTING_FEN).unwrap(),
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(second),
            game_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            lamport: 0,
            store: LocalStore::open_in_memory().unwrap(),
            metadata: ManualMetadata::default(),
            note: String::new(),
            source_path: None,
            source_format: None,
            playable: true,
        };

        let (_, positions) = report_positions(&model).unwrap();
        assert_eq!(positions.len(), 3);
        assert!(positions[0].move_.is_none());
        assert_eq!(positions[0].material, 5660);
        assert_eq!(positions[1].move_.as_ref().unwrap().notation, "炮二平五");
        assert_eq!(positions[2].move_.as_ref().unwrap().notation, "马8进7");
        assert_eq!(positions[2].side_to_move, "红方");
        assert_eq!(positions[2].phase, "opening");
    }

    #[test]
    fn report_phase_uses_the_starting_fen_move_number() {
        assert_eq!(fen_starting_ply(STARTING_FEN), 0);
        assert_eq!(fen_starting_ply("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 40"), 79);
        assert_eq!(report_phase(79, 5000), "middle");
        assert_eq!(report_phase(81, 5000), "endgame");
        assert_eq!(report_phase(0, 1000), "endgame");
    }

    #[test]
    fn terminal_report_positions_score_the_mated_side_as_losing() {
        let board = Board::from_fen("4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1").unwrap();
        assert_eq!(board.status(), GameStatus::Checkmate);
        assert_eq!(terminal_report_mate(&board), Some(-1));
    }

    #[test]
    fn report_engine_fingerprint_changes_with_engine_or_nnue_content() {
        let directory = tempfile::tempdir().unwrap();
        let engine = directory.path().join("pikafish");
        let nnue = directory.path().join("pikafish.nnue");
        std::fs::write(&engine, b"engine-one").unwrap();
        std::fs::write(&nnue, b"network-one").unwrap();
        let first = report_engine_fingerprint(&engine).unwrap();

        std::fs::write(&nnue, b"network-two").unwrap();
        let second = report_engine_fingerprint(&engine).unwrap();
        assert_ne!(first, second);

        std::fs::write(&engine, b"engine-two").unwrap();
        let third = report_engine_fingerprint(&engine).unwrap();
        assert_ne!(second, third);
    }

    #[test]
    fn pikafish_runtime_metadata_parses_version_and_nnue_lines() {
        assert_eq!(
            parse_pikafish_version_line(
                "Pikafish dev-20260726-b2180562 by the Pikafish developers (see AUTHORS file)"
            )
            .as_deref(),
            Some("Pikafish dev-20260726-b2180562")
        );
        assert_eq!(
            parse_pikafish_nnue_metadata_line(
                "info string NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))"
            )
            .as_deref(),
            Some("(64MiB, (62083, 1024, 32, 32, 1))")
        );
        assert_eq!(
            decorate_known_pikafish_nnue_version(
                Some(PIKAFISH_260720_NNUE_SHA256),
                Some("(64MiB, (62083, 1024, 32, 32, 1))".into())
            )
            .as_deref(),
            Some("权重260720 · (64MiB, (62083, 1024, 32, 32, 1))")
        );
    }

    #[test]
    fn fairy_stockfish_uses_xiangqi_variant_and_distinct_report_cache() {
        let directory = tempfile::tempdir().unwrap();
        let pikafish = directory.path().join("pikafish");
        let fairy = directory.path().join("fairy-stockfish");
        std::fs::write(&pikafish, b"same-engine-binary").unwrap();
        std::fs::write(&fairy, b"same-engine-binary").unwrap();

        assert_eq!(engine_variant_option(&fairy), Some("xiangqi"));
        assert_eq!(engine_variant_option(&pikafish), None);
        assert_ne!(
            report_engine_fingerprint(&pikafish).unwrap(),
            report_engine_fingerprint(&fairy).unwrap()
        );
    }

    #[test]
    fn fairy_stockfish_xiangqi_coordinates_are_normalized_to_internal_iccs() {
        assert_eq!(
            fairy_xiangqi_to_internal_iccs("b1c3").as_deref(),
            Some("b0c2")
        );
        assert_eq!(
            fairy_xiangqi_to_internal_iccs("a10a9").as_deref(),
            Some("a9a8")
        );
        assert_eq!(
            internal_iccs_to_fairy_xiangqi("b0c2").as_deref(),
            Some("b1c3")
        );
        assert_eq!(
            internal_iccs_to_fairy_xiangqi("a9a8").as_deref(),
            Some("a10a9")
        );
    }

    #[test]
    fn fairy_stockfish_analysis_line_uses_chinese_notation_and_internal_pv() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let line = analysis_line_from_engine_info(
            &board,
            engine_protocol::EngineInfo {
                depth: Some(18),
                score_cp: Some(80),
                multipv: 1,
                pv: vec!["b1c3".into(), "h10g8".into()],
                ..Default::default()
            },
            EngineFamily::FairyStockfish,
        );

        assert_eq!(line.pv, ["b0c2", "h9g7"]);
        assert_eq!(line.notation, ["马八进七", "马8进7"]);
    }

    #[test]
    fn bundled_fairy_stockfish_candidates_cover_resource_layouts() {
        let base = PathBuf::from("/app/Resources");
        let candidates = fairy_stockfish_candidates(&base);
        assert!(candidates.contains(&base.join("fairy-stockfish/fairy-stockfish")));
        assert!(candidates.contains(&base.join("resources/fairy-stockfish/fairy-stockfish")));
        assert!(candidates.contains(&base.join("fairy-stockfish/fairy-stockfish.exe")));
    }

    #[test]
    fn bundled_fairy_stockfish_candidates_cover_the_development_resource_directory() {
        let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let candidates = fairy_stockfish_candidates(&resource_dir);
        assert!(candidates.contains(&resource_dir.join("fairy-stockfish/fairy-stockfish")));
    }

    #[test]
    fn preferred_nnue_path_favors_xiangqi_networks() {
        let directory = tempfile::tempdir().unwrap();
        let engine = directory.path().join("fairy-stockfish");
        let generic = directory.path().join("z-generic.nnue");
        let fairy = directory.path().join("fairy.nnue");
        let xiangqi = directory.path().join("xiangqi-2024.nnue");
        std::fs::write(&engine, b"engine").unwrap();
        std::fs::write(&generic, b"generic").unwrap();
        std::fs::write(&fairy, b"fairy").unwrap();
        std::fs::write(&xiangqi, b"xiangqi").unwrap();

        assert_eq!(preferred_nnue_path(&engine).unwrap(), xiangqi);
    }

    #[test]
    fn preferred_nnue_path_keeps_fairy_and_pikafish_networks_separate() {
        let directory = tempfile::tempdir().unwrap();
        let pikafish = directory.path().join("pikafish");
        let fairy = directory.path().join("fairy-stockfish");
        let pikafish_nnue = directory.path().join("pikafish.nnue");
        let fairy_nnue = directory.path().join("fairy-xiangqi.nnue");
        std::fs::write(&pikafish, b"pikafish").unwrap();
        std::fs::write(&fairy, b"fairy").unwrap();
        std::fs::write(&pikafish_nnue, b"pikafish-network").unwrap();
        std::fs::write(&fairy_nnue, b"fairy-network").unwrap();

        assert_eq!(preferred_nnue_path(&pikafish).unwrap(), pikafish_nnue);
        assert_eq!(preferred_nnue_path(&fairy).unwrap(), fairy_nnue);
    }

    #[test]
    fn preferred_nnue_path_never_uses_pikafish_network_for_fairy() {
        let directory = tempfile::tempdir().unwrap();
        let fairy = directory.path().join("fairy-stockfish");
        let pikafish_nnue = directory.path().join("pikafish.nnue");
        std::fs::write(&fairy, b"fairy").unwrap();
        std::fs::write(&pikafish_nnue, b"pikafish-network").unwrap();

        assert_eq!(preferred_nnue_path(&fairy), None);
    }

    #[tokio::test]
    async fn auth_http_maps_success_and_common_failures() {
        let user_id = Uuid::new_v4();
        let server = mock_auth_server(
            "200 OK",
            serde_json::json!({ "user_id": user_id, "token": "jwt-secret" }).to_string(),
        )
        .await;
        assert_eq!(
            request_auth(&server, "login", "user@example.com", "password-123")
                .await
                .unwrap(),
            AuthResponse {
                user_id,
                token: "jwt-secret".into()
            }
        );

        let duplicate = mock_auth_server("409 Conflict", r#"{"error":"duplicate"}"#.into()).await;
        assert_eq!(
            request_auth(&duplicate, "login", "user@example.com", "password-123")
                .await
                .unwrap_err(),
            "该邮箱已经注册，请直接登录"
        );

        let legacy_duplicate = mock_auth_server(
            "400 Bad Request",
            r#"{"error":"email already registered"}"#.into(),
        )
        .await;
        assert_eq!(
            request_auth(
                &legacy_duplicate,
                "login",
                "user@example.com",
                "password-123",
            )
            .await
            .unwrap_err(),
            "该邮箱已经注册，请直接登录"
        );

        let unauthorized =
            mock_auth_server("401 Unauthorized", r#"{"error":"invalid"}"#.into()).await;
        assert_eq!(
            request_auth(&unauthorized, "login", "user@example.com", "password-123")
                .await
                .unwrap_err(),
            "邮箱或密码不正确"
        );

        let unavailable =
            mock_auth_server("503 Service Unavailable", r#"{"error":"down"}"#.into()).await;
        assert!(
            request_auth(&unavailable, "login", "user@example.com", "password-123")
                .await
                .unwrap_err()
                .contains("503")
        );
    }

    #[test]
    fn preference_validation_rejects_remote_http_and_invalid_engine_limits() {
        assert!(validate_server_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_server_url("https://sync.example.com").is_ok());
        assert!(validate_server_url("http://sync.example.com").is_err());
        let mut preferences = DesktopPreferences::default();
        preferences.threads = 0;
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "线程数必须在 1 到 64 之间"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.color_theme = "high-contrast".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的颜色主题"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.layout_mode = "floating".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的工作台布局"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.candidate_line_moves = 21;
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "后续走法必须在 2 到 20 个半回合之间"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.rule_mode = "tiantian".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的棋规模式"
        );
    }

    #[test]
    fn signed_out_preferences_can_preserve_but_not_select_account_skins() {
        let mut current = DesktopPreferences::default();
        current.board_skin = "jingdian".into();
        current.piece_skin = "jingdian".into();

        let mut updated = current.clone();
        updated.candidate_line_moves = 12;
        assert!(validate_skin_access(&current, &updated, false).is_ok());

        updated.board_skin = "xinghe".into();
        assert_eq!(
            validate_skin_access(&current, &updated, false).unwrap_err(),
            "登录同步账号后才能使用登录专享皮肤"
        );

        let current = DesktopPreferences::default();
        let mut updated = current.clone();
        updated.piece_skin = "jingdian".into();
        assert!(validate_skin_access(&current, &updated, false).is_err());
        assert!(validate_skin_access(&current, &updated, true).is_ok());
    }

    #[test]
    fn hongmu_skin_is_valid_and_free() {
        let current = DesktopPreferences::default();
        let mut updated = current.clone();
        updated.board_skin = "hongmu".into();
        updated.piece_skin = "hongmu".into();

        assert!(validate_preferences(&updated).is_ok());
        assert!(validate_skin_access(&current, &updated, false).is_ok());
    }
}
