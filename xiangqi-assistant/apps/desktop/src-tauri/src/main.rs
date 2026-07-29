use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use std::time::Instant;

use chrono::Utc;
use engine_protocol::{EngineControl, EngineEvent, EngineSession, Protocol, SearchLimit};
use local_store::{AnalysisSummary, ImportedGame, LocalGame, LocalStore};
use manual_format::{
    ManualDocument, ManualFormat, ManualMetadata, detect_format, export_mainline_pgn, export_pgn,
    import_document,
};
use serde::Serialize;
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    ReorderBranchesPayload, SetMainlinePayload, UpdateCommentPayload, UpdateGameMetadataPayload,
};
use tauri::{Emitter, Manager, State};
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
    metadata: ManualMetadata,
    note: String,
    source_path: Option<String>,
    source_format: Option<String>,
    playable: bool,
}

struct DesktopState {
    model: Mutex<AppModel>,
    engine: tokio::sync::Mutex<Option<EngineControl>>,
    play_session: tokio::sync::Mutex<Option<EngineRuntime>>,
    analysis_generation: AtomicU64,
    play_generation: AtomicU64,
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
        line: AnalysisLine,
    },
    Bestmove {
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
    title: String,
    note: String,
    source_path: Option<String>,
    source_format: Option<String>,
    playable: bool,
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
    let mut slot = state.play_session.lock().await;
    if slot
        .as_ref()
        .is_some_and(|runtime| runtime.path != engine_path)
    {
        if let Some(runtime) = slot.take() {
            let _ = runtime.session.close().await;
        }
    }
    if slot.is_none() {
        let session = EngineSession::launch(&engine_path, Duration::from_secs(2))
            .await
            .map_err(|error| error.to_string())?;
        *slot = Some(EngineRuntime {
            path: engine_path.clone(),
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
                    emit_engine_event(&app, EngineRuntimeEvent::Info { line: line.clone() });
                }
                lines.insert(line.multipv, line);
            }
            Ok(EngineEvent::BestMove { best, ponder }) => {
                if state.analysis_generation.load(Ordering::SeqCst) == analysis_generation {
                    emit_engine_event(&app, EngineRuntimeEvent::Bestmove { best, ponder });
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
    let engine_name = Path::new(&engine_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Local engine");
    model
        .store
        .save_engine_profile(engine_name, &engine_path, protocol_name(protocol))
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
async fn engine_play_move(
    engine_path: String,
    move_time_ms: u64,
    threads: u32,
    hash_mb: u32,
    ponder: bool,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<EngineMoveDto, String> {
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
    let mut slot = state.play_session.lock().await;
    if slot.as_ref().is_some_and(|play| play.path != engine_path) {
        if let Some(play) = slot.take() {
            let _ = play.session.close().await;
        }
    }
    if slot.is_none() {
        let session = EngineSession::launch(&engine_path, Duration::from_secs(2))
            .await
            .map_err(|error| error.to_string())?;
        *slot = Some(EngineRuntime {
            path: engine_path.clone(),
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
            load_game_into_model(&mut model, game)?;
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
        status: if model.playable {
            match model.board.status() {
                GameStatus::Ongoing => "进行中",
                GameStatus::Check => "将军",
                GameStatus::Checkmate => "将死",
            }
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
                engine: tokio::sync::Mutex::new(None),
                play_session: tokio::sync::Mutex::new(None),
                analysis_generation: AtomicU64::new(0),
                play_generation: AtomicU64::new(0),
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
            new_game,
            open_document,
            import_text,
            export_text,
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
}
