use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use password_hash::{SaltString, rand_core::OsRng};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::analysis::{consume_rate_limit, day_window_start, request_ip_subject};
use crate::error::ApiError;
use crate::state::AppState;
use crate::subscription::record_product_event_for_pool;

#[derive(Debug, Deserialize)]
pub(crate) struct Credentials {
    pub(crate) email: String,
    pub(crate) password: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AuthResponse {
    user_id: Uuid,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuestAuthResponse {
    token: String,
    token_type: &'static str,
    expires_at: chrono::DateTime<Utc>,
    guest_quota_limit: u32,
    guest_quota_remaining: u32,
    guest_quota_resets_at: chrono::DateTime<Utc>,
}
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Claims {
    sub: String,
    exp: usize,
    iat: usize,
    #[serde(default, rename = "tokenType")]
    token_type: Option<String>,
}
pub(crate) async fn guest_auth(
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
    let expires_at =
        now + Duration::from_std(state.guest_token_ttl).map_err(|_| ApiError::Internal)?;
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
pub(crate) async fn register(
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

pub(crate) async fn login(
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
pub(crate) fn validate_credentials(credentials: &Credentials) -> Result<(), ApiError> {
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

pub(crate) fn create_token(user_id: Uuid, secret: &str) -> Result<String, ApiError> {
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

pub(crate) fn create_guest_token(
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

pub(crate) enum AnalysisPrincipal {
    User(Uuid),
    Guest { subject: String },
}

pub(crate) fn authenticated_user(headers: &HeaderMap, secret: &str) -> Result<Uuid, ApiError> {
    let token = decode_claims(headers, secret)?;
    if token
        .claims
        .token_type
        .as_deref()
        .is_some_and(|value| value != "user")
    {
        return Err(ApiError::Unauthorized);
    }
    parse_uuid(token.claims.sub).map_err(|_| ApiError::Unauthorized)
}

pub(crate) fn analysis_principal(
    headers: &HeaderMap,
    secret: &str,
    guest_analysis_enabled: bool,
) -> Result<AnalysisPrincipal, ApiError> {
    let token = decode_claims(headers, secret)?;
    match token.claims.token_type.as_deref().unwrap_or("user") {
        "user" => parse_uuid(token.claims.sub)
            .map(AnalysisPrincipal::User)
            .map_err(|_| ApiError::Unauthorized),
        "guest" if guest_analysis_enabled => Ok(AnalysisPrincipal::Guest {
            subject: token.claims.sub,
        }),
        _ => Err(ApiError::Unauthorized),
    }
}

pub(crate) fn decode_claims(
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

pub(crate) fn parse_uuid(value: String) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&value).map_err(|_| ApiError::Internal)
}
