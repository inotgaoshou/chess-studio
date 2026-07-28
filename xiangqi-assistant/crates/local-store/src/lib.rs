use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use sync_protocol::Operation;
use thiserror::Error;
use uuid::Uuid;
use xiangqi_core::Move;
use xiangqi_manual::MoveNode;

pub struct LocalGame {
    pub id: Uuid,
    pub title: String,
    pub starting_fen: String,
    pub root_id: Uuid,
    pub current_node_id: Option<Uuid>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub struct LocalStore {
    connection: Connection,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    pub fn save_game_with_operation(
        &mut self,
        game_id: Uuid,
        title: &str,
        fen: &str,
        root_id: Uuid,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO games (id, title, starting_fen, root_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, starting_fen=excluded.starting_fen, root_id=excluded.root_id, updated_at=excluded.updated_at",
            params![game_id.to_string(), title, fen, root_id.to_string(), operation.created_at.to_rfc3339()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn pending_operations(&self, limit: usize) -> Result<Vec<Operation>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at
             FROM operations WHERE uploaded = 0 ORDER BY local_sequence LIMIT ?1",
        )?;
        let rows = statement.query_map([limit as i64], |row| {
            let created_at: String = row.get(7)?;
            let kind: String = row.get(4)?;
            let payload: String = row.get(5)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                kind,
                payload,
                row.get::<_, i64>(6)? as u64,
                created_at,
            ))
        })?;
        let mut operations = Vec::new();
        for row in rows {
            let (op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at) = row?;
            operations.push(Operation {
                op_id: Uuid::parse_str(&op_id).map_err(json_error)?,
                device_id: Uuid::parse_str(&device_id).map_err(json_error)?,
                entity_id: Uuid::parse_str(&entity_id).map_err(json_error)?,
                game_id: Uuid::parse_str(&game_id).map_err(json_error)?,
                kind: serde_json::from_str(&kind)?,
                payload: serde_json::from_str(&payload)?,
                lamport,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_at)
                    .map_err(json_error)?
                    .with_timezone(&chrono::Utc),
            });
        }
        Ok(operations)
    }

    pub fn mark_uploaded(&mut self, op_ids: &[Uuid]) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        for op_id in op_ids {
            transaction.execute(
                "UPDATE operations SET uploaded = 1 WHERE op_id = ?1",
                [op_id.to_string()],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_move_with_operation(
        &mut self,
        node_id: Uuid,
        game_id: Uuid,
        parent_id: Option<Uuid>,
        move_iccs: &str,
        comment: &str,
        order_key: u64,
        is_mainline: bool,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO move_nodes (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET comment=excluded.comment, order_key=excluded.order_key,
             is_mainline=excluded.is_mainline, deleted_at=NULL",
            params![node_id.to_string(), game_id.to_string(), parent_id.map(|id| id.to_string()), move_iccs, comment, order_key as i64, is_mainline as i32],
        )?;
        transaction.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                node_id.to_string(),
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn apply_remote_operation(
        &mut self,
        operation: &Operation,
        cursor: u64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        insert_operation(&transaction, operation, true)?;
        transaction.execute(
            "INSERT INTO sync_state (key, value) VALUES ('remote_cursor', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [cursor.to_string()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn remote_cursor(&self) -> Result<u64, StoreError> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = 'remote_cursor'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    pub fn load_latest_game(&self) -> Result<Option<LocalGame>, StoreError> {
        let row: Option<(String, String, String, String, Option<String>)> = self.connection.query_row(
            "SELECT id, title, starting_fen, root_id, current_node_id FROM games WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        row.map(|(id, title, starting_fen, root_id, current_node_id)| {
            Ok(LocalGame {
                id: Uuid::parse_str(&id).map_err(json_error)?,
                title,
                starting_fen,
                root_id: Uuid::parse_str(&root_id).map_err(json_error)?,
                current_node_id: current_node_id
                    .map(|id| Uuid::parse_str(&id).map_err(json_error))
                    .transpose()?,
            })
        })
        .transpose()
    }

    pub fn load_move_nodes(&self, game_id: Uuid) -> Result<Vec<MoveNode>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, move_iccs, comment, is_mainline, deleted_at IS NOT NULL, order_key
             FROM move_nodes WHERE game_id = ?1 ORDER BY order_key",
        )?;
        let rows = statement.query_map([game_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        let mut nodes = Vec::new();
        for row in rows {
            let (id, parent_id, move_iccs, comment, is_mainline, deleted, order_key) = row?;
            nodes.push(MoveNode {
                id: Uuid::parse_str(&id).map_err(json_error)?,
                parent_id: Uuid::parse_str(&parent_id).map_err(json_error)?,
                mv: Move::from_iccs(&move_iccs).map_err(json_error)?,
                comment,
                is_mainline,
                deleted,
                order_key: order_key as u64,
            });
        }
        Ok(nodes)
    }

    fn initialize(connection: Connection) -> Result<Self, StoreError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS games (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, starting_fen TEXT NOT NULL,
               root_id TEXT NOT NULL, current_node_id TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE IF NOT EXISTS move_nodes (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, parent_id TEXT,
               move_iccs TEXT NOT NULL, cn_move TEXT, comment TEXT NOT NULL DEFAULT '',
               order_key INTEGER NOT NULL, is_mainline INTEGER NOT NULL DEFAULT 0,
               deleted_at TEXT, FOREIGN KEY(game_id) REFERENCES games(id)
             );
             CREATE INDEX IF NOT EXISTS idx_move_nodes_parent ON move_nodes(game_id, parent_id, order_key);
             CREATE TABLE IF NOT EXISTS operations (
               local_sequence INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE,
               device_id TEXT NOT NULL, entity_id TEXT NOT NULL, game_id TEXT NOT NULL,
               kind TEXT NOT NULL, payload TEXT NOT NULL, lamport INTEGER NOT NULL,
               created_at TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_operations_outbox ON operations(uploaded, local_sequence);
             CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS engine_profiles (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, executable_path TEXT NOT NULL,
               protocol TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}'
             );
             CREATE TABLE IF NOT EXISTS analysis_results (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, node_id TEXT,
               engine_fingerprint TEXT NOT NULL, config_hash TEXT NOT NULL,
               depth INTEGER, score_cp INTEGER, mate INTEGER, pv_json TEXT NOT NULL,
               elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
               UNIQUE(game_id, node_id, engine_fingerprint, config_hash)
             );",
        )?;
        Ok(Self { connection })
    }
}

fn insert_operation(
    connection: &Connection,
    operation: &Operation,
    uploaded: bool,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT OR IGNORE INTO operations
         (op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at, uploaded)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            operation.op_id.to_string(),
            operation.device_id.to_string(),
            operation.entity_id.to_string(),
            operation.game_id.to_string(),
            serde_json::to_string(&operation.kind)?,
            serde_json::to_string(&operation.payload)?,
            operation.lamport as i64,
            operation.created_at.to_rfc3339(),
            uploaded as i32,
        ],
    )?;
    Ok(())
}

fn json_error(error: impl std::fmt::Display) -> serde_json::Error {
    serde_json::Error::io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;
    use sync_protocol::OperationKind;

    use super::*;

    fn operation(game_id: Uuid) -> Operation {
        Operation {
            op_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            entity_id: game_id,
            game_id,
            kind: OperationKind::CreateGame,
            payload: json!({"title":"Study"}),
            lamport: 1,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn local_write_and_outbox_are_committed_together() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Study", "fen", Uuid::new_v4(), &op)
            .unwrap();
        assert_eq!(store.pending_operations(10).unwrap(), vec![op.clone()]);
        store.mark_uploaded(&[op.op_id]).unwrap();
        assert!(store.pending_operations(10).unwrap().is_empty());
    }

    #[test]
    fn duplicate_operation_is_idempotent() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        let root_id = Uuid::new_v4();
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        assert_eq!(store.pending_operations(10).unwrap().len(), 1);
    }

    #[test]
    fn latest_game_and_move_tree_can_be_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Study", "fen", root_id, &op)
            .unwrap();
        let node_id = Uuid::new_v4();
        let move_op = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::AddMove,
            lamport: 2,
            ..operation(game_id)
        };
        store
            .save_move_with_operation(
                node_id,
                game_id,
                Some(root_id),
                "a0a1",
                "first",
                0,
                true,
                &move_op,
            )
            .unwrap();

        let restored = store.load_latest_game().unwrap().unwrap();
        assert_eq!(restored.id, game_id);
        assert_eq!(restored.root_id, root_id);
        assert_eq!(restored.current_node_id, Some(node_id));
        assert_eq!(
            store.load_move_nodes(game_id).unwrap()[0].mv.to_iccs(),
            "a0a1"
        );
    }
}
