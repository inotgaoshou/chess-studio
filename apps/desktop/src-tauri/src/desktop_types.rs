use super::*;
use crate::engine_service::rule_mode_from_code;

pub(crate) const BUILTIN_ENGINE_PATH: &str = "builtin:pikafish";
pub(crate) const PIKAFISH_260720_NNUE_SHA256: &str =
    "3cd15292bf8c979884262f57fc723959fc0dea43b4d8d544f88db5ceb2479e24";
pub(crate) const PIKAFISH_260720_NNUE_LABEL: &str = "权重260720";
pub(crate) const THEORY_COURSE_ROOTS: [(&str, &str, &str); 3] = [
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
pub(crate) struct TheoryLibraryDto {
    pub(crate) lessons: Vec<TheoryLesson>,
    pub(crate) cards: Vec<TheoryCard>,
    pub(crate) downloading_files: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkCaptureRegion {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: i32,
    pub(crate) height: i32,
    pub(crate) selection_x: f64,
    pub(crate) selection_y: f64,
    pub(crate) selection_width: f64,
    pub(crate) selection_height: f64,
    pub(crate) selector_width: f64,
    pub(crate) selector_height: f64,
}

pub(crate) struct LinkSession {
    pub(crate) source: CaptureSource,
    pub(crate) recognition_mode: RecognitionMode,
    pub(crate) mode: LinkMode,
    pub(crate) state: LinkSessionState,
    pub(crate) gate: StabilityGate,
    pub(crate) reason: Option<String>,
    pub(crate) capture_preview: Option<String>,
    pub(crate) capture_preview_kind: Option<String>,
    pub(crate) frame_rate: f32,
    pub(crate) confidence: Option<f32>,
    pub(crate) confidence_threshold: f32,
    pub(crate) stable_frames: u8,
    pub(crate) required_stable_frames: u8,
    pub(crate) latest_fen: Option<String>,
    pub(crate) last_move: Option<String>,
    pub(crate) last_move_detail: Option<LinkMoveDetailDto>,
    pub(crate) initial_position_seen: bool,
    pub(crate) auto_side: Option<Color>,
    pub(crate) capture_running: bool,
    pub(crate) board_bounds: Option<(f32, f32, f32, f32)>,
    pub(crate) piece_click_centers: Vec<LinkPieceClickCenter>,
    pub(crate) board_capture_signature: Option<Vec<u8>>,
    pub(crate) target_region: Option<LinkCaptureRegion>,
    pub(crate) board_orientation: link_core::BoardOrientation,
    pub(crate) capture_generation: u64,
    pub(crate) started_at: Option<DateTime<Utc>>,
    pub(crate) last_heartbeat_at: Option<DateTime<Utc>>,
    pub(crate) phase: Option<String>,
    pub(crate) last_error: Option<String>,
    pub(crate) recognition_attempts: u64,
    pub(crate) last_detection_summary: Option<String>,
    pub(crate) turn_indicator: Option<String>,
    pub(crate) manual_turn_override: Option<Color>,
    pub(crate) side_change_candidate: Option<Color>,
    pub(crate) side_change_candidate_frames: u8,
    pub(crate) pending_external_move: Option<String>,
    pub(crate) pending_expected_fen: Option<String>,
    pub(crate) screenshot_move_marker: Option<link_vision::ScreenshotMoveMarker>,
    /// The current manual-tree position from which the screenshot resolution
    /// was produced. Confirmation must use this exact position; otherwise a
    /// stale dialog could write a variation below a different node.
    pub(crate) screenshot_resolution_before_fen: Option<String>,
    /// Binds the resolution to one image-recognition run. Re-selecting an
    /// image invalidates all candidates from the prior image.
    pub(crate) screenshot_resolution_generation: Option<u64>,
    /// Exact screenshot candidates and the manual recovery path have
    /// different confirmation rules.  Keeping this on the session prevents a
    /// caller from turning a failed YOLO comparison into an arbitrary tree
    /// edit just by submitting a legal ICCS move.
    pub(crate) screenshot_resolution_mode: Option<ScreenshotResolutionMode>,
    /// FEN alone is not a tree identity: repetitions can reach the exact same
    /// position below a different branch, or even another game. Keep the
    /// document and parent node that produced a screenshot proposal so a stale
    /// dialog cannot write below a look-alike position.
    pub(crate) screenshot_resolution_game_id: Option<Uuid>,
    /// `Some(None)` means the root node; `None` means no active resolution.
    pub(crate) screenshot_resolution_current_node: Option<Option<Uuid>>,
    /// Only a resolver candidate, or a legal manual preview produced by this
    /// session, may be confirmed. This closes the last client-side path for
    /// adding an arbitrary legal move while a screenshot dialog is open.
    pub(crate) screenshot_resolution_allowed_moves: Vec<String>,
    pub(crate) target_window: Option<LinkTargetWindowDto>,
    pub(crate) capture_backend: Option<String>,
    pub(crate) capture_dpi: Option<u32>,
    pub(crate) capture_window_geometry: Option<LinkWindowGeometry>,
    pub(crate) click_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScreenshotResolutionMode {
    ExactPlacement,
    ManualFallback,
}

#[derive(Debug, Clone)]
pub(crate) struct ScreenshotResolutionBinding {
    pub(crate) recognized_after_fen: Option<String>,
    pub(crate) before_fen: String,
    pub(crate) generation: u64,
    pub(crate) mode: ScreenshotResolutionMode,
    pub(crate) game_id: Uuid,
    pub(crate) current_node: Option<Uuid>,
    pub(crate) allowed_moves: Vec<String>,
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
            board_capture_signature: None,
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
            side_change_candidate: None,
            side_change_candidate_frames: 0,
            pending_external_move: None,
            pending_expected_fen: None,
            screenshot_move_marker: None,
            screenshot_resolution_before_fen: None,
            screenshot_resolution_generation: None,
            screenshot_resolution_mode: None,
            screenshot_resolution_game_id: None,
            screenshot_resolution_current_node: None,
            screenshot_resolution_allowed_moves: Vec::new(),
            target_window: None,
            capture_backend: None,
            capture_dpi: None,
            capture_window_geometry: None,
            click_available: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LinkPieceClickCenter {
    pub(crate) square: Square,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) confidence: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncAccountDto {
    pub(crate) server_url: String,
    pub(crate) user_id: Option<Uuid>,
    pub(crate) email: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) last_sync_result: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterPlayerDto {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) source_site: String,
    pub(crate) source_player_id: String,
    pub(crate) profile_url: String,
    pub(crate) game_count: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterLibraryStatsDto {
    pub(crate) total_players: u64,
    pub(crate) total_games: u64,
    pub(crate) matched_players: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterOpeningProfileDto {
    pub(crate) player_id: String,
    pub(crate) player_name: String,
    pub(crate) game_count: u64,
    pub(crate) red_games: u64,
    pub(crate) black_games: u64,
    pub(crate) wins: u64,
    pub(crate) draws: u64,
    pub(crate) losses: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterGameSummaryDto {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) red_player: String,
    pub(crate) black_player: String,
    pub(crate) master_side: Option<String>,
    pub(crate) event_name: Option<String>,
    pub(crate) game_date: Option<String>,
    pub(crate) result: String,
    pub(crate) move_count: u64,
    pub(crate) source_url: String,
    #[serde(default)]
    pub(crate) opening_tags: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterGameDetailDto {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) red_player: String,
    pub(crate) black_player: String,
    pub(crate) master_side: Option<String>,
    pub(crate) event_name: Option<String>,
    pub(crate) game_date: Option<String>,
    pub(crate) result: String,
    pub(crate) move_count: u64,
    pub(crate) source_url: String,
    pub(crate) moves: Vec<String>,
    pub(crate) pgn: String,
    #[serde(default)]
    pub(crate) opening_tags: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedMasterGameDto {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) red_player: String,
    pub(crate) black_player: String,
    pub(crate) master_side: Option<String>,
    pub(crate) event_name: Option<String>,
    pub(crate) game_date: Option<String>,
    pub(crate) result: String,
    pub(crate) move_count: u64,
    pub(crate) source_url: String,
    pub(crate) match_kind: String,
    pub(crate) matched_ply: u64,
    pub(crate) matched_fen: String,
    pub(crate) divergence_move: Option<String>,
    pub(crate) match_label: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionDto {
    pub(crate) plan: String,
    pub(crate) status: String,
    pub(crate) source: String,
    pub(crate) starts_at: String,
    pub(crate) expires_at: String,
    pub(crate) cloud_analysis_quota: u32,
    pub(crate) cloud_analysis_used: u32,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub(crate) struct AuthResponse {
    pub(crate) user_id: Uuid,
    pub(crate) token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineProbeDto {
    pub(crate) path: String,
    pub(crate) protocol: &'static str,
    pub(crate) engine_version: Option<String>,
    pub(crate) engine_sha256: Option<String>,
    pub(crate) nnue_file: Option<String>,
    pub(crate) nnue_version: Option<String>,
    pub(crate) nnue_sha256: Option<String>,
    pub(crate) fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineProfileDto {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) executable_path: String,
    pub(crate) protocol: String,
    pub(crate) active: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineArenaPlayerDto {
    pub(crate) name: String,
    pub(crate) engine_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineArenaOptionsDto {
    pub(crate) player_a: EngineArenaPlayerDto,
    pub(crate) player_b: EngineArenaPlayerDto,
    pub(crate) games: u32,
    pub(crate) move_time_ms: u64,
    pub(crate) threads: u32,
    pub(crate) hash_mb: u32,
    pub(crate) max_plies: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineArenaGameDto {
    pub(crate) index: u32,
    pub(crate) red: String,
    pub(crate) black: String,
    pub(crate) result: String,
    pub(crate) winner: Option<String>,
    pub(crate) reason: String,
    pub(crate) plies: u32,
    pub(crate) moves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineArenaScoreDto {
    pub(crate) name: String,
    pub(crate) wins: u32,
    pub(crate) draws: u32,
    pub(crate) losses: u32,
    pub(crate) points: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineArenaResultDto {
    pub(crate) player_a: EngineArenaScoreDto,
    pub(crate) player_b: EngineArenaScoreDto,
    pub(crate) games: Vec<EngineArenaGameDto>,
    pub(crate) move_time_ms: u64,
    pub(crate) max_plies: u32,
    pub(crate) rule_name: &'static str,
    pub(crate) summary: String,
}

pub(crate) struct EngineRuntime {
    pub(crate) path: String,
    pub(crate) session: EngineSession,
    pub(crate) pondering_fen: Option<String>,
    pub(crate) state: EngineRuntimeState,
}

#[derive(Clone, Copy)]
pub(crate) enum EngineRuntimeState {
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
pub(crate) enum EngineRuntimeEvent {
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

pub(crate) fn emit_engine_event(app: &tauri::AppHandle, event: EngineRuntimeEvent) {
    let _ = app.emit("engine-runtime", event);
}

pub(crate) fn emit_engine_state(app: &tauri::AppHandle, state: EngineRuntimeState) {
    emit_engine_event(
        app,
        EngineRuntimeEvent::State {
            state: state.as_str(),
        },
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PieceDto {
    pub(crate) row: u8,
    pub(crate) col: u8,
    pub(crate) color: &'static str,
    pub(crate) kind: &'static str,
    pub(crate) label: &'static str,
}

#[derive(Clone, Copy, Serialize)]
pub(crate) struct SquareDto {
    pub(crate) row: u8,
    pub(crate) col: u8,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkMoveDetailDto {
    pub(crate) iccs: String,
    pub(crate) notation: String,
    pub(crate) moved_by: &'static str,
    pub(crate) from: SquareDto,
    pub(crate) to: SquareDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveDto {
    pub(crate) id: Uuid,
    pub(crate) iccs: String,
    pub(crate) notation: String,
    pub(crate) moved_by: &'static str,
    pub(crate) from: SquareDto,
    pub(crate) to: SquareDto,
    pub(crate) score_cp: Option<i32>,
    pub(crate) mate: Option<i32>,
    pub(crate) comment: String,
    pub(crate) is_mainline: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ExportFormat {
    Pgn,
    Chinese,
    Dhtmlxq,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReplayExportScope {
    CurrentSelection,
    Mainline,
}

impl ExportFormat {
    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Pgn => "pgn",
            Self::Chinese | Self::Dhtmlxq => "txt",
        }
    }

    pub(crate) fn export(self, document: &ManualDocument) -> Result<String, String> {
        match self {
            Self::Pgn => Ok(export_pgn(document)),
            Self::Chinese => export_chinese_text(document).map_err(|error| error.to_string()),
            Self::Dhtmlxq => export_dhtmlxq(document).map_err(|error| error.to_string()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoardDto {
    pub(crate) fen: String,
    pub(crate) root_side_to_move: &'static str,
    pub(crate) root_score_cp: Option<i32>,
    pub(crate) root_mate: Option<i32>,
    pub(crate) side_to_move: &'static str,
    pub(crate) status: String,
    pub(crate) rule_name: &'static str,
    pub(crate) rule_verdict: &'static str,
    pub(crate) rule_reason: String,
    pub(crate) pieces: Vec<PieceDto>,
    pub(crate) history: Vec<MoveDto>,
    pub(crate) continuation: Vec<MoveDto>,
    pub(crate) branches: Vec<MoveDto>,
    pub(crate) sibling_branches: Vec<MoveDto>,
    pub(crate) manual_tree: Vec<ManualTreeNodeDto>,
    pub(crate) current_node: Option<Uuid>,
    pub(crate) title: String,
    pub(crate) note: String,
    pub(crate) source_path: Option<String>,
    pub(crate) source_format: Option<String>,
    pub(crate) playable: bool,
    #[serde(default)]
    pub(crate) xqb_candidates: Vec<xqb_opening_book::XqbCandidateDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTreeNodeDto {
    #[serde(rename = "move")]
    pub(crate) move_: MoveDto,
    pub(crate) children: Vec<ManualTreeNodeDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewLineStepDto {
    pub(crate) fen: String,
    pub(crate) notation: String,
    pub(crate) moved_by: &'static str,
    pub(crate) from: SquareDto,
    pub(crate) to: SquareDto,
    pub(crate) pieces: Vec<PieceDto>,
    pub(crate) status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecognizedLastMovePreviewDto {
    #[serde(flatten)]
    pub(crate) step: PreviewLineStepDto,
    pub(crate) before_fen: String,
    pub(crate) after_fen: String,
    pub(crate) side_to_move: &'static str,
    pub(crate) captured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) marker_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recognition_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recognition_confidence: Option<u32>,
}

/// The only automatic screenshot-to-move result exposed to the UI.  The
/// candidates are all legal moves from the current document whose *resulting
/// piece placement* exactly matches the YOLO-recognized screenshot position.
/// Screenshot rings are deliberately not a source of candidates; they only
/// sort this already rule-validated set.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotMoveResolutionDto {
    /// `unique`, `ambiguous`, or `noExactMatch`.
    pub(crate) status: &'static str,
    pub(crate) candidates: Vec<RecognizedLastMovePreviewDto>,
    pub(crate) orientation: BoardOrientation,
    /// Manual fallback always starts from the current document, never from a
    /// possibly mismatched screenshot board.
    pub(crate) current_pieces: Vec<PieceDto>,
    pub(crate) current_side_to_move: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameSummaryDto {
    pub(crate) id: Uuid,
    pub(crate) title: String,
    pub(crate) fen: String,
    pub(crate) updated_at: String,
    pub(crate) current: bool,
    pub(crate) library_folder: Option<String>,
    pub(crate) favorite: bool,
    pub(crate) tags: Vec<String>,
    pub(crate) mirror: Option<GameMirrorStatusDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameMirrorStatusDto {
    pub(crate) game_id: Uuid,
    pub(crate) path: Option<String>,
    pub(crate) state: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) error: Option<String>,
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
pub(crate) struct LibraryFolderDto {
    pub(crate) name: String,
    pub(crate) system: bool,
    pub(crate) game_count: u32,
}

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisLine {
    pub(crate) depth: Option<u32>,
    pub(crate) score_cp: Option<i32>,
    pub(crate) mate: Option<i32>,
    pub(crate) nps: Option<u64>,
    pub(crate) time_ms: Option<u64>,
    pub(crate) hashfull: Option<u32>,
    pub(crate) multipv: u32,
    #[serde(default)]
    pub(crate) notation: Vec<String>,
    pub(crate) pv: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameReportMoveDto {
    pub(crate) node_id: Uuid,
    #[serde(default)]
    pub(crate) iccs: String,
    pub(crate) notation: String,
    pub(crate) moved_by: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningBookHitDto {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) ply: usize,
    pub(crate) source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameReportPositionDto {
    pub(crate) fen: String,
    pub(crate) side_to_move: String,
    pub(crate) ply: usize,
    pub(crate) phase: String,
    pub(crate) material: u32,
    pub(crate) score_cp: Option<i32>,
    pub(crate) mate: Option<i32>,
    pub(crate) depth: Option<u32>,
    pub(crate) elapsed_ms: Option<u64>,
    #[serde(default)]
    pub(crate) cached: bool,
    #[serde(default)]
    pub(crate) best_iccs: Option<String>,
    #[serde(default)]
    pub(crate) best_notation: Option<String>,
    #[serde(default)]
    pub(crate) pv_notation: Vec<String>,
    #[serde(default)]
    pub(crate) opening: Option<OpeningBookHitDto>,
    #[serde(default)]
    pub(crate) master_style_hints: Vec<MasterStyleHint>,
    #[serde(rename = "move")]
    pub(crate) move_: Option<GameReportMoveDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportMasterStyleProfileRequest {
    pub(crate) profile_path: Option<String>,
    pub(crate) samples_path: Option<String>,
    pub(crate) analysis_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterStyleImportResultDto {
    pub(crate) profiles: Vec<MasterStyleProfile>,
    pub(crate) imported_samples: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterStyleSeedManifest {
    pub(crate) seed_id: String,
    #[serde(default)]
    pub(crate) players: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameReportDatasetDto {
    pub(crate) game_id: Uuid,
    pub(crate) line_signature: String,
    pub(crate) engine_fingerprint: String,
    pub(crate) config_hash: String,
    pub(crate) generated_at: String,
    pub(crate) stale: bool,
    #[serde(default)]
    pub(crate) analysis_depth: Option<u32>,
    #[serde(default)]
    pub(crate) cached_positions: usize,
    pub(crate) positions: Vec<GameReportPositionDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameReportProgressDto {
    pub(crate) completed: usize,
    pub(crate) total: usize,
    pub(crate) node_id: Option<Uuid>,
    pub(crate) elapsed_ms: u64,
    pub(crate) target_depth: Option<u32>,
    pub(crate) current_depth: Option<u32>,
    pub(crate) cached: usize,
    pub(crate) estimated_remaining_ms: Option<u64>,
    pub(crate) state: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrainingTaskDto {
    pub(crate) id: Uuid,
    pub(crate) game_id: Uuid,
    pub(crate) node_id: Uuid,
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) phase: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) source_card_id: Option<i64>,
    pub(crate) task_type: String,
    pub(crate) source_type: String,
    pub(crate) training_mode: String,
    pub(crate) opening_name: Option<String>,
    pub(crate) last_reviewed_at: Option<String>,
    pub(crate) next_review_at: Option<String>,
    pub(crate) mastered: bool,
    pub(crate) completed_at: Option<String>,
    pub(crate) created_at: String,
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
            source_type: task.source_type,
            training_mode: task.training_mode,
            opening_name: task.opening_name,
            last_reviewed_at: task.last_reviewed_at,
            next_review_at: task.next_review_at,
            mastered: task.mastered,
            completed_at: task.completed_at,
            created_at: task.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrainingGenerationResultDto {
    pub(crate) tasks: Vec<TrainingTaskDto>,
    pub(crate) critical_count: usize,
    pub(crate) reinforcement_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlyknifeTemplateDto {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) moves: Vec<String>,
    pub(crate) fen: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlyknifeTopicDto {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    pub(crate) opening: &'static str,
    pub(crate) category: &'static str,
    pub(crate) source: &'static str,
    pub(crate) move_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookImportDraftDto {
    pub(crate) image_path: String,
    pub(crate) raw_text: String,
    pub(crate) confidence: f32,
    pub(crate) title: String,
    pub(crate) red_player: String,
    pub(crate) black_player: String,
    pub(crate) event_name: String,
    pub(crate) moves_text: String,
    pub(crate) warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveBookImportRequest {
    pub(crate) image_path: String,
    pub(crate) raw_text: String,
    pub(crate) title: String,
    pub(crate) red_player: String,
    pub(crate) black_player: String,
    pub(crate) event_name: String,
    pub(crate) moves_text: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlyknifePlanDto {
    pub(crate) id: Option<Uuid>,
    pub(crate) title: String,
    pub(crate) side: String,
    pub(crate) starting_fen: String,
    pub(crate) template_id: Option<String>,
    pub(crate) template_name: String,
    pub(crate) lure_move: String,
    pub(crate) knife_move: String,
    pub(crate) mainline: Vec<String>,
    pub(crate) best_defense: Vec<String>,
    pub(crate) score_cp: Option<i64>,
    pub(crate) mate: Option<i64>,
    #[serde(default)]
    pub(crate) baseline_score_cp: Option<i64>,
    #[serde(default)]
    pub(crate) swing_cp: Option<i64>,
    #[serde(default = "default_flyknife_verification")]
    pub(crate) verification: String,
    #[serde(default)]
    pub(crate) verification_depth: Option<i64>,
    pub(crate) risk: String,
    pub(crate) source_game_id: Option<Uuid>,
    pub(crate) source_node_id: Option<Uuid>,
    pub(crate) note: String,
    #[serde(default)]
    pub(crate) annotations: Vec<FlyknifeStepAnnotationDto>,
}

pub(crate) fn default_flyknife_verification() -> String {
    "资料案例".into()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlyknifeStepAnnotationDto {
    pub(crate) role: String,
    pub(crate) iccs: String,
    pub(crate) notation: String,
    pub(crate) side: String,
    pub(crate) fen: Option<String>,
    pub(crate) score_cp: Option<i64>,
    pub(crate) swing_cp: Option<i64>,
    pub(crate) intent: String,
    pub(crate) note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateFlyknifeRequest {
    pub(crate) starting_fen: String,
    pub(crate) side: String,
    pub(crate) setup_move: Option<String>,
    pub(crate) lure_move: String,
    pub(crate) engine_path: String,
    pub(crate) threads: u32,
    pub(crate) hash_mb: u32,
    pub(crate) search_mode: String,
    pub(crate) search_value: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlyknifeCandidateDto {
    pub(crate) setup_move: Option<String>,
    pub(crate) setup_notation: Option<String>,
    pub(crate) lure_move: String,
    pub(crate) lure_notation: Option<String>,
    pub(crate) knife_move: String,
    pub(crate) mainline: Vec<String>,
    pub(crate) notation: Vec<String>,
    pub(crate) best_defense: Vec<String>,
    pub(crate) best_defense_notation: Vec<String>,
    pub(crate) score_cp: Option<i64>,
    pub(crate) baseline_score_cp: Option<i64>,
    pub(crate) swing_cp: Option<i64>,
    pub(crate) mate: Option<i64>,
    pub(crate) verification: String,
    pub(crate) verification_depth: Option<u32>,
    pub(crate) risk: String,
    pub(crate) annotations: Vec<FlyknifeStepAnnotationDto>,
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
            baseline_score_cp: plan.baseline_score_cp,
            swing_cp: plan.swing_cp,
            verification: plan.verification,
            verification_depth: plan.verification_depth,
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
pub(crate) struct TheoryFeedbackRequest {
    pub(crate) match_id: Option<Uuid>,
    pub(crate) card_id: i64,
    pub(crate) card_version: i64,
    pub(crate) verdict: String,
    pub(crate) note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrainingSummaryDto {
    pub(crate) weak_spots: Vec<WeaknessStat>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncResult {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
    pub(crate) cursor: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineMoveDto {
    pub(crate) board: BoardDto,
    pub(crate) ponder: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartLinkSessionRequest {
    pub(crate) source: CaptureSource,
    pub(crate) recognition_mode: RecognitionMode,
    pub(crate) mode: LinkMode,
    pub(crate) stable_frames: u8,
    pub(crate) auto_side: Option<String>,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) target_window_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkTargetWindowDto {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) process_name: String,
    pub(crate) client_width: i32,
    pub(crate) client_height: i32,
    pub(crate) dpi: u32,
    pub(crate) available: bool,
    pub(crate) unavailable_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkObservationDto {
    pub(crate) state: LinkSessionState,
    pub(crate) accepted: bool,
    pub(crate) move_iccs: Option<String>,
    pub(crate) reason: Option<String>,
    pub(crate) board: Option<BoardDto>,
    pub(crate) orientation: BoardOrientation,
    pub(crate) capture_preview_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkSessionStatusDto {
    pub(crate) source: CaptureSource,
    pub(crate) mode: LinkMode,
    pub(crate) state: LinkSessionState,
    pub(crate) reason: Option<String>,
    pub(crate) phase: Option<String>,
    pub(crate) last_error: Option<String>,
    pub(crate) started_at: Option<String>,
    pub(crate) last_heartbeat_at: Option<String>,
    pub(crate) recognition_attempts: u64,
    pub(crate) last_detection_summary: Option<String>,
    pub(crate) turn_indicator: Option<String>,
    pub(crate) manual_turn_override: Option<String>,
    pub(crate) pending_external_move: Option<String>,
    pub(crate) capture_preview_kind: Option<String>,
    pub(crate) frame_rate: f32,
    pub(crate) confidence: Option<f32>,
    pub(crate) confidence_threshold: f32,
    pub(crate) stable_frames: u8,
    pub(crate) required_stable_frames: u8,
    pub(crate) latest_fen: Option<String>,
    pub(crate) last_move: Option<String>,
    pub(crate) last_move_detail: Option<LinkMoveDetailDto>,
    pub(crate) initial_position_seen: bool,
    pub(crate) auto_side: Option<String>,
    pub(crate) board_orientation: BoardOrientation,
    pub(crate) capture_running: bool,
    pub(crate) target_window: Option<LinkTargetWindowDto>,
    pub(crate) capture_backend: Option<String>,
    pub(crate) capture_dpi: Option<u32>,
    pub(crate) click_available: bool,
}

pub(crate) struct LinkCapturePreview {
    pub(crate) data_uri: String,
    pub(crate) png: Vec<u8>,
    pub(crate) region: Option<LinkCaptureRegion>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LinkWindowGeometry {
    pub(crate) origin_x: i32,
    pub(crate) origin_y: i32,
    pub(crate) client_width: i32,
    pub(crate) client_height: i32,
    pub(crate) dpi: u32,
}

pub(crate) struct LiveLinkCaptureFrame {
    pub(crate) png: Vec<u8>,
    pub(crate) screen_origin: Option<(i32, i32)>,
    pub(crate) dpi: Option<u32>,
    pub(crate) target_geometry: Option<LinkWindowGeometry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkRegionSelectionDto {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

pub(crate) fn side_label(color: Color) -> &'static str {
    if color == Color::Red {
        "红方"
    } else {
        "黑方"
    }
}

pub(crate) fn game_status_label(status: GameStatus) -> &'static str {
    match status {
        GameStatus::Ongoing => "进行中",
        GameStatus::Check => "将军",
        GameStatus::Checkmate => "将死",
        GameStatus::Stalemate => "困毙",
    }
}

pub(crate) fn rule_verdict_code(verdict: RuleVerdict) -> &'static str {
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

pub(crate) fn rule_status_label(verdict: RuleVerdict) -> String {
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

pub(crate) fn rule_reason(verdict: RuleVerdict, mode: RuleMode) -> String {
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

pub(crate) fn board_pieces(board: &Board) -> Vec<PieceDto> {
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

pub(crate) fn manual_tree_dto(
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

pub(crate) fn board_dto(model: &AppModel) -> Result<BoardDto, String> {
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

pub(crate) fn recognized_board_snapshot(
    model: &AppModel,
    board: &Board,
) -> Result<BoardDto, String> {
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

pub(crate) fn metadata_payload(metadata: &ManualMetadata, note: &str) -> UpdateGameMetadataPayload {
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

pub(crate) fn library_metadata_payload(
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

pub(crate) fn install_document(
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

pub(crate) fn collect_nodes(tree: &ManualTree) -> Result<Vec<xiangqi_manual::MoveNode>, String> {
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

pub(crate) fn document_from_model(model: &AppModel) -> ManualDocument {
    ManualDocument {
        metadata: model.metadata.clone(),
        starting_fen: model.starting_fen.clone(),
        note: model.note.clone(),
        tree: model.tree.clone(),
        warnings: Vec::new(),
    }
}

pub(crate) fn position_is_playable(board: &Board) -> bool {
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

pub(crate) fn format_hint_from_path(path: &str) -> Option<ManualFormat> {
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

pub(crate) fn format_name(format: ManualFormat) -> &'static str {
    match format {
        ManualFormat::Pgn => "pgn",
        ManualFormat::Xqf => "xqf",
        ManualFormat::Cbr => "cbr",
    }
}

pub(crate) fn move_dto(
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

pub(crate) fn board_at(
    starting_fen: &str,
    tree: &ManualTree,
    node_id: Option<Uuid>,
) -> Result<Board, String> {
    let mut board = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    if let Some(node_id) = node_id {
        for mv in tree.line_to(node_id).map_err(|error| error.to_string())? {
            board = board.apply_move(mv).map_err(|error| error.to_string())?;
        }
    }
    Ok(board)
}

pub(crate) fn restore_game(
    store: &LocalStore,
    game: &LocalGame,
) -> Result<(Board, ManualTree), String> {
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

pub(crate) fn load_game_into_model(model: &mut AppModel, game: LocalGame) -> Result<(), String> {
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

pub(crate) fn next_operation(
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

pub(crate) fn next_operation_for_game(
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
