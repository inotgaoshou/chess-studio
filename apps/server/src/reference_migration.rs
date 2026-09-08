use sqlx::MySqlPool;

pub(crate) async fn migrate_reference_library(pool: &MySqlPool) -> Result<(), sqlx::Error> {
    add_column(pool, "users", "role", "ALTER TABLE users ADD COLUMN role VARCHAR(24) NOT NULL DEFAULT 'user' COMMENT 'user/admin'").await?;
    make_column_nullable(
        pool,
        "master_games",
        "master_player_id",
        "ALTER TABLE master_games MODIFY master_player_id CHAR(36) NULL COMMENT '兼容字段；非大师参考棋局可为空'",
    )
    .await?;
    add_column(
        pool,
        "master_games",
        "starting_fen",
        "ALTER TABLE master_games ADD COLUMN starting_fen VARCHAR(255) NULL AFTER opening",
    )
    .await?;
    add_column(
        pool,
        "master_games",
        "canonical_fingerprint",
        "ALTER TABLE master_games ADD COLUMN canonical_fingerprint CHAR(64) NULL AFTER fingerprint",
    )
    .await?;
    add_column(
        pool,
        "master_games",
        "moves_hash",
        "ALTER TABLE master_games ADD COLUMN moves_hash CHAR(64) NULL AFTER canonical_fingerprint",
    )
    .await?;
    add_column(pool, "master_games", "validation_status", "ALTER TABLE master_games ADD COLUMN validation_status VARCHAR(24) NOT NULL DEFAULT 'valid' AFTER moves_hash").await?;
    add_column(pool, "master_games", "ingestion_version", "ALTER TABLE master_games ADD COLUMN ingestion_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER validation_status").await?;
    add_column(
        pool,
        "master_game_moves",
        "position_key",
        "ALTER TABLE master_game_moves ADD COLUMN position_key VARCHAR(255) NULL AFTER before_fen",
    )
    .await?;
    add_column(
        pool,
        "master_game_sources",
        "record_hash",
        "ALTER TABLE master_game_sources ADD COLUMN record_hash CHAR(64) NULL AFTER raw_notation_type",
    )
    .await?;
    add_column(
        pool,
        "master_game_moves",
        "position_hash",
        "ALTER TABLE master_game_moves ADD COLUMN position_hash CHAR(32) NULL AFTER position_key",
    )
    .await?;
    drop_index_if_exists(pool, "master_games", "uk_master_canonical_fingerprint").await?;
    add_index(
        pool,
        "master_games",
        "idx_master_canonical_fingerprint",
        "ALTER TABLE master_games ADD KEY idx_master_canonical_fingerprint (canonical_fingerprint)",
    )
    .await?;
    add_index(pool, "master_game_moves", "idx_master_moves_position_move", "ALTER TABLE master_game_moves ADD KEY idx_master_moves_position_move (position_hash,move_iccs)").await?;
    sqlx::raw_sql(include_str!("../migrations/0004_reference_library_v2.sql"))
        .execute(pool)
        .await?;
    Ok(())
}

async fn make_column_nullable(
    pool: &MySqlPool,
    table: &str,
    column: &str,
    sql: &str,
) -> Result<(), sqlx::Error> {
    let is_nullable: Option<String> = sqlx::query_scalar(
        "SELECT IS_NULLABLE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
    )
    .bind(table)
    .bind(column)
    .fetch_optional(pool)
    .await?;
    if is_nullable.as_deref() == Some("NO") {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

async fn add_column(
    pool: &MySqlPool,
    table: &str,
    column: &str,
    sql: &str,
) -> Result<(), sqlx::Error> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
    ).bind(table).bind(column).fetch_one(pool).await?;
    if exists == 0 {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

async fn add_index(
    pool: &MySqlPool,
    table: &str,
    index: &str,
    sql: &str,
) -> Result<(), sqlx::Error> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?",
    ).bind(table).bind(index).fetch_one(pool).await?;
    if exists == 0 {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

async fn drop_index_if_exists(
    pool: &MySqlPool,
    table: &str,
    index: &str,
) -> Result<(), sqlx::Error> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?",
    ).bind(table).bind(index).fetch_one(pool).await?;
    if exists > 0 {
        let sql = format!("ALTER TABLE `{table}` DROP INDEX `{index}`");
        sqlx::query(&sql).execute(pool).await?;
    }
    Ok(())
}
