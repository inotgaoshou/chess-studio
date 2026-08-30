CREATE TABLE IF NOT EXISTS external_game_sources (
  owner_id CHAR(36) NOT NULL COMMENT '所属用户 UUID',
  provider VARCHAR(64) NOT NULL COMMENT '外部棋谱提供方，例如 ttxq',
  external_id VARCHAR(191) NOT NULL COMMENT '提供方棋谱标识，不含账号信息',
  game_id CHAR(36) NOT NULL COMMENT '当前对应的本地棋局 UUID',
  source_format VARCHAR(64) NOT NULL COMMENT '来源格式，例如 ttxq-h5',
  payload_hash VARCHAR(80) NOT NULL COMMENT '内容 SHA-256，用于去重和修订判断',
  imported_at VARCHAR(40) NOT NULL COMMENT '客户端导入时间 RFC3339',
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (owner_id, provider, external_id),
  INDEX idx_external_game_sources_game (game_id),
  CONSTRAINT fk_external_game_sources_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_external_game_sources_game FOREIGN KEY (game_id) REFERENCES games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='外部棋谱来源索引；不保存账号凭据或原始网页数据';
