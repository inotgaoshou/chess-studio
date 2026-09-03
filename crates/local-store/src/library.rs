//! Library and folder operations live behind the LocalStore facade.
//!
//! The implementation remains in `lib.rs` for now while the public methods are
//! migrated incrementally; this module is the stable home for library-specific
//! helpers and future transaction extraction.

use super::{LibraryFolder, LocalGame, LocalStore, Operation, StoreError, insert_operation};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use uuid::Uuid;

const LIBRARY_GAME_ORDER_KEY: &str = "library_game_order_v1";

fn folder_order_key(folder: Option<&str>) -> String {
    folder.unwrap_or("").to_owned()
}

pub(crate) fn folder_path_prefixes(folder: &str) -> Vec<String> {
    let mut prefixes = Vec::new();
    let mut current = String::new();
    for segment in folder
        .split('/')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(segment);
        prefixes.push(current.clone());
    }
    prefixes
}

pub(crate) fn insert_library_folder_path(
    connection: &Connection,
    folder: &str,
    system: bool,
) -> Result<(), StoreError> {
    let prefixes = folder_path_prefixes(folder);
    for (index, prefix) in prefixes.iter().enumerate() {
        let folder_system = system && index + 1 == prefixes.len();
        connection.execute(
            "INSERT OR IGNORE INTO library_folders (name, system) VALUES (?1, ?2)",
            params![prefix, folder_system as i32],
        )?;
    }
    Ok(())
}

impl LocalStore {
    /// Apply the user-defined order for each directory. Games not present in
    /// the saved order keep their existing projection order and are appended.
    pub fn apply_library_game_order(
        &self,
        games: Vec<LocalGame>,
    ) -> Result<Vec<LocalGame>, StoreError> {
        let raw = self.sync_value(LIBRARY_GAME_ORDER_KEY)?;
        let orders = raw
            .as_deref()
            .and_then(|value| serde_json::from_str::<HashMap<String, Vec<String>>>(value).ok())
            .unwrap_or_default();
        // Keep the projection's global order (which is used by the “全部”
        // view) and replace only the slots occupied by siblings in a folder.
        // Iterating a HashMap of folders here would otherwise make unrelated
        // directories appear in nondeterministic order.
        let folder_keys = games
            .iter()
            .map(|game| folder_order_key(game.library_folder.as_deref()))
            .collect::<Vec<_>>();
        let mut slots = games.into_iter().map(Some).collect::<Vec<_>>();
        let mut positions_by_folder = HashMap::<String, Vec<usize>>::new();
        for (index, folder) in folder_keys.into_iter().enumerate() {
            positions_by_folder.entry(folder).or_default().push(index);
        }
        for (folder, positions) in positions_by_folder {
            let Some(saved_ids) = orders.get(&folder) else {
                continue;
            };
            let rank = saved_ids
                .iter()
                .enumerate()
                .map(|(index, id)| (id.as_str(), index))
                .collect::<HashMap<_, _>>();
            let mut entries = positions
                .iter()
                .map(|position| {
                    let game = slots[*position]
                        .take()
                        .expect("library order position is populated");
                    (*position, game)
                })
                .collect::<Vec<_>>();
            entries.sort_by_key(|(position, game)| {
                (
                    rank.get(game.id.to_string().as_str())
                        .copied()
                        .unwrap_or(usize::MAX),
                    *position,
                )
            });
            for (position, (_, game)) in positions.iter().zip(entries.into_iter()) {
                slots[*position] = Some(game);
            }
        }
        Ok(slots
            .into_iter()
            .map(|game| game.expect("library order slot is populated"))
            .collect())
    }

    /// Persist the complete sibling order for one directory in local state.
    pub fn reorder_games_in_folder(
        &mut self,
        folder: Option<&str>,
        ordered_ids: &[Uuid],
    ) -> Result<(), StoreError> {
        let mut orders = self
            .sync_value(LIBRARY_GAME_ORDER_KEY)?
            .as_deref()
            .and_then(|value| serde_json::from_str::<HashMap<String, Vec<String>>>(value).ok())
            .unwrap_or_default();
        orders.insert(
            folder_order_key(folder),
            ordered_ids.iter().map(ToString::to_string).collect(),
        );
        self.set_sync_value(LIBRARY_GAME_ORDER_KEY, &serde_json::to_string(&orders)?)
    }

    pub fn library_folders(&self) -> Result<Vec<LibraryFolder>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT folders.name, folders.system, COUNT(games.id)
             FROM library_folders folders
             LEFT JOIN games ON games.library_folder = folders.name AND games.deleted_at IS NULL
             GROUP BY folders.name, folders.system ORDER BY folders.system DESC, folders.name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LibraryFolder {
                name: row.get(0)?,
                system: row.get(1)?,
                game_count: row.get::<_, i64>(2)? as u32,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn create_library_folder(&mut self, name: &str) -> Result<(), StoreError> {
        insert_library_folder_path(&self.connection, name, false)
    }

    pub fn rename_library_folder(&mut self, previous: &str, next: &str) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let system: Option<bool> = transaction
            .query_row(
                "SELECT system FROM library_folders WHERE name=?1",
                [previous],
                |row| row.get(0),
            )
            .optional()?;
        if system != Some(false) {
            return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
        }
        transaction.execute(
            "UPDATE library_folders SET name=?1 WHERE name=?2",
            params![next, previous],
        )?;
        let descendant_prefix = format!("{previous}/");
        let descendants = {
            let mut statement = transaction.prepare(
                "SELECT name FROM library_folders WHERE substr(name, 1, ?2)=?1 ORDER BY name",
            )?;
            statement
                .query_map(
                    params![descendant_prefix, descendant_prefix.chars().count()],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?
        };
        for name in descendants {
            let renamed = format!("{next}/{}", &name[descendant_prefix.len()..]);
            transaction.execute(
                "UPDATE library_folders SET name=?1 WHERE name=?2",
                params![renamed, name],
            )?;
        }
        transaction.execute(
            "UPDATE games SET library_folder=?1 WHERE library_folder=?2",
            params![next, previous],
        )?;
        transaction.execute("UPDATE games SET library_folder=?1 || substr(library_folder, ?2) WHERE substr(library_folder, 1, ?4)=?3", params![next, previous.chars().count() + 1, descendant_prefix, descendant_prefix.chars().count()])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn rename_library_folder_with_operations(
        &mut self,
        previous: &str,
        next: &str,
        game_operations: &[(Uuid, String, Operation)],
    ) -> Result<(usize, usize), StoreError> {
        let transaction = self.connection.transaction()?;
        let system: Option<bool> = transaction
            .query_row(
                "SELECT system FROM library_folders WHERE name=?1",
                [previous],
                |row| row.get(0),
            )
            .optional()?;
        if system != Some(false) || previous == next || next.starts_with(&format!("{previous}/")) {
            return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
        }
        let descendant_prefix = format!("{previous}/");
        let descendants = {
            let mut statement = transaction.prepare("SELECT name FROM library_folders WHERE substr(name, 1, ?2)=?1 ORDER BY length(name) DESC, name")?;
            statement
                .query_map(
                    params![descendant_prefix, descendant_prefix.chars().count()],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?
        };
        let affected_folder_count = descendants.len() + 1;
        for name in descendants {
            let renamed = format!("{next}/{}", &name[descendant_prefix.len()..]);
            transaction.execute(
                "UPDATE library_folders SET name=?1 WHERE name=?2",
                params![renamed, name],
            )?;
        }
        transaction.execute(
            "UPDATE library_folders SET name=?1 WHERE name=?2",
            params![next, previous],
        )?;
        for (game_id, folder, operation) in game_operations {
            let updated = transaction.execute("UPDATE games SET library_folder=?1, updated_at=?2 WHERE id=?3 AND deleted_at IS NULL", params![folder, operation.created_at.to_rfc3339(), game_id.to_string()])?;
            if updated != 1 {
                return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
            }
            insert_operation(&transaction, operation, false)?;
        }
        transaction.commit()?;
        Ok((affected_folder_count, game_operations.len()))
    }

    pub fn move_games_to_folder_with_operations(
        &mut self,
        entries: &[(Uuid, Option<String>, Operation)],
    ) -> Result<usize, StoreError> {
        if entries.is_empty() {
            return Ok(0);
        }
        let transaction = self.connection.transaction()?;
        for (game_id, folder, operation) in entries {
            if let Some(folder) = folder.as_deref() {
                insert_library_folder_path(&transaction, folder, false)?;
            }
            let updated = transaction.execute("UPDATE games SET library_folder=?1, updated_at=?2 WHERE id=?3 AND deleted_at IS NULL", params![folder, operation.created_at.to_rfc3339(), game_id.to_string()])?;
            if updated != 1 {
                return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
            }
            insert_operation(&transaction, operation, false)?;
        }
        transaction.commit()?;
        Ok(entries.len())
    }

    pub fn delete_library_folder(&mut self, name: &str) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let system: Option<bool> = transaction
            .query_row(
                "SELECT system FROM library_folders WHERE name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        if system != Some(false) {
            return Err(StoreError::Sql(rusqlite::Error::InvalidQuery));
        }
        transaction.execute(
            "UPDATE games SET library_folder=NULL WHERE library_folder=?1",
            [name],
        )?;
        transaction.execute(
            "UPDATE games SET library_folder=NULL WHERE substr(library_folder, 1, ?2)=?1",
            params![format!("{name}/"), format!("{name}/").chars().count()],
        )?;
        transaction.execute("DELETE FROM library_folders WHERE name=?1", [name])?;
        transaction.execute(
            "DELETE FROM library_folders WHERE substr(name, 1, ?2)=?1",
            params![format!("{name}/"), format!("{name}/").chars().count()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_game_library_with_operation(
        &mut self,
        game_id: Uuid,
        folder: Option<&str>,
        favorite: bool,
        tags: &[String],
        operation: &Operation,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        if let Some(folder) = folder {
            insert_library_folder_path(&transaction, folder, false)?;
        }
        transaction.execute("UPDATE games SET library_folder=?1, favorite=?2, tags_json=?3, updated_at=?4 WHERE id=?5", params![folder, favorite as i32, serde_json::to_string(tags)?, operation.created_at.to_rfc3339(), game_id.to_string()])?;
        insert_operation(&transaction, operation, false)?;
        transaction.commit()?;
        Ok(())
    }
}
