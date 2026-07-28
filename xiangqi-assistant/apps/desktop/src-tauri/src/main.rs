use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use engine_protocol::{EngineEvent, EngineSession, SearchLimit};
use local_store::LocalStore;
use serde::Serialize;
use serde_json::json;
use sync_protocol::{Operation, OperationKind};
use tauri::{Manager, State};
use uuid::Uuid;
use xiangqi_core::{Board, Color, GameStatus, PieceKind, STARTING_FEN, Square};
use xiangqi_manual::ManualTree;

struct AppModel {
    board: Board,
    tree: ManualTree,
    current_node: Option<Uuid>,
    game_id: Uuid,
    device_id: Uuid,
    lamport: u64,
    store: LocalStore,
}

struct DesktopState(Mutex<AppModel>);

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
#[serde(rename_all = "camelCase")]
struct MoveDto {
    id: Uuid,
    iccs: String,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisLine {
    depth: Option<u32>,
    score_cp: Option<i32>,
    mate: Option<i32>,
    nps: Option<u64>,
    time_ms: Option<u64>,
    multipv: u32,
    pv: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    uploaded: usize,
    downloaded: usize,
    cursor: u64,
}

#[tauri::command]
fn get_state(state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let model = state
        .0
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    board_dto(&model)
}

#[tauri::command]
fn play_move(iccs: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .0
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
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
        payload: json!({ "nodeId": node_id, "parentId": parent, "move": iccs }),
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
    board_dto(&model)
}

#[tauri::command]
fn new_game(fen: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let mut model = state
        .0
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model.board = board;
    model.tree = ManualTree::new();
    model.current_node = None;
    model.game_id = Uuid::new_v4();
    model.lamport += 1;
    let operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: model.game_id,
        game_id: model.game_id,
        kind: OperationKind::CreateGame,
        payload: json!({"title":"New study", "fen": fen}),
        lamport: model.lamport,
        created_at: Utc::now(),
    };
    let game_id = model.game_id;
    let root_id = model.tree.root_id();
    model
        .store
        .save_game_with_operation(game_id, "New study", &fen, root_id, &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
async fn analyze_position(
    engine_path: String,
    fen: String,
    move_time_ms: u64,
) -> Result<Vec<AnalysisLine>, String> {
    let mut session = EngineSession::launch(&engine_path, Duration::from_secs(2))
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("MultiPV", "3")
        .await
        .map_err(|error| error.to_string())?;
    session
        .analyze(
            &fen,
            &[],
            SearchLimit::MoveTime(move_time_ms.clamp(100, 30_000)),
        )
        .await
        .map_err(|error| error.to_string())?;
    let mut lines = Vec::new();
    loop {
        match session
            .next_event()
            .await
            .map_err(|error| error.to_string())?
        {
            EngineEvent::Info(info) if !info.pv.is_empty() => lines.push(AnalysisLine {
                depth: info.depth,
                score_cp: info.score_cp,
                mate: info.mate,
                nps: info.nps,
                time_ms: info.time_ms,
                multipv: info.multipv,
                pv: info.pv,
            }),
            EngineEvent::BestMove { .. } => break,
            _ => {}
        }
    }
    let _ = session.close().await;
    lines.sort_by_key(|line| line.multipv);
    lines.dedup_by_key(|line| line.multipv);
    Ok(lines)
}

#[tauri::command]
async fn sync_now(
    server_url: String,
    token: String,
    state: State<'_, DesktopState>,
) -> Result<SyncResult, String> {
    let pending = {
        let model = state
            .0
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
            .0
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
            .0
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        for item in &pull.operations {
            model
                .store
                .apply_remote_operation(&item.operation, item.sequence)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(SyncResult {
        uploaded: pending.len(),
        downloaded: pull.operations.len(),
        cursor: pull.cursor,
    })
}

fn board_dto(model: &AppModel) -> Result<BoardDto, String> {
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
    let history = match model.current_node {
        Some(node) => model
            .tree
            .active_line(node)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|node| MoveDto {
                id: node.id,
                iccs: node.mv.to_iccs(),
                comment: node.comment.clone(),
                is_mainline: node.is_mainline,
            })
            .collect(),
        None => Vec::new(),
    };
    Ok(BoardDto {
        fen: model.board.to_fen(),
        side_to_move: if model.board.side_to_move() == Color::Red {
            "红方"
        } else {
            "黑方"
        },
        status: match model.board.status() {
            GameStatus::Ongoing => "进行中",
            GameStatus::Check => "将军",
            GameStatus::Checkmate => "将死",
        },
        pieces,
        history,
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut store = LocalStore::open(data_dir.join("xiangqi.sqlite3"))?;
            let device_id = Uuid::new_v4();
            let (board, tree, current_node, game_id, lamport) =
                if let Some(game) = store.load_latest_game()? {
                    let mut tree = ManualTree::with_root(game.root_id);
                    for node in store.load_move_nodes(game.id)? {
                        tree.restore_node(node)?;
                    }
                    let mut board = Board::from_fen(&game.starting_fen)?;
                    if let Some(current) = game.current_node_id {
                        for mv in tree.line_to(current)? {
                            board = board.apply_move(mv)?;
                        }
                    }
                    (board, tree, game.current_node_id, game.id, 1)
                } else {
                    let game_id = Uuid::new_v4();
                    let tree = ManualTree::new();
                    let operation = Operation {
                        op_id: Uuid::new_v4(),
                        device_id,
                        entity_id: game_id,
                        game_id,
                        kind: OperationKind::CreateGame,
                        payload: json!({"title":"New study", "fen": STARTING_FEN}),
                        lamport: 1,
                        created_at: Utc::now(),
                    };
                    store.save_game_with_operation(
                        game_id,
                        "New study",
                        STARTING_FEN,
                        tree.root_id(),
                        &operation,
                    )?;
                    (Board::from_fen(STARTING_FEN)?, tree, None, game_id, 1)
                };
            app.manage(DesktopState(Mutex::new(AppModel {
                board,
                tree,
                current_node,
                game_id,
                device_id,
                lamport,
                store,
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            play_move,
            new_game,
            analyze_position,
            sync_now
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Xiangqi Studio");
}
