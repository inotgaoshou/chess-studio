use anyhow::Context;
use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, Uri, header},
    routing::{get, post},
};
use serde::Serialize;
use std::env;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::analysis::analyze;
use crate::analysis_jobs::{cancel_analysis_job, create_analysis_job, get_analysis_job};
use crate::auth::{guest_auth, login, register};
use crate::master_library::{
    find_related_master_games, list_master_player_games, list_master_players, master_game_detail,
    master_library_stats, master_opening_profile,
};
use crate::reference_library::{
    confirm_reference_batch, create_reference_source, list_openings, list_reference_fingerprints,
    list_reference_games, offline_package_manifest, opening_detail, publish_reference_chunk,
    query_position,
};
use crate::state::AppState;
use crate::subscription::{redeem_code, subscription};
use crate::sync::{pull, push};

pub(crate) const REFERENCE_PUBLISH_BODY_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub(crate) struct Health {
    status: &'static str,
}
pub(crate) fn router(state: AppState, cors: CorsLayer) -> Router {
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
        .route("/api/v1/analysis/jobs", post(create_analysis_job))
        .route("/api/v1/analysis/jobs/{job_id}", get(get_analysis_job))
        .route(
            "/api/v1/analysis/jobs/{job_id}/cancel",
            post(cancel_analysis_job),
        )
        .route("/api/v1/master/players", get(list_master_players))
        .route("/api/v1/master/stats", get(master_library_stats))
        .route(
            "/api/v1/master/players/{player_id}/games",
            get(list_master_player_games),
        )
        .route(
            "/api/v1/master/players/{player_id}/opening-profile",
            get(master_opening_profile),
        )
        .route(
            "/api/v1/master/related-games",
            post(find_related_master_games),
        )
        .route("/api/v1/master/games/{game_id}", get(master_game_detail))
        .route("/api/v1/openings", get(list_openings))
        .route("/api/v1/openings/{code}", get(opening_detail))
        .route("/api/v1/reference/games", get(list_reference_games))
        .route(
            "/api/v1/reference/fingerprints",
            get(list_reference_fingerprints),
        )
        .route("/api/v1/reference/position-query", post(query_position))
        .route(
            "/api/v1/reference/offline-package",
            get(offline_package_manifest),
        )
        .route("/api/v1/reference/sources", post(create_reference_source))
        .route(
            "/api/v1/reference/publish/chunks",
            post(publish_reference_chunk)
                .layer(DefaultBodyLimit::max(REFERENCE_PUBLISH_BODY_LIMIT)),
        )
        .route(
            "/api/v1/reference/publish/confirm",
            post(confirm_reference_batch),
        )
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

pub(crate) fn env_value<T>(name: &str, default: T) -> T
where
    T: std::str::FromStr,
{
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

pub(crate) fn cors_layer() -> anyhow::Result<CorsLayer> {
    let configured = env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "http://127.0.0.1:1420,http://localhost:1420,https://localhost,capacitor://localhost".into()
    });
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
pub(crate) fn allowed_origin(value: &str) -> anyhow::Result<HeaderValue> {
    let uri: Uri = value
        .parse()
        .with_context(|| format!("invalid ALLOWED_ORIGINS entry: {value}"))?;
    let scheme = uri
        .scheme_str()
        .ok_or_else(|| anyhow::anyhow!("origin is missing a scheme: {value}"))?;
    let host = uri
        .host()
        .ok_or_else(|| anyhow::anyhow!("origin is missing a host: {value}"))?;
    let local_host = matches!(host, "localhost" | "127.0.0.1" | "::1");
    let local_development_origin = local_host && matches!(scheme, "http" | "capacitor");
    if scheme != "https" && !local_development_origin {
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
