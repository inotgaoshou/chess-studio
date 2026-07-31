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
