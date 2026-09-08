CREATE TABLE IF NOT EXISTS master_player_source_refs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  master_player_id CHAR(36) NOT NULL,
  source_site VARCHAR(64) NOT NULL,
  source_player_id VARCHAR(128) NOT NULL,
  source_name VARCHAR(80) NOT NULL,
  profile_url VARCHAR(512) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_player_source_ref (source_site, source_player_id),
  KEY idx_master_player_source_player (master_player_id),
  CONSTRAINT fk_master_player_source_player FOREIGN KEY (master_player_id) REFERENCES master_players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='棋手多来源身份映射';

CREATE TABLE IF NOT EXISTS reference_sources (
  id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  public_locator VARCHAR(512) NULL COMMENT '可公开来源说明；禁止本地绝对路径',
  license_status VARCHAR(32) NOT NULL,
  license_note VARCHAR(512) NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_reference_sources_active (active, updated_at),
  CONSTRAINT fk_reference_sources_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='共享参考棋谱来源登记';

CREATE TABLE IF NOT EXISTS reference_import_batches (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  client_batch_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'publishing',
  review_status VARCHAR(24) NOT NULL DEFAULT 'approved',
  parser_version INT UNSIGNED NOT NULL,
  imported_records INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_records INT UNSIGNED NOT NULL DEFAULT 0,
  invalid_records INT UNSIGNED NOT NULL DEFAULT 0,
  published_by CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  UNIQUE KEY uk_reference_client_batch (source_id, client_batch_id),
  CONSTRAINT fk_reference_batch_source FOREIGN KEY (source_id) REFERENCES reference_sources(id),
  CONSTRAINT fk_reference_batch_publisher FOREIGN KEY (published_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审核后发布到共享库的批次';

CREATE TABLE IF NOT EXISTS reference_import_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  relative_path VARCHAR(512) NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  record_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_reference_batch_file (batch_id, relative_path, file_sha256),
  CONSTRAINT fk_reference_file_batch FOREIGN KEY (batch_id) REFERENCES reference_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='共享批次文件证明';

CREATE TABLE IF NOT EXISTS reference_import_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  relative_path VARCHAR(512) NOT NULL,
  record_index INT UNSIGNED NOT NULL,
  record_hash CHAR(64) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL,
  game_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_reference_source_record (batch_id, relative_path, record_index, record_hash),
  KEY idx_reference_record_game (game_id),
  CONSTRAINT fk_reference_record_batch FOREIGN KEY (batch_id) REFERENCES reference_import_batches(id),
  CONSTRAINT fk_reference_record_game FOREIGN KEY (game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='共享导入记录审计';

CREATE TABLE IF NOT EXISTS opening_series (
  code CHAR(1) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='A-E布局系列';

INSERT IGNORE INTO opening_series (code,name,sort_order) VALUES
 ('A','非中炮类',0),('B','中炮对反宫马及其他',1),('C','中炮对屏风马',2),
 ('D','顺炮与列炮',3),('E','仙人指路与对兵局',4);

CREATE TABLE IF NOT EXISTS opening_categories (
  code VARCHAR(8) PRIMARY KEY,
  series_code CHAR(1) NOT NULL,
  parent_code VARCHAR(8) NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_opening_categories_parent (parent_code, sort_order),
  CONSTRAINT fk_opening_category_series FOREIGN KEY (series_code) REFERENCES opening_series(code),
  CONSTRAINT fk_opening_category_parent FOREIGN KEY (parent_code) REFERENCES opening_categories(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='规范布局父子目录';

INSERT IGNORE INTO opening_categories (code,series_code,parent_code,name,sort_order) VALUES
 ('A','A',NULL,'非中炮类',0),('B','B',NULL,'中炮对反宫马及其他',1),
 ('C','C',NULL,'中炮对屏风马',2),('D','D',NULL,'顺炮与列炮',3),
 ('E','E',NULL,'仙人指路与对兵局',4);

CREATE TABLE IF NOT EXISTS opening_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_code VARCHAR(8) NOT NULL,
  alias VARCHAR(255) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'migration',
  reviewed TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_opening_alias (alias, category_code),
  KEY idx_opening_alias_lookup (alias, reviewed),
  CONSTRAINT fk_opening_alias_category FOREIGN KEY (category_code) REFERENCES opening_categories(code),
  CONSTRAINT fk_opening_alias_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='原始布局名称到规范编码的映射';

CREATE TABLE IF NOT EXISTS opening_classifier_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可切换布局分类器版本';

CREATE TABLE IF NOT EXISTS opening_patterns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  classifier_version_id BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(8) NOT NULL,
  pattern_type VARCHAR(24) NOT NULL,
  move_prefix_json JSON NULL,
  position_key VARCHAR(255) NULL,
  match_depth INT UNSIGNED NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  support_count INT UNSIGNED NOT NULL DEFAULT 0,
  KEY idx_opening_pattern_match (classifier_version_id, pattern_type, match_depth, priority),
  CONSTRAINT fk_opening_pattern_version FOREIGN KEY (classifier_version_id) REFERENCES opening_classifier_versions(id),
  CONSTRAINT fk_opening_pattern_category FOREIGN KEY (category_code) REFERENCES opening_categories(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='着法前缀和关键局面分类规则';

CREATE TABLE IF NOT EXISTS game_opening_classifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  category_code VARCHAR(8) NULL,
  candidate_codes_json JSON NOT NULL,
  method VARCHAR(32) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  matched_plies INT UNSIGNED NOT NULL,
  classifier_version_id BIGINT UNSIGNED NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_game_opening_current (game_id, classifier_version_id, is_primary),
  KEY idx_game_opening_browse (category_code, status, is_primary),
  CONSTRAINT fk_game_opening_game FOREIGN KEY (game_id) REFERENCES master_games(id),
  CONSTRAINT fk_game_opening_category FOREIGN KEY (category_code) REFERENCES opening_categories(code),
  CONSTRAINT fk_game_opening_version FOREIGN KEY (classifier_version_id) REFERENCES opening_classifier_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='版本化棋局布局分类结果';

CREATE TABLE IF NOT EXISTS reference_position_move_stats (
  position_hash CHAR(32) NOT NULL,
  position_key VARCHAR(255) NOT NULL,
  move_iccs CHAR(4) NOT NULL,
  notation VARCHAR(24) NOT NULL,
  samples BIGINT UNSIGNED NOT NULL,
  red_wins BIGINT UNSIGNED NOT NULL,
  draws BIGINT UNSIGNED NOT NULL,
  black_wins BIGINT UNSIGNED NOT NULL,
  first_year SMALLINT UNSIGNED NULL,
  last_year SMALLINT UNSIGNED NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (position_hash, position_key, move_iccs),
  KEY idx_reference_position_samples (position_hash, samples)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='默认全库局面候选统计';

CREATE TABLE IF NOT EXISTS reference_migration_cursors (
  task_name VARCHAR(64) NOT NULL,
  game_id CHAR(36) NOT NULL,
  completed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (task_name, game_id),
  KEY idx_reference_migration_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可暂停、恢复和幂等重跑的参考库补索引游标';
