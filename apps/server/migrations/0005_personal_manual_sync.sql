CREATE TABLE IF NOT EXISTS personal_manual_records (
    user_id CHAR(36) NOT NULL,
    record_kind VARCHAR(16) NOT NULL,
    record_id VARCHAR(191) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    deleted_at DATETIME(6) NULL,
    payload_json JSON NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
    PRIMARY KEY (user_id, record_kind, record_id),
    KEY idx_personal_manual_records_user_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS personal_manual_sync_status (
    user_id CHAR(36) NOT NULL,
    last_synced_at DATETIME(6) NOT NULL,
    game_count INT UNSIGNED NOT NULL DEFAULT 0,
    folder_count INT UNSIGNED NOT NULL DEFAULT 0,
    analysis_count INT UNSIGNED NOT NULL DEFAULT 0,
    conflict_count INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS personal_provider_imports (
    user_id CHAR(36) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    external_id VARCHAR(191) NOT NULL,
    payload_hash VARCHAR(191) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    snapshot_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
    PRIMARY KEY (user_id, provider, external_id),
    KEY idx_personal_provider_imports_user_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
