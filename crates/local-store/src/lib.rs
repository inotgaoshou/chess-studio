use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    ReorderBranchesPayload, SetMainlinePayload, UpdateCommentPayload, UpdateGameMetadataPayload,
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
    pub note: String,
    pub source_path: Option<String>,
    pub source_format: Option<String>,
    pub playable: bool,
    pub updated_at: String,
    pub metadata_json: String,
}

pub struct ImportedGame<'a> {
    pub id: Uuid,
    pub title: &'a str,
    pub starting_fen: &'a str,
    pub root_id: Uuid,
    pub current_node_id: Option<Uuid>,
    pub note: &'a str,
    pub source_path: Option<&'a str>,
    pub source_format: Option<&'a str>,
    pub playable: bool,
    pub metadata_json: &'a str,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("本地棋谱库已绑定账号 {email}，不能切换到其他账号")]
    AccountAlreadyBound { email: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub engine_path: String,
    pub threads: u32,
    pub hash_mb: u32,
    pub multipv: u32,
    #[serde(default = "default_candidate_line_moves")]
    pub candidate_line_moves: u32,
    pub search_mode: String,
    pub search_value: u64,
    pub move_time_ms: u64,
    pub ponder: bool,
    pub auto_analyze: bool,
    #[serde(default)]
    pub library_collapsed: bool,
    #[serde(default)]
    pub candidate_rail_collapsed: bool,
    #[serde(default)]
    pub analysis_panel_collapsed: bool,
    #[serde(default = "default_workspace_panel")]
    pub workspace_panel: String,
    #[serde(default = "default_layout_mode")]
    pub layout_mode: String,
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    #[serde(default = "default_board_skin")]
    pub board_skin: String,
    #[serde(default = "default_piece_skin")]
    pub piece_skin: String,
    #[serde(default = "default_report_depth")]
    pub report_depth: u32,
    /// Paths to read-only XQB opening books selected by the desktop user.
    #[serde(default)]
    pub xqb_book_paths: Vec<String>,
    #[serde(default)]
    pub disabled_xqb_book_paths: Vec<String>,
    #[serde(default)]
    pub active_engine_id: Option<Uuid>,
    #[serde(default = "default_cloud_book_enabled")]
    pub cloud_book_enabled: bool,
    #[serde(default = "default_cloud_book_url")]
    pub cloud_book_url: String,
    pub server_url: String,
}

fn default_color_theme() -> String {
    "dark".into()
}

fn default_workspace_panel() -> String {
    "moves".into()
}

fn default_layout_mode() -> String {
    "studio".into()
}

fn default_board_skin() -> String {
    "original".into()
}

fn default_piece_skin() -> String {
    "original".into()
}

fn default_report_depth() -> u32 {
    20
}

fn default_candidate_line_moves() -> u32 {
    6
}

fn default_cloud_book_url() -> String {
    "https://www.chessdb.cn/chessdb.php".into()
}

fn default_cloud_book_enabled() -> bool {
    true
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            engine_path: String::new(),
            threads: 2,
            hash_mb: 256,
            multipv: 3,
            candidate_line_moves: default_candidate_line_moves(),
            search_mode: "time".into(),
            search_value: 1500,
            move_time_ms: 5000,
            ponder: false,
            auto_analyze: true,
            library_collapsed: true,
            candidate_rail_collapsed: false,
            analysis_panel_collapsed: false,
            workspace_panel: default_workspace_panel(),
            layout_mode: default_layout_mode(),
            color_theme: default_color_theme(),
            board_skin: default_board_skin(),
            piece_skin: default_piece_skin(),
            report_depth: default_report_depth(),
            xqb_book_paths: Vec::new(),
            disabled_xqb_book_paths: Vec::new(),
            active_engine_id: None,
            cloud_book_enabled: default_cloud_book_enabled(),
            cloud_book_url: default_cloud_book_url(),
            server_url: "http://127.0.0.1:8080".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccountBinding {
    pub user_id: Uuid,
    pub email: String,
}

pub struct LocalStore {
    connection: Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnalysisSummary {
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredGameReport {
    pub game_id: Uuid,
    pub line_signature: String,
    pub engine_fingerprint: String,
    pub config_hash: String,
    pub dataset_json: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingTask {
    pub id: Uuid,
    pub game_id: Uuid,
    pub report_signature: String,
    pub node_id: Uuid,
    pub title: String,
    pub detail: String,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineProfile {
    pub id: Uuid,
    pub name: String,
    pub executable_path: String,
    pub protocol: String,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    pub fn desktop_preferences(&self) -> Result<DesktopPreferences, StoreError> {
        let json: Option<String> = self
            .connection
            .query_row(
                "SELECT preferences_json FROM desktop_preferences WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        json.map(|value| serde_json::from_str(&value))
            .transpose()
            .map(|value| value.unwrap_or_default())
            .map_err(Into::into)
    }

    pub fn save_desktop_preferences(
        &mut self,
        preferences: &DesktopPreferences,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO desktop_preferences (id, preferences_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET preferences_json=excluded.preferences_json",
            [serde_json::to_string(preferences)?],
        )?;
        Ok(())
    }

    pub fn sync_account_binding(&self) -> Result<Option<SyncAccountBinding>, StoreError> {
        self.sync_value("sync_account")?
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(Into::into)
    }

    pub fn bind_sync_account(&mut self, account: &SyncAccountBinding) -> Result<(), StoreError> {
        if let Some(existing) = self.sync_account_binding()? {
            if existing.user_id != account.user_id {
                return Err(StoreError::AccountAlreadyBound {
                    email: existing.email,
                });
            }
            return Ok(());
        }
        self.set_sync_value("sync_account", &serde_json::to_string(account)?)
    }

    pub fn reset_sync_library(&mut self) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM training_tasks", [])?;
        transaction.execute("DELETE FROM game_reports", [])?;
        transaction.execute("DELETE FROM analysis_results", [])?;
        transaction.execute("DELETE FROM move_nodes", [])?;
        transaction.execute("DELETE FROM operations", [])?;
        transaction.execute("DELETE FROM games", [])?;
        transaction.execute(
            "DELETE FROM sync_state WHERE key IN ('sync_account', 'sync_token_expired', 'last_sync_result', 'remote_cursor')",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn sync_token_expired(&self) -> Result<bool, StoreError> {
        Ok(self.sync_value("sync_token_expired")?.as_deref() == Some("true"))
    }

    pub fn set_sync_token_expired(&mut self, expired: bool) -> Result<(), StoreError> {
        self.set_sync_value("sync_token_expired", if expired { "true" } else { "false" })
    }

    pub fn last_sync_result(&self) -> Result<Option<String>, StoreError> {
        self.sync_value("last_sync_result")
    }

    pub fn set_last_sync_result(&mut self, result: &str) -> Result<(), StoreError> {
        self.set_sync_value("last_sync_result", result)
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

    pub fn import_game_with_operations(
        &mut self,
        game: ImportedGame<'_>,
        nodes: &[MoveNode],
        operations: &[Operation],
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let updated_at = operations
            .last()
            .map(|operation| operation.created_at)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339();
        transaction.execute(
            "INSERT INTO games
             (id, title, starting_fen, root_id, current_node_id, updated_at, note,
              source_path, source_format, playable, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                game.id.to_string(),
                game.title,
                game.starting_fen,
                game.root_id.to_string(),
                game.current_node_id.map(|id| id.to_string()),
                updated_at,
                game.note,
                game.source_path,
                game.source_format,
                game.playable as i32,
                game.metadata_json,
            ],
        )?;
        for node in nodes {
            transaction.execute(
                "INSERT INTO move_nodes
                 (id, game_id, parent_id, move_iccs, comment, order_key, is_mainline, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    node.id.to_string(),
                    game.id.to_string(),
                    node.parent_id.to_string(),
                    node.mv.to_iccs(),
                    node.comment,
                    node.order_key as i64,
                    node.is_mainline as i32,
                    node.deleted.then(|| chrono::Utc::now().to_rfc3339()),
                ],
            )?;
        }
        for operation in operations {
            insert_operation(&transaction, operation, false)?;
        }
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

    pub fn update_game_metadata_with_operation(
        &mut self,
        game_id: Uuid,
        title: &str,
        note: &str,
        metadata_json: &str,
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE games SET title = ?1, note = ?2, metadata_json = ?3,
             updated_at = ?4 WHERE id = ?5",
            params![
                title,
                note,
                metadata_json,
                operation.created_at.to_rfc3339(),
                game_id.to_string()
            ],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn reorder_branches_with_operation(
        &mut self,
        game_id: Uuid,
        parent_id: Uuid,
        ordered_ids: &[Uuid],
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        reorder_projected_branches(&transaction, game_id, parent_id, ordered_ids)?;
        transaction.execute(
            "UPDATE games SET updated_at = ?1 WHERE id = ?2",
            params![operation.created_at.to_rfc3339(), game_id.to_string()],
        )?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_game_source(
        &mut self,
        game_id: Uuid,
        source_path: Option<&str>,
        source_format: Option<&str>,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET source_path = ?1, source_format = ?2 WHERE id = ?3",
            params![source_path, source_format, game_id.to_string()],
        )?;
        Ok(())
    }

    pub fn set_game_document_properties(
        &mut self,
        game_id: Uuid,
        metadata_json: &str,
        playable: bool,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE games SET metadata_json = ?1, playable = ?2 WHERE id = ?3",
            params![metadata_json, playable as i32, game_id.to_string()],
        )?;
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

    pub fn list_engine_profiles(&self) -> Result<Vec<EngineProfile>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, executable_path, protocol FROM engine_profiles ORDER BY name COLLATE NOCASE, rowid",
        )?;
        statement
            .query_map([], |row| {
                let id: String = row.get(0)?;
                Ok(EngineProfile {
                    id: parse_row_uuid(&id, 0)?,
                    name: row.get(1)?,
                    executable_path: row.get(2)?,
                    protocol: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn delete_engine_profile(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.connection
            .execute("DELETE FROM engine_profiles WHERE id = ?1", [id.to_string()])?;
        Ok(())
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
                 WHERE game_id = ?1 AND node_id IS ?2 AND config_hash NOT LIKE 'report:%'
                 ORDER BY created_at DESC LIMIT 1",
                params![game_id.to_string(), node_id.map(|id| id.to_string())],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn load_latest_analysis_summary(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
    ) -> Result<Option<AnalysisSummary>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT score_cp, mate FROM analysis_results
                 WHERE game_id = ?1 AND node_id IS ?2
                 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![game_id.to_string(), node_id.map(|id| id.to_string())],
                |row| {
                    Ok(AnalysisSummary {
                        score_cp: row.get(0)?,
                        mate: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_analysis_for_config(
        &self,
        game_id: Uuid,
        node_id: Option<Uuid>,
        engine_fingerprint: &str,
        config_hash: &str,
    ) -> Result<Option<String>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT pv_json FROM analysis_results
             WHERE game_id = ?1 AND node_id IS ?2
               AND engine_fingerprint = ?3 AND config_hash = ?4
             ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![
                    game_id.to_string(),
                    node_id.map(|id| id.to_string()),
                    engine_fingerprint,
                    config_hash
                ],
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

    pub fn save_game_report(
        &mut self,
        game_id: Uuid,
        line_signature: &str,
        engine_fingerprint: &str,
        config_hash: &str,
        dataset_json: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO game_reports
             (id, game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(game_id, line_signature, engine_fingerprint, config_hash)
             DO UPDATE SET dataset_json=excluded.dataset_json, created_at=excluded.created_at",
            params![
                Uuid::new_v4().to_string(),
                game_id.to_string(),
                line_signature,
                engine_fingerprint,
                config_hash,
                dataset_json,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn load_latest_game_report(
        &self,
        game_id: Uuid,
    ) -> Result<Option<StoredGameReport>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at
             FROM game_reports WHERE game_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                [game_id.to_string()],
                |row| {
                    Ok(StoredGameReport {
                        game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                        line_signature: row.get(1)?,
                        engine_fingerprint: row.get(2)?,
                        config_hash: row.get(3)?,
                        dataset_json: row.get(4)?,
                        generated_at: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_game_report(
        &self,
        game_id: Uuid,
        line_signature: &str,
    ) -> Result<Option<StoredGameReport>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT game_id, line_signature, engine_fingerprint, config_hash, dataset_json, created_at
                 FROM game_reports
                 WHERE game_id = ?1 AND line_signature = ?2
                 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![game_id.to_string(), line_signature],
                |row| {
                    Ok(StoredGameReport {
                        game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                        line_signature: row.get(1)?,
                        engine_fingerprint: row.get(2)?,
                        config_hash: row.get(3)?,
                        dataset_json: row.get(4)?,
                        generated_at: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn load_latest_game_reports(&self) -> Result<Vec<StoredGameReport>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT r.game_id, r.line_signature, r.engine_fingerprint, r.config_hash, r.dataset_json, r.created_at
             FROM game_reports r
             INNER JOIN (SELECT game_id, MAX(rowid) AS latest_rowid FROM game_reports GROUP BY game_id) latest
               ON latest.latest_rowid = r.rowid
             ORDER BY r.created_at DESC, r.rowid DESC",
        )?;
        statement.query_map([], |row| {
            Ok(StoredGameReport {
                game_id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                line_signature: row.get(1)?,
                engine_fingerprint: row.get(2)?,
                config_hash: row.get(3)?,
                dataset_json: row.get(4)?,
                generated_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn upsert_training_task(
        &mut self,
        game_id: Uuid,
        report_signature: &str,
        node_id: Uuid,
        title: &str,
        detail: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO training_tasks (id, game_id, report_signature, node_id, title, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(game_id, report_signature, node_id)
             DO UPDATE SET title=excluded.title, detail=excluded.detail",
            params![
                Uuid::new_v4().to_string(), game_id.to_string(), report_signature, node_id.to_string(),
                title, detail, chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_training_tasks(&self) -> Result<Vec<TrainingTask>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, report_signature, node_id, title, detail, completed_at, created_at
             FROM training_tasks ORDER BY completed_at IS NOT NULL, created_at DESC",
        )?;
        statement.query_map([], |row| {
            Ok(TrainingTask {
                id: parse_row_uuid(&row.get::<_, String>(0)?, 0)?,
                game_id: parse_row_uuid(&row.get::<_, String>(1)?, 1)?,
                report_signature: row.get(2)?,
                node_id: parse_row_uuid(&row.get::<_, String>(3)?, 3)?,
                title: row.get(4)?,
                detail: row.get(5)?,
                completed_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn complete_training_task(&mut self, task_id: Uuid, completed: bool) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE training_tasks SET completed_at = ?2 WHERE id = ?1",
            params![task_id.to_string(), completed.then(|| chrono::Utc::now().to_rfc3339())],
        )?;
        Ok(())
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

    pub fn active_game_id(&self) -> Result<Option<Uuid>, StoreError> {
        self.sync_value("active_game_id")?
            .map(|value| Uuid::parse_str(&value).map_err(json_error))
            .transpose()
            .map_err(Into::into)
    }

    pub fn set_active_game_id(&mut self, game_id: Uuid) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO sync_state (key, value) VALUES ('active_game_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [game_id.to_string()],
        )?;
        Ok(())
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

    pub fn load_games(&self) -> Result<Vec<LocalGame>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, starting_fen, root_id, current_node_id, note,
                    source_path, source_format, playable, updated_at, metadata_json
             FROM games WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], local_game_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(parse_local_game)
            .collect()
    }

    fn load_game_where<const N: usize>(
        &self,
        clause: &str,
        params: [String; N],
    ) -> Result<Option<LocalGame>, StoreError> {
        let sql = format!(
            "SELECT id, title, starting_fen, root_id, current_node_id, note, source_path, source_format, playable, updated_at, metadata_json FROM games {clause}"
        );
        let row = self
            .connection
            .query_row(
                &sql,
                rusqlite::params_from_iter(params),
                local_game_from_row,
            )
            .optional()?;
        row.map(parse_local_game).transpose()
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
               root_id TEXT NOT NULL, current_node_id TEXT, updated_at TEXT NOT NULL, deleted_at TEXT,
               note TEXT NOT NULL DEFAULT '', source_path TEXT, source_format TEXT,
               playable INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}'
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
             CREATE TABLE IF NOT EXISTS desktop_preferences (
               id INTEGER PRIMARY KEY CHECK (id = 1), preferences_json TEXT NOT NULL
             );
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
             CREATE TABLE IF NOT EXISTS game_reports (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL,
               line_signature TEXT NOT NULL, engine_fingerprint TEXT NOT NULL,
               config_hash TEXT NOT NULL, dataset_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               UNIQUE(game_id, line_signature, engine_fingerprint, config_hash)
             );
             CREATE TABLE IF NOT EXISTS training_tasks (
               id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
               node_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
               completed_at TEXT, created_at TEXT NOT NULL,
               UNIQUE(game_id, report_signature, node_id)
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
        ensure_game_column(&connection, "note", "TEXT NOT NULL DEFAULT ''")?;
        ensure_game_column(&connection, "source_path", "TEXT")?;
        ensure_game_column(&connection, "source_format", "TEXT")?;
        ensure_game_column(&connection, "playable", "INTEGER NOT NULL DEFAULT 1")?;
        ensure_game_column(&connection, "metadata_json", "TEXT NOT NULL DEFAULT '{}'")?;
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

type LocalGameRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    bool,
    String,
    String,
);

fn local_game_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalGameRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn parse_local_game(
    (
        id,
        title,
        starting_fen,
        root_id,
        current_node_id,
        note,
        source_path,
        source_format,
        playable,
        updated_at,
        metadata_json,
    ): LocalGameRow,
) -> Result<LocalGame, StoreError> {
    Ok(LocalGame {
        id: Uuid::parse_str(&id).map_err(json_error)?,
        title,
        starting_fen,
        root_id: Uuid::parse_str(&root_id).map_err(json_error)?,
        current_node_id: current_node_id
            .map(|id| Uuid::parse_str(&id).map_err(json_error))
            .transpose()?,
        note,
        source_path,
        source_format,
        playable,
        updated_at,
        metadata_json,
    })
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
            let order_key = connection.query_row(
                "SELECT COALESCE(MAX(order_key), -1) + 1 FROM move_nodes
                 WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL AND id != ?3",
                params![
                    operation.game_id.to_string(),
                    payload.parent_id.to_string(),
                    payload.node_id.to_string()
                ],
                |row| row.get::<_, i64>(0),
            )?;
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
                    order_key,
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
        OperationKind::UpdateGameMetadata => {
            let payload: UpdateGameMetadataPayload =
                serde_json::from_value(operation.payload.clone())?;
            let metadata_json =
                metadata_json_with_payload(connection, operation.game_id, &payload)?;
            connection.execute(
                "UPDATE games SET title = ?1, note = ?2, metadata_json = ?3,
                 updated_at = ?4 WHERE id = ?5",
                params![
                    payload.title,
                    payload.note,
                    metadata_json,
                    operation.created_at.to_rfc3339(),
                    operation.game_id.to_string()
                ],
            )?;
        }
        OperationKind::ReorderBranches => {
            let payload: ReorderBranchesPayload =
                serde_json::from_value(operation.payload.clone())?;
            reorder_projected_branches(
                connection,
                operation.game_id,
                payload.parent_id,
                &payload.node_ids,
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
        OperationKind::Unknown => {}
    }
    Ok(())
}

fn ensure_game_column(
    connection: &Connection,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare("PRAGMA table_info(games)")?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !names.iter().any(|name| name == column) {
        connection.execute(
            &format!("ALTER TABLE games ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn metadata_json_with_payload(
    connection: &Connection,
    game_id: Uuid,
    payload: &UpdateGameMetadataPayload,
) -> Result<String, StoreError> {
    let current: Option<String> = connection
        .query_row(
            "SELECT metadata_json FROM games WHERE id = ?1",
            [game_id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    let mut metadata = current
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    let object = metadata
        .as_object_mut()
        .expect("metadata object was initialized above");
    object.insert(
        "title".into(),
        serde_json::Value::String(payload.title.clone()),
    );
    for (key, value) in [
        ("event", &payload.event),
        ("site", &payload.site),
        ("date", &payload.date),
        ("red", &payload.red),
        ("black", &payload.black),
        ("result", &payload.result),
    ] {
        if let Some(value) = value {
            object.insert(key.into(), serde_json::Value::String(value.clone()));
        }
    }
    Ok(serde_json::to_string(&metadata)?)
}

fn reorder_projected_branches(
    connection: &Connection,
    game_id: Uuid,
    parent_id: Uuid,
    ordered_ids: &[Uuid],
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(
        "SELECT id, order_key FROM move_nodes
         WHERE game_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL
         ORDER BY order_key, id",
    )?;
    let rows = statement.query_map(params![game_id.to_string(), parent_id.to_string()], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let existing = rows.collect::<Result<Vec<_>, _>>()?;
    let mut keys: Vec<_> = existing.iter().map(|(_, key)| *key).collect();
    keys.sort_unstable();
    let existing_ids: std::collections::HashSet<_> =
        existing.iter().map(|(id, _)| id.as_str()).collect();
    let mut requested: Vec<_> = ordered_ids
        .iter()
        .filter(|id| existing_ids.contains(id.to_string().as_str()))
        .copied()
        .collect();
    for (id, _) in &existing {
        let id = Uuid::parse_str(id).map_err(json_error)?;
        if !requested.contains(&id) {
            requested.push(id);
        }
    }
    for (node_id, key) in requested.into_iter().zip(keys) {
        connection.execute(
            "UPDATE move_nodes SET order_key = ?1 WHERE id = ?2 AND game_id = ?3",
            params![key, node_id.to_string(), game_id.to_string()],
        )?;
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

fn parse_row_uuid(value: &str, column: usize) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
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
    fn active_game_is_restored_independently_of_recent_updates() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let older_id = Uuid::new_v4();
        let mut older = operation(older_id);
        older.created_at = Utc::now() - chrono::Duration::minutes(2);
        store
            .save_game_with_operation(older_id, "Older", "fen", Uuid::new_v4(), &older)
            .unwrap();

        let newer_id = Uuid::new_v4();
        let mut newer = operation(newer_id);
        newer.created_at = Utc::now() - chrono::Duration::minutes(1);
        store
            .save_game_with_operation(newer_id, "Newer", "fen", Uuid::new_v4(), &newer)
            .unwrap();
        assert_eq!(store.load_latest_game().unwrap().unwrap().id, newer_id);

        store.set_active_game_id(older_id).unwrap();
        store.set_current_node(newer_id, None).unwrap();
        assert_eq!(store.load_latest_game().unwrap().unwrap().id, newer_id);
        assert_eq!(store.active_game_id().unwrap(), Some(older_id));
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
    fn imported_game_is_rolled_back_when_any_operation_fails() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        let node = MoveNode {
            id: node_id,
            parent_id: root_id,
            mv: Move::from_iccs("h2e2").unwrap(),
            comment: "main".into(),
            order_key: 0,
            is_mainline: true,
            deleted: false,
        };
        let create = operation(game_id);
        let result = store.import_game_with_operations(
            ImportedGame {
                id: game_id,
                title: "Imported",
                starting_fen: xiangqi_core::STARTING_FEN,
                root_id,
                current_node_id: Some(node_id),
                note: "note",
                source_path: Some("/tmp/imported.pgn"),
                source_format: Some("pgn"),
                playable: true,
                metadata_json: "{}",
            },
            &[node.clone(), node],
            &[create],
        );

        assert!(result.is_err());
        assert!(store.load_game(game_id).unwrap().is_none());
        assert!(store.load_move_nodes(game_id).unwrap().is_empty());
        assert!(store.pending_operations(10).unwrap().is_empty());
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
        assert_eq!(
            nodes
                .iter()
                .find(|node| node.id == node_id)
                .unwrap()
                .comment,
            "remote note"
        );
        assert!(nodes.iter().all(|node| node.deleted));
        let mut tree = xiangqi_manual::ManualTree::with_root(root_id);
        tree.restore_nodes(nodes).unwrap();
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
    fn report_cache_loads_the_latest_root_analysis_for_an_exact_config() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        for json in ["[1]", "[2]"] {
            store
                .save_analysis(
                    game_id,
                    None,
                    "/engine",
                    "report:time:1000",
                    Some(12),
                    Some(20),
                    None,
                    json,
                    10,
                )
                .unwrap();
        }

        assert_eq!(
            store
                .load_analysis_for_config(game_id, None, "/engine", "report:time:1000")
                .unwrap(),
            Some("[2]".into())
        );
        assert_eq!(
            store
                .load_analysis_for_config(game_id, None, "/engine", "report:depth:12")
                .unwrap(),
            None
        );
        assert_eq!(store.load_latest_analysis(game_id, None).unwrap(), None);
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
        assert_eq!(
            store.load_latest_analysis_summary(game_id, None).unwrap(),
            Some(AnalysisSummary {
                score_cp: Some(99),
                mate: None,
            })
        );
    }

    #[test]
    fn reordered_branches_and_metadata_survive_reload() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = json!({
            "title": "Study", "fen": xiangqi_core::STARTING_FEN, "rootId": root_id
        });
        store
            .save_game_with_operation(
                game_id,
                "Study",
                xiangqi_core::STARTING_FEN,
                root_id,
                &create,
            )
            .unwrap();
        for (index, node_id) in [first, second].into_iter().enumerate() {
            let mut add = operation(game_id);
            add.entity_id = node_id;
            add.kind = OperationKind::AddMove;
            store
                .save_move_with_operation(
                    node_id,
                    game_id,
                    Some(root_id),
                    if index == 0 { "a0a1" } else { "b0c2" },
                    "",
                    index as u64,
                    index == 0,
                    &add,
                )
                .unwrap();
        }
        let mut reorder = operation(game_id);
        reorder.entity_id = root_id;
        reorder.kind = OperationKind::ReorderBranches;
        store
            .reorder_branches_with_operation(game_id, root_id, &[second, first], &reorder)
            .unwrap();
        let mut metadata = operation(game_id);
        metadata.kind = OperationKind::UpdateGameMetadata;
        store
            .update_game_metadata_with_operation(
                game_id,
                "残局研究",
                "红先胜",
                r#"{"title":"残局研究","result":"*"}"#,
                &metadata,
            )
            .unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "残局研究");
        assert_eq!(game.note, "红先胜");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&game.metadata_json).unwrap()["title"],
            "残局研究"
        );
        assert_eq!(
            store
                .load_move_nodes(game_id)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![second, first]
        );
        assert_eq!(store.pending_operations(20).unwrap().len(), 5);
    }

    #[test]
    fn remote_move_is_appended_after_locally_ordered_branches() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let third = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Study".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();

        for (cursor, node_id, move_iccs, order_key) in [
            (2, first, "h2e2", 10),
            (3, second, "b2e2", 11),
            (5, third, "h0g2", 0),
        ] {
            let mut add = operation(game_id);
            add.entity_id = node_id;
            add.kind = OperationKind::AddMove;
            add.payload = serde_json::to_value(AddMovePayload {
                node_id,
                parent_id: root_id,
                move_iccs: move_iccs.into(),
                order_key,
                is_mainline: node_id == first,
            })
            .unwrap();
            if cursor == 5 {
                let mut reorder = operation(game_id);
                reorder.entity_id = root_id;
                reorder.kind = OperationKind::ReorderBranches;
                reorder.payload = serde_json::to_value(ReorderBranchesPayload {
                    parent_id: root_id,
                    node_ids: vec![second, first],
                })
                .unwrap();
                store.apply_remote_operation(&reorder, 4).unwrap();
            }
            store.apply_remote_operation(&add, cursor).unwrap();
        }

        assert_eq!(
            store
                .load_move_nodes(game_id)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![second, first, third]
        );
    }

    #[test]
    fn remote_metadata_updates_the_structured_document_fields() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let mut create = operation(game_id);
        create.payload = serde_json::to_value(CreateGamePayload {
            title: "Old".into(),
            fen: xiangqi_core::STARTING_FEN.into(),
            root_id,
        })
        .unwrap();
        store.apply_remote_operation(&create, 1).unwrap();
        store
            .set_game_document_properties(game_id, r#"{"title":"Old","result":"*"}"#, true)
            .unwrap();
        let mut metadata = operation(game_id);
        metadata.kind = OperationKind::UpdateGameMetadata;
        metadata.payload = serde_json::to_value(UpdateGameMetadataPayload {
            title: "New".into(),
            note: "remote".into(),
            event: Some("联赛".into()),
            red: Some("甲".into()),
            result: Some("1-0".into()),
            ..UpdateGameMetadataPayload::default()
        })
        .unwrap();
        store.apply_remote_operation(&metadata, 2).unwrap();

        let game = store.load_game(game_id).unwrap().unwrap();
        assert_eq!(game.title, "New");
        assert_eq!(game.note, "remote");
        let value: serde_json::Value = serde_json::from_str(&game.metadata_json).unwrap();
        assert_eq!(value["title"], "New");
        assert_eq!(value["event"], "联赛");
        assert_eq!(value["red"], "甲");
        assert_eq!(value["result"], "1-0");
    }

    #[test]
    fn desktop_preferences_survive_reopen_without_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.sqlite3");
        let preferences = DesktopPreferences {
            engine_path: "/opt/pikafish".into(),
            threads: 6,
            hash_mb: 512,
            multipv: 4,
            candidate_line_moves: 12,
            search_mode: "nodes".into(),
            search_value: 800_000,
            move_time_ms: 2200,
            ponder: true,
            auto_analyze: false,
            library_collapsed: true,
            candidate_rail_collapsed: true,
            analysis_panel_collapsed: true,
            workspace_panel: "summary".into(),
            layout_mode: "compact".into(),
            color_theme: "light".into(),
            board_skin: "neon".into(),
            piece_skin: "neon".into(),
            report_depth: 24,
            xqb_book_paths: vec!["/books/example.xqb".into()],
            disabled_xqb_book_paths: Vec::new(),
            active_engine_id: None,
            cloud_book_enabled: true,
            cloud_book_url: "https://book.example.com/query".into(),
            server_url: "https://sync.example.com".into(),
        };
        {
            let mut store = LocalStore::open(&path).unwrap();
            store.save_desktop_preferences(&preferences).unwrap();
        }
        let store = LocalStore::open(&path).unwrap();
        assert_eq!(store.desktop_preferences().unwrap(), preferences);
        assert!(store.sync_value("jwt").unwrap().is_none());
    }

    #[test]
    fn desktop_preferences_accept_legacy_json_without_layout_fields() {
        let preferences: DesktopPreferences = serde_json::from_str(
            r#"{"enginePath":"/opt/pikafish","threads":2,"hashMb":256,"multipv":3,"searchMode":"time","searchValue":1500,"moveTimeMs":5000,"ponder":false,"autoAnalyze":true,"serverUrl":"http://127.0.0.1:8080"}"#,
        )
        .unwrap();
        assert!(!preferences.library_collapsed);
        assert!(!preferences.candidate_rail_collapsed);
        assert!(!preferences.analysis_panel_collapsed);
        assert_eq!(preferences.workspace_panel, "moves");
        assert_eq!(preferences.layout_mode, "studio");
        assert_eq!(preferences.color_theme, "dark");
        assert_eq!(preferences.report_depth, 20);
        assert_eq!(preferences.candidate_line_moves, 6);
        assert!(preferences.xqb_book_paths.is_empty());
        assert!(preferences.cloud_book_enabled);
        assert_eq!(preferences.cloud_book_url, "https://www.chessdb.cn/chessdb.php");
    }

    #[test]
    fn engine_profiles_are_upserted_listed_and_deleted() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let id = store.save_engine_profile("Pikafish", "/engines/pikafish", "uci").unwrap();
        assert_eq!(store.list_engine_profiles().unwrap()[0].id, id);
        let same = store.save_engine_profile("Pikafish 2", "/engines/pikafish", "ucci").unwrap();
        assert_eq!(same, id);
        let profiles = store.list_engine_profiles().unwrap();
        assert_eq!(profiles[0].name, "Pikafish 2");
        assert_eq!(profiles[0].protocol, "ucci");
        store.delete_engine_profile(id).unwrap();
        assert!(store.list_engine_profiles().unwrap().is_empty());
    }

    #[test]
    fn game_report_dataset_survives_reopen_and_restores_exact_line() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("reports.sqlite3");
        let game_id = Uuid::new_v4();
        {
            let mut store = LocalStore::open(&path).unwrap();
            store
                .save_game_report(
                    game_id,
                    "root:first",
                    "/engine",
                    "time:1000",
                    "{\"version\":1}",
                )
                .unwrap();
            store
                .save_game_report(
                    game_id,
                    "root:first:second",
                    "/engine",
                    "time:1000",
                    "{\"version\":2}",
                )
                .unwrap();
        }
        let store = LocalStore::open(&path).unwrap();
        let report = store.load_latest_game_report(game_id).unwrap().unwrap();
        assert_eq!(report.line_signature, "root:first:second");
        assert_eq!(report.dataset_json, "{\"version\":2}");
        let first = store
            .load_game_report(game_id, "root:first")
            .unwrap()
            .unwrap();
        assert_eq!(first.line_signature, "root:first");
        assert_eq!(first.dataset_json, "{\"version\":1}");
        assert!(
            store
                .load_game_report(game_id, "root:missing")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn training_tasks_are_deduplicated_and_can_be_completed() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let game_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        store.upsert_training_task(game_id, "report-1", node_id, "复盘第 12 手", "重新寻找最佳着法").unwrap();
        store.upsert_training_task(game_id, "report-1", node_id, "复盘第 12 手", "比较候选着法").unwrap();
        let tasks = store.list_training_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].detail, "比较候选着法");
        store.complete_training_task(tasks[0].id, true).unwrap();
        assert!(store.list_training_tasks().unwrap()[0].completed_at.is_some());
        store.complete_training_task(tasks[0].id, false).unwrap();
        assert!(store.list_training_tasks().unwrap()[0].completed_at.is_none());
    }

    #[test]
    fn sync_account_binding_accepts_same_account_and_rejects_another() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let first = SyncAccountBinding {
            user_id: Uuid::new_v4(),
            email: "first@example.com".into(),
        };
        store.bind_sync_account(&first).unwrap();
        store.bind_sync_account(&first).unwrap();
        assert_eq!(store.sync_account_binding().unwrap(), Some(first.clone()));

        let error = store
            .bind_sync_account(&SyncAccountBinding {
                user_id: Uuid::new_v4(),
                email: "second@example.com".into(),
            })
            .unwrap_err();
        assert!(matches!(error, StoreError::AccountAlreadyBound { .. }));
        assert_eq!(store.sync_account_binding().unwrap(), Some(first));
    }

    #[test]
    fn signing_out_does_not_remove_outbox_or_account_binding() {
        let mut store = LocalStore::open_in_memory().unwrap();
        let account = SyncAccountBinding {
            user_id: Uuid::new_v4(),
            email: "offline@example.com".into(),
        };
        store.bind_sync_account(&account).unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Offline", "fen", Uuid::new_v4(), &op)
            .unwrap();

        assert_eq!(store.sync_account_binding().unwrap(), Some(account));
        assert_eq!(store.pending_operations(10).unwrap(), vec![op]);
    }

    #[test]
    fn resetting_a_sync_library_removes_account_data_and_games() {
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .bind_sync_account(&SyncAccountBinding {
                user_id: Uuid::new_v4(),
                email: "old@example.com".into(),
            })
            .unwrap();
        let game_id = Uuid::new_v4();
        let op = operation(game_id);
        store
            .save_game_with_operation(game_id, "Old study", "fen", Uuid::new_v4(), &op)
            .unwrap();

        store.reset_sync_library().unwrap();

        assert!(store.sync_account_binding().unwrap().is_none());
        assert!(store.pending_operations(10).unwrap().is_empty());
        assert!(store.load_game(game_id).unwrap().is_none());
        assert_eq!(store.remote_cursor().unwrap(), 0);
    }
}
