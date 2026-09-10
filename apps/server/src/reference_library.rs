use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{MySql, Transaction};
use url::Url;
use uuid::Uuid;
use xiangqi_core::{Board, Color, Move};

use crate::{auth::authenticated_user, error::ApiError, state::AppState};

const POSITION_BACKFILL_TASK: &str = "reference-v2-position-index";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningQuery {
    parent_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningCategoryDto {
    code: String,
    series_code: String,
    parent_code: Option<String>,
    name: String,
    aliases: Vec<String>,
    sort_order: i32,
    game_count: u64,
    red_wins: u64,
    draws: u64,
    black_wins: u64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceGameQuery {
    #[serde(alias = "openingCode")]
    opening_code: Option<String>,
    query: Option<String>,
    player: Option<String>,
    event: Option<String>,
    side: Option<String>,
    #[serde(alias = "yearFrom")]
    year_from: Option<u16>,
    #[serde(alias = "yearTo")]
    year_to: Option<u16>,
    #[serde(alias = "masterOnly")]
    master_only: Option<bool>,
    #[serde(alias = "classificationStatus")]
    classification_status: Option<String>,
    #[serde(alias = "positionFen")]
    position_fen: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceGameSummaryDto {
    id: String,
    canonical_fingerprint: String,
    title: String,
    red_player: String,
    black_player: String,
    event_name: String,
    round_name: String,
    game_date: Option<chrono::NaiveDate>,
    result: String,
    opening: String,
    opening_code: Option<String>,
    move_count: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PositionExplorerRequest {
    fen: String,
    limit: Option<u32>,
    player: Option<String>,
    event: Option<String>,
    year_from: Option<u16>,
    year_to: Option<u16>,
    side: Option<String>,
    master_only: Option<bool>,
    include_details: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PositionMoveStatDto {
    iccs: String,
    notation: String,
    samples: u64,
    red_wins: u64,
    draws: u64,
    black_wins: u64,
    first_year: Option<u16>,
    last_year: Option<u16>,
    opening_code: Option<String>,
    opening_name: Option<String>,
    opening_confidence: Option<u8>,
    representative_game_id: Option<String>,
    representative_game_title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceOfflinePackageManifestDto {
    version: String,
    package_url: String,
    sha256: String,
    game_count: u64,
    published_at: Option<String>,
}

pub(crate) async fn offline_package_manifest()
-> Result<Json<ReferenceOfflinePackageManifestDto>, ApiError> {
    let version = std::env::var("REFERENCE_LIBRARY_PACKAGE_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiError::NotFound)?;
    let package_url = std::env::var("REFERENCE_LIBRARY_PACKAGE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiError::NotFound)?;
    let sha256 = std::env::var("REFERENCE_LIBRARY_PACKAGE_SHA256")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| ApiError::Invalid("offline package SHA-256 is invalid".into()))?;
    let url = Url::parse(package_url.trim())
        .map_err(|_| ApiError::Invalid("offline package URL is invalid".into()))?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err(ApiError::Invalid(
            "offline package URL must use HTTPS".into(),
        ));
    }
    let game_count = std::env::var("REFERENCE_LIBRARY_PACKAGE_GAME_COUNT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_default();
    Ok(Json(ReferenceOfflinePackageManifestDto {
        version,
        package_url,
        sha256,
        game_count,
        published_at: std::env::var("REFERENCE_LIBRARY_PACKAGE_PUBLISHED_AT").ok(),
    }))
}

pub(crate) async fn list_openings(
    State(state): State<AppState>,
    Query(query): Query<OpeningQuery>,
) -> Result<Json<Vec<OpeningCategoryDto>>, ApiError> {
    type Row = (
        String,
        String,
        Option<String>,
        String,
        i32,
        i64,
        i64,
        i64,
        i64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT c.code,c.series_code,c.parent_code,c.name,c.sort_order,
                COUNT(DISTINCT CASE WHEN x.is_primary=1 AND x.status='classified' AND g.validation_status='valid' THEN x.game_id END),
                CAST(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.validation_status='valid' AND g.result='1-0' THEN 1 ELSE 0 END) AS SIGNED),
                CAST(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.validation_status='valid' AND g.result='1/2-1/2' THEN 1 ELSE 0 END) AS SIGNED),
                CAST(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.validation_status='valid' AND g.result='0-1' THEN 1 ELSE 0 END) AS SIGNED)
         FROM opening_categories c
         LEFT JOIN game_opening_classifications x
           ON (x.category_code=c.code OR (CHAR_LENGTH(c.code)=1 AND x.category_code LIKE CONCAT(c.code,'%')))
          AND x.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
         LEFT JOIN master_games g ON g.id=x.game_id
         WHERE c.active=1 AND ((? IS NULL AND c.parent_code IS NULL) OR c.parent_code=?)
         GROUP BY c.code,c.series_code,c.parent_code,c.name,c.sort_order ORDER BY c.sort_order,c.code",
    ).bind(&query.parent_code).bind(&query.parent_code).fetch_all(&state.pool).await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let aliases: Vec<String> = sqlx::query_scalar(
            "SELECT alias FROM opening_aliases WHERE category_code=? AND reviewed=1 ORDER BY alias",
        )
        .bind(&row.0)
        .fetch_all(&state.pool)
        .await?;
        result.push(OpeningCategoryDto {
            code: row.0,
            series_code: row.1,
            parent_code: row.2,
            name: row.3,
            aliases,
            sort_order: row.4,
            game_count: nonnegative(row.5),
            red_wins: nonnegative(row.6),
            draws: nonnegative(row.7),
            black_wins: nonnegative(row.8),
        });
    }
    Ok(Json(result))
}

pub(crate) async fn opening_detail(
    State(state): State<AppState>,
    AxumPath(code): AxumPath<String>,
) -> Result<Json<OpeningCategoryDto>, ApiError> {
    if !is_opening_code(&code) {
        return Err(ApiError::Invalid(
            "opening code must be A-E or A00-E99".into(),
        ));
    }
    let mut items = list_openings(
        State(state.clone()),
        Query(OpeningQuery {
            parent_code: parent_for_code(&code),
        }),
    )
    .await?
    .0;
    items
        .drain(..)
        .find(|item| item.code.eq_ignore_ascii_case(&code))
        .map(Json)
        .ok_or(ApiError::NotFound)
}

pub(crate) async fn list_reference_games(
    State(state): State<AppState>,
    Query(query): Query<ReferenceGameQuery>,
) -> Result<Json<Vec<ReferenceGameSummaryDto>>, ApiError> {
    let search = query.query.as_deref().unwrap_or_default().trim();
    let player = query.player.as_deref().unwrap_or_default().trim();
    let event = query.event.as_deref().unwrap_or_default().trim();
    let side = query.side.as_deref().unwrap_or_default().trim();
    let classification_status = query
        .classification_status
        .as_deref()
        .unwrap_or_default()
        .trim();
    if !matches!(side, "" | "red" | "black") {
        return Err(ApiError::Invalid("side must be red or black".into()));
    }
    if !matches!(classification_status, "" | "classified" | "pending") {
        return Err(ApiError::Invalid(
            "classificationStatus must be classified or pending".into(),
        ));
    }
    let position_filter = match query.position_fen.as_deref() {
        Some(fen) if !fen.trim().is_empty() => {
            let board =
                Board::from_fen(fen).map_err(|error| ApiError::Invalid(error.to_string()))?;
            let key = board.rule_position_key();
            Some((short_hash(&key), key))
        }
        _ => None,
    };
    if let Some((position_hash, position_key)) = position_filter.as_ref() {
        let fast_position_only = query.opening_code.is_none()
            && search.is_empty()
            && player.is_empty()
            && event.is_empty()
            && query.year_from.is_none()
            && query.year_to.is_none()
            && side.is_empty()
            && classification_status.is_empty()
            && !query.master_only.unwrap_or(false);
        if fast_position_only {
            type FastRow = (
                String,
                String,
                String,
                String,
                Option<String>,
                Option<String>,
                Option<chrono::NaiveDate>,
                String,
                Option<String>,
                Option<String>,
                i64,
            );
            let rows: Vec<FastRow> = sqlx::query_as(
                "SELECT g.id,g.title,g.red_player,g.black_player,g.event_name,g.round_name,g.game_date,
                        g.result,g.opening,g.canonical_fingerprint,CAST(g.move_count AS SIGNED)
                 FROM master_game_moves m
                 JOIN master_games g ON g.id=m.game_id
                 WHERE m.position_hash=? AND m.position_key=? AND g.validation_status='valid'
                 LIMIT ? OFFSET ?",
            )
            .bind(position_hash)
            .bind(position_key)
            .bind(query.limit.unwrap_or(50).clamp(1, 200))
            .bind(query.offset.unwrap_or(0))
            .fetch_all(&state.pool)
            .await?;
            return Ok(Json(
                rows.into_iter()
                    .map(|row| ReferenceGameSummaryDto {
                        id: row.0,
                        title: row.1,
                        red_player: row.2,
                        black_player: row.3,
                        event_name: row.4.unwrap_or_default(),
                        round_name: row.5.unwrap_or_default(),
                        game_date: row.6,
                        result: row.7,
                        opening: row.8.unwrap_or_default(),
                        opening_code: None,
                        canonical_fingerprint: row.9.unwrap_or_default(),
                        move_count: nonnegative(row.10),
                    })
                    .collect(),
            ));
        }
    }
    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<chrono::NaiveDate>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT g.id,g.title,g.red_player,g.black_player,g.event_name,g.round_name,g.game_date,
                g.result,g.opening,(SELECT category_code FROM game_opening_classifications c
                  WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                    AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                  ORDER BY c.id DESC LIMIT 1),
                g.canonical_fingerprint,CAST(g.move_count AS SIGNED)
         FROM master_games g WHERE g.validation_status='valid'
           AND (? IS NULL OR EXISTS (SELECT 1 FROM game_opening_classifications c
                WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                  AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                  AND (c.category_code=? OR (CHAR_LENGTH(?)=1 AND c.category_code LIKE CONCAT(?,'%')))))
           AND (?='' OR g.title LIKE CONCAT('%',?,'%') OR g.red_player LIKE CONCAT('%',?,'%') OR g.black_player LIKE CONCAT('%',?,'%') OR g.event_name LIKE CONCAT('%',?,'%'))
           AND (?='' OR g.red_player LIKE CONCAT('%',?,'%') OR g.black_player LIKE CONCAT('%',?,'%'))
           AND (?='' OR g.event_name LIKE CONCAT('%',?,'%'))
	           AND (? IS NULL OR YEAR(g.game_date)>=?) AND (? IS NULL OR YEAR(g.game_date)<=?)
	           AND (?='' OR (?='red' AND g.red_player LIKE CONCAT('%',?,'%')) OR (?='black' AND g.black_player LIKE CONCAT('%',?,'%')))
	           AND (?=0 OR g.master_player_id IS NOT NULL OR EXISTS (SELECT 1 FROM master_game_player_refs mr WHERE mr.game_id=g.id))
	           AND (?='' OR (?='classified' AND EXISTS (SELECT 1 FROM game_opening_classifications c
	                WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
	                  AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)))
	             OR (?='pending' AND NOT EXISTS (SELECT 1 FROM game_opening_classifications c
	                WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
	                  AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1))
	                AND EXISTS (SELECT 1 FROM game_opening_classifications c
	                WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='pending'
	                  AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1))))
             AND (? IS NULL OR EXISTS (SELECT 1 FROM master_game_moves m
                  WHERE m.game_id=g.id AND m.position_hash=? AND m.position_key=?))
	         ORDER BY g.game_date DESC,g.created_at DESC,g.id DESC LIMIT ? OFFSET ?",
    ).bind(&query.opening_code).bind(&query.opening_code).bind(&query.opening_code).bind(&query.opening_code)
      .bind(search).bind(search).bind(search).bind(search).bind(search)
      .bind(player).bind(player).bind(player).bind(event).bind(event)
	      .bind(query.year_from).bind(query.year_from).bind(query.year_to).bind(query.year_to)
	      .bind(side).bind(side).bind(player).bind(side).bind(player)
	      .bind(query.master_only.unwrap_or(false))
	      .bind(classification_status).bind(classification_status).bind(classification_status)
      .bind(position_filter.as_ref().map(|(hash, _)| hash.as_str()))
      .bind(position_filter.as_ref().map(|(hash, _)| hash.as_str()))
      .bind(position_filter.as_ref().map(|(_, key)| key.as_str()))
	      .bind(query.limit.unwrap_or(50).clamp(1,200))
	      .bind(query.offset.unwrap_or(0)).fetch_all(&state.pool).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| ReferenceGameSummaryDto {
                id: row.0,
                title: row.1,
                red_player: row.2,
                black_player: row.3,
                event_name: row.4.unwrap_or_default(),
                round_name: row.5.unwrap_or_default(),
                game_date: row.6,
                result: row.7,
                opening: row.8.unwrap_or_default(),
                opening_code: row.9,
                canonical_fingerprint: row.10.unwrap_or_default(),
                move_count: nonnegative(row.11),
            })
            .collect(),
    ))
}

pub(crate) async fn list_reference_fingerprints(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, ApiError> {
    let fingerprints = sqlx::query_scalar(
        "SELECT canonical_fingerprint FROM master_games
         WHERE validation_status='valid' AND canonical_fingerprint IS NOT NULL
         ORDER BY canonical_fingerprint",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(fingerprints))
}

pub(crate) async fn query_position(
    State(state): State<AppState>,
    Json(request): Json<PositionExplorerRequest>,
) -> Result<Json<Vec<PositionMoveStatDto>>, ApiError> {
    let board =
        Board::from_fen(&request.fen).map_err(|error| ApiError::Invalid(error.to_string()))?;
    let key = board.rule_position_key();
    let hash = short_hash(&key);
    let no_filters = request
        .player
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
        && request
            .event
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        && request.year_from.is_none()
        && request.year_to.is_none()
        && request.side.is_none()
        && !request.master_only.unwrap_or(false);
    type Row = (String, String, i64, i64, i64, i64, Option<i64>, Option<i64>);
    let rows: Vec<Row> = if no_filters {
        sqlx::query_as(
            "SELECT move_iccs,notation,CAST(samples AS SIGNED),CAST(red_wins AS SIGNED),CAST(draws AS SIGNED),CAST(black_wins AS SIGNED),CAST(first_year AS SIGNED),CAST(last_year AS SIGNED)
             FROM reference_position_move_stats WHERE position_hash=? AND position_key=? ORDER BY samples DESC,move_iccs LIMIT ?",
        ).bind(&hash).bind(&key).bind(request.limit.unwrap_or(20).clamp(1,100)).fetch_all(&state.pool).await?
    } else {
        let player = request.player.as_deref().unwrap_or_default().trim();
        let event = request.event.as_deref().unwrap_or_default().trim();
        let side = request.side.as_deref().unwrap_or_default().trim();
        if !matches!(side, "" | "red" | "black") {
            return Err(ApiError::Invalid("side must be red or black".into()));
        }
        sqlx::query_as(
            "SELECT m.move_iccs,MAX(COALESCE(NULLIF(s.notation,''),m.move_iccs)),CAST(COUNT(*) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='1-0'),0) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='1/2-1/2'),0) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='0-1'),0) AS SIGNED),
                    MIN(YEAR(g.game_date)),MAX(YEAR(g.game_date))
             FROM master_game_moves m JOIN master_games g ON g.id=m.game_id
             LEFT JOIN reference_position_move_stats s
               ON s.position_hash=m.position_hash AND s.position_key=m.position_key AND s.move_iccs=m.move_iccs
             WHERE m.position_hash=? AND m.position_key=? AND g.validation_status='valid'
               AND (?='' OR g.red_player LIKE CONCAT('%',?,'%') OR g.black_player LIKE CONCAT('%',?,'%'))
               AND (?='' OR g.event_name LIKE CONCAT('%',?,'%'))
               AND (? IS NULL OR YEAR(g.game_date)>=?) AND (? IS NULL OR YEAR(g.game_date)<=?)
               AND (?='' OR (?='red' AND g.red_player LIKE CONCAT('%',?,'%')) OR (?='black' AND g.black_player LIKE CONCAT('%',?,'%')))
               AND (?=0 OR g.master_player_id IS NOT NULL OR EXISTS (SELECT 1 FROM master_game_player_refs mr WHERE mr.game_id=g.id))
             GROUP BY m.move_iccs ORDER BY COUNT(*) DESC,m.move_iccs LIMIT ?",
        ).bind(&hash).bind(&key).bind(player).bind(player).bind(player).bind(event).bind(event)
          .bind(request.year_from).bind(request.year_from).bind(request.year_to).bind(request.year_to)
          .bind(side).bind(side).bind(player).bind(side).bind(player).bind(request.master_only.unwrap_or(false))
          .bind(request.limit.unwrap_or(20).clamp(1,100)).fetch_all(&state.pool).await?
    };
    let mut result = rows
        .into_iter()
        .map(|row| PositionMoveStatDto {
            iccs: row.0.clone(),
            notation: row.1,
            samples: nonnegative(row.2),
            red_wins: nonnegative(row.3),
            draws: nonnegative(row.4),
            black_wins: nonnegative(row.5),
            first_year: row.6.and_then(|v| u16::try_from(v).ok()),
            last_year: row.7.and_then(|v| u16::try_from(v).ok()),
            opening_code: None,
            opening_name: None,
            opening_confidence: None,
            representative_game_id: None,
            representative_game_title: None,
        })
        .collect::<Vec<_>>();
    if !request.include_details.unwrap_or(true) {
        return Ok(Json(result));
    }
    let player = request.player.as_deref().unwrap_or_default().trim();
    let event = request.event.as_deref().unwrap_or_default().trim();
    let side = request.side.as_deref().unwrap_or_default().trim();
    type OpeningConsensus = (String, String, i64);
    let opening_rows: Vec<OpeningConsensus> = sqlx::query_as(
        "SELECT c.category_code,o.name,CAST(COUNT(DISTINCT g.id) AS SIGNED)
         FROM master_game_moves m JOIN master_games g ON g.id=m.game_id
         JOIN game_opening_classifications c ON c.game_id=g.id
           AND c.is_primary=1 AND c.status='classified'
           AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
         JOIN opening_categories o ON o.code=c.category_code
         WHERE m.position_hash=? AND m.position_key=? AND g.validation_status='valid'
           AND (?='' OR g.red_player LIKE CONCAT('%',?,'%') OR g.black_player LIKE CONCAT('%',?,'%'))
           AND (?='' OR g.event_name LIKE CONCAT('%',?,'%'))
           AND (? IS NULL OR YEAR(g.game_date)>=?) AND (? IS NULL OR YEAR(g.game_date)<=?)
           AND (?='' OR (?='red' AND g.red_player LIKE CONCAT('%',?,'%')) OR (?='black' AND g.black_player LIKE CONCAT('%',?,'%')))
           AND (?=0 OR g.master_player_id IS NOT NULL OR EXISTS (SELECT 1 FROM master_game_player_refs mr WHERE mr.game_id=g.id))
         GROUP BY c.category_code,o.name ORDER BY COUNT(DISTINCT g.id) DESC,c.category_code",
    )
    .bind(&hash).bind(&key)
    .bind(player).bind(player).bind(player).bind(event).bind(event)
    .bind(request.year_from).bind(request.year_from).bind(request.year_to).bind(request.year_to)
    .bind(side).bind(side).bind(player).bind(side).bind(player)
    .bind(request.master_only.unwrap_or(false))
    .fetch_all(&state.pool).await?;
    let opening_total = opening_rows
        .iter()
        .map(|row| nonnegative(row.2))
        .sum::<u64>();
    let opening = opening_rows.first().map(|row| {
        let confidence = if opening_total == 0 {
            0
        } else {
            ((nonnegative(row.2) * 100) / opening_total) as u8
        };
        (row.0.clone(), row.1.clone(), confidence)
    });
    for item in &mut result {
        type Representative = (String, String);
        let representative: Option<Representative> = sqlx::query_as(
            "SELECT g.id,g.title
             FROM master_game_moves m JOIN master_games g ON g.id=m.game_id
             WHERE m.position_hash=? AND m.position_key=? AND m.move_iccs=?
               AND g.validation_status='valid'
               AND (?='' OR g.red_player LIKE CONCAT('%',?,'%') OR g.black_player LIKE CONCAT('%',?,'%'))
               AND (?='' OR g.event_name LIKE CONCAT('%',?,'%'))
               AND (? IS NULL OR YEAR(g.game_date)>=?) AND (? IS NULL OR YEAR(g.game_date)<=?)
               AND (?='' OR (?='red' AND g.red_player LIKE CONCAT('%',?,'%')) OR (?='black' AND g.black_player LIKE CONCAT('%',?,'%')))
               AND (?=0 OR g.master_player_id IS NOT NULL OR EXISTS (SELECT 1 FROM master_game_player_refs mr WHERE mr.game_id=g.id))
             ORDER BY g.game_date DESC,g.created_at DESC LIMIT 1",
        )
        .bind(&hash)
        .bind(&key)
        .bind(&item.iccs)
        .bind(player)
        .bind(player)
        .bind(player)
        .bind(event)
        .bind(event)
        .bind(request.year_from)
        .bind(request.year_from)
        .bind(request.year_to)
        .bind(request.year_to)
        .bind(side)
        .bind(side)
        .bind(player)
        .bind(side)
        .bind(player)
        .bind(request.master_only.unwrap_or(false))
        .fetch_optional(&state.pool)
        .await?;
        if let Some((game_id, title)) = representative {
            item.representative_game_id = Some(game_id);
            item.representative_game_title = Some(title);
        }
        if let Some((code, name, confidence)) = &opening {
            item.opening_code = Some(code.clone());
            item.opening_name = Some(name.clone());
            item.opening_confidence = Some(*confidence);
        }
    }
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateReferenceSourceRequest {
    display_name: String,
    source_type: String,
    public_locator: Option<String>,
    license_status: String,
    license_note: Option<String>,
}

pub(crate) async fn create_reference_source(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateReferenceSourceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_admin(&state, &headers).await?;
    let locator = request.public_locator.as_deref().unwrap_or_default().trim();
    if looks_like_local_path(locator) {
        return Err(ApiError::Invalid(
            "publicLocator must not contain a local path".into(),
        ));
    }
    if !is_publishable_license(&request.license_status) {
        return Err(ApiError::Invalid(
            "licenseStatus must be authorized, public-domain, or self-owned".into(),
        ));
    }
    if request
        .license_note
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err(ApiError::Invalid("licenseNote is required".into()));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO reference_sources (id,display_name,source_type,public_locator,license_status,license_note,created_by) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(request.display_name.trim()).bind(request.source_type.trim()).bind(empty_none(locator))
        .bind(request.license_status.trim()).bind(request.license_note.unwrap_or_default()).bind(user_id.to_string())
        .execute(&state.pool).await?;
    Ok(Json(serde_json::json!({"id": id})))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishBatchRequest {
    source_id: String,
    client_batch_id: String,
    parser_version: u32,
    games: Vec<PublishGame>,
    #[serde(default)]
    removed_records: Vec<PublishRemoval>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishGame {
    relative_path: String,
    file_sha256: String,
    record_index: u32,
    record_hash: String,
    canonical_fingerprint: String,
    moves_hash: String,
    title: String,
    red_player: String,
    black_player: String,
    event_name: Option<String>,
    round_name: Option<String>,
    game_date: Option<chrono::NaiveDate>,
    result: String,
    opening: Option<String>,
    starting_fen: String,
    moves: Vec<String>,
    opening_code: Option<String>,
    license_note: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishRemoval {
    relative_path: String,
    record_index: u32,
    record_hash: String,
}

pub(crate) async fn publish_reference_chunk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<PublishBatchRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_admin(&state, &headers).await?;
    if request.games.len() + request.removed_records.len() > 500 {
        return Err(ApiError::Invalid(
            "a publish chunk may contain at most 500 game and removal records".into(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    let (license_status, license_note): (String, String) = sqlx::query_as(
        "SELECT license_status,license_note FROM reference_sources
         WHERE id=? AND active=1 FOR UPDATE",
    )
    .bind(&request.source_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(ApiError::NotFound)?;
    if !is_publishable_license(&license_status) {
        return Err(ApiError::Invalid(
            "reference source is not approved for shared publication".into(),
        ));
    }
    let license_proof = if license_note.trim().is_empty() {
        license_status
    } else {
        license_note
    };
    let (batch_id, batch_status) = ensure_batch(&mut transaction, &request, user_id).await?;
    let mut inserted = 0u32;
    let mut duplicates = 0u32;
    let mut replayed = 0u32;
    let mut removed = 0u32;
    for game in &request.games {
        validate_publish_game(game)?;
        let already_recorded_file_sha: Option<String> = sqlx::query_scalar(
            "SELECT f.file_sha256 FROM reference_import_records r
             JOIN reference_import_files f ON f.batch_id=r.batch_id AND f.relative_path=r.relative_path
             WHERE r.batch_id=? AND r.relative_path=? AND r.record_index=? AND r.record_hash=? LIMIT 1",
        )
        .bind(&batch_id)
        .bind(&game.relative_path)
        .bind(game.record_index)
        .bind(&game.record_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(recorded_file_sha) = already_recorded_file_sha {
            if !recorded_file_sha.eq_ignore_ascii_case(&game.file_sha256) {
                return Err(ApiError::Invalid(
                    "fileSha256 does not match the recorded publish chunk".into(),
                ));
            }
            replayed += 1;
            continue;
        }
        if batch_status == "completed" {
            return Err(ApiError::Invalid(
                "completed publish batch only accepts idempotent replay".into(),
            ));
        }
        upsert_import_file(&mut transaction, &batch_id, game).await?;
        let previous_record: Option<(Option<String>, String)> = sqlx::query_as(
            "SELECT r.game_id,r.record_hash FROM reference_import_records r
             JOIN reference_import_batches b ON b.id=r.batch_id
             WHERE b.source_id=? AND r.relative_path=? AND r.record_index=?
               AND r.game_id IS NOT NULL
             ORDER BY r.created_at DESC,r.id DESC LIMIT 1",
        )
        .bind(&request.source_id)
        .bind(&game.relative_path)
        .bind(game.record_index)
        .fetch_optional(&mut *transaction)
        .await?;
        let previous_game_id = previous_record
            .as_ref()
            .and_then(|(game_id, _)| game_id.clone());
        let existing: Option<String> =
            sqlx::query_scalar("SELECT id FROM master_games WHERE canonical_fingerprint=? LIMIT 1")
                .bind(&game.canonical_fingerprint)
                .fetch_optional(&mut *transaction)
                .await?;
        let (game_id, status) = if let Some(id) = existing {
            if previous_game_id.as_deref() == Some(id.as_str())
                && previous_record.as_ref().is_some_and(|(_, record_hash)| {
                    !record_hash.eq_ignore_ascii_case(&game.record_hash)
                })
            {
                update_reference_game_metadata(&mut transaction, &id, game, &license_proof).await?;
            }
            duplicates += 1;
            (id, "duplicate")
        } else {
            let id =
                insert_game(&mut transaction, &request.source_id, game, &license_proof).await?;
            inserted += 1;
            (id, "imported")
        };
        upsert_game_source(&mut transaction, &request.source_id, &game_id, game).await?;
        if let Some(previous_game_id) = previous_game_id
            && previous_game_id != game_id
        {
            deactivate_orphaned_reference_game(&mut transaction, &previous_game_id).await?;
        }
        attach_known_players(&mut transaction, &game_id, game).await?;
        let revision: u32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(r.revision),0)+1
             FROM reference_import_records r
             JOIN reference_import_batches b ON b.id=r.batch_id
             WHERE b.source_id=? AND r.relative_path=? AND r.record_index=?",
        )
        .bind(&request.source_id)
        .bind(&game.relative_path)
        .bind(game.record_index)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query("INSERT INTO reference_import_records (batch_id,relative_path,record_index,record_hash,revision,status,game_id) VALUES (?,?,?,?,?,?,?)")
            .bind(&batch_id).bind(&game.relative_path).bind(game.record_index).bind(&game.record_hash)
            .bind(revision).bind(status).bind(&game_id).execute(&mut *transaction).await?;
    }
    for removal in &request.removed_records {
        validate_publish_removal(removal)?;
        let already_recorded: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM reference_import_records
             WHERE batch_id=? AND relative_path=? AND record_index=? AND record_hash=?
               AND status='removed')",
        )
        .bind(&batch_id)
        .bind(&removal.relative_path)
        .bind(removal.record_index)
        .bind(&removal.record_hash)
        .fetch_one(&mut *transaction)
        .await?;
        if already_recorded {
            replayed += 1;
            continue;
        }
        if batch_status == "completed" {
            return Err(ApiError::Invalid(
                "completed publish batch only accepts idempotent replay".into(),
            ));
        }
        let source_url = reference_source_url_parts(
            &request.source_id,
            &removal.relative_path,
            removal.record_index,
        );
        let game_id: Option<String> = sqlx::query_scalar(
            "SELECT game_id FROM master_game_sources
             WHERE source_site='reference' AND source_url=? AND record_hash=? FOR UPDATE",
        )
        .bind(&source_url)
        .bind(&removal.record_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(game_id) = game_id.as_deref() {
            sqlx::query(
                "DELETE FROM master_game_sources
                 WHERE source_site='reference' AND source_url=? AND record_hash=?",
            )
            .bind(&source_url)
            .bind(&removal.record_hash)
            .execute(&mut *transaction)
            .await?;
            deactivate_orphaned_reference_game(&mut transaction, game_id).await?;
        }
        let revision: u32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(r.revision),0)+1
             FROM reference_import_records r
             JOIN reference_import_batches b ON b.id=r.batch_id
             WHERE b.source_id=? AND r.relative_path=? AND r.record_index=?",
        )
        .bind(&request.source_id)
        .bind(&removal.relative_path)
        .bind(removal.record_index)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO reference_import_records
             (batch_id,relative_path,record_index,record_hash,revision,status,game_id)
             VALUES (?,?,?,?,?,'removed',?)",
        )
        .bind(&batch_id)
        .bind(&removal.relative_path)
        .bind(removal.record_index)
        .bind(&removal.record_hash)
        .bind(revision)
        .bind(game_id)
        .execute(&mut *transaction)
        .await?;
        removed += 1;
    }
    sqlx::query(
        "UPDATE reference_import_batches SET
           imported_records=(SELECT COUNT(*) FROM reference_import_records WHERE batch_id=? AND status='imported'),
           duplicate_records=(SELECT COUNT(*) FROM reference_import_records WHERE batch_id=? AND status='duplicate')
         WHERE id=?",
    )
    .bind(&batch_id)
    .bind(&batch_id)
    .bind(&batch_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE reference_import_files f SET record_count=(
           SELECT COUNT(*) FROM reference_import_records r
           WHERE r.batch_id=f.batch_id AND r.relative_path=f.relative_path
         ) WHERE f.batch_id=?",
    )
    .bind(&batch_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(
        serde_json::json!({"batchId":batch_id,"inserted":inserted,"duplicates":duplicates,"removed":removed,"replayed":replayed}),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfirmBatchRequest {
    source_id: String,
    client_batch_id: String,
}

pub(crate) async fn confirm_reference_batch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ConfirmBatchRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let batch_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM reference_import_batches WHERE source_id=? AND client_batch_id=?",
    )
    .bind(&request.source_id)
    .bind(&request.client_batch_id)
    .fetch_optional(&state.pool)
    .await?;
    if batch_id.is_none() {
        return Err(ApiError::NotFound);
    }
    sqlx::query(
        "UPDATE reference_import_batches SET status='completed',
         completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP(6)) WHERE id=?",
    )
    .bind(batch_id)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({"status":"completed"})))
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let user_id = authenticated_user(headers, &state.jwt_secret)?;
    let role: Option<String> =
        sqlx::query_scalar("SELECT role FROM users WHERE id=? AND deleted_at IS NULL")
            .bind(user_id.to_string())
            .fetch_optional(&state.pool)
            .await?;
    if role.as_deref() != Some("admin") {
        return Err(ApiError::Unauthorized);
    }
    Ok(user_id)
}

async fn ensure_batch(
    transaction: &mut Transaction<'_, MySql>,
    request: &PublishBatchRequest,
    user_id: Uuid,
) -> Result<(String, String), ApiError> {
    if let Some((id, status, parser_version)) = sqlx::query_as::<_, (String, String, u32)>(
        "SELECT id,status,parser_version FROM reference_import_batches
         WHERE source_id=? AND client_batch_id=? FOR UPDATE",
    )
    .bind(&request.source_id)
    .bind(&request.client_batch_id)
    .fetch_optional(&mut **transaction)
    .await?
    {
        if parser_version != request.parser_version {
            return Err(ApiError::Invalid(
                "parserVersion does not match the existing batch".into(),
            ));
        }
        return Ok((id, status));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO reference_import_batches (id,source_id,client_batch_id,status,review_status,parser_version,published_by) VALUES (?,?,?,'publishing','approved',?,?)")
        .bind(&id).bind(&request.source_id).bind(&request.client_batch_id).bind(request.parser_version)
        .bind(user_id.to_string()).execute(&mut **transaction).await?;
    Ok((id, "publishing".into()))
}

async fn upsert_import_file(
    transaction: &mut Transaction<'_, MySql>,
    batch_id: &str,
    game: &PublishGame,
) -> Result<(), ApiError> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT file_sha256 FROM reference_import_files
         WHERE batch_id=? AND relative_path=? LIMIT 1 FOR UPDATE",
    )
    .bind(batch_id)
    .bind(&game.relative_path)
    .fetch_optional(&mut **transaction)
    .await?;
    if let Some(existing) = existing {
        if !existing.eq_ignore_ascii_case(&game.file_sha256) {
            return Err(ApiError::Invalid(
                "fileSha256 changed within one publish batch".into(),
            ));
        }
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO reference_import_files (batch_id,relative_path,file_sha256)
         VALUES (?,?,?)",
    )
    .bind(batch_id)
    .bind(&game.relative_path)
    .bind(&game.file_sha256)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_game(
    transaction: &mut Transaction<'_, MySql>,
    source_id: &str,
    game: &PublishGame,
    license_proof: &str,
) -> Result<String, ApiError> {
    let game_id = Uuid::new_v4().to_string();
    let source_url = reference_source_url(source_id, game);
    sqlx::query("INSERT INTO master_games (id,master_player_id,source_site,source_url,title,red_player,black_player,event_name,round_name,game_date,result,opening,starting_fen,move_count,moves_json,raw_notation_type,fingerprint,canonical_fingerprint,moves_hash,validation_status,ingestion_version,license_note,crawl_status) VALUES (?,NULL,'reference',?,?,?,?,?,?,?,?,?,?,?,?, 'CBL',?,?,?,'valid',2,?,'parsed')")
        .bind(&game_id).bind(&source_url).bind(&game.title).bind(&game.red_player).bind(&game.black_player)
        .bind(&game.event_name).bind(&game.round_name).bind(game.game_date).bind(&game.result).bind(&game.opening)
        .bind(&game.starting_fen).bind(game.moves.len() as u32).bind(serde_json::to_value(&game.moves).map_err(|_| ApiError::Internal)?)
        .bind(&game.canonical_fingerprint).bind(&game.canonical_fingerprint).bind(&game.moves_hash).bind(license_proof)
        .execute(&mut **transaction).await?;
    let mut board = Board::from_fen(&game.starting_fen)
        .map_err(|error| ApiError::Invalid(error.to_string()))?;
    for (index, iccs) in game.moves.iter().enumerate() {
        let mv = Move::from_iccs(iccs).map_err(|error| ApiError::Invalid(error.to_string()))?;
        let before_fen = board.to_fen();
        let key = board.rule_position_key();
        let hash = short_hash(&key);
        let side = if board.side_to_move() == Color::Red {
            "red"
        } else {
            "black"
        };
        let notation = board
            .chinese_move_notation(mv)
            .map_err(|error| ApiError::Invalid(error.to_string()))?;
        board = board
            .apply_move(mv)
            .map_err(|error| ApiError::Invalid(format!("illegal move {iccs}: {error}")))?;
        sqlx::query("INSERT INTO master_game_moves (game_id,ply,move_no,side_to_move,move_iccs,before_fen,position_key,position_hash,after_fen,phase) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(&game_id).bind(index as u32+1).bind(index as u32/2+1).bind(side).bind(iccs).bind(before_fen)
            .bind(&key).bind(&hash).bind(board.to_fen()).bind(if index<30{"opening"}else if index<80{"middle"}else{"endgame"})
            .execute(&mut **transaction).await?;
        let (red, draw, black) = result_counts(&game.result);
        sqlx::query("INSERT INTO reference_position_move_stats (position_hash,position_key,move_iccs,notation,samples,red_wins,draws,black_wins,first_year,last_year) VALUES (?,?,?,?,1,?,?,?,?,?) ON DUPLICATE KEY UPDATE samples=samples+1,red_wins=red_wins+VALUES(red_wins),draws=draws+VALUES(draws),black_wins=black_wins+VALUES(black_wins),first_year=CASE WHEN VALUES(first_year) IS NULL THEN first_year WHEN first_year IS NULL THEN VALUES(first_year) ELSE LEAST(first_year,VALUES(first_year)) END,last_year=CASE WHEN VALUES(last_year) IS NULL THEN last_year WHEN last_year IS NULL THEN VALUES(last_year) ELSE GREATEST(last_year,VALUES(last_year)) END")
            .bind(hash).bind(key).bind(iccs).bind(notation).bind(red).bind(draw).bind(black)
            .bind(game.game_date.map(|date| date.format("%Y").to_string().parse::<u16>().unwrap_or_default())).bind(game.game_date.map(|date| date.format("%Y").to_string().parse::<u16>().unwrap_or_default()))
            .execute(&mut **transaction).await?;
    }
    record_published_opening(transaction, &game_id, game).await?;
    sqlx::query("INSERT IGNORE INTO reference_migration_cursors (task_name,game_id) VALUES (?,?)")
        .bind(POSITION_BACKFILL_TASK)
        .bind(&game_id)
        .execute(&mut **transaction)
        .await?;
    Ok(game_id)
}

async fn update_reference_game_metadata(
    transaction: &mut Transaction<'_, MySql>,
    game_id: &str,
    game: &PublishGame,
    license_proof: &str,
) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE master_games SET title=?,red_player=?,black_player=?,event_name=?,round_name=?,
         game_date=?,result=?,opening=?,starting_fen=?,move_count=?,moves_json=?,moves_hash=?,
         validation_status='valid',ingestion_version=2,license_note=? WHERE id=?",
    )
    .bind(&game.title)
    .bind(&game.red_player)
    .bind(&game.black_player)
    .bind(&game.event_name)
    .bind(&game.round_name)
    .bind(game.game_date)
    .bind(&game.result)
    .bind(&game.opening)
    .bind(&game.starting_fen)
    .bind(game.moves.len() as u32)
    .bind(serde_json::to_value(&game.moves).map_err(|_| ApiError::Internal)?)
    .bind(&game.moves_hash)
    .bind(license_proof)
    .bind(game_id)
    .execute(&mut **transaction)
    .await?;
    record_published_opening(transaction, game_id, game).await?;
    refresh_position_statistics_for_game(transaction, game_id).await
}

async fn record_published_opening(
    transaction: &mut Transaction<'_, MySql>,
    game_id: &str,
    game: &PublishGame,
) -> Result<(), ApiError> {
    let version: Option<u64> = sqlx::query_scalar(
        "SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&mut **transaction)
    .await?;
    if let Some(version) = version {
        sqlx::query(
            "UPDATE game_opening_classifications SET is_primary=0
             WHERE game_id=? AND classifier_version_id=? AND is_primary=1",
        )
        .bind(game_id)
        .bind(version)
        .execute(&mut **transaction)
        .await?;
    }
    if let Some(code) = game.opening_code.as_deref() {
        let series = &code[..1];
        let category_name = game
            .opening
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(code);
        sqlx::query(
            "INSERT IGNORE INTO opening_categories
             (code,series_code,parent_code,name,sort_order)
             VALUES (?,?,?,?,?)",
        )
        .bind(code)
        .bind(series)
        .bind((code.len() > 1).then_some(series))
        .bind(category_name)
        .bind(
            code.get(1..)
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0),
        )
        .execute(&mut **transaction)
        .await?;
        if let Some(version) = version {
            sqlx::query("INSERT INTO game_opening_classifications (game_id,category_code,candidate_codes_json,method,confidence,matched_plies,classifier_version_id,is_primary,status) VALUES (?,?,JSON_ARRAY(?),'published',1.0,0,?,1,'classified')")
            .bind(game_id).bind(code).bind(code).bind(version).execute(&mut **transaction).await?;
        }
    }
    Ok(())
}

async fn deactivate_orphaned_reference_game(
    transaction: &mut Transaction<'_, MySql>,
    game_id: &str,
) -> Result<(), ApiError> {
    let source_site: Option<String> =
        sqlx::query_scalar("SELECT source_site FROM master_games WHERE id=? FOR UPDATE")
            .bind(game_id)
            .fetch_optional(&mut **transaction)
            .await?;
    if source_site.as_deref() != Some("reference") {
        return Ok(());
    }
    let remaining_sources: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM master_game_sources WHERE game_id=?")
            .bind(game_id)
            .fetch_one(&mut **transaction)
            .await?;
    if remaining_sources > 0 {
        return Ok(());
    }
    sqlx::query("UPDATE master_games SET validation_status='superseded' WHERE id=?")
        .bind(game_id)
        .execute(&mut **transaction)
        .await?;
    refresh_position_statistics_for_game(transaction, game_id).await
}

async fn refresh_position_statistics_for_game(
    transaction: &mut Transaction<'_, MySql>,
    game_id: &str,
) -> Result<(), ApiError> {
    let affected: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT position_hash,position_key,move_iccs
         FROM master_game_moves WHERE game_id=?",
    )
    .bind(game_id)
    .fetch_all(&mut **transaction)
    .await?;
    for (position_hash, position_key, move_iccs) in affected {
        let notation: Option<String> = sqlx::query_scalar(
            "SELECT notation FROM reference_position_move_stats
             WHERE position_hash=? AND position_key=? AND move_iccs=?",
        )
        .bind(&position_hash)
        .bind(&position_key)
        .bind(&move_iccs)
        .fetch_optional(&mut **transaction)
        .await?;
        let counts: (i64, i64, i64, i64, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT CAST(COUNT(*) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='1-0'),0) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='1/2-1/2'),0) AS SIGNED),
                    CAST(COALESCE(SUM(g.result='0-1'),0) AS SIGNED),
                    MIN(YEAR(g.game_date)),MAX(YEAR(g.game_date))
             FROM master_game_moves m JOIN master_games g ON g.id=m.game_id
             WHERE m.position_hash=? AND m.position_key=? AND m.move_iccs=?
               AND g.validation_status='valid'",
        )
        .bind(&position_hash)
        .bind(&position_key)
        .bind(&move_iccs)
        .fetch_one(&mut **transaction)
        .await?;
        sqlx::query(
            "DELETE FROM reference_position_move_stats
             WHERE position_hash=? AND position_key=? AND move_iccs=?",
        )
        .bind(&position_hash)
        .bind(&position_key)
        .bind(&move_iccs)
        .execute(&mut **transaction)
        .await?;
        if counts.0 > 0 {
            sqlx::query(
                "INSERT INTO reference_position_move_stats
                 (position_hash,position_key,move_iccs,notation,samples,red_wins,draws,black_wins,first_year,last_year)
                 VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(position_hash)
            .bind(position_key)
            .bind(&move_iccs)
            .bind(notation.unwrap_or_else(|| move_iccs.clone()))
            .bind(counts.0)
            .bind(counts.1)
            .bind(counts.2)
            .bind(counts.3)
            .bind(counts.4)
            .bind(counts.5)
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

async fn upsert_game_source(
    transaction: &mut Transaction<'_, MySql>,
    source_id: &str,
    game_id: &str,
    game: &PublishGame,
) -> Result<(), ApiError> {
    let source_url = reference_source_url(source_id, game);
    sqlx::query(
        "INSERT INTO master_game_sources
         (game_id,source_site,source_url,source_title,raw_notation_type,record_hash)
         VALUES (?,'reference',?,?, 'CBL',?)
         ON DUPLICATE KEY UPDATE game_id=VALUES(game_id),source_title=VALUES(source_title),
           record_hash=VALUES(record_hash),last_seen_at=CURRENT_TIMESTAMP(6)",
    )
    .bind(game_id)
    .bind(source_url)
    .bind(&game.title)
    .bind(&game.record_hash)
    .execute(&mut **transaction)
    .await?;
    sqlx::query("UPDATE master_games SET validation_status='valid' WHERE id=?")
        .bind(game_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn attach_known_players(
    transaction: &mut Transaction<'_, MySql>,
    game_id: &str,
    game: &PublishGame,
) -> Result<(), ApiError> {
    for (side, name) in [("red", &game.red_player), ("black", &game.black_player)] {
        let normalized = normalize_name(name);
        if normalized.is_empty() {
            continue;
        }
        sqlx::query(
            "INSERT IGNORE INTO master_game_player_refs
             (master_player_id,game_id,side,source_site,source_player_id)
             SELECT id,?,?,source_site,source_player_id FROM master_players
             WHERE normalized_name=?",
        )
        .bind(game_id)
        .bind(side)
        .bind(normalized)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

fn reference_source_url(source_id: &str, game: &PublishGame) -> String {
    reference_source_url_parts(source_id, &game.relative_path, game.record_index)
}

fn reference_source_url_parts(source_id: &str, relative_path: &str, record_index: u32) -> String {
    format!(
        "reference://{source_id}/{}/{}",
        Sha256::digest(relative_path.as_bytes())
            .iter()
            .take(8)
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
        record_index
    )
}

fn validate_publish_removal(removal: &PublishRemoval) -> Result<(), ApiError> {
    if removal.relative_path.trim().is_empty() {
        return Err(ApiError::Invalid("removal relativePath is required".into()));
    }
    if !is_sha256_hex(&removal.record_hash) {
        return Err(ApiError::Invalid(
            "removal recordHash must be SHA-256 hex".into(),
        ));
    }
    Ok(())
}

fn validate_publish_game(game: &PublishGame) -> Result<(), ApiError> {
    if !is_sha256_hex(&game.canonical_fingerprint)
        || !is_sha256_hex(&game.moves_hash)
        || !is_sha256_hex(&game.record_hash)
        || !is_sha256_hex(&game.file_sha256)
    {
        return Err(ApiError::Invalid("fingerprints must be SHA-256 hex".into()));
    }
    if normalize_name(&game.red_player).is_empty()
        || normalize_name(&game.black_player).is_empty()
        || game.game_date.is_none()
    {
        return Err(ApiError::Invalid(
            "complete player and date identity is required for publication".into(),
        ));
    }
    if game
        .opening_code
        .as_deref()
        .is_some_and(|code| !is_opening_code(code))
    {
        return Err(ApiError::Invalid(
            "openingCode must be A-E or A00-E99".into(),
        ));
    }
    if game.relative_path.starts_with('/') || looks_like_local_path(&game.relative_path) {
        return Err(ApiError::Invalid(
            "relativePath must not contain a local absolute path".into(),
        ));
    }
    if looks_like_local_path(game.license_note.trim()) {
        return Err(ApiError::Invalid(
            "licenseNote must not contain a local path".into(),
        ));
    }
    let mut board = Board::from_fen(&game.starting_fen)
        .map_err(|error| ApiError::Invalid(error.to_string()))?;
    let starting_position_key = board.rule_position_key();
    for iccs in &game.moves {
        board = board
            .apply_iccs(iccs)
            .map_err(|error| ApiError::Invalid(format!("illegal move {iccs}: {error}")))?;
    }
    let expected_moves_hash = digest_text(&game.moves.join(" "));
    if !game.moves_hash.eq_ignore_ascii_case(&expected_moves_hash) {
        return Err(ApiError::Invalid("movesHash does not match moves".into()));
    }
    let expected_fingerprint = digest_text(&format!(
        "{}|{}|{}|{}|{}",
        starting_position_key,
        normalize_name(&game.red_player),
        normalize_name(&game.black_player),
        game.game_date
            .map(|date| date.format("%Y-%m-%d").to_string())
            .unwrap_or_default(),
        game.moves.join(" ")
    ));
    if !game
        .canonical_fingerprint
        .eq_ignore_ascii_case(&expected_fingerprint)
    {
        return Err(ApiError::Invalid(
            "canonicalFingerprint does not match game identity".into(),
        ));
    }
    Ok(())
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_opening_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() == 1 || bytes.len() == 3)
        && matches!(bytes.first(), Some(b'A'..=b'E'))
        && (bytes.len() == 1 || bytes[1..].iter().all(u8::is_ascii_digit))
}

fn is_publishable_license(value: &str) -> bool {
    matches!(value.trim(), "authorized" | "public-domain" | "self-owned")
}

fn digest_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

fn nonnegative(value: i64) -> u64 {
    value.max(0) as u64
}
fn parent_for_code(code: &str) -> Option<String> {
    is_opening_code(code)
        .then(|| code.get(..1).map(str::to_owned))
        .flatten()
}
fn short_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))[..32].to_owned()
}
fn result_counts(result: &str) -> (u64, u64, u64) {
    match result {
        "1-0" => (1, 0, 0),
        "0-1" => (0, 0, 1),
        "1/2-1/2" => (0, 1, 0),
        _ => (0, 0, 0),
    }
}
fn empty_none(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}
fn looks_like_local_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("file:")
        || value.starts_with('~')
        || value.as_bytes().get(1) == Some(&b':')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_publish_game() -> PublishGame {
        let moves = vec!["h2e2".to_owned()];
        let date = chrono::NaiveDate::from_ymd_opt(2026, 9, 8).unwrap();
        let board = Board::from_fen(xiangqi_core::STARTING_FEN).unwrap();
        let moves_hash = digest_text(&moves.join(" "));
        let canonical_fingerprint = digest_text(&format!(
            "{}|{}|{}|{}|{}",
            board.rule_position_key(),
            "赵鑫鑫",
            "王天一",
            date.format("%Y-%m-%d"),
            moves.join(" ")
        ));
        PublishGame {
            relative_path: "2026/第一轮.CBL".into(),
            file_sha256: "f".repeat(64),
            record_index: 0,
            record_hash: "a".repeat(64),
            canonical_fingerprint,
            moves_hash,
            title: "测试棋谱".into(),
            red_player: "赵 鑫鑫".into(),
            black_player: "王天一".into(),
            event_name: Some("测试赛".into()),
            round_name: Some("1".into()),
            game_date: Some(date),
            result: "1-0".into(),
            opening: Some("C03".into()),
            starting_fen: xiangqi_core::STARTING_FEN.into(),
            moves,
            opening_code: Some("C03".into()),
            license_note: "authorized".into(),
        }
    }

    #[test]
    fn publish_validation_recomputes_hashes_and_accepts_uppercase_hex() {
        let mut game = valid_publish_game();
        game.record_hash.make_ascii_uppercase();
        game.moves_hash.make_ascii_uppercase();
        game.canonical_fingerprint.make_ascii_uppercase();
        assert!(validate_publish_game(&game).is_ok());
    }

    #[test]
    fn publish_validation_rejects_tampered_hashes() {
        let mut game = valid_publish_game();
        game.moves_hash = "b".repeat(64);
        assert!(matches!(
            validate_publish_game(&game),
            Err(ApiError::Invalid(message)) if message.contains("movesHash")
        ));

        let mut game = valid_publish_game();
        game.canonical_fingerprint = "c".repeat(64);
        assert!(matches!(
            validate_publish_game(&game),
            Err(ApiError::Invalid(message)) if message.contains("canonicalFingerprint")
        ));
    }

    #[test]
    fn publish_validation_rejects_incomplete_identity_and_file_hash() {
        let mut game = valid_publish_game();
        game.red_player.clear();
        assert!(matches!(
            validate_publish_game(&game),
            Err(ApiError::Invalid(message)) if message.contains("identity")
        ));

        let mut game = valid_publish_game();
        game.file_sha256 = "not-a-sha".into();
        assert!(matches!(
            validate_publish_game(&game),
            Err(ApiError::Invalid(message)) if message.contains("SHA-256")
        ));
    }

    #[test]
    fn removal_validation_uses_the_same_stable_source_identity() {
        let game = valid_publish_game();
        let removal = PublishRemoval {
            relative_path: game.relative_path.clone(),
            record_index: game.record_index,
            record_hash: game.record_hash.clone(),
        };
        assert!(validate_publish_removal(&removal).is_ok());
        assert_eq!(
            reference_source_url("source", &game),
            reference_source_url_parts("source", &removal.relative_path, removal.record_index)
        );
    }

    #[test]
    fn publication_license_status_is_an_explicit_allowlist() {
        for allowed in ["authorized", "public-domain", "self-owned"] {
            assert!(is_publishable_license(allowed));
        }
        for rejected in ["", "unreviewed", "local-only", "unknown", "authorized-ish"] {
            assert!(!is_publishable_license(rejected));
        }
    }

    #[test]
    fn parent_code_handles_untrusted_unicode_without_panicking() {
        assert_eq!(parent_for_code("中文"), None);
        assert_eq!(parent_for_code("C03"), Some("C".into()));
    }

    #[test]
    fn realistic_250_game_chunk_fits_the_publish_route_limit() {
        let game = valid_publish_game();
        let request = PublishBatchRequest {
            source_id: Uuid::new_v4().to_string(),
            client_batch_id: Uuid::new_v4().to_string(),
            parser_version: 3,
            games: vec![game; 250],
            removed_records: Vec::new(),
        };
        let body = serde_json::to_vec(&request).unwrap();
        assert!(body.len() > 32 * 1024);
        assert!(body.len() < crate::router::REFERENCE_PUBLISH_BODY_LIMIT);
    }
}
