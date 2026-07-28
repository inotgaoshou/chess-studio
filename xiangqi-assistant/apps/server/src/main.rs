use std::env;

use anyhow::Context;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use password_hash::{SaltString, rand_core::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::{MySql, MySqlPool, Transaction, mysql::MySqlPoolOptions};
use sync_protocol::{Operation, PullResponse, PushRequest, PushResponse, SequencedOperation};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: MySqlPool,
    jwt_secret: String,
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

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
    iat: usize,
}

#[derive(Debug, Deserialize)]
struct PullQuery {
    cursor: Option<u64>,
    limit: Option<u32>,
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
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Database(_) | Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(serde_json::json!({ "error": self.to_string() })),
        )
            .into_response()
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
    let pool = MySqlPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
        .execute(&pool)
        .await?;
    let app = router(AppState { pool, jwt_secret });
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "xiangqi sync server listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(Health { status: "ok" }) }))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/sync/push", post(push))
        .route("/api/v1/sync/pull", get(pull))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
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
        Ok(_) => Ok(Json(AuthResponse {
            user_id,
            token: create_token(user_id, &state.jwt_secret)?,
        })),
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
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
        "SELECT COALESCE(MAX(sequence_id), 0) FROM operations WHERE user_id = ?",
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
        i64,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        i64,
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
            sequence: sequence as u64,
            operation: Operation {
                op_id: parse_uuid(op_id)?,
                device_id: parse_uuid(device_id)?,
                entity_id: parse_uuid(entity_id)?,
                game_id: parse_uuid(game_id)?,
                kind: serde_json::from_value(serde_json::Value::String(kind))
                    .map_err(|_| ApiError::Internal)?,
                payload,
                lamport: lamport as u64,
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

async fn persist_operation(
    transaction: &mut Transaction<'_, MySql>,
    user_id: Uuid,
    operation: &Operation,
) -> Result<(), ApiError> {
    let kind = serde_json::to_value(operation.kind)
        .map_err(|_| ApiError::Internal)?
        .as_str()
        .ok_or(ApiError::Internal)?
        .to_owned();
    if matches!(operation.kind, sync_protocol::OperationKind::CreateGame) {
        let title = operation
            .payload
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Untitled");
        sqlx::query("INSERT IGNORE INTO games (id, owner_id, title) VALUES (?, ?, ?)")
            .bind(operation.game_id.to_string())
            .bind(user_id.to_string())
            .bind(title)
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

fn validate_credentials(credentials: &Credentials) -> Result<(), ApiError> {
    if !credentials.email.contains('@') {
        return Err(ApiError::Invalid("valid email required".into()));
    }
    if credentials.password.len() < 10 {
        return Err(ApiError::Invalid(
            "password must contain at least 10 characters".into(),
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
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

fn authenticated_user(headers: &HeaderMap, secret: &str) -> Result<Uuid, ApiError> {
    let value = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    let token = decode::<Claims>(
        value,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized)?;
    parse_uuid(token.claims.sub).map_err(|_| ApiError::Unauthorized)
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
    fn weak_credentials_are_rejected() {
        assert!(
            validate_credentials(&Credentials {
                email: "invalid".into(),
                password: "short".into()
            })
            .is_err()
        );
    }
}
