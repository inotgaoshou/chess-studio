use crate::{
    app_state::{AppModel, DesktopState},
    credential_store::SystemCredentialStore,
    desktop_types::LinkSession,
    report_service::{ensure_builtin_master_style_seed, ensure_training_system_seed},
};
use chrono::Utc;
use local_store::LocalStore;
use manual_format::ManualMetadata;
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Condvar, Mutex};
use sync_protocol::{CreateGamePayload, Operation, OperationKind};
use tauri::Manager;
use uuid::Uuid;
use xiangqi_core::{Board, STARTING_FEN};
use xiangqi_manual::ManualTree;

pub(crate) fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let mut store = LocalStore::open(data_dir.join("xiangqi.sqlite3"))?;
    ensure_builtin_master_style_seed(app.handle(), &mut store).map_err(std::io::Error::other)?;
    ensure_training_system_seed(&mut store).map_err(std::io::Error::other)?;
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
        store.set_game_document_properties(game_id, &serde_json::to_string(&metadata)?, true)?;
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
}
