use crate::{
    cloud_opening_book,
    credential_store::SharedCredentialStore,
    desktop_types::{EngineRuntime, LinkCaptureRegion, LinkSession},
};
use engine_protocol::EngineControl;
use local_store::LocalStore;
use manual_format::ManualMetadata;
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Condvar, Mutex};
use uuid::Uuid;
use xiangqi_core::Board;
use xiangqi_manual::ManualTree;

pub(crate) struct AppModel {
    pub(crate) board: Board,
    pub(crate) starting_fen: String,
    pub(crate) tree: ManualTree,
    pub(crate) current_node: Option<Uuid>,
    pub(crate) game_id: Uuid,
    pub(crate) device_id: Uuid,
    pub(crate) lamport: u64,
    pub(crate) store: LocalStore,
    pub(crate) metadata: ManualMetadata,
    pub(crate) note: String,
    pub(crate) source_path: Option<String>,
    pub(crate) source_format: Option<String>,
    pub(crate) playable: bool,
}

pub(crate) struct DesktopState {
    pub(crate) model: Mutex<AppModel>,
    pub(crate) credentials: SharedCredentialStore,
    pub(crate) session_token: Mutex<Option<String>>,
    pub(crate) engine: tokio::sync::Mutex<HashMap<String, EngineControl>>,
    pub(crate) report_engine: tokio::sync::Mutex<Option<EngineControl>>,
    pub(crate) report_commit: tokio::sync::Mutex<()>,
    pub(crate) play_session: tokio::sync::Mutex<Option<EngineRuntime>>,
    pub(crate) analysis_generation: AtomicU64,
    pub(crate) play_generation: AtomicU64,
    pub(crate) report_generation: AtomicU64,
    pub(crate) report_running: AtomicBool,
    pub(crate) cloud_book_cache:
        Mutex<BTreeMap<String, Vec<cloud_opening_book::CloudBookCandidateDto>>>,
    pub(crate) link_session: Mutex<LinkSession>,
    pub(crate) screenshot_resolution_guard: Mutex<()>,
    pub(crate) link_capture_generation: AtomicU64,
    pub(crate) link_region_selection_background: Mutex<Option<String>>,
    pub(crate) link_region_selection: (Mutex<Option<Result<LinkCaptureRegion, String>>>, Condvar),
}
