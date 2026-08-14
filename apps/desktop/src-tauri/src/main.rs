#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod cloud_opening_book;
mod credential_store;
mod eleeye_opening_book;
mod gif_export;
mod link_vision;
mod manual_pdf;
mod opening_book;
mod pdf_report;
mod pfbook_opening_book;
mod u10_learning;
mod xqb_opening_book;

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, Utc};
use credential_store::{SharedCredentialStore, SystemCredentialStore, TOKEN_KEY};
use engine_protocol::{EngineControl, EngineEvent, EngineSession, Protocol, SearchLimit};
use link_core::{
    BoardOrientation, CapturePolicy, CaptureSource, LinkMode, LinkSessionState, RecognitionMode,
    ReconcileDecision, StabilityGate,
};
use local_store::{
    AnalysisSummary, DesktopPreferences, EngineProfile, FlyknifePlan, FlyknifeStepAnnotation,
    GameMirrorStatus, GuidedAnalysisSession, GuidedAnalysisSubmission, ImportedGame,
    ImportedMasterStyleProfile, ImportedMasterStyleSample, ImportedTheoryCard, LearningProfile,
    LibraryFolder, LocalGame, LocalStore, MasterStyleHint, MasterStyleProfile, StudySession,
    SyncAccountBinding, TheoryCard, TheoryCardFeedback, TheoryLesson, TrainingAttempt,
    TrainingTask, WeaknessStat,
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
use u10_learning::{
    DailyTrainingPlanDto, GuidedAnalysisResultDto, GuidedEngineLine, OpeningRepertoireDto,
    OpeningSample, WeeklyLearningReportDto, classify_submission, daily_plan,
    infer_opening_repertoire, weekly_report,
};
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
    /// Serializes screenshot invalidation, resolution and confirmation. The
    /// capture generation is still checked, but this closes the interval where
    /// a replacement image could begin after confirmation has read that value.
    screenshot_resolution_guard: Mutex<()>,
    link_capture_generation: AtomicU64,
    link_region_selection_background: Mutex<Option<String>>,
    link_region_selection: (Mutex<Option<Result<LinkCaptureRegion, String>>>, Condvar),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LinkCaptureRegion {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    selection_x: f64,
    selection_y: f64,
    selection_width: f64,
    selection_height: f64,
    selector_width: f64,
    selector_height: f64,
}

struct LinkSession {
    source: CaptureSource,
    recognition_mode: RecognitionMode,
    mode: LinkMode,
    state: LinkSessionState,
    gate: StabilityGate,
    reason: Option<String>,
    capture_preview: Option<String>,
    capture_preview_kind: Option<String>,
    frame_rate: f32,
    confidence: Option<f32>,
    confidence_threshold: f32,
    stable_frames: u8,
    required_stable_frames: u8,
    latest_fen: Option<String>,
    last_move: Option<String>,
    last_move_detail: Option<LinkMoveDetailDto>,
    initial_position_seen: bool,
    auto_side: Option<Color>,
    capture_running: bool,
    board_bounds: Option<(f32, f32, f32, f32)>,
    piece_click_centers: Vec<LinkPieceClickCenter>,
    target_region: Option<LinkCaptureRegion>,
    board_orientation: link_core::BoardOrientation,
    capture_generation: u64,
    started_at: Option<DateTime<Utc>>,
    last_heartbeat_at: Option<DateTime<Utc>>,
    phase: Option<String>,
    last_error: Option<String>,
    recognition_attempts: u64,
    last_detection_summary: Option<String>,
    turn_indicator: Option<String>,
    manual_turn_override: Option<Color>,
    pending_external_move: Option<String>,
    pending_expected_fen: Option<String>,
    screenshot_move_marker: Option<link_vision::ScreenshotMoveMarker>,
    /// The current manual-tree position from which the screenshot resolution
    /// was produced. Confirmation must use this exact position; otherwise a
    /// stale dialog could write a variation below a different node.
    screenshot_resolution_before_fen: Option<String>,
    /// Binds the resolution to one image-recognition run. Re-selecting an
    /// image invalidates all candidates from the prior image.
    screenshot_resolution_generation: Option<u64>,
    /// Exact screenshot candidates and the manual recovery path have
    /// different confirmation rules.  Keeping this on the session prevents a
    /// caller from turning a failed YOLO comparison into an arbitrary tree
    /// edit just by submitting a legal ICCS move.
    screenshot_resolution_mode: Option<ScreenshotResolutionMode>,
    /// FEN alone is not a tree identity: repetitions can reach the exact same
    /// position below a different branch, or even another game. Keep the
    /// document and parent node that produced a screenshot proposal so a stale
    /// dialog cannot write below a look-alike position.
    screenshot_resolution_game_id: Option<Uuid>,
    /// `Some(None)` means the root node; `None` means no active resolution.
    screenshot_resolution_current_node: Option<Option<Uuid>>,
    /// Only a resolver candidate, or a legal manual preview produced by this
    /// session, may be confirmed. This closes the last client-side path for
    /// adding an arbitrary legal move while a screenshot dialog is open.
    screenshot_resolution_allowed_moves: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScreenshotResolutionMode {
    ExactPlacement,
    ManualFallback,
}

#[derive(Debug, Clone)]
struct ScreenshotResolutionBinding {
    recognized_after_fen: Option<String>,
    before_fen: String,
    generation: u64,
    mode: ScreenshotResolutionMode,
    game_id: Uuid,
    current_node: Option<Uuid>,
    allowed_moves: Vec<String>,
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
            capture_preview_kind: None,
            frame_rate: 0.0,
            confidence: None,
            confidence_threshold: 0.55,
            stable_frames: 0,
            required_stable_frames: 1,
            latest_fen: None,
            last_move: None,
            last_move_detail: None,
            initial_position_seen: false,
            auto_side: None,
            capture_running: false,
            board_bounds: None,
            piece_click_centers: Vec::new(),
            target_region: None,
            board_orientation: link_core::BoardOrientation::RedAtBottom,
            capture_generation: 0,
            started_at: None,
            last_heartbeat_at: None,
            phase: None,
            last_error: None,
            recognition_attempts: 0,
            last_detection_summary: None,
            turn_indicator: None,
            manual_turn_override: None,
            pending_external_move: None,
            pending_expected_fen: None,
            screenshot_move_marker: None,
            screenshot_resolution_before_fen: None,
            screenshot_resolution_generation: None,
            screenshot_resolution_mode: None,
            screenshot_resolution_game_id: None,
            screenshot_resolution_current_node: None,
            screenshot_resolution_allowed_moves: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LinkPieceClickCenter {
    square: Square,
    x: f32,
    y: f32,
    confidence: f32,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterPlayerDto {
    id: String,
    name: String,
    source_site: String,
    source_player_id: String,
    profile_url: String,
    game_count: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterGameSummaryDto {
    id: String,
    title: String,
    red_player: String,
    black_player: String,
    master_side: Option<String>,
    event_name: Option<String>,
    game_date: Option<String>,
    result: String,
    move_count: u64,
    source_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterGameDetailDto {
    id: String,
    title: String,
    red_player: String,
    black_player: String,
    master_side: Option<String>,
    event_name: Option<String>,
    game_date: Option<String>,
    result: String,
    move_count: u64,
    source_url: String,
    moves: Vec<String>,
    pgn: String,
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

#[derive(Clone, Copy, Serialize)]
struct SquareDto {
    row: u8,
    col: u8,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkMoveDetailDto {
    iccs: String,
    notation: String,
    moved_by: &'static str,
    from: SquareDto,
    to: SquareDto,
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
struct RecognizedLastMovePreviewDto {
    #[serde(flatten)]
    step: PreviewLineStepDto,
    before_fen: String,
    after_fen: String,
    side_to_move: &'static str,
    captured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    marker_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recognition_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recognition_confidence: Option<u32>,
}

/// The only automatic screenshot-to-move result exposed to the UI.  The
/// candidates are all legal moves from the current document whose *resulting
/// piece placement* exactly matches the YOLO-recognized screenshot position.
/// Screenshot rings are deliberately not a source of candidates; they only
/// sort this already rule-validated set.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotMoveResolutionDto {
    /// `unique`, `ambiguous`, or `noExactMatch`.
    status: &'static str,
    candidates: Vec<RecognizedLastMovePreviewDto>,
    orientation: BoardOrientation,
    /// Manual fallback always starts from the current document, never from a
    /// possibly mismatched screenshot board.
    current_pieces: Vec<PieceDto>,
    current_side_to_move: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfoDto {
    version: &'static str,
    build_timestamp: u64,
    platform: String,
}

#[tauri::command]
fn get_app_info() -> AppInfoDto {
    AppInfoDto {
        version: env!("CARGO_PKG_VERSION"),
        build_timestamp: env!("XIANGQI_BUILD_TIMESTAMP").parse().unwrap_or_default(),
        platform: format!("{} · {}", std::env::consts::OS, std::env::consts::ARCH),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameSummaryDto {
    id: Uuid,
    title: String,
    fen: String,
    updated_at: String,
    current: bool,
    library_folder: Option<String>,
    favorite: bool,
    tags: Vec<String>,
    mirror: Option<GameMirrorStatusDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameMirrorStatusDto {
    game_id: Uuid,
    path: Option<String>,
    state: String,
    updated_at: Option<String>,
    error: Option<String>,
}

impl From<GameMirrorStatus> for GameMirrorStatusDto {
    fn from(status: GameMirrorStatus) -> Self {
        Self {
            game_id: status.game_id,
            path: status.path,
            state: status.state,
            updated_at: status.updated_at,
            error: status.error,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFolderDto {
    name: String,
    system: bool,
    game_count: u32,
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
    #[serde(default)]
    master_style_hints: Vec<MasterStyleHint>,
    #[serde(rename = "move")]
    move_: Option<GameReportMoveDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportMasterStyleProfileRequest {
    profile_path: Option<String>,
    samples_path: Option<String>,
    analysis_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterStyleImportResultDto {
    profiles: Vec<MasterStyleProfile>,
    imported_samples: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterStyleSeedManifest {
    seed_id: String,
    #[serde(default)]
    players: Vec<String>,
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
    phase: Option<String>,
    tags: Vec<String>,
    source_card_id: Option<i64>,
    task_type: String,
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
            phase: task.phase,
            tags: task.tags,
            source_card_id: task.source_card_id,
            task_type: task.task_type,
            completed_at: task.completed_at,
            created_at: task.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrainingGenerationResultDto {
    tasks: Vec<TrainingTaskDto>,
    critical_count: usize,
    reinforcement_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlyknifeTemplateDto {
    id: &'static str,
    name: &'static str,
    moves: Vec<String>,
    fen: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlyknifeTopicDto {
    id: &'static str,
    title: &'static str,
    opening: &'static str,
    category: &'static str,
    source: &'static str,
    move_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlyknifePlanDto {
    id: Option<Uuid>,
    title: String,
    side: String,
    starting_fen: String,
    template_id: Option<String>,
    template_name: String,
    lure_move: String,
    knife_move: String,
    mainline: Vec<String>,
    best_defense: Vec<String>,
    score_cp: Option<i64>,
    mate: Option<i64>,
    risk: String,
    source_game_id: Option<Uuid>,
    source_node_id: Option<Uuid>,
    note: String,
    #[serde(default)]
    annotations: Vec<FlyknifeStepAnnotationDto>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlyknifeStepAnnotationDto {
    role: String,
    iccs: String,
    notation: String,
    side: String,
    fen: Option<String>,
    score_cp: Option<i64>,
    swing_cp: Option<i64>,
    intent: String,
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateFlyknifeRequest {
    starting_fen: String,
    side: String,
    setup_move: Option<String>,
    lure_move: String,
    engine_path: String,
    threads: u32,
    hash_mb: u32,
    search_mode: String,
    search_value: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlyknifeCandidateDto {
    setup_move: Option<String>,
    setup_notation: Option<String>,
    lure_move: String,
    lure_notation: Option<String>,
    knife_move: String,
    mainline: Vec<String>,
    notation: Vec<String>,
    best_defense: Vec<String>,
    best_defense_notation: Vec<String>,
    score_cp: Option<i64>,
    baseline_score_cp: Option<i64>,
    swing_cp: Option<i64>,
    mate: Option<i64>,
    risk: String,
    annotations: Vec<FlyknifeStepAnnotationDto>,
}

impl From<FlyknifePlan> for FlyknifePlanDto {
    fn from(plan: FlyknifePlan) -> Self {
        Self {
            id: Some(plan.id),
            title: plan.title,
            side: plan.side,
            starting_fen: plan.starting_fen,
            template_id: plan.template_id,
            template_name: plan.template_name,
            lure_move: plan.lure_move,
            knife_move: plan.knife_move,
            mainline: plan.mainline,
            best_defense: plan.best_defense,
            score_cp: plan.score_cp,
            mate: plan.mate,
            risk: plan.risk,
            source_game_id: plan.source_game_id,
            source_node_id: plan.source_node_id,
            note: plan.note,
            annotations: plan.annotations.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<FlyknifeStepAnnotation> for FlyknifeStepAnnotationDto {
    fn from(value: FlyknifeStepAnnotation) -> Self {
        Self {
            role: value.role,
            iccs: value.iccs,
            notation: value.notation,
            side: value.side,
            fen: value.fen,
            score_cp: value.score_cp,
            swing_cp: value.swing_cp,
            intent: value.intent,
            note: value.note,
        }
    }
}

impl From<FlyknifeStepAnnotationDto> for FlyknifeStepAnnotation {
    fn from(value: FlyknifeStepAnnotationDto) -> Self {
        Self {
            role: value.role,
            iccs: value.iccs,
            notation: value.notation,
            side: value.side,
            fen: value.fen,
            score_cp: value.score_cp,
            swing_cp: value.swing_cp,
            intent: value.intent,
            note: value.note,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TheoryFeedbackRequest {
    match_id: Option<Uuid>,
    card_id: i64,
    card_version: i64,
    verdict: String,
    note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrainingSummaryDto {
    weak_spots: Vec<WeaknessStat>,
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
    orientation: BoardOrientation,
    capture_preview_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkSessionStatusDto {
    source: CaptureSource,
    mode: LinkMode,
    state: LinkSessionState,
    reason: Option<String>,
    phase: Option<String>,
    last_error: Option<String>,
    started_at: Option<String>,
    last_heartbeat_at: Option<String>,
    recognition_attempts: u64,
    last_detection_summary: Option<String>,
    turn_indicator: Option<String>,
    manual_turn_override: Option<String>,
    pending_external_move: Option<String>,
    capture_preview_kind: Option<String>,
    frame_rate: f32,
    confidence: Option<f32>,
    confidence_threshold: f32,
    stable_frames: u8,
    required_stable_frames: u8,
    latest_fen: Option<String>,
    last_move: Option<String>,
    last_move_detail: Option<LinkMoveDetailDto>,
    initial_position_seen: bool,
    auto_side: Option<String>,
    board_orientation: BoardOrientation,
    capture_running: bool,
}

struct LinkCapturePreview {
    data_uri: String,
    png: Vec<u8>,
    region: Option<LinkCaptureRegion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkRegionSelectionDto {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn link_status_dto(session: &LinkSession) -> LinkSessionStatusDto {
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
    }
}

fn link_live_session_has_stable_position(session: &LinkSession) -> bool {
    session.capture_running
        && session.initial_position_seen
        && matches!(
            session.source,
            CaptureSource::WindowLink | CaptureSource::DesktopDetect
        )
}

fn should_apply_link_recognition_geometry(
    session: &LinkSession,
    orientation: BoardOrientation,
) -> bool {
    !link_live_session_has_stable_position(session) || session.board_orientation == orientation
}

fn reset_link_stability_progress(session: &mut LinkSession) {
    session.stable_frames = 0;
    session.required_stable_frames = session.gate.required_frames();
}

fn set_link_stability_progress(session: &mut LinkSession, frames: u8, required: u8) {
    let required = required.max(1);
    session.stable_frames = frames.min(required);
    session.required_stable_frames = required;
}

fn mark_link_stability_accepted(session: &mut LinkSession) {
    let required = session.gate.required_frames();
    set_link_stability_progress(
        session,
        session.gate.matching_frames().max(required),
        required,
    );
}

fn clear_link_recognition_candidate(session: &mut LinkSession) {
    if link_live_session_has_stable_position(session) {
        return;
    }
    session.latest_fen = None;
    session.last_move = None;
    session.last_move_detail = None;
}

fn live_side_change_required_frames(session: &LinkSession) -> u8 {
    if link_live_session_has_stable_position(session) {
        session.gate.required_frames().max(4)
    } else {
        session.gate.required_frames()
    }
}

fn live_position_jump_required_frames(session: &LinkSession) -> u8 {
    if link_live_session_has_stable_position(session) {
        session.gate.required_frames().max(5)
    } else {
        session.gate.required_frames()
    }
}

fn wait_for_link_recognition_stability(
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

fn effective_link_confidence_threshold(value: u8) -> f32 {
    let migrated = if value == 70 { 55 } else { value };
    migrated.clamp(10, 100) as f32 / 100.0
}

fn desktop_link_confidence_threshold(state: &DesktopState) -> f32 {
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

fn emit_link_session_updated(app: &tauri::AppHandle) {
    let _ = app.emit("link-session-updated", ());
}

fn apply_link_capture_timeout(session: &mut LinkSession) {
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

fn apply_link_region_selection_failure(
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

fn initialize_link_session_for_request(
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
    session.target_region = None;
    session.board_orientation = BoardOrientation::RedAtBottom;
    session.capture_generation = generation;
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

fn start_window_link_selection_worker(
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
fn stop_link_session(
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
    session.target_region = None;
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
fn get_link_session_status(state: State<'_, DesktopState>) -> Result<LinkSessionStatusDto, String> {
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    apply_link_capture_timeout(&mut session);
    Ok(link_status_dto(&session))
}

#[tauri::command]
fn pause_link_session(state: State<'_, DesktopState>) -> Result<LinkSessionStatusDto, String> {
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
fn get_link_capture_preview(state: State<'_, DesktopState>) -> Result<Option<String>, String> {
    Ok(state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?
        .capture_preview
        .clone())
}

#[tauri::command]
fn recognize_link_image_file(
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
        session.target_region = None;
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

fn image_mime_type(path: &Path) -> &'static str {
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

fn png_data_uri(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", BASE64.encode(bytes))
}

#[tauri::command]
fn complete_link_region_selection(
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
fn cancel_link_region_selection(
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
fn get_link_region_selection_background(
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    state
        .link_region_selection_background
        .lock()
        .map(|background| background.clone())
        .map_err(|_| "link selection background lock poisoned".to_owned())
}

fn capture_window_link_preview(
    app: &tauri::AppHandle,
    state: &DesktopState,
) -> Result<Option<LinkCapturePreview>, String> {
    #[cfg(target_os = "macos")]
    {
        prepare_window_link_selection(app);
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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Err("当前平台尚未接入系统框选；请先使用截图/照片导入".into())
    }
}

fn reset_link_region_selection(state: &DesktopState) -> Result<(), String> {
    let (lock, _) = &state.link_region_selection;
    *lock
        .lock()
        .map_err(|_| "link selection lock poisoned".to_owned())? = None;
    Ok(())
}

fn set_link_region_selection_background(
    state: &DesktopState,
    background: Option<String>,
) -> Result<(), String> {
    *state
        .link_region_selection_background
        .lock()
        .map_err(|_| "link selection background lock poisoned".to_owned())? = background;
    Ok(())
}

fn wait_for_link_region_selection(
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

fn open_link_region_selection_window(app: &tauri::AppHandle) -> Result<(), String> {
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

fn prepare_window_link_selection(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.hide();
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

fn restore_link_window_or_main(app: &tauri::AppHandle) {
    if let Some(link_window) = app.get_webview_window("compact-link") {
        let _ = link_window.show();
        let _ = link_window.set_focus();
    } else {
        restore_main_window(app);
    }
}

fn rects_intersect(left: (f64, f64, f64, f64), right: (f64, f64, f64, f64)) -> bool {
    let (left_x, left_y, left_width, left_height) = left;
    let (right_x, right_y, right_width, right_height) = right;
    left_x < right_x + right_width
        && left_x + left_width > right_x
        && left_y < right_y + right_height
        && left_y + left_height > right_y
}

fn link_region_rect(region: LinkCaptureRegion) -> (f64, f64, f64, f64) {
    (
        region.x as f64,
        region.y as f64,
        region.width.max(1) as f64,
        region.height.max(1) as f64,
    )
}

fn link_region_monitor_origin(region: LinkCaptureRegion) -> (f64, f64) {
    (
        region.x as f64 - region.selection_x,
        region.y as f64 - region.selection_y,
    )
}

fn link_region_from_screen_rect(
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

fn expand_link_capture_region(region: LinkCaptureRegion) -> LinkCaptureRegion {
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

fn link_capture_guard_region(region: LinkCaptureRegion) -> LinkCaptureRegion {
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

fn select_link_capture_frame_region(
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

fn link_region_around_board_bounds(
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

fn link_window_rect(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
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

fn link_window_intersects_region(window: &tauri::WebviewWindow, region: LinkCaptureRegion) -> bool {
    link_window_rect(window)
        .map(|window_rect| rects_intersect(window_rect, link_region_rect(region)))
        .unwrap_or(false)
}

fn relocate_link_hint_window_away_from_region(app: &tauri::AppHandle, region: LinkCaptureRegion) {
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

fn link_hint_window_overlaps_region(
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

fn color_name(color: Color) -> String {
    match color {
        Color::Red => "red".into(),
        Color::Black => "black".into(),
    }
}

fn link_move_detail(board: &Board, mv: Move) -> Result<LinkMoveDetailDto, String> {
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

fn link_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn link_vision_candidates(base: &Path) -> Vec<PathBuf> {
    [
        "link-vision/yolov11.onnx",
        "resources/link-vision/yolov11.onnx",
    ]
    .into_iter()
    .map(|relative| base.join(relative))
    .collect()
}

fn validate_link_model(path: &Path) -> Result<(), String> {
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

fn start_window_link_capture(
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
                    match capture_display_frame_for_link(&app, frame_region) {
                        Ok(frame) => {
                            if let Some(next_region) = process_link_capture_frame(
                                &app,
                                generation,
                                &mut detector,
                                &frame,
                                true,
                                frame_region,
                                "屏幕采集",
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

fn process_link_capture_frame(
    app: &tauri::AppHandle,
    generation: u64,
    detector: &mut link_vision::Yolo11Detector,
    frame: &[u8],
    update_bounds: bool,
    capture_region: Option<LinkCaptureRegion>,
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
    let next_region = if update_bounds {
        board_bounds.and_then(|bounds| {
            let screen_bounds = if let Some(region) = capture_region {
                map_capture_bounds_to_screen(bounds, region, frame_dimensions)
            } else {
                bounds
            };
            if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                if session.capture_generation == generation {
                    session.board_bounds = Some(screen_bounds);
                    if let Some(region) = capture_region {
                        let next = link_region_around_board_bounds(region, screen_bounds);
                        session.target_region = Some(next);
                        return Some(next);
                    }
                }
            }
            None
        })
    } else {
        None
    };
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
                .unwrap_or_default();
            if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
                if session.capture_generation != generation {
                    return next_region;
                }
                if should_apply_link_recognition_geometry(&session, recognition.orientation) {
                    session.board_orientation = recognition.orientation;
                    session.piece_click_centers = recognized_piece_click_centers.clone();
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

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let image = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    Ok((image.width(), image.height()))
}

fn crop_png_by_bounds(
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

fn link_region_crop_rect(
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

fn crop_link_capture_frame(frame: &[u8], region: LinkCaptureRegion) -> Result<Vec<u8>, String> {
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

fn map_capture_bounds_to_screen(
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

fn map_capture_point_to_screen(
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

fn link_piece_click_centers(
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

fn capture_display_frame(region: Option<LinkCaptureRegion>) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = region;
        Err("当前持续连线采集尚未接入此平台".into())
    }
}

fn capture_display_frame_for_link(
    _app: &tauri::AppHandle,
    region: Option<LinkCaptureRegion>,
) -> Result<Vec<u8>, String> {
    capture_display_frame(region)
}

#[cfg(target_os = "macos")]
fn macos_screen_capture_permission_message(prefix: &str) -> String {
    format!("{prefix}，屏幕采集暂不可用；请确认权限后重试。")
}

fn link_capture_generation_is_active(app: &tauri::AppHandle, generation: u64) -> bool {
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

fn set_link_capture_preview(
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

fn set_link_capture_board_preview(
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

fn set_link_capture_detection_summary(
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

fn link_turn_indicator_message(
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

fn set_link_capture_waiting(app: &tauri::AppHandle, generation: u64, reason: String) {
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

fn set_link_capture_progress(app: &tauri::AppHandle, generation: u64, phase: &str, reason: &str) {
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

fn set_link_capture_error(app: &tauri::AppHandle, generation: u64, reason: String) {
    if let Ok(mut session) = app.state::<DesktopState>().link_session.lock() {
        apply_link_capture_error(&mut session, generation, reason);
    }
    emit_link_session_updated(app);
}

fn invalidate_screenshot_move_resolution(session: &mut LinkSession) {
    session.latest_fen = None;
    session.screenshot_move_marker = None;
    session.screenshot_resolution_before_fen = None;
    session.screenshot_resolution_generation = None;
    session.screenshot_resolution_mode = None;
    session.screenshot_resolution_game_id = None;
    session.screenshot_resolution_current_node = None;
    session.screenshot_resolution_allowed_moves.clear();
}

fn active_screenshot_resolution(
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

fn validate_screenshot_resolution_binding(
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

fn validate_screenshot_resolution_move(
    binding: &ScreenshotResolutionBinding,
    iccs: &str,
) -> Result<(), String> {
    if binding.allowed_moves.iter().any(|allowed| allowed == iccs) {
        Ok(())
    } else {
        Err("该走法不在本次截图确认的合法候选中，请重新核对或手工点选。".into())
    }
}

fn apply_link_capture_error(session: &mut LinkSession, generation: u64, reason: String) {
    if session.capture_generation != generation {
        return;
    }
    session.state = LinkSessionState::NeedsManualCorrection;
    session.phase = Some("error".into());
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
fn submit_link_position(
    fen: String,
    state: State<'_, DesktopState>,
) -> Result<LinkObservationDto, String> {
    observe_link_recognition_inner(&state, fen, None, None)
}

#[tauri::command]
fn set_link_side_to_move(
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
fn confirm_link_engine_move(
    iccs: String,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<bool, String> {
    let (bounds, orientation, piece_click_centers, mode, latest_fen, auto_side) = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        if !matches!(session.state, LinkSessionState::Tracking) {
            return Err("外部局面尚未稳定，不能执行走子".into());
        }
        (
            session.board_bounds.ok_or("未获得棋盘坐标，请重新框选")?,
            session.board_orientation,
            session.piece_click_centers.clone(),
            session.mode,
            session.latest_fen.clone(),
            session.auto_side,
        )
    };
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
    let click_target = matches!(mode, LinkMode::AutoPlay);
    let click_points = click_external_move(bounds, orientation, mv, detected_from, click_target)?;
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    let ((from_x, from_y), (to_x, to_y)) = click_points;
    let click_basis = if detected_from.is_some() {
        "按识别到的棋子中心"
    } else {
        "按棋盘网格估算"
    };
    session.reason = Some(if click_target {
        format!(
            "已按箭头1自动执行 {move_display}：{}点击起点({from_x:.0},{from_y:.0})，再点击目标({to_x:.0},{to_y:.0})；等待识别确认预期局面 {}",
            click_basis,
            expected.to_fen()
        )
    } else {
        format!(
            "已按箭头1选中起点 {move_display}：{}点击({from_x:.0},{from_y:.0})；请在网页棋盘确认目标({to_x:.0},{to_y:.0})，完成后等待同步 {}",
            click_basis,
            expected.to_fen()
        )
    });
    session.pending_external_move = Some(iccs);
    session.pending_expected_fen = Some(expected.to_fen());
    session.phase = Some("pending_external_move".into());
    session.gate.reset();
    reset_link_stability_progress(&mut session);
    drop(session);
    emit_link_session_updated(&app);
    Ok(true)
}

fn link_move_click_points(
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

fn link_move_click_points_for_click(
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

fn click_external_move(
    bounds: (f32, f32, f32, f32),
    orientation: link_core::BoardOrientation,
    mv: Move,
    detected_from: Option<LinkPieceClickCenter>,
    click_target: bool,
) -> Result<((f32, f32), (f32, f32)), String> {
    let click_points = link_move_click_points_for_click(bounds, orientation, mv, detected_from);
    #[cfg(target_os = "macos")]
    {
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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (bounds, orientation, mv, click_points, click_target);
        Err("当前平台尚未接入外部鼠标点击".into())
    }
}

#[cfg(target_os = "macos")]
fn macos_link_click_script(
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

fn observe_link_recognition(
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

fn observe_link_recognition_inner(
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
                let matching = session.gate.matching_frames();
                if matching < required {
                    return Ok(wait_for_link_recognition_stability(
                        &mut session,
                        "waiting_side_stability",
                        format!(
                            "识别到{}行棋，等待轮走方连续稳定 {}/{} 后再更新",
                            side_label(recognized_side_to_move),
                            matching,
                            required
                        ),
                        required,
                    ));
                }
            }
            if side_changed {
                model.board = model.board.with_side_to_move(recognized_side_to_move);
                if model.current_node.is_none() {
                    model.starting_fen = model.board.to_fen();
                }
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
        .map(|game| {
            let mirror = model
                .store
                .game_mirror_status(game.id)
                .map_err(|error| error.to_string())?
                .map(Into::into);
            Ok(GameSummaryDto {
                id: game.id,
                title: game.title,
                fen: game.starting_fen,
                updated_at: game.updated_at,
                current: game.id == model.game_id,
                library_folder: game.library_folder,
                favorite: game.favorite,
                tags: game.tags,
                mirror,
            })
        })
        .collect::<Result<Vec<_>, String>>()?)
}

fn default_game_mirror_root() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Documents")
        .join("棋研棋谱")
}

fn configured_game_mirror_root(preferences: &DesktopPreferences) -> PathBuf {
    let root = preferences.game_mirror_root.trim();
    if root.is_empty() {
        default_game_mirror_root()
    } else {
        PathBuf::from(root)
    }
}

fn sanitize_mirror_segment(value: &str, fallback: &str) -> String {
    let cleaned = value
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>();
    let cleaned =
        cleaned.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned.chars().take(80).collect()
    }
}

fn mirror_date(metadata: &ManualMetadata) -> String {
    let date = metadata.date.trim();
    if date.len() >= 4 && date.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        date.replace(['.', '/', ' '], "-")
    } else {
        "未标日期".into()
    }
}

fn mirror_year(metadata: &ManualMetadata) -> String {
    let date = metadata.date.trim();
    if date.len() >= 4 && date.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        date[..4].into()
    } else {
        "未标日期".into()
    }
}

fn mirror_opponent_and_side(metadata: &ManualMetadata) -> (String, String) {
    match (metadata.red.trim(), metadata.black.trim()) {
        ("", "") => ("未命名对手".into(), "未标执方".into()),
        (red, "") => (sanitize_mirror_segment(red, "未命名对手"), "红方".into()),
        ("", black) => (sanitize_mirror_segment(black, "未命名对手"), "黑方".into()),
        (red, black) => (
            sanitize_mirror_segment(&format!("{red}-vs-{black}"), "未命名对手"),
            "红黑".into(),
        ),
    }
}

fn game_mirror_target(root: &Path, game_id: Uuid, metadata: &ManualMetadata) -> PathBuf {
    let event = sanitize_mirror_segment(&metadata.event, "未命名赛事");
    let (opponent, side) = mirror_opponent_and_side(metadata);
    let base = format!("{}_{}_{}_{}", mirror_date(metadata), event, opponent, side);
    let _ = game_id;
    root.join(mirror_year(metadata))
        .join(&event)
        .join(format!("{base}.pgn"))
}

fn game_has_moves(tree: &ManualTree) -> bool {
    tree.branches(tree.root_id())
        .map(|nodes| !nodes.is_empty())
        .unwrap_or(false)
}

fn mirror_status(
    model: &mut AppModel,
    state: &str,
    path: Option<String>,
    error: Option<String>,
) -> Result<GameMirrorStatusDto, String> {
    let status = GameMirrorStatus {
        game_id: model.game_id,
        path,
        state: state.into(),
        updated_at: Some(Utc::now().to_rfc3339()),
        error,
    };
    model
        .store
        .save_game_mirror_status(&status)
        .map_err(|error| error.to_string())?;
    Ok(status.into())
}

fn save_game_mirror_status(
    store: &mut LocalStore,
    game_id: Uuid,
    state: &str,
    path: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    store
        .save_game_mirror_status(&GameMirrorStatus {
            game_id,
            path,
            state: state.into(),
            updated_at: Some(Utc::now().to_rfc3339()),
            error,
        })
        .map_err(|error| error.to_string())
}

fn sync_current_game_mirror(model: &mut AppModel) -> Result<GameMirrorStatusDto, String> {
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences.game_mirror_enabled {
        return mirror_status(model, "disabled", None, None);
    }
    if !game_has_moves(&model.tree) {
        return mirror_status(model, "pending", None, None);
    }
    let current_game = model
        .store
        .load_game(model.game_id)
        .map_err(|error| error.to_string())?
        .ok_or("当前棋谱不存在")?;
    if current_game.library_folder.is_none() {
        if let Some(previous) = model
            .store
            .game_mirror_status(model.game_id)
            .map_err(|error| error.to_string())?
            .and_then(|status| status.path)
        {
            if Path::new(&previous).exists() {
                fs::remove_file(&previous).map_err(|error| format!("无法移除旧镜像：{error}"))?;
            }
        }
        return mirror_status(model, "pending", None, None);
    }
    let root = configured_game_mirror_root(&preferences);
    let mut target = game_mirror_target(&root, model.game_id, &model.metadata);
    let old = model
        .store
        .game_mirror_status(model.game_id)
        .map_err(|error| error.to_string())?;
    if target.exists()
        && old
            .as_ref()
            .and_then(|status| status.path.as_ref())
            .map(PathBuf::from)
            .as_ref()
            != Some(&target)
    {
        let suffix = model.game_id.simple().to_string();
        let stem = target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("棋谱");
        target.set_file_name(format!("{stem}_{}.pgn", &suffix[..8]));
    }
    let previous_path = old.as_ref().and_then(|status| status.path.clone());
    let result = (|| -> Result<(), std::io::Error> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, export_pgn(&document_from_model(model)))?;
        if let Some(previous) = previous_path.clone().map(PathBuf::from) {
            if previous != target && previous.exists() {
                fs::remove_file(previous)?;
            }
        }
        Ok(())
    })();
    match result {
        Ok(()) => mirror_status(
            model,
            "synced",
            Some(target.to_string_lossy().into_owned()),
            None,
        ),
        Err(error) => mirror_status(
            model,
            "failed",
            previous_path,
            Some(format!("外部镜像写入失败：{error}")),
        ),
    }
}

#[tauri::command]
fn get_game_mirror_status(
    game_id: Option<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<Option<GameMirrorStatusDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .game_mirror_status(game_id.unwrap_or(model.game_id))
        .map(|status| status.map(Into::into))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_game_mirror(state: State<'_, DesktopState>) -> Result<GameMirrorStatusDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    sync_current_game_mirror(&mut model)
}

#[tauri::command]
fn rebuild_game_mirrors(
    state: State<'_, DesktopState>,
) -> Result<Vec<GameMirrorStatusDto>, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let games = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?;
    let mut statuses = Vec::new();
    for game in games {
        if game.id == model.game_id {
            statuses.push(sync_current_game_mirror(&mut model)?);
            continue;
        }
        let previous = model
            .store
            .game_mirror_status(game.id)
            .map_err(|error| error.to_string())?;
        if !preferences.game_mirror_enabled {
            save_game_mirror_status(&mut model.store, game.id, "disabled", None, None)?;
        } else if game.library_folder.is_none() {
            if let Some(path) = previous.as_ref().and_then(|status| status.path.as_ref()) {
                if Path::new(path).exists() {
                    fs::remove_file(path).map_err(|error| format!("无法移除旧镜像：{error}"))?;
                }
            }
            save_game_mirror_status(&mut model.store, game.id, "pending", None, None)?;
        } else {
            let (_, tree) = restore_game(&model.store, &game)?;
            if !game_has_moves(&tree) {
                save_game_mirror_status(&mut model.store, game.id, "pending", None, None)?;
            } else {
                let metadata = serde_json::from_str::<ManualMetadata>(&game.metadata_json)
                    .unwrap_or(ManualMetadata {
                        title: game.title.clone(),
                        result: "*".into(),
                        ..ManualMetadata::default()
                    });
                let document = ManualDocument {
                    metadata: metadata.clone(),
                    starting_fen: game.starting_fen.clone(),
                    note: game.note.clone(),
                    tree,
                    warnings: Vec::new(),
                };
                let mut target = game_mirror_target(
                    &configured_game_mirror_root(&preferences),
                    game.id,
                    &metadata,
                );
                if target.exists()
                    && previous
                        .as_ref()
                        .and_then(|status| status.path.as_ref())
                        .map(PathBuf::from)
                        .as_ref()
                        != Some(&target)
                {
                    let suffix = game.id.simple().to_string();
                    let stem = target
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("棋谱");
                    target.set_file_name(format!("{stem}_{}.pgn", &suffix[..8]));
                }
                let previous_path = previous.as_ref().and_then(|status| status.path.clone());
                let result = (|| -> Result<(), std::io::Error> {
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::write(&target, export_pgn(&document))?;
                    if let Some(old_path) = previous_path.clone().map(PathBuf::from) {
                        if old_path != target && old_path.exists() {
                            fs::remove_file(old_path)?;
                        }
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => save_game_mirror_status(
                        &mut model.store,
                        game.id,
                        "synced",
                        Some(target.to_string_lossy().into_owned()),
                        None,
                    )?,
                    Err(error) => save_game_mirror_status(
                        &mut model.store,
                        game.id,
                        "failed",
                        previous_path,
                        Some(format!("外部镜像写入失败：{error}")),
                    )?,
                }
            }
        }
        if let Some(status) = model
            .store
            .game_mirror_status(game.id)
            .map_err(|error| error.to_string())?
        {
            statuses.push(status.into());
        }
    }
    Ok(statuses)
}

#[tauri::command]
fn reveal_game_mirror(state: State<'_, DesktopState>) -> Result<(), String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let status = model
        .store
        .game_mirror_status(model.game_id)
        .map_err(|error| error.to_string())?
        .ok_or("当前棋谱尚未创建 Finder 镜像")?;
    let path = status.path.ok_or("当前棋谱尚未创建 Finder 镜像")?;
    if !Path::new(&path).exists() {
        return Err("镜像文件已在 Finder 中被删除，请先立即更新镜像".into());
    }
    ProcessCommand::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| format!("无法在 Finder 中显示：{error}"))?;
    Ok(())
}

impl From<LibraryFolder> for LibraryFolderDto {
    fn from(folder: LibraryFolder) -> Self {
        Self {
            name: folder.name,
            system: folder.system,
            game_count: folder.game_count,
        }
    }
}

#[tauri::command]
fn list_library_folders(state: State<'_, DesktopState>) -> Result<Vec<LibraryFolderDto>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .library_folders()
        .map(|folders| folders.into_iter().map(Into::into).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_library_folder(name: String, state: State<'_, DesktopState>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .create_library_folder(name)
        .map_err(|_| "无法创建文件夹".into())
}

#[tauri::command]
fn rename_library_folder(
    previous: String,
    next: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let next = next.trim();
    if next.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let affected = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some(previous.as_str()))
        .collect::<Vec<_>>();
    model
        .store
        .rename_library_folder(&previous, next)
        .map_err(|_| "系统文件夹不能重命名，或文件夹不存在".to_owned())?;
    for game in affected {
        let payload = library_metadata_payload(&game, Some(next.to_owned()));
        let operation = next_operation_for_game(
            &mut model,
            game.id,
            OperationKind::UpdateGameMetadata,
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_game_library_with_operation(
                game.id,
                Some(next),
                game.favorite,
                &game.tags,
                &operation,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_library_folder(name: String, state: State<'_, DesktopState>) -> Result<(), String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let affected = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some(name.as_str()))
        .collect::<Vec<_>>();
    model
        .store
        .delete_library_folder(&name)
        .map_err(|_| "系统文件夹不能删除，或文件夹不存在".to_owned())?;
    for game in affected {
        let payload = library_metadata_payload(&game, None);
        let operation = next_operation_for_game(
            &mut model,
            game.id,
            OperationKind::UpdateGameMetadata,
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_game_library_with_operation(
                game.id,
                None,
                game.favorite,
                &game.tags,
                &operation,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_game_library(
    folder: Option<String>,
    favorite: bool,
    tags: Vec<String>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let folder = folder
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned());
    let tags: Vec<String> = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .fold(Vec::new(), |mut tags, tag| {
            if !tags.contains(&tag) {
                tags.push(tag);
            }
            tags
        });
    let game_id = model.game_id;
    let payload = UpdateGameMetadataPayload {
        title: model.metadata.title.clone(),
        note: model.note.clone(),
        event: Some(model.metadata.event.clone()),
        site: Some(model.metadata.site.clone()),
        date: Some(model.metadata.date.clone()),
        red: Some(model.metadata.red.clone()),
        black: Some(model.metadata.black.clone()),
        result: Some(model.metadata.result.clone()),
        library_folder: Some(folder.clone().unwrap_or_default()),
        favorite: Some(favorite),
        tags: Some(tags.clone()),
    };
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_library_with_operation(game_id, folder.as_deref(), favorite, &tags, &operation)
        .map_err(|error| error.to_string())?;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
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
fn confirm_recognized_move(
    iccs: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    // Hold the resolution guard through validation and persistence. This makes
    // image replacement and successful confirmation mutually exclusive.
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    let binding = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        active_screenshot_resolution(&session)?
    };
    if binding.generation != state.link_capture_generation.load(Ordering::SeqCst) {
        return Err("图片识别结果已被新的截图替换，请重新核对上一着".into());
    }

    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    validate_screenshot_resolution_binding(&model, &binding)?;
    validate_screenshot_resolution_move(&binding, &iccs)?;
    validate_screenshot_move_confirmation(
        &model.board,
        mv,
        &binding.before_fen,
        binding.recognized_after_fen.as_deref(),
        binding.mode,
    )?;
    let board = commit_move(&mut model, &iccs)?;
    drop(model);

    // Consume the proposal only after the variation is stored. A second click
    // or a direct duplicate command must start a new image-recognition cycle.
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    invalidate_screenshot_move_resolution(&mut session);
    Ok(board)
}

#[tauri::command]
fn preview_line(fen: String, pv: Vec<String>) -> Result<Vec<PreviewLineStepDto>, String> {
    preview_line_steps(&fen, &pv)
}

#[tauri::command]
fn preview_recognized_move_from_current(
    iccs: String,
    state: State<'_, DesktopState>,
) -> Result<RecognizedLastMovePreviewDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let binding = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        active_screenshot_resolution(&session)?
    };
    if binding.mode != ScreenshotResolutionMode::ManualFallback
        || binding.generation != state.link_capture_generation.load(Ordering::SeqCst)
    {
        return Err("只有完整局面没有精确匹配时，才能手工点选上一着".into());
    }
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    validate_screenshot_resolution_binding(&model, &binding)
        .map_err(|_| "当前棋谱节点已变化，请重新选择图片后再手工点选".to_owned())?;
    if !model
        .board
        .legal_moves()
        .into_iter()
        .any(|candidate| candidate == mv)
    {
        return Err("这一步不符合当前棋谱局面的棋规，请重新点选起点和终点".into());
    }
    let preview = recognized_move_preview(&model.board, mv, "手工点选（当前棋谱合法着）", None)?;
    drop(model);
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    // Manual confirmation is restricted to the most recently previewed legal
    // endpoint pair. This still lets the child change their mind by selecting
    // a new pair, but never lets a client submit an unpreviewed ICCS string.
    session.screenshot_resolution_allowed_moves = vec![iccs];
    Ok(preview)
}

fn recognized_move_preview(
    before: &Board,
    mv: Move,
    recognition_source: &'static str,
    recognition_confidence: Option<u32>,
) -> Result<RecognizedLastMovePreviewDto, String> {
    let after = before.apply_move(mv).map_err(|error| error.to_string())?;
    let notation = before
        .chinese_move_notation(mv)
        .map_err(|error| error.to_string())?;
    Ok(RecognizedLastMovePreviewDto {
        step: PreviewLineStepDto {
            fen: after.to_fen(),
            notation,
            moved_by: side_label(before.side_to_move()),
            from: SquareDto {
                row: mv.from.row,
                col: mv.from.col,
            },
            to: SquareDto {
                row: mv.to.row,
                col: mv.to.col,
            },
            pieces: board_pieces(&after),
            status: game_status_label(after.status()),
        },
        before_fen: before.to_fen(),
        after_fen: after.to_fen(),
        side_to_move: side_label(after.side_to_move()),
        captured: before.would_capture(mv),
        marker_kind: Some("lastMove"),
        recognition_source: Some(recognition_source),
        recognition_confidence,
    })
}

fn position_placement_key(board: &Board) -> String {
    board
        .to_fen()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned()
}

/// Validates the final write at the same boundary that persists the variation.
/// Exact YOLO resolutions must reproduce the observed post-move placement;
/// manual fallback remains legal-only, but is still bound to the same current
/// tree node and image generation by the caller.
fn validate_screenshot_move_confirmation(
    before: &Board,
    mv: Move,
    expected_before_fen: &str,
    recognized_after_fen: Option<&str>,
    mode: ScreenshotResolutionMode,
) -> Result<(), String> {
    if before.to_fen() != expected_before_fen {
        return Err("截图对应的当前棋谱节点已变化。请先跳转到对应局面，或重新选择图片。".into());
    }
    let after = before.apply_move(mv).map_err(|error| error.to_string())?;
    if mode == ScreenshotResolutionMode::ExactPlacement {
        let recognized_after = recognized_after_fen
            .ok_or_else(|| "截图识别结果已失效，请重新选择图片".to_owned())
            .and_then(|value| Board::from_fen(value).map_err(|error| error.to_string()))?;
        if position_placement_key(&after) != position_placement_key(&recognized_after) {
            return Err(
                "该走法与本次截图识别出的完整局面不一致，已拒绝写入棋谱。请重新识别或手工点选。"
                    .into(),
            );
        }
    }
    Ok(())
}

/// Resolves a screenshot's previous move through one strict path:
///
/// 1. YOLO produces the complete *post-move* board placement.
/// 2. Every legal move from the current document is enumerated.
/// 3. Only moves whose resulting placement exactly equals the YOLO placement
///    survive. White source rings/destination halos may sort those survivors,
///    but can never introduce a candidate.
///
/// The result remains a proposal until the user explicitly writes it as a
/// variation. A no-match result intentionally falls back to manual endpoints.
#[tauri::command]
fn resolve_screenshot_move(
    state: State<'_, DesktopState>,
) -> Result<ScreenshotMoveResolutionDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    // The only FEN permitted here is the one recorded by the image-recognition
    // session. The UI receives it for display, but cannot feed it back to
    // manufacture a candidate from a different post-move position.
    let (recognized_after_fen, marker, orientation, generation, source) = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        (
            session.latest_fen.clone(),
            session.screenshot_move_marker,
            session.board_orientation,
            session.capture_generation,
            session.source,
        )
    };
    if !matches!(
        source,
        CaptureSource::ImageImport | CaptureSource::CameraBoard
    ) {
        return Err("请先选择截图或照片进行识别".into());
    }
    if generation != state.link_capture_generation.load(Ordering::SeqCst) {
        return Err("图片识别结果已失效，请重新选择图片".into());
    }
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let before = model.board.clone();
    let resolution_game_id = model.game_id;
    let resolution_current_node = model.current_node;
    drop(model);

    let mut resolution = match recognized_after_fen {
        Some(fen) => match Board::from_fen(&fen) {
            Ok(recognized_after) => {
                resolve_screenshot_move_from_board(&before, &recognized_after, marker, orientation)?
            }
            Err(_) => manual_screenshot_move_resolution(
                &before,
                orientation,
                "图片完整局面已失效，无法自动匹配上一着；请手工点起点和终点。",
            ),
        },
        None => manual_screenshot_move_resolution(
            &before,
            orientation,
            "未能可靠识别完整棋盘局面；白色圈和底光不能单独推断走法，请手工点起点和终点。",
        ),
    };
    // The fallback must never accidentally retain candidates from a previous
    // image. Its board is always the current manual-tree position.
    resolution.current_pieces = board_pieces(&before);
    resolution.current_side_to_move = side_label(before.side_to_move());

    let mode = if resolution.status == "noExactMatch" {
        ScreenshotResolutionMode::ManualFallback
    } else {
        ScreenshotResolutionMode::ExactPlacement
    };
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if session.capture_generation != generation
        || !matches!(
            session.source,
            CaptureSource::ImageImport | CaptureSource::CameraBoard
        )
    {
        return Err("图片识别结果已被新的截图替换，请重新选择图片".into());
    }
    session.screenshot_resolution_before_fen = Some(before.to_fen());
    session.screenshot_resolution_generation = Some(generation);
    session.screenshot_resolution_mode = Some(mode);
    session.screenshot_resolution_game_id = Some(resolution_game_id);
    session.screenshot_resolution_current_node = Some(resolution_current_node);
    session.screenshot_resolution_allowed_moves = resolution
        .candidates
        .iter()
        .map(|candidate| {
            Move {
                from: Square {
                    row: candidate.step.from.row,
                    col: candidate.step.from.col,
                },
                to: Square {
                    row: candidate.step.to.row,
                    col: candidate.step.to.col,
                },
            }
            .to_iccs()
        })
        .collect();
    Ok(resolution)
}

fn manual_screenshot_move_resolution(
    before: &Board,
    orientation: BoardOrientation,
    reason: impl Into<String>,
) -> ScreenshotMoveResolutionDto {
    ScreenshotMoveResolutionDto {
        status: "noExactMatch",
        candidates: Vec::new(),
        orientation,
        current_pieces: board_pieces(before),
        current_side_to_move: side_label(before.side_to_move()),
        reason: Some(reason.into()),
    }
}

fn resolve_screenshot_move_from_board(
    before: &Board,
    recognized_after: &Board,
    marker: Option<link_vision::ScreenshotMoveMarker>,
    orientation: BoardOrientation,
) -> Result<ScreenshotMoveResolutionDto, String> {
    let target = position_placement_key(recognized_after);
    let mut exact_candidates = before
        .legal_moves()
        .into_iter()
        .filter_map(|mv| {
            let after = before.apply_move(mv).ok()?;
            (position_placement_key(&after) == target).then_some((mv, after))
        })
        .map(|(mv, after)| {
            let marker_score = marker
                .as_ref()
                .map(|item| {
                    let from = item
                        .from
                        .map(|square| (square == mv.from) as u32 * item.from_confidence)
                        .unwrap_or_default();
                    let to = item
                        .to
                        .map(|square| (square == mv.to) as u32 * item.to_confidence)
                        .unwrap_or_default();
                    from.saturating_add(to)
                })
                .unwrap_or_default();
            (mv, after, marker_score)
        })
        .collect::<Vec<_>>();

    // Sorting is deliberately after exact placement filtering. Tie-breaking by
    // ICCS keeps an ambiguous result stable when the screenshot has no markers.
    exact_candidates.sort_by(|left, right| {
        right
            .2
            .cmp(&left.2)
            .then_with(|| left.0.to_iccs().cmp(&right.0.to_iccs()))
    });
    exact_candidates.truncate(3);

    let candidates = exact_candidates
        .into_iter()
        .map(|(mv, _after, marker_score)| {
            recognized_move_preview(
                before,
                mv,
                "YOLO完整局面与当前棋谱合法一步匹配",
                (marker_score > 0).then_some(marker_score),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let (status, reason) = match candidates.len() {
        0 => (
            "noExactMatch",
            Some(
                "识别到的完整局面与当前棋谱没有合法的一步衔接。白色圈和底光只作排序证据，不能单独推断走法；请手工点起点和终点。".into(),
            ),
        ),
        1 => ("unique", None),
        _ => (
            "ambiguous",
            Some("完整局面存在多个合法一步匹配，请选择后再确认写入变例。".into()),
        ),
    };
    Ok(ScreenshotMoveResolutionDto {
        status,
        candidates,
        orientation,
        current_pieces: board_pieces(before),
        current_side_to_move: side_label(before.side_to_move()),
        reason,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChineseLineParseDto {
    moves: Vec<String>,
    steps: Vec<PreviewLineStepDto>,
}

#[tauri::command]
fn parse_chinese_line(fen: String, notation: Vec<String>) -> Result<ChineseLineParseDto, String> {
    let mut board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let mut moves = Vec::with_capacity(notation.len());
    for (index, input) in notation.iter().enumerate() {
        let expected = normalize_chinese_move_text(input);
        if expected.is_empty() {
            return Err(format!("第 {} 步中文着法为空", index + 1));
        }
        let matches = board
            .legal_moves()
            .into_iter()
            .filter(|mv| {
                board
                    .chinese_move_notation(*mv)
                    .map(|value| normalize_chinese_move_text(&value) == expected)
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        let mv = match matches.as_slice() {
            [mv] => *mv,
            [] => {
                return Err(format!(
                    "第 {} 步“{}”不是当前局面的合法中文着法",
                    index + 1,
                    input.trim()
                ));
            }
            _ => {
                return Err(format!(
                    "第 {} 步“{}”存在歧义，请在棋盘上走出该步",
                    index + 1,
                    input.trim()
                ));
            }
        };
        moves.push(mv.to_iccs());
        board = board
            .apply_move(mv)
            .map_err(|error| format!("第 {} 步非法：{error}", index + 1))?;
    }
    let steps = preview_line_steps(&fen, &moves)?;
    Ok(ChineseLineParseDto { moves, steps })
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
    let _ = sync_current_game_mirror(model);
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
    let game_id = model.game_id;
    let payload = UpdateGameMetadataPayload {
        title: model.metadata.title.clone(),
        note: model.note.clone(),
        event: Some(model.metadata.event.clone()),
        site: Some(model.metadata.site.clone()),
        date: Some(model.metadata.date.clone()),
        red: Some(model.metadata.red.clone()),
        black: Some(model.metadata.black.clone()),
        result: Some(model.metadata.result.clone()),
        library_folder: Some("比赛复盘".into()),
        favorite: Some(false),
        tags: Some(Vec::new()),
    };
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_library_with_operation(game_id, Some("比赛复盘"), false, &[], &operation)
        .map_err(|error| error.to_string())?;
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
fn import_eleeye_opening_book(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let target = PathBuf::from(&path);
    eleeye_opening_book::validate(&target)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences
        .eleeye_book_paths
        .iter()
        .any(|existing| existing == &path)
    {
        preferences.eleeye_book_paths.push(path);
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
    if !matches!(
        target.extension().and_then(|extension| extension.to_str()),
        Some("txt" | "pgn")
    ) {
        return Err("文本导出文件必须使用 .txt 或 .pgn 扩展名".into());
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
    let _ = sync_current_game_mirror(&mut model);
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
    let _ = sync_current_game_mirror(&mut model);
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
    let _ = sync_current_game_mirror(&mut model);
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
    let _ = sync_current_game_mirror(&mut model);
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
    let _ = sync_current_game_mirror(&mut model);
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
    let (label, title, width, height, min_width, min_height, position) = match panel.as_str() {
        "engine" => (
            "compact-engine",
            "引擎分析",
            420.0,
            460.0,
            340.0,
            260.0,
            None,
        ),
        "manual" => ("compact-manual", "棋谱", 430.0, 580.0, 360.0, 320.0, None),
        "cloud" => (
            "compact-cloud",
            "云库 / 评估信息",
            520.0,
            640.0,
            360.0,
            320.0,
            None,
        ),
        "link" => (
            "compact-link",
            "连线控制",
            340.0,
            620.0,
            270.0,
            340.0,
            Some((16.0, 88.0)),
        ),
        _ => return Err("未知的浮动面板".into()),
    };
    if let Some(window) = app.get_webview_window(label) {
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_resizable(true)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
                min_width, min_height,
            ))))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(false);
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?floatingPanel={panel}").into()),
    )
    .title(format!("Xiangqi Studio · {title}"))
    .inner_size(width, height)
    .min_inner_size(min_width, min_height)
    .resizable(true)
    .decorations(true)
    .always_on_top(true);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    builder.build().map_err(|error| error.to_string())?;

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
        return Err("内置 Fairy-Stockfish 已从安装包移除；如需对比，请在引擎设置中手动导入外部 Fairy-Stockfish".into());
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
        state.engine.lock().await.clear();
        emit_engine_state(&app, EngineRuntimeState::Idle);
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

fn repo_root_from_manifest() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn default_master_style_dir() -> PathBuf {
    repo_root_from_manifest()
        .join(".theory-work")
        .join("master-style")
}

fn master_style_seed_candidates(base: &Path) -> Vec<PathBuf> {
    ["master-style", "resources/master-style"]
        .into_iter()
        .map(|relative| base.join(relative))
        .collect()
}

fn bundled_master_style_seed_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
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

fn read_jsonl_values(path: &Path) -> Result<Vec<serde_json::Value>, String> {
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

fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn json_i64(value: &serde_json::Value, key: &str) -> Option<i64> {
    value.get(key).and_then(serde_json::Value::as_i64)
}

fn json_bool(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn normalized_player_name(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

fn stable_master_style_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"|");
    }
    format!("{:x}", hasher.finalize())[..24].to_owned()
}

fn master_style_analysis_by_sample_id(
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

fn imported_master_style_profiles_from_files(
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

fn ensure_builtin_master_style_seed(
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
const TRAINING_SYSTEM_SOURCE_URL: &str = "https://mp.weixin.qq.com/s/x0jQq9Re8G_aGoTlk9N59w";

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

fn training_system_seed_cards() -> Vec<ImportedTheoryCard> {
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

fn ensure_training_system_seed(store: &mut LocalStore) -> Result<(), String> {
    for card in training_system_seed_cards() {
        store
            .upsert_imported_theory_card(&card)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn import_master_style_profile(
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
fn list_master_style_profiles(
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
fn match_master_style_hints(
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
    if preferences.engine_path == BUILTIN_FAIRY_ENGINE_PATH {
        preferences.engine_path = BUILTIN_ENGINE_PATH.into();
        preferences.active_engine_id = None;
    }
    preferences.board_skin = normalize_skin_id(&preferences.board_skin);
    preferences.piece_skin = normalize_skin_id(&preferences.piece_skin);
    preferences
        .parallel_engine_paths
        .retain(|path| path == BUILTIN_ENGINE_PATH);
    preferences.parallel_engine_paths.sort();
    preferences.parallel_engine_paths.dedup();
    preferences.rule_mode = normalize_rule_mode(&preferences.rule_mode);
    preferences.active_builtin_opening_book_id =
        pfbook_opening_book::normalize_book_id(&preferences.active_builtin_opening_book_id);
}

fn normalize_skin_id(value: &str) -> String {
    match value {
        "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun" => value.to_owned(),
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
        && !matches!(preferences.engine_path.as_str(), BUILTIN_ENGINE_PATH)
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
fn list_builtin_opening_books() -> Result<pfbook_opening_book::BuiltinOpeningBookManifestDto, String>
{
    pfbook_opening_book::manifest()
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

fn flyknife_templates() -> Vec<FlyknifeTemplateDto> {
    const ITEMS: [(&str, &str, &[&str]); 10] = [
        (
            "zhongpao-pingfeng",
            "中炮对屏风马",
            &["h2e2", "h9g7", "b2c4", "b7c7"],
        ),
        ("zhongpao-zhongpao", "中炮对中炮", &["h2e2", "h7e7"]),
        ("xianren-zu-di-pao", "仙人指路对卒底炮", &["a3a4", "b7b3"]),
        ("xianren-fei-xiang", "仙人指路对飞象", &["a3a4", "c9e7"]),
        ("fei-xiang-juzhong", "飞相局", &["c0e2", "h9g7"]),
        ("guogongpao", "过宫炮", &["b2e2", "h9g7"]),
        ("shunshou-pao", "顺手炮", &["h2e2", "h7e7"]),
        ("lie-shou-pao", "列手炮", &["h2e2", "b7e7"]),
        ("dan-ti-ma", "单提马", &["b0c2", "h9g7"]),
        ("bian-ma", "边马局", &["b0a2", "h9g7"]),
    ];
    ITEMS
        .into_iter()
        .filter_map(|(id, name, moves)| {
            let board = moves
                .iter()
                .try_fold(Board::from_fen(STARTING_FEN).ok()?, |board, iccs| {
                    board.apply_iccs(iccs).ok()
                })?;
            Some(FlyknifeTemplateDto {
                id,
                name,
                moves: moves.iter().map(|item| (*item).into()).collect(),
                fen: board.to_fen(),
            })
        })
        .collect()
}

const FLYKNIFE_TOPICS: [(&str, &str, &str, &str, &str, &str, usize); 12] = [
    (
        "xianren-zudi-pao-1",
        "34仙人指路对卒底炮（一）",
        "仙人指路对卒底炮",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6535.html",
        "01-34仙人指路对卒底炮-一.pgn",
        12,
    ),
    (
        "xianren-zudi-pao-2",
        "35仙人指路对卒底炮（二）",
        "仙人指路对卒底炮",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6534.html",
        "02-35仙人指路对卒底炮-二.pgn",
        9,
    ),
    (
        "ma-ru-gui-xin",
        "02马入归心，化凶为吉",
        "中炮类战术",
        "布局陷阱",
        "https://mp.xiangqiqipu.com/Category/View-6497.html",
        "03-02马入归心-化凶为吉.pgn",
        32,
    ),
    (
        "zhang-wang-yi-dai",
        "21张网以待，中计败北",
        "中炮类战术",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6457.html",
        "04-21张网以待-中计败北.pgn",
        26,
    ),
    (
        "xianshou-pingfeng-vs-zhongpao",
        "02先手屏风马对中炮局",
        "屏风马对中炮",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6571.html",
        "05-02先手屏风马对中炮局.pgn",
        18,
    ),
    (
        "pingfeng-po-guoheche",
        "15屏风马破中炮过河车",
        "屏风马破过河车",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6558.html",
        "06-15屏风马破中炮过河车.pgn",
        16,
    ),
    (
        "shunpao-qima-fengsuo",
        "27顺炮弃马破单边封锁局",
        "顺炮弃马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6546.html",
        "07-27顺炮弃马破单边封锁局.pgn",
        31,
    ),
    (
        "zhongpao-guoheche-pingfeng",
        "03中炮过河车对屏风马局",
        "中炮过河车对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6570.html",
        "08-03中炮过河车对屏风马局.pgn",
        12,
    ),
    (
        "xianren-qizu",
        "31仙人指路对弃卒局",
        "仙人指路对弃卒",
        "布局陷阱",
        "https://mp.xiangqiqipu.com/Category/View-6538.html",
        "09-31仙人指路对弃卒局.pgn",
        16,
    ),
    (
        "zhongpao-shuangpao-guohe",
        "24中炮对屏风马双炮过河",
        "中炮对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6549.html",
        "10-24中炮对屏风马双炮过河.pgn",
        16,
    ),
    (
        "zuoma-panhe",
        "25中炮过河车对屏风马左马盘河",
        "中炮过河车对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6548.html",
        "11-25中炮过河车对屏风马左马盘河.pgn",
        10,
    ),
    (
        "shunpao-hengche-shijiaopao",
        "42顺炮横车攻先补士角炮局",
        "顺炮横车",
        "布局陷阱",
        "https://source.xiangqiqipu.com/Category/View-6527.html",
        "12-42顺炮横车攻先补士角炮局.pgn",
        21,
    ),
];

fn flyknife_topics() -> Vec<FlyknifeTopicDto> {
    FLYKNIFE_TOPICS
        .iter()
        .map(
            |(id, title, opening, category, source, _filename, move_count)| FlyknifeTopicDto {
                id: *id,
                title: *title,
                opening: *opening,
                category: *category,
                source: *source,
                move_count: *move_count,
            },
        )
        .collect()
}

fn flyknife_topic_file_name(id: &str) -> Option<&'static str> {
    FLYKNIFE_TOPICS
        .iter()
        .find(|(topic_id, ..)| *topic_id == id)
        .map(|(_, _, _, _, _, filename, _)| *filename)
}

fn flyknife_topic_candidates(resource_dir: &Path, filename: &str) -> Vec<PathBuf> {
    vec![
        resource_dir
            .join("resources/flyknife-library/single-pgn")
            .join(filename),
        resource_dir
            .join("flyknife-library/single-pgn")
            .join(filename),
    ]
}

fn resolve_flyknife_topic_path(app: &tauri::AppHandle, filename: &str) -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = vec![
        manifest_dir
            .join("resources/flyknife-library/single-pgn")
            .join(filename),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(flyknife_topic_candidates(&resource_dir, filename));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[tauri::command]
fn list_flyknife_topics() -> Vec<FlyknifeTopicDto> {
    flyknife_topics()
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只能打开 http 或 https 来源地址".into());
    }
    #[cfg(target_os = "macos")]
    let status = ProcessCommand::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = ProcessCommand::new("cmd")
        .args(["/C", "start", "", &url])
        .status();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = ProcessCommand::new("xdg-open").arg(&url).status();
    status
        .map_err(|error| format!("无法调用系统浏览器：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "系统浏览器未能打开该来源".into())
}

#[tauri::command]
fn open_flyknife_topic(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let filename = flyknife_topic_file_name(&id).ok_or("飞刀专题不存在")?;
    let path = resolve_flyknife_topic_path(&app, filename)
        .ok_or_else(|| format!("飞刀专题资源不存在：{filename}"))?;
    let bytes = std::fs::read(&path).map_err(|error| format!("读取飞刀专题失败：{error}"))?;
    let document =
        import_document(&bytes, Some(ManualFormat::Pgn)).map_err(|error| error.to_string())?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(path.to_string_lossy().into_owned()),
        Some("flyknife-topic".into()),
    )?;
    board_dto(&model)
}

fn normalize_chinese_move_text(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter_map(|character| match character {
            ' ' | '\t' | '\n' | '\r' | '-' | '－' => None,
            '０' => Some('0'),
            '１' | '一' => Some('1'),
            '２' | '二' => Some('2'),
            '３' | '三' => Some('3'),
            '４' | '四' => Some('4'),
            '５' | '五' => Some('5'),
            '６' | '六' => Some('6'),
            '７' | '七' => Some('7'),
            '８' | '八' => Some('8'),
            '９' | '九' => Some('9'),
            '車' => Some('车'),
            '馬' => Some('马'),
            '砲' => Some('炮'),
            '帥' => Some('帅'),
            '將' => Some('将'),
            '進' => Some('进'),
            character => Some(character),
        })
        .collect()
}

fn resolve_flyknife_lure(board: &Board, value: &str) -> Result<String, String> {
    let input = value.trim();
    if board.apply_iccs(input).is_ok() {
        return Ok(input.to_owned());
    }
    let expected = normalize_chinese_move_text(input);
    let matches: Vec<_> = board
        .legal_moves()
        .into_iter()
        .filter(|mv| {
            board
                .chinese_move_notation(*mv)
                .map(|notation| normalize_chinese_move_text(&notation) == expected)
                .unwrap_or(false)
        })
        .collect();
    match matches.as_slice() {
        [mv] => Ok(mv.to_iccs()),
        [] => Err(format!("“{input}”不是当前局面的合法中文着法")),
        _ => Err(format!("“{input}”存在歧义，请从候选着法中选择")),
    }
}

fn chinese_color_name(color: Color) -> &'static str {
    match color {
        Color::Red => "红方",
        Color::Black => "黑方",
    }
}

fn prepare_flyknife_position(
    before: &Board,
    requested: Color,
    setup_value: &str,
    lure_value: &str,
) -> Result<(String, String, Board, Board), String> {
    let input_setup = setup_value.trim();
    let input_lure = lure_value.trim();
    if !input_setup.is_empty() {
        if before.side_to_move() != requested {
            return Err(format!(
                "当前局面轮到{}行棋；不能由{}先设局",
                chinese_color_name(before.side_to_move()),
                chinese_color_name(requested)
            ));
        }
        if input_lure.is_empty() {
            return Err("设局飞刀需要填写对手的常见应手".into());
        }
        let setup_move = resolve_flyknife_lure(before, input_setup)?;
        let after_setup = before
            .apply_iccs(&setup_move)
            .map_err(|_| "预埋第一手不是起始局面的合法着法".to_string())?;
        let lure_move = resolve_flyknife_lure(&after_setup, input_lure)?;
        let after_lure = after_setup
            .apply_iccs(&lure_move)
            .map_err(|_| "对手应手不是预埋局面的合法着法".to_string())?;
        if after_lure.side_to_move() != requested {
            return Err("对手应手后未轮到设局方出刀，请检查着法顺序".into());
        }
        return Ok((setup_move, lure_move, after_setup, after_lure));
    }
    if input_lure.is_empty() {
        if before.side_to_move() != requested {
            return Err(format!(
                "当前局面轮到{}行棋；若要让{}出刀，请先填写一手对手诱导着法",
                chinese_color_name(before.side_to_move()),
                chinese_color_name(requested)
            ));
        }
        return Ok((String::new(), String::new(), before.clone(), before.clone()));
    }
    let lure_move = resolve_flyknife_lure(before, input_lure)?;
    let after_lure = before
        .apply_iccs(&lure_move)
        .map_err(|_| "诱导着法不是起始局面的合法着法".to_string())?;
    if after_lure.side_to_move() != requested {
        return Err(format!(
            "诱导着后轮到{}行棋，不是{}出刀；请调整出刀方或换一手诱导着",
            chinese_color_name(after_lure.side_to_move()),
            chinese_color_name(requested)
        ));
    }
    Ok((String::new(), lure_move, before.clone(), after_lure))
}

fn flyknife_best_defense_notation(
    starting_fen: &str,
    mainline: &[String],
    knife_move: &str,
    best_defense: &[String],
) -> Vec<String> {
    let Some(knife_index) = mainline
        .iter()
        .position(|move_text| move_text == knife_move)
    else {
        return Vec::new();
    };
    let mut board = match Board::from_fen(starting_fen) {
        Ok(board) => board,
        Err(_) => return Vec::new(),
    };
    for move_text in &mainline[..=knife_index] {
        match board.apply_iccs(move_text) {
            Ok(next) => board = next,
            Err(_) => return Vec::new(),
        }
    }
    board.chinese_pv_notation(best_defense).unwrap_or_default()
}

fn flyknife_step_annotations(
    starting_fen: &str,
    attacker: Color,
    setup_move: Option<&str>,
    lure_move: &str,
    knife_move: &str,
    mainline: &[String],
    best_defense: &[String],
    score_cp: Option<i64>,
    swing_cp: Option<i64>,
) -> Vec<FlyknifeStepAnnotationDto> {
    let mut board = match Board::from_fen(starting_fen) {
        Ok(board) => board,
        Err(_) => return Vec::new(),
    };
    let setup = setup_move.filter(|value| !value.is_empty());
    let defense = best_defense.first().map(String::as_str);
    let knife_index = mainline.iter().position(|value| value == knife_move);
    let attacker_label = if attacker == Color::Red {
        "红方"
    } else {
        "黑方"
    };
    let defender_label = if attacker == Color::Red {
        "黑方"
    } else {
        "红方"
    };

    mainline.iter().enumerate().filter_map(|(index, move_text)| {
        let mover = if board.side_to_move() == Color::Red { "红方" } else { "黑方" };
        let notation = board
            .chinese_pv_notation(std::slice::from_ref(move_text))
            .ok()
            .and_then(|items| items.into_iter().next())
            .unwrap_or_else(|| move_text.clone());
        let role = if setup == Some(move_text.as_str()) {
            Some("setup")
        } else if !lure_move.is_empty() && move_text == lure_move {
            Some("lure")
        } else if move_text == knife_move {
            Some("knife")
        } else if defense == Some(move_text.as_str()) && knife_index.is_some_and(|knife| index > knife) {
            Some("bestDefense")
        } else {
            None
        };
        let next = board.apply_iccs(move_text).ok()?;
        board = next;
        let role = role?;
        let intent = match role {
            "setup" => format!("{attacker_label}先走“{notation}”完成设局，等待对方出现预定应手；这一步本身不等于已经得分。"),
            "lure" => format!("{defender_label}走“{notation}”后，中刀条件成立，轮到{attacker_label}执行预先验证的反击。"),
            "knife" => match score_cp {
                Some(score) if score >= 100 => format!("{attacker_label}以“{notation}”出刀。引擎验证此处形成明显主动，出刀后为 {:+.2} 分。", score as f64 / 100.0),
                Some(score) => format!("{attacker_label}以“{notation}”反击；当前为 {:+.2} 分，属于研究候选，仍需核对最佳防守。", score as f64 / 100.0),
                None => format!("{attacker_label}以“{notation}”反击；分值尚未稳定，需继续提高引擎深度确认。"),
            },
            "bestDefense" => format!("{defender_label}以“{notation}”进行较强防守。这不是中刀线，而是检验该方案风险与可行性的参考应对。"),
            _ => String::new(),
        };
        Some(FlyknifeStepAnnotationDto {
            role: role.into(), iccs: move_text.clone(), notation, side: mover.into(), fen: Some(board.to_fen()),
            score_cp: (role == "knife").then_some(score_cp).flatten(),
            swing_cp: (role == "knife").then_some(swing_cp).flatten(),
            intent, note: None,
        })
    }).collect()
}

#[tauri::command]
async fn generate_flyknife_candidates(
    request: GenerateFlyknifeRequest,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Vec<FlyknifeCandidateDto>, String> {
    let before = Board::from_fen(&request.starting_fen).map_err(|error| error.to_string())?;
    let requested = match request.side.as_str() {
        "red" => Color::Red,
        "black" => Color::Black,
        _ => return Err("飞刀执方必须为红方或黑方".into()),
    };
    let (setup_move, lure_move, before_lure, after_lure) = prepare_flyknife_position(
        &before,
        requested,
        request.setup_move.as_deref().unwrap_or_default(),
        &request.lure_move,
    )?;
    let setup_notation = if setup_move.is_empty() {
        None
    } else {
        before
            .chinese_pv_notation(std::slice::from_ref(&setup_move))
            .ok()
            .and_then(|items| items.into_iter().next())
    };
    let lure_notation = if lure_move.is_empty() {
        None
    } else {
        let lure_position = if setup_move.is_empty() {
            before.clone()
        } else {
            before
                .apply_iccs(&setup_move)
                .map_err(|error| error.to_string())?
        };
        lure_position
            .chinese_pv_notation(std::slice::from_ref(&lure_move))
            .ok()
            .and_then(|items| items.into_iter().next())
    };
    // The cloud book tells us whether an opponent reply is common. The engine alone
    // establishes whether that reply actually loses ground for the attacking side.
    let baseline_score_cp = if lure_move.is_empty() {
        None
    } else {
        let baseline = analyze_position(
            request.engine_path.clone(),
            None,
            Some("飞刀条件基准".into()),
            None,
            before_lure.to_fen(),
            request.search_mode.clone(),
            request.search_value,
            request.threads,
            request.hash_mb,
            1,
            Vec::new(),
            None,
            app.clone(),
            state.clone(),
        )
        .await?;
        // At this point it is the defender's turn. Convert the UCI score to the
        // requested attacker's perspective so both numbers can be compared directly.
        baseline
            .first()
            .and_then(|line| line.score_cp)
            .map(|score| -i64::from(score))
    };
    let lines = analyze_position(
        request.engine_path,
        None,
        Some("飞刀验证".into()),
        None,
        after_lure.to_fen(),
        request.search_mode,
        request.search_value,
        request.threads,
        request.hash_mb,
        3,
        Vec::new(),
        None,
        app,
        state,
    )
    .await?;
    let mut unique = std::collections::BTreeSet::new();
    Ok(lines
        .into_iter()
        .filter_map(|line| {
            let knife_move = line.pv.first()?.clone();
            if !unique.insert(knife_move.clone()) {
                return None;
            }
            let score = line.score_cp;
            let score_cp = score.map(i64::from);
            let swing_cp = score_cp
                .zip(baseline_score_cp)
                .map(|(after, before)| after - before);
            // UCI/Pikafish scores are from the side-to-move perspective. After the lure that
            // side is the requested attacker, regardless of whether it is red or black.
            let favorable =
                score.is_some_and(|value| value >= 100) || line.mate.is_some_and(|value| value > 0);
            let best_defense: Vec<String> = line.pv.iter().skip(1).take(4).cloned().collect();
            let notation = after_lure.chinese_pv_notation(&line.pv).unwrap_or_default();
            let best_defense_notation = after_lure
                .apply_iccs(&knife_move)
                .and_then(|board| board.chinese_pv_notation(&best_defense))
                .unwrap_or_default();
            let full_line = (!setup_move.is_empty())
                .then(|| setup_move.clone())
                .into_iter()
                .chain((!lure_move.is_empty()).then(|| lure_move.clone()))
                .chain(line.pv.iter().cloned())
                .collect::<Vec<_>>();
            let annotations = flyknife_step_annotations(
                &request.starting_fen,
                requested,
                (!setup_move.is_empty()).then_some(setup_move.as_str()),
                &lure_move,
                &knife_move,
                &full_line,
                &best_defense,
                score_cp,
                swing_cp,
            );
            Some(FlyknifeCandidateDto {
                setup_move: (!setup_move.is_empty()).then(|| setup_move.clone()),
                setup_notation: setup_notation.clone(),
                lure_move: lure_move.clone(),
                lure_notation: lure_notation.clone(),
                knife_move,
                mainline: line.pv,
                notation,
                best_defense,
                best_defense_notation,
                score_cp,
                baseline_score_cp,
                swing_cp,
                mate: line.mate.map(i64::from),
                risk: if lure_move.is_empty() {
                    if favorable {
                        "局面强招：当前轮可取得明显主动；这不是预埋飞刀。".into()
                    } else {
                        "局面候选：引擎未确认明显优势，适合继续研究。".into()
                    }
                } else if favorable {
                    "实战可用：对常见应手形成主动攻势；已附引擎主变中的最佳防守。".into()
                } else {
                    "反击候选：引擎未确认明显优势，适合练习和人工复核。".into()
                },
                annotations,
            })
        })
        .take(3)
        .collect())
}

#[tauri::command]
fn list_flyknife_templates() -> Vec<FlyknifeTemplateDto> {
    flyknife_templates()
}

#[tauri::command]
fn list_flyknife_plans(state: State<'_, DesktopState>) -> Result<Vec<FlyknifePlanDto>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .flyknife_plans()
        .map(|plans| plans.into_iter().map(Into::into).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_flyknife_plan(
    plan: FlyknifePlanDto,
    state: State<'_, DesktopState>,
) -> Result<FlyknifePlanDto, String> {
    if !matches!(plan.side.as_str(), "red" | "black") {
        return Err("飞刀执方必须为红方或黑方".into());
    }
    let mut board = Board::from_fen(&plan.starting_fen).map_err(|error| error.to_string())?;
    let is_starting_position = plan.mainline.is_empty()
        && plan.lure_move.trim().is_empty()
        && plan.knife_move.trim().is_empty();
    let line = if is_starting_position {
        Vec::new()
    } else if plan.mainline.is_empty() {
        vec![plan.lure_move.clone(), plan.knife_move.clone()]
    } else {
        plan.mainline.clone()
    };
    for iccs in &line {
        board = board
            .apply_iccs(iccs)
            .map_err(|_| format!("飞刀主线包含非法着法：{iccs}"))?;
    }
    let id = plan.id.unwrap_or_else(Uuid::new_v4);
    let annotations = if plan.annotations.is_empty() {
        let attacker = if plan.side == "red" {
            Color::Red
        } else {
            Color::Black
        };
        flyknife_step_annotations(
            &plan.starting_fen,
            attacker,
            None,
            &plan.lure_move,
            &plan.knife_move,
            &line,
            &plan.best_defense,
            plan.score_cp,
            None,
        )
        .into_iter()
        .map(Into::into)
        .collect()
    } else {
        plan.annotations.into_iter().map(Into::into).collect()
    };
    let mut stored = FlyknifePlan {
        id,
        title: plan.title.trim().to_owned(),
        side: plan.side.clone(),
        starting_fen: plan.starting_fen.clone(),
        template_id: plan.template_id.clone(),
        template_name: plan.template_name.trim().to_owned(),
        lure_move: plan.lure_move.clone(),
        knife_move: plan.knife_move.clone(),
        mainline: line,
        best_defense: plan.best_defense.clone(),
        score_cp: plan.score_cp,
        mate: plan.mate,
        risk: plan.risk.clone(),
        source_game_id: None,
        source_node_id: None,
        note: plan.note.clone(),
        annotations,
        created_at: Utc::now().to_rfc3339(),
    };
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let source_matches_current = model.board.to_fen() == stored.starting_fen;
    if source_matches_current && !stored.mainline.is_empty() {
        stored.source_game_id = Some(model.game_id);
        stored.source_node_id = model.current_node;
    }
    model
        .store
        .save_flyknife_plan(&stored)
        .map_err(|error| error.to_string())?;
    if source_matches_current {
        let original_board = model.board.clone();
        let original_node = model.current_node;
        let mut first_node = None;
        let mut committed_nodes = Vec::new();
        for iccs in &stored.mainline {
            let _ = commit_move(&mut model, iccs)?;
            if first_node.is_none() {
                first_node = model.current_node;
            }
            if let Some(node_id) = model.current_node {
                committed_nodes.push((node_id, iccs.clone()));
            }
        }
        if first_node.is_some() {
            let notation = Board::from_fen(&stored.starting_fen)
                .and_then(|board| board.chinese_pv_notation(&stored.mainline))
                .unwrap_or_else(|_| stored.mainline.clone());
            let best_defense = flyknife_best_defense_notation(
                &stored.starting_fen,
                &stored.mainline,
                &stored.knife_move,
                &stored.best_defense,
            );
            let summary = format!(
                "飞刀方案：{}\n执方：{}\n诱导：{}\n主变：{}\n最佳防守：{}\n风险：{}\n{}",
                stored.title,
                if stored.side == "red" {
                    "红方"
                } else {
                    "黑方"
                },
                stored.lure_move,
                notation.join(" "),
                if best_defense.is_empty() {
                    "引擎未给出后续".into()
                } else {
                    best_defense.join(" ")
                },
                stored.risk,
                stored.note,
            );
            for (index, (comment_node_id, iccs)) in committed_nodes.iter().enumerate() {
                let annotation = stored.annotations.iter().find(|item| item.iccs == *iccs);
                let annotation_block = annotation.map(|item| {
                    format!(
                        "【飞刀标注】\n阶段：{}\n意图：{}\n分值：{}{}\n【/飞刀标注】",
                        item.role,
                        item.note
                            .as_deref()
                            .filter(|note| !note.trim().is_empty())
                            .unwrap_or(&item.intent),
                        item.score_cp
                            .map(|score| format!("{:+.2} 分", score as f64 / 100.0))
                            .unwrap_or_else(|| "待确认".into()),
                        item.swing_cp
                            .map(|swing| format!(" · 变化 {:+.2} 分", swing as f64 / 100.0))
                            .unwrap_or_default(),
                    )
                });
                let comment = [
                    if index == 0 {
                        Some(summary.clone())
                    } else {
                        None
                    },
                    annotation_block,
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("\n");
                let mut tree = model.tree.clone();
                tree.update_comment(*comment_node_id, comment.clone())
                    .map_err(|error| error.to_string())?;
                let operation = next_operation(
                    &mut model,
                    *comment_node_id,
                    OperationKind::UpdateComment,
                    serde_json::to_value(UpdateCommentPayload {
                        node_id: *comment_node_id,
                        comment: comment.clone(),
                    })
                    .map_err(|error| error.to_string())?,
                );
                model
                    .store
                    .update_comment_with_operation(*comment_node_id, &comment, &operation)
                    .map_err(|error| error.to_string())?;
                model.tree = tree;
            }
        }
        model.board = original_board;
        model.current_node = original_node;
        let game_id = model.game_id;
        model
            .store
            .set_current_node(game_id, original_node)
            .map_err(|error| error.to_string())?;
        let _ = sync_current_game_mirror(&mut model);
    }
    Ok(stored.into())
}

#[tauri::command]
fn delete_flyknife_plan(id: Uuid, state: State<'_, DesktopState>) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .delete_flyknife_plan(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_flyknife_practice(id: Uuid, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let plan = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .flyknife_plans()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|plan| plan.id == id)
        .ok_or("飞刀方案不存在")?;
    let mut document =
        ManualDocument::new(plan.starting_fen.clone()).map_err(|error| error.to_string())?;
    let best_defense = flyknife_best_defense_notation(
        &plan.starting_fen,
        &plan.mainline,
        &plan.knife_move,
        &plan.best_defense,
    );
    document.metadata.title = format!("飞刀练习 · {}", plan.title);
    document.note = format!(
        "飞刀练习\n执方：{}\n诱导：{}\n出刀：{}\n最佳防守：{}\n风险：{}\n{}",
        if plan.side == "red" {
            "红方"
        } else {
            "黑方"
        },
        plan.lure_move,
        plan.knife_move,
        if best_defense.is_empty() {
            "引擎未给出后续".into()
        } else {
            best_defense.join(" ")
        },
        plan.risk,
        plan.note
    );
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, Some("flyknife-practice".into()))?;
    board_dto(&model)
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitGuidedAnalysisRequest {
    session_id: Uuid,
    submission: GuidedAnalysisSubmission,
    lines: Vec<GuidedEngineLine>,
    task_id: Option<Uuid>,
    #[serde(default)]
    parent_note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GuidedAnalysisStartDto {
    session: GuidedAnalysisSession,
    board: BoardDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GuidedAnalysisSubmissionDto {
    session: GuidedAnalysisSession,
    result: GuidedAnalysisResultDto,
    attempt: Option<TrainingAttempt>,
}

#[tauri::command]
fn get_learning_profile(state: State<'_, DesktopState>) -> Result<LearningProfile, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .learning_profile()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_learning_profile(
    profile: LearningProfile,
    state: State<'_, DesktopState>,
) -> Result<LearningProfile, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .save_learning_profile(&profile)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_guided_analysis(
    node_id: Option<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<GuidedAnalysisStartDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let problem_node_id = node_id.or(model.current_node);
    let start_node_id = match problem_node_id {
        Some(problem) => {
            let parent = model
                .tree
                .node(problem)
                .map_err(|error| error.to_string())?
                .parent_id;
            (parent != model.tree.root_id()).then_some(parent)
        }
        None => model.current_node,
    };
    let start_board = board_at(&model.starting_fen, &model.tree, start_node_id)?;
    let signature = report_line_signature(&model.tree, model.current_node)?;
    let ply = fen_starting_ply(&model.starting_fen)
        + start_node_id
            .and_then(|node| model.tree.active_line(node).ok().map(|line| line.len()))
            .unwrap_or(0);
    let phase = report_phase(ply, report_material(&start_board));
    let game_id = model.game_id;
    let session = model
        .store
        .start_guided_analysis(
            game_id,
            problem_node_id,
            start_node_id,
            &signature,
            &start_board.to_fen(),
            phase,
        )
        .map_err(|error| error.to_string())?;
    let preview_model = AppModel {
        board: start_board,
        starting_fen: model.starting_fen.clone(),
        tree: model.tree.clone(),
        current_node: start_node_id,
        game_id: model.game_id,
        device_id: model.device_id,
        lamport: model.lamport,
        store: LocalStore::open_in_memory().map_err(|error| error.to_string())?,
        metadata: model.metadata.clone(),
        note: model.note.clone(),
        source_path: model.source_path.clone(),
        source_format: model.source_format.clone(),
        playable: model.playable,
    };
    // The preview DTO is read-only. Its temporary in-memory store prevents this
    // training position from becoming the current persisted manual.
    let board = board_dto(&preview_model)?;
    Ok(GuidedAnalysisStartDto { session, board })
}

#[tauri::command]
fn submit_guided_analysis(
    request: SubmitGuidedAnalysisRequest,
    state: State<'_, DesktopState>,
) -> Result<GuidedAnalysisSubmissionDto, String> {
    if request.submission.chosen_move.trim().is_empty() {
        return Err("请先在棋盘上选择首选着".into());
    }
    if request.submission.candidates.is_empty() {
        return Err("请至少保留一个首选着".into());
    }
    if !(2..=8).contains(&request.submission.predicted_line.len()) {
        return Err("请至少在棋盘上推演 2 个半回合，最多 8 个半回合".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let session = model
        .store
        .guided_analysis_session(request.session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "拆棋会话不存在".to_owned())?;
    if session.status != "thinking" || !session.answer_hidden {
        return Err("本次拆棋已经提交或取消".into());
    }
    if session.game_id != model.game_id
        || session.report_signature != report_line_signature(&model.tree, model.current_node)?
    {
        return Err("棋谱已变化，请从当前问题局面重新开始 U10 拆棋".into());
    }
    let result = classify_submission(request.session_id, &request.submission, request.lines);
    let result_json = serde_json::to_string(&result).map_err(|error| error.to_string())?;
    let game_id = model.game_id;
    let task_id = match (request.task_id, session.problem_node_id) {
        (Some(task_id), _) => Some(task_id),
        (None, Some(node_id)) => {
            model
                .store
                .upsert_training_task_with_context(
                    game_id,
                    &session.report_signature,
                    node_id,
                    "U10 引导拆棋",
                    "先独立判断威胁、强制着和走一思三候选，再用 Pikafish 核对。",
                    Some(&session.phase),
                    &result.theory_signals,
                    None,
                    "reinforcement",
                )
                .map_err(|error| error.to_string())?;
            model
                .store
                .list_training_tasks()
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|task| {
                    task.game_id == game_id
                        && task.report_signature == session.report_signature
                        && task.node_id == node_id
                })
                .map(|task| task.id)
        }
        (None, None) => None,
    };
    let session = model
        .store
        .submit_guided_analysis(
            request.session_id,
            &request.submission,
            &result.result_kind,
            result.score,
            &result_json,
        )
        .map_err(|error| error.to_string())?;
    let attempt = task_id
        .map(|task_id| {
            model.store.save_training_attempt(
                task_id,
                Some(request.session_id),
                &request.submission,
                result.score,
                &result.result_kind,
                &request.parent_note,
            )
        })
        .transpose()
        .map_err(|error| error.to_string())?;
    Ok(GuidedAnalysisSubmissionDto {
        session,
        result,
        attempt,
    })
}

#[tauri::command]
fn cancel_guided_analysis(session_id: Uuid, state: State<'_, DesktopState>) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .cancel_guided_analysis(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn generate_daily_training_plan(
    state: State<'_, DesktopState>,
) -> Result<DailyTrainingPlanDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model
        .store
        .learning_profile()
        .map_err(|error| error.to_string())?;
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?;
    let attempts = model
        .store
        .training_attempts(None)
        .map_err(|error| error.to_string())?;
    Ok(daily_plan(&profile, &tasks, &attempts, Utc::now()))
}

#[tauri::command]
fn get_weekly_learning_report(
    state: State<'_, DesktopState>,
) -> Result<WeeklyLearningReportDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?;
    let attempts = model
        .store
        .training_attempts(None)
        .map_err(|error| error.to_string())?;
    Ok(weekly_report(&attempts, &tasks, Utc::now()))
}

#[tauri::command]
fn infer_opening_repertoire_command(
    state: State<'_, DesktopState>,
) -> Result<OpeningRepertoireDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model
        .store
        .learning_profile()
        .map_err(|error| error.to_string())?;
    let reports = model
        .store
        .load_latest_game_reports()
        .map_err(|error| error.to_string())?;
    let report_by_game = reports
        .into_iter()
        .filter_map(|stored| {
            serde_json::from_str::<GameReportDatasetDto>(&stored.dataset_json)
                .ok()
                .map(|report| (stored.game_id, report))
        })
        .collect::<HashMap<_, _>>();
    let samples = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some("比赛复盘"))
        .filter_map(|game| {
            let report = report_by_game.get(&game.id)?;
            let opening_name = report
                .positions
                .iter()
                .filter_map(|position| position.opening.as_ref())
                .max_by_key(|opening| opening.ply)?
                .name
                .clone();
            let metadata: serde_json::Value = serde_json::from_str(&game.metadata_json).ok()?;
            let child = profile.child_name.trim();
            let side = if !child.is_empty() && metadata["red"].as_str() == Some(child) {
                "red"
            } else if !child.is_empty() && metadata["black"].as_str() == Some(child) {
                "black"
            } else if game.tags.iter().any(|tag| tag == "红方" || tag == "先手") {
                "red"
            } else if game.tags.iter().any(|tag| tag == "黑方" || tag == "后手") {
                "black"
            } else {
                return None;
            };
            Some(OpeningSample {
                game_id: game.id,
                side: side.into(),
                opening_name,
                updated_at: game.updated_at,
            })
        })
        .collect();
    Ok(infer_opening_repertoire(samples))
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

const TRAINING_TASK_LOSS_THRESHOLD_CP: i32 = 80;

#[tauri::command]
fn generate_training_tasks(
    state: State<'_, DesktopState>,
) -> Result<TrainingGenerationResultDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let current_signature = report_line_signature(&model.tree, model.current_node)?;
    let Some(stored) = model
        .store
        .load_game_report(model.game_id, &current_signature)
        .map_err(|error| error.to_string())?
    else {
        return Err("请先生成一份整局复盘报告".into());
    };
    let report: GameReportDatasetDto =
        serde_json::from_str(&stored.dataset_json).map_err(|_| "本地复盘报告无效".to_owned())?;
    if report.game_id != model.game_id || report.line_signature != current_signature {
        return Err("棋谱线路已变化，请重新生成整局报告后再创建训练".into());
    }
    let approved_cards = model
        .store
        .theory_cards()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|card| card.review_status == "approved")
        .collect::<Vec<_>>();
    let mut candidates = Vec::new();
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
        if loss < 30 {
            continue;
        }
        candidates.push((index, loss));
    }

    let critical = candidates
        .iter()
        .copied()
        .filter(|(_, loss)| *loss >= TRAINING_TASK_LOSS_THRESHOLD_CP)
        .collect::<Vec<_>>();
    let reinforcement = if critical.is_empty() {
        let mut rows = candidates
            .iter()
            .copied()
            .filter(|(_, loss)| *loss < TRAINING_TASK_LOSS_THRESHOLD_CP)
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| right.1.cmp(&left.1));
        rows.into_iter().take(3).collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for (index, loss) in critical.iter().chain(reinforcement.iter()).copied() {
        let position = &report.positions[index];
        let moved = position
            .move_
            .as_ref()
            .expect("training candidate has move");
        let move_number = (position.ply + 1) / 2;
        let best = position
            .best_notation
            .as_deref()
            .unwrap_or("重新寻找更稳健的着法");
        let task_type = if loss >= TRAINING_TASK_LOSS_THRESHOLD_CP {
            "critical"
        } else {
            "reinforcement"
        };
        let tags = training_tags_for_position(position, loss);
        let engine_signal = engine_signal_for_position(position, &tags, loss);
        let source_card =
            best_matching_theory_card(&approved_cards, &position.phase, &tags, engine_signal);
        model
            .store
            .upsert_training_task_with_context(
                report.game_id,
                &report.line_signature,
                moved.node_id,
                &format!(
                    "{}第 {move_number} 手：{}",
                    if task_type == "critical" {
                        "关键复练"
                    } else {
                        "巩固复练"
                    },
                    moved.notation
                ),
                &format!(
                    "本着评价变化约 {loss}cp。先按{}阶段重算候选，再比较推荐着法：{best}。标签：{}",
                    phase_label(&position.phase),
                    tags.join(" / ")
                ),
                Some(&position.phase),
                &tags,
                source_card.map(|card| card.id),
                task_type,
            )
            .map_err(|error| error.to_string())?;
        if let Some(card) = source_card {
            let _ = model.store.record_theory_card_match(
                report.game_id,
                &report.line_signature,
                moved.node_id,
                card.id,
                card.version,
                engine_signal,
                &tags,
                &format!("复盘第 {move_number} 手自动命中：{}", moved.notation),
            );
        }
    }
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|task| task.game_id == model.game_id && task.report_signature == current_signature)
        .map(Into::into)
        .collect();
    Ok(TrainingGenerationResultDto {
        tasks,
        critical_count: critical.len(),
        reinforcement_count: reinforcement.len(),
    })
}

fn best_matching_theory_card<'a>(
    cards: &'a [TheoryCard],
    phase: &str,
    tags: &[String],
    engine_signal: &str,
) -> Option<&'a TheoryCard> {
    let normalized_tags = tags
        .iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let normalized_signal = engine_signal.trim().to_lowercase();
    cards
        .iter()
        .filter(|card| (card.phase == phase || card.phase == "all") && !card.needs_recheck)
        .filter_map(|card| {
            let haystack = format!(
                "{} {} {} {} {}",
                card.title,
                card.summary,
                card.applies_when,
                card.risk,
                card.tags.join(" ")
            )
            .to_lowercase();
            let tag_score = normalized_tags
                .iter()
                .filter(|tag| haystack.contains(tag.as_str()))
                .map(|tag| theory_tag_weight(tag))
                .sum::<i64>();
            let correlation_hits = card
                .engine_correlations
                .iter()
                .filter(|correlation| correlation.trim().to_lowercase() == normalized_signal)
                .count() as i64;
            let score = tag_score + correlation_hits * 12 - card.match_penalty * 3;
            (score > 0).then_some((score, card))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, card)| card)
}

fn theory_tag_weight(tag: &str) -> i64 {
    match tag {
        "开局" | "中局" | "残局" | "复盘" | "推荐着对比" => 1,
        "脱离体系" | "战略方向" | "子力协调" | "候选着" | "计算" | "理论胜和" | "兑子" => {
            5
        }
        "残局打底" | "战术漏算" | "候选着计算" | "专属布局" | "深度复盘" | "慢棋训练"
        | "心态管理" => 18,
        _ => 14,
    }
}

fn engine_signal_for_position(
    position: &GameReportPositionDto,
    tags: &[String],
    loss: i32,
) -> &'static str {
    if position.mate.is_some() {
        return "missed_tactic";
    }
    if tags.iter().any(|tag| tag.contains("兑子")) {
        return "exchange_miscalculation";
    }
    if tags.iter().any(|tag| tag.contains("理论胜和")) {
        return "endgame_theoretical_win_draw";
    }
    if tags.iter().any(|tag| tag.contains("脱离体系")) {
        return "opening_deviation";
    }
    if tags.iter().any(|tag| tag.contains("子力协调")) {
        return "development_lag";
    }
    if loss >= 300 || tags.iter().any(|tag| tag.contains("战术漏算")) {
        return "missed_tactic";
    }
    if tags.iter().any(|tag| tag.contains("候选着")) {
        return "missed_candidate";
    }
    "plan_without_counterplay_check"
}

fn phase_label(phase: &str) -> &'static str {
    match phase {
        "opening" => "开局",
        "middle" => "中局",
        "endgame" => "残局",
        _ => "复盘",
    }
}

fn training_tags_for_position(position: &GameReportPositionDto, loss: i32) -> Vec<String> {
    let mut tags = match position.phase.as_str() {
        "opening" => vec![
            "开局",
            "脱离体系",
            "战略方向",
            "子力协调",
            "专属布局",
            "开局失误",
        ],
        "middle" => vec!["中局", "候选着", "计算", "候选着计算"],
        "endgame" => vec!["残局", "理论胜和", "兑子", "残局打底", "残局处理"],
        _ => vec!["复盘", "深度复盘"],
    }
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    tags.push("深度复盘".into());
    if position.mate.is_some() {
        tags.push("漏杀/防杀".into());
        tags.push("战术漏算".into());
    } else if loss >= 300 {
        tags.push("战术漏算".into());
    }
    if loss >= 150 {
        tags.push("随手棋".into());
    }
    if loss >= 500 {
        tags.push("心态管理".into());
        tags.push("心态波动".into());
    }
    if position.best_notation.is_some() {
        tags.push("推荐着对比".into());
        tags.push("候选着计算".into());
    }
    add_notation_tags(position, &mut tags);
    tags.sort();
    tags.dedup();
    tags
}

fn add_notation_tags(position: &GameReportPositionDto, tags: &mut Vec<String>) {
    let text = position
        .move_
        .as_ref()
        .map(|move_| move_.notation.as_str())
        .unwrap_or_default();
    let mut add = |tag: &str| tags.push(tag.to_owned());
    if text.contains('车') {
        add("出车选择");
        add("线路控制");
    }
    if text.contains('马') {
        add("活马");
    }
    if text.contains('炮') {
        add("炮位");
        add("炮路");
    }
    if text.contains('兵') || text.contains('卒') {
        add("兵卒出动");
        add("兵卒效率");
    }
    if text.contains('仕') || text.contains('士') {
        add("补士");
        add("将位");
    }
    if text.contains("肋") {
        add("肋道");
    }
    if text.contains('兑') {
        add("兑子");
    }
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
fn get_training_summary(state: State<'_, DesktopState>) -> Result<TrainingSummaryDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(TrainingSummaryDto {
        weak_spots: model
            .store
            .weakness_stats(12)
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
fn save_theory_feedback(
    feedback: TheoryFeedbackRequest,
    state: State<'_, DesktopState>,
) -> Result<TheoryCardFeedback, String> {
    if !matches!(
        feedback.verdict.as_str(),
        "correct" | "incorrect" | "needs_revision"
    ) {
        return Err("反馈只能是 correct、incorrect 或 needs_revision".into());
    }
    if feedback.note.chars().count() > 1_000 {
        return Err("反馈说明最多 1000 字".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .save_theory_card_feedback(
            feedback.match_id,
            feedback.card_id,
            feedback.card_version,
            &feedback.verdict,
            feedback.note.trim(),
        )
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

async fn master_library_get<T>(
    state: &DesktopState,
    path: &str,
    query: &[(&str, String)],
) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let server_url = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?
        .server_url;
    validate_server_url(&server_url)?;
    let token = active_sync_token(state)?.ok_or("请先登录同步账号后查看大师棋谱")?;
    let mut url = reqwest::Url::parse(&format!("{}{}", server_url.trim_end_matches('/'), path))
        .map_err(|_| "大师棋谱服务地址格式不正确".to_owned())?;
    {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in query {
            if !value.trim().is_empty() {
                pairs.append_pair(name, value);
            }
        }
    }
    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("大师棋谱服务不可用：{error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        clear_sync_token(state)?;
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .set_sync_token_expired(true)
            .map_err(|error| error.to_string())?;
        return Err("登录已过期，请重新登录后查看大师棋谱".into());
    }
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
            .unwrap_or_else(|| format!("大师棋谱服务返回错误 {status}"));
        return Err(message);
    }
    response
        .json()
        .await
        .map_err(|_| "大师棋谱服务返回了无效数据".into())
}

#[tauri::command]
async fn list_master_players(
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterPlayerDto>, String> {
    let mut params = vec![
        ("limit", limit.unwrap_or(50).clamp(1, 100).to_string()),
        ("offset", offset.unwrap_or(0).min(10_000).to_string()),
    ];
    if let Some(query) = query {
        params.push(("query", query));
    }
    master_library_get(&state, "/api/v1/master/players", &params).await
}

#[tauri::command]
async fn list_master_games(
    player_id: String,
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterGameSummaryDto>, String> {
    let player_id = player_id.trim();
    if player_id.is_empty() {
        return Err("请选择大师".into());
    }
    let mut params = vec![
        ("limit", limit.unwrap_or(20).clamp(1, 100).to_string()),
        ("offset", offset.unwrap_or(0).min(10_000).to_string()),
    ];
    if let Some(query) = query {
        params.push(("query", query));
    }
    master_library_get(
        &state,
        &format!("/api/v1/master/players/{player_id}/games"),
        &params,
    )
    .await
}

#[tauri::command]
async fn open_master_game(
    game_id: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return Err("请选择棋谱".into());
    }
    let detail: MasterGameDetailDto =
        master_library_get(&state, &format!("/api/v1/master/games/{game_id}"), &[]).await?;
    let mut document = import_document(detail.pgn.as_bytes(), Some(ManualFormat::Pgn))
        .map_err(|error| format!("大师棋谱解析失败：{error}"))?;
    document.metadata.title = detail.title.clone();
    document.metadata.event = detail
        .event_name
        .clone()
        .unwrap_or_else(|| "公开大师棋谱".into());
    document.metadata.date = detail.game_date.clone().unwrap_or_default();
    document.metadata.red = detail.red_player.clone();
    document.metadata.black = detail.black_player.clone();
    document.metadata.result = detail.result.clone();
    document.metadata.site = detail.source_url.clone();
    let mut note_lines = vec![
        format!("红方：{}", detail.red_player),
        format!("黑方：{}", detail.black_player),
        format!(
            "比赛：{}",
            detail
                .event_name
                .clone()
                .unwrap_or_else(|| "赛事未知".into())
        ),
        format!(
            "日期：{}",
            detail
                .game_date
                .clone()
                .unwrap_or_else(|| "日期未知".into())
        ),
        format!("结果：{}", detail.result),
        format!("手数：{}", detail.move_count),
        "用途：本地学习、拆棋和 Pikafish 分析。".into(),
    ];
    if !document.note.trim().is_empty() {
        note_lines.push(format!("原谱备注：{}", document.note.trim()));
    }
    document.note = note_lines.join("\n");
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(detail.source_url),
        Some("server-master-pgn".into()),
    )?;
    board_dto(&model)
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
    for path in preferences.eleeye_book_paths {
        if preferences
            .disabled_eleeye_book_paths
            .iter()
            .any(|disabled| disabled == &path)
        {
            continue;
        }
        match eleeye_opening_book::query(Path::new(&path), &model.board) {
            Ok(mut candidates) => xqb_candidates.append(&mut candidates),
            Err(error) => eprintln!("忽略不可用的 ElephantEye 开局库 {path}: {error}"),
        }
    }
    if preferences.builtin_opening_book_enabled {
        match pfbook_opening_book::query_builtin_book(
            &preferences.active_builtin_opening_book_id,
            &model.board,
        ) {
            Ok(mut candidates) => xqb_candidates.append(&mut candidates),
            Err(error) => eprintln!("忽略不可用的内嵌 pfBook 开局库：{error}"),
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

fn recognized_board_snapshot(model: &AppModel, board: &Board) -> Result<BoardDto, String> {
    let mut snapshot = board_dto(model)?;
    snapshot.fen = board.to_fen();
    snapshot.root_side_to_move = side_label(board.side_to_move());
    snapshot.root_score_cp = None;
    snapshot.root_mate = None;
    snapshot.side_to_move = side_label(board.side_to_move());
    snapshot.status = game_status_label(board.status()).into();
    snapshot.rule_name = "截图待确认";
    snapshot.rule_verdict = "ongoing";
    snapshot.rule_reason = "识别局面尚未写入棋谱，请标记并确认走子".into();
    snapshot.pieces = board_pieces(board);
    snapshot.history.clear();
    snapshot.continuation.clear();
    snapshot.branches.clear();
    snapshot.sibling_branches.clear();
    snapshot.manual_tree.clear();
    snapshot.current_node = None;
    snapshot.playable = position_is_playable(board);
    snapshot.xqb_candidates.clear();
    Ok(snapshot)
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
        library_folder: None,
        favorite: None,
        tags: None,
    }
}

fn library_metadata_payload(
    game: &local_store::LocalGame,
    folder: Option<String>,
) -> UpdateGameMetadataPayload {
    UpdateGameMetadataPayload {
        title: game.title.clone(),
        note: game.note.clone(),
        library_folder: Some(folder.unwrap_or_default()),
        favorite: Some(game.favorite),
        tags: Some(game.tags.clone()),
        ..UpdateGameMetadataPayload::default()
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

fn next_operation_for_game(
    model: &mut AppModel,
    game_id: Uuid,
    kind: OperationKind,
    payload: serde_json::Value,
) -> Operation {
    model.lamport += 1;
    Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
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
            ensure_builtin_master_style_seed(app.handle(), &mut store)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            ensure_training_system_seed(&mut store)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
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
                screenshot_resolution_guard: Mutex::new(()),
                link_capture_generation: AtomicU64::new(0),
                link_region_selection_background: Mutex::new(None),
                link_region_selection: (Mutex::new(None), Condvar::new()),
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_state,
            prepare_link_selection_window,
            complete_link_region_selection,
            cancel_link_region_selection,
            get_link_region_selection_background,
            start_link_session,
            stop_link_session,
            get_link_session_status,
            pause_link_session,
            recalibrate_link_session,
            get_link_capture_preview,
            recognize_link_image_file,
            submit_link_position,
            set_link_side_to_move,
            confirm_link_engine_move,
            import_recognized_position,
            list_games,
            get_game_mirror_status,
            update_game_mirror,
            rebuild_game_mirrors,
            reveal_game_mirror,
            list_library_folders,
            create_library_folder,
            rename_library_folder,
            delete_library_folder,
            update_game_library,
            open_game,
            play_move,
            confirm_recognized_move,
            preview_recognized_move_from_current,
            resolve_screenshot_move,
            preview_line,
            parse_chinese_line,
            new_game,
            open_document,
            import_xqb_opening_book,
            import_eleeye_opening_book,
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
            import_master_style_profile,
            list_master_style_profiles,
            match_master_style_hints,
            get_desktop_preferences,
            save_desktop_preferences,
            list_builtin_opening_books,
            probe_engine,
            list_engine_profiles,
            register_engine_profile,
            set_active_engine_profile,
            delete_engine_profile,
            query_cloud_opening_book,
            list_flyknife_templates,
            list_flyknife_topics,
            open_external_url,
            open_flyknife_topic,
            generate_flyknife_candidates,
            list_flyknife_plans,
            save_flyknife_plan,
            delete_flyknife_plan,
            open_flyknife_practice,
            list_coach_reports,
            get_learning_profile,
            save_learning_profile,
            start_guided_analysis,
            submit_guided_analysis,
            cancel_guided_analysis,
            generate_daily_training_plan,
            get_weekly_learning_report,
            infer_opening_repertoire_command,
            list_training_tasks,
            generate_training_tasks,
            complete_training_task,
            get_training_summary,
            list_study_sessions,
            save_study_session,
            scan_theory_library,
            get_theory_library,
            review_theory_card,
            create_theory_card,
            save_theory_feedback,
            get_sync_account,
            get_subscription,
            redeem_subscription_code,
            list_master_players,
            list_master_games,
            open_master_game,
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

    fn desktop_state_for_link_tests() -> DesktopState {
        let game_id = Uuid::new_v4();
        let device_id = Uuid::new_v4();
        let tree = ManualTree::new();
        let mut store = LocalStore::open_in_memory().unwrap();
        let create_operation = Operation {
            op_id: Uuid::new_v4(),
            device_id,
            entity_id: game_id,
            game_id,
            kind: OperationKind::CreateGame,
            payload: serde_json::to_value(CreateGamePayload {
                title: "连线测试".into(),
                fen: STARTING_FEN.into(),
                root_id: tree.root_id(),
            })
            .unwrap(),
            lamport: 1,
            created_at: Utc::now(),
        };
        store
            .save_game_with_operation(
                game_id,
                "连线测试",
                STARTING_FEN,
                tree.root_id(),
                &create_operation,
            )
            .unwrap();
        DesktopState {
            model: Mutex::new(AppModel {
                board: Board::from_fen(STARTING_FEN).unwrap(),
                starting_fen: STARTING_FEN.into(),
                tree,
                current_node: None,
                game_id,
                device_id,
                lamport: 1,
                store,
                metadata: ManualMetadata::default(),
                note: String::new(),
                source_path: None,
                source_format: None,
                playable: true,
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
            screenshot_resolution_guard: Mutex::new(()),
            link_capture_generation: AtomicU64::new(0),
            link_region_selection_background: Mutex::new(None),
            link_region_selection: (Mutex::new(None), Condvar::new()),
        }
    }

    #[test]
    fn screenshot_resolution_prefers_exact_yolo_position_over_conflicting_white_marker() {
        // This intentionally has two legal red continuations. The white marker
        // points to the cannon route, while the complete YOLO post-move FEN is
        // the horse route. The marker must not override exact placement.
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        assert!(before.legal_moves().contains(&horse));
        assert!(before.legal_moves().contains(&cannon));
        let recognized_after = before.apply_move(horse).unwrap();

        let resolution = resolve_screenshot_move_from_board(
            &before,
            &recognized_after,
            Some(link_vision::ScreenshotMoveMarker {
                from: Some(cannon.from),
                to: Some(cannon.to),
                from_confidence: 240,
                to_confidence: 480,
            }),
            BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        assert_eq!(resolution.candidates[0].step.notation, "马八进七");
        assert_eq!(resolution.candidates[0].step.from.row, horse.from.row);
        assert_eq!(resolution.candidates[0].step.to.col, horse.to.col);
        assert_ne!(resolution.candidates[0].step.notation, "炮九退二");
    }

    #[test]
    fn tiantian_fixture_yolo_position_resolves_the_documented_last_move() {
        // This is the production path exercised against the anonymous mobile
        // fixture: YOLO reconstructs the complete post-move placement first,
        // then the resolver enumerates legal moves from the known parent. The
        // white circle/base glow is passed in only as a tie-breaker and cannot
        // manufacture a candidate.
        const PARENT_FEN: &str =
            "1r1akabn1/3r5/nc2b2c1/p3p1p1p/9/1NR6/P3P1P1P/1C2C1N2/9/1RBAKAB2 w - - 0 1";
        let parent = Board::from_fen(PARENT_FEN).expect("fixture parent position");
        let expected_move = Move::from_iccs("b4c6").expect("fixture last move ICCS");
        assert!(parent.legal_moves().contains(&expected_move));

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let model = manifest_dir.join("resources/link-vision/yolov11.onnx");
        let fixture = include_bytes!("../tests/fixtures/tiantian-black-bottom-board.jpg");
        let mut detector = link_vision::Yolo11Detector::open(&model).unwrap_or_else(|error| {
            panic!("bundled YOLO11 model must load for fixture regression: {error}")
        });
        let detections = detector.detect_png(fixture).unwrap_or_else(|error| {
            panic!("YOLO11 must infer the bundled anonymous fixture: {error}")
        });
        let recognition = link_vision::recognition_from_detections(&detections, &parent)
            .unwrap_or_else(|error| {
                panic!("fixture must reconstruct a complete board placement: {error}")
            });
        let marker = link_vision::detect_screenshot_move_marker_from_png(
            fixture,
            &detections,
            recognition.orientation,
        )
        .unwrap_or_else(|error| panic!("fixture marker extraction must not fail: {error}"));
        let recognized_after = Board::from_fen(&recognition.fen)
            .expect("YOLO reconstruction must remain a valid Xiangqi FEN");

        let resolution = resolve_screenshot_move_from_board(
            &parent,
            &recognized_after,
            marker,
            recognition.orientation,
        )
        .expect("strict screenshot resolution");

        assert_eq!(recognition.orientation, BoardOrientation::BlackAtBottom);
        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        let candidate = &resolution.candidates[0];
        assert_eq!(candidate.step.notation, "马八进七");
        assert_eq!(candidate.step.moved_by, "红方");
        assert_eq!(candidate.step.from.row, expected_move.from.row);
        assert_eq!(candidate.step.from.col, expected_move.from.col);
        assert_eq!(candidate.step.to.row, expected_move.to.row);
        assert_eq!(candidate.step.to.col, expected_move.to.col);
        assert_eq!(candidate.side_to_move, "黑方");
    }

    #[test]
    fn screenshot_resolution_never_creates_a_marker_only_candidate() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        // The YOLO board is visibly different from every legal continuation
        // from `before`: the red horse is missing. A high-confidence marker
        // for cannon a2-a0 must still yield no exact match.
        let unrelated = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/9 b - - 0 1").unwrap();
        let resolution = resolve_screenshot_move_from_board(
            &before,
            &unrelated,
            Some(link_vision::ScreenshotMoveMarker {
                from: Some(cannon.from),
                to: Some(cannon.to),
                from_confidence: 255,
                to_confidence: 510,
            }),
            BoardOrientation::BlackAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "noExactMatch");
        assert!(resolution.candidates.is_empty());
        assert_eq!(resolution.orientation, BoardOrientation::BlackAtBottom);
        assert!(
            resolution
                .reason
                .as_deref()
                .unwrap()
                .contains("不能单独推断走法")
        );
    }

    #[test]
    fn image_recognition_error_invalidates_an_old_screenshot_confirmation() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::ImageImport;
        session.capture_generation = 17;
        session.latest_fen = Some("old-post-move-fen".into());
        session.screenshot_move_marker = Some(link_vision::ScreenshotMoveMarker {
            from: Some(Square { row: 9, col: 1 }),
            to: Some(Square { row: 7, col: 2 }),
            from_confidence: 255,
            to_confidence: 510,
        });
        session.screenshot_resolution_before_fen = Some("old-parent-fen".into());
        session.screenshot_resolution_generation = Some(17);
        session.screenshot_resolution_mode = Some(ScreenshotResolutionMode::ExactPlacement);

        apply_link_capture_error(&mut session, 17, "图片未识别到完整棋盘".into());

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(session.latest_fen.is_none());
        assert!(session.screenshot_move_marker.is_none());
        assert!(session.screenshot_resolution_before_fen.is_none());
        assert!(session.screenshot_resolution_generation.is_none());
        assert!(session.screenshot_resolution_mode.is_none());
        assert!(session.screenshot_resolution_game_id.is_none());
        assert!(session.screenshot_resolution_current_node.is_none());
        assert!(session.screenshot_resolution_allowed_moves.is_empty());
    }

    #[test]
    fn screenshot_resolution_binding_rejects_a_same_fen_different_game_or_node() {
        let mut state = desktop_state_for_link_tests();
        let model = state.model.get_mut().unwrap();
        let before_fen = model.board.to_fen();
        let binding = ScreenshotResolutionBinding {
            recognized_after_fen: None,
            before_fen,
            generation: 1,
            mode: ScreenshotResolutionMode::ManualFallback,
            game_id: model.game_id,
            current_node: None,
            allowed_moves: vec!["b2b9".into()],
        };

        validate_screenshot_resolution_binding(model, &binding)
            .expect("the original game root remains valid");

        model.current_node = Some(Uuid::new_v4());
        let node_error = validate_screenshot_resolution_binding(model, &binding).unwrap_err();
        assert!(node_error.contains("棋谱或节点已变化"));

        model.current_node = None;
        model.game_id = Uuid::new_v4();
        let game_error = validate_screenshot_resolution_binding(model, &binding).unwrap_err();
        assert!(game_error.contains("棋谱或节点已变化"));
    }

    #[test]
    fn screenshot_resolution_only_confirms_the_resolved_or_previewed_move() {
        let binding = ScreenshotResolutionBinding {
            recognized_after_fen: None,
            before_fen: STARTING_FEN.into(),
            generation: 1,
            mode: ScreenshotResolutionMode::ManualFallback,
            game_id: Uuid::new_v4(),
            current_node: None,
            allowed_moves: vec!["b2b9".into()],
        };

        validate_screenshot_resolution_move(&binding, "b2b9").unwrap();
        let error = validate_screenshot_resolution_move(&binding, "h2h9").unwrap_err();
        assert!(error.contains("合法候选"));
    }

    #[test]
    fn consuming_a_screenshot_resolution_rejects_a_second_confirmation() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::ImageImport;
        session.latest_fen = Some(STARTING_FEN.into());
        session.screenshot_resolution_before_fen = Some(STARTING_FEN.into());
        session.screenshot_resolution_generation = Some(4);
        session.screenshot_resolution_mode = Some(ScreenshotResolutionMode::ManualFallback);
        session.screenshot_resolution_game_id = Some(Uuid::new_v4());
        session.screenshot_resolution_current_node = Some(None);
        session.screenshot_resolution_allowed_moves = vec!["b2b9".into()];

        active_screenshot_resolution(&session).expect("first confirmation is available");
        invalidate_screenshot_move_resolution(&mut session);
        let error = active_screenshot_resolution(&session).unwrap_err();
        assert!(error.contains("已失效"));
    }

    #[test]
    fn screenshot_resolution_matches_a_capture_from_the_complete_yolo_position() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/9/4R4/4K4 w - - 0 1").unwrap();
        let capture = Move::from_iccs("e1e4").unwrap();
        assert!(before.legal_moves().contains(&capture));
        let recognized_after = before.apply_move(capture).unwrap();

        let resolution = resolve_screenshot_move_from_board(
            &before,
            &recognized_after,
            None,
            BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        assert_eq!(resolution.candidates[0].step.notation, "车五进三");
        assert!(resolution.candidates[0].captured);
        assert_eq!(resolution.candidates[0].side_to_move, "黑方");
    }

    #[test]
    fn exact_screenshot_confirmation_rejects_another_legal_move() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        let recognized_after = before.apply_move(horse).unwrap();

        let error = validate_screenshot_move_confirmation(
            &before,
            cannon,
            &before.to_fen(),
            Some(&recognized_after.to_fen()),
            ScreenshotResolutionMode::ExactPlacement,
        )
        .unwrap_err();

        assert!(error.contains("完整局面不一致"));
        validate_screenshot_move_confirmation(
            &before,
            horse,
            &before.to_fen(),
            Some(&recognized_after.to_fen()),
            ScreenshotResolutionMode::ExactPlacement,
        )
        .unwrap();
    }

    #[test]
    fn manual_screenshot_confirmation_requires_the_original_document_node() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let moved = before.apply_move(horse).unwrap();

        let error = validate_screenshot_move_confirmation(
            &moved,
            moved.legal_moves()[0],
            &before.to_fen(),
            None,
            ScreenshotResolutionMode::ManualFallback,
        )
        .unwrap_err();

        assert!(error.contains("当前棋谱节点已变化"));
    }

    #[test]
    fn link_capture_timeout_stops_silent_first_frame_session() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::WindowLink;
        session.state = LinkSessionState::ClassifyingSquares;
        session.capture_running = true;
        session.started_at = Some(Utc::now() - chrono::Duration::seconds(13));
        session.last_heartbeat_at = Some(Utc::now() - chrono::Duration::seconds(9));
        session.phase = Some("load_model".into());

        apply_link_capture_timeout(&mut session);

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(!session.capture_running);
        assert_eq!(session.phase.as_deref(), Some("timeout"));
        assert!(session.reason.as_deref().unwrap().contains("12 秒"));
    }

    #[test]
    fn link_region_selection_failure_is_visible_in_status() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::WindowLink;
        session.state = LinkSessionState::Calibrating;
        session.capture_running = true;
        session.capture_generation = 9;
        session.phase = Some("selecting_region".into());

        apply_link_region_selection_failure(
            &mut session,
            9,
            "region_selection_cancelled",
            "已取消棋盘区域框选；可重新启动连线或重新框选。".into(),
        );

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(!session.capture_running);
        assert_eq!(session.phase.as_deref(), Some("region_selection_cancelled"));
        assert_eq!(session.last_error, session.reason);
        assert!(session.reason.as_deref().unwrap().contains("重新启动连线"));
    }

    #[test]
    fn window_link_start_initializes_non_blocking_selection_state() {
        let mut session = LinkSession::default();
        session.manual_turn_override = Some(Color::Black);
        let request = StartLinkSessionRequest {
            source: CaptureSource::WindowLink,
            recognition_mode: RecognitionMode::YoloBoard,
            mode: LinkMode::AutoPlay,
            stable_frames: 1,
            auto_side: Some("red".into()),
        };
        let policy = CapturePolicy::for_source(request.source);

        initialize_link_session_for_request(&mut session, &request, 12, 0.55, policy);

        assert_eq!(session.state, LinkSessionState::Calibrating);
        assert_eq!(session.phase.as_deref(), Some("selecting_region"));
        assert!(!session.capture_running);
        assert_eq!(session.capture_generation, 12);
        assert_eq!(session.gate.required_frames(), 2);
        assert_eq!(session.manual_turn_override, None);
        assert!(session.reason.as_deref().unwrap().contains("等待框选"));
    }

    #[test]
    fn manual_turn_override_is_exposed_and_takes_precedence_over_auto_indicator() {
        let auto = link_vision::TurnIndicator {
            side: Color::Red,
            slot: link_vision::TurnIndicatorSlot::RightPlayer,
            confidence: 0.9,
            detail: "轮走识别：右侧头像高亮 → 红方行棋".into(),
        };

        let message = link_turn_indicator_message(Some(Color::Black), Some(&auto));

        assert!(message.contains("手动模式已开启"));
        assert!(message.contains("已忽略"));
        assert!(message.contains("右侧头像高亮"));

        let mut session = LinkSession::default();
        session.manual_turn_override = Some(Color::Black);
        session.turn_indicator = Some(message);
        let dto = link_status_dto(&session);

        assert_eq!(dto.manual_turn_override.as_deref(), Some("black"));
        assert!(dto.turn_indicator.as_deref().unwrap().contains("手动模式"));
    }

    #[test]
    fn link_board_preview_crops_detected_board_instead_of_full_capture() {
        let mut image = image::RgbaImage::new(300, 200);
        for y in 0..200 {
            for x in 0..300 {
                let color = if x < 90 {
                    image::Rgba([210, 210, 210, 255])
                } else {
                    image::Rgba([180, 130, 70, 255])
                };
                image.put_pixel(x, y, color);
            }
        }
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut source, image::ImageFormat::Png)
            .unwrap();

        let cropped =
            crop_png_by_bounds(source.get_ref(), (100.0, 40.0, 120.0, 120.0), 0.0).unwrap();
        let cropped = image::load_from_memory(&cropped).unwrap().to_rgba8();

        assert_eq!((cropped.width(), cropped.height()), (128, 128));
        assert_eq!(cropped.get_pixel(0, 0), &image::Rgba([180, 130, 70, 255]));
    }

    #[test]
    fn link_region_crop_uses_selector_ratios_instead_of_screen_coordinates() {
        let mut image = image::RgbaImage::new(200, 100);
        for y in 0..100 {
            for x in 0..200 {
                let color = if x < 100 {
                    image::Rgba([220, 20, 20, 255])
                } else {
                    image::Rgba([20, 180, 60, 255])
                };
                image.put_pixel(x, y, color);
            }
        }
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut source, image::ImageFormat::Png)
            .unwrap();
        let region = LinkCaptureRegion {
            x: 900,
            y: 500,
            width: 100,
            height: 100,
            selection_x: 100.0,
            selection_y: 0.0,
            selection_width: 100.0,
            selection_height: 100.0,
            selector_width: 200.0,
            selector_height: 100.0,
        };

        let cropped = crop_link_capture_frame(source.get_ref(), region).unwrap();
        let cropped = image::load_from_memory(&cropped).unwrap().to_rgba8();

        assert_eq!((cropped.width(), cropped.height()), (100, 100));
        assert_eq!(cropped.get_pixel(0, 0), &image::Rgba([20, 180, 60, 255]));
    }

    #[test]
    fn window_link_expands_tracking_region_without_leaving_selector() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1000.0,
            selector_height: 800.0,
        };

        let expanded = expand_link_capture_region(region);

        assert!(expanded.selection_x < region.selection_x);
        assert!(expanded.selection_y < region.selection_y);
        assert!(expanded.selection_width > region.selection_width);
        assert!(expanded.selection_height > region.selection_height);
        assert!(expanded.selection_x >= 0.0);
        assert!(expanded.selection_y >= 0.0);
        assert!(expanded.selection_x + expanded.selection_width <= expanded.selector_width + 0.01);
        assert!(
            expanded.selection_y + expanded.selection_height <= expanded.selector_height + 0.01
        );
    }

    #[test]
    fn link_floating_panel_overlap_guard_ignores_expanded_capture_margin() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        let expanded = expand_link_capture_region(region);
        let guard = link_capture_guard_region(region);
        let floating_panel_on_capture_margin =
            (expanded.x as f64 + 8.0, region.y as f64 + 24.0, 56.0, 180.0);

        assert!(rects_intersect(
            floating_panel_on_capture_margin,
            link_region_rect(expanded)
        ));
        assert!(!rects_intersect(
            floating_panel_on_capture_margin,
            link_region_rect(guard)
        ));
    }

    #[test]
    fn link_capture_uses_original_region_when_expanded_margin_is_polluted() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        assert_eq!(
            select_link_capture_frame_region(Some(region), true),
            Some(region)
        );
        assert_eq!(
            select_link_capture_frame_region(Some(region), false),
            Some(expand_link_capture_region(region))
        );
    }

    #[test]
    fn window_link_recenters_tracking_region_from_detected_board_bounds() {
        let search_region = LinkCaptureRegion {
            x: 100,
            y: 80,
            width: 800,
            height: 640,
            selection_x: 100.0,
            selection_y: 80.0,
            selection_width: 800.0,
            selection_height: 640.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        let next = link_region_around_board_bounds(search_region, (380.0, 260.0, 420.0, 420.0));

        assert!(next.x < 380);
        assert!(next.y < 260);
        assert!(next.x + next.width > 800);
        assert!(next.y + next.height > 680);
        assert!(next.width < search_region.width);
        assert!(next.height < search_region.height);
    }

    #[test]
    fn link_capture_bounds_convert_retina_pixels_back_to_screen_points() {
        let region = LinkCaptureRegion {
            x: 500,
            y: 300,
            width: 200,
            height: 100,
            selection_x: 500.0,
            selection_y: 300.0,
            selection_width: 200.0,
            selection_height: 100.0,
            selector_width: 1000.0,
            selector_height: 600.0,
        };

        let bounds =
            map_capture_bounds_to_screen((20.0, 10.0, 160.0, 80.0), region, Some((400, 200)));

        assert_eq!(bounds, (510.0, 305.0, 80.0, 40.0));
    }

    #[test]
    fn link_engine_click_points_follow_arrow_one_iccs_move() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);

        let points = link_move_click_points(bounds, link_core::BoardOrientation::RedAtBottom, mv);

        assert_eq!(points.0, (150.0, 550.0));
        assert_eq!(points.1, (200.0, 550.0));
    }

    #[test]
    fn link_engine_click_points_flip_for_black_bottom_board() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);

        let points = link_move_click_points(bounds, link_core::BoardOrientation::BlackAtBottom, mv);

        assert_eq!(points.0, (450.0, 300.0));
        assert_eq!(points.1, (400.0, 300.0));
    }

    #[test]
    fn link_engine_click_uses_detected_piece_center_for_start_square() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);
        let detected = LinkPieceClickCenter {
            square: mv.from,
            x: 153.0,
            y: 556.0,
            confidence: 0.91,
        };

        let points = link_move_click_points_for_click(
            bounds,
            link_core::BoardOrientation::RedAtBottom,
            mv,
            Some(detected),
        );

        assert_eq!(points.0, (153.0, 556.0));
        assert_eq!(points.1, (200.0, 550.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn confirm_click_script_selects_only_the_start_piece() {
        let script = macos_link_click_script(153.0, 556.0, 200.0, 550.0, false);

        assert!(script.contains("click at {153, 556}"));
        assert!(!script.contains("click at {200, 550}"));
        assert!(script.contains("set frontmost of proc to true"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn auto_play_click_script_clicks_the_target_square() {
        let script = macos_link_click_script(153.0, 556.0, 200.0, 550.0, true);

        assert!(script.contains("click at {153, 556}"));
        assert!(script.contains("click at {200, 550}"));
    }

    #[test]
    fn link_piece_click_centers_map_retina_frame_to_screen_points() {
        let region = LinkCaptureRegion {
            x: 100,
            y: 200,
            width: 400,
            height: 400,
            selection_x: 100.0,
            selection_y: 200.0,
            selection_width: 400.0,
            selection_height: 400.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };
        let board = link_vision::Detection {
            label: '0',
            confidence: 0.99,
            alternatives: vec![('0', 0.99)],
            center_x: 400.0,
            center_y: 420.0,
            width: 640.0,
            height: 720.0,
        };
        let red_cannon = link_vision::Detection {
            label: 'C',
            confidence: 0.9,
            alternatives: vec![('C', 0.9)],
            center_x: 166.0,
            center_y: 618.0,
            width: 48.0,
            height: 48.0,
        };

        let centers = link_piece_click_centers(
            &[board.clone(), red_cannon],
            link_vision::board_bounds(&[board]).unwrap(),
            link_core::BoardOrientation::RedAtBottom,
            Some(region),
            Some((800, 800)),
        );

        let center = centers
            .iter()
            .find(|center| center.square == (Square { row: 7, col: 1 }))
            .expect("red cannon center");
        assert_eq!((center.x.round(), center.y.round()), (183.0, 509.0));
    }

    #[test]
    fn link_status_dto_exposes_capture_diagnostics() {
        let mut session = LinkSession::default();
        session.reason = Some("框选预览未识别到可同步棋盘".into());
        session.phase = Some("waiting_recognition".into());
        session.last_error = Some("模型推理异常".into());
        session.started_at = Some(Utc::now());
        session.last_heartbeat_at = Some(Utc::now());
        session.recognition_attempts = 2;
        session.board_orientation = BoardOrientation::BlackAtBottom;
        session.last_detection_summary =
            Some("框选预览检测：棋盘框 1 个，棋子 20 个，平均置信度 82%".into());
        session.last_move_detail = Some(LinkMoveDetailDto {
            iccs: "h2e2".into(),
            notation: "炮二平五".into(),
            moved_by: "红方",
            from: SquareDto { row: 7, col: 7 },
            to: SquareDto { row: 7, col: 4 },
        });

        let dto = link_status_dto(&session);

        assert_eq!(dto.phase.as_deref(), Some("waiting_recognition"));
        assert_eq!(dto.last_error.as_deref(), Some("模型推理异常"));
        assert_eq!(dto.recognition_attempts, 2);
        assert_eq!(dto.board_orientation, BoardOrientation::BlackAtBottom);
        assert_eq!(dto.last_move_detail.as_ref().unwrap().notation, "炮二平五");
        assert!(dto.started_at.is_some());
        assert!(dto.last_heartbeat_at.is_some());
        assert!(
            dto.last_detection_summary
                .as_deref()
                .unwrap()
                .contains("棋子 20 个")
        );
    }

    #[test]
    fn link_recognition_accepts_tiantian_style_sixty_one_percent_confidence() {
        let state = desktop_state_for_link_tests();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.capture_generation = 3;
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, STARTING_FEN.into(), Some(0.61), Some(3))
                .unwrap();
        let session = state.link_session.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::Tracking);
        assert_eq!(session.state, LinkSessionState::Tracking);
        assert!(session.capture_running);
        assert_eq!(session.confidence, Some(0.61));
    }

    #[test]
    fn window_link_apply_move_exposes_last_move_detail_for_mini_board() {
        let state = desktop_state_for_link_tests();
        let next_fen = Board::from_fen(STARTING_FEN)
            .unwrap()
            .apply_move(Move::from_iccs("h2e2").unwrap())
            .unwrap()
            .to_fen();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 6;
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, next_fen, Some(0.91), Some(6)).unwrap();
        let session = state.link_session.lock().unwrap();
        let detail = session.last_move_detail.as_ref().unwrap();

        assert!(observation.accepted);
        assert_eq!(session.phase.as_deref(), Some("move_synced"));
        assert_eq!(session.last_move.as_deref(), Some("h2e2"));
        assert_eq!(detail.iccs, "h2e2");
        assert_eq!(detail.moved_by, "红方");
        assert_eq!(detail.notation, "炮二平五");
        assert_eq!((detail.from.row, detail.from.col), (7, 7));
        assert_eq!((detail.to.row, detail.to.col), (7, 4));
    }

    #[test]
    fn pending_confirmed_link_move_ignores_turn_indicator_flicker() {
        let state = desktop_state_for_link_tests();
        let flicker_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.mode = LinkMode::ConfirmPlay;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 7;
            session.pending_external_move = Some("g6g5".into());
            session.pending_expected_fen = Some("expected".into());
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, flicker_fen, Some(0.91), Some(7)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(!observation.accepted);
        assert!(observation.board.is_none());
        assert_eq!(session.pending_external_move.as_deref(), Some("g6g5"));
        assert!(
            session
                .reason
                .as_deref()
                .unwrap()
                .contains("等待网页棋盘完成走子")
        );
        assert!(model.board.to_fen().contains(" w "));
    }

    #[test]
    fn unstable_live_side_flicker_keeps_the_last_stable_board() {
        let state = desktop_state_for_link_tests();
        let flicker_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.latest_fen = Some(STARTING_FEN.into());
            session.capture_generation = 8;
            session.confidence_threshold = 0.55;
            session.gate = StabilityGate::new(2);
            reset_link_stability_progress(&mut session);
        }

        let observation =
            observe_link_recognition_inner(&state, flicker_fen, Some(0.91), Some(8)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(!observation.accepted);
        assert!(observation.board.is_none());
        assert_eq!(observation.state, LinkSessionState::WaitingStableFrames);
        assert_eq!(session.latest_fen.as_deref(), Some(STARTING_FEN));
        assert_eq!(session.stable_frames, 1);
        assert_eq!(session.required_stable_frames, 2);
        assert!(model.board.to_fen().contains(" w "));
    }

    #[test]
    fn live_side_change_requires_extra_stability_before_updating_turn() {
        let state = desktop_state_for_link_tests();
        let black_to_move_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.latest_fen = Some(STARTING_FEN.into());
            session.capture_generation = 9;
            session.confidence_threshold = 0.55;
            session.gate = StabilityGate::new(2);
            reset_link_stability_progress(&mut session);
        }

        for _ in 0..3 {
            let observation = observe_link_recognition_inner(
                &state,
                black_to_move_fen.clone(),
                Some(0.91),
                Some(9),
            )
            .unwrap();
            assert!(!observation.accepted);
        }
        {
            let session = state.link_session.lock().unwrap();
            let model = state.model.lock().unwrap();
            assert_eq!(session.phase.as_deref(), Some("waiting_side_stability"));
            assert_eq!(session.latest_fen.as_deref(), Some(STARTING_FEN));
            assert_eq!(session.stable_frames, 3);
            assert_eq!(session.required_stable_frames, 4);
            assert!(model.board.to_fen().contains(" w "));
        }

        let observation =
            observe_link_recognition_inner(&state, black_to_move_fen, Some(0.91), Some(9)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(observation.accepted);
        assert_eq!(session.state, LinkSessionState::Tracking);
        assert!(session.latest_fen.as_deref().unwrap().contains(" b "));
        assert!(model.board.to_fen().contains(" b "));
    }

    #[test]
    fn window_link_syncs_legal_web_manual_position_jumps() {
        let state = desktop_state_for_link_tests();
        let mut jumped = Board::from_fen(STARTING_FEN).unwrap();
        jumped = jumped
            .apply_move(xiangqi_core::Move::from_iccs("h2e2").unwrap())
            .unwrap();
        jumped = jumped
            .apply_move(xiangqi_core::Move::from_iccs("h9g7").unwrap())
            .unwrap();
        let jumped_fen = jumped.to_fen();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 5;
            session.confidence_threshold = 0.55;
        }

        for _ in 0..4 {
            let observation =
                observe_link_recognition_inner(&state, jumped_fen.clone(), Some(0.88), Some(5))
                    .unwrap();
            assert!(!observation.accepted);
            assert_eq!(observation.state, LinkSessionState::WaitingStableFrames);
        }
        let observation =
            observe_link_recognition_inner(&state, jumped_fen.clone(), Some(0.88), Some(5))
                .unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::Tracking);
        assert!(observation.accepted);
        assert_eq!(observation.board.as_ref().unwrap().fen, jumped_fen);
        assert_eq!(model.board.to_fen(), jumped_fen);
        assert_eq!(session.latest_fen.as_deref(), Some(jumped_fen.as_str()));
        assert_eq!(session.phase.as_deref(), Some("position_jump_synced"));
        assert!(session.last_move_detail.is_none());
        assert!(session.reason.as_deref().unwrap().contains("网页棋谱跳转"));
    }

    #[test]
    fn low_confidence_link_recognition_warns_without_stopping_capture() {
        let state = desktop_state_for_link_tests();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.capture_generation = 4;
            session.confidence_threshold = 0.70;
        }

        let observation =
            observe_link_recognition_inner(&state, STARTING_FEN.into(), Some(0.61), Some(4))
                .unwrap();
        let session = state.link_session.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::ClassifyingSquares);
        assert_eq!(session.phase.as_deref(), Some("low_confidence"));
        assert!(session.capture_running);
        assert!(session.reason.as_deref().unwrap().contains("继续采集中"));
    }

    #[test]
    fn link_vision_candidates_cover_tauri_bundle_resource_layout() {
        let base = PathBuf::from("/Applications/Xiangqi Studio.app/Contents/Resources");
        let candidates = link_vision_candidates(&base);
        assert!(candidates.contains(&base.join("link-vision/yolov11.onnx")));
        assert!(candidates.contains(&base.join("resources/link-vision/yolov11.onnx")));
    }

    #[test]
    fn link_vision_candidates_cover_development_resource_layout() {
        let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let candidates = link_vision_candidates(&resource_dir);
        assert!(candidates.contains(&resource_dir.join("link-vision/yolov11.onnx")));
        assert!(resource_dir.join("link-vision/yolov11.onnx").is_file());
    }

    #[test]
    fn master_style_seed_candidates_cover_development_resource_layout() {
        let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let candidates = master_style_seed_candidates(&resource_dir);
        assert!(candidates.contains(&resource_dir.join("master-style")));
        assert!(
            resource_dir
                .join("master-style/seed-manifest.json")
                .is_file()
        );
    }

    #[test]
    fn bundled_master_style_seed_files_parse_into_four_profiles() {
        let seed_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/master-style");
        let imports = imported_master_style_profiles_from_files(
            &seed_dir.join("master-style-profiles.json"),
            &seed_dir.join("master-style-samples.jsonl"),
            &seed_dir.join("master-style-analysis.jsonl"),
        )
        .unwrap();
        let players = imports
            .iter()
            .map(|(profile, _)| profile.player_name.as_str())
            .collect::<std::collections::HashSet<_>>();
        let sample_count: usize = imports.iter().map(|(_, samples)| samples.len()).sum();
        assert_eq!(imports.len(), 4);
        assert!(players.contains("赵鑫鑫"));
        assert!(players.contains("许银川"));
        assert!(players.contains("王天一"));
        assert!(players.contains("郑惟桐"));
        assert_eq!(sample_count, 12_000);
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
            engine_path: "/engines/external-fairy-stockfish".into(),
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
    fn chinese_line_parser_resolves_sequential_chinese_notation() {
        let parsed = parse_chinese_line(
            STARTING_FEN.into(),
            vec!["炮二平五".into(), "马8进7".into()],
        )
        .unwrap();

        assert_eq!(parsed.moves, vec!["h2e2", "h9g7"]);
        assert_eq!(parsed.steps.len(), 2);
        assert_eq!(parsed.steps[0].notation, "炮二平五");
        assert_eq!(parsed.steps[1].notation, "马8进7");
    }

    #[test]
    fn chinese_line_parser_reports_the_illegal_step_in_chinese() {
        let error = parse_chinese_line(
            STARTING_FEN.into(),
            vec!["炮二平五".into(), "车九退十".into()],
        )
        .err()
        .unwrap();

        assert!(error.contains("第 2 步"));
        assert!(error.contains("合法中文着法"));
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
        preferences.candidate_line_moves = 18;
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "每种后续必须在 5 到 8 个回合之间"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.rule_mode = "tiantian".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的棋规模式"
        );
    }

    #[test]
    fn builtin_opening_book_preferences_validate_and_normalize() {
        let mut preferences = DesktopPreferences::default();
        preferences.active_builtin_opening_book_id = "complete-compatible".into();
        assert!(validate_preferences(&preferences).is_ok());

        preferences.active_builtin_opening_book_id = "unknown-book".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的内嵌开局库"
        );
        normalize_desktop_preferences(&mut preferences);
        assert_eq!(
            preferences.active_builtin_opening_book_id,
            pfbook_opening_book::DEFAULT_BUILTIN_OPENING_BOOK_ID
        );
        assert!(validate_preferences(&preferences).is_ok());
    }

    #[test]
    fn desktop_preferences_migrate_old_depth_defaults_to_twenty_four() {
        let mut preferences = DesktopPreferences::default();
        preferences.search_mode = "depth".into();
        preferences.search_value = 30;
        preferences.report_depth = 30;
        preferences.auto_analyze = true;

        normalize_desktop_preferences(&mut preferences);

        assert_eq!(preferences.search_mode, "depth");
        assert_eq!(preferences.search_value, 24);
        assert_eq!(preferences.report_depth, 24);
        assert!(!preferences.auto_analyze);

        let mut custom = DesktopPreferences::default();
        custom.search_mode = "depth".into();
        custom.search_value = 22;
        custom.report_depth = 22;
        normalize_desktop_preferences(&mut custom);
        assert_eq!(custom.search_value, 22);
        assert_eq!(custom.report_depth, 22);
    }

    #[test]
    fn desktop_preferences_remove_legacy_bundled_fairy_engine() {
        let mut preferences = DesktopPreferences::default();
        preferences.engine_path = BUILTIN_FAIRY_ENGINE_PATH.into();
        preferences.active_engine_id = Some(Uuid::new_v4());
        preferences.parallel_engine_paths = vec![
            BUILTIN_ENGINE_PATH.into(),
            BUILTIN_FAIRY_ENGINE_PATH.into(),
            "/external/fairy-stockfish".into(),
        ];

        normalize_desktop_preferences(&mut preferences);

        assert_eq!(preferences.engine_path, BUILTIN_ENGINE_PATH);
        assert_eq!(preferences.active_engine_id, None);
        assert_eq!(
            preferences.parallel_engine_paths,
            vec![BUILTIN_ENGINE_PATH.to_owned()]
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

    #[test]
    fn flyknife_templates_resolve_to_legal_positions() {
        let templates = flyknife_templates();
        assert!(templates.len() >= 8, "templates: {}", templates.len());
        for template in templates {
            assert!(Board::from_fen(&template.fen).is_ok(), "{}", template.name);
        }
    }

    #[test]
    fn flyknife_accepts_chinese_lure_notation() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        assert_eq!(resolve_flyknife_lure(&board, "炮二平五").unwrap(), "h2e2");
        let after_red_cannon = board.apply_iccs("h2e2").unwrap();
        assert_eq!(
            resolve_flyknife_lure(&after_red_cannon, "马8进7").unwrap(),
            "h9g7"
        );
        assert_eq!(
            resolve_flyknife_lure(&after_red_cannon, "马８进７").unwrap(),
            "h9g7"
        );
    }

    #[test]
    fn flyknife_best_defense_is_presented_as_chinese_notation() {
        assert_eq!(
            flyknife_best_defense_notation(
                STARTING_FEN,
                &["h2e2".into(), "h9g7".into(), "b0c2".into()],
                "h9g7",
                &["b0c2".into()],
            ),
            ["马八进七"]
        );
    }

    #[test]
    fn flyknife_can_analyze_current_position_without_lure_when_attacker_to_move() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Red, "", "").unwrap();
        assert_eq!(setup, "");
        assert_eq!(lure, "");
        assert_eq!(before_lure.to_fen(), STARTING_FEN);
        assert_eq!(prepared.to_fen(), STARTING_FEN);
        let error = prepare_flyknife_position(&board, Color::Black, "", "")
            .expect_err("black cannot move directly from red-to-move starting position");
        assert!(error.contains("请先填写一手对手诱导着法"), "{error}");
        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Black, "", "炮二平五").unwrap();
        assert_eq!(setup, "");
        assert_eq!(lure, "h2e2");
        assert_eq!(before_lure.side_to_move(), Color::Red);
        assert_eq!(prepared.side_to_move(), Color::Black);

        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Red, "炮二平五", "马8进7").unwrap();
        assert_eq!(setup, "h2e2");
        assert_eq!(lure, "h9g7");
        assert_eq!(before_lure.side_to_move(), Color::Black);
        assert_eq!(prepared.side_to_move(), Color::Red);
    }

    #[test]
    fn flyknife_topics_list_bundled_starter_pack() {
        let topics = flyknife_topics();
        assert_eq!(topics.len(), 12);
        assert!(topics.iter().any(|topic| topic.title.contains("仙人指路")));
        assert_eq!(
            flyknife_topic_file_name("pingfeng-po-guoheche"),
            Some("06-15屏风马破中炮过河车.pgn")
        );
    }

    #[test]
    fn flyknife_topic_candidates_cover_packaged_resource_layout() {
        let base = PathBuf::from("/Applications/Xiangqi Studio.app/Contents/Resources");
        let candidates = flyknife_topic_candidates(&base, "01-34仙人指路对卒底炮-一.pgn");
        assert!(candidates.contains(
            &base.join("resources/flyknife-library/single-pgn/01-34仙人指路对卒底炮-一.pgn")
        ));
        assert!(
            candidates
                .contains(&base.join("flyknife-library/single-pgn/01-34仙人指路对卒底炮-一.pgn"))
        );
    }

    #[test]
    fn training_system_seed_cards_cover_the_method_tags() {
        let cards = training_system_seed_cards();
        assert_eq!(cards.len(), 7);
        assert!(cards.iter().all(|card| {
            card.external_id.starts_with("training-system-")
                && card.review_status == "approved"
                && card.source_path.starts_with(TRAINING_SYSTEM_SOURCE_URL)
                && card
                    .source_book
                    .as_deref()
                    .is_some_and(|source| source.contains("方法论参考"))
        }));
        let tags = cards
            .iter()
            .flat_map(|card| card.tags.iter().map(String::as_str))
            .collect::<std::collections::HashSet<_>>();
        for tag in [
            "残局打底",
            "战术漏算",
            "候选着计算",
            "专属布局",
            "深度复盘",
            "慢棋训练",
            "心态管理",
        ] {
            assert!(tags.contains(tag), "missing {tag}");
        }
    }
}
