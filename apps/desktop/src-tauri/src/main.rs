#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod credential_store;
mod cloud_opening_book;
mod gif_export;
mod opening_book;
mod pdf_report;
mod xqb_opening_book;

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use chrono::Utc;
use credential_store::{SharedCredentialStore, SystemCredentialStore, TOKEN_KEY};
use engine_protocol::{EngineControl, EngineEvent, EngineSession, Protocol, SearchLimit};
use local_store::{
    AnalysisSummary, DesktopPreferences, EngineProfile, ImportedGame, LocalGame, LocalStore, SyncAccountBinding, TrainingTask,
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
use uuid::Uuid;
use xiangqi_core::{Board, Color, GameStatus, PieceKind, STARTING_FEN, Square};
use xiangqi_manual::{ManualTree, MoveNode};

const BUILTIN_ENGINE_PATH: &str = "builtin:pikafish";

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
    engine: tokio::sync::Mutex<Option<EngineControl>>,
    report_engine: tokio::sync::Mutex<Option<EngineControl>>,
    report_commit: tokio::sync::Mutex<()>,
    play_session: tokio::sync::Mutex<Option<EngineRuntime>>,
    analysis_generation: AtomicU64,
    play_generation: AtomicU64,
    report_generation: AtomicU64,
    report_running: AtomicBool,
    cloud_book_cache: Mutex<BTreeMap<String, Vec<cloud_opening_book::CloudBookCandidateDto>>>,
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
    status: &'static str,
    pieces: Vec<PieceDto>,
    history: Vec<MoveDto>,
    branches: Vec<MoveDto>,
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
        Self { id: task.id, game_id: task.game_id, node_id: task.node_id, title: task.title, detail: task.detail, completed_at: task.completed_at, created_at: task.created_at }
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
            move_iccs: iccs.to_owned(),
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
fn import_xqb_opening_book(path: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let target = PathBuf::from(&path);
    xqb_opening_book::validate(&target)?;
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    if !preferences.xqb_book_paths.iter().any(|existing| existing == &path) {
        preferences.xqb_book_paths.push(path);
        model.store.save_desktop_preferences(&preferences).map_err(|error| error.to_string())?;
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
fn export_document_text(format: ExportFormat, state: State<'_, DesktopState>) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    format.export(&document_from_model(&model))
}

#[tauri::command]
fn export_document_file(path: String, format: ExportFormat, state: State<'_, DesktopState>) -> Result<String, String> {
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
    if state.engine.lock().await.is_some() {
        return Err("an engine search is already running".into());
    }
    let resolved_engine_path = resolve_engine_path(&app, &engine_path)?;
    let resolved_engine_path_text = resolved_engine_path.to_string_lossy().into_owned();
    let mut slot = state.play_session.lock().await;
    if slot
        .as_ref()
        .is_some_and(|runtime| runtime.path != resolved_engine_path_text)
    {
        if let Some(runtime) = slot.take() {
            let _ = runtime.session.close().await;
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
    let runtime = slot.as_mut().expect("engine runtime was initialized");
    if runtime.pondering_fen.take().is_some() {
        runtime
            .session
            .stop()
            .await
            .map_err(|error| error.to_string())?;
        loop {
            match runtime.session.next_event().await {
                Ok(EngineEvent::BestMove { .. }) => break,
                Ok(_) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    let protocol = runtime.session.protocol();
    let threads = threads.clamp(1, 64);
    let hash_mb = hash_mb.clamp(16, 4096);
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
    *state.engine.lock().await = Some(runtime.session.control());
    emit_engine_state(&app, runtime.state);
    let started = Instant::now();
    let mut lines = BTreeMap::new();
    let mut read_error = None;
    loop {
        match runtime.session.next_event().await {
            Ok(EngineEvent::Info(info)) if !info.pv.is_empty() => {
                let line = AnalysisLine {
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
                };
                if state.analysis_generation.load(Ordering::SeqCst) == analysis_generation {
                    emit_engine_event(
                        &app,
                        EngineRuntimeEvent::Info {
                            fen: fen.clone(),
                            line: line.clone(),
                        },
                    );
                }
                lines.insert(line.multipv, line);
            }
            Ok(EngineEvent::BestMove { best, ponder }) => {
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
    *state.engine.lock().await = None;
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
        let failed = slot.take();
        drop(slot);
        if let Some(failed) = failed {
            let _ = failed.session.close().await;
        }
        return Err(error);
    }
    runtime.state = EngineRuntimeState::Idle;
    emit_engine_state(&app, runtime.state);
    drop(slot);
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
    if state.engine.lock().await.is_some() {
        return Err("引擎正在执行其他搜索，请先停止".into());
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
    *state.engine.lock().await = Some(play.session.control());
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
                        line: AnalysisLine {
                            depth: info.depth,
                            score_cp: info.score_cp,
                            mate: info.mate,
                            nps: info.nps,
                            time_ms: info.time_ms,
                            multipv: info.multipv,
                            notation: board.chinese_pv_notation(&info.pv).unwrap_or_default(),
                            pv: info.pv,
                        },
                    },
                );
            }
            Ok(_) => {}
            Err(error) => {
                *state.engine.lock().await = None;
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
    *state.engine.lock().await = None;
    let predicted_fen = if ponder {
        ponder_move.as_deref().and_then(|predicted| {
            let board = Board::from_fen(&fen).ok()?;
            let best = xiangqi_core::Move::from_iccs(&best_move).ok()?;
            let board = board.apply_move(best).ok()?;
            let predicted = xiangqi_core::Move::from_iccs(predicted).ok()?;
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
    if let Some(control) = state.engine.lock().await.clone() {
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
        *state.engine.lock().await = None;
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
    let control = state.engine.lock().await.clone();
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
            .or_else(|| std::env::var_os("PIKAFISH_PATH").map(PathBuf::from).filter(|path| path.is_file()))
            .ok_or_else(|| "安装包内未找到内置 Pikafish；开发模式请设置 PIKAFISH_PATH，或手动选择外部引擎".to_owned());
    }
    if trimmed.is_empty() {
        return Err("请先选择 Pikafish 引擎".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_file() {
        return Err("引擎可执行文件不存在".into());
    }
    Ok(path)
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

fn report_engine_fingerprint(engine_path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(b"engine\0");
    update_fingerprint(&mut hasher, engine_path)?;

    let mut nnue_files = engine_path
        .parent()
        .and_then(|parent| std::fs::read_dir(parent).ok())
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("nnue"))
        })
        .collect::<Vec<_>>();
    nnue_files.sort();
    for path in nnue_files {
        hasher.update(b"nnue\0");
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            hasher.update(name.as_bytes());
        }
        hasher.update(b"\0");
        update_fingerprint(&mut hasher, &path)?;
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
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
    let notation = if line.pv.is_empty() {
        Vec::new()
    } else if line.notation.is_empty() {
        position_board
            .chinese_pv_notation(&line.pv)
            .unwrap_or_default()
    } else {
        line.notation.clone()
    };
    position.score_cp = line.score_cp;
    position.mate = line.mate;
    position.depth = line.depth;
    position.elapsed_ms = line.time_ms;
    position.cached = cached;
    position.best_iccs = line.pv.first().cloned();
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
        if state.engine.lock().await.is_none() {
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
    let control = state.engine.lock().await.clone();
    if let Some(control) = control {
        emit_engine_state(&app, EngineRuntimeState::Stopping);
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
                            primary = Some(AnalysisLine {
                                depth: info.depth,
                                score_cp: info.score_cp,
                                mate: info.mate,
                                nps: info.nps,
                                time_ms: info.time_ms,
                                multipv: 1,
                                notation: if info.pv.is_empty() {
                                    Vec::new()
                                } else {
                                    position_board
                                        .chinese_pv_notation(&info.pv)
                                        .unwrap_or_default()
                                },
                                pv: info.pv,
                            });
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

fn validate_server_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value.trim()).map_err(|_| "同步服务地址格式不正确")?;
    let host = url.host_str().ok_or("同步服务地址缺少主机名")?;
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("非本机同步服务必须使用 HTTPS".into());
    }
    Ok(())
}

fn validate_preferences(preferences: &DesktopPreferences) -> Result<(), String> {
    if !matches!(preferences.color_theme.as_str(), "light" | "dark") {
        return Err("不支持的颜色主题".into());
    }
    if !matches!(preferences.board_skin.as_str(), "original" | "classic" | "neon" | "jade" | "imperial" | "jingdian") {
        return Err("不支持的棋盘皮肤".into());
    }
    if !matches!(preferences.piece_skin.as_str(), "original" | "classic" | "neon" | "jade" | "imperial" | "jingdian") {
        return Err("不支持的棋子皮肤".into());
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
    let cloud_url = reqwest::Url::parse(&preferences.cloud_book_url)
        .map_err(|_| "云库地址格式不正确")?;
    if cloud_url.scheme() != "https" {
        return Err("云库地址必须使用 HTTPS".into());
    }
    validate_server_url(&preferences.server_url)
}

#[tauri::command]
fn get_desktop_preferences(state: State<'_, DesktopState>) -> Result<DesktopPreferences, String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    // Preserve older installations that only stored enginePath before profiles existed.
    if preferences.active_engine_id.is_none() && !preferences.engine_path.trim().is_empty() {
        let name = preferences.engine_path.rsplit(['/', '\\']).next().unwrap_or("本地引擎");
        let id = model.store.save_engine_profile(name, &preferences.engine_path, "uci")
            .map_err(|error| error.to_string())?;
        preferences.active_engine_id = Some(id);
        model.store.save_desktop_preferences(&preferences).map_err(|error| error.to_string())?;
    }
    Ok(preferences)
}

#[tauri::command]
fn save_desktop_preferences(
    preferences: DesktopPreferences,
    state: State<'_, DesktopState>,
) -> Result<DesktopPreferences, String> {
    validate_preferences(&preferences)?;
    if (preferences.board_skin == "jingdian" || preferences.piece_skin == "jingdian")
        && sync_account_dto(&state)?.status != "signedIn"
    {
        return Err("登录同步账号后才能使用经典雅致皮肤".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let current = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
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
    Ok(EngineProbeDto {
        path: if path.trim() == BUILTIN_ENGINE_PATH {
            BUILTIN_ENGINE_PATH.into()
        } else {
            resolved_path.to_string_lossy().into_owned()
        },
        protocol: protocol_name(session.protocol()),
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
    let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    model.store.list_engine_profiles()
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
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let display_name = if name.trim().is_empty() {
        probe.path.rsplit(['/', '\\']).next().unwrap_or("本地引擎").to_owned()
    } else { name.trim().to_owned() };
    let id = model.store.save_engine_profile(&display_name, &probe.path, probe.protocol)
        .map_err(|error| error.to_string())?;
    let mut preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    preferences.active_engine_id = Some(id);
    preferences.engine_path = probe.path.clone();
    model.store.save_desktop_preferences(&preferences).map_err(|error| error.to_string())?;
    Ok(EngineProfileDto { id, name: display_name, executable_path: probe.path, protocol: probe.protocol.into(), active: true })
}

#[tauri::command]
fn set_active_engine_profile(id: Uuid, state: State<'_, DesktopState>) -> Result<DesktopPreferences, String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model.store.list_engine_profiles().map_err(|error| error.to_string())?
        .into_iter().find(|profile| profile.id == id).ok_or("引擎档案不存在")?;
    let mut preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    preferences.active_engine_id = Some(id);
    preferences.engine_path = profile.executable_path;
    model.store.save_desktop_preferences(&preferences).map_err(|error| error.to_string())?;
    Ok(preferences)
}

#[tauri::command]
fn delete_engine_profile(id: Uuid, state: State<'_, DesktopState>) -> Result<DesktopPreferences, String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    model.store.delete_engine_profile(id).map_err(|error| error.to_string())?;
    if preferences.active_engine_id == Some(id) {
        preferences.active_engine_id = None;
        preferences.engine_path.clear();
        model.store.save_desktop_preferences(&preferences).map_err(|error| error.to_string())?;
    }
    Ok(preferences)
}

#[tauri::command]
async fn query_cloud_opening_book(fen: String, state: State<'_, DesktopState>) -> Result<Vec<cloud_opening_book::CloudBookCandidateDto>, String> {
    let (enabled, url) = {
        let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
        let preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
        (preferences.cloud_book_enabled, preferences.cloud_book_url)
    };
    if !enabled { return Ok(Vec::new()); }
    let key = format!("{url}\n{fen}");
    if let Some(mut cached) = state.cloud_book_cache.lock().map_err(|_| "cache lock poisoned".to_owned())?.get(&key).cloned() {
        for candidate in &mut cached { candidate.cached = true; }
        return Ok(cached);
    }
    let candidates = cloud_opening_book::query(&url, &fen).await?;
    state.cloud_book_cache.lock().map_err(|_| "cache lock poisoned".to_owned())?.insert(key, candidates.clone());
    Ok(candidates)
}

#[tauri::command]
fn list_coach_reports(state: State<'_, DesktopState>) -> Result<Vec<GameReportDatasetDto>, String> {
    let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    Ok(model.store.load_latest_game_reports().map_err(|error| error.to_string())?
        .into_iter().filter_map(|stored| serde_json::from_str::<GameReportDatasetDto>(&stored.dataset_json).ok())
        .filter(|report| !report.stale)
        .collect())
}

#[tauri::command]
fn list_training_tasks(state: State<'_, DesktopState>) -> Result<Vec<TrainingTaskDto>, String> {
    let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    model.store.list_training_tasks().map_err(|error| error.to_string()).map(|tasks| tasks.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn generate_training_tasks(state: State<'_, DesktopState>) -> Result<Vec<TrainingTaskDto>, String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let Some(stored) = model.store.load_latest_game_report(model.game_id).map_err(|error| error.to_string())? else {
        return Err("请先生成一份整局复盘报告".into());
    };
    let report: GameReportDatasetDto = serde_json::from_str(&stored.dataset_json).map_err(|_| "本地复盘报告无效".to_owned())?;
    for (index, position) in report.positions.iter().enumerate().skip(1) {
        let Some(moved) = position.move_.as_ref() else { continue; };
        let (Some(before), Some(after)) = (report.positions[index - 1].score_cp, position.score_cp) else { continue; };
        let loss = if moved.moved_by == "红方" { before - after } else { after - before };
        if loss < 150 { continue; }
        let move_number = (position.ply + 1) / 2;
        let best = position.best_notation.as_deref().unwrap_or("重新寻找更稳健的着法");
        model.store.upsert_training_task(
            report.game_id,
            &report.line_signature,
            moved.node_id,
            &format!("复盘第 {move_number} 手：{}", moved.notation),
            &format!("本着评价变化约 {loss} 分。先自行计算，再比较推荐着法：{best}"),
        ).map_err(|error| error.to_string())?;
    }
    model.store.list_training_tasks().map_err(|error| error.to_string()).map(|tasks| tasks.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn complete_training_task(task_id: Uuid, completed: bool, state: State<'_, DesktopState>) -> Result<(), String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    model.store.complete_training_task(task_id, completed).map_err(|error| error.to_string())
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
    let url = format!("{}/api/v1/subscription{endpoint}", server_url.trim_end_matches('/'));
    let request = if let Some(code) = code {
        client.post(url).bearer_auth(token).json(&serde_json::json!({ "code": code }))
    } else {
        client.get(url).bearer_auth(token)
    };
    let response = request.send().await.map_err(|error| format!("订阅服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| body.get("error").and_then(|value| value.as_str()).map(str::to_owned))
            .unwrap_or_else(|| format!("订阅服务返回错误 {status}"));
        return Err(message);
    }
    response.json().await.map_err(|_| "订阅服务返回了无效数据".into())
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
            .and_then(|body| body.get("error").and_then(|value| value.as_str()).map(str::to_owned));
        let duplicate_email = status.as_u16() == 409
            || error_message
                .as_deref()
                .is_some_and(|message| {
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
    let pieces = board_pieces(&model.board);
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
    let preferences = model.store.desktop_preferences().map_err(|error| error.to_string())?;
    let mut xqb_candidates = Vec::new();
    for path in preferences.xqb_book_paths {
        if preferences.disabled_xqb_book_paths.iter().any(|disabled| disabled == &path) {
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
            game_status_label(model.board.status())
        } else {
            "不可对弈"
        },
        pieces,
        history,
        branches,
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
            ) = if let Some(game) = store.load_latest_game()? {
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
                engine: tokio::sync::Mutex::new(None),
                report_engine: tokio::sync::Mutex::new(None),
                report_commit: tokio::sync::Mutex::new(()),
                play_session: tokio::sync::Mutex::new(None),
                analysis_generation: AtomicU64::new(0),
                play_generation: AtomicU64::new(0),
                report_generation: AtomicU64::new(0),
                report_running: AtomicBool::new(false),
                cloud_book_cache: Mutex::new(BTreeMap::new()),
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
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
            save_document,
            update_game_metadata,
            reorder_branches,
            navigate_to,
            update_comment,
            set_mainline,
            delete_node,
            detect_pikafish,
            analyze_position,
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
            get_sync_account,
            get_subscription,
            redeem_subscription_code,
            register_sync_account,
            login_sync_account,
            logout_sync_account,
            unbind_sync_account,
            sync_now
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Xiangqi Studio");
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
    }
}
