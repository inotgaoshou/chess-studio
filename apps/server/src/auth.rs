use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Duration, Utc};
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
    pub(crate) email: Option<String>,
    pub(crate) account: Option<String>,
    pub(crate) password: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AuthResponse {
    user_id: Uuid,
    token: String,
    #[serde(rename = "expiresAt")]
    expires_at: chrono::DateTime<Utc>,
    user: AuthUser,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthUser {
    id: Uuid,
    login_name: String,
    email: String,
    display_name: String,
    role: String,
    #[serde(rename = "orgId")]
    org_id: Option<Uuid>,
    #[serde(rename = "orgName")]
    org_name: Option<String>,
    organizations: Vec<AuthOrganization>,
    #[serde(rename = "isPlatformAdmin")]
    is_platform_admin: bool,
    vip_enabled: bool,
    vip_expires_at: Option<DateTime<Utc>>,
    vip_active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthOrganization {
    id: Uuid,
    name: String,
    role: String,
    is_default: bool,
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
    pub(crate) sub: String,
    exp: usize,
    iat: usize,
    #[serde(default, rename = "tokenType")]
    pub(crate) token_type: Option<String>,
    #[serde(default, rename = "orgId")]
    pub(crate) org_id: Option<String>,
    #[serde(default)]
    pub(crate) role: Option<String>,
    #[serde(default, rename = "authVersion")]
    pub(crate) auth_version: u32,
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
    let email = normalized_email(credentials.email.as_deref())?;
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(credentials.password.as_bytes(), &salt)
        .map_err(|_| ApiError::Internal)?
        .to_string();
    let login_name = email.clone();
    let display_name = default_login_name(&email);
    let result = sqlx::query(
        "INSERT INTO users (id, email, login_name, display_name, role, password_hash) VALUES (?, ?, ?, ?, 'user', ?)",
    )
    .bind(user_id.to_string())
    .bind(&email)
    .bind(&login_name)
    .bind(&display_name)
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
            Ok(Json(auth_response(
                AuthUser {
                    id: user_id,
                    login_name,
                    email,
                    display_name,
                    role: "user".into(),
                    org_id: None,
                    org_name: None,
                    organizations: Vec::new(),
                    is_platform_admin: false,
                    vip_enabled: false,
                    vip_expires_at: None,
                    vip_active: false,
                },
                1,
                &state.jwt_secret,
            )?))
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
    let account = normalized_account(&credentials)?;
    let row: Option<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        i8,
        u32,
        i8,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(
        "SELECT user.id, user.email, user.password_hash, user.login_name, user.display_name,
                CASE WHEN user.is_platform_admin=1 THEN 'admin' ELSE COALESCE(membership.role,user.role) END,
                membership.org_id, org.name,
                user.is_platform_admin, user.auth_version, user.vip_enabled, user.vip_expires_at
         FROM users user
         LEFT JOIN user_organization_memberships membership
           ON membership.user_id=user.id AND membership.is_default=1
         LEFT JOIN organizations org ON org.id=membership.org_id
         WHERE user.deleted_at IS NULL AND (user.email = ? OR user.login_name = ?)
         LIMIT 1",
    )
    .bind(&account)
    .bind(&account)
    .fetch_optional(&state.pool)
    .await?;
    let (
        user_id,
        email,
        password_hash,
        login_name,
        display_name,
        role,
        org_id,
        org_name,
        is_platform_admin,
        auth_version,
        vip_enabled,
        vip_expires_at,
    ) = row.ok_or(ApiError::Unauthorized)?;
    let parsed = PasswordHash::new(&password_hash).map_err(|_| ApiError::Internal)?;
    Argon2::default()
        .verify_password(credentials.password.as_bytes(), &parsed)
        .map_err(|_| ApiError::Unauthorized)?;
    let user_id = Uuid::parse_str(&user_id).map_err(|_| ApiError::Internal)?;
    let org_id = org_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| ApiError::Internal)?;
    Ok(Json(auth_response(
        AuthUser {
            id: user_id,
            login_name: login_name.unwrap_or_else(|| default_login_name(&email)),
            email,
            display_name: display_name.unwrap_or_else(|| default_login_name(&account)),
            role,
            org_id,
            org_name,
            organizations: load_organizations(&state.pool, user_id).await?,
            is_platform_admin: is_platform_admin != 0,
            vip_enabled: vip_enabled != 0,
            vip_expires_at,
            vip_active: is_vip_active(vip_enabled, vip_expires_at),
        },
        auth_version,
        &state.jwt_secret,
    )?))
}
pub(crate) fn validate_credentials(credentials: &Credentials) -> Result<(), ApiError> {
    normalized_email(credentials.email.as_deref())?;
    if credentials.password.len() < 8 {
        return Err(ApiError::Invalid(
            "password must contain at least 8 characters".into(),
        ));
    }
    Ok(())
}

pub(crate) fn create_token(user_id: Uuid, secret: &str) -> Result<String, ApiError> {
    let expires_at = user_token_expires_at();
    create_token_expires_at(user_id, None, "user", 1, expires_at, secret)
}

fn user_token_expires_at() -> chrono::DateTime<Utc> {
    Utc::now() + Duration::days(365)
}

fn create_token_expires_at(
    user_id: Uuid,
    org_id: Option<Uuid>,
    role: &str,
    auth_version: u32,
    expires_at: chrono::DateTime<Utc>,
    secret: &str,
) -> Result<String, ApiError> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        iat: now.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
        token_type: Some("user".into()),
        org_id: org_id.map(|value| value.to_string()),
        role: Some(role.to_owned()),
        auth_version,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

fn auth_response(
    user: AuthUser,
    auth_version: u32,
    secret: &str,
) -> Result<AuthResponse, ApiError> {
    let expires_at = user_token_expires_at();
    Ok(AuthResponse {
        user_id: user.id,
        token: create_token_expires_at(
            user.id,
            user.org_id,
            &user.role,
            auth_version,
            expires_at,
            secret,
        )?,
        expires_at,
        user,
    })
}

fn normalized_email(email: Option<&str>) -> Result<String, ApiError> {
    let email = email.unwrap_or("").trim().to_lowercase();
    if !email.contains('@') {
        return Err(ApiError::Invalid("valid email required".into()));
    }
    Ok(email)
}

fn normalized_account(credentials: &Credentials) -> Result<String, ApiError> {
    let value = credentials
        .account
        .as_deref()
        .or(credentials.email.as_deref())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if value.is_empty() {
        return Err(ApiError::Invalid("account required".into()));
    }
    Ok(value)
}

fn default_login_name(email: &str) -> String {
    email.split('@').next().unwrap_or(email).trim().to_owned()
}

pub(crate) fn is_vip_active(enabled: i8, expires_at: Option<DateTime<Utc>>) -> bool {
    enabled != 0 && expires_at.is_none_or(|expires_at| expires_at > Utc::now())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SwitchOrganizationRequest {
    pub(crate) org_id: Uuid,
}

pub(crate) async fn switch_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SwitchOrganizationRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    let row: Option<(
        String,
        u32,
        i8,
        String,
        String,
        Option<String>,
        Option<String>,
        i8,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(
        "SELECT membership.role,user.auth_version,user.is_platform_admin,
                    user.login_name,user.email,user.display_name,org.name,user.vip_enabled,user.vip_expires_at
             FROM users user
             JOIN user_organization_memberships membership
               ON membership.user_id=user.id AND membership.org_id=?
             JOIN organizations org ON org.id=membership.org_id
             WHERE user.id=? AND user.deleted_at IS NULL",
    )
    .bind(request.org_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(&state.pool)
    .await?;
    let Some((role, auth_version, is_platform_admin, login_name, email, display_name, org_name, vip_enabled, vip_expires_at)) =
        row
    else {
        return Err(ApiError::Forbidden);
    };
    let user = AuthUser {
        id: user_id,
        login_name,
        email,
        display_name: display_name.unwrap_or_default(),
        role,
        org_id: Some(request.org_id),
        org_name,
        organizations: load_organizations(&state.pool, user_id).await?,
        is_platform_admin: is_platform_admin != 0,
        vip_enabled: vip_enabled != 0,
        vip_expires_at,
        vip_active: is_vip_active(vip_enabled, vip_expires_at),
    };
    Ok(Json(auth_response(user, auth_version, &state.jwt_secret)?))
}

async fn load_organizations(
    pool: &sqlx::MySqlPool,
    user_id: Uuid,
) -> Result<Vec<AuthOrganization>, ApiError> {
    let rows: Vec<(String, String, String, i8)> = sqlx::query_as(
        "SELECT org.id,org.name,membership.role,membership.is_default
         FROM user_organization_memberships membership
         JOIN organizations org ON org.id=membership.org_id
         WHERE membership.user_id=?
         ORDER BY membership.is_default DESC,org.name",
    )
    .bind(user_id.to_string())
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|(id, name, role, is_default)| {
            Ok(AuthOrganization {
                id: Uuid::parse_str(&id).map_err(|_| ApiError::Internal)?,
                name,
                role,
                is_default: is_default != 0,
            })
        })
        .collect()
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
        org_id: None,
        role: None,
        auth_version: 0,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

#[derive(Debug, Clone)]
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
