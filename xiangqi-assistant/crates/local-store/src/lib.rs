use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use std::path::Path;
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    SetMainlinePayload, UpdateCommentPayload,
};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnalysisSummary {
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    pub fn device_id(&mut self) -> Result<Uuid, StoreError> {
        if let Some(value) = self.sync_value("device_id")? {
            return Uuid::parse_str(&value)
                .map_err(json_error)
                .map_err(Into::into);
        }
        let device_id = Uuid::new_v4();
        self.set_sync_value("device_id", &device_id.to_string())?;
        Ok(device_id)
    }

    pub fn max_lamport(&self) -> Result<u64, StoreError> {
        let value: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(lamport), 0) FROM operations",
            [],
            |row| row.get(0),
        )?;
        Ok(value.max(0) as u64)
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
        if is_mainline {
            transaction.execute(
                "UPDATE move_nodes SET is_mainline = 0
                 WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL",
                params![game_id.to_string(), parent_id.map(|id| id.to_string())],
            )?;
        }
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

    pub fn update_comment_with_operation(
        &mut self,
        node_id: Uuid,
        comment: &str,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE move_nodes SET comment = ?1 WHERE id = ?2",
            params![comment, node_id.to_string()],
        )?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![
                operation.created_at.to_rfc3339(),
                operation.game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_mainline_with_operation(
        &mut self,
        game_id: Uuid,
        parent_id: Uuid,
        node_id: Uuid,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE move_nodes SET is_mainline = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE game_id = ?2 AND parent_id = ?3 AND deleted_at IS NULL",
            params![
                node_id.to_string(),
                game_id.to_string(),
                parent_id.to_string()
            ],
        )?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![operation.created_at.to_rfc3339(), game_id.to_string()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_node_with_operation(
        &mut self,
        game_id: Uuid,
        node_id: Uuid,
        current_node_id: Option<Uuid>,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "WITH RECURSIVE subtree(id) AS (
               SELECT id FROM move_nodes WHERE id = ?2
               UNION ALL
               SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
             )
             UPDATE move_nodes SET deleted_at = ?1 WHERE id IN (SELECT id FROM subtree)",
            params![operation.created_at.to_rfc3339(), node_id.to_string()],
        )?;
        promote_first_live_sibling(&transaction, node_id)?;
        transaction.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                current_node_id.map(|id| id.to_string()),
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_current_node(
        &mut self,
        game_id: Uuid,
        current_node_id: Option<Uuid>,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                current_node_id.map(|id| id.to_string()),
                chrono::Utc::now().to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        Ok(())
    }

    pub fn save_engine_profile(
        &mut self,
        name: &str,
        executable_path: &str,
        protocol: &str,
    ) -> Result<Uuid, StoreError> {
        let existing: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM engine_profiles WHERE executable_path = ?1 LIMIT 1",
                [executable_path],
                |row| row.get(0),
            )
            .optional()?;
        let id = existing
            .map(|value| Uuid::parse_str(&value).map_err(json_error))
            .transpose()?
            .unwrap_or_else(Uuid::new_v4);
        self.connection.execute(
            "INSERT INTO engine_profiles (id, name, executable_path, protocol)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,
             executable_path=excluded.executable_path, protocol=excluded.protocol",
            params![id.to_string(), name, executable_path, protocol],
        )?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_analysis(
        &mut self,
        game_id: Uuid,
        node_id: Option<Uuid>,
        engine_fingerprint: &str,
        config_hash: &str,
        depth: Option<u32>,
        score_cp: Option<i32>,
        mate: Option<i32>,
        pv_json: &str,
        elapsed_ms: u64,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO analysis_results
             (id, game_id, node_id, engine_fingerprint, config_hash, depth,
              score_cp, mate, pv_json, elapsed_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(game_id, node_id, engine_fingerprint, config_hash)
             DO UPDATE SET depth=excluded.depth, score_cp=excluded.score_cp,
             mate=excluded.mate, pv_json=excluded.pv_json,
             elapsed_ms=excluded.elapsed_ms, created_at=excluded.created_at",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                node_id.map(|id| id.to_string()),
                engine_fingerprint,
                config_hash,
                depth,
                score_cp,
                mate,
                pv_json,
                elapsed_ms as i64,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn load_latest_analysis(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
    ) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT pv_json FROM analysis_results
                 WHERE game_id = ?1 AND node_id IS ?2
                 ORDER BY created_at DESC LIMIT 1",
                params![game_id.to_string(), node_id.map(|id| id.to_string())],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn load_latest_analysis_summaries(
        &self,
        game_id: Uuid,
    ) -> Result<HashMap<Uuid, AnalysisSummary>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT node_id, score_cp, mate FROM analysis_results
             WHERE game_id = ?1 AND node_id IS NOT NULL
             ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = statement.query_map([game_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i32>>(1)?,
                row.get::<_, Option<i32>>(2)?,
            ))
        })?;
        let mut summaries = HashMap::new();
        for row in rows {
            let (node_id, score_cp, mate) = row?;
            let node_id = Uuid::parse_str(&node_id).map_err(json_error)?;
            summaries
                .entry(node_id)
                .or_insert(AnalysisSummary { score_cp, mate });
        }
        Ok(summaries)
    }

    pub fn apply_remote_operation(
        &mut self,
        operation: &Operation,
        cursor: u64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        project_operation(&transaction, operation)?;
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
        let value = self.sync_value("remote_cursor")?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    pub fn load_game(&self, game_id: Uuid) -> Result<Option<LocalGame>, StoreError> {
        self.load_game_where(
            "WHERE id = ?1 AND deleted_at IS NULL",
            [game_id.to_string()],
        )
    }

    pub fn load_latest_game(&self) -> Result<Option<LocalGame>, StoreError> {
        self.load_game_where(
            "WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
            [],
        )
    }

    fn load_game_where<const N: usize>(
        &self,
        clause: &str,
        params: [String; N],
    ) -> Result<Option<LocalGame>, StoreError> {
        let sql =
            format!("SELECT id, title, starting_fen, root_id, current_node_id FROM games {clause}");
        let row: Option<(String, String, String, String, Option<String>)> = self
            .connection
            .query_row(&sql, rusqlite::params_from_iter(params), |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .optional()?;
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

    fn sync_value(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    fn set_sync_value(&mut self, key: &str, value: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
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
             );
             UPDATE operations
             SET payload = json_set(
               payload,
               '$.rootId',
               (SELECT root_id FROM games WHERE games.id = operations.game_id)
             )
             WHERE kind = '\"create_game\"'
               AND json_extract(payload, '$.rootId') IS NULL;",
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

fn project_operation(connection: &Connection, operation: &Operation) -> Result<(), StoreError> {
    match operation.kind {
        OperationKind::CreateGame => {
            let payload: CreateGamePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "INSERT INTO games (id, title, starting_fen, root_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                 starting_fen=excluded.starting_fen, root_id=excluded.root_id,
                 updated_at=excluded.updated_at, deleted_at=NULL",
                params![
                    operation.game_id.to_string(),
                    payload.title,
                    payload.fen,
                    payload.root_id.to_string(),
                    operation.created_at.to_rfc3339()
                ],
            )?;
        }
        OperationKind::AddMove => {
            let payload: AddMovePayload = serde_json::from_value(operation.payload.clone())?;
            if payload.is_mainline {
                connection.execute(
                    "UPDATE move_nodes SET is_mainline = 0
                     WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL",
                    params![operation.game_id.to_string(), payload.parent_id.to_string()],
                )?;
            }
            connection.execute(
                "INSERT INTO move_nodes
                 (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline)
                 VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,
                 move_iccs=excluded.move_iccs, order_key=excluded.order_key,
                 is_mainline=excluded.is_mainline, deleted_at=NULL",
                params![
                    payload.node_id.to_string(),
                    operation.game_id.to_string(),
                    payload.parent_id.to_string(),
                    payload.move_iccs,
                    payload.order_key as i64,
                    payload.is_mainline as i32
                ],
            )?;
            connection.execute(
                "UPDATE games SET current_node_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    payload.node_id.to_string(),
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::UpdateComment => {
            let payload: UpdateCommentPayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "UPDATE move_nodes SET comment = ?1 WHERE id = ?2 AND game_id = ?3",
                params![
                    payload.comment,
                    payload.node_id.to_string(),
                    operation.game_id.to_string()
                ],
            )?;
            connection.execute(
                "UPDATE games SET updated_at = ?1 WHERE id = ?2",
                params![
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::SetMainline => {
            let payload: SetMainlinePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "UPDATE move_nodes SET is_mainline = CASE WHEN id = ?1 THEN 1 ELSE 0 END
                 WHERE game_id = ?2 AND parent_id = ?3 AND deleted_at IS NULL",
                params![
                    payload.node_id.to_string(),
                    operation.game_id.to_string(),
                    payload.parent_id.to_string()
                ],
            )?;
            connection.execute(
                "UPDATE games SET updated_at = ?1 WHERE id = ?2",
                params![
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::DeleteNode => {
            let payload: DeleteNodePayload = serde_json::from_value(operation.payload.clone())?;
            connection.execute(
                "WITH RECURSIVE subtree(id) AS (
                   SELECT id FROM move_nodes WHERE id = ?2 AND game_id = ?3
                   UNION ALL
                   SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
                 )
                 UPDATE move_nodes SET deleted_at = ?1 WHERE id IN (SELECT id FROM subtree)",
                params![
                    operation.created_at.to_rfc3339(),
                    payload.node_id.to_string(),
                    operation.game_id.to_string()
                ],
            )?;
            connection.execute(
                "WITH RECURSIVE subtree(id) AS (
                   SELECT id FROM move_nodes WHERE id = ?1 AND game_id = ?3
                   UNION ALL
                   SELECT child.id FROM move_nodes child JOIN subtree ON child.parent_id = subtree.id
                 )
                 UPDATE games SET current_node_id = CASE
                   WHEN (SELECT parent_id FROM move_nodes WHERE id = ?1) = root_id THEN NULL
                   ELSE (SELECT parent_id FROM move_nodes WHERE id = ?1)
                 END, updated_at = ?2
                 WHERE id = ?3 AND current_node_id IN (SELECT id FROM subtree)",
                params![
                    payload.node_id.to_string(),
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
            promote_first_live_sibling(connection, payload.node_id)?;
        }
    }
    Ok(())
}

fn promote_first_live_sibling(
    connection: &Connection,
    deleted_node_id: Uuid,
) -> Result<(), StoreError> {
    let parent_id: Option<String> = connection
        .query_row(
            "SELECT parent_id FROM move_nodes WHERE id = ?1",
            [deleted_node_id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(parent_id) = parent_id {
        connection.execute(
            "UPDATE move_nodes SET is_mainline = 1
             WHERE id = (
               SELECT id FROM move_nodes
               WHERE parent_id = ?1 AND deleted_at IS NULL
               ORDER BY is_mainline DESC, order_key ASC LIMIT 1
             )",
            [parent_id],
        )?;
    }
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

    #[test]
    fn device_identity_is_stable_and_lamport_is_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let first = store.device_id().unwrap();
        assert_eq!(store.device_id().unwrap(), first);

        let game_id = Uuid::new_v4();
        let mut op = operation(game_id);
        op.lamport = 42;
        store
            .save_game_with_operation(game_id, "Study", "fen", Uuid::new_v4(), &op)
            .unwrap();
        assert_eq!(store.max_lamport().unwrap(), 42);
    }

    #[test]
    fn remote_operations_are_projected_into_the_move_tree() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Remote study".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();

        let add = Operation {
            op_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            entity_id: node_id,
            game_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id,
                parent_id: root_id,
                move_iccs: "a0a1".into(),
                order_key: 0,
                is_mainline: true,
            })
            .unwrap(),
            lamport: 2,
            created_at: Utc::now(),
        };
        store.apply_remote_operation(&add, 2).unwrap();
        let update = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::UpdateComment,
            payload: serde_json::to_value(UpdateCommentPayload {
                node_id,
                comment: "remote note".into(),
            })
            .unwrap(),
            lamport: 3,
            ..add.clone()
        };
        store.apply_remote_operation(&update, 3).unwrap();

        let child_id = Uuid::new_v4();
        let child = Operation {
            op_id: Uuid::new_v4(),
            entity_id: child_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id: child_id,
                parent_id: node_id,
                move_iccs: "a9a8".into(),
                order_key: 1,
                is_mainline: true,
            })
            .unwrap(),
            lamport: 4,
            ..add.clone()
        };
        store.apply_remote_operation(&child, 4).unwrap();
        let delete = Operation {
            op_id: Uuid::new_v4(),
            entity_id: node_id,
            kind: OperationKind::DeleteNode,
            payload: serde_json::to_value(DeleteNodePayload { node_id }).unwrap(),
            lamport: 5,
            ..add
        };
        store.apply_remote_operation(&delete, 5).unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "Remote study");
        assert_eq!(game.current_node_id, None);
        let nodes = store.load_move_nodes(game_id).unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].comment, "remote note");
        assert!(nodes.iter().all(|node| node.deleted));
        let mut tree = xiangqi_manual::ManualTree::with_root(root_id);
        for node in nodes {
            tree.restore_node(node).unwrap();
        }
        assert!(tree.branches(root_id).unwrap().is_empty());
        assert_eq!(store.remote_cursor().unwrap(), 5);
    }

    #[test]
    fn analysis_results_can_be_replaced_and_restored() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        store
            .save_analysis(
                game_id,
                Some(node_id),
                "/engine",
                "depth:12",
                Some(12),
                Some(20),
                None,
                "[1]",
                10,
            )
            .unwrap();
        store
            .save_analysis(
                game_id,
                Some(node_id),
                "/engine",
                "depth:12",
                Some(12),
                Some(30),
                None,
                "[2]",
                11,
            )
            .unwrap();
        assert_eq!(
            store.load_latest_analysis(game_id, Some(node_id)).unwrap(),
            Some("[2]".into())
        );
    }

    #[test]
    fn latest_analysis_summaries_are_returned_for_each_move_node() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        for (node_id, config, score_cp, mate) in [
            (Some(first), "depth:8", Some(12), None),
            (Some(first), "depth:12", Some(-35), None),
            (Some(second), "depth:12", None, Some(3)),
            (None, "root", Some(99), None),
        ] {
            store
                .save_analysis(
                    game_id,
                    node_id,
                    "/engine",
                    config,
                    Some(12),
                    score_cp,
                    mate,
                    "[]",
                    10,
                )
                .unwrap();
        }

        let summaries = store.load_latest_analysis_summaries(game_id).unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[&first].score_cp, Some(-35));
        assert_eq!(summaries[&first].mate, None);
        assert_eq!(summaries[&second].score_cp, None);
        assert_eq!(summaries[&second].mate, Some(3));
    }
}
