use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};

use anyhow::Context;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use engine_protocol::{EngineEvent, EngineSession, SearchLimit};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use password_hash::{SaltString, rand_core::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{MySql, MySqlPool, Transaction, mysql::MySqlPoolOptions};
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind, PullResponse,
    PushRequest, PushResponse, ReorderBranchesPayload, SequencedOperation, SetMainlinePayload,
    UpdateCommentPayload, UpdateGameMetadataPayload,
};
use tokio::sync::Semaphore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;
use xiangqi_core::Board;

#[derive(Clone)]
struct AppState {
    pool: MySqlPool,
    jwt_secret: String,
    guest_analysis_enabled: bool,
    guest_token_ttl: StdDuration,
    guest_daily_analysis_limit: u32,
    guest_token_ip_daily_limit: u32,
    analysis_ip_per_minute_limit: u32,
    user_analysis_per_minute_limit: u32,
    engine: EngineConfig,
    engine_slots: Arc<Semaphore>,
}

#[derive(Clone)]
struct EngineConfig {
    path: Option<PathBuf>,
    threads: u32,
    hash_mb: u32,
    timeout: StdDuration,
}

#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
}

#[derive(Debug, Deserialize)]
struct Credentials {
    email: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct AuthResponse {
    user_id: Uuid,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuestAuthResponse {
    token: String,
    token_type: &'static str,
    expires_at: chrono::DateTime<Utc>,
    guest_quota_limit: u32,
    guest_quota_remaining: u32,
    guest_quota_resets_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisRequest {
    fen: String,
    mode: AnalysisMode,
    value: u64,
    multi_pv: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AnalysisMode {
    Time,
    Depth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisResponse {
    engine: &'static str,
    elapsed_ms: u64,
    lines: Vec<AnalysisLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    guest_quota: Option<GuestQuotaDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuestQuotaDto {
    limit: u32,
    remaining: u32,
    resets_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisLine {
    depth: Option<u32>,
    score_cp: Option<i32>,
    mate: Option<i32>,
    nps: Option<u64>,
    time_ms: Option<u64>,
    multipv: u32,
    notation: Vec<String>,
    pv: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionDto {
    plan: String,
    status: String,
    source: String,
    starts_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
    cloud_analysis_quota: u32,
    cloud_analysis_used: u32,
}

#[derive(Debug, Deserialize)]
struct RedeemCodeRequest {
    code: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
    iat: usize,
    #[serde(default, rename = "tokenType")]
    token_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PullQuery {
    cursor: Option<u64>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MasterLibraryQuery {
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelatedMasterGamesRequest {
    topic_id: String,
    fens: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterPlayerDto {
    id: String,
    name: String,
    source_site: String,
    source_player_id: String,
    profile_url: String,
    game_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterLibraryStatsDto {
    total_players: u64,
    total_games: u64,
    matched_players: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterGameSummaryDto {
    id: String,
    title: String,
    red_player: String,
    black_player: String,
    master_side: Option<String>,
    event_name: Option<String>,
    game_date: Option<String>,
    result: String,
    move_count: u64,
    source_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterGameDetailDto {
    id: String,
    title: String,
    red_player: String,
    black_player: String,
    master_side: Option<String>,
    event_name: Option<String>,
    game_date: Option<String>,
    result: String,
    move_count: u64,
    source_url: String,
    moves: Vec<String>,
    pgn: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelatedMasterGameDto {
    id: String,
    title: String,
    red_player: String,
    black_player: String,
    master_side: Option<String>,
    event_name: Option<String>,
    game_date: Option<String>,
    result: String,
    move_count: u64,
    source_url: String,
    match_kind: String,
    matched_ply: u64,
    matched_fen: String,
    divergence_move: Option<String>,
    match_label: String,
}

#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("analysis service is busy")]
    EngineBusy,
    #[error("analysis service is unavailable")]
    EngineUnavailable,
    #[error("analysis timed out")]
    EngineTimeout,
    #[error("Pro membership is required for cloud analysis")]
    ProRequired,
    #[error("cloud analysis quota has been used for this period")]
    QuotaExceeded,
    #[error("rate_limited")]
    RateLimited,
    #[error("guest_quota_exceeded")]
    GuestQuotaExceeded,
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Self::Database(error) = &self {
            tracing::error!(%error, "database request failed");
        }
        let status = match &self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::EngineBusy => StatusCode::TOO_MANY_REQUESTS,
            Self::EngineUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::EngineTimeout => StatusCode::GATEWAY_TIMEOUT,
            Self::ProRequired => StatusCode::PAYMENT_REQUIRED,
            Self::QuotaExceeded | Self::RateLimited | Self::GuestQuotaExceeded => StatusCode::TOO_MANY_REQUESTS,
            Self::Database(_) | Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            // Development builds expose the SQLx cause to make local setup failures actionable.
            // Release builds retain the generic response used in production.
            Self::Database(error) if cfg!(debug_assertions) => format!("database error: {error}"),
            _ => self.to_string(),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let jwt_secret = env::var("JWT_SECRET").context("JWT_SECRET is required")?;
    let bind = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let engine = EngineConfig {
        path: env::var_os("PIKAFISH_PATH").map(PathBuf::from),
        threads: env_value("ENGINE_THREADS", 2).clamp(1, 64),
        hash_mb: env_value("ENGINE_HASH_MB", 256).clamp(16, 4096),
        timeout: StdDuration::from_millis(env_value("ENGINE_TIMEOUT_MS", 12_000)),
    };
    let max_concurrent = env_value("ENGINE_MAX_CONCURRENT", 2usize).clamp(1, 32);
    let guest_token_ttl_minutes = env_value("GUEST_TOKEN_TTL_MINUTES", 120u64).clamp(5, 24 * 60);
    let pool = MySqlPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
        .execute(&pool)
        .await?;
    let app = router(
        AppState {
            pool,
            jwt_secret,
            guest_analysis_enabled: env_value("GUEST_ANALYSIS_ENABLED", cfg!(debug_assertions)),
            guest_token_ttl: StdDuration::from_secs(guest_token_ttl_minutes * 60),
            guest_daily_analysis_limit: env_value("GUEST_DAILY_ANALYSIS_LIMIT", 30u32).clamp(1, 10_000),
            guest_token_ip_daily_limit: env_value("GUEST_TOKEN_IP_DAILY_LIMIT", 20u32).clamp(1, 10_000),
            analysis_ip_per_minute_limit: env_value("ANALYSIS_IP_PER_MINUTE_LIMIT", 10u32).clamp(1, 10_000),
            user_analysis_per_minute_limit: env_value("USER_ANALYSIS_PER_MINUTE_LIMIT", 30u32).clamp(1, 10_000),
            engine,
            engine_slots: Arc::new(Semaphore::new(max_concurrent)),
        },
        cors_layer()?,
    );
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "xiangqi sync server listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn router(state: AppState, cors: CorsLayer) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(Health { status: "ok" }) }))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/guest", post(guest_auth))
        .route("/api/v1/sync/push", post(push))
        .route("/api/v1/sync/pull", get(pull))
        .route("/api/v1/subscription", get(subscription))
        .route("/api/v1/subscription/redeem", post(redeem_code))
        .route("/api/v1/analysis", post(analyze))
        .route("/api/v1/master/players", get(list_master_players))
        .route("/api/v1/master/stats", get(master_library_stats))
        .route(
            "/api/v1/master/players/{player_id}/games",
            get(list_master_player_games),
        )
        .route("/api/v1/master/related-games", post(find_related_master_games))
        .route("/api/v1/master/games/{game_id}", get(master_game_detail))
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

fn env_value<T>(name: &str, default: T) -> T
where
    T: std::str::FromStr,
{
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn cors_layer() -> anyhow::Result<CorsLayer> {
    let configured = env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://127.0.0.1:1420,http://localhost:1420".into());
    let origins: Vec<HeaderValue> = configured
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(allowed_origin)
        .collect::<Result<_, _>>()?;
    Ok(CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]))
}

async fn guest_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<GuestAuthResponse>, ApiError> {
    if !state.guest_analysis_enabled {
        return Err(ApiError::Unauthorized);
    }
    let now = Utc::now();
    let ip_subject = request_ip_subject(&headers);
    consume_rate_limit(
        &state.pool,
        "guest_token_ip_day",
        &ip_subject,
        day_window_start(now),
        state.guest_token_ip_daily_limit,
        ApiError::RateLimited,
    )
    .await?;
    let subject = Uuid::new_v4().to_string();
    let expires_at = now + Duration::from_std(state.guest_token_ttl).map_err(|_| ApiError::Internal)?;
    let resets_at = day_window_start(now) + Duration::days(1);
    Ok(Json(GuestAuthResponse {
        token: create_guest_token(&subject, expires_at, &state.jwt_secret)?,
        token_type: "guest",
        expires_at,
        guest_quota_limit: state.guest_daily_analysis_limit,
        guest_quota_remaining: state.guest_daily_analysis_limit,
        guest_quota_resets_at: resets_at,
    }))
}

fn allowed_origin(value: &str) -> anyhow::Result<HeaderValue> {
    let uri: Uri = value
        .parse()
        .with_context(|| format!("invalid ALLOWED_ORIGINS entry: {value}"))?;
    let scheme = uri
        .scheme_str()
        .ok_or_else(|| anyhow::anyhow!("origin is missing a scheme: {value}"))?;
    let host = uri
        .host()
        .ok_or_else(|| anyhow::anyhow!("origin is missing a host: {value}"))?;
    let local_http = scheme == "http" && matches!(host, "localhost" | "127.0.0.1" | "::1");
    if scheme != "https" && !local_http {
        anyhow::bail!("non-local ALLOWED_ORIGINS entries must use HTTPS: {value}");
    }
    if uri
        .path_and_query()
        .is_some_and(|value| value.as_str() != "/")
    {
        anyhow::bail!("ALLOWED_ORIGINS entries must not include a path: {value}");
    }
    value
        .parse()
        .with_context(|| format!("invalid ALLOWED_ORIGINS header value: {value}"))
}

async fn register(
    State(state): State<AppState>,
    Json(credentials): Json<Credentials>,
) -> Result<Json<AuthResponse>, ApiError> {
    validate_credentials(&credentials)?;
    let user_id = Uuid::new_v4();
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(credentials.password.as_bytes(), &salt)
        .map_err(|_| ApiError::Internal)?
        .to_string();
    let result = sqlx::query("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
        .bind(user_id.to_string())
        .bind(credentials.email.trim().to_lowercase())
        .bind(password_hash)
        .execute(&state.pool)
        .await;
    match result {
        Ok(_) => {
            if let Err(error) =
                record_product_event_for_pool(&state.pool, user_id, "registered").await
            {
                tracing::warn!(%error, "failed to record registration event");
            }
            Ok(Json(AuthResponse {
                user_id,
                token: create_token(user_id, &state.jwt_secret)?,
            }))
        }
        Err(sqlx::Error::Database(error))
            if error.is_unique_violation() || error.code().as_deref() == Some("1062") =>
        {
            Err(ApiError::Conflict("email already registered".into()))
        }
        Err(error) => Err(ApiError::Database(error)),
    }
}

async fn login(
    State(state): State<AppState>,
    Json(credentials): Json<Credentials>,
) -> Result<Json<AuthResponse>, ApiError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, password_hash FROM users WHERE email = ? AND deleted_at IS NULL",
    )
    .bind(credentials.email.trim().to_lowercase())
    .fetch_optional(&state.pool)
    .await?;
    let (user_id, password_hash) = row.ok_or(ApiError::Unauthorized)?;
    let parsed = PasswordHash::new(&password_hash).map_err(|_| ApiError::Internal)?;
    Argon2::default()
        .verify_password(credentials.password.as_bytes(), &parsed)
        .map_err(|_| ApiError::Unauthorized)?;
    let user_id = Uuid::parse_str(&user_id).map_err(|_| ApiError::Internal)?;
    Ok(Json(AuthResponse {
        user_id,
        token: create_token(user_id, &state.jwt_secret)?,
    }))
}

async fn push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    if request.operations.len() > 500 {
        return Err(ApiError::Invalid("at most 500 operations per push".into()));
    }
    let mut transaction = state.pool.begin().await?;
    let mut accepted = Vec::with_capacity(request.operations.len());
    for operation in &request.operations {
        persist_operation(&mut transaction, user_id, operation).await?;
        accepted.push(operation.op_id);
    }
    let cursor: i64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(MAX(sequence_id), 0) AS SIGNED) FROM operations WHERE user_id = ?",
    )
    .bind(user_id.to_string())
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(PushResponse {
        accepted,
        cursor: cursor as u64,
    }))
}

async fn pull(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    let cursor = query.cursor.unwrap_or(0);
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    type OperationRow = (
        u64,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        u64,
        chrono::DateTime<Utc>,
    );
    let rows: Vec<OperationRow> = sqlx::query_as(
        "SELECT sequence_id, op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at
         FROM operations WHERE user_id = ? AND sequence_id > ? ORDER BY sequence_id LIMIT ?",
    ).bind(user_id.to_string()).bind(cursor as i64).bind(limit).fetch_all(&state.pool).await?;
    let mut operations = Vec::with_capacity(rows.len());
    for (sequence, op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at) in rows
    {
        operations.push(SequencedOperation {
            sequence,
            operation: Operation {
                op_id: parse_uuid(op_id)?,
                device_id: parse_uuid(device_id)?,
                entity_id: parse_uuid(entity_id)?,
                game_id: parse_uuid(game_id)?,
                kind: serde_json::from_value(serde_json::Value::String(kind))
                    .map_err(|_| ApiError::Internal)?,
                payload,
                lamport,
                created_at,
            },
        });
    }
    let next_cursor = operations
        .last()
        .map(|item| item.sequence)
        .unwrap_or(cursor);
    Ok(Json(PullResponse {
        operations,
        cursor: next_cursor,
    }))
}

async fn list_master_players(
    State(state): State<AppState>,
    Query(query): Query<MasterLibraryQuery>,
) -> Result<Json<Vec<MasterPlayerDto>>, ApiError> {
    let search = normalized_search_term(query.query.as_deref());
    let like = sql_like_term(&search);
    let limit = query.limit.unwrap_or(50).clamp(1, 100) as i64;
    let offset = query.offset.unwrap_or(0).min(10_000) as i64;
    type Row = (String, String, String, String, String, i64);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT p.id, p.name, p.source_site, p.source_player_id, p.profile_url,
                CAST(COUNT(r.game_id) AS SIGNED) AS game_count
         FROM master_players p
         LEFT JOIN master_game_player_refs r ON r.master_player_id = p.id
         WHERE (? = '' OR p.name LIKE ? OR p.normalized_name LIKE ? OR p.source_player_id LIKE ?)
         GROUP BY p.id, p.name, p.source_site, p.source_player_id, p.profile_url
         ORDER BY game_count DESC, p.name ASC
         LIMIT ? OFFSET ?",
    )
    .bind(&search)
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(id, name, source_site, source_player_id, profile_url, game_count)| {
                    MasterPlayerDto {
                        id,
                        name,
                        source_site,
                        source_player_id,
                        profile_url,
                        game_count: game_count.max(0) as u64,
                    }
                },
            )
            .collect(),
    ))
}

async fn master_library_stats(
    State(state): State<AppState>,
    Query(query): Query<MasterLibraryQuery>,
) -> Result<Json<MasterLibraryStatsDto>, ApiError> {
    let search = normalized_search_term(query.query.as_deref());
    let like = sql_like_term(&search);
    let total_players: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM master_players")
        .fetch_one(&state.pool)
        .await?;
    let total_games: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM master_games")
        .fetch_one(&state.pool)
        .await?;
    let matched_players: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM master_players
         WHERE (? = '' OR name LIKE ? OR normalized_name LIKE ? OR source_player_id LIKE ?)",
    )
    .bind(&search)
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(MasterLibraryStatsDto {
        total_players: total_players.max(0) as u64,
        total_games: total_games.max(0) as u64,
        matched_players: matched_players.max(0) as u64,
    }))
}

async fn list_master_player_games(
    State(state): State<AppState>,
    AxumPath(player_id): AxumPath<String>,
    Query(query): Query<MasterLibraryQuery>,
) -> Result<Json<Vec<MasterGameSummaryDto>>, ApiError> {
    let search = normalized_search_term(query.query.as_deref());
    let like = sql_like_term(&search);
    let limit = query.limit.unwrap_or(50).clamp(1, 100) as i64;
    let offset = query.offset.unwrap_or(0).min(10_000) as i64;
    type Row = (
        String,
        String,
        String,
        String,
        String,
        Option<chrono::NaiveDate>,
        Option<String>,
        String,
        i64,
        String,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT g.id, g.title, g.red_player, g.black_player, r.side,
                g.game_date, g.event_name, g.result,
                CAST(g.move_count AS SIGNED) AS move_count, g.source_url
         FROM master_game_player_refs r
         INNER JOIN master_games g ON g.id = r.game_id
         WHERE r.master_player_id = ?
           AND (? = '' OR g.title LIKE ? OR g.red_player LIKE ? OR g.black_player LIKE ? OR g.event_name LIKE ?)
         ORDER BY g.game_date DESC, g.created_at DESC, g.id DESC
         LIMIT ? OFFSET ?",
    )
    .bind(player_id)
    .bind(&search)
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(
                    id,
                    title,
                    red_player,
                    black_player,
                    master_side,
                    game_date,
                    event_name,
                    result,
                    move_count,
                    source_url,
                )| MasterGameSummaryDto {
                    id,
                    title,
                    red_player,
                    black_player,
                    master_side: Some(master_side),
                    event_name,
                    game_date: game_date.map(|value| value.to_string()),
                    result,
                    move_count: move_count.max(0) as u64,
                    source_url,
                },
            )
            .collect(),
    ))
}

async fn find_related_master_games(
    State(state): State<AppState>,
    Json(request): Json<RelatedMasterGamesRequest>,
) -> Result<Json<Vec<RelatedMasterGameDto>>, ApiError> {
    let fens: Vec<_> = request
        .fens
        .into_iter()
        .map(|fen| fen.trim().to_owned())
        .filter(|fen| !fen.is_empty() && fen.len() <= 255)
        .take(12)
        .collect();
    if fens.is_empty() {
        return Err(ApiError::Invalid("at least one legal checkpoint FEN is required".into()));
    }

    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<chrono::NaiveDate>,
        String,
        i64,
        String,
        i64,
        String,
        String,
    );
    let mut matches: std::collections::BTreeMap<String, RelatedMasterGameDto> =
        std::collections::BTreeMap::new();
    for fen in &fens {
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT g.id, g.title, g.red_player, g.black_player, g.event_name, g.game_date,
                    g.result, CAST(g.move_count AS SIGNED) AS move_count, g.source_url,
                    CAST(m.ply AS SIGNED) AS matched_ply, m.before_fen, m.move_iccs
             FROM master_game_moves m
             INNER JOIN master_games g ON g.id = m.game_id
             WHERE m.before_fen = ?
             ORDER BY g.game_date DESC, g.created_at DESC, g.id DESC
             LIMIT 30",
        )
        .bind(fen)
        .fetch_all(&state.pool)
        .await?;
        for (id, title, red_player, black_player, event_name, game_date, result, move_count, source_url, matched_ply, matched_fen, divergence_move) in rows {
            let is_source_game = request.topic_id == "book-game-53-hong-zhi-huang-shiqing"
                && red_player.contains("洪智")
                && black_player.contains("黄仕清")
                && event_name.as_deref().unwrap_or_default().contains("1998");
            let match_kind = if is_source_game { "exact" } else { "position" };
            let label = if is_source_game {
                "原局候选：双方、赛事与书页专题一致"
            } else {
                "同型参考：命中书页专题的关键局面"
            };
            let item = RelatedMasterGameDto {
                id: id.clone(),
                title,
                red_player,
                black_player,
                master_side: None,
                event_name,
                game_date: game_date.map(|value| value.to_string()),
                result,
                move_count: move_count.max(0) as u64,
                source_url,
                match_kind: match_kind.into(),
                matched_ply: matched_ply.max(0) as u64,
                matched_fen,
                divergence_move: Some(divergence_move),
                match_label: label.into(),
            };
            matches
                .entry(id)
                .and_modify(|current| {
                    if item.match_kind == "exact" || item.matched_ply > current.matched_ply {
                        *current = item.clone();
                    }
                })
                .or_insert(item);
        }
    }
    let mut result: Vec<_> = matches.into_values().collect();
    result.sort_by(|left, right| {
        right
            .match_kind
            .eq("exact")
            .cmp(&left.match_kind.eq("exact"))
            .then_with(|| right.matched_ply.cmp(&left.matched_ply))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(Json(result))
}

async fn master_game_detail(
    State(state): State<AppState>,
    AxumPath(game_id): AxumPath<String>,
) -> Result<Json<MasterGameDetailDto>, ApiError> {
    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<chrono::NaiveDate>,
        String,
        i64,
        String,
        serde_json::Value,
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT id, title, red_player, black_player, event_name, game_date, result,
                CAST(move_count AS SIGNED) AS move_count, source_url, moves_json
         FROM master_games
         WHERE id = ?",
    )
    .bind(&game_id)
    .fetch_optional(&state.pool)
    .await?;
    let (
        id,
        title,
        red_player,
        black_player,
        event_name,
        game_date,
        result,
        move_count,
        source_url,
        moves_json,
    ) = row.ok_or_else(|| ApiError::Invalid("master game not found".into()))?;
    let moves: Vec<String> = serde_json::from_value(moves_json)
        .map_err(|_| ApiError::Invalid("master game has invalid move list".into()))?;
    let game_date = game_date.map(|value| value.to_string());
    let pgn = build_master_game_pgn(MasterGamePgn {
        title: &title,
        event_name: event_name.as_deref(),
        site: &source_url,
        game_date: game_date.as_deref(),
        red_player: &red_player,
        black_player: &black_player,
        result: &result,
        moves: &moves,
    });
    Ok(Json(MasterGameDetailDto {
        id,
        title,
        red_player,
        black_player,
        master_side: None,
        event_name,
        game_date,
        result,
        move_count: move_count.max(0) as u64,
        source_url,
        moves,
        pgn,
    }))
}

fn normalized_search_term(value: Option<&str>) -> String {
    value.unwrap_or_default().trim().chars().take(80).collect()
}

fn sql_like_term(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

struct MasterGamePgn<'a> {
    title: &'a str,
    event_name: Option<&'a str>,
    site: &'a str,
    game_date: Option<&'a str>,
    red_player: &'a str,
    black_player: &'a str,
    result: &'a str,
    moves: &'a [String],
}

fn build_master_game_pgn(game: MasterGamePgn<'_>) -> String {
    let result = nonempty(game.result, "*");
    let date = game
        .game_date
        .map(|value| value.replace('-', "."))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "????.??.??".into());
    let mut output = String::new();
    for (name, value) in [
        ("Game", "Chinese Chess"),
        ("Title", game.title),
        (
            "Event",
            nonempty(game.event_name.unwrap_or_default(), "公开大师棋谱"),
        ),
        ("Site", game.site),
        ("Date", &date),
        ("Red", game.red_player),
        ("Black", game.black_player),
        ("Result", result),
        ("Format", "ICCS"),
    ] {
        output.push_str(&format!("[{name} \"{}\"]\n", escape_pgn_tag(value)));
    }
    output.push('\n');
    for (index, pair) in game.moves.chunks(2).enumerate() {
        output.push_str(&format!("{}. {}", index + 1, pair[0]));
        if let Some(black) = pair.get(1) {
            output.push(' ');
            output.push_str(black);
        }
        output.push(' ');
    }
    output.push_str(result);
    output.push('\n');
    output
}

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn escape_pgn_tag(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

async fn subscription(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SubscriptionDto>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    Ok(Json(load_subscription(&state.pool, user_id).await?))
}

async fn redeem_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RedeemCodeRequest>,
) -> Result<Json<SubscriptionDto>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    let code = normalized_redemption_code(&request.code);
    if !(6..=64).contains(&code.len()) {
        return Err(ApiError::Invalid("valid redemption code required".into()));
    }
    let hash = redemption_code_hash(&code);
    let now = Utc::now();
    let mut transaction = state.pool.begin().await?;
    type CodeRow = (
        String,
        String,
        u32,
        u32,
        u32,
        u32,
        chrono::DateTime<Utc>,
        chrono::DateTime<Utc>,
    );
    let code_row: Option<CodeRow> = sqlx::query_as(
        "SELECT id, plan, duration_days, cloud_analysis_quota, redemption_count, max_redemptions, starts_at, expires_at
         FROM redemption_codes WHERE code_hash = ? AND revoked_at IS NULL FOR UPDATE",
    )
    .bind(hash)
    .fetch_optional(&mut *transaction)
    .await?;
    let (
        code_id,
        plan,
        duration_days,
        quota,
        redemption_count,
        max_redemptions,
        starts_at,
        expires_at,
    ) = code_row.ok_or_else(|| ApiError::Invalid("redemption code is unavailable".into()))?;
    if now < starts_at || now >= expires_at || redemption_count >= max_redemptions {
        return Err(ApiError::Invalid("redemption code is unavailable".into()));
    }
    let redeemed =
        sqlx::query("INSERT IGNORE INTO code_redemptions (code_id, user_id) VALUES (?, ?)")
            .bind(&code_id)
            .bind(user_id.to_string())
            .execute(&mut *transaction)
            .await?;
    if redeemed.rows_affected() == 0 {
        return Err(ApiError::Conflict(
            "this code has already been redeemed".into(),
        ));
    }
    sqlx::query("UPDATE redemption_codes SET redemption_count = redemption_count + 1 WHERE id = ?")
        .bind(&code_id)
        .execute(&mut *transaction)
        .await?;
    let existing_expiry: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT expires_at FROM subscription_entitlements WHERE user_id = ? FOR UPDATE",
    )
    .bind(user_id.to_string())
    .fetch_optional(&mut *transaction)
    .await?;
    let starts_at = existing_expiry.filter(|value| *value > now).unwrap_or(now);
    let expires_at = starts_at + Duration::days(i64::from(duration_days));
    sqlx::query(
        "INSERT INTO subscription_entitlements
         (user_id, plan, status, source, starts_at, expires_at, cloud_analysis_quota, cloud_analysis_used, usage_period_started_at)
         VALUES (?, ?, 'active', 'redemption_code', ?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE plan=VALUES(plan), status='active', source='redemption_code', starts_at=VALUES(starts_at),
           expires_at=VALUES(expires_at), cloud_analysis_quota=VALUES(cloud_analysis_quota), cloud_analysis_used=0,
           usage_period_started_at=VALUES(usage_period_started_at)",
    )
    .bind(user_id.to_string())
    .bind(plan)
    .bind(starts_at)
    .bind(expires_at)
    .bind(quota)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    record_product_event(&mut transaction, user_id, "subscription_redeemed").await?;
    transaction.commit().await?;
    Ok(Json(load_subscription(&state.pool, user_id).await?))
}

fn normalized_redemption_code(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

fn redemption_code_hash(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.as_bytes()))
}

async fn load_subscription(pool: &MySqlPool, user_id: Uuid) -> Result<SubscriptionDto, ApiError> {
    type EntitlementRow = (
        String,
        String,
        String,
        chrono::DateTime<Utc>,
        chrono::DateTime<Utc>,
        u32,
        u32,
    );
    let row: Option<EntitlementRow> = sqlx::query_as(
        "SELECT plan, status, source, starts_at, expires_at, cloud_analysis_quota, cloud_analysis_used
         FROM subscription_entitlements WHERE user_id = ?",
    )
    .bind(user_id.to_string())
    .fetch_optional(pool)
    .await?;
    let now = Utc::now();
    Ok(match row {
        Some((plan, status, source, starts_at, expires_at, quota, used))
            if status == "active" && expires_at > now =>
        {
            SubscriptionDto {
                plan,
                status,
                source,
                starts_at,
                expires_at,
                cloud_analysis_quota: quota,
                cloud_analysis_used: used,
            }
        }
        _ => SubscriptionDto {
            plan: "free".into(),
            status: "inactive".into(),
            source: "none".into(),
            starts_at: now,
            expires_at: now,
            cloud_analysis_quota: 0,
            cloud_analysis_used: 0,
        },
    })
}

async fn reserve_cloud_analysis(pool: &MySqlPool, user_id: Uuid) -> Result<(), ApiError> {
    let now = Utc::now();
    sqlx::query(
        "UPDATE subscription_entitlements SET cloud_analysis_used = 0, usage_period_started_at = ?
         WHERE user_id = ? AND usage_period_started_at < DATE_SUB(?, INTERVAL 30 DAY)",
    )
    .bind(now)
    .bind(user_id.to_string())
    .bind(now)
    .execute(pool)
    .await?;
    let reserved = sqlx::query(
        "UPDATE subscription_entitlements SET cloud_analysis_used = cloud_analysis_used + 1
         WHERE user_id = ? AND plan = 'pro' AND status = 'active' AND expires_at > ?
           AND cloud_analysis_used < cloud_analysis_quota",
    )
    .bind(user_id.to_string())
    .bind(now)
    .execute(pool)
    .await?;
    if reserved.rows_affected() == 1 {
        return Ok(());
    }
    let membership = load_subscription(pool, user_id).await?;
    if membership.plan == "pro" {
        Err(ApiError::QuotaExceeded)
    } else {
        Err(ApiError::ProRequired)
    }
}

#[derive(Debug, Clone)]
struct RateLimitUsage {
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

async fn consume_rate_limit(
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

async fn release_rate_limit(
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

fn rate_limit_subject_hash(scope: &str, subject: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(scope.as_bytes());
    hasher.update(b":");
    hasher.update(subject.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn request_ip_subject(headers: &HeaderMap) -> String {
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

fn minute_window_start(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    chrono::DateTime::from_timestamp(now.timestamp() - now.timestamp().rem_euclid(60), 0)
        .unwrap_or(now)
}

fn day_window_start(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let timestamp = now.timestamp();
    chrono::DateTime::from_timestamp(timestamp - timestamp.rem_euclid(86_400), 0)
        .unwrap_or(now)
}

async fn release_cloud_analysis(pool: &MySqlPool, user_id: Uuid) {
    if let Err(error) = sqlx::query(
        "UPDATE subscription_entitlements SET cloud_analysis_used = cloud_analysis_used - 1
         WHERE user_id = ? AND cloud_analysis_used > 0",
    )
    .bind(user_id.to_string())
    .execute(pool)
    .await
    {
        tracing::error!(%error, %user_id, "failed to release reserved cloud analysis quota");
    }
}

async fn record_product_event_for_pool(
    pool: &MySqlPool,
    user_id: Uuid,
    event_name: &str,
) -> Result<(), ApiError> {
    let mut transaction = pool.begin().await?;
    record_product_event(&mut transaction, user_id, event_name).await?;
    transaction.commit().await?;
    Ok(())
}

async fn record_product_event(
    transaction: &mut Transaction<'_, MySql>,
    user_id: Uuid,
    event_name: &str,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO product_events (user_id, event_name) VALUES (?, ?)")
        .bind(user_id.to_string())
        .bind(event_name)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn analyze(
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
    let permit = state
        .engine_slots
        .clone()
        .try_acquire_owned();
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
    let result = tokio::time::timeout(timeout, run_analysis(&state.engine, &request, guest_quota)).await;
    drop(permit);
    match result {
        Ok(Ok(response)) => {
            if let AnalysisPrincipal::User(user_id) = principal {
                if let Err(error) = record_product_event_for_pool(&state.pool, user_id, "cloud_analysis_consumed").await {
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

fn validate_analysis_request(request: &AnalysisRequest) -> Result<(), ApiError> {
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

fn validate_guest_analysis_request(request: &AnalysisRequest) -> Result<(), ApiError> {
    if request.multi_pv > 2 {
        return Err(ApiError::Invalid("guest multiPv must be between 1 and 2".into()));
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

async fn release_analysis_reservation(
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

async fn run_analysis(
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

async fn persist_operation(
    transaction: &mut Transaction<'_, MySql>,
    user_id: Uuid,
    operation: &Operation,
) -> Result<(), ApiError> {
    validate_operation(operation)?;
    let kind = serde_json::to_value(operation.kind)
        .map_err(|_| ApiError::Internal)?
        .as_str()
        .ok_or(ApiError::Internal)?
        .to_owned();
    if matches!(operation.kind, OperationKind::CreateGame) {
        let payload: CreateGamePayload = serde_json::from_value(operation.payload.clone())
            .map_err(|_| ApiError::Invalid("invalid create-game payload".into()))?;
        sqlx::query("INSERT IGNORE INTO games (id, owner_id, title) VALUES (?, ?, ?)")
            .bind(operation.game_id.to_string())
            .bind(user_id.to_string())
            .bind(payload.title)
            .execute(&mut **transaction)
            .await?;
    }
    let owns_game: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM games WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
    )
    .bind(operation.game_id.to_string())
    .bind(user_id.to_string())
    .fetch_one(&mut **transaction)
    .await?;
    if owns_game == 0 {
        return Err(ApiError::Invalid(
            "operation references an unavailable game".into(),
        ));
    }
    sqlx::query(
        "INSERT IGNORE INTO operations (op_id, user_id, device_id, entity_id, game_id, kind, payload, lamport, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(operation.op_id.to_string()).bind(user_id.to_string()).bind(operation.device_id.to_string())
        .bind(operation.entity_id.to_string()).bind(operation.game_id.to_string()).bind(kind).bind(&operation.payload)
        .bind(operation.lamport as i64).bind(operation.created_at).execute(&mut **transaction).await?;
    Ok(())
}

fn validate_operation(operation: &Operation) -> Result<(), ApiError> {
    let entity_matches = match operation.kind {
        OperationKind::CreateGame => {
            serde_json::from_value::<CreateGamePayload>(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid create-game payload".into()))?;
            operation.entity_id == operation.game_id
        }
        OperationKind::AddMove => {
            let payload: AddMovePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid add-move payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::UpdateComment => {
            let payload: UpdateCommentPayload =
                serde_json::from_value(operation.payload.clone())
                    .map_err(|_| ApiError::Invalid("invalid update-comment payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::UpdateGameMetadata => {
            serde_json::from_value::<UpdateGameMetadataPayload>(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid game-metadata payload".into()))?;
            operation.entity_id == operation.game_id
        }
        OperationKind::ReorderBranches => {
            let payload: ReorderBranchesPayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid branch-order payload".into()))?;
            payload.parent_id == operation.entity_id
        }
        OperationKind::SetMainline => {
            let payload: SetMainlinePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid set-mainline payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::DeleteNode => {
            let payload: DeleteNodePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid delete-node payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::Unknown => {
            return Err(ApiError::Invalid("unknown operation kind".into()));
        }
    };
    if !entity_matches {
        return Err(ApiError::Invalid(
            "operation entity does not match its payload".into(),
        ));
    }
    Ok(())
}

fn validate_credentials(credentials: &Credentials) -> Result<(), ApiError> {
    if !credentials.email.contains('@') {
        return Err(ApiError::Invalid("valid email required".into()));
    }
    if credentials.password.len() < 8 {
        return Err(ApiError::Invalid(
            "password must contain at least 8 characters".into(),
        ));
    }
    Ok(())
}

fn create_token(user_id: Uuid, secret: &str) -> Result<String, ApiError> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::days(30)).timestamp() as usize,
        token_type: Some("user".into()),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

fn create_guest_token(
    subject: &str,
    expires_at: chrono::DateTime<Utc>,
    secret: &str,
) -> Result<String, ApiError> {
    let now = Utc::now();
    let claims = Claims {
        sub: subject.to_owned(),
        iat: now.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
        token_type: Some("guest".into()),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

enum AnalysisPrincipal {
    User(Uuid),
    Guest { subject: String },
}

fn authenticated_user(headers: &HeaderMap, secret: &str) -> Result<Uuid, ApiError> {
    let token = decode_claims(headers, secret)?;
    if token.claims.token_type.as_deref().is_some_and(|value| value != "user") {
        return Err(ApiError::Unauthorized);
    }
    parse_uuid(token.claims.sub).map_err(|_| ApiError::Unauthorized)
}

fn analysis_principal(
    headers: &HeaderMap,
    secret: &str,
    guest_analysis_enabled: bool,
) -> Result<AnalysisPrincipal, ApiError> {
    let token = decode_claims(headers, secret)?;
    match token.claims.token_type.as_deref().unwrap_or("user") {
        "user" => parse_uuid(token.claims.sub).map(AnalysisPrincipal::User).map_err(|_| ApiError::Unauthorized),
        "guest" if guest_analysis_enabled => Ok(AnalysisPrincipal::Guest { subject: token.claims.sub }),
        _ => Err(ApiError::Unauthorized),
    }
}

fn decode_claims(
    headers: &HeaderMap,
    secret: &str,
) -> Result<jsonwebtoken::TokenData<Claims>, ApiError> {
    let value = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    decode::<Claims>(
        value,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized)
}

fn parse_uuid(value: String) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&value).map_err(|_| ApiError::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_round_trip_authenticates_the_user() {
        let user_id = Uuid::new_v4();
        let token = create_token(user_id, "test-secret").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        assert_eq!(
            authenticated_user(&headers, "test-secret").unwrap(),
            user_id
        );
        assert!(authenticated_user(&headers, "wrong-secret").is_err());
    }

    #[test]
    fn guest_analysis_is_only_allowed_when_enabled() {
        let empty_headers = HeaderMap::new();
        assert!(analysis_principal(&empty_headers, "test-secret", true).is_err());
        let token = create_guest_token(
            "guest-subject",
            Utc::now() + Duration::hours(2),
            "test-secret",
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        match analysis_principal(&headers, "test-secret", true).unwrap() {
            AnalysisPrincipal::Guest { subject } => assert_eq!(subject, "guest-subject"),
            AnalysisPrincipal::User(_) => panic!("guest token must not authenticate as a user"),
        }
        assert!(analysis_principal(&headers, "test-secret", false).is_err());
    }

    #[test]
    fn weak_credentials_are_rejected() {
        assert!(
            validate_credentials(&Credentials {
                email: "invalid".into(),
                password: "short".into()
            })
            .is_err()
        );
        assert!(
            validate_credentials(&Credentials {
                email: "user@example.com".into(),
                password: "1234567".into(),
            })
            .is_err()
        );
        assert!(
            validate_credentials(&Credentials {
                email: "user@example.com".into(),
                password: "12345678".into(),
            })
            .is_ok()
        );
    }

    #[test]
    fn redemption_codes_are_case_and_whitespace_insensitive_without_storing_plaintext() {
        let normalized = normalized_redemption_code("  pro-2026-alpha  ");
        assert_eq!(normalized, "PRO-2026-ALPHA");
        assert_eq!(
            redemption_code_hash(&normalized),
            "1d9009580e50ba1a70c96b25a6b1ad78d9c671786debf560ca63604444bc2655"
        );
    }

    #[test]
    fn analysis_limits_are_enforced() {
        let valid = AnalysisRequest {
            fen: xiangqi_core::STARTING_FEN.into(),
            mode: AnalysisMode::Time,
            value: 1_500,
            multi_pv: 3,
        };
        assert!(validate_analysis_request(&valid).is_ok());
        let invalid = AnalysisRequest {
            value: 10_000,
            multi_pv: 6,
            ..valid
        };
        assert!(validate_analysis_request(&invalid).is_err());
    }

    #[test]
    fn guest_analysis_limits_are_stricter_than_user_limits() {
        let valid_guest = AnalysisRequest {
            fen: xiangqi_core::STARTING_FEN.into(),
            mode: AnalysisMode::Depth,
            value: 20,
            multi_pv: 2,
        };
        assert!(validate_guest_analysis_request(&valid_guest).is_ok());
        assert!(validate_guest_analysis_request(&AnalysisRequest {
            value: 21,
            fen: valid_guest.fen.clone(),
            ..valid_guest
        }).is_err());
        assert!(validate_guest_analysis_request(&AnalysisRequest {
            multi_pv: 3,
            ..valid_guest
        }).is_err());
    }

    #[test]
    fn cors_requires_https_except_for_local_development() {
        assert!(allowed_origin("https://chess.example.com").is_ok());
        assert!(allowed_origin("http://127.0.0.1:1420").is_ok());
        assert!(allowed_origin("http://localhost:1420").is_ok());
        assert!(allowed_origin("http://chess.example.com").is_err());
        assert!(allowed_origin("https://chess.example.com/path").is_err());
    }

    #[test]
    fn master_public_library_schema_is_created_on_startup() {
        let schema = include_str!("../migrations/0001_initial.sql");
        for table in [
            "master_players",
            "master_games",
            "master_game_sources",
            "master_game_player_refs",
            "master_game_moves",
            "master_position_samples",
            "master_position_analysis",
            "user_master_game_favorites",
            "user_master_training_refs",
        ] {
            assert!(
                schema.contains(&format!("CREATE TABLE IF NOT EXISTS {table}")),
                "missing table {table}"
            );
        }
        for key in [
            "UNIQUE KEY uk_master_source_player (source_site, source_player_id)",
            "UNIQUE KEY uk_master_game_fingerprint (fingerprint)",
            "UNIQUE KEY uk_master_game_source_url (source_url)",
            "PRIMARY KEY (master_player_id, game_id)",
            "UNIQUE KEY uk_master_game_ply (game_id, ply)",
            "UNIQUE KEY uk_master_sample (master_player_id, game_id, ply)",
            "UNIQUE KEY uk_master_analysis_config (sample_id, engine_fingerprint, depth, multipv)",
            "PRIMARY KEY (user_id, master_game_id)",
        ] {
            assert!(schema.contains(key), "missing schema key {key}");
        }
        for foreign_key in [
            "CONSTRAINT fk_master_games_player",
            "CONSTRAINT fk_master_game_sources_game",
            "CONSTRAINT fk_mgpr_player",
            "CONSTRAINT fk_mgpr_game",
            "CONSTRAINT fk_master_moves_game",
            "CONSTRAINT fk_master_samples_player",
            "CONSTRAINT fk_master_samples_game",
            "CONSTRAINT fk_master_analysis_sample",
            "CONSTRAINT fk_umgf_user",
            "CONSTRAINT fk_umgf_game",
            "CONSTRAINT fk_umtr_user",
            "CONSTRAINT fk_umtr_sample",
        ] {
            assert!(
                schema.contains(foreign_key),
                "missing foreign key {foreign_key}"
            );
        }
    }

    #[test]
    fn master_game_pgn_uses_iccs_tags_and_move_pairs() {
        let pgn = build_master_game_pgn(MasterGamePgn {
            title: "赵鑫鑫 先胜 王天一",
            event_name: Some("测试赛"),
            site: "http://www.gdchess.com/gview.asp?id=1",
            game_date: Some("2026-08-05"),
            red_player: "赵鑫鑫",
            black_player: "王天一",
            result: "1-0",
            moves: &["c3c4".into(), "c6c5".into(), "h2e2".into()],
        });
        assert!(pgn.contains("[Format \"ICCS\"]"));
        assert!(pgn.contains("[Date \"2026.08.05\"]"));
        assert!(pgn.contains("[Red \"赵鑫鑫\"]"));
        assert!(pgn.contains("1. c3c4 c6c5 2. h2e2 1-0"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn analysis_collects_multi_pv_from_a_uci_engine() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!("xiangqi-fake-engine-{}", Uuid::new_v4()));
        std::fs::write(
            &path,
            r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    uci) echo "id name Testfish"; echo "uciok" ;;
    go*) echo "info depth 8 multipv 1 score cp 42 nodes 10 nps 1000 time 10 pv h2e2 h9g7"; echo "info depth 8 multipv 2 score cp 20 nodes 10 nps 1000 time 10 pv b2e2"; echo "bestmove h2e2" ;;
    quit) exit 0 ;;
  esac
done
"#,
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let config = EngineConfig {
            path: Some(path.clone()),
            threads: 2,
            hash_mb: 64,
            timeout: StdDuration::from_secs(2),
        };
        let request = AnalysisRequest {
            fen: xiangqi_core::STARTING_FEN.into(),
            mode: AnalysisMode::Depth,
            value: 8,
            multi_pv: 2,
        };
        let response = run_analysis(&config, &request, None).await.unwrap();
        assert_eq!(response.lines.len(), 2);
        assert_eq!(response.lines[0].score_cp, Some(42));
        assert_eq!(response.lines[0].notation, ["炮二平五", "马8进7"]);
        std::fs::remove_file(path).unwrap();
    }
}
