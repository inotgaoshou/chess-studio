use anyhow::Context;
use sha2::{Digest, Sha256};
use sqlx::{MySqlPool, Row, mysql::MySqlPoolOptions};
use std::env;
use xiangqi_core::{Board, Color, Move, STARTING_FEN};

#[path = "../reference_migration.rs"]
mod reference_migration;

const TASK: &str = "reference-v2-position-index";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let batch_size = env_value("REFERENCE_BACKFILL_BATCH_SIZE", 250usize).clamp(1, 2_000);
    let max_batches = env_value("REFERENCE_BACKFILL_MAX_BATCHES", usize::MAX);
    let pool = MySqlPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await?;
    reference_migration::migrate_reference_library(&pool).await?;
    let classifier_version = ensure_classifier_version(&pool).await?;
    let mut completed = 0usize;
    let mut invalid = 0usize;
    for batch in 0..max_batches {
        let rows = sqlx::query(
            "SELECT g.id,g.starting_fen,g.red_player,g.black_player,g.game_date,g.result,g.opening,g.moves_json
             FROM master_games g
             LEFT JOIN reference_migration_cursors c ON c.task_name=? AND c.game_id=g.id
             WHERE c.game_id IS NULL AND g.ingestion_version<2 ORDER BY g.id LIMIT ?",
        )
        .bind(TASK)
        .bind(batch_size as u32)
        .fetch_all(&pool)
        .await?;
        if rows.is_empty() {
            println!("参考库补索引完成：成功 {completed}，非法 {invalid}");
            break;
        }
        for row in rows {
            let game_id: String = row.try_get("id")?;
            let starting_fen: Option<String> = row.try_get("starting_fen")?;
            let red_player: String = row.try_get("red_player")?;
            let black_player: String = row.try_get("black_player")?;
            let game_date: Option<chrono::NaiveDate> = row.try_get("game_date")?;
            let result: String = row.try_get("result")?;
            let opening: Option<String> = row.try_get("opening")?;
            let moves_json: serde_json::Value = row.try_get("moves_json")?;
            let moves: Vec<String> = serde_json::from_value(moves_json).unwrap_or_default();
            let fen = starting_fen
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(STARTING_FEN);
            match backfill_game(
                &pool,
                BackfillGame {
                    id: &game_id,
                    starting_fen: fen,
                    red_player: &red_player,
                    black_player: &black_player,
                    game_date,
                    result: &result,
                    opening: opening.as_deref(),
                    moves: &moves,
                },
                classifier_version,
            )
            .await
            {
                Ok(()) => completed += 1,
                Err(error) => {
                    invalid += 1;
                    sqlx::query("UPDATE master_games SET validation_status='invalid' WHERE id=?")
                        .bind(&game_id)
                        .execute(&pool)
                        .await?;
                    sqlx::query("INSERT IGNORE INTO reference_migration_cursors (task_name,game_id) VALUES (?,?)")
                        .bind(TASK).bind(&game_id).execute(&pool).await?;
                    eprintln!("跳过非法棋局 {game_id}：{error}");
                }
            }
        }
        println!(
            "批次 {} 完成：累计成功 {completed}，非法 {invalid}",
            batch + 1
        );
    }
    Ok(())
}

struct BackfillGame<'a> {
    id: &'a str,
    starting_fen: &'a str,
    red_player: &'a str,
    black_player: &'a str,
    game_date: Option<chrono::NaiveDate>,
    result: &'a str,
    opening: Option<&'a str>,
    moves: &'a [String],
}

async fn backfill_game(
    pool: &MySqlPool,
    game: BackfillGame<'_>,
    classifier_version: u64,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let mut board = Board::from_fen(game.starting_fen)?;
    let moves_hash = sha256(&game.moves.join(" "));
    let canonical = sha256(&format!(
        "{}|{}|{}|{}|{}",
        board.rule_position_key(),
        normalize_name(game.red_player),
        normalize_name(game.black_player),
        game.game_date
            .map(|date| date.to_string())
            .unwrap_or_default(),
        game.moves.join(" ")
    ));
    sqlx::query("UPDATE master_games SET starting_fen=?,moves_hash=?,canonical_fingerprint=COALESCE(canonical_fingerprint,?),validation_status='valid',ingestion_version=2 WHERE id=?")
        .bind(game.starting_fen).bind(moves_hash).bind(canonical).bind(game.id)
        .execute(&mut *transaction).await?;
    for (index, iccs) in game.moves.iter().enumerate() {
        let mv = Move::from_iccs(iccs)?;
        let before_fen = board.to_fen();
        let position_key = board.rule_position_key();
        let position_hash = &sha256(&position_key)[..32];
        let notation = board.chinese_move_notation(mv)?;
        let side = if board.side_to_move() == Color::Red {
            "red"
        } else {
            "black"
        };
        board = board.apply_move(mv)?;
        sqlx::query(
            "INSERT INTO master_game_moves (game_id,ply,move_no,side_to_move,move_iccs,before_fen,position_key,position_hash,after_fen,phase)
             VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE before_fen=VALUES(before_fen),position_key=VALUES(position_key),position_hash=VALUES(position_hash),after_fen=VALUES(after_fen)",
        ).bind(game.id).bind(index as u32+1).bind(index as u32/2+1).bind(side).bind(iccs)
          .bind(before_fen).bind(&position_key).bind(position_hash).bind(board.to_fen())
          .bind(if index<30 {"opening"} else if index<80 {"middle"} else {"endgame"})
          .execute(&mut *transaction).await?;
        let (red, draw, black) = result_counts(game.result);
        let year = game.game_date.map(|date| {
            date.format("%Y")
                .to_string()
                .parse::<u16>()
                .unwrap_or_default()
        });
        sqlx::query(
            "INSERT INTO reference_position_move_stats (position_hash,position_key,move_iccs,notation,samples,red_wins,draws,black_wins,first_year,last_year)
             VALUES (?,?,?,?,1,?,?,?,?,?) ON DUPLICATE KEY UPDATE samples=samples+1,red_wins=red_wins+VALUES(red_wins),draws=draws+VALUES(draws),black_wins=black_wins+VALUES(black_wins),first_year=IF(VALUES(first_year) IS NULL,first_year,LEAST(COALESCE(first_year,VALUES(first_year)),VALUES(first_year))),last_year=IF(VALUES(last_year) IS NULL,last_year,GREATEST(COALESCE(last_year,VALUES(last_year)),VALUES(last_year)))",
        ).bind(position_hash).bind(position_key).bind(iccs).bind(notation).bind(red).bind(draw).bind(black).bind(year).bind(year)
          .execute(&mut *transaction).await?;
    }
    if game.starting_fen == STARTING_FEN {
        if let Some((code, alias)) = game.opening.and_then(trusted_opening_code) {
            let category_name =
                alias
                    .strip_prefix(&code)
                    .unwrap_or(alias)
                    .trim_matches(|character: char| {
                        character.is_whitespace() || matches!(character, '-' | ':' | '：')
                    });
            sqlx::query("INSERT IGNORE INTO opening_categories (code,series_code,parent_code,name,sort_order) VALUES (?,?,?,?,?)")
                .bind(&code).bind(&code[..1]).bind(&code[..1])
                .bind(if category_name.is_empty() { alias } else { category_name })
                .bind(code[1..].parse::<i32>().unwrap_or_default())
                .execute(&mut *transaction).await?;
            sqlx::query("INSERT IGNORE INTO opening_aliases (category_code,alias,source,reviewed) VALUES (?,?,'existing-opening',0)")
                .bind(&code).bind(alias).execute(&mut *transaction).await?;
            sqlx::query("INSERT INTO game_opening_classifications (game_id,category_code,candidate_codes_json,method,confidence,matched_plies,classifier_version_id,is_primary,status) VALUES (?,?,JSON_ARRAY(?),'trusted_code',1.0,0,?,1,'classified')")
                .bind(game.id).bind(&code).bind(&code).bind(classifier_version).execute(&mut *transaction).await?;
        }
    }
    sqlx::query("INSERT INTO reference_migration_cursors (task_name,game_id) VALUES (?,?)")
        .bind(TASK)
        .bind(game.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}

async fn ensure_classifier_version(pool: &MySqlPool) -> anyhow::Result<u64> {
    sqlx::query("INSERT IGNORE INTO opening_classifier_versions (name,status,active) VALUES ('existing-opening-v1','active',1)")
        .execute(pool).await?;
    let id: u64 = sqlx::query_scalar(
        "SELECT id FROM opening_classifier_versions WHERE name='existing-opening-v1'",
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}

fn trusted_opening_code(value: &str) -> Option<(String, &str)> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .find_map(|token| {
            let upper = token.to_ascii_uppercase();
            let bytes = upper.as_bytes();
            ((bytes.len() == 1 || bytes.len() == 3)
                && matches!(bytes.first(), Some(b'A'..=b'E'))
                && (bytes.len() == 1 || bytes[1..].iter().all(u8::is_ascii_digit)))
            .then_some((upper, value))
        })
}
fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect()
}
fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn result_counts(value: &str) -> (u64, u64, u64) {
    match value {
        "1-0" => (1, 0, 0),
        "0-1" => (0, 0, 1),
        "1/2-1/2" => (0, 1, 0),
        _ => (0, 0, 0),
    }
}
fn env_value<T: std::str::FromStr>(name: &str, default: T) -> T {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
