use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    ReorderBranchesPayload, SetMainlinePayload, UpdateCommentPayload, UpdateGameMetadataPayload,
};
use thiserror::Error;
use uuid::Uuid;
use xiangqi_core::Move;
use xiangqi_manual::MoveNode;

pub struct LocalGame {
    pub id: Uuid,
    pub title: String,
    pub starting_fen: String,
    pub root_id: Uuid,
    pub current_node_id: Option<Uuid>,
    pub note: String,
    pub source_path: Option<String>,
    pub source_format: Option<String>,
    pub playable: bool,
    pub updated_at: String,
    pub metadata_json: String,
    pub library_folder: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMirrorStatus {
    pub game_id: Uuid,
    pub path: Option<String>,
    pub state: String,
    pub updated_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub name: String,
    pub system: bool,
    pub game_count: u32,
}

pub struct ImportedGame<'a> {
    pub id: Uuid,
    pub title: &'a str,
    pub starting_fen: &'a str,
    pub root_id: Uuid,
    pub current_node_id: Option<Uuid>,
    pub note: &'a str,
    pub source_path: Option<&'a str>,
    pub source_format: Option<&'a str>,
    pub playable: bool,
    pub metadata_json: &'a str,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("本地棋谱库已绑定账号 {email}，不能切换到其他账号")]
    AccountAlreadyBound { email: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub engine_path: String,
    pub threads: u32,
    pub hash_mb: u32,
    pub multipv: u32,
    #[serde(default = "default_candidate_line_moves")]
    pub candidate_line_moves: u32,
    pub search_mode: String,
    pub search_value: u64,
    pub move_time_ms: u64,
    pub ponder: bool,
    pub auto_analyze: bool,
    #[serde(default)]
    pub library_collapsed: bool,
    #[serde(default)]
    pub candidate_rail_collapsed: bool,
    #[serde(default)]
    pub analysis_panel_collapsed: bool,
    #[serde(default = "default_evaluation_collapsed")]
    pub evaluation_collapsed: bool,
    #[serde(default = "default_branch_arrow_color")]
    pub branch_arrow_color: String,
    #[serde(default = "default_workspace_panel")]
    pub workspace_panel: String,
    #[serde(default = "default_layout_mode")]
    pub layout_mode: String,
    #[serde(default = "default_manual_view_mode")]
    pub manual_view_mode: String,
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    #[serde(default = "default_board_skin")]
    pub board_skin: String,
    #[serde(default = "default_piece_skin")]
    pub piece_skin: String,
    #[serde(default = "default_report_depth")]
    pub report_depth: u32,
    /// Paths to read-only XQB opening books selected by the desktop user.
    #[serde(default)]
    pub xqb_book_paths: Vec<String>,
    #[serde(default)]
    pub disabled_xqb_book_paths: Vec<String>,
    /// Paths to local ElephantEye BOOK.DAT files selected for personal study.
    #[serde(default)]
    pub eleeye_book_paths: Vec<String>,
    #[serde(default)]
    pub disabled_eleeye_book_paths: Vec<String>,
    #[serde(default = "default_builtin_opening_book_enabled")]
    pub builtin_opening_book_enabled: bool,
    #[serde(default = "default_active_builtin_opening_book_id")]
    pub active_builtin_opening_book_id: String,
    #[serde(default)]
    pub active_engine_id: Option<Uuid>,
    #[serde(default = "default_analysis_engine_mode")]
    pub analysis_engine_mode: String,
    #[serde(default)]
    pub parallel_engine_ids: Vec<Uuid>,
    /// Built-in engines use stable markers rather than user-created profile IDs.
    #[serde(default)]
    pub parallel_engine_paths: Vec<String>,
    #[serde(default = "default_cloud_book_enabled")]
    pub cloud_book_enabled: bool,
    #[serde(default = "default_cloud_book_url")]
    pub cloud_book_url: String,
    #[serde(default = "default_rule_mode")]
    pub rule_mode: String,
    #[serde(default = "default_link_capture_source")]
    pub link_capture_source: String,
    #[serde(default = "default_link_recognition_mode")]
    pub link_recognition_mode: String,
    #[serde(default = "default_link_mode")]
    pub link_mode: String,
    #[serde(default = "default_link_stable_frames")]
    pub link_stable_frames: u8,
    #[serde(default = "default_link_confidence_threshold")]
    pub link_confidence_threshold: u8,
    #[serde(default = "default_link_animation_confirmation")]
    pub link_animation_confirmation: bool,
    #[serde(default = "default_game_mirror_enabled")]
    pub game_mirror_enabled: bool,
    #[serde(default)]
    pub game_mirror_root: String,
    pub server_url: String,
}

fn default_color_theme() -> String {
    "dark".into()
}

fn default_evaluation_collapsed() -> bool {
    true
}

fn default_branch_arrow_color() -> String {
    "#2f80ed".into()
}

fn default_analysis_engine_mode() -> String {
    "single".into()
}

fn default_rule_mode() -> String {
    "domestic2020".into()
}

fn default_link_capture_source() -> String {
    "windowLink".into()
}
fn default_link_recognition_mode() -> String {
    "yoloBoard".into()
}
fn default_link_mode() -> String {
    "spectate".into()
}
fn default_link_stable_frames() -> u8 {
    2
}
fn default_link_confidence_threshold() -> u8 {
    55
}
fn default_link_animation_confirmation() -> bool {
    true
}
fn default_game_mirror_enabled() -> bool {
    true
}

fn default_workspace_panel() -> String {
    "moves".into()
}

fn default_layout_mode() -> String {
    "compact".into()
}

fn default_manual_view_mode() -> String {
    "track".into()
}

fn default_board_skin() -> String {
    "default".into()
}

fn default_piece_skin() -> String {
    "default".into()
}

fn default_report_depth() -> u32 {
    24
}

fn default_candidate_line_moves() -> u32 {
    16
}

fn default_cloud_book_url() -> String {
    "https://www.chessdb.cn/chessdb.php".into()
}

fn default_cloud_book_enabled() -> bool {
    true
}

fn default_builtin_opening_book_enabled() -> bool {
    true
}

fn default_active_builtin_opening_book_id() -> String {
    "learning-top3".into()
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            engine_path: String::new(),
            threads: 2,
            hash_mb: 256,
            multipv: 2,
            candidate_line_moves: default_candidate_line_moves(),
            search_mode: "depth".into(),
            search_value: 24,
            move_time_ms: 1000,
            ponder: false,
            auto_analyze: false,
            library_collapsed: true,
            candidate_rail_collapsed: false,
            analysis_panel_collapsed: false,
            evaluation_collapsed: default_evaluation_collapsed(),
            branch_arrow_color: default_branch_arrow_color(),
            workspace_panel: default_workspace_panel(),
            layout_mode: default_layout_mode(),
            manual_view_mode: default_manual_view_mode(),
            color_theme: default_color_theme(),
            board_skin: default_board_skin(),
            piece_skin: default_piece_skin(),
            report_depth: default_report_depth(),
            xqb_book_paths: Vec::new(),
            disabled_xqb_book_paths: Vec::new(),
            eleeye_book_paths: Vec::new(),
            disabled_eleeye_book_paths: Vec::new(),
            builtin_opening_book_enabled: default_builtin_opening_book_enabled(),
            active_builtin_opening_book_id: default_active_builtin_opening_book_id(),
            active_engine_id: None,
            analysis_engine_mode: default_analysis_engine_mode(),
            parallel_engine_ids: Vec::new(),
            parallel_engine_paths: Vec::new(),
            cloud_book_enabled: default_cloud_book_enabled(),
            cloud_book_url: default_cloud_book_url(),
            rule_mode: default_rule_mode(),
            link_capture_source: default_link_capture_source(),
            link_recognition_mode: default_link_recognition_mode(),
            link_mode: default_link_mode(),
            link_stable_frames: default_link_stable_frames(),
            link_confidence_threshold: default_link_confidence_threshold(),
            link_animation_confirmation: default_link_animation_confirmation(),
            game_mirror_enabled: default_game_mirror_enabled(),
            game_mirror_root: String::new(),
            server_url: "http://127.0.0.1:8080".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccountBinding {
    pub user_id: Uuid,
    pub email: String,
}

pub struct LocalStore {
    connection: Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnalysisSummary {
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredGameReport {
    pub game_id: Uuid,
    pub line_signature: String,
    pub engine_fingerprint: String,
    pub config_hash: String,
    pub dataset_json: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStyleProfile {
    pub id: String,
    pub player_name: String,
    pub normalized_name: String,
    pub version: String,
    pub sample_count: i64,
    pub generated_at: String,
    pub profile_json: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStyleSample {
    pub id: String,
    pub profile_id: String,
    pub player_name: String,
    pub source_game_id: String,
    pub source_title: String,
    pub event_name: Option<String>,
    pub game_date: Option<String>,
    pub ply: i64,
    pub phase: String,
    pub before_fen: String,
    pub played_move: String,
    pub played_move_rank: Option<i64>,
    pub played_move_in_topn: bool,
    pub best_move: Option<String>,
    pub best_score_cp: Option<i64>,
    pub candidates_json: String,
    pub source_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStyleTheoryCardRef {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub source_book: Option<String>,
    pub source_page_start: Option<i64>,
    pub source_page_end: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStyleHint {
    pub sample_id: String,
    pub profile_id: String,
    pub player_name: String,
    pub confidence: String,
    pub reason: String,
    pub source_title: String,
    pub event_name: Option<String>,
    pub game_date: Option<String>,
    pub ply: i64,
    pub phase: String,
    pub before_fen: String,
    pub played_move: String,
    pub played_move_rank: Option<i64>,
    pub played_move_in_topn: bool,
    pub best_move: Option<String>,
    pub best_score_cp: Option<i64>,
    pub theory_cards: Vec<MasterStyleTheoryCardRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMasterStyleProfile {
    pub id: String,
    pub player_name: String,
    pub normalized_name: String,
    pub version: String,
    pub sample_count: i64,
    pub generated_at: String,
    pub profile_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMasterStyleSample {
    pub id: String,
    pub profile_id: String,
    pub player_name: String,
    pub source_game_id: String,
    pub source_title: String,
    pub event_name: Option<String>,
    pub game_date: Option<String>,
    pub ply: i64,
    pub phase: String,
    pub before_fen: String,
    pub played_move: String,
    pub played_move_rank: Option<i64>,
    pub played_move_in_topn: bool,
    pub best_move: Option<String>,
    pub best_score_cp: Option<i64>,
    pub candidates_json: String,
    pub source_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingTask {
    pub id: Uuid,
    pub game_id: Uuid,
    pub report_signature: String,
    pub node_id: Uuid,
    pub title: String,
    pub detail: String,
    pub phase: Option<String>,
    pub tags: Vec<String>,
    pub source_card_id: Option<i64>,
    pub task_type: String,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningProfile {
    pub id: String,
    pub child_name: String,
    pub level: String,
    pub age_group: String,
    pub session_minutes: u32,
    pub coach_mode: String,
    pub cycle_weeks: u32,
    pub personal_ratio: u32,
    pub thematic_ratio: u32,
    pub current_week: u32,
    pub created_at: String,
    pub updated_at: String,
}

impl LearningProfile {
    pub fn u10_default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: "default".into(),
            child_name: "小棋手".into(),
            level: "全国少年赛".into(),
            age_group: "U10".into(),
            session_minutes: 40,
            coach_mode: "家长陪练".into(),
            cycle_weeks: 12,
            personal_ratio: 60,
            thematic_ratio: 40,
            current_week: 1,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidedAnalysisSubmission {
    pub threats: String,
    pub forcing_moves: String,
    pub worst_piece: String,
    pub candidates: Vec<String>,
    pub chosen_move: String,
    pub predicted_line: Vec<String>,
    pub confidence: u8,
    pub elapsed_seconds: u32,
    pub hints_used: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidedAnalysisSession {
    pub id: Uuid,
    pub game_id: Uuid,
    pub problem_node_id: Option<Uuid>,
    pub start_node_id: Option<Uuid>,
    pub report_signature: String,
    pub fen: String,
    pub phase: String,
    pub status: String,
    pub answer_hidden: bool,
    pub submission: Option<GuidedAnalysisSubmission>,
    pub result_kind: Option<String>,
    pub score: Option<u32>,
    pub result_json: Option<String>,
    pub started_at: String,
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingAttempt {
    pub id: Uuid,
    pub task_id: Uuid,
    pub session_id: Option<Uuid>,
    pub submission: GuidedAnalysisSubmission,
    pub score: u32,
    pub result_kind: String,
    pub parent_note: String,
    pub review_round: u32,
    pub next_review_at: Option<String>,
    pub mastered: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlyknifePlan {
    pub id: Uuid,
    pub title: String,
    pub side: String,
    pub starting_fen: String,
    pub template_id: Option<String>,
    pub template_name: String,
    pub lure_move: String,
    pub knife_move: String,
    pub mainline: Vec<String>,
    pub best_defense: Vec<String>,
    pub score_cp: Option<i64>,
    pub mate: Option<i64>,
    pub risk: String,
    pub source_game_id: Option<Uuid>,
    pub source_node_id: Option<Uuid>,
    pub note: String,
    pub annotations: Vec<FlyknifeStepAnnotation>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlyknifeStepAnnotation {
    pub role: String,
    pub iccs: String,
    pub notation: String,
    pub side: String,
    pub fen: Option<String>,
    pub score_cp: Option<i64>,
    pub swing_cp: Option<i64>,
    pub intent: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineProfile {
    pub id: Uuid,
    pub name: String,
    pub executable_path: String,
    pub protocol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TheoryLesson {
    pub id: i64,
    pub phase: String,
    pub course_name: String,
    pub title: String,
    pub source_path: String,
    pub fingerprint: String,
    pub transcription_status: String,
    pub duration_ms: Option<u64>,
    pub scanned_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TheoryCard {
    pub id: i64,
    pub external_id: Option<String>,
    pub lesson_id: i64,
    pub phase: String,
    pub title: String,
    pub summary: String,
    pub applies_when: String,
    pub risk: String,
    pub timecode: Option<String>,
    pub review_status: String,
    pub course_name: String,
    pub lesson_title: String,
    pub source_book: Option<String>,
    pub source_page_start: Option<i64>,
    pub source_page_end: Option<i64>,
    pub tags: Vec<String>,
    pub engine_correlations: Vec<String>,
    pub origin: String,
    pub version: i64,
    pub user_modified: bool,
    pub match_penalty: i64,
    pub needs_recheck: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySession {
    pub id: Uuid,
    pub game_id: Uuid,
    pub node_id: Option<Uuid>,
    pub reflection: String,
    pub tags: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TheoryCardMatch {
    pub id: Uuid,
    pub game_id: Uuid,
    pub report_signature: String,
    pub node_id: Uuid,
    pub card_id: i64,
    pub card_version: i64,
    pub engine_signal: String,
    pub matched_tags: Vec<String>,
    pub verdict: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TheoryCardFeedback {
    pub id: Uuid,
    pub match_id: Option<Uuid>,
    pub card_id: i64,
    pub card_version: i64,
    pub verdict: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaknessStat {
    pub phase: String,
    pub tag: String,
    pub occurrences: u32,
    pub completed_tasks: u32,
    pub open_tasks: u32,
    pub review_cards: Vec<TheoryCard>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTheoryCard {
    pub external_id: String,
    pub phase: String,
    pub course_name: String,
    pub lesson_title: String,
    pub source_path: String,
    pub fingerprint: String,
    pub title: String,
    pub summary: String,
    pub applies_when: String,
    pub risk: String,
    pub review_status: String,
    pub source_book: Option<String>,
    pub source_page_start: Option<i64>,
    pub source_page_end: Option<i64>,
    pub tags: Vec<String>,
    pub engine_correlations: Vec<String>,
}

impl LocalStore {
    pub fn flyknife_plans(&self) -> Result<Vec<FlyknifePlan>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, side, starting_fen, template_id, template_name, lure_move, knife_move, mainline_json, best_defense_json, score_cp, mate, risk, source_game_id, source_node_id, note, annotations_json, created_at FROM flyknife_plans ORDER BY created_at DESC",
        )?;
        statement
            .query_map([], |row| {
                Ok(FlyknifePlan {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                    title: row.get(1)?,
                    side: row.get(2)?,
                    starting_fen: row.get(3)?,
                    template_id: row.get(4)?,
                    template_name: row.get(5)?,
                    lure_move: row.get(6)?,
                    knife_move: row.get(7)?,
                    mainline: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
                    best_defense: serde_json::from_str(&row.get::<_, String>(9)?)
                        .unwrap_or_default(),
                    score_cp: row.get(10)?,
                    mate: row.get(11)?,
                    risk: row.get(12)?,
                    source_game_id: row
                        .get::<_, Option<String>>(13)?
                        .and_then(|value| Uuid::parse_str(&value).ok()),
                    source_node_id: row
                        .get::<_, Option<String>>(14)?
                        .and_then(|value| Uuid::parse_str(&value).ok()),
                    note: row.get(15)?,
                    annotations: serde_json::from_str(&row.get::<_, String>(16)?)
                        .unwrap_or_default(),
                    created_at: row.get(17)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn save_flyknife_plan(&mut self, plan: &FlyknifePlan) -> Result<(), StoreError> {
        self.connection.execute("INSERT OR REPLACE INTO flyknife_plans (id, title, side, starting_fen, template_id, template_name, lure_move, knife_move, mainline_json, best_defense_json, score_cp, mate, risk, source_game_id, source_node_id, note, annotations_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)", params![plan.id.to_string(), plan.title, plan.side, plan.starting_fen, plan.template_id, plan.template_name, plan.lure_move, plan.knife_move, serde_json::to_string(&plan.mainline)?, serde_json::to_string(&plan.best_defense)?, plan.score_cp, plan.mate, plan.risk, plan.source_game_id.map(|id| id.to_string()), plan.source_node_id.map(|id| id.to_string()), plan.note, serde_json::to_string(&plan.annotations)?, plan.created_at])?;
        Ok(())
    }

    pub fn delete_flyknife_plan(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.connection
            .execute("DELETE FROM flyknife_plans WHERE id=?1", [id.to_string()])?;
        Ok(())
    }
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    pub fn upsert_theory_lesson(
        &mut self,
        phase: &str,
        course_name: &str,
        title: &str,
        source_path: &str,
        fingerprint: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO theory_lessons (phase, course_name, title, source_path, fingerprint, transcription_status, scanned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'queued', datetime('now'))
             ON CONFLICT(source_path) DO UPDATE SET
               phase=excluded.phase, course_name=excluded.course_name, title=excluded.title,
               transcription_status=CASE WHEN theory_lessons.fingerprint != excluded.fingerprint THEN 'queued' ELSE theory_lessons.transcription_status END,
               fingerprint=excluded.fingerprint, scanned_at=excluded.scanned_at",
            params![phase, course_name, title, source_path, fingerprint],
        )?;
        Ok(())
    }

    pub fn theory_lessons(&self) -> Result<Vec<TheoryLesson>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, phase, course_name, title, source_path, fingerprint, transcription_status, duration_ms, scanned_at
             FROM theory_lessons ORDER BY phase, title",
        )?;
        statement
            .query_map([], |row| {
                Ok(TheoryLesson {
                    id: row.get(0)?,
                    phase: row.get(1)?,
                    course_name: row.get(2)?,
                    title: row.get(3)?,
                    source_path: row.get(4)?,
                    fingerprint: row.get(5)?,
                    transcription_status: row.get(6)?,
                    duration_ms: row.get(7)?,
                    scanned_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn theory_cards(&self) -> Result<Vec<TheoryCard>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT c.id, c.external_id, c.lesson_id, l.phase, c.title, c.summary, c.applies_when, c.risk, c.timecode, c.review_status, l.course_name, l.title,
                    c.source_book, c.source_page_start, c.source_page_end, c.tags_json, c.engine_correlations_json,
                    c.origin, c.version, c.user_modified, c.match_penalty, c.needs_recheck
             FROM theory_cards c JOIN theory_lessons l ON l.id=c.lesson_id ORDER BY c.review_status, l.phase, l.title",
        )?;
        statement
            .query_map([], |row| {
                let tags_json: String = row.get(15)?;
                let engine_correlations_json: String = row.get(16)?;
                Ok(TheoryCard {
                    id: row.get(0)?,
                    external_id: row.get(1)?,
                    lesson_id: row.get(2)?,
                    phase: row.get(3)?,
                    title: row.get(4)?,
                    summary: row.get(5)?,
                    applies_when: row.get(6)?,
                    risk: row.get(7)?,
                    timecode: row.get(8)?,
                    review_status: row.get(9)?,
                    course_name: row.get(10)?,
                    lesson_title: row.get(11)?,
                    source_book: row.get(12)?,
                    source_page_start: row.get(13)?,
                    source_page_end: row.get(14)?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    engine_correlations: serde_json::from_str(&engine_correlations_json)
                        .unwrap_or_default(),
                    origin: row.get(17)?,
                    version: row.get(18)?,
                    user_modified: row.get::<_, i64>(19)? != 0,
                    match_penalty: row.get(20)?,
                    needs_recheck: row.get::<_, i64>(21)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn upsert_master_style_profile(
        &mut self,
        profile: &ImportedMasterStyleProfile,
        samples: &[ImportedMasterStyleSample],
    ) -> Result<MasterStyleProfile, StoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        let sample_count = if profile.sample_count > 0 {
            profile.sample_count
        } else {
            samples.len() as i64
        };
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO master_style_profiles
             (id, player_name, normalized_name, version, sample_count, generated_at, profile_json, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               player_name=excluded.player_name,
               normalized_name=excluded.normalized_name,
               version=excluded.version,
               sample_count=excluded.sample_count,
               generated_at=excluded.generated_at,
               profile_json=excluded.profile_json,
               imported_at=excluded.imported_at",
            params![
                profile.id,
                profile.player_name,
                profile.normalized_name,
                profile.version,
                sample_count,
                profile.generated_at,
                profile.profile_json,
                now,
            ],
        )?;
        for sample in samples {
            tx.execute(
                "INSERT INTO master_style_samples
                 (id, profile_id, player_name, source_game_id, source_title, event_name, game_date,
                  ply, phase, before_fen, played_move, played_move_rank, played_move_in_topn,
                  best_move, best_score_cp, candidates_json, source_json, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                 ON CONFLICT(id) DO UPDATE SET
                   profile_id=excluded.profile_id,
                   player_name=excluded.player_name,
                   source_game_id=excluded.source_game_id,
                   source_title=excluded.source_title,
                   event_name=excluded.event_name,
                   game_date=excluded.game_date,
                   ply=excluded.ply,
                   phase=excluded.phase,
                   before_fen=excluded.before_fen,
                   played_move=excluded.played_move,
                   played_move_rank=excluded.played_move_rank,
                   played_move_in_topn=excluded.played_move_in_topn,
                   best_move=excluded.best_move,
                   best_score_cp=excluded.best_score_cp,
                   candidates_json=excluded.candidates_json,
                   source_json=excluded.source_json,
                   imported_at=excluded.imported_at",
                params![
                    sample.id,
                    sample.profile_id,
                    sample.player_name,
                    sample.source_game_id,
                    sample.source_title,
                    sample.event_name,
                    sample.game_date,
                    sample.ply,
                    sample.phase,
                    sample.before_fen,
                    sample.played_move,
                    sample.played_move_rank,
                    sample.played_move_in_topn as i32,
                    sample.best_move,
                    sample.best_score_cp,
                    sample.candidates_json,
                    sample.source_json,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        self.list_master_style_profiles()?
            .into_iter()
            .find(|stored| stored.id == profile.id)
            .ok_or_else(|| StoreError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn list_master_style_profiles(&self) -> Result<Vec<MasterStyleProfile>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, player_name, normalized_name, version, sample_count, generated_at, profile_json, imported_at
             FROM master_style_profiles
             ORDER BY imported_at DESC, player_name ASC",
        )?;
        statement
            .query_map([], |row| {
                Ok(MasterStyleProfile {
                    id: row.get(0)?,
                    player_name: row.get(1)?,
                    normalized_name: row.get(2)?,
                    version: row.get(3)?,
                    sample_count: row.get(4)?,
                    generated_at: row.get(5)?,
                    profile_json: row.get(6)?,
                    imported_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    fn approved_theory_refs_for_phase(
        &self,
        phase: &str,
        limit: usize,
    ) -> Result<Vec<MasterStyleTheoryCardRef>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT c.id, c.title, c.summary, c.source_book, c.source_page_start, c.source_page_end
             FROM theory_cards c
             JOIN theory_lessons l ON l.id = c.lesson_id
             WHERE c.review_status = 'approved'
               AND l.phase = ?1
             ORDER BY c.match_penalty ASC, c.needs_recheck ASC, c.version DESC, c.id ASC
             LIMIT ?2",
        )?;
        statement
            .query_map(params![phase, limit as i64], |row| {
                Ok(MasterStyleTheoryCardRef {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    source_book: row.get(3)?,
                    source_page_start: row.get(4)?,
                    source_page_end: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn match_master_style_hints(
        &self,
        fen: &str,
        phase: &str,
        best_iccs: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MasterStyleHint>, StoreError> {
        let limit = limit.max(1).min(8);
        let exact_rows = self.master_style_hint_rows(
            "WHERE s.before_fen = ?1",
            params![fen, limit as i64],
            limit,
        )?;
        let rows = if exact_rows.is_empty() {
            if let Some(best_iccs) = best_iccs.filter(|value| !value.trim().is_empty()) {
                self.master_style_hint_rows(
                    "WHERE s.phase = ?1 AND s.played_move = ?2",
                    params![phase, best_iccs, limit as i64],
                    limit,
                )?
            } else {
                Vec::new()
            }
        } else {
            exact_rows
        };
        let theory_cards = self.approved_theory_refs_for_phase(phase, 2)?;
        Ok(rows
            .into_iter()
            .map(|mut hint| {
                hint.theory_cards = theory_cards.clone();
                hint
            })
            .collect())
    }

    fn master_style_hint_rows<P>(
        &self,
        where_clause: &str,
        params: P,
        limit: usize,
    ) -> Result<Vec<MasterStyleHint>, StoreError>
    where
        P: rusqlite::Params,
    {
        let sql =
            format!(
            "SELECT s.id, s.profile_id, s.player_name, s.source_title, s.event_name, s.game_date,
                    s.ply, s.phase, s.before_fen, s.played_move, s.played_move_rank,
                    s.played_move_in_topn, s.best_move, s.best_score_cp,
                    CASE WHEN s.before_fen = ?1 THEN 'exact' ELSE 'similar' END AS confidence
             FROM master_style_samples s
             {where_clause}
             ORDER BY
               CASE WHEN s.played_move_rank IS NULL THEN 99 ELSE s.played_move_rank END ASC,
               s.game_date DESC,
               s.ply ASC
             LIMIT ?{}",
            if where_clause.contains("?2") { "3" } else { "2" }
        );
        let mut statement = self.connection.prepare(&sql)?;
        statement
            .query_map(params, |row| {
                let confidence: String = row.get(14)?;
                let played_move_rank: Option<i64> = row.get(10)?;
                Ok(MasterStyleHint {
                    sample_id: row.get(0)?,
                    profile_id: row.get(1)?,
                    player_name: row.get(2)?,
                    confidence: confidence.clone(),
                    reason: if confidence == "exact" {
                        "完全相同 FEN 的公开棋谱实战参考".into()
                    } else {
                        "同阶段且赵鑫鑫公开实战着与当前 Pikafish 推荐着相同的低置信度参考".into()
                    },
                    source_title: row.get(3)?,
                    event_name: row.get(4)?,
                    game_date: row.get(5)?,
                    ply: row.get(6)?,
                    phase: row.get(7)?,
                    before_fen: row.get(8)?,
                    played_move: row.get(9)?,
                    played_move_rank,
                    played_move_in_topn: row.get::<_, i64>(11)? != 0,
                    best_move: row.get(12)?,
                    best_score_cp: row.get(13)?,
                    theory_cards: Vec::new(),
                })
            })?
            .take(limit)
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_master_style_match(
        &mut self,
        game_id: Uuid,
        report_signature: &str,
        node_id: Uuid,
        hint: &MasterStyleHint,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT OR IGNORE INTO master_style_matches
             (id, game_id, report_signature, node_id, profile_id, sample_id, confidence, reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                report_signature,
                node_id.to_string(),
                hint.profile_id,
                hint.sample_id,
                hint.confidence,
                hint.reason,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_imported_theory_card(
        &mut self,
        card: &ImportedTheoryCard,
    ) -> Result<TheoryCard, StoreError> {
        self.upsert_theory_lesson(
            &card.phase,
            &card.course_name,
            &card.lesson_title,
            &card.source_path,
            &card.fingerprint,
        )?;
        let lesson_id: i64 = self.connection.query_row(
            "SELECT id FROM theory_lessons WHERE source_path = ?1",
            [&card.source_path],
            |row| row.get(0),
        )?;
        let tags_json = serde_json::to_string(&card.tags)?;
        let engine_correlations_json = serde_json::to_string(&card.engine_correlations)?;
        let existing = self
            .theory_cards()?
            .into_iter()
            .find(|existing| existing.external_id.as_deref() == Some(card.external_id.as_str()));
        if let Some(existing) = existing {
            let unchanged = existing.lesson_id == lesson_id
                && existing.title == card.title
                && existing.summary == card.summary
                && existing.applies_when == card.applies_when
                && existing.risk == card.risk
                && existing.review_status == card.review_status
                && existing.source_book == card.source_book
                && existing.source_page_start == card.source_page_start
                && existing.source_page_end == card.source_page_end
                && existing.tags == card.tags
                && existing.engine_correlations == card.engine_correlations
                && existing.origin == "imported";
            if unchanged {
                return Ok(existing);
            }
            self.connection.execute(
                "UPDATE theory_cards
                 SET lesson_id=?2, title=?3, summary=?4, applies_when=?5, risk=?6,
                     review_status=?7, source_book=?8, source_page_start=?9, source_page_end=?10,
                     tags_json=?11, engine_correlations_json=?12, origin='imported',
                     version=version + 1, user_modified=0, needs_recheck=0
                 WHERE id=?1",
                params![
                    existing.id,
                    lesson_id,
                    card.title,
                    card.summary,
                    card.applies_when,
                    card.risk,
                    card.review_status,
                    card.source_book,
                    card.source_page_start,
                    card.source_page_end,
                    tags_json,
                    engine_correlations_json,
                ],
            )?;
            return self
                .theory_cards()?
                .into_iter()
                .find(|updated| updated.id == existing.id)
                .ok_or_else(|| StoreError::Sql(rusqlite::Error::QueryReturnedNoRows));
        }
        self.connection.execute(
            "INSERT INTO theory_cards
             (external_id, lesson_id, title, summary, applies_when, risk, review_status,
              source_book, source_page_start, source_page_end, tags_json, engine_correlations_json,
              origin, version, user_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'imported', 1, 0)",
            params![
                card.external_id,
                lesson_id,
                card.title,
                card.summary,
                card.applies_when,
                card.risk,
                card.review_status,
                card.source_book,
                card.source_page_start,
                card.source_page_end,
                tags_json,
                engine_correlations_json,
            ],
        )?;
        let id = self.connection.last_insert_rowid();
        self.theory_cards()?
            .into_iter()
            .find(|inserted| inserted.id == id)
            .ok_or_else(|| StoreError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn create_theory_card(
        &mut self,
        lesson_id: i64,
        title: &str,
        summary: &str,
        applies_when: &str,
        risk: &str,
        timecode: Option<&str>,
    ) -> Result<TheoryCard, StoreError> {
        self.connection.execute(
            "INSERT INTO theory_cards (lesson_id, title, summary, applies_when, risk, timecode, review_status, origin, version, user_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 'user', 1, 1)",
            params![lesson_id, title, summary, applies_when, risk, timecode],
        )?;
        let id = self.connection.last_insert_rowid();
        self.theory_cards()?
            .into_iter()
            .find(|card| card.id == id)
            .ok_or_else(|| StoreError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn review_theory_card(&mut self, card: &TheoryCard) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE theory_cards SET title=?2, summary=?3, applies_when=?4, risk=?5, timecode=?6, review_status=?7,
                    source_book=?8, source_page_start=?9, source_page_end=?10, tags_json=?11, engine_correlations_json=?12,
                    origin=?13, version=version + 1, user_modified=1, needs_recheck=?14
             WHERE id=?1",
            params![
                card.id,
                card.title,
                card.summary,
                card.applies_when,
                card.risk,
                card.timecode,
                card.review_status,
                card.source_book,
                card.source_page_start,
                card.source_page_end,
                serde_json::to_string(&card.tags)?,
                serde_json::to_string(&card.engine_correlations)?,
                card.origin,
                card.needs_recheck as i32,
            ],
        )?;
        Ok(())
    }

    pub fn record_theory_card_match(
        &mut self,
        game_id: Uuid,
        report_signature: &str,
        node_id: Uuid,
        card_id: i64,
        card_version: i64,
        engine_signal: &str,
        matched_tags: &[String],
        note: &str,
    ) -> Result<TheoryCardMatch, StoreError> {
        let record = TheoryCardMatch {
            id: Uuid::new_v4(),
            game_id,
            report_signature: report_signature.to_owned(),
            node_id,
            card_id,
            card_version,
            engine_signal: engine_signal.to_owned(),
            matched_tags: matched_tags.to_vec(),
            verdict: "unreviewed".into(),
            note: note.to_owned(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.connection.execute(
            "INSERT INTO theory_card_matches
             (id, game_id, report_signature, node_id, card_id, card_version, engine_signal, matched_tags_json, verdict, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                record.id.to_string(),
                record.game_id.to_string(),
                record.report_signature,
                record.node_id.to_string(),
                record.card_id,
                record.card_version,
                record.engine_signal,
                serde_json::to_string(&record.matched_tags)?,
                record.verdict,
                record.note,
                record.created_at,
            ],
        )?;
        Ok(record)
    }

    pub fn save_theory_card_feedback(
        &mut self,
        match_id: Option<Uuid>,
        card_id: i64,
        card_version: i64,
        verdict: &str,
        note: &str,
    ) -> Result<TheoryCardFeedback, StoreError> {
        let feedback = TheoryCardFeedback {
            id: Uuid::new_v4(),
            match_id,
            card_id,
            card_version,
            verdict: verdict.to_owned(),
            note: note.to_owned(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.connection.execute(
            "INSERT INTO theory_card_feedback (id, match_id, card_id, card_version, verdict, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                feedback.id.to_string(),
                feedback.match_id.map(|id| id.to_string()),
                feedback.card_id,
                feedback.card_version,
                feedback.verdict,
                feedback.note,
                feedback.created_at,
            ],
        )?;
        if let Some(match_id) = feedback.match_id {
            self.connection.execute(
                "UPDATE theory_card_matches SET verdict=?2, note=?3 WHERE id=?1",
                params![match_id.to_string(), feedback.verdict, feedback.note],
            )?;
        }
        match verdict {
            "incorrect" => {
                self.connection.execute(
                    "UPDATE theory_cards SET match_penalty = match_penalty + 2, needs_recheck = 1 WHERE id = ?1",
                    params![card_id],
                )?;
            }
            "needs_revision" => {
                self.connection.execute(
                    "UPDATE theory_cards SET match_penalty = match_penalty + 1, needs_recheck = 1 WHERE id = ?1",
                    params![card_id],
                )?;
            }
            "correct" => {
                self.connection.execute(
                    "UPDATE theory_cards SET match_penalty = max(match_penalty - 1, 0) WHERE id = ?1",
                    params![card_id],
                )?;
            }
            _ => {}
        }
        Ok(feedback)
    }

    pub fn save_study_session(
        &mut self,
        game_id: Uuid,
        node_id: Option<Uuid>,
        reflection: &str,
        tags: &[String],
    ) -> Result<StudySession, StoreError> {
        let session = StudySession {
            id: Uuid::new_v4(),
            game_id,
            node_id,
            reflection: reflection.to_owned(),
            tags: tags.to_vec(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.connection.execute(
            "INSERT INTO study_sessions (id, game_id, node_id, reflection, tags_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session.id.to_string(),
                session.game_id.to_string(),
                session.node_id.map(|id| id.to_string()),
                session.reflection,
                serde_json::to_string(&session.tags)?,
                session.created_at,
            ],
        )?;
        Ok(session)
    }

    pub fn study_sessions(&self, game_id: Uuid) -> Result<Vec<StudySession>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, node_id, reflection, tags_json, created_at
             FROM study_sessions WHERE game_id = ?1 ORDER BY created_at DESC, rowid DESC",
        )?;
        statement
            .query_map([game_id.to_string()], |row| {
                let id: String = row.get(0)?;
                let game_id: String = row.get(1)?;
                let node_id: Option<String> = row.get(2)?;
                let tags_json: String = row.get(4)?;
                Ok((
                    id,
                    game_id,
                    node_id,
                    row.get::<_, String>(3)?,
                    tags_json,
                    row.get::<_, String>(5)?,
                ))
            })?
            .map(|row| {
                let (id, game_id, node_id, reflection, tags_json, created_at) = row?;
                Ok(StudySession {
                    id: Uuid::parse_str(&id).map_err(json_error)?,
                    game_id: Uuid::parse_str(&game_id).map_err(json_error)?,
                    node_id: node_id
                        .map(|value| Uuid::parse_str(&value).map_err(json_error))
                        .transpose()?,
                    reflection,
                    tags: serde_json::from_str(&tags_json)?,
                    created_at,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()
    }

    fn all_study_sessions(&self) -> Result<Vec<StudySession>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, node_id, reflection, tags_json, created_at
             FROM study_sessions ORDER BY created_at DESC, rowid DESC",
        )?;
        statement
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let game_id: String = row.get(1)?;
                let node_id: Option<String> = row.get(2)?;
                let tags_json: String = row.get(4)?;
                Ok((
                    id,
                    game_id,
                    node_id,
                    row.get::<_, String>(3)?,
                    tags_json,
                    row.get::<_, String>(5)?,
                ))
            })?
            .map(|row| {
                let (id, game_id, node_id, reflection, tags_json, created_at) = row?;
                Ok(StudySession {
                    id: Uuid::parse_str(&id).map_err(json_error)?,
                    game_id: Uuid::parse_str(&game_id).map_err(json_error)?,
                    node_id: node_id
                        .map(|value| Uuid::parse_str(&value).map_err(json_error))
                        .transpose()?,
                    reflection,
                    tags: serde_json::from_str(&tags_json)?,
                    created_at,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()
    }

    pub fn desktop_preferences(&self) -> Result<DesktopPreferences, StoreError> {
        let json: Option<String> = self
            .connection
            .query_row(
                "SELECT preferences_json FROM desktop_preferences WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        json.map(|value| serde_json::from_str(&value))
            .transpose()
            .map(|value| value.unwrap_or_default())
            .map_err(Into::into)
    }

    pub fn save_desktop_preferences(
        &mut self,
        preferences: &DesktopPreferences,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO desktop_preferences (id, preferences_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET preferences_json=excluded.preferences_json",
            [serde_json::to_string(preferences)?],
        )?;
        Ok(())
    }

    pub fn sync_account_binding(&self) -> Result<Option<SyncAccountBinding>, StoreError> {
        self.sync_value("sync_account")?
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(Into::into)
    }

    pub fn bind_sync_account(&mut self, account: &SyncAccountBinding) -> Result<(), StoreError> {
        if let Some(existing) = self.sync_account_binding()? {
            if existing.user_id != account.user_id {
                return Err(StoreError::AccountAlreadyBound {
                    email: existing.email,
                });
            }
            return Ok(());
        }
        self.set_sync_value("sync_account", &serde_json::to_string(account)?)
    }

    pub fn reset_sync_library(&mut self) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM training_tasks", [])?;
        transaction.execute("DELETE FROM game_reports", [])?;
        transaction.execute("DELETE FROM analysis_results", [])?;
        transaction.execute("DELETE FROM move_nodes", [])?;
        transaction.execute("DELETE FROM operations", [])?;
        transaction.execute("DELETE FROM games", [])?;
        transaction.execute(
            "DELETE FROM sync_state WHERE key IN ('sync_account', 'sync_token_expired', 'last_sync_result', 'remote_cursor')",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn sync_token_expired(&self) -> Result<bool, StoreError> {
        Ok(self.sync_value("sync_token_expired")?.as_deref() == Some("true"))
    }

    pub fn set_sync_token_expired(&mut self, expired: bool) -> Result<(), StoreError> {
        self.set_sync_value("sync_token_expired", if expired { "true" } else { "false" })
    }

    pub fn last_sync_result(&self) -> Result<Option<String>, StoreError> {
        self.sync_value("last_sync_result")
    }

    pub fn set_last_sync_result(&mut self, result: &str) -> Result<(), StoreError> {
        self.set_sync_value("last_sync_result", result)
    }

    pub fn device_id(&mut self) -> Result<Uuid, StoreError> {
        if let Some(value) = self.sync_value("device_id")? {
            return Uuid::parse_str(&value)
                .map_err(json_error)
                .map_err(Into::into);
        }
        let device_id = Uuid::new_v4();
        self.set_sync_value("device_id", &device_id.to_string())?;
        Ok(device_id)
    }

    pub fn max_lamport(&self) -> Result<u64, StoreError> {
        let value: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(lamport), 0) FROM operations",
            [],
            |row| row.get(0),
        )?;
        Ok(value.max(0) as u64)
    }

    pub fn save_game_with_operation(
        &mut self,
        game_id: Uuid,
        title: &str,
        fen: &str,
        root_id: Uuid,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO games (id, title, starting_fen, root_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, starting_fen=excluded.starting_fen, root_id=excluded.root_id, updated_at=excluded.updated_at",
            params![game_id.to_string(), title, fen, root_id.to_string(), operation.created_at.to_rfc3339()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn import_game_with_operations(
        &mut self,
        game: ImportedGame<'_>,
        nodes: &[MoveNode],
        operations: &[Operation],
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let updated_at = operations
            .last()
            .map(|operation| operation.created_at)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339();
        transaction.execute(
            "INSERT INTO games
             (id, title, starting_fen, root_id, current_node_id, updated_at, note,
              source_path, source_format, playable, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                game.id.to_string(),
                game.title,
                game.starting_fen,
                game.root_id.to_string(),
                game.current_node_id.map(|id| id.to_string()),
                updated_at,
                game.note,
                game.source_path,
                game.source_format,
                game.playable as i32,
                game.metadata_json,
            ],
        )?;
        for node in nodes {
            transaction.execute(
                "INSERT INTO move_nodes
                 (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    node.id.to_string(),
                    game.id.to_string(),
                    node.parent_id.to_string(),
                    node.mv.to_iccs(),
                    node.comment,
                    node.order_key as i64,
                    node.is_mainline as i32,
                    node.deleted.then(|| chrono::Utc::now().to_rfc3339()),
                ],
            )?;
        }
        for operation in operations {
            insert_operation(&transaction, operation, false)?;
        }
        transaction.execute(
            "INSERT INTO sync_state (key, value) VALUES ('active_game_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [game.id.to_string()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn pending_operations(&self, limit: usize) -> Result<Vec<Operation>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at
             FROM operations WHERE uploaded = 0 ORDER BY local_sequence LIMIT ?1",
        )?;
        let rows = statement.query_map([limit as i64], |row| {
            let created_at: String = row.get(7)?;
            let kind: String = row.get(4)?;
            let payload: String = row.get(5)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                kind,
                payload,
                row.get::<_, i64>(6)? as u64,
                created_at,
            ))
        })?;
        let mut operations = Vec::new();
        for row in rows {
            let (op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at) = row?;
            operations.push(Operation {
                op_id: Uuid::parse_str(&op_id).map_err(json_error)?,
                device_id: Uuid::parse_str(&device_id).map_err(json_error)?,
                entity_id: Uuid::parse_str(&entity_id).map_err(json_error)?,
                game_id: Uuid::parse_str(&game_id).map_err(json_error)?,
                kind: serde_json::from_str(&kind)?,
                payload: serde_json::from_str(&payload)?,
                lamport,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_at)
                    .map_err(json_error)?
                    .with_timezone(&chrono::Utc),
            });
        }
        Ok(operations)
    }

    pub fn mark_uploaded(&mut self, op_ids: &[Uuid]) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        for op_id in op_ids {
            transaction.execute(
                "UPDATE operations SET uploaded = 1 WHERE op_id = ?1",
                [op_id.to_string()],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_move_with_operation(
        &mut self,
        node_id: Uuid,
        game_id: Uuid,
        parent_id: Option<Uuid>,
        move_iccs: &str,
        comment: &str,
        order_key: u64,
        is_mainline: bool,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        if is_mainline {
            transaction.execute(
                "UPDATE move_nodes SET is_mainline = 0
                 WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL",
                params![game_id.to_string(), parent_id.map(|id| id.to_string())],
            )?;
        }
        transaction.execute(
            "INSERT INTO move_nodes (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET comment=excluded.comment, order_key=excluded.order_key,
             is_mainline=excluded.is_mainline, deleted_at=NULL",
            params![node_id.to_string(), game_id.to_string(), parent_id.map(|id| id.to_string()), move_iccs, comment, order_key as i64, is_mainline as i32],
        )?;
        transaction.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                node_id.to_string(),
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_comment_with_operation(
        &mut self,
        node_id: Uuid,
        comment: &str,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE move_nodes SET comment = ?1 WHERE id = ?2",
            params![comment, node_id.to_string()],
        )?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![
                operation.created_at.to_rfc3339(),
                operation.game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_game_metadata_with_operation(
        &mut self,
        game_id: Uuid,
        title: &str,
        note: &str,
        metadata_json: &str,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE games SET title = ?1, note = ?2, metadata_json = ?3,
             updated_at = ?4 WHERE id = ?5",
            params![
                title,
                note,
                metadata_json,
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn library_folders(&self) -> Result<Vec<LibraryFolder>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT folders.name, folders.system, COUNT(games.id)
             FROM library_folders folders
             LEFT JOIN games ON games.library_folder = folders.name AND games.deleted_at IS NULL
             GROUP BY folders.name, folders.system ORDER BY folders.system DESC, folders.name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LibraryFolder {
                name: row.get(0)?,
                system: row.get(1)?,
                game_count: row.get::<_, i64>(2)? as u32,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn create_library_folder(&mut self, name: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT OR IGNORE INTO library_folders (name, system) VALUES (?1, 0)",
            [name],
        )?;
        Ok(())
    }

    pub fn rename_library_folder(&mut self, previous: &str, next: &str) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let system: Option<bool> = transaction
            .query_row(
                "SELECT system FROM library_folders WHERE name=?1",
                [previous],
                |row| row.get(0),
            )
            .optional()?;
        if system != Some(false) {
            return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
        }
        transaction.execute(
            "UPDATE library_folders SET name=?1 WHERE name=?2",
            params![next, previous],
        )?;
        transaction.execute(
            "UPDATE games SET library_folder=?1 WHERE library_folder=?2",
            params![next, previous],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_library_folder(&mut self, name: &str) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let system: Option<bool> = transaction
            .query_row(
                "SELECT system FROM library_folders WHERE name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        if system != Some(false) {
            return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
        }
        transaction.execute(
            "UPDATE games SET library_folder=NULL WHERE library_folder=?1",
            [name],
        )?;
        transaction.execute("DELETE FROM library_folders WHERE name=?1", [name])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_game_library_with_operation(
        &mut self,
        game_id: Uuid,
        folder: Option<&str>,
        favorite: bool,
        tags: &[String],
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        if let Some(folder) = folder {
            transaction.execute(
                "INSERT OR IGNORE INTO library_folders (name, system) VALUES (?1, 0)",
                [folder],
            )?;
        }
        transaction.execute(
            "UPDATE games SET library_folder=?1, favorite=?2, tags_json=?3, updated_at=?4 WHERE id=?5",
            params![folder, favorite as i32, serde_json::to_string(tags)?, operation.created_at.to_rfc3339(), game_id.to_string()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn reorder_branches_with_operation(
        &mut self,
        game_id: Uuid,
        parent_id: Uuid,
        ordered_ids: &[Uuid],
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        reorder_projected_branches(&transaction, game_id, parent_id, ordered_ids)?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![operation.created_at.to_rfc3339(), game_id.to_string()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_game_source(
        &mut self,
        game_id: Uuid,
        source_path: Option<&str>,
        source_format: Option<&str>,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET source_path = ?1, source_format = ?2 WHERE id = ?3",
            params![source_path, source_format, game_id.to_string()],
        )?;
        Ok(())
    }

    pub fn set_game_document_properties(
        &mut self,
        game_id: Uuid,
        metadata_json: &str,
        playable: bool,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET metadata_json = ?1, playable = ?2 WHERE id = ?3",
            params![metadata_json, playable as i32, game_id.to_string()],
        )?;
        Ok(())
    }

    pub fn set_mainline_with_operation(
        &mut self,
        game_id: Uuid,
        parent_id: Uuid,
        node_id: Uuid,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE move_nodes SET is_mainline = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE game_id = ?2 AND parent_id = ?3 AND deleted_at IS NULL",
            params![
                node_id.to_string(),
                game_id.to_string(),
                parent_id.to_string()
            ],
        )?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![operation.created_at.to_rfc3339(), game_id.to_string()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_node_with_operation(
        &mut self,
        game_id: Uuid,
        node_id: Uuid,
        current_node_id: Option<Uuid>,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "WITH RECURSIVE subtree(id) AS (
               SELECT id FROM move_nodes WHERE id = ?2
               UNION ALL
               SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
             )
             UPDATE move_nodes SET deleted_at = ?1 WHERE id IN (SELECT id FROM subtree)",
            params![operation.created_at.to_rfc3339(), node_id.to_string()],
        )?;
        promote_first_live_sibling(&transaction, node_id)?;
        transaction.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                current_node_id.map(|id| id.to_string()),
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_current_node(
        &mut self,
        game_id: Uuid,
        current_node_id: Option<Uuid>,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                current_node_id.map(|id| id.to_string()),
                chrono::Utc::now().to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        Ok(())
    }

    pub fn save_engine_profile(
        &mut self,
        name: &str,
        executable_path: &str,
        protocol: &str,
    ) -> Result<Uuid, StoreError> {
        let existing: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM engine_profiles WHERE executable_path = ?1 LIMIT 1",
                [executable_path],
                |row| row.get(0),
            )
            .optional()?;
        let id = existing
            .map(|value| Uuid::parse_str(&value).map_err(json_error))
            .transpose()?
            .unwrap_or_else(Uuid::new_v4);
        self.connection.execute(
            "INSERT INTO engine_profiles (id, name, executable_path, protocol)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,
             executable_path=excluded.executable_path, protocol=excluded.protocol",
            params![id.to_string(), name, executable_path, protocol],
        )?;
        Ok(id)
    }

    pub fn list_engine_profiles(&self) -> Result<Vec<EngineProfile>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, executable_path, protocol FROM engine_profiles ORDER BY name COLLATE NOCASE, rowid",
        )?;
        statement
            .query_map([], |row| {
                let id: String = row.get(0)?;
                Ok(EngineProfile {
                    id: parse_row_uuid(&id, 0)?,
                    name: row.get(1)?,
                    executable_path: row.get(2)?,
                    protocol: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn delete_engine_profile(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.connection.execute(
            "DELETE FROM engine_profiles WHERE id = ?1",
            [id.to_string()],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_analysis(
        &mut self,
        game_id: Uuid,
        node_id: Option<Uuid>,
        engine_fingerprint: &str,
        config_hash: &str,
        depth: Option<u32>,
        score_cp: Option<i32>,
        mate: Option<i32>,
        pv_json: &str,
        elapsed_ms: u64,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO analysis_results
             (id, game_id, node_id, engine_fingerprint, config_hash, depth,
              score_cp, mate, pv_json, elapsed_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(game_id, node_id, engine_fingerprint, config_hash)
             DO UPDATE SET depth=excluded.depth, score_cp=excluded.score_cp,
             mate=excluded.mate, pv_json=excluded.pv_json,
             elapsed_ms=excluded.elapsed_ms, created_at=excluded.created_at",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                node_id.map(|id| id.to_string()),
                engine_fingerprint,
                config_hash,
                depth,
                score_cp,
                mate,
                pv_json,
                elapsed_ms as i64,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn load_latest_analysis(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
    ) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT pv_json FROM analysis_results
                 WHERE game_id = ?1 AND node_id IS ?2 AND config_hash NOT LIKE 'report:%'
                 ORDER BY created_at DESC LIMIT 1",
                params![game_id.to_string(), node_id.map(|id| id.to_string())],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn load_latest_analysis_summary(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
    ) -> Result<Option<AnalysisSummary>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT score_cp, mate FROM analysis_results
                 WHERE game_id = ?1 AND node_id IS ?2
                 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![game_id.to_string(), node_id.map(|id| id.to_string())],
                |row| {
                    Ok(AnalysisSummary {
                        score_cp: row.get(0)?,
                        mate: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_analysis_for_config(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
        engine_fingerprint: &str,
        config_hash: &str,
    ) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT pv_json FROM analysis_results
             WHERE game_id = ?1 AND node_id IS ?2
               AND engine_fingerprint = ?3 AND config_hash = ?4
             ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![
                    game_id.to_string(),
                    node_id.map(|id| id.to_string()),
                    engine_fingerprint,
                    config_hash
                ],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn load_latest_analysis_summaries(
        &self,
        game_id: Uuid,
    ) -> Result<HashMap<Uuid, AnalysisSummary>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT node_id, score_cp, mate FROM analysis_results
             WHERE game_id = ?1 AND node_id IS NOT NULL
             ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = statement.query_map([game_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i32>>(1)?,
                row.get::<_, Option<i32>>(2)?,
            ))
        })?;
        let mut summaries = HashMap::new();
        for row in rows {
            let (node_id, score_cp, mate) = row?;
            let node_id = Uuid::parse_str(&node_id).map_err(json_error)?;
            summaries
                .entry(node_id)
                .or_insert(AnalysisSummary { score_cp, mate });
        }
        Ok(summaries)
    }

    pub fn save_game_report(
        &mut self,
        game_id: Uuid,
        line_signature: &str,
        engine_fingerprint: &str,
        config_hash: &str,
        dataset_json: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO game_reports
             (id, game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(game_id, line_signature, engine_fingerprint, config_hash)
             DO UPDATE SET dataset_json=excluded.dataset_json, created_at=excluded.created_at",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                line_signature,
                engine_fingerprint,
                config_hash,
                dataset_json,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn load_latest_game_report(
        &self,
        game_id: Uuid,
    ) -> Result<Option<StoredGameReport>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at
             FROM game_reports WHERE game_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                [game_id.to_string()],
                |row| {
                    Ok(StoredGameReport {
                        game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                        line_signature: row.get(1)?,
                        engine_fingerprint: row.get(2)?,
                        config_hash: row.get(3)?,
                        dataset_json: row.get(4)?,
                        generated_at: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_game_report(
        &self,
        game_id: Uuid,
        line_signature: &str,
    ) -> Result<Option<StoredGameReport>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at
                 FROM game_reports
                 WHERE game_id = ?1 AND line_signature = ?2
                 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![game_id.to_string(), line_signature],
                |row| {
                    Ok(StoredGameReport {
                        game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                        line_signature: row.get(1)?,
                        engine_fingerprint: row.get(2)?,
                        config_hash: row.get(3)?,
                        dataset_json: row.get(4)?,
                        generated_at: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_latest_game_reports(&self) -> Result<Vec<StoredGameReport>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT r.game_id, r.line_signature, r.engine_fingerprint, r.config_hash, r.dataset_json, r.created_at
             FROM game_reports r
             INNER JOIN (SELECT game_id, MAX(rowid) AS latest_rowid FROM game_reports GROUP BY game_id) latest
               ON latest.latest_rowid = r.rowid
             ORDER BY r.created_at DESC, r.rowid DESC",
        )?;
        statement
            .query_map([], |row| {
                Ok(StoredGameReport {
                    game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                    line_signature: row.get(1)?,
                    engine_fingerprint: row.get(2)?,
                    config_hash: row.get(3)?,
                    dataset_json: row.get(4)?,
                    generated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn upsert_training_task(
        &mut self,
        game_id: Uuid,
        report_signature: &str,
        node_id: Uuid,
        title: &str,
        detail: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO training_tasks (id, game_id, report_signature, node_id, title, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(game_id, report_signature, node_id)
             DO UPDATE SET title=excluded.title, detail=excluded.detail",
            params![
                Uuid::new_v4().to_string(), game_id.to_string(), report_signature, node_id.to_string(),
                title, detail, chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_training_task_with_context(
        &mut self,
        game_id: Uuid,
        report_signature: &str,
        node_id: Uuid,
        title: &str,
        detail: &str,
        phase: Option<&str>,
        tags: &[String],
        source_card_id: Option<i64>,
        task_type: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO training_tasks (id, game_id, report_signature, node_id, title, detail, phase, tags_json, source_card_id, task_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(game_id, report_signature, node_id)
             DO UPDATE SET title=excluded.title, detail=excluded.detail, phase=excluded.phase,
                           tags_json=excluded.tags_json, source_card_id=excluded.source_card_id,
                           task_type=excluded.task_type",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                report_signature,
                node_id.to_string(),
                title,
                detail,
                phase,
                serde_json::to_string(tags)?,
                source_card_id,
                task_type,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_training_tasks(&self) -> Result<Vec<TrainingTask>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, report_signature, node_id, title, detail, phase, tags_json, source_card_id, task_type, completed_at, created_at
             FROM training_tasks ORDER BY completed_at IS NOT NULL, created_at DESC",
        )?;
        statement
            .query_map([], |row| {
                let tags_json: String = row.get(7)?;
                Ok(TrainingTask {
                    id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                    game_id: parse_row_uuid(&row.get::<_, String>(1)?, 1)?,
                    report_signature: row.get(2)?,
                    node_id: parse_row_uuid(&row.get::<_, String>(3)?, 3)?,
                    title: row.get(4)?,
                    detail: row.get(5)?,
                    phase: row.get(6)?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    source_card_id: row.get(8)?,
                    task_type: row.get(9)?,
                    completed_at: row.get(10)?,
                    created_at: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn complete_training_task(
        &mut self,
        task_id: Uuid,
        completed: bool,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE training_tasks SET completed_at = ?2 WHERE id = ?1",
            params![
                task_id.to_string(),
                completed.then(|| chrono::Utc::now().to_rfc3339())
            ],
        )?;
        Ok(())
    }

    pub fn learning_profile(&self) -> Result<LearningProfile, StoreError> {
        let stored = self
            .connection
            .query_row(
                "SELECT profile_json FROM learning_profiles WHERE id = 'default'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(stored
            .as_deref()
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_else(LearningProfile::u10_default))
    }

    pub fn save_learning_profile(
        &mut self,
        profile: &LearningProfile,
    ) -> Result<LearningProfile, StoreError> {
        let mut profile = profile.clone();
        profile.id = "default".into();
        profile.age_group = "U10".into();
        profile.session_minutes = 40;
        profile.cycle_weeks = 12;
        profile.personal_ratio = 60;
        profile.thematic_ratio = 40;
        profile.current_week = profile.current_week.clamp(1, 12);
        profile.updated_at = chrono::Utc::now().to_rfc3339();
        if profile.created_at.is_empty() {
            profile.created_at = profile.updated_at.clone();
        }
        self.connection.execute(
            "INSERT INTO learning_profiles (id, profile_json, updated_at) VALUES ('default', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at",
            params![serde_json::to_string(&profile)?, profile.updated_at],
        )?;
        Ok(profile)
    }

    pub fn start_guided_analysis(
        &mut self,
        game_id: Uuid,
        problem_node_id: Option<Uuid>,
        start_node_id: Option<Uuid>,
        report_signature: &str,
        fen: &str,
        phase: &str,
    ) -> Result<GuidedAnalysisSession, StoreError> {
        self.connection.execute(
            "UPDATE guided_analysis_sessions SET status='cancelled', answer_hidden=0
             WHERE status='thinking'",
            [],
        )?;
        let session = GuidedAnalysisSession {
            id: Uuid::new_v4(),
            game_id,
            problem_node_id,
            start_node_id,
            report_signature: report_signature.into(),
            fen: fen.into(),
            phase: phase.into(),
            status: "thinking".into(),
            answer_hidden: true,
            submission: None,
            result_kind: None,
            score: None,
            result_json: None,
            started_at: chrono::Utc::now().to_rfc3339(),
            submitted_at: None,
        };
        self.connection.execute(
            "INSERT INTO guided_analysis_sessions
             (id, game_id, problem_node_id, start_node_id, report_signature, fen, phase, status,
              answer_hidden, submission_json, result_kind, score, result_json, started_at, submitted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, NULL, NULL, NULL, NULL, ?9, NULL)",
            params![
                session.id.to_string(),
                session.game_id.to_string(),
                session.problem_node_id.map(|id| id.to_string()),
                session.start_node_id.map(|id| id.to_string()),
                session.report_signature,
                session.fen,
                session.phase,
                session.status,
                session.started_at,
            ],
        )?;
        Ok(session)
    }

    pub fn submit_guided_analysis(
        &mut self,
        session_id: Uuid,
        submission: &GuidedAnalysisSubmission,
        result_kind: &str,
        score: u32,
        result_json: &str,
    ) -> Result<GuidedAnalysisSession, StoreError> {
        self.connection.execute(
            "UPDATE guided_analysis_sessions
             SET status='submitted', answer_hidden=0, submission_json=?2, result_kind=?3,
                 score=?4, result_json=?5, submitted_at=?6
             WHERE id=?1 AND status='thinking'",
            params![
                session_id.to_string(),
                serde_json::to_string(submission)?,
                result_kind,
                score.clamp(0, 100),
                result_json,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        self.guided_analysis_session(session_id)?
            .ok_or_else(|| StoreError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn cancel_guided_analysis(&mut self, session_id: Uuid) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE guided_analysis_sessions SET status='cancelled', answer_hidden=0 WHERE id=?1",
            [session_id.to_string()],
        )?;
        Ok(())
    }

    pub fn guided_analysis_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<GuidedAnalysisSession>, StoreError> {
        self.connection
            .query_row(
                "SELECT id, game_id, problem_node_id, start_node_id, report_signature, fen, phase,
                        status, answer_hidden, submission_json, result_kind, score, result_json,
                        started_at, submitted_at
                 FROM guided_analysis_sessions WHERE id=?1",
                [session_id.to_string()],
                guided_session_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn save_training_attempt(
        &mut self,
        task_id: Uuid,
        session_id: Option<Uuid>,
        submission: &GuidedAnalysisSubmission,
        score: u32,
        result_kind: &str,
        parent_note: &str,
    ) -> Result<TrainingAttempt, StoreError> {
        let previous = self.training_attempts(Some(task_id))?;
        let review_round = previous.len() as u32 + 1;
        let score = score.clamp(0, 100);
        let three_high_scores = previous
            .iter()
            .rev()
            .take(2)
            .all(|attempt| attempt.score >= 80)
            && previous.len() >= 2
            && score >= 80;
        let two_hint_free = submission.hints_used == 0
            && previous
                .last()
                .is_some_and(|attempt| attempt.submission.hints_used == 0);
        let mastered = three_high_scores && two_hint_free;
        let review_days = match review_round {
            1 => 1,
            2 => 3,
            _ => 7,
        };
        let now = chrono::Utc::now();
        let attempt = TrainingAttempt {
            id: Uuid::new_v4(),
            task_id,
            session_id,
            submission: submission.clone(),
            score,
            result_kind: result_kind.into(),
            parent_note: parent_note.into(),
            review_round,
            next_review_at: (!mastered)
                .then(|| (now + chrono::Duration::days(review_days)).to_rfc3339()),
            mastered,
            created_at: now.to_rfc3339(),
        };
        self.connection.execute(
            "INSERT INTO training_attempts
             (id, task_id, session_id, submission_json, score, result_kind, parent_note,
              review_round, next_review_at, mastered, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                attempt.id.to_string(),
                attempt.task_id.to_string(),
                attempt.session_id.map(|id| id.to_string()),
                serde_json::to_string(&attempt.submission)?,
                attempt.score,
                attempt.result_kind,
                attempt.parent_note,
                attempt.review_round,
                attempt.next_review_at,
                attempt.mastered as i32,
                attempt.created_at,
            ],
        )?;
        self.connection.execute(
            "INSERT INTO training_review_schedule (task_id, next_review_at, review_round, mastered, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(task_id) DO UPDATE SET next_review_at=excluded.next_review_at,
                review_round=excluded.review_round, mastered=excluded.mastered, updated_at=excluded.updated_at",
            params![
                task_id.to_string(),
                attempt.next_review_at,
                review_round,
                mastered as i32,
                attempt.created_at,
            ],
        )?;
        Ok(attempt)
    }

    pub fn training_attempts(
        &self,
        task_id: Option<Uuid>,
    ) -> Result<Vec<TrainingAttempt>, StoreError> {
        let sql = if task_id.is_some() {
            "SELECT id, task_id, session_id, submission_json, score, result_kind, parent_note,
                    review_round, next_review_at, mastered, created_at
             FROM training_attempts WHERE task_id=?1 ORDER BY created_at, rowid"
        } else {
            "SELECT id, task_id, session_id, submission_json, score, result_kind, parent_note,
                    review_round, next_review_at, mastered, created_at
             FROM training_attempts ORDER BY created_at, rowid"
        };
        let mut statement = self.connection.prepare(sql)?;
        let mapper = |row: &rusqlite::Row<'_>| training_attempt_from_row(row);
        if let Some(task_id) = task_id {
            statement
                .query_map([task_id.to_string()], mapper)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(Into::into)
        } else {
            statement
                .query_map([], mapper)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(Into::into)
        }
    }

    pub fn weakness_stats(&self, limit: usize) -> Result<Vec<WeaknessStat>, StoreError> {
        let cards = self.theory_cards()?;
        let mut card_by_id = HashMap::new();
        for card in cards {
            card_by_id.insert(card.id, card);
        }
        let mut stats: HashMap<(String, String), (u32, u32, u32, Vec<i64>)> = HashMap::new();
        for session in self.all_study_sessions()? {
            for tag in session.tags {
                let key = ("复盘".to_owned(), tag);
                stats.entry(key).or_default().0 += 1;
            }
        }
        for task in self.list_training_tasks()? {
            let phase = task.phase.clone().unwrap_or_else(|| "复盘".into());
            for tag in task.tags {
                let entry = stats.entry((phase.clone(), tag)).or_default();
                entry.0 += 1;
                if task.completed_at.is_some() {
                    entry.1 += 1;
                } else {
                    entry.2 += 1;
                }
                if let Some(card_id) = task.source_card_id {
                    entry.3.push(card_id);
                }
            }
        }
        let mut result = stats
            .into_iter()
            .map(
                |((phase, tag), (occurrences, completed_tasks, open_tasks, card_ids))| {
                    let mut review_cards = Vec::new();
                    for card_id in card_ids {
                        if review_cards
                            .iter()
                            .any(|card: &TheoryCard| card.id == card_id)
                        {
                            continue;
                        }
                        if let Some(card) = card_by_id.get(&card_id) {
                            review_cards.push(card.clone());
                        }
                    }
                    WeaknessStat {
                        phase,
                        tag,
                        occurrences,
                        completed_tasks,
                        open_tasks,
                        review_cards,
                    }
                },
            )
            .collect::<Vec<_>>();
        result.sort_by(|left, right| {
            right
                .open_tasks
                .cmp(&left.open_tasks)
                .then(right.occurrences.cmp(&left.occurrences))
                .then(left.phase.cmp(&right.phase))
                .then(left.tag.cmp(&right.tag))
        });
        result.truncate(limit);
        Ok(result)
    }

    pub fn apply_remote_operation(
        &mut self,
        operation: &Operation,
        cursor: u64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        project_operation(&transaction, operation)?;
        insert_operation(&transaction, operation, true)?;
        transaction.execute(
            "INSERT INTO sync_state (key, value) VALUES ('remote_cursor', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [cursor.to_string()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn remote_cursor(&self) -> Result<u64, StoreError> {
        let value = self.sync_value("remote_cursor")?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    pub fn active_game_id(&self) -> Result<Option<Uuid>, StoreError> {
        self.sync_value("active_game_id")?
            .map(|value| Uuid::parse_str(&value).map_err(json_error))
            .transpose()
            .map_err(Into::into)
    }

    pub fn set_active_game_id(&mut self, game_id: Uuid) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO sync_state (key, value) VALUES ('active_game_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [game_id.to_string()],
        )?;
        Ok(())
    }

    pub fn load_game(&self, game_id: Uuid) -> Result<Option<LocalGame>, StoreError> {
        self.load_game_where(
            "WHERE id = ?1 AND deleted_at IS NULL",
            [game_id.to_string()],
        )
    }

    pub fn load_latest_game(&self) -> Result<Option<LocalGame>, StoreError> {
        self.load_game_where(
            "WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
            [],
        )
    }

    pub fn load_games(&self) -> Result<Vec<LocalGame>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, starting_fen, root_id, current_node_id, note,
                    source_path, source_format, playable, updated_at, metadata_json, library_folder, favorite, tags_json
             FROM games WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], local_game_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(parse_local_game)
            .collect()
    }

    pub fn game_mirror_status(
        &self,
        game_id: Uuid,
    ) -> Result<Option<GameMirrorStatus>, StoreError> {
        self.connection.query_row(
            "SELECT game_id, path, state, updated_at, error FROM game_mirror_status WHERE game_id=?1",
            [game_id.to_string()],
            |row| Ok(GameMirrorStatus {
                game_id: row.get::<_, String>(0)?.parse().map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
                path: row.get(1)?, state: row.get(2)?, updated_at: row.get(3)?, error: row.get(4)?,
            }),
        ).optional().map_err(Into::into)
    }

    pub fn game_mirror_statuses(&self) -> Result<Vec<GameMirrorStatus>, StoreError> {
        let mut statement = self
            .connection
            .prepare("SELECT game_id, path, state, updated_at, error FROM game_mirror_status")?;
        statement
            .query_map([], |row| {
                Ok(GameMirrorStatus {
                    game_id: row.get::<_, String>(0)?.parse().map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    path: row.get(1)?,
                    state: row.get(2)?,
                    updated_at: row.get(3)?,
                    error: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn save_game_mirror_status(&mut self, status: &GameMirrorStatus) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO game_mirror_status (game_id, path, state, updated_at, error) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(game_id) DO UPDATE SET path=excluded.path, state=excluded.state, updated_at=excluded.updated_at, error=excluded.error",
            params![status.game_id.to_string(), status.path, status.state, status.updated_at, status.error],
        )?;
        Ok(())
    }

    fn load_game_where<const N: usize>(
        &self,
        clause: &str,
        params: [String; N],
    ) -> Result<Option<LocalGame>, StoreError> {
        let sql = format!(
            "SELECT id, title, starting_fen, root_id, current_node_id, note, source_path, source_format, playable, updated_at, metadata_json, library_folder, favorite, tags_json FROM games {clause}"
        );
        let row = self
            .connection
            .query_row(
                &sql,
                rusqlite::params_from_iter(params),
                local_game_from_row,
            )
            .optional()?;
        row.map(parse_local_game).transpose()
    }

    fn sync_value(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    fn set_sync_value(&mut self, key: &str, value: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn local_state_value(&self, key: &str) -> Result<Option<String>, StoreError> {
        self.sync_value(key)
    }

    pub fn set_local_state_value(&mut self, key: &str, value: &str) -> Result<(), StoreError> {
        self.set_sync_value(key, value)
    }

    pub fn load_move_nodes(&self, game_id: Uuid) -> Result<Vec<MoveNode>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, move_iccs, comment, is_mainline, deleted_at IS NOT NULL, order_key
             FROM move_nodes WHERE game_id = ?1 ORDER BY order_key",
        )?;
        let rows = statement.query_map([game_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        let mut nodes = Vec::new();
        for row in rows {
            let (id, parent_id, move_iccs, comment, is_mainline, deleted, order_key) = row?;
            nodes.push(MoveNode {
                id: Uuid::parse_str(&id).map_err(json_error)?,
                parent_id: Uuid::parse_str(&parent_id).map_err(json_error)?,
                mv: Move::from_iccs(&move_iccs).map_err(json_error)?,
                comment,
                is_mainline,
                deleted,
                order_key: order_key as u64,
            });
        }
        Ok(nodes)
    }

    fn initialize(connection: Connection) -> Result<Self, StoreError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS games (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, starting_fen TEXT NOT NULL,
               root_id TEXT NOT NULL, current_node_id TEXT, updated_at TEXT NOT NULL, deleted_at TEXT,
               note TEXT NOT NULL DEFAULT '', source_path TEXT, source_format TEXT,
               playable INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}'
             );
             CREATE TABLE IF NOT EXISTS library_folders (
               name TEXT PRIMARY KEY, system INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS move_nodes (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, parent_id TEXT,
               move_iccs TEXT NOT NULL, cn_move TEXT, comment TEXT NOT NULL DEFAULT '',
               order_key INTEGER NOT NULL, is_mainline INTEGER NOT NULL DEFAULT 0,
               deleted_at TEXT, FOREIGN KEY(game_id) REFERENCES games(id)
             );
             CREATE INDEX IF NOT EXISTS idx_move_nodes_parent ON move_nodes(game_id, parent_id, order_key);
             CREATE TABLE IF NOT EXISTS operations (
               local_sequence INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE,
               device_id TEXT NOT NULL, entity_id TEXT NOT NULL, game_id TEXT NOT NULL,
               kind TEXT NOT NULL, payload TEXT NOT NULL, lamport INTEGER NOT NULL,
               created_at TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_operations_outbox ON operations(uploaded, local_sequence);
             CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS desktop_preferences (
               id INTEGER PRIMARY KEY CHECK (id = 1), preferences_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS engine_profiles (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, executable_path TEXT NOT NULL,
               protocol TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}'
             );
             CREATE TABLE IF NOT EXISTS analysis_results (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, node_id TEXT,
               engine_fingerprint TEXT NOT NULL, config_hash TEXT NOT NULL,
               depth INTEGER, score_cp INTEGER, mate INTEGER, pv_json TEXT NOT NULL,
               elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
               UNIQUE(game_id, node_id, engine_fingerprint, config_hash)
             );
             CREATE TABLE IF NOT EXISTS game_reports (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL,
               line_signature TEXT NOT NULL, engine_fingerprint TEXT NOT NULL,
               config_hash TEXT NOT NULL, dataset_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               UNIQUE(game_id, line_signature, engine_fingerprint, config_hash)
             );
             CREATE TABLE IF NOT EXISTS training_tasks (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
               node_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
               phase TEXT, tags_json TEXT NOT NULL DEFAULT '[]', source_card_id INTEGER,
               task_type TEXT NOT NULL DEFAULT 'critical',
               completed_at TEXT, created_at TEXT NOT NULL,
               UNIQUE(game_id, report_signature, node_id)
             );
             CREATE TABLE IF NOT EXISTS theory_lessons (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               phase TEXT NOT NULL, course_name TEXT NOT NULL, title TEXT NOT NULL,
               source_path TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
               transcription_status TEXT NOT NULL DEFAULT 'queued', duration_ms INTEGER,
               scanned_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_theory_lessons_phase ON theory_lessons(phase, transcription_status);
             CREATE TABLE IF NOT EXISTS theory_cards (
               id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT, lesson_id INTEGER NOT NULL,
               title TEXT NOT NULL, summary TEXT NOT NULL, applies_when TEXT NOT NULL,
               risk TEXT NOT NULL, timecode TEXT, review_status TEXT NOT NULL DEFAULT 'pending',
               source_book TEXT, source_page_start INTEGER, source_page_end INTEGER,
               tags_json TEXT NOT NULL DEFAULT '[]', engine_correlations_json TEXT NOT NULL DEFAULT '[]',
               origin TEXT NOT NULL DEFAULT 'user', version INTEGER NOT NULL DEFAULT 1,
               user_modified INTEGER NOT NULL DEFAULT 0, match_penalty INTEGER NOT NULL DEFAULT 0,
               needs_recheck INTEGER NOT NULL DEFAULT 0,
             FOREIGN KEY(lesson_id) REFERENCES theory_lessons(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_theory_cards_review ON theory_cards(review_status, lesson_id);
             CREATE TABLE IF NOT EXISTS theory_card_matches (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
               node_id TEXT NOT NULL, card_id INTEGER NOT NULL, card_version INTEGER NOT NULL,
               engine_signal TEXT NOT NULL, matched_tags_json TEXT NOT NULL DEFAULT '[]',
               verdict TEXT NOT NULL DEFAULT 'unreviewed', note TEXT NOT NULL DEFAULT '',
               created_at TEXT NOT NULL,
               FOREIGN KEY(card_id) REFERENCES theory_cards(id)
             );
             CREATE INDEX IF NOT EXISTS idx_theory_card_matches_node ON theory_card_matches(game_id, node_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS theory_card_feedback (
               id TEXT PRIMARY KEY, match_id TEXT, card_id INTEGER NOT NULL, card_version INTEGER NOT NULL,
               verdict TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
               FOREIGN KEY(match_id) REFERENCES theory_card_matches(id),
               FOREIGN KEY(card_id) REFERENCES theory_cards(id)
             );
             CREATE INDEX IF NOT EXISTS idx_theory_card_feedback_card ON theory_card_feedback(card_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS master_style_profiles (
               id TEXT PRIMARY KEY, player_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
               version TEXT NOT NULL, sample_count INTEGER NOT NULL DEFAULT 0,
               generated_at TEXT NOT NULL, profile_json TEXT NOT NULL, imported_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_master_style_profiles_name ON master_style_profiles(normalized_name, imported_at DESC);
             CREATE TABLE IF NOT EXISTS master_style_samples (
               id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, player_name TEXT NOT NULL,
               source_game_id TEXT NOT NULL, source_title TEXT NOT NULL,
               event_name TEXT, game_date TEXT, ply INTEGER NOT NULL,
               phase TEXT NOT NULL, before_fen TEXT NOT NULL, played_move TEXT NOT NULL,
               played_move_rank INTEGER, played_move_in_topn INTEGER NOT NULL DEFAULT 0,
               best_move TEXT, best_score_cp INTEGER,
               candidates_json TEXT NOT NULL DEFAULT '[]', source_json TEXT NOT NULL DEFAULT '{}',
               imported_at TEXT NOT NULL,
               FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_master_style_samples_fen ON master_style_samples(before_fen, profile_id);
             CREATE INDEX IF NOT EXISTS idx_master_style_samples_phase_move ON master_style_samples(phase, played_move, profile_id);
             CREATE TABLE IF NOT EXISTS master_style_matches (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
               node_id TEXT NOT NULL, profile_id TEXT NOT NULL, sample_id TEXT NOT NULL,
               confidence TEXT NOT NULL, reason TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'unreviewed',
               note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
               UNIQUE(game_id, report_signature, node_id, profile_id, sample_id),
               FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id),
               FOREIGN KEY(sample_id) REFERENCES master_style_samples(id)
             );
             CREATE INDEX IF NOT EXISTS idx_master_style_matches_node ON master_style_matches(game_id, node_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS study_sessions (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, node_id TEXT,
               reflection TEXT NOT NULL, tags_json TEXT NOT NULL, created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_study_sessions_game ON study_sessions(game_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS flyknife_plans (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, side TEXT NOT NULL,
               starting_fen TEXT NOT NULL, template_id TEXT, template_name TEXT NOT NULL,
               lure_move TEXT NOT NULL, knife_move TEXT NOT NULL,
               mainline_json TEXT NOT NULL, best_defense_json TEXT NOT NULL,
               score_cp INTEGER, mate INTEGER, risk TEXT NOT NULL,
               source_game_id TEXT, source_node_id TEXT, note TEXT NOT NULL DEFAULT '',
               annotations_json TEXT NOT NULL DEFAULT '[]',
               created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_flyknife_plans_side ON flyknife_plans(side, created_at DESC);
             CREATE TABLE IF NOT EXISTS game_mirror_status (
               game_id TEXT PRIMARY KEY, path TEXT, state TEXT NOT NULL,
               updated_at TEXT, error TEXT
             );
             UPDATE operations
             SET payload = json_set(
               payload,
               '$.rootId',
               (SELECT root_id FROM games WHERE games.id = operations.game_id)
             )
             WHERE kind = '\"create_game\"'
               AND json_extract(payload, '$.rootId') IS NULL;",
        )?;
        ensure_game_column(&connection, "note", "TEXT NOT NULL DEFAULT ''")?;
        ensure_game_column(&connection, "source_path", "TEXT")?;
        ensure_game_column(&connection, "source_format", "TEXT")?;
        ensure_game_column(&connection, "playable", "INTEGER NOT NULL DEFAULT 1")?;
        ensure_game_column(&connection, "metadata_json", "TEXT NOT NULL DEFAULT '{}'")?;
        ensure_game_column(&connection, "library_folder", "TEXT")?;
        ensure_game_column(&connection, "favorite", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_game_column(&connection, "tags_json", "TEXT NOT NULL DEFAULT '[]'")?;
        ensure_column(
            &connection,
            "flyknife_plans",
            "annotations_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        connection.execute_batch(
            "INSERT OR IGNORE INTO library_folders (name, system) VALUES
             ('比赛复盘', 1), ('开局研究', 1), ('飞刀方案', 1), ('训练题', 1);",
        )?;
        ensure_column(&connection, "training_tasks", "phase", "TEXT")?;
        ensure_column(
            &connection,
            "training_tasks",
            "tags_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(&connection, "training_tasks", "source_card_id", "INTEGER")?;
        ensure_column(
            &connection,
            "training_tasks",
            "task_type",
            "TEXT NOT NULL DEFAULT 'critical'",
        )?;
        ensure_column(&connection, "theory_cards", "external_id", "TEXT")?;
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_theory_cards_external_id_unique ON theory_cards(external_id)",
            [],
        )?;
        ensure_column(&connection, "theory_cards", "source_book", "TEXT")?;
        ensure_column(&connection, "theory_cards", "source_page_start", "INTEGER")?;
        ensure_column(&connection, "theory_cards", "source_page_end", "INTEGER")?;
        ensure_column(
            &connection,
            "theory_cards",
            "tags_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "engine_correlations_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "origin",
            "TEXT NOT NULL DEFAULT 'user'",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "version",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "user_modified",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "match_penalty",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &connection,
            "theory_cards",
            "needs_recheck",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        connection.execute(
            "CREATE TABLE IF NOT EXISTS master_style_profiles (
               id TEXT PRIMARY KEY, player_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
               version TEXT NOT NULL, sample_count INTEGER NOT NULL DEFAULT 0,
               generated_at TEXT NOT NULL, profile_json TEXT NOT NULL, imported_at TEXT NOT NULL
             )",
            [],
        )?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_master_style_profiles_name ON master_style_profiles(normalized_name, imported_at DESC)",
            [],
        )?;
        connection.execute(
            "CREATE TABLE IF NOT EXISTS master_style_samples (
               id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, player_name TEXT NOT NULL,
               source_game_id TEXT NOT NULL, source_title TEXT NOT NULL,
               event_name TEXT, game_date TEXT, ply INTEGER NOT NULL,
               phase TEXT NOT NULL, before_fen TEXT NOT NULL, played_move TEXT NOT NULL,
               played_move_rank INTEGER, played_move_in_topn INTEGER NOT NULL DEFAULT 0,
               best_move TEXT, best_score_cp INTEGER,
               candidates_json TEXT NOT NULL DEFAULT '[]', source_json TEXT NOT NULL DEFAULT '{}',
               imported_at TEXT NOT NULL,
               FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id) ON DELETE CASCADE
             )",
            [],
        )?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_master_style_samples_fen ON master_style_samples(before_fen, profile_id)",
            [],
        )?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_master_style_samples_phase_move ON master_style_samples(phase, played_move, profile_id)",
            [],
        )?;
        connection.execute(
            "CREATE TABLE IF NOT EXISTS master_style_matches (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
               node_id TEXT NOT NULL, profile_id TEXT NOT NULL, sample_id TEXT NOT NULL,
               confidence TEXT NOT NULL, reason TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'unreviewed',
               note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
               UNIQUE(game_id, report_signature, node_id, profile_id, sample_id),
               FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id),
               FOREIGN KEY(sample_id) REFERENCES master_style_samples(id)
             )",
            [],
        )?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_master_style_matches_node ON master_style_matches(game_id, node_id, created_at DESC)",
            [],
        )?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS learning_profiles (
               id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS guided_analysis_sessions (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, problem_node_id TEXT, start_node_id TEXT,
               report_signature TEXT NOT NULL, fen TEXT NOT NULL, phase TEXT NOT NULL,
               status TEXT NOT NULL, answer_hidden INTEGER NOT NULL DEFAULT 1,
               submission_json TEXT, result_kind TEXT, score INTEGER, result_json TEXT,
               started_at TEXT NOT NULL, submitted_at TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_guided_sessions_game
               ON guided_analysis_sessions(game_id, started_at DESC);
             CREATE TABLE IF NOT EXISTS training_attempts (
               id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT,
               submission_json TEXT NOT NULL, score INTEGER NOT NULL, result_kind TEXT NOT NULL,
               parent_note TEXT NOT NULL DEFAULT '', review_round INTEGER NOT NULL,
               next_review_at TEXT, mastered INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_training_attempts_task
               ON training_attempts(task_id, created_at);
             CREATE TABLE IF NOT EXISTS training_review_schedule (
               task_id TEXT PRIMARY KEY, next_review_at TEXT, review_round INTEGER NOT NULL DEFAULT 0,
               mastered INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
             );",
        )?;
        Ok(Self { connection })
    }
}

fn insert_operation(
    connection: &Connection,
    operation: &Operation,
    uploaded: bool,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT OR IGNORE INTO operations
         (op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at, uploaded)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            operation.op_id.to_string(),
            operation.device_id.to_string(),
            operation.entity_id.to_string(),
            operation.game_id.to_string(),
            serde_json::to_string(&operation.kind)?,
            serde_json::to_string(&operation.payload)?,
            operation.lamport as i64,
            operation.created_at.to_rfc3339(),
            uploaded as i32,
        ],
    )?;
    Ok(())
}

type LocalGameRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    bool,
    String,
    String,
    Option<String>,
    bool,
    String,
);

fn local_game_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalGameRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
        row.get(13)?,
    ))
}

fn parse_local_game(
    (
        id,
        title,
        starting_fen,
        root_id,
        current_node_id,
        note,
        source_path,
        source_format,
        playable,
        updated_at,
        metadata_json,
        library_folder,
        favorite,
        tags_json,
    ): LocalGameRow,
) -> Result<LocalGame, StoreError> {
    Ok(LocalGame {
        id: Uuid::parse_str(&id).map_err(json_error)?,
        title,
        starting_fen,
        root_id: Uuid::parse_str(&root_id).map_err(json_error)?,
        current_node_id: current_node_id
            .map(|id| Uuid::parse_str(&id).map_err(json_error))
            .transpose()?,
        note,
        source_path,
        source_format,
        playable,
        updated_at,
        metadata_json,
        library_folder,
        favorite,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    })
}

fn project_operation(connection: &Connection, operation: &Operation) -> Result<(), StoreError> {
    match operation.kind {
        OperationKind::CreateGame => {
            let payload: CreateGamePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "INSERT INTO games (id, title, starting_fen, root_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                 starting_fen=excluded.starting_fen, root_id=excluded.root_id,
                 updated_at=excluded.updated_at, deleted_at=NULL",
                params![
                    operation.game_id.to_string(),
                    payload.title,
                    payload.fen,
                    payload.root_id.to_string(),
                    operation.created_at.to_rfc3339()
                ],
            )?;
        }
        OperationKind::AddMove => {
            let payload: AddMovePayload = serde_json::from_value(operation.payload.clone())?;
            let order_key = connection.query_row(
                "SELECT COALESCE(MAX(order_key), -1) + 1 FROM move_nodes
                 WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL AND id != ?3",
                params![
                    operation.game_id.to_string(),
                    payload.parent_id.to_string(),
                    payload.node_id.to_string()
                ],
                |row| row.get::<_, i64>(0),
            )?;
            if payload.is_mainline {
                connection.execute(
                    "UPDATE move_nodes SET is_mainline = 0
                     WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL",
                    params![operation.game_id.to_string(), payload.parent_id.to_string()],
                )?;
            }
            connection.execute(
                "INSERT INTO move_nodes
                 (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline)
                 VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,
                 move_iccs=excluded.move_iccs, order_key=excluded.order_key,
                 is_mainline=excluded.is_mainline, deleted_at=NULL",
                params![
                    payload.node_id.to_string(),
                    operation.game_id.to_string(),
                    payload.parent_id.to_string(),
                    payload.move_iccs,
                    order_key,
                    payload.is_mainline as i32
                ],
            )?;
            connection.execute(
                "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    payload.node_id.to_string(),
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::UpdateComment => {
            let payload: UpdateCommentPayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "UPDATE move_nodes SET comment = ?1 WHERE id = ?2 AND game_id = ?3",
                params![
                    payload.comment,
                    payload.node_id.to_string(),
                    operation.game_id.to_string()
                ],
            )?;
            connection.execute(
                "UPDATE games SET updated_at = ?1 WHERE id = ?2",
                params![
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::UpdateGameMetadata => {
            let payload: UpdateGameMetadataPayload =
                serde_json::from_value(operation.payload.clone())?;
            let library_folder = payload
                .library_folder
                .as_deref()
                .map(str::trim)
                .filter(|folder| !folder.is_empty());
            let replace_library_folder = payload.library_folder.is_some();
            if let Some(folder) = library_folder {
                connection.execute(
                    "INSERT OR IGNORE INTO library_folders (name, system) VALUES (?1, 0)",
                    [folder],
                )?;
            }
            let metadata_json =
                metadata_json_with_payload(connection, operation.game_id, &payload)?;
            connection.execute(
                "UPDATE games SET title = ?1, note = ?2, metadata_json = ?3,
                 library_folder = CASE WHEN ?4 THEN ?5 ELSE library_folder END,
                 favorite = COALESCE(?6, favorite), tags_json = COALESCE(?7, tags_json),
                 updated_at = ?8 WHERE id = ?9",
                params![
                    payload.title,
                    payload.note,
                    metadata_json,
                    replace_library_folder,
                    library_folder,
                    payload.favorite.map(|value| value as i32),
                    payload
                        .tags
                        .map(|tags| serde_json::to_string(&tags))
                        .transpose()?,
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::ReorderBranches => {
            let payload: ReorderBranchesPayload =
                serde_json::from_value(operation.payload.clone())?;
            reorder_projected_branches(
                connection,
                operation.game_id,
                payload.parent_id,
                &payload.node_ids,
            )?;
        }
        OperationKind::SetMainline => {
            let payload: SetMainlinePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "UPDATE move_nodes SET is_mainline = CASE WHEN id = ?1 THEN 1 ELSE 0 END
                 WHERE game_id = ?2 AND parent_id = ?3 AND deleted_at IS NULL",
                params![
                    payload.node_id.to_string(),
                    operation.game_id.to_string(),
                    payload.parent_id.to_string()
                ],
            )?;
            connection.execute(
                "UPDATE games SET updated_at = ?1 WHERE id = ?2",
                params![
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::DeleteNode => {
            let payload: DeleteNodePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "WITH RECURSIVE subtree(id) AS (
                   SELECT id FROM move_nodes WHERE id = ?2 AND game_id = ?3
                   UNION ALL
                   SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
                 )
                 UPDATE move_nodes SET deleted_at = ?1 WHERE id IN (SELECT id FROM subtree)",
                params![
                    operation.created_at.to_rfc3339(),
                    payload.node_id.to_string(),
                    operation.game_id.to_string()
                ],
            )?;
            connection.execute(
                "WITH RECURSIVE subtree(id) AS (
                   SELECT id FROM move_nodes WHERE id = ?1 AND game_id = ?3
                   UNION ALL
                   SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
                 )
                 UPDATE games SET current_node_id = CASE
                   WHEN (SELECT parent_id FROM move_nodes WHERE id = ?1) = root_id THEN NULL
                   ELSE (SELECT parent_id FROM move_nodes WHERE id = ?1)
                 END, updated_at = ?2
                 WHERE id = ?3 AND current_node_id IN (SELECT id FROM subtree)",
                params![
                    payload.node_id.to_string(),
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
            promote_first_live_sibling(connection, payload.node_id)?;
        }
        OperationKind::Unknown => {}
    }
    Ok(())
}

fn ensure_game_column(
    connection: &Connection,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    ensure_column(connection, "games", column, definition)
}

fn guided_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GuidedAnalysisSession> {
    let submission_json: Option<String> = row.get(9)?;
    Ok(GuidedAnalysisSession {
        id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
        game_id: parse_row_uuid(&row.get::<_, String>(1)?, 1)?,
        problem_node_id: row
            .get::<_, Option<String>>(2)?
            .and_then(|value| Uuid::parse_str(&value).ok()),
        start_node_id: row
            .get::<_, Option<String>>(3)?
            .and_then(|value| Uuid::parse_str(&value).ok()),
        report_signature: row.get(4)?,
        fen: row.get(5)?,
        phase: row.get(6)?,
        status: row.get(7)?,
        answer_hidden: row.get::<_, i64>(8)? != 0,
        submission: submission_json.and_then(|json| serde_json::from_str(&json).ok()),
        result_kind: row.get(10)?,
        score: row.get::<_, Option<u32>>(11)?,
        result_json: row.get(12)?,
        started_at: row.get(13)?,
        submitted_at: row.get(14)?,
    })
}

fn training_attempt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrainingAttempt> {
    let submission_json: String = row.get(3)?;
    Ok(TrainingAttempt {
        id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
        task_id: parse_row_uuid(&row.get::<_, String>(1)?, 1)?,
        session_id: row
            .get::<_, Option<String>>(2)?
            .and_then(|value| Uuid::parse_str(&value).ok()),
        submission: serde_json::from_str(&submission_json).unwrap_or_default(),
        score: row.get(4)?,
        result_kind: row.get(5)?,
        parent_note: row.get(6)?,
        review_round: row.get(7)?,
        next_review_at: row.get(8)?,
        mastered: row.get::<_, i64>(9)? != 0,
        created_at: row.get(10)?,
    })
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !names.iter().any(|name| name == column) {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn metadata_json_with_payload(
    connection: &Connection,
    game_id: Uuid,
    payload: &UpdateGameMetadataPayload,
) -> Result<String, StoreError> {
    let current: Option<String> = connection
        .query_row(
            "SELECT metadata_json FROM games WHERE id = ?1",
            [game_id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    let mut metadata = current
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    let object = metadata
        .as_object_mut()
        .expect("metadata object was initialized above");
    object.insert(
        "title".into(),
        serde_json::Value::String(payload.title.clone()),
    );
    for (key, value) in [
        ("event", &payload.event),
        ("site", &payload.site),
        ("date", &payload.date),
        ("red", &payload.red),
        ("black", &payload.black),
        ("result", &payload.result),
    ] {
        if let Some(value) = value {
            object.insert(key.into(), serde_json::Value::String(value.clone()));
        }
    }
    Ok(serde_json::to_string(&metadata)?)
}

fn reorder_projected_branches(
    connection: &Connection,
    game_id: Uuid,
    parent_id: Uuid,
    ordered_ids: &[Uuid],
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(
        "SELECT id, order_key FROM move_nodes
         WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL
         ORDER BY order_key, id",
    )?;
    let rows = statement.query_map(params![game_id.to_string(), parent_id.to_string()], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let existing = rows.collect::<Result<Vec<_>, _>>()?;
    let mut keys: Vec<_> = existing.iter().map(|(_, key)| *key).collect();
    keys.sort_unstable();
    let existing_ids: std::collections::HashSet<_> =
        existing.iter().map(|(id, _)| id.as_str()).collect();
    let mut requested: Vec<_> = ordered_ids
        .iter()
        .filter(|id| existing_ids.contains(id.to_string().as_str()))
        .copied()
        .collect();
    for (id, _) in &existing {
        let id = Uuid::parse_str(id).map_err(json_error)?;
        if !requested.contains(&id) {
            requested.push(id);
        }
    }
    for (node_id, key) in requested.into_iter().zip(keys) {
        connection.execute(
            "UPDATE move_nodes SET order_key = ?1 WHERE id = ?2 AND game_id = ?3",
            params![key, node_id.to_string(), game_id.to_string()],
        )?;
    }
    Ok(())
}

fn promote_first_live_sibling(
    connection: &Connection,
    deleted_node_id: Uuid,
) -> Result<(), StoreError> {
    let parent_id: Option<String> = connection
        .query_row(
            "SELECT parent_id FROM move_nodes WHERE id = ?1",
            [deleted_node_id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(parent_id) = parent_id {
        connection.execute(
            "UPDATE move_nodes SET is_mainline = 1
             WHERE id = (
               SELECT id FROM move_nodes
               WHERE parent_id = ?1 AND deleted_at IS NULL
               ORDER BY is_mainline DESC, order_key ASC LIMIT 1
             )",
            [parent_id],
        )?;
    }
    Ok(())
}

fn json_error(error: impl std::fmt::Display) -> serde_json::Error {
    serde_json::Error::io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error.to_string(),
    ))
}

fn parse_row_uuid(value: &str, column: usize) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;
    use sync_protocol::OperationKind;

    use super::*;

    fn operation(game_id: Uuid) -> Operation {
        Operation {
            op_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            entity_id: game_id,
            game_id,
            kind: OperationKind::CreateGame,
            payload: json!({"title":"Study"}),
            lamport: 1,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn local_write_and_outbox_are_committed_together() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Study", "fen", Uuid::new_v4(), &op)
            .unwrap();
        assert_eq!(store.pending_operations(10).unwrap(), vec![op.clone()]);
        store.mark_uploaded(&[op.op_id]).unwrap();
        assert!(store.pending_operations(10).unwrap().is_empty());
    }

    #[test]
    fn library_folder_favorite_and_tags_survive_and_folder_delete_uncategorizes() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        store
            .save_game_with_operation(
                game_id,
                "赛后复盘",
                "fen",
                Uuid::new_v4(),
                &operation(game_id),
            )
            .unwrap();
        store.create_library_folder("省赛").unwrap();
        let mut update = operation(game_id);
        update.kind = OperationKind::UpdateGameMetadata;
        update.payload = serde_json::to_value(UpdateGameMetadataPayload {
            title: "赛后复盘".into(),
            note: String::new(),
            library_folder: Some("省赛".into()),
            favorite: Some(true),
            tags: Some(vec!["中炮".into(), "失误".into()]),
            ..UpdateGameMetadataPayload::default()
        })
        .unwrap();
        store
            .update_game_library_with_operation(
                game_id,
                Some("省赛"),
                true,
                &["中炮".into(), "失误".into()],
                &update,
            )
            .unwrap();
        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.library_folder.as_deref(), Some("省赛"));
        assert!(game.favorite);
        assert_eq!(game.tags, vec!["中炮", "失误"]);
        store.rename_library_folder("省赛", "市赛").unwrap();
        assert_eq!(
            store
                .load_game(game_id)
                .unwrap()
                .unwrap()
                .library_folder
                .as_deref(),
            Some("市赛")
        );
        store.delete_library_folder("市赛").unwrap();
        assert_eq!(
            store.load_game(game_id).unwrap().unwrap().library_folder,
            None
        );
        assert!(
            store
                .library_folders()
                .unwrap()
                .iter()
                .any(|folder| folder.name == "比赛复盘" && folder.system)
        );
        assert!(store.rename_library_folder("比赛复盘", "其他").is_err());
        assert!(store.delete_library_folder("不存在").is_err());
    }

    #[test]
    fn flyknife_plans_survive_listing_and_deletion() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let plan = FlyknifePlan {
            id: Uuid::new_v4(),
            title: "中炮飞刀".into(),
            side: "red".into(),
            starting_fen: "fen".into(),
            template_id: Some("zhongpao".into()),
            template_name: "中炮".into(),
            lure_move: "h9g7".into(),
            knife_move: "b2c4".into(),
            mainline: vec!["h9g7".into(), "b2c4".into()],
            best_defense: vec![],
            score_cp: Some(120),
            mate: None,
            risk: "实战可用".into(),
            source_game_id: None,
            source_node_id: None,
            note: String::new(),
            annotations: vec![FlyknifeStepAnnotation {
                role: "knife".into(),
                iccs: "b2c4".into(),
                notation: "炮二平五".into(),
                side: "红方".into(),
                fen: Some("fen-after".into()),
                score_cp: Some(120),
                swing_cp: Some(110),
                intent: "关键反击。".into(),
                note: Some("用户确认：先抢中路。".into()),
            }],
            created_at: Utc::now().to_rfc3339(),
        };
        store.save_flyknife_plan(&plan).unwrap();
        let saved = store.flyknife_plans().unwrap().remove(0);
        assert_eq!(saved.id, plan.id);
        assert_eq!(saved.annotations, plan.annotations);
        store.delete_flyknife_plan(plan.id).unwrap();
        assert!(store.flyknife_plans().unwrap().is_empty());
    }

    #[test]
    fn migration_adds_theory_card_external_id_before_creating_unique_index() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE theory_cards (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   lesson_id INTEGER NOT NULL,
                   title TEXT NOT NULL,
                   summary TEXT NOT NULL,
                   applies_when TEXT NOT NULL,
                   risk TEXT NOT NULL,
                   timecode TEXT,
                   review_status TEXT NOT NULL DEFAULT 'pending'
                 );",
            )
            .unwrap();

        let store = LocalStore::initialize(connection).unwrap();
        let columns = store
            .connection
            .prepare("PRAGMA table_info(theory_cards)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.iter().any(|column| column == "external_id"));

        let indexes = store
            .connection
            .prepare("PRAGMA index_list(theory_cards)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            indexes
                .iter()
                .any(|index| index == "idx_theory_cards_external_id_unique")
        );
    }

    #[test]
    fn duplicate_operation_is_idempotent() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        let root_id = Uuid::new_v4();
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        assert_eq!(store.pending_operations(10).unwrap().len(), 1);
    }

    #[test]
    fn latest_game_and_move_tree_can_be_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        let node_id = Uuid::new_v4();
        let move_op = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::AddMove,
            lamport: 2,
            ..operation(game_id)
        };
        store
            .save_move_with_operation(
                node_id,
                game_id,
                Some(root_id),
                "a0a1",
                "first",
                0,
                true,
                &move_op,
            )
            .unwrap();

        let restored = store.load_latest_game().unwrap().unwrap();
        assert_eq!(restored.id, game_id);
        assert_eq!(restored.root_id, root_id);
        assert_eq!(restored.current_node_id, Some(node_id));
        assert_eq!(
            store.load_move_nodes(game_id).unwrap()[0].mv.to_iccs(),
            "a0a1"
        );
    }

    #[test]
    fn active_game_is_restored_independently_of_recent_updates() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let older_id = Uuid::new_v4();
        let mut older = operation(older_id);
        older.created_at = Utc::now() - chrono::Duration::minutes(2);
        store
            .save_game_with_operation(older_id, "Older", "fen", Uuid::new_v4(), &older)
            .unwrap();

        let newer_id = Uuid::new_v4();
        let mut newer = operation(newer_id);
        newer.created_at = Utc::now() - chrono::Duration::minutes(1);
        store
            .save_game_with_operation(newer_id, "Newer", "fen", Uuid::new_v4(), &newer)
            .unwrap();
        assert_eq!(store.load_latest_game().unwrap().unwrap().id, newer_id);

        store.set_active_game_id(older_id).unwrap();
        store.set_current_node(newer_id, None).unwrap();
        assert_eq!(store.load_latest_game().unwrap().unwrap().id, newer_id);
        assert_eq!(store.active_game_id().unwrap(), Some(older_id));
    }

    #[test]
    fn device_identity_is_stable_and_lamport_is_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let first = store.device_id().unwrap();
        assert_eq!(store.device_id().unwrap(), first);

        let game_id = Uuid::new_v4();
        let mut op = operation(game_id);
        op.lamport = 42;
        store
            .save_game_with_operation(game_id, "Study", "fen", Uuid::new_v4(), &op)
            .unwrap();
        assert_eq!(store.max_lamport().unwrap(), 42);
    }

    #[test]
    fn imported_game_is_rolled_back_when_any_operation_fails() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let previous_game_id = Uuid::new_v4();
        store.set_active_game_id(previous_game_id).unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        let node = MoveNode {
            id: node_id,
            parent_id: root_id,
            mv: Move::from_iccs("h2e2").unwrap(),
            comment: "main".into(),
            order_key: 0,
            is_mainline: true,
            deleted: false,
        };
        let create = operation(game_id);
        let result = store.import_game_with_operations(
            ImportedGame {
                id: game_id,
                title: "Imported",
                starting_fen: xiangqi_core::STARTING_FEN,
                root_id,
                current_node_id: Some(node_id),
                note: "note",
                source_path: Some("/tmp/imported.pgn"),
                source_format: Some("pgn"),
                playable: true,
                metadata_json: "{}",
            },
            &[node.clone(), node],
            &[create],
        );

        assert!(result.is_err());
        assert!(store.load_game(game_id).unwrap().is_none());
        assert!(store.load_move_nodes(game_id).unwrap().is_empty());
        assert!(store.pending_operations(10).unwrap().is_empty());
        assert_eq!(store.active_game_id().unwrap(), Some(previous_game_id));
    }

    #[test]
    fn imported_game_becomes_the_active_game_in_the_import_transaction() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let create = operation(game_id);

        store
            .import_game_with_operations(
                ImportedGame {
                    id: game_id,
                    title: "Imported",
                    starting_fen: xiangqi_core::STARTING_FEN,
                    root_id,
                    current_node_id: None,
                    note: "",
                    source_path: Some("/tmp/imported.pgn"),
                    source_format: Some("pgn"),
                    playable: true,
                    metadata_json: "{}",
                },
                &[],
                &[create],
            )
            .unwrap();

        assert_eq!(store.active_game_id().unwrap(), Some(game_id));
    }

    #[test]
    fn remote_operations_are_projected_into_the_move_tree() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Remote study".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();

        let add = Operation {
            op_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            entity_id: node_id,
            game_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id,
                parent_id: root_id,
                move_iccs: "a0a1".into(),
                order_key: 0,
                is_mainline: true,
            })
            .unwrap(),
            lamport: 2,
            created_at: Utc::now(),
        };
        store.apply_remote_operation(&add, 2).unwrap();
        let update = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::UpdateComment,
            payload: serde_json::to_value(UpdateCommentPayload {
                node_id,
                comment: "remote note".into(),
            })
            .unwrap(),
            lamport: 3,
            ..add.clone()
        };
        store.apply_remote_operation(&update, 3).unwrap();

        let child_id = Uuid::new_v4();
        let child = Operation {
            op_id: Uuid::new_v4(),
            entity_id: child_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id: child_id,
                parent_id: node_id,
                move_iccs: "a9a8".into(),
                order_key: 1,
                is_mainline: true,
            })
            .unwrap(),
            lamport: 4,
            ..add.clone()
        };
        store.apply_remote_operation(&child, 4).unwrap();
        let delete = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::DeleteNode,
            payload: serde_json::to_value(DeleteNodePayload { node_id }).unwrap(),
            lamport: 5,
            ..add
        };
        store.apply_remote_operation(&delete, 5).unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "Remote study");
        assert_eq!(game.current_node_id, None);
        let nodes = store.load_move_nodes(game_id).unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(
            nodes
                .iter()
                .find(|node| node.id == node_id)
                .unwrap()
                .comment,
            "remote note"
        );
        assert!(nodes.iter().all(|node| node.deleted));
        let mut tree = xiangqi_manual::ManualTree::with_root(root_id);
        tree.restore_nodes(nodes).unwrap();
        assert!(tree.branches(root_id).unwrap().is_empty());
        assert_eq!(store.remote_cursor().unwrap(), 5);
    }

    #[test]
    fn analysis_results_can_be_replaced_and_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        store
            .save_analysis(
                game_id,
                Some(node_id),
                "/engine",
                "depth:12",
                Some(12),
                Some(20),
                None,
                "[1]",
                10,
            )
            .unwrap();
        store
            .save_analysis(
                game_id,
                Some(node_id),
                "/engine",
                "depth:12",
                Some(12),
                Some(30),
                None,
                "[2]",
                11,
            )
            .unwrap();
        assert_eq!(
            store.load_latest_analysis(game_id, Some(node_id)).unwrap(),
            Some("[2]".into())
        );
    }

    #[test]
    fn report_cache_loads_the_latest_root_analysis_for_an_exact_config() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        for json in ["[1]", "[2]"] {
            store
                .save_analysis(
                    game_id,
                    None,
                    "/engine",
                    "report:time:1000",
                    Some(12),
                    Some(20),
                    None,
                    json,
                    10,
                )
                .unwrap();
        }

        assert_eq!(
            store
                .load_analysis_for_config(game_id, None, "/engine", "report:time:1000")
                .unwrap(),
            Some("[2]".into())
        );
        assert_eq!(
            store
                .load_analysis_for_config(game_id, None, "/engine", "report:depth:12")
                .unwrap(),
            None
        );
        assert_eq!(store.load_latest_analysis(game_id, None).unwrap(), None);
    }

    #[test]
    fn latest_analysis_summaries_are_returned_for_each_move_node() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        for (node_id, config, score_cp, mate) in [
            (Some(first), "depth:8", Some(12), None),
            (Some(first), "depth:12", Some(-35), None),
            (Some(second), "depth:12", None, Some(3)),
            (None, "root", Some(99), None),
        ] {
            store
                .save_analysis(
                    game_id,
                    node_id,
                    "/engine",
                    config,
                    Some(12),
                    score_cp,
                    mate,
                    "[]",
                    10,
                )
                .unwrap();
        }

        let summaries = store.load_latest_analysis_summaries(game_id).unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[&first].score_cp, Some(-35));
        assert_eq!(summaries[&first].mate, None);
        assert_eq!(summaries[&second].score_cp, None);
        assert_eq!(summaries[&second].mate, Some(3));
        assert_eq!(
            store.load_latest_analysis_summary(game_id, None).unwrap(),
            Some(AnalysisSummary {
                score_cp: Some(99),
                mate: None,
            })
        );
    }

    #[test]
    fn reordered_branches_and_metadata_survive_reload() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = json!({
            "title": "Study", "fen": xiangqi_core::STARTING_FEN, "rootId": root_id
        });
        store
            .save_game_with_operation(
                game_id,
                "Study",
                xiangqi_core::STARTING_FEN,
                root_id,
                &create,
            )
            .unwrap();
        for (index, node_id) in [first, second].into_iter().enumerate() {
            let mut add = operation(game_id);
            add.entity_id = node_id;
            add.kind = OperationKind::AddMove;
            store
                .save_move_with_operation(
                    node_id,
                    game_id,
                    Some(root_id),
                    if index == 0 { "a0a1" } else { "b0c2" },
                    "",
                    index as u64,
                    index == 0,
                    &add,
                )
                .unwrap();
        }
        let mut reorder = operation(game_id);
        reorder.entity_id = root_id;
        reorder.kind = OperationKind::ReorderBranches;
        store
            .reorder_branches_with_operation(game_id, root_id, &[second, first], &reorder)
            .unwrap();
        let mut metadata = operation(game_id);
        metadata.kind = OperationKind::UpdateGameMetadata;
        store
            .update_game_metadata_with_operation(
                game_id,
                "残局研究",
                "红先胜",
                r#"{"title":"残局研究","result":"*"}"#,
                &metadata,
            )
            .unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "残局研究");
        assert_eq!(game.note, "红先胜");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&game.metadata_json).unwrap()["title"],
            "残局研究"
        );
        assert_eq!(
            store
                .load_move_nodes(game_id)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![second, first]
        );
        assert_eq!(store.pending_operations(20).unwrap().len(), 5);
    }

    #[test]
    fn remote_move_is_appended_after_locally_ordered_branches() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let third = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Study".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();

        for (cursor, node_id, move_iccs, order_key) in [
            (2, first, "h2e2", 10),
            (3, second, "b2e2", 11),
            (5, third, "h0g2", 0),
        ] {
            let mut add = operation(game_id);
            add.entity_id = node_id;
            add.kind = OperationKind::AddMove;
            add.payload = serde_json::to_value(AddMovePayload {
                node_id,
                parent_id: root_id,
                move_iccs: move_iccs.into(),
                order_key,
                is_mainline: node_id == first,
            })
            .unwrap();
            if cursor == 5 {
                let mut reorder = operation(game_id);
                reorder.entity_id = root_id;
                reorder.kind = OperationKind::ReorderBranches;
                reorder.payload = serde_json::to_value(ReorderBranchesPayload {
                    parent_id: root_id,
                    node_ids: vec![second, first],
                })
                .unwrap();
                store.apply_remote_operation(&reorder, 4).unwrap();
            }
            store.apply_remote_operation(&add, cursor).unwrap();
        }

        assert_eq!(
            store
                .load_move_nodes(game_id)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![second, first, third]
        );
    }

    #[test]
    fn remote_metadata_updates_the_structured_document_fields() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Old".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();
        store
            .set_game_document_properties(game_id, r#"{"title":"Old","result":"*"}"#, true)
            .unwrap();
        let mut metadata = operation(game_id);
        metadata.kind = OperationKind::UpdateGameMetadata;
        metadata.payload = serde_json::to_value(UpdateGameMetadataPayload {
            title: "New".into(),
            note: "remote".into(),
            event: Some("联赛".into()),
            red: Some("甲".into()),
            result: Some("1-0".into()),
            library_folder: Some("线上联赛".into()),
            favorite: Some(true),
            tags: Some(vec!["中炮".into(), "复盘".into()]),
            ..UpdateGameMetadataPayload::default()
        })
        .unwrap();
        store.apply_remote_operation(&metadata, 2).unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "New");
        assert_eq!(game.note, "remote");
        let value: serde_json::Value = serde_json::from_str(&game.metadata_json).unwrap();
        assert_eq!(value["title"], "New");
        assert_eq!(value["event"], "联赛");
        assert_eq!(value["red"], "甲");
        assert_eq!(value["result"], "1-0");
        assert_eq!(game.library_folder.as_deref(), Some("线上联赛"));
        assert!(game.favorite);
        assert_eq!(game.tags, vec!["中炮", "复盘"]);
        assert!(
            store
                .library_folders()
                .unwrap()
                .iter()
                .any(|folder| folder.name == "线上联赛")
        );

        metadata.payload = serde_json::to_value(UpdateGameMetadataPayload {
            title: "New".into(),
            note: "remote".into(),
            library_folder: Some(String::new()),
            favorite: Some(true),
            tags: Some(vec!["中炮".into(), "复盘".into()]),
            ..UpdateGameMetadataPayload::default()
        })
        .unwrap();
        metadata.op_id = Uuid::new_v4();
        store.apply_remote_operation(&metadata, 3).unwrap();
        assert_eq!(
            store.load_game(game_id).unwrap().unwrap().library_folder,
            None
        );
        assert!(
            !store
                .library_folders()
                .unwrap()
                .iter()
                .any(|folder| folder.name.is_empty())
        );
    }

    #[test]
    fn study_sessions_preserve_node_reflection_and_tags() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();

        let saved = store
            .save_study_session(
                game_id,
                Some(node_id),
                "漏算了对方反击，需要比较补防和兑子。",
                &["候选着".into(), "反击".into()],
            )
            .unwrap();

        let sessions = store.study_sessions(game_id).unwrap();
        assert_eq!(sessions, vec![saved]);
        assert_eq!(sessions[0].node_id, Some(node_id));
        assert_eq!(sessions[0].tags, vec!["候选着", "反击"]);
    }

    #[test]
    fn desktop_preferences_survive_reopen_without_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.sqlite3");
        let preferences = DesktopPreferences {
            engine_path: "/opt/pikafish".into(),
            threads: 6,
            hash_mb: 512,
            multipv: 4,
            candidate_line_moves: 12,
            search_mode: "nodes".into(),
            search_value: 800_000,
            move_time_ms: 2200,
            ponder: true,
            auto_analyze: false,
            library_collapsed: true,
            candidate_rail_collapsed: true,
            analysis_panel_collapsed: true,
            evaluation_collapsed: true,
            branch_arrow_color: "#9b51e0".into(),
            workspace_panel: "summary".into(),
            layout_mode: "compact".into(),
            manual_view_mode: "track".into(),
            color_theme: "light".into(),
            board_skin: "hongmu".into(),
            piece_skin: "hongmu".into(),
            report_depth: 24,
            xqb_book_paths: vec!["/books/example.xqb".into()],
            disabled_xqb_book_paths: Vec::new(),
            eleeye_book_paths: vec!["/books/BOOK.DAT".into()],
            disabled_eleeye_book_paths: Vec::new(),
            builtin_opening_book_enabled: true,
            active_builtin_opening_book_id: "learning-top3".into(),
            active_engine_id: None,
            analysis_engine_mode: "single".into(),
            parallel_engine_ids: Vec::new(),
            parallel_engine_paths: Vec::new(),
            cloud_book_enabled: true,
            cloud_book_url: "https://book.example.com/query".into(),
            rule_mode: "domestic2020".into(),
            link_capture_source: "windowLink".into(),
            link_recognition_mode: "yoloBoard".into(),
            link_mode: "spectate".into(),
            link_stable_frames: 2,
            link_confidence_threshold: 70,
            link_animation_confirmation: true,
            game_mirror_enabled: true,
            game_mirror_root: "/tmp/棋研棋谱".into(),
            server_url: "https://sync.example.com".into(),
        };
        {
            let mut store = LocalStore::open(&path).unwrap();
            store.save_desktop_preferences(&preferences).unwrap();
        }
        let store = LocalStore::open(&path).unwrap();
        assert_eq!(store.desktop_preferences().unwrap(), preferences);
        assert!(store.sync_value("jwt").unwrap().is_none());
    }

    #[test]
    fn desktop_preferences_accept_legacy_json_without_layout_fields() {
        let preferences: DesktopPreferences = serde_json::from_str(
            r#"{"enginePath":"/opt/pikafish","threads":2,"hashMb":256,"multipv":3,"searchMode":"time","searchValue":1500,"moveTimeMs":5000,"ponder":false,"autoAnalyze":true,"serverUrl":"http://127.0.0.1:8080"}"#,
        )
        .unwrap();
        assert!(!preferences.library_collapsed);
        assert!(!preferences.candidate_rail_collapsed);
        assert!(!preferences.analysis_panel_collapsed);
        assert_eq!(preferences.workspace_panel, "moves");
        assert_eq!(preferences.layout_mode, "compact");
        assert_eq!(preferences.manual_view_mode, "track");
        assert_eq!(preferences.color_theme, "dark");
        assert_eq!(preferences.branch_arrow_color, "#2f80ed");
        assert_eq!(preferences.report_depth, 24);
        assert_eq!(preferences.candidate_line_moves, 16);
        assert!(preferences.xqb_book_paths.is_empty());
        assert!(preferences.builtin_opening_book_enabled);
        assert_eq!(preferences.active_builtin_opening_book_id, "learning-top3");
        assert!(preferences.cloud_book_enabled);
        assert_eq!(
            preferences.cloud_book_url,
            "https://www.chessdb.cn/chessdb.php"
        );
    }

    #[test]
    fn engine_profiles_are_upserted_listed_and_deleted() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let id = store
            .save_engine_profile("Pikafish", "/engines/pikafish", "uci")
            .unwrap();
        assert_eq!(store.list_engine_profiles().unwrap()[0].id, id);
        let same = store
            .save_engine_profile("Pikafish 2", "/engines/pikafish", "ucci")
            .unwrap();
        assert_eq!(same, id);
        let profiles = store.list_engine_profiles().unwrap();
        assert_eq!(profiles[0].name, "Pikafish 2");
        assert_eq!(profiles[0].protocol, "ucci");
        store.delete_engine_profile(id).unwrap();
        assert!(store.list_engine_profiles().unwrap().is_empty());
    }

    #[test]
    fn game_report_dataset_survives_reopen_and_restores_exact_line() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("reports.sqlite3");
        let game_id = Uuid::new_v4();
        {
            let mut store = LocalStore::open(&path).unwrap();
            store
                .save_game_report(
                    game_id,
                    "root:first",
                    "/engine",
                    "time:1000",
                    "{\"version\":1}",
                )
                .unwrap();
            store
                .save_game_report(
                    game_id,
                    "root:first:second",
                    "/engine",
                    "time:1000",
                    "{\"version\":2}",
                )
                .unwrap();
        }
        let store = LocalStore::open(&path).unwrap();
        let report = store.load_latest_game_report(game_id).unwrap().unwrap();
        assert_eq!(report.line_signature, "root:first:second");
        assert_eq!(report.dataset_json, "{\"version\":2}");
        let first = store
            .load_game_report(game_id, "root:first")
            .unwrap()
            .unwrap();
        assert_eq!(first.line_signature, "root:first");
        assert_eq!(first.dataset_json, "{\"version\":1}");
        assert!(
            store
                .load_game_report(game_id, "root:missing")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn training_tasks_are_deduplicated_and_can_be_completed() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        store
            .upsert_training_task(
                game_id,
                "report-1",
                node_id,
                "复盘第 12 手",
                "重新寻找最佳着法",
            )
            .unwrap();
        store
            .upsert_training_task(game_id, "report-1", node_id, "复盘第 12 手", "比较候选着法")
            .unwrap();
        let tasks = store.list_training_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].detail, "比较候选着法");
        store.complete_training_task(tasks[0].id, true).unwrap();
        assert!(
            store.list_training_tasks().unwrap()[0]
                .completed_at
                .is_some()
        );
        store.complete_training_task(tasks[0].id, false).unwrap();
        assert!(
            store.list_training_tasks().unwrap()[0]
                .completed_at
                .is_none()
        );
    }

    #[test]
    fn theory_feedback_penalizes_incorrect_matches_and_preserves_card_versions() {
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .upsert_theory_lesson(
                "middle",
                "赵鑫鑫中局棋理48讲",
                "缺相怕炮",
                "/books/middle.pdf#p20",
                "fingerprint",
            )
            .unwrap();
        let lesson_id = store.theory_lessons().unwrap()[0].id;
        let mut card = store
            .create_theory_card(
                lesson_id,
                "缺相怕炮",
                "缺相时要警惕炮路牵制和底线压缩。",
                "中局出现缺相、炮路可压缩将门时。",
                "若只看子力数量，容易漏掉困毙或牵制。",
                None,
            )
            .unwrap();
        card.review_status = "approved".into();
        card.tags = vec!["牵制".into(), "底线".into()];
        card.engine_correlations = vec!["pin_or_restraint".into()];
        card.source_book = Some("赵鑫鑫中局棋理48讲".into());
        card.source_page_start = Some(20);
        card.source_page_end = Some(21);
        store.review_theory_card(&card).unwrap();
        let approved = store.theory_cards().unwrap()[0].clone();
        assert_eq!(approved.version, 2);
        assert!(approved.user_modified);

        let match_record = store
            .record_theory_card_match(
                Uuid::new_v4(),
                "report-1",
                Uuid::new_v4(),
                approved.id,
                approved.version,
                "pin_or_restraint",
                &approved.tags,
                "第 18 手疑似牵制漏算",
            )
            .unwrap();
        store
            .save_theory_card_feedback(
                Some(match_record.id),
                approved.id,
                approved.version,
                "incorrect",
                "这个局面不是缺相怕炮",
            )
            .unwrap();
        let penalized = store.theory_cards().unwrap()[0].clone();
        assert_eq!(penalized.match_penalty, 2);
        assert!(penalized.needs_recheck);
    }

    #[test]
    fn imported_theory_cards_are_upserted_by_external_id() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let mut card = ImportedTheoryCard {
            external_id: "qili-demand-middle-test".into(),
            phase: "middle".into(),
            course_name: "赵鑫鑫棋理三部曲".into(),
            lesson_title: "线路控制".into(),
            source_path: "qili-pdf:middle:线路控制:p20-21".into(),
            fingerprint: "qili-demand-middle-test:p20-21".into(),
            title: "先控线路再攻".into(),
            summary: "中局先确认车路或肋道控制，再组织局部以多打少。".into(),
            applies_when: "中局关键着亏分且候选线显示线路争夺时。".into(),
            risk: "子力未到位就强攻，容易被对手抢先反击。".into(),
            review_status: "approved".into(),
            source_book: Some("赵鑫鑫中局棋理48讲".into()),
            source_page_start: Some(20),
            source_page_end: Some(21),
            tags: vec!["中局".into(), "线路控制".into(), "候选着".into()],
            engine_correlations: vec!["line_control".into(), "missed_candidate".into()],
        };
        let inserted = store.upsert_imported_theory_card(&card).unwrap();
        assert_eq!(
            inserted.external_id.as_deref(),
            Some("qili-demand-middle-test")
        );
        assert_eq!(inserted.review_status, "approved");
        assert_eq!(inserted.version, 1);

        let repeated = store.upsert_imported_theory_card(&card).unwrap();
        assert_eq!(repeated.id, inserted.id);
        assert_eq!(repeated.version, 1);
        assert_eq!(store.theory_cards().unwrap().len(), 1);

        card.summary = "中局先确认关键线路控制，再通过候选着比较组织局部以多打少。".into();
        let updated = store.upsert_imported_theory_card(&card).unwrap();
        assert_eq!(updated.id, inserted.id);
        assert_eq!(updated.version, 2);
        assert_eq!(updated.origin, "imported");
        assert!(!updated.user_modified);
    }

    #[test]
    fn master_style_profiles_import_and_match_exact_fen_with_approved_cards() {
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .upsert_imported_theory_card(&ImportedTheoryCard {
                external_id: "qili-style-opening-test".into(),
                phase: "opening".into(),
                course_name: "赵鑫鑫布局棋理48讲".into(),
                lesson_title: "先出动强子".into(),
                source_path: "qili/opening/001".into(),
                fingerprint: "card-fp".into(),
                title: "布局阶段先协调强子".into(),
                summary: "开局应优先让车马炮形成可持续配合。".into(),
                applies_when: "布局阶段出现候选着选择时。".into(),
                risk: "不能脱离具体战术强行套用。".into(),
                review_status: "approved".into(),
                source_book: Some("赵鑫鑫布局棋理".into()),
                source_page_start: Some(12),
                source_page_end: Some(13),
                tags: vec!["opening".into()],
                engine_correlations: vec!["candidate".into()],
            })
            .unwrap();
        let profile = ImportedMasterStyleProfile {
            id: "zhao-style".into(),
            player_name: "赵鑫鑫".into(),
            normalized_name: "赵鑫鑫".into(),
            version: "master-style-training-v1".into(),
            sample_count: 1,
            generated_at: "2026-08-06T00:00:00Z".into(),
            profile_json: "{}".into(),
        };
        let sample = ImportedMasterStyleSample {
            id: "sample-1".into(),
            profile_id: "zhao-style".into(),
            player_name: "赵鑫鑫".into(),
            source_game_id: "game-1".into(),
            source_title: "赵鑫鑫 先胜 某棋手".into(),
            event_name: Some("测试赛事".into()),
            game_date: Some("2026-01-01".into()),
            ply: 12,
            phase: "opening".into(),
            before_fen: "fen-a".into(),
            played_move: "h2e2".into(),
            played_move_rank: Some(1),
            played_move_in_topn: true,
            best_move: Some("h2e2".into()),
            best_score_cp: Some(36),
            candidates_json: "[]".into(),
            source_json: "{}".into(),
        };
        store
            .upsert_master_style_profile(&profile, &[sample])
            .unwrap();

        let hints = store
            .match_master_style_hints("fen-a", "opening", Some("h2e2"), 3)
            .unwrap();
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].confidence, "exact");
        assert_eq!(hints[0].player_name, "赵鑫鑫");
        assert_eq!(hints[0].theory_cards.len(), 1);
        assert_eq!(hints[0].theory_cards[0].title, "布局阶段先协调强子");

        let similar = store
            .match_master_style_hints("fen-b", "opening", Some("h2e2"), 3)
            .unwrap();
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].confidence, "similar");
    }

    #[test]
    fn weakness_stats_include_study_tags_and_contextual_training_tasks() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        store
            .save_study_session(
                game_id,
                Some(node_id),
                "中局漏算反击。",
                &["候选着".into(), "反击".into()],
            )
            .unwrap();
        store
            .upsert_training_task_with_context(
                game_id,
                "report-1",
                node_id,
                "复盘第 12 手",
                "重算候选着",
                Some("middle"),
                &["候选着".into()],
                None,
                "critical",
            )
            .unwrap();
        let stats = store.weakness_stats(8).unwrap();
        assert!(stats.iter().any(|stat| stat.tag == "候选着"));
        let middle = stats
            .iter()
            .find(|stat| stat.phase == "middle" && stat.tag == "候选着")
            .unwrap();
        assert_eq!(middle.open_tasks, 1);
        store
            .complete_training_task(store.list_training_tasks().unwrap()[0].id, true)
            .unwrap();
        let stats = store.weakness_stats(8).unwrap();
        let middle = stats
            .iter()
            .find(|stat| stat.phase == "middle" && stat.tag == "候选着")
            .unwrap();
        assert_eq!(middle.completed_tasks, 1);
    }

    #[test]
    fn sync_account_binding_accepts_same_account_and_rejects_another() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let first = SyncAccountBinding {
            user_id: Uuid::new_v4(),
            email: "first@example.com".into(),
        };
        store.bind_sync_account(&first).unwrap();
        store.bind_sync_account(&first).unwrap();
        assert_eq!(store.sync_account_binding().unwrap(), Some(first.clone()));

        let error = store
            .bind_sync_account(&SyncAccountBinding {
                user_id: Uuid::new_v4(),
                email: "second@example.com".into(),
            })
            .unwrap_err();
        assert!(matches!(error, StoreError::AccountAlreadyBound { .. }));
        assert_eq!(store.sync_account_binding().unwrap(), Some(first));
    }

    #[test]
    fn signing_out_does_not_remove_outbox_or_account_binding() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let account = SyncAccountBinding {
            user_id: Uuid::new_v4(),
            email: "offline@example.com".into(),
        };
        store.bind_sync_account(&account).unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Offline", "fen", Uuid::new_v4(), &op)
            .unwrap();

        assert_eq!(store.sync_account_binding().unwrap(), Some(account));
        assert_eq!(store.pending_operations(10).unwrap(), vec![op]);
    }

    #[test]
    fn resetting_a_sync_library_removes_account_data_and_games() {
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .bind_sync_account(&SyncAccountBinding {
                user_id: Uuid::new_v4(),
                email: "old@example.com".into(),
            })
            .unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Old study", "fen", Uuid::new_v4(), &op)
            .unwrap();

        store.reset_sync_library().unwrap();

        assert!(store.sync_account_binding().unwrap().is_none());
        assert!(store.pending_operations(10).unwrap().is_empty());
        assert!(store.load_game(game_id).unwrap().is_none());
        assert_eq!(store.remote_cursor().unwrap(), 0);
    }

    #[test]
    fn u10_profile_and_guided_attempts_survive_storage_round_trips() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let mut profile = LearningProfile::u10_default();
        profile.child_name = "小明".into();
        store.save_learning_profile(&profile).unwrap();
        assert_eq!(store.learning_profile().unwrap().child_name, "小明");

        let game_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let session = store
            .start_guided_analysis(
                game_id,
                Some(Uuid::new_v4()),
                None,
                "report-signature",
                "start-fen",
                "middle",
            )
            .unwrap();
        let submission = GuidedAnalysisSubmission {
            threats: "对方可能将军".into(),
            forcing_moves: "先看将军和吃子".into(),
            worst_piece: "右马".into(),
            candidates: vec!["h2e2".into(), "h0g2".into()],
            chosen_move: "h2e2".into(),
            predicted_line: vec!["h2e2".into(), "h9g7".into()],
            confidence: 70,
            elapsed_seconds: 180,
            hints_used: 0,
        };
        store
            .submit_guided_analysis(session.id, &submission, "direction", 84, "{}")
            .unwrap();
        let attempt = store
            .save_training_attempt(
                task_id,
                Some(session.id),
                &submission,
                84,
                "direction",
                "家长已陪练",
            )
            .unwrap();
        assert_eq!(attempt.review_round, 1);
        assert!(!attempt.mastered);
        assert!(attempt.next_review_at.is_some());
        assert_eq!(store.training_attempts(Some(task_id)).unwrap().len(), 1);
    }

    #[test]
    fn u10_mastery_requires_three_high_scores_and_two_hint_free_retests() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let task_id = Uuid::new_v4();
        let mut submission = GuidedAnalysisSubmission::default();
        submission.hints_used = 1;
        let first = store
            .save_training_attempt(task_id, None, &submission, 82, "direction", "")
            .unwrap();
        assert_eq!(first.review_round, 1);
        assert!(!first.mastered);

        submission.hints_used = 0;
        let second = store
            .save_training_attempt(task_id, None, &submission, 86, "correct", "")
            .unwrap();
        assert_eq!(second.review_round, 2);
        assert!(!second.mastered);
        let third = store
            .save_training_attempt(task_id, None, &submission, 91, "correct", "")
            .unwrap();
        assert_eq!(third.review_round, 3);
        assert!(third.mastered);
        assert!(third.next_review_at.is_none());
    }

    #[test]
    fn game_mirror_status_survives_reopen_and_updates_in_place() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mirror.sqlite3");
        let game_id = Uuid::new_v4();
        {
            let mut store = LocalStore::open(&path).unwrap();
            store
                .save_game_mirror_status(&GameMirrorStatus {
                    game_id,
                    path: Some("/tmp/棋研棋谱/2026/省赛/2026-08-12_省赛_小明_红方.pgn".into()),
                    state: "synced".into(),
                    updated_at: Some("2026-08-12T10:00:00Z".into()),
                    error: None,
                })
                .unwrap();
            store
                .save_game_mirror_status(&GameMirrorStatus {
                    game_id,
                    path: Some("/tmp/棋研棋谱/2026/省赛/2026-08-13_省赛_小明_红方.pgn".into()),
                    state: "failed".into(),
                    updated_at: Some("2026-08-12T10:01:00Z".into()),
                    error: Some("目录不可写".into()),
                })
                .unwrap();
        }
        let store = LocalStore::open(&path).unwrap();
        let status = store.game_mirror_status(game_id).unwrap().unwrap();
        assert_eq!(status.state, "failed");
        assert_eq!(status.error.as_deref(), Some("目录不可写"));
        assert_eq!(store.game_mirror_statuses().unwrap(), vec![status]);
    }
}
