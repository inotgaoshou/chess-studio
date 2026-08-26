use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug, thiserror::Error)]
pub(crate) enum ApiError {
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
            Self::QuotaExceeded | Self::RateLimited | Self::GuestQuotaExceeded => {
                StatusCode::TOO_MANY_REQUESTS
            }
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
