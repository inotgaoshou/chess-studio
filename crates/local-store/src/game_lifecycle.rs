//! Game lifecycle projections kept outside the storage facade.

use super::{LocalGame, LocalStore, StoreError, local_game_from_row, parse_local_game, ttxq};
use rusqlite::params;
use uuid::Uuid;

impl LocalStore {
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

    /// Load a row regardless of its local tombstone. Used only to resolve a
    /// stale library UUID back to the current provider-owned record; deleted
    /// rows are never returned to normal list projections.
    pub fn load_game_including_deleted(
        &self,
        game_id: Uuid,
    ) -> Result<Option<LocalGame>, StoreError> {
        self.load_game_where("WHERE id = ?1", [game_id.to_string()])
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
                    source_path, source_format, playable, updated_at, metadata_json, library_folder, favorite, tags_json
             FROM games
             WHERE deleted_at IS NULL
               AND NOT (
                 source_path LIKE 'ttxq-order:%'
                 AND EXISTS (
                   SELECT 1
                   FROM games newer
                   WHERE newer.deleted_at IS NULL
                     AND newer.source_path = games.source_path
                     AND (
                       newer.updated_at > games.updated_at
                       OR (newer.updated_at = games.updated_at AND newer.id > games.id)
                     )
                 )
               )
             ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], local_game_from_row)?;
        let games = rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(parse_local_game)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ttxq::deduplicate_games_by_qipu(games))
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
}
