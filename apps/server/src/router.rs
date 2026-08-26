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
use crate::auth::{guest_auth, login, register};
use crate::master_library::{
    find_related_master_games, list_master_player_games, list_master_players, master_game_detail,
    master_library_stats, master_opening_profile,
};
use crate::state::AppState;
use crate::subscription::{redeem_code, subscription};
use crate::sync::{pull, push};

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
