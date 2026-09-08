use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;
use xiangqi_core::Board;

use crate::analysis::{
    AnalysisMode, AnalysisProgressUpdate, AnalysisRequest, AnalysisReservation, AnalysisResponse,
    release_analysis_reservation, reserve_analysis_request, run_analysis_with_progress,
    validate_analysis_request, validate_guest_analysis_request,
};
use crate::auth::{AnalysisPrincipal, analysis_principal};
use crate::error::ApiError;
use crate::state::{AppState, EngineConfig};
use crate::subscription::{record_product_event_for_pool, require_cloud_analysis_entitlement};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisBudget {
    pub(crate) mode: AnalysisMode,
    pub(crate) value: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAnalysisJobRequest {
    pub(crate) fen: String,
    pub(crate) engine_version: String,
    pub(crate) nnue_version: String,
    pub(crate) budget: AnalysisBudget,
    #[serde(alias = "candidateCount")]
    pub(crate) multi_pv: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum AnalysisJobOwner {
    User(Uuid),
    Guest(String),
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AnalysisJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisJobProgress {
    pub(crate) depth: Option<u32>,
    pub(crate) elapsed_ms: Option<u64>,
    pub(crate) candidate_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisJobDto {
    pub(crate) job_id: Uuid,
    pub(crate) status: AnalysisJobStatus,
    pub(crate) source: &'static str,
    pub(crate) engine_version: String,
    pub(crate) nnue_version: String,
    pub(crate) cache_hit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) progress: Option<AnalysisJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<AnalysisResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

pub(crate) struct AnalysisJobSubmission {
    pub(crate) job: AnalysisJobDto,
    pub(crate) request: CreateAnalysisJobRequest,
    pub(crate) cancel: Option<Arc<Notify>>,
}

impl AnalysisJobSubmission {
    pub(crate) fn should_run(&self) -> bool {
        self.cancel.is_some()
    }
}

struct AnalysisJobRecord {
    owner: AnalysisJobOwner,
    cache_key: String,
    cancel: Arc<Notify>,
    job: AnalysisJobDto,
}

#[derive(Default)]
struct AnalysisJobState {
    jobs: HashMap<Uuid, AnalysisJobRecord>,
    cache: HashMap<String, CachedAnalysis>,
}

struct CachedAnalysis {
    result: AnalysisResponse,
    inserted_at: DateTime<Utc>,
}

#[derive(Clone)]
pub(crate) struct AnalysisJobStore {
    state: Arc<Mutex<AnalysisJobState>>,
    max_queued: usize,
    max_history: usize,
    max_cache_entries: usize,
}

impl AnalysisJobStore {
    pub(crate) fn new(max_queued: usize) -> Self {
        Self {
            state: Arc::new(Mutex::new(AnalysisJobState::default())),
            max_queued: max_queued.max(1),
            max_history: max_queued.max(1).saturating_mul(4),
            max_cache_entries: max_queued.max(1).saturating_mul(4),
        }
    }

    pub(crate) async fn prepare(
        &self,
        owner: AnalysisJobOwner,
        config: &EngineConfig,
        request: CreateAnalysisJobRequest,
    ) -> Result<AnalysisJobSubmission, ApiError> {
        validate_requested_versions(config, &request)?;
        let cache_key = analysis_cache_key(config, &request)?;
        let now = Utc::now();
        let job_id = Uuid::new_v4();
        let cancel = Arc::new(Notify::new());
        let mut state = self.state.lock().await;
        prune_terminal_jobs(&mut state.jobs, self.max_history);
        let cached = state
            .cache
            .get(&cache_key)
            .map(|entry| entry.result.clone());
        if cached.is_none() {
            let active = state
                .jobs
                .values()
                .filter(|record| {
                    matches!(
                        record.job.status,
                        AnalysisJobStatus::Queued | AnalysisJobStatus::Running
                    )
                })
                .count();
            if active >= self.max_queued {
                return Err(ApiError::EngineBusy);
            }
        }
        let job = AnalysisJobDto {
            job_id,
            status: if cached.is_some() {
                AnalysisJobStatus::Completed
            } else {
                AnalysisJobStatus::Queued
            },
            source: "cloud",
            engine_version: config.engine_version.clone(),
            nnue_version: config.nnue_version.clone(),
            cache_hit: cached.is_some(),
            progress: None,
            result: cached,
            error: None,
            created_at: now,
            updated_at: now,
        };
        state.jobs.insert(
            job_id,
            AnalysisJobRecord {
                owner,
                cache_key,
                cancel: cancel.clone(),
                job: job.clone(),
            },
        );
        Ok(AnalysisJobSubmission {
            job,
            request,
            cancel: (!state.jobs[&job_id].job.cache_hit).then_some(cancel),
        })
    }

    pub(crate) async fn get(
        &self,
        owner: &AnalysisJobOwner,
        job_id: Uuid,
    ) -> Result<AnalysisJobDto, ApiError> {
        let state = self.state.lock().await;
        let record = state.jobs.get(&job_id).ok_or(ApiError::NotFound)?;
        if &record.owner != owner {
            return Err(ApiError::NotFound);
        }
        Ok(record.job.clone())
    }

    pub(crate) async fn mark_running(&self, job_id: Uuid) -> Result<bool, ApiError> {
        let mut state = self.state.lock().await;
        let record = state.jobs.get_mut(&job_id).ok_or(ApiError::NotFound)?;
        if record.job.status == AnalysisJobStatus::Cancelled {
            return Ok(false);
        }
        if record.job.status != AnalysisJobStatus::Queued {
            return Err(ApiError::Conflict("analysis job is not queued".into()));
        }
        record.job.status = AnalysisJobStatus::Running;
        record.job.updated_at = Utc::now();
        Ok(true)
    }

    pub(crate) async fn update_progress(
        &self,
        job_id: Uuid,
        progress: AnalysisJobProgress,
    ) -> Result<(), ApiError> {
        let mut state = self.state.lock().await;
        let record = state.jobs.get_mut(&job_id).ok_or(ApiError::NotFound)?;
        if record.job.status == AnalysisJobStatus::Running {
            record.job.progress = Some(progress);
            record.job.updated_at = Utc::now();
        }
        Ok(())
    }

    pub(crate) async fn complete(
        &self,
        job_id: Uuid,
        result: AnalysisResponse,
    ) -> Result<bool, ApiError> {
        let mut state = self.state.lock().await;
        let cache_key = {
            let record = state.jobs.get_mut(&job_id).ok_or(ApiError::NotFound)?;
            if record.job.status == AnalysisJobStatus::Cancelled {
                return Ok(false);
            }
            if record.job.status != AnalysisJobStatus::Running {
                return Err(ApiError::Conflict("analysis job is not running".into()));
            }
            record.job.status = AnalysisJobStatus::Completed;
            record.job.progress = Some(AnalysisJobProgress {
                depth: result.lines.iter().filter_map(|line| line.depth).max(),
                elapsed_ms: Some(result.elapsed_ms),
                candidate_count: result.lines.len(),
            });
            record.job.result = Some(result.clone());
            record.job.updated_at = Utc::now();
            record.cache_key.clone()
        };
        let mut cached_result = result;
        cached_result.guest_quota = None;
        prune_cache(&mut state.cache, self.max_cache_entries);
        state.cache.insert(
            cache_key,
            CachedAnalysis {
                result: cached_result,
                inserted_at: Utc::now(),
            },
        );
        Ok(true)
    }

    pub(crate) async fn fail(
        &self,
        job_id: Uuid,
        error: impl Into<String>,
    ) -> Result<(), ApiError> {
        let mut state = self.state.lock().await;
        let record = state.jobs.get_mut(&job_id).ok_or(ApiError::NotFound)?;
        if record.job.status != AnalysisJobStatus::Cancelled {
            record.job.status = AnalysisJobStatus::Failed;
            record.job.error = Some(error.into());
            record.job.updated_at = Utc::now();
        }
        Ok(())
    }

    pub(crate) async fn cancel(
        &self,
        owner: &AnalysisJobOwner,
        job_id: Uuid,
    ) -> Result<AnalysisJobDto, ApiError> {
        let mut state = self.state.lock().await;
        let record = state.jobs.get_mut(&job_id).ok_or(ApiError::NotFound)?;
        if &record.owner != owner {
            return Err(ApiError::NotFound);
        }
        if matches!(
            record.job.status,
            AnalysisJobStatus::Queued | AnalysisJobStatus::Running
        ) {
            record.job.status = AnalysisJobStatus::Cancelled;
            record.job.updated_at = Utc::now();
            record.cancel.notify_one();
        }
        Ok(record.job.clone())
    }

    pub(crate) async fn remove(&self, job_id: Uuid) {
        self.state.lock().await.jobs.remove(&job_id);
    }
}

fn prune_terminal_jobs(jobs: &mut HashMap<Uuid, AnalysisJobRecord>, max_history: usize) {
    while jobs.len() >= max_history {
        let oldest = jobs
            .iter()
            .filter(|(_, record)| {
                !matches!(
                    record.job.status,
                    AnalysisJobStatus::Queued | AnalysisJobStatus::Running
                )
            })
            .min_by_key(|(_, record)| record.job.updated_at)
            .map(|(job_id, _)| *job_id);
        let Some(job_id) = oldest else {
            break;
        };
        jobs.remove(&job_id);
    }
}

fn prune_cache(cache: &mut HashMap<String, CachedAnalysis>, max_entries: usize) {
    while cache.len() >= max_entries {
        let oldest = cache
            .iter()
            .min_by_key(|(_, entry)| entry.inserted_at)
            .map(|(key, _)| key.clone());
        let Some(key) = oldest else {
            break;
        };
        cache.remove(&key);
    }
}

fn validate_requested_versions(
    config: &EngineConfig,
    request: &CreateAnalysisJobRequest,
) -> Result<(), ApiError> {
    if request.engine_version != config.engine_version {
        return Err(ApiError::Conflict(format!(
            "requested engine version is unavailable; server provides {}",
            config.engine_version
        )));
    }
    if request.nnue_version != config.nnue_version {
        return Err(ApiError::Conflict(format!(
            "requested NNUE version is unavailable; server provides {}",
            config.nnue_version
        )));
    }
    Ok(())
}

pub(crate) async fn create_analysis_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateAnalysisJobRequest>,
) -> Result<(StatusCode, Json<AnalysisJobDto>), ApiError> {
    let principal = analysis_principal(&headers, &state.jwt_secret, state.guest_analysis_enabled)?;
    let analysis_request = request.analysis_request();
    validate_analysis_request(&analysis_request)?;
    if matches!(principal, AnalysisPrincipal::Guest { .. }) {
        validate_guest_analysis_request(&analysis_request)?;
    }
    let owner = AnalysisJobOwner::from(&principal);
    let submission = state
        .analysis_jobs
        .prepare(owner, &state.engine, request)
        .await?;
    if !submission.should_run() {
        if let AnalysisPrincipal::User(user_id) = principal {
            require_cloud_analysis_entitlement(&state.pool, user_id).await?;
        }
        return Ok((StatusCode::OK, Json(submission.job)));
    }
    let reservation =
        match reserve_analysis_request(&state, &headers, principal, &analysis_request).await {
            Ok(reservation) => reservation,
            Err(error) => {
                state.analysis_jobs.remove(submission.job.job_id).await;
                return Err(error);
            }
        };
    let response = submission.job.clone();
    tokio::spawn(run_submitted_job(state, submission, reservation));
    Ok((StatusCode::ACCEPTED, Json(response)))
}

pub(crate) async fn get_analysis_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<AnalysisJobDto>, ApiError> {
    let principal = analysis_principal(&headers, &state.jwt_secret, state.guest_analysis_enabled)?;
    Ok(Json(
        state
            .analysis_jobs
            .get(&AnalysisJobOwner::from(&principal), job_id)
            .await?,
    ))
}

pub(crate) async fn cancel_analysis_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<AnalysisJobDto>, ApiError> {
    let principal = analysis_principal(&headers, &state.jwt_secret, state.guest_analysis_enabled)?;
    Ok(Json(
        state
            .analysis_jobs
            .cancel(&AnalysisJobOwner::from(&principal), job_id)
            .await?,
    ))
}

impl CreateAnalysisJobRequest {
    fn analysis_request(&self) -> AnalysisRequest {
        AnalysisRequest {
            fen: self.fen.clone(),
            mode: self.budget.mode,
            value: self.budget.value,
            multi_pv: self.multi_pv,
        }
    }
}

impl From<&AnalysisPrincipal> for AnalysisJobOwner {
    fn from(principal: &AnalysisPrincipal) -> Self {
        match principal {
            AnalysisPrincipal::User(user_id) => Self::User(*user_id),
            AnalysisPrincipal::Guest { subject } => Self::Guest(subject.clone()),
        }
    }
}

async fn run_submitted_job(
    state: AppState,
    submission: AnalysisJobSubmission,
    reservation: AnalysisReservation,
) {
    let job_id = submission.job.job_id;
    let Some(cancel) = submission.cancel else {
        return;
    };
    let permit = tokio::select! {
        _ = cancel.notified() => {
            release_reservation(&state, reservation).await;
            return;
        }
        permit = state.engine_slots.clone().acquire_owned() => match permit {
            Ok(permit) => permit,
            Err(_) => {
                let _ = state.analysis_jobs.fail(job_id, "analysis worker pool is unavailable").await;
                release_reservation(&state, reservation).await;
                return;
            }
        }
    };
    match state.analysis_jobs.mark_running(job_id).await {
        Ok(true) => {}
        Ok(false) | Err(_) => {
            drop(permit);
            release_reservation(&state, reservation).await;
            return;
        }
    }

    let request = submission.request.analysis_request();
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
    let analysis = tokio::time::timeout(
        state.engine.timeout,
        run_analysis_with_progress(
            &state.engine,
            &request,
            reservation.guest_quota.clone(),
            Some(progress_tx),
        ),
    );
    tokio::pin!(analysis);
    let outcome = loop {
        tokio::select! {
            _ = cancel.notified() => break JobOutcome::Cancelled,
            Some(progress) = progress_rx.recv() => {
                let _ = state.analysis_jobs.update_progress(job_id, progress.into()).await;
            }
            result = &mut analysis => {
                break match result {
                    Ok(Ok(response)) => JobOutcome::Completed(response),
                    Ok(Err(error)) => JobOutcome::Failed(error),
                    Err(_) => JobOutcome::Failed("analysis timed out".into()),
                };
            }
        }
    };
    drop(permit);
    match outcome {
        JobOutcome::Completed(response) => {
            match state.analysis_jobs.complete(job_id, response).await {
                Ok(true) => record_consumed(&state, &reservation).await,
                Ok(false) | Err(_) => release_reservation(&state, reservation).await,
            }
        }
        JobOutcome::Failed(error) => {
            tracing::warn!(%job_id, %error, "Pikafish analysis job failed");
            let _ = state.analysis_jobs.fail(job_id, error).await;
            release_reservation(&state, reservation).await;
        }
        JobOutcome::Cancelled => {
            release_reservation(&state, reservation).await;
        }
    }
}

enum JobOutcome {
    Completed(AnalysisResponse),
    Failed(String),
    Cancelled,
}

impl From<AnalysisProgressUpdate> for AnalysisJobProgress {
    fn from(progress: AnalysisProgressUpdate) -> Self {
        Self {
            depth: progress.depth,
            elapsed_ms: progress.elapsed_ms,
            candidate_count: progress.candidate_count,
        }
    }
}

async fn record_consumed(state: &AppState, reservation: &AnalysisReservation) {
    if let AnalysisPrincipal::User(user_id) = reservation.principal {
        if let Err(error) =
            record_product_event_for_pool(&state.pool, user_id, "cloud_analysis_consumed").await
        {
            tracing::warn!(%error, "failed to record cloud analysis event");
        }
    }
}

async fn release_reservation(state: &AppState, reservation: AnalysisReservation) {
    release_analysis_reservation(state, reservation.reserved_user, &reservation.guest_usage).await;
}

pub(crate) fn analysis_cache_key(
    config: &EngineConfig,
    request: &CreateAnalysisJobRequest,
) -> Result<String, ApiError> {
    let normalized_fen = Board::from_fen(request.fen.trim())
        .map_err(|error| ApiError::Invalid(format!("invalid FEN: {error}")))?
        .to_fen();
    let identity = serde_json::json!({
        "fen": normalized_fen,
        "engineVersion": config.engine_version,
        "nnueVersion": config.nnue_version,
        "budget": request.budget,
        "multiPv": request.multi_pv,
    });
    let encoded = serde_json::to_vec(&identity).map_err(|_| ApiError::Internal)?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use super::*;
    use crate::analysis::{AnalysisLine, AnalysisResponse};

    fn engine_config() -> EngineConfig {
        EngineConfig {
            path: Some(PathBuf::from("/tmp/pikafish")),
            threads: 2,
            hash_mb: 64,
            timeout: Duration::from_secs(2),
            engine_version: "Pikafish-test".into(),
            nnue_version: "nnue-test".into(),
        }
    }

    fn request() -> CreateAnalysisJobRequest {
        CreateAnalysisJobRequest {
            fen: xiangqi_core::STARTING_FEN.into(),
            engine_version: "Pikafish-test".into(),
            nnue_version: "nnue-test".into(),
            budget: AnalysisBudget {
                mode: AnalysisMode::Depth,
                value: 8,
            },
            multi_pv: 1,
        }
    }

    #[tokio::test]
    async fn completed_jobs_are_reused_without_sharing_job_identity() {
        let store = AnalysisJobStore::new(4);
        let owner = AnalysisJobOwner::Guest("guest-1".into());
        let first = store
            .prepare(owner.clone(), &engine_config(), request())
            .await
            .unwrap();
        assert_eq!(first.job.status, AnalysisJobStatus::Queued);
        assert!(first.should_run());

        store.mark_running(first.job.job_id).await.unwrap();
        store
            .complete(
                first.job.job_id,
                AnalysisResponse {
                    engine: "Pikafish",
                    elapsed_ms: 25,
                    lines: vec![AnalysisLine {
                        depth: Some(8),
                        score_cp: Some(12),
                        mate: None,
                        nps: Some(1_000),
                        time_ms: Some(25),
                        multipv: 1,
                        notation: vec!["炮二平五".into()],
                        pv: vec!["h2e2".into()],
                    }],
                    guest_quota: None,
                },
            )
            .await
            .unwrap();

        let second = store
            .prepare(owner.clone(), &engine_config(), request())
            .await
            .unwrap();
        assert_ne!(first.job.job_id, second.job.job_id);
        assert_eq!(second.job.status, AnalysisJobStatus::Completed);
        assert!(second.job.cache_hit);
        assert!(!second.should_run());
        assert_eq!(second.job.result.unwrap().lines[0].score_cp, Some(12));
        assert!(store.get(&owner, first.job.job_id).await.is_ok());
        assert!(
            store
                .get(&AnalysisJobOwner::Guest("guest-2".into()), first.job.job_id)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn queued_jobs_can_be_cancelled_and_version_mismatches_are_rejected() {
        let store = AnalysisJobStore::new(1);
        let owner = AnalysisJobOwner::Guest("guest-1".into());
        let submission = store
            .prepare(owner.clone(), &engine_config(), request())
            .await
            .unwrap();
        let cancel = submission.cancel.unwrap();

        let cancelled = store.cancel(&owner, submission.job.job_id).await.unwrap();
        assert_eq!(cancelled.status, AnalysisJobStatus::Cancelled);
        cancel.notified().await;
        assert!(!store.mark_running(submission.job.job_id).await.unwrap());

        let incompatible = CreateAnalysisJobRequest {
            engine_version: "Pikafish-other".into(),
            ..request()
        };
        assert!(matches!(
            store.prepare(owner, &engine_config(), incompatible).await,
            Err(ApiError::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn running_jobs_can_be_cancelled_and_terminal_jobs_release_queue_capacity() {
        let store = AnalysisJobStore::new(1);
        let owner = AnalysisJobOwner::Guest("guest-1".into());
        let submission = store
            .prepare(owner.clone(), &engine_config(), request())
            .await
            .unwrap();
        let cancel = submission.cancel.unwrap();
        store.mark_running(submission.job.job_id).await.unwrap();

        assert!(matches!(
            store
                .prepare(owner.clone(), &engine_config(), request())
                .await,
            Err(ApiError::EngineBusy)
        ));
        let cancelled = store.cancel(&owner, submission.job.job_id).await.unwrap();
        assert_eq!(cancelled.status, AnalysisJobStatus::Cancelled);
        cancel.notified().await;

        assert!(
            store
                .prepare(owner, &engine_config(), request())
                .await
                .unwrap()
                .should_run()
        );
    }

    #[tokio::test]
    async fn invalid_fen_is_rejected_without_occupying_queue_capacity() {
        let store = AnalysisJobStore::new(1);
        let owner = AnalysisJobOwner::Guest("guest-1".into());
        let invalid = CreateAnalysisJobRequest {
            fen: "not-a-fen".into(),
            ..request()
        };

        assert!(matches!(
            store
                .prepare(owner.clone(), &engine_config(), invalid)
                .await,
            Err(ApiError::Invalid(_))
        ));
        assert!(
            store
                .prepare(owner, &engine_config(), request())
                .await
                .unwrap()
                .should_run()
        );
    }
}
