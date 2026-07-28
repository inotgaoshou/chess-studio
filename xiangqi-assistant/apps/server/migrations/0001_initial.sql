CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at TIMESTAMP(6) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS games (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  starting_fen VARCHAR(255) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at TIMESTAMP(6) NULL,
  INDEX idx_games_owner_updated (owner_id, updated_at),
  CONSTRAINT fk_games_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS operations (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  op_id CHAR(36) NOT NULL UNIQUE,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  game_id CHAR(36) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  payload JSON NOT NULL,
  lamport BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_operations_user_sequence (user_id, sequence_id),
  INDEX idx_operations_game_sequence (game_id, sequence_id),
  CONSTRAINT fk_operations_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_operations_game FOREIGN KEY (game_id) REFERENCES games(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_cursors (
  user_id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  cursor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT fk_device_cursors_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
