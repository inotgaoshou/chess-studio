use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub(crate) struct MasterLibraryQuery {
    query: Option<String>,
    side: Option<String>,
    opening: Option<String>,
    year: Option<u16>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedMasterGamesRequest {
    topic_id: String,
    fens: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterPlayerDto {
    id: String,
    name: String,
    source_site: String,
    source_player_id: String,
    profile_url: String,
    game_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterLibraryStatsDto {
    total_players: u64,
    total_games: u64,
    matched_players: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterOpeningProfileDto {
    player_id: String,
    player_name: String,
    game_count: u64,
    red_games: u64,
    black_games: u64,
    wins: u64,
    draws: u64,
    losses: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterGameSummaryDto {
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
    opening_tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MasterGameDetailDto {
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
    opening_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedMasterGameDto {
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
pub(crate) async fn backfill_master_opening_tags(pool: &sqlx::MySqlPool) -> anyhow::Result<()> {
    for (tag, predicate) in [
        ("middle-cannon", "m.ply = 1 AND m.move_iccs = 'h2e2'"),
        ("third-pawn", "m.move_iccs = 'g3g4' AND m.ply <= 20"),
        (
            "middle-cannon-third-pawn",
            "m.ply = 1 AND m.move_iccs = 'h2e2' AND EXISTS (SELECT 1 FROM master_game_moves p WHERE p.game_id = m.game_id AND p.move_iccs = 'g3g4' AND p.ply <= 20)",
        ),
    ] {
        let statement = format!(
            "INSERT IGNORE INTO master_game_opening_tags (game_id, tag) SELECT DISTINCT m.game_id, ? FROM master_game_moves m WHERE {predicate}"
        );
        sqlx::query(&statement).bind(tag).execute(pool).await?;
    }
    Ok(())
}
pub(crate) async fn list_master_players(
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

pub(crate) async fn master_library_stats(
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

pub(crate) async fn list_master_player_games(
    State(state): State<AppState>,
    AxumPath(player_id): AxumPath<String>,
    Query(query): Query<MasterLibraryQuery>,
) -> Result<Json<Vec<MasterGameSummaryDto>>, ApiError> {
    let search = normalized_search_term(query.query.as_deref());
    let like = sql_like_term(&search);
    let side = query.side.unwrap_or_default();
    let opening = query.opening.unwrap_or_default();
    let year = query.year.unwrap_or(0).clamp(0, 9999);
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
        Option<String>,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT g.id, g.title, g.red_player, g.black_player, r.side,
                g.game_date, g.event_name, g.result,
                CAST(g.move_count AS SIGNED) AS move_count, g.source_url,
                (SELECT GROUP_CONCAT(t.tag ORDER BY t.tag SEPARATOR ',') FROM master_game_opening_tags t WHERE t.game_id = g.id) AS opening_tags
         FROM master_game_player_refs r
         INNER JOIN master_games g ON g.id = r.game_id
         WHERE r.master_player_id = ?
           AND (? = '' OR r.side = ?)
           AND (? = 0 OR YEAR(g.game_date) = ?)
           AND (? = '' OR EXISTS (SELECT 1 FROM master_game_opening_tags t WHERE t.game_id = g.id AND t.tag = ?))
           AND (? = '' OR g.title LIKE ? OR g.red_player LIKE ? OR g.black_player LIKE ? OR g.event_name LIKE ?)
         ORDER BY g.game_date DESC, g.created_at DESC, g.id DESC
         LIMIT ? OFFSET ?",
    )
    .bind(player_id)
    .bind(&side)
    .bind(&side)
    .bind(year)
    .bind(year)
    .bind(&opening)
    .bind(&opening)
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
                    opening_tags,
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
                    opening_tags: opening_tags
                        .as_deref()
                        .unwrap_or_default()
                        .split(',')
                        .filter(|tag| !tag.is_empty())
                        .map(str::to_owned)
                        .collect(),
                },
            )
            .collect(),
    ))
}

pub(crate) async fn master_opening_profile(
    State(state): State<AppState>,
    AxumPath(player_id): AxumPath<String>,
) -> Result<Json<MasterOpeningProfileDto>, ApiError> {
    type Row = (String, String, i64, i64, i64, i64, i64, i64);
    let row: Option<Row> = sqlx::query_as(
        "SELECT p.id, p.name,
                CAST(COUNT(r.game_id) AS SIGNED),
                CAST(COALESCE(SUM(r.side = 'red'), 0) AS SIGNED),
                CAST(COALESCE(SUM(r.side = 'black'), 0) AS SIGNED),
                CAST(COALESCE(SUM((r.side = 'red' AND g.result = '1-0') OR (r.side = 'black' AND g.result = '0-1')), 0) AS SIGNED),
                CAST(COALESCE(SUM(g.result IN ('1/2-1/2', '1/2')), 0) AS SIGNED),
                CAST(COALESCE(SUM((r.side = 'red' AND g.result = '0-1') OR (r.side = 'black' AND g.result = '1-0')), 0) AS SIGNED)
         FROM master_players p
         LEFT JOIN master_game_player_refs r ON r.master_player_id = p.id
         LEFT JOIN master_games g ON g.id = r.game_id
         WHERE p.id = ?
         GROUP BY p.id, p.name",
    )
    .bind(player_id)
    .fetch_optional(&state.pool)
    .await?;
    let (player_id, player_name, game_count, red_games, black_games, wins, draws, losses) =
        row.ok_or_else(|| ApiError::Invalid("master player not found".into()))?;
    Ok(Json(MasterOpeningProfileDto {
        player_id,
        player_name,
        game_count: game_count.max(0) as u64,
        red_games: red_games.max(0) as u64,
        black_games: black_games.max(0) as u64,
        wins: wins.max(0) as u64,
        draws: draws.max(0) as u64,
        losses: losses.max(0) as u64,
    }))
}

pub(crate) async fn find_related_master_games(
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
        return Err(ApiError::Invalid(
            "at least one legal checkpoint FEN is required".into(),
        ));
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
        for (
            id,
            title,
            red_player,
            black_player,
            event_name,
            game_date,
            result,
            move_count,
            source_url,
            matched_ply,
            matched_fen,
            divergence_move,
        ) in rows
        {
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

pub(crate) async fn master_game_detail(
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
        Option<String>,
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT id, title, red_player, black_player, event_name, game_date, result,
                CAST(move_count AS SIGNED) AS move_count, source_url, moves_json,
                (SELECT GROUP_CONCAT(tag ORDER BY tag SEPARATOR ',') FROM master_game_opening_tags WHERE game_id = master_games.id) AS opening_tags
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
        opening_tags,
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
        opening_tags: opening_tags
            .as_deref()
            .unwrap_or_default()
            .split(',')
            .filter(|tag| !tag.is_empty())
            .map(str::to_owned)
            .collect(),
    }))
}

pub(crate) fn normalized_search_term(value: Option<&str>) -> String {
    value.unwrap_or_default().trim().chars().take(80).collect()
}

pub(crate) fn sql_like_term(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

pub(crate) struct MasterGamePgn<'a> {
    pub(crate) title: &'a str,
    pub(crate) event_name: Option<&'a str>,
    pub(crate) site: &'a str,
    pub(crate) game_date: Option<&'a str>,
    pub(crate) red_player: &'a str,
    pub(crate) black_player: &'a str,
    pub(crate) result: &'a str,
    pub(crate) moves: &'a [String],
}

pub(crate) fn build_master_game_pgn(game: MasterGamePgn<'_>) -> String {
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

pub(crate) fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

pub(crate) fn escape_pgn_tag(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
