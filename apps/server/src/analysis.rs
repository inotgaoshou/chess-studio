use std::collections::BTreeMap;
use std::time::{Duration as StdDuration, Instant};

use axum::{Json, extract::State, http::HeaderMap};
use chrono::{Duration, Utc};
use engine_protocol::{EngineEvent, EngineSession, SearchLimit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;
use uuid::Uuid;
use xiangqi_core::Board;

use crate::auth::{AnalysisPrincipal, analysis_principal};
use crate::error::ApiError;
use crate::state::{AppState, EngineConfig};
use crate::subscription::{
    record_product_event_for_pool, release_cloud_analysis, reserve_cloud_analysis,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisRequest {
    pub(crate) fen: String,
    pub(crate) mode: AnalysisMode,
    pub(crate) value: u64,
    pub(crate) multi_pv: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AnalysisMode {
    Time,
    Depth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisResponse {
    pub(crate) engine: &'static str,
    pub(crate) elapsed_ms: u64,
    pub(crate) lines: Vec<AnalysisLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) guest_quota: Option<GuestQuotaDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuestQuotaDto {
    limit: u32,
    remaining: u32,
    resets_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisLine {
    pub(crate) depth: Option<u32>,
    pub(crate) score_cp: Option<i32>,
    pub(crate) mate: Option<i32>,
    pub(crate) nps: Option<u64>,
    pub(crate) time_ms: Option<u64>,
    pub(crate) multipv: u32,
    pub(crate) notation: Vec<String>,
    pub(crate) pv: Vec<String>,
}
pub(crate) struct RateLimitUsage {
    limit: u32,
    count: u32,
    window_start: chrono::DateTime<Utc>,
}

impl RateLimitUsage {
    fn remaining(&self) -> u32 {
        self.limit.saturating_sub(self.count)
    }

    fn resets_at(&self) -> chrono::DateTime<Utc> {
        if self.window_start.timestamp() % 86_400 == 0 {
            self.window_start + Duration::days(1)
        } else {
            self.window_start + Duration::minutes(1)
        }
    }
}

pub(crate) async fn consume_rate_limit(
    pool: &MySqlPool,
    scope: &str,
    subject: &str,
    window_start: chrono::DateTime<Utc>,
    limit: u32,
    error: ApiError,
) -> Result<RateLimitUsage, ApiError> {
    let subject_hash = rate_limit_subject_hash(scope, subject);
    let mut transaction = pool.begin().await?;
    let existing = sqlx::query_scalar::<_, u32>(
        "SELECT count FROM analysis_rate_limits
         WHERE scope = ? AND subject_hash = ? AND window_start = ?
         FOR UPDATE",
    )
    .bind(scope)
    .bind(&subject_hash)
    .bind(window_start)
    .fetch_optional(&mut *transaction)
    .await?;
    let next = existing.unwrap_or(0).saturating_add(1);
    if next > limit {
        transaction.rollback().await?;
        return Err(error);
    }
    if existing.is_some() {
        sqlx::query(
            "UPDATE analysis_rate_limits SET count = ?, updated_at = ?
             WHERE scope = ? AND subject_hash = ? AND window_start = ?",
        )
        .bind(next)
        .bind(Utc::now())
        .bind(scope)
        .bind(&subject_hash)
        .bind(window_start)
        .execute(&mut *transaction)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO analysis_rate_limits (scope, subject_hash, window_start, count, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(scope)
        .bind(&subject_hash)
        .bind(window_start)
        .bind(next)
        .bind(Utc::now())
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(RateLimitUsage {
        limit,
        count: next,
        window_start,
    })
}

pub(crate) async fn release_rate_limit(
    pool: &MySqlPool,
    scope: &str,
    subject: &str,
    window_start: chrono::DateTime<Utc>,
) {
    let subject_hash = rate_limit_subject_hash(scope, subject);
    if let Err(error) = sqlx::query(
        "UPDATE analysis_rate_limits SET count = count - 1, updated_at = ?
         WHERE scope = ? AND subject_hash = ? AND window_start = ? AND count > 0",
    )
    .bind(Utc::now())
    .bind(scope)
    .bind(subject_hash)
    .bind(window_start)
    .execute(pool)
    .await
    {
        tracing::warn!(%error, %scope, "failed to release rate limit counter");
    }
}

pub(crate) fn rate_limit_subject_hash(scope: &str, subject: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(scope.as_bytes());
    hasher.update(b":");
    hasher.update(subject.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub(crate) fn request_ip_subject(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("unknown")
        .to_string()
}

pub(crate) fn minute_window_start(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    chrono::DateTime::from_timestamp(now.timestamp() - now.timestamp().rem_euclid(60), 0)
        .unwrap_or(now)
}

pub(crate) fn day_window_start(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let timestamp = now.timestamp();
    chrono::DateTime::from_timestamp(timestamp - timestamp.rem_euclid(86_400), 0).unwrap_or(now)
}
pub(crate) async fn analyze(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AnalysisRequest>,
) -> Result<Json<AnalysisResponse>, ApiError> {
    let principal = analysis_principal(&headers, &state.jwt_secret, state.guest_analysis_enabled)?;
    validate_analysis_request(&request)?;
    if matches!(principal, AnalysisPrincipal::Guest { .. }) {
        validate_guest_analysis_request(&request)?;
    }
    let now = Utc::now();
    let ip_subject = request_ip_subject(&headers);
    consume_rate_limit(
        &state.pool,
        "analysis_ip_minute",
        &ip_subject,
        minute_window_start(now),
        state.analysis_ip_per_minute_limit,
        ApiError::RateLimited,
    )
    .await?;
    let mut guest_usage: Option<(String, chrono::DateTime<Utc>, RateLimitUsage)> = None;
    let mut reserved_user: Option<Uuid> = None;
    match &principal {
        AnalysisPrincipal::User(user_id) => {
            consume_rate_limit(
                &state.pool,
                "user_analysis_minute",
                &user_id.to_string(),
                minute_window_start(now),
                state.user_analysis_per_minute_limit,
                ApiError::RateLimited,
            )
            .await?;
            reserve_cloud_analysis(&state.pool, *user_id).await?;
            reserved_user = Some(*user_id);
        }
        AnalysisPrincipal::Guest { subject } => {
            let window = day_window_start(now);
            let usage = consume_rate_limit(
                &state.pool,
                "guest_analysis_token_day",
                subject,
                window,
                state.guest_daily_analysis_limit,
                ApiError::GuestQuotaExceeded,
            )
            .await?;
            guest_usage = Some((subject.clone(), window, usage));
        }
    }
    let permit = state.engine_slots.clone().try_acquire_owned();
    let permit = match permit {
        Ok(permit) => permit,
        Err(_) => {
            release_analysis_reservation(&state, reserved_user, &guest_usage).await;
            return Err(ApiError::EngineBusy);
        }
    };
    let guest_quota = guest_usage.as_ref().map(|(_, _, usage)| GuestQuotaDto {
        limit: usage.limit,
        remaining: usage.remaining(),
        resets_at: usage.resets_at(),
    });
    let timeout = state.engine.timeout;
    let result =
        tokio::time::timeout(timeout, run_analysis(&state.engine, &request, guest_quota)).await;
    drop(permit);
    match result {
        Ok(Ok(response)) => {
            if let AnalysisPrincipal::User(user_id) = principal {
                if let Err(error) =
                    record_product_event_for_pool(&state.pool, user_id, "cloud_analysis_consumed")
                        .await
                {
                    tracing::warn!(%error, "failed to record cloud analysis event");
                }
            }
            Ok(Json(response))
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "Pikafish analysis failed");
            release_analysis_reservation(&state, reserved_user, &guest_usage).await;
            Err(ApiError::EngineUnavailable)
        }
        Err(_) => {
            release_analysis_reservation(&state, reserved_user, &guest_usage).await;
            Err(ApiError::EngineTimeout)
        }
    }
}

pub(crate) fn validate_analysis_request(request: &AnalysisRequest) -> Result<(), ApiError> {
    Board::from_fen(&request.fen)
        .map_err(|error| ApiError::Invalid(format!("invalid FEN: {error}")))?;
    if !(1..=5).contains(&request.multi_pv) {
        return Err(ApiError::Invalid("multiPv must be between 1 and 5".into()));
    }
    match request.mode {
        AnalysisMode::Time if !(100..=5_000).contains(&request.value) => Err(ApiError::Invalid(
            "time value must be between 100 and 5000 milliseconds".into(),
        )),
        AnalysisMode::Depth if !(1..=30).contains(&request.value) => Err(ApiError::Invalid(
            "depth value must be between 1 and 30".into(),
        )),
        _ => Ok(()),
    }
}

pub(crate) fn validate_guest_analysis_request(request: &AnalysisRequest) -> Result<(), ApiError> {
    if request.multi_pv > 2 {
        return Err(ApiError::Invalid(
            "guest multiPv must be between 1 and 2".into(),
        ));
    }
    match request.mode {
        AnalysisMode::Time if request.value > 2_000 => Err(ApiError::Invalid(
            "guest time value must be between 100 and 2000 milliseconds".into(),
        )),
        AnalysisMode::Depth if request.value > 20 => Err(ApiError::Invalid(
            "guest depth value must be between 1 and 20".into(),
        )),
        _ => Ok(()),
    }
}

pub(crate) async fn release_analysis_reservation(
    state: &AppState,
    user_id: Option<Uuid>,
    guest_usage: &Option<(String, chrono::DateTime<Utc>, RateLimitUsage)>,
) {
    if let Some(user_id) = user_id {
        release_cloud_analysis(&state.pool, user_id).await;
    }
    if let Some((subject, window_start, _)) = guest_usage {
        release_rate_limit(
            &state.pool,
            "guest_analysis_token_day",
            subject,
            *window_start,
        )
        .await;
    }
}

pub(crate) async fn run_analysis(
    config: &EngineConfig,
    request: &AnalysisRequest,
    guest_quota: Option<GuestQuotaDto>,
) -> Result<AnalysisResponse, String> {
    let analysis_board = Board::from_fen(&request.fen).map_err(|error| error.to_string())?;
    let path = config
        .path
        .as_ref()
        .ok_or_else(|| "PIKAFISH_PATH is not configured".to_owned())?;
    let limit = match request.mode {
        AnalysisMode::Time => SearchLimit::MoveTime(request.value),
        AnalysisMode::Depth => SearchLimit::Depth(request.value as u32),
    };
    let started = Instant::now();
    let mut session = EngineSession::launch(path, StdDuration::from_secs(2))
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("Threads", &config.threads.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("Hash", &config.hash_mb.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .configure("MultiPV", &request.multi_pv.to_string())
        .await
        .map_err(|error| error.to_string())?;
    session
        .analyze(&request.fen, &[], limit)
        .await
        .map_err(|error| error.to_string())?;
    let mut lines = BTreeMap::new();
    loop {
        match session
            .next_event()
            .await
            .map_err(|error| error.to_string())?
        {
            EngineEvent::Info(info) if !info.pv.is_empty() => {
                lines.insert(
                    info.multipv,
                    AnalysisLine {
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
                    },
                );
            }
            EngineEvent::BestMove { .. } => break,
            _ => {}
        }
    }
    session.close().await.map_err(|error| error.to_string())?;
    Ok(AnalysisResponse {
        engine: "Pikafish",
        elapsed_ms: started.elapsed().as_millis() as u64,
        lines: lines.into_values().collect(),
        guest_quota,
    })
}
