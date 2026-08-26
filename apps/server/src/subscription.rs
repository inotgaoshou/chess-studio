use axum::{Json, extract::State, http::HeaderMap};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{MySql, MySqlPool, Transaction};
use uuid::Uuid;

use crate::auth::authenticated_user;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionDto {
    plan: String,
    status: String,
    source: String,
    starts_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
    cloud_analysis_quota: u32,
    cloud_analysis_used: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RedeemCodeRequest {
    code: String,
}
pub(crate) async fn subscription(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SubscriptionDto>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    Ok(Json(load_subscription(&state.pool, user_id).await?))
}

pub(crate) async fn redeem_code(
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

pub(crate) fn normalized_redemption_code(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

pub(crate) fn redemption_code_hash(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.as_bytes()))
}

pub(crate) async fn load_subscription(
    pool: &MySqlPool,
    user_id: Uuid,
) -> Result<SubscriptionDto, ApiError> {
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

pub(crate) async fn reserve_cloud_analysis(
    pool: &MySqlPool,
    user_id: Uuid,
) -> Result<(), ApiError> {
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

pub(crate) async fn release_cloud_analysis(pool: &MySqlPool, user_id: Uuid) {
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

pub(crate) async fn record_product_event_for_pool(
    pool: &MySqlPool,
    user_id: Uuid,
    event_name: &str,
) -> Result<(), ApiError> {
    let mut transaction = pool.begin().await?;
    record_product_event(&mut transaction, user_id, event_name).await?;
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn record_product_event(
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
