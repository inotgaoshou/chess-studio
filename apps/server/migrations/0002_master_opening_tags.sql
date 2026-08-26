-- Keep raw source opening text unchanged. These tags are derived from the
-- recorded ICCS main line and can be rebuilt safely for an existing library.
CREATE TABLE IF NOT EXISTS master_game_opening_tags (
  game_id CHAR(36) NOT NULL,
  tag VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (game_id, tag),
  KEY idx_master_opening_tag_game (tag, game_id),
  CONSTRAINT fk_master_opening_tag_game FOREIGN KEY (game_id) REFERENCES master_games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='由公开棋谱主线识别的大师布局标签';
