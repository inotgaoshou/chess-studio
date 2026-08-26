use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use anyhow::Context;
use sqlx::mysql::MySqlPoolOptions;
use tokio::sync::Semaphore;

mod analysis;
mod auth;
mod error;
mod master_library;
mod router;
mod state;
mod subscription;
mod sync;

use crate::master_library::backfill_master_opening_tags;
use crate::router::{cors_layer, env_value, router};
use crate::state::{AppState, EngineConfig};

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
    sqlx::raw_sql(include_str!("../migrations/0002_master_opening_tags.sql"))
        .execute(&pool)
        .await?;
    backfill_master_opening_tags(&pool).await?;
    let app = router(
        AppState {
            pool,
            jwt_secret,
            guest_analysis_enabled: env_value("GUEST_ANALYSIS_ENABLED", cfg!(debug_assertions)),
            guest_token_ttl: StdDuration::from_secs(guest_token_ttl_minutes * 60),
            guest_daily_analysis_limit: env_value("GUEST_DAILY_ANALYSIS_LIMIT", 30u32)
                .clamp(1, 10_000),
            guest_token_ip_daily_limit: env_value("GUEST_TOKEN_IP_DAILY_LIMIT", 20u32)
                .clamp(1, 10_000),
            analysis_ip_per_minute_limit: env_value("ANALYSIS_IP_PER_MINUTE_LIMIT", 10u32)
                .clamp(1, 10_000),
            user_analysis_per_minute_limit: env_value("USER_ANALYSIS_PER_MINUTE_LIMIT", 30u32)
                .clamp(1, 10_000),
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

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;
    use chrono::{Duration, Utc};
    use std::time::Duration as StdDuration;
    use uuid::Uuid;

    use crate::analysis::{
        AnalysisMode, AnalysisRequest, run_analysis, validate_analysis_request,
        validate_guest_analysis_request,
    };
    use crate::auth::{
        AnalysisPrincipal, Credentials, analysis_principal, authenticated_user, create_guest_token,
        create_token, validate_credentials,
    };
    use crate::master_library::{MasterGamePgn, build_master_game_pgn};
    use crate::router::allowed_origin;
    use crate::state::EngineConfig;
    use crate::subscription::{normalized_redemption_code, redemption_code_hash};

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
        assert!(
            validate_guest_analysis_request(&AnalysisRequest {
                value: 21,
                fen: valid_guest.fen.clone(),
                ..valid_guest
            })
            .is_err()
        );
        assert!(
            validate_guest_analysis_request(&AnalysisRequest {
                multi_pv: 3,
                ..valid_guest
            })
            .is_err()
        );
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
    fn router_registers_public_api_routes() {
        let source = include_str!("router.rs");
        for route in [
            "/health",
            "/api/v1/auth/register",
            "/api/v1/auth/login",
            "/api/v1/auth/guest",
            "/api/v1/sync/push",
            "/api/v1/sync/pull",
            "/api/v1/subscription",
            "/api/v1/subscription/redeem",
            "/api/v1/analysis",
            "/api/v1/master/players",
            "/api/v1/master/stats",
            "/api/v1/master/players/{player_id}/games",
            "/api/v1/master/players/{player_id}/opening-profile",
            "/api/v1/master/related-games",
            "/api/v1/master/games/{game_id}",
        ] {
            assert!(source.contains(route), "missing route {route}");
        }
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
    fn master_opening_tag_migration_and_backfill_cover_middle_cannon_third_pawn() {
        let schema = include_str!("../migrations/0002_master_opening_tags.sql");
        assert!(schema.contains("CREATE TABLE IF NOT EXISTS master_game_opening_tags"));
        assert!(schema.contains("idx_master_opening_tag_game"));
        let source = include_str!("master_library.rs");
        for tag in ["middle-cannon", "third-pawn", "middle-cannon-third-pawn"] {
            assert!(source.contains(tag), "missing opening tag {tag}");
        }
        assert!(source.contains("INSERT IGNORE INTO master_game_opening_tags"));
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
