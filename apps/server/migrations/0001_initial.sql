CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY COMMENT '用户 UUID',
  email VARCHAR(320) NOT NULL UNIQUE COMMENT '登录邮箱，规范化为小写',
  password_hash VARCHAR(255) NOT NULL COMMENT 'Argon2 密码哈希',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '注册时间',
  deleted_at TIMESTAMP(6) NULL COMMENT '软删除时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='同步服务用户';

CREATE TABLE IF NOT EXISTS games (
  id CHAR(36) PRIMARY KEY COMMENT '棋局 UUID',
  owner_id CHAR(36) NOT NULL COMMENT '所属用户 UUID',
  title VARCHAR(255) NOT NULL COMMENT '棋局标题',
  starting_fen VARCHAR(255) NULL COMMENT '起始局面 FEN',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间',
  deleted_at TIMESTAMP(6) NULL COMMENT '软删除时间',
  INDEX idx_games_owner_updated (owner_id, updated_at),
  CONSTRAINT fk_games_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户云端棋局索引';

CREATE TABLE IF NOT EXISTS operations (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '服务端递增同步游标',
  op_id CHAR(36) NOT NULL UNIQUE COMMENT '客户端操作 UUID，用于幂等',
  user_id CHAR(36) NOT NULL COMMENT '所属用户 UUID',
  device_id CHAR(36) NOT NULL COMMENT '发起操作的设备 UUID',
  entity_id CHAR(36) NOT NULL COMMENT '被操作实体 UUID',
  game_id CHAR(36) NOT NULL COMMENT '所属棋局 UUID',
  kind VARCHAR(40) NOT NULL COMMENT '操作类型',
  payload JSON NOT NULL COMMENT '操作负载 JSON',
  lamport BIGINT UNSIGNED NOT NULL COMMENT '客户端 Lamport 时钟',
  created_at TIMESTAMP(6) NOT NULL COMMENT '客户端创建时间',
  received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '服务端接收时间',
  INDEX idx_operations_user_sequence (user_id, sequence_id),
  INDEX idx_operations_game_sequence (game_id, sequence_id),
  CONSTRAINT fk_operations_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_operations_game FOREIGN KEY (game_id) REFERENCES games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='棋谱同步操作日志';

CREATE TABLE IF NOT EXISTS device_cursors (
  user_id CHAR(36) NOT NULL COMMENT '用户 UUID',
  device_id CHAR(36) NOT NULL COMMENT '设备 UUID',
  `cursor` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该设备已拉取的最大操作序号',
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '游标更新时间',
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT fk_device_cursors_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备同步进度';

CREATE TABLE IF NOT EXISTS subscription_entitlements (
  user_id CHAR(36) PRIMARY KEY COMMENT '用户 UUID',
  plan VARCHAR(32) NOT NULL COMMENT '套餐，例如 free 或 pro',
  status VARCHAR(32) NOT NULL COMMENT '权益状态，例如 active 或 revoked',
  source VARCHAR(32) NOT NULL COMMENT '开通来源，例如 redemption_code',
  starts_at TIMESTAMP(6) NOT NULL COMMENT '权益开始时间',
  expires_at TIMESTAMP(6) NOT NULL COMMENT '权益到期时间',
  cloud_analysis_quota INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前 30 天周期云分析额度',
  cloud_analysis_used INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前周期已用云分析次数',
  usage_period_started_at TIMESTAMP(6) NOT NULL COMMENT '当前额度周期开始时间',
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '权益更新时间',
  CONSTRAINT fk_entitlements_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户订阅权益与云分析配额';

CREATE TABLE IF NOT EXISTS redemption_codes (
  id CHAR(36) PRIMARY KEY COMMENT '兑换码记录 UUID',
  code_hash CHAR(64) NOT NULL UNIQUE COMMENT '规范化明文兑换码的 SHA-256 哈希',
  plan VARCHAR(32) NOT NULL DEFAULT 'pro' COMMENT '兑换后授予的套餐',
  duration_days INT UNSIGNED NOT NULL COMMENT '权益有效天数',
  cloud_analysis_quota INT UNSIGNED NOT NULL COMMENT '每个额度周期可用云分析次数',
  max_redemptions INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '最大核销次数',
  redemption_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已核销次数',
  starts_at TIMESTAMP(6) NOT NULL COMMENT '兑换码生效时间',
  expires_at TIMESTAMP(6) NOT NULL COMMENT '兑换码截止时间',
  revoked_at TIMESTAMP(6) NULL COMMENT '撤销时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人工发放的 Pro 兑换码';

CREATE TABLE IF NOT EXISTS code_redemptions (
  code_id CHAR(36) NOT NULL COMMENT '兑换码记录 UUID',
  user_id CHAR(36) NOT NULL COMMENT '核销用户 UUID',
  redeemed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '核销时间',
  PRIMARY KEY (code_id, user_id),
  CONSTRAINT fk_code_redemptions_code FOREIGN KEY (code_id) REFERENCES redemption_codes(id),
  CONSTRAINT fk_code_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='兑换码核销明细';

CREATE TABLE IF NOT EXISTS product_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '事件递增编号',
  user_id CHAR(36) NULL COMMENT '关联用户 UUID，可为空',
  event_name VARCHAR(64) NOT NULL COMMENT '产品事件名称',
  occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '事件发生时间',
  INDEX idx_product_events_name_time (event_name, occurred_at),
  CONSTRAINT fk_product_events_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品运营事件';

CREATE TABLE IF NOT EXISTS master_players (
  id CHAR(36) PRIMARY KEY COMMENT '大师 UUID',
  name VARCHAR(80) NOT NULL COMMENT '棋手名，如赵鑫鑫',
  normalized_name VARCHAR(80) NOT NULL COMMENT '规范化姓名，用于检索',
  source_site VARCHAR(64) NOT NULL COMMENT '来源站点，如 gdchess.com',
  source_player_id VARCHAR(64) NOT NULL COMMENT '来源棋手 ID，如广象网 0074',
  profile_url VARCHAR(512) NOT NULL COMMENT '来源棋手页',
  country_region VARCHAR(80) NULL COMMENT '地区/单位，可选',
  title_label VARCHAR(40) NULL COMMENT '称号，如特级大师',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_source_player (source_site, source_player_id),
  KEY idx_master_name (normalized_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公开大师棋手索引';

CREATE TABLE IF NOT EXISTS master_games (
  id CHAR(36) PRIMARY KEY COMMENT '棋谱 UUID',
  master_player_id CHAR(36) NOT NULL COMMENT '关联大师',
  source_site VARCHAR(64) NOT NULL COMMENT '主来源站点',
  source_url VARCHAR(512) NOT NULL COMMENT '主来源 URL',
  title VARCHAR(255) NOT NULL COMMENT '棋谱标题',
  red_player VARCHAR(80) NOT NULL COMMENT '红方',
  black_player VARCHAR(80) NOT NULL COMMENT '黑方',
  event_name VARCHAR(255) NULL COMMENT '赛事',
  round_name VARCHAR(80) NULL COMMENT '轮次',
  game_date DATE NULL COMMENT '比赛日期',
  result VARCHAR(16) NOT NULL DEFAULT '*' COMMENT '1-0/0-1/1/2-1/2/*',
  opening VARCHAR(255) NULL COMMENT '开局名称',
  move_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '半回合数',
  moves_json JSON NOT NULL COMMENT 'ICCS 着法数组',
  raw_notation_type VARCHAR(40) NOT NULL COMMENT 'MOVE_STR/DhtmlXQ/PGN等',
  fingerprint CHAR(64) NOT NULL COMMENT '去重指纹',
  license_note VARCHAR(512) NOT NULL COMMENT '来源许可说明',
  crawl_status VARCHAR(40) NOT NULL DEFAULT 'parsed',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_game_fingerprint (fingerprint),
  KEY idx_master_games_player_date (master_player_id, game_date),
  KEY idx_master_games_players (red_player, black_player),
  KEY idx_master_games_event (event_name),
  CONSTRAINT fk_master_games_player FOREIGN KEY (master_player_id) REFERENCES master_players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公开大师棋谱主表';

CREATE TABLE IF NOT EXISTS master_game_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  source_site VARCHAR(64) NOT NULL,
  source_url VARCHAR(512) NOT NULL,
  source_title VARCHAR(255) NULL,
  raw_notation_type VARCHAR(40) NULL,
  first_seen_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_game_source_url (source_url),
  KEY idx_master_game_sources_game (game_id),
  CONSTRAINT fk_master_game_sources_game FOREIGN KEY (game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='同一棋谱的多个公开来源';

CREATE TABLE IF NOT EXISTS master_game_moves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  ply INT UNSIGNED NOT NULL COMMENT '半回合序号，从1开始',
  move_no INT UNSIGNED NOT NULL COMMENT '回合数',
  side_to_move VARCHAR(8) NOT NULL COMMENT 'red/black',
  move_iccs CHAR(4) NOT NULL COMMENT 'ICCS着法，如c3c4',
  before_fen VARCHAR(255) NOT NULL COMMENT '走子前FEN',
  after_fen VARCHAR(255) NULL COMMENT '走子后FEN',
  piece CHAR(1) NULL COMMENT '移动子力',
  captured CHAR(1) NULL COMMENT '被吃子力',
  phase VARCHAR(16) NOT NULL COMMENT 'opening/middle/endgame',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_game_ply (game_id, ply),
  KEY idx_master_moves_fen (before_fen),
  KEY idx_master_moves_move (move_iccs),
  KEY idx_master_moves_phase (phase),
  CONSTRAINT fk_master_moves_game FOREIGN KEY (game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公开大师棋谱逐步展开表';

CREATE TABLE IF NOT EXISTS master_position_samples (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  master_player_id CHAR(36) NOT NULL,
  game_id CHAR(36) NOT NULL,
  ply INT UNSIGNED NOT NULL,
  master_side VARCHAR(8) NOT NULL COMMENT 'red/black',
  phase VARCHAR(16) NOT NULL,
  before_fen VARCHAR(255) NOT NULL,
  played_move CHAR(4) NOT NULL,
  engine_analysis_id BIGINT UNSIGNED NULL COMMENT '后续可关联Pikafish分析',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_sample (master_player_id, game_id, ply),
  KEY idx_master_samples_fen (before_fen),
  KEY idx_master_samples_player_phase (master_player_id, phase),
  KEY idx_master_samples_game_ply (game_id, ply),
  CONSTRAINT fk_master_samples_player FOREIGN KEY (master_player_id) REFERENCES master_players(id),
  CONSTRAINT fk_master_samples_game FOREIGN KEY (game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='大师实际选择着法训练样本';

CREATE TABLE IF NOT EXISTS master_position_analysis (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sample_id BIGINT UNSIGNED NOT NULL,
  engine_name VARCHAR(80) NOT NULL DEFAULT 'Pikafish',
  engine_fingerprint VARCHAR(255) NOT NULL,
  depth INT UNSIGNED NULL,
  multipv INT UNSIGNED NOT NULL,
  candidates_json JSON NOT NULL COMMENT 'MultiPV候选、评分、PV',
  played_move_rank INT UNSIGNED NULL COMMENT '实战着在MultiPV中的排名',
  played_move_in_topn TINYINT(1) NOT NULL DEFAULT 0,
  best_move CHAR(4) NULL,
  best_score_cp INT NULL,
  analyzed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_master_analysis_config (sample_id, engine_fingerprint, depth, multipv),
  KEY idx_master_analysis_best_move (best_move),
  CONSTRAINT fk_master_analysis_sample FOREIGN KEY (sample_id) REFERENCES master_position_samples(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='大师实战局面Pikafish分析';

CREATE TABLE IF NOT EXISTS user_master_game_favorites (
  user_id CHAR(36) NOT NULL,
  master_game_id CHAR(36) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, master_game_id),
  CONSTRAINT fk_umgf_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_umgf_game FOREIGN KEY (master_game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户收藏的大师棋谱';

CREATE TABLE IF NOT EXISTS user_master_training_refs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  sample_id BIGINT UNSIGNED NOT NULL,
  training_task_id CHAR(36) NULL,
  note TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_umtr_user (user_id, created_at),
  KEY idx_umtr_sample (sample_id),
  CONSTRAINT fk_umtr_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_umtr_sample FOREIGN KEY (sample_id) REFERENCES master_position_samples(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户训练任务引用的大师局面';
