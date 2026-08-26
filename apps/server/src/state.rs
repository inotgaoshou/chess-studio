use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use sqlx::MySqlPool;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) pool: MySqlPool,
    pub(crate) jwt_secret: String,
    pub(crate) guest_analysis_enabled: bool,
    pub(crate) guest_token_ttl: StdDuration,
    pub(crate) guest_daily_analysis_limit: u32,
    pub(crate) guest_token_ip_daily_limit: u32,
    pub(crate) analysis_ip_per_minute_limit: u32,
    pub(crate) user_analysis_per_minute_limit: u32,
    pub(crate) engine: EngineConfig,
    pub(crate) engine_slots: Arc<Semaphore>,
}

#[derive(Clone)]
pub(crate) struct EngineConfig {
    pub(crate) path: Option<PathBuf>,
    pub(crate) threads: u32,
    pub(crate) hash_mb: u32,
    pub(crate) timeout: StdDuration,
}
