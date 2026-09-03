//! Helpers for the local projection of Tencent Xiangqi imports.
//!
//! The bridge emits an ordered source path on every retry, while older
//! revisions used a plain `ttxq:<qipuId>` path. Keeping this parser here lets
//! storage and reconciliation code share one compatibility rule.

use super::{LocalGame, LocalStore, StoreError};
use rusqlite::{OptionalExtension, params};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const TTXQ_ANNOTATION_BEGIN: &str = "【天天象棋注解】";
const TTXQ_ANNOTATION_END: &str = "【天天象棋注解结束】";
const TTXQ_USER_DELETED_PREFIX: &str = "ttxq_user_deleted_v1:";

fn user_deleted_key(qipu_id: &str) -> String {
    format!("{TTXQ_USER_DELETED_PREFIX}{qipu_id}")
}

fn is_user_deleted(store: &LocalStore, qipu_id: &str) -> Result<bool, StoreError> {
    Ok(store
        .connection
        .query_row(
            "SELECT 1 FROM sync_state WHERE key=?1 LIMIT 1",
            [user_deleted_key(qipu_id)],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Return the stable Tencent qipu id encoded in a local source path.
pub fn qipu_id_from_source_path(source_path: &str) -> Option<&str> {
    if let Some(rest) = source_path.strip_prefix("ttxq-order:") {
        return rest
            .split_once(':')
            .map(|(_, qipu_id)| qipu_id)
            .filter(|qipu_id| !qipu_id.is_empty());
    }
    source_path
        .strip_prefix("ttxq:")
        .filter(|qipu_id| !qipu_id.is_empty())
}

/// Keep the newest visible row for each Tencent qipu id.
///
/// The SQL query removes exact ordered-path duplicates. This second pass is
/// needed for retries that changed the source order, and for rows written by
/// older bridge revisions using `ttxq:<qipuId>`. `load_games` orders rows by
/// `updated_at DESC`, so the first row encountered is the canonical one.
pub fn deduplicate_games_by_qipu(games: Vec<LocalGame>) -> Vec<LocalGame> {
    let mut seen = HashSet::new();
    games
        .into_iter()
        .filter(|game| {
            game.source_path
                .as_deref()
                .and_then(qipu_id_from_source_path)
                .map(|qipu_id| seen.insert(qipu_id.to_owned()))
                .unwrap_or(true)
        })
        .collect()
}

fn managed_annotation_block(value: &str) -> Option<&str> {
    let start = value.find(TTXQ_ANNOTATION_BEGIN)?;
    let end = value[start..].find(TTXQ_ANNOTATION_END)? + start + TTXQ_ANNOTATION_END.len();
    Some(&value[start..end])
}

fn strip_all_ttxq_annotation_blocks(value: &str) -> String {
    let mut remaining = value;
    let mut local = String::new();
    loop {
        let Some(start) = remaining.find(TTXQ_ANNOTATION_BEGIN) else {
            local.push_str(remaining);
            break;
        };
        local.push_str(&remaining[..start]);
        let content_start = start + TTXQ_ANNOTATION_BEGIN.len();
        let Some(relative_end) = remaining[content_start..].find(TTXQ_ANNOTATION_END) else {
            local.push_str(&remaining[start..]);
            break;
        };
        remaining = &remaining[content_start + relative_end + TTXQ_ANNOTATION_END.len()..];
    }
    local.trim().to_owned()
}

fn ttxq_annotation_bodies(value: &str) -> Vec<&str> {
    let mut remaining = value;
    let mut bodies = Vec::new();
    while let Some(start) = remaining.find(TTXQ_ANNOTATION_BEGIN) {
        let content_start = start + TTXQ_ANNOTATION_BEGIN.len();
        let Some(relative_end) = remaining[content_start..].find(TTXQ_ANNOTATION_END) else {
            break;
        };
        let body = remaining[content_start..content_start + relative_end].trim();
        if !body.is_empty() && !bodies.contains(&body) {
            bodies.push(body);
        }
        remaining = &remaining[content_start + relative_end + TTXQ_ANNOTATION_END.len()..];
    }
    bodies
}

fn merge_ttxq_notes(preferred: &str, secondary: &str) -> String {
    let preferred = preferred.trim();
    let secondary = secondary.trim();
    if preferred.is_empty() {
        return secondary.to_owned();
    }
    if secondary.is_empty() {
        return preferred.to_owned();
    }
    let mut source_bodies = ttxq_annotation_bodies(preferred);
    for body in ttxq_annotation_bodies(secondary) {
        if !source_bodies.contains(&body) {
            source_bodies.push(body);
        }
    }
    let mut local_lines = Vec::<&str>::new();
    // Managed Tencent text must remain inside its read-only block. Only merge
    // the text outside those blocks as editable local notes.
    let preferred_local = strip_all_ttxq_annotation_blocks(preferred);
    let secondary_local = strip_all_ttxq_annotation_blocks(secondary);
    for line in preferred_local
        .lines()
        .chain(secondary_local.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if !local_lines.contains(&line) {
            local_lines.push(line);
        }
    }
    let source = (!source_bodies.is_empty()).then(|| {
        format!(
            "{TTXQ_ANNOTATION_BEGIN}\n{}\n{TTXQ_ANNOTATION_END}",
            source_bodies.join("\n")
        )
    });
    [
        source,
        (!local_lines.is_empty()).then(|| local_lines.join("\n")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn replace_node_annotation_from_duplicate(existing: &str, duplicate: &str) -> Option<String> {
    // Older imports can leave the only node-level Tencent annotation on a
    // tombstoned duplicate. Recover just the managed block and retain any
    // local comment already present on the canonical node.
    managed_annotation_block(duplicate)?;
    let merged = merge_ttxq_notes(existing, duplicate);
    (merged.trim() != existing.trim()).then_some(merged)
}

fn node_paths(nodes: &[xiangqi_manual::MoveNode], root_id: Uuid) -> HashMap<Vec<String>, usize> {
    fn resolve(
        node_id: Uuid,
        root_id: Uuid,
        by_id: &HashMap<Uuid, usize>,
        nodes: &[xiangqi_manual::MoveNode],
        memo: &mut HashMap<Uuid, Vec<String>>,
        visiting: &mut HashSet<Uuid>,
    ) -> Option<Vec<String>> {
        if node_id == root_id {
            return Some(Vec::new());
        }
        if let Some(path) = memo.get(&node_id) {
            return Some(path.clone());
        }
        if !visiting.insert(node_id) {
            return None;
        }
        let index = *by_id.get(&node_id)?;
        let node = nodes.get(index)?;
        let mut path = resolve(node.parent_id, root_id, by_id, nodes, memo, visiting)?;
        path.push(node.mv.to_iccs());
        visiting.remove(&node_id);
        memo.insert(node_id, path.clone());
        Some(path)
    }

    let by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect::<HashMap<_, _>>();
    let mut memo = HashMap::new();
    let mut result = HashMap::new();
    for node in nodes.iter().filter(|node| !node.deleted) {
        let mut visiting = HashSet::new();
        if let Some(path) = resolve(node.id, root_id, &by_id, nodes, &mut memo, &mut visiting) {
            result.insert(path, by_id[&node.id]);
        }
    }
    result
}

/// Repair the state produced by older reconciliation builds that accidentally
/// tombstoned every copy in a Tencent qipu group. We only revive groups with
/// multiple historical copies; a single deliberately deleted game remains
/// deleted. The richest copy becomes visible and the normal annotation
/// recovery pass merges managed comments from its siblings.
fn restore_fully_tombstoned_groups(store: &mut LocalStore) -> Result<usize, StoreError> {
    struct Row {
        id: Uuid,
        deleted: bool,
        node_count: usize,
        managed_node_count: usize,
        note_has_annotations: bool,
        updated_at: String,
    }
    let mut statement = store.connection.prepare(
        "SELECT games.id, games.source_path, games.deleted_at, games.updated_at,
                games.note,
                (SELECT COUNT(*) FROM move_nodes nodes
                  WHERE nodes.game_id = games.id AND nodes.deleted_at IS NULL),
                (SELECT COUNT(*) FROM move_nodes nodes
                  WHERE nodes.game_id = games.id AND nodes.deleted_at IS NULL
                    AND nodes.comment LIKE '%【天天象棋注解】%')
         FROM games
         WHERE games.source_path LIKE 'ttxq:%'
            OR games.source_path LIKE 'ttxq-order:%'",
    )?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            Ok((
                Uuid::parse_str(&id).ok(),
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?.is_some(),
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? as usize,
                row.get::<_, i64>(6)? as usize,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut groups = HashMap::<String, Vec<Row>>::new();
    for (id, source_path, deleted, updated_at, note, node_count, managed_node_count) in rows {
        let Some(id) = id else { continue };
        let Some(qipu_id) = source_path
            .as_deref()
            .and_then(qipu_id_from_source_path)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        groups.entry(qipu_id.to_owned()).or_default().push(Row {
            id,
            deleted,
            node_count,
            managed_node_count,
            note_has_annotations: note.contains(TTXQ_ANNOTATION_BEGIN),
            updated_at,
        });
    }

    let mut revive = Vec::new();
    for (qipu_id, rows) in groups {
        if rows.len() < 2
            || rows.iter().any(|row| !row.deleted)
            // Do not resurrect a user-deleted group that has no Tencent
            // payload left. Historical import damage always retains either a
            // managed annotation block or a non-empty move tree.
            || !rows.iter().any(|row| row.note_has_annotations || row.managed_node_count > 0)
        {
            continue;
        }
        if is_user_deleted(store, &qipu_id)? {
            continue;
        }
        let Some(best) = rows.iter().max_by_key(|row| {
            (
                row.managed_node_count,
                row.node_count,
                row.note_has_annotations,
                row.updated_at.as_str(),
            )
        }) else {
            continue;
        };
        revive.push((qipu_id, best.id));
    }
    if revive.is_empty() {
        return Ok(0);
    }
    let transaction = store.connection.transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    for (qipu_id, id) in &revive {
        transaction.execute(
            "UPDATE games SET deleted_at=NULL, updated_at=?1 WHERE id=?2",
            params![now, id.to_string()],
        )?;
        transaction.execute(
            "INSERT INTO external_game_imports
             (provider, external_id, game_id, payload_hash, imported_at)
             VALUES ('ttxq', ?1, ?2, '', ?3)
             ON CONFLICT(provider, external_id) DO UPDATE SET
               game_id=excluded.game_id,
               imported_at=excluded.imported_at",
            params![qipu_id, id.to_string(), now],
        )?;
    }
    transaction.commit()?;
    Ok(revive.len())
}

/// Recover managed annotations from old, already tombstoned Tencent copies.
/// The active row remains canonical; this is a bounded local repair for users
/// who imported annotations before provider de-duplication hid that row.
fn recover_tombstoned_annotations(store: &mut LocalStore) -> Result<usize, StoreError> {
    let rows = {
        let mut statement = store.connection.prepare(
            "SELECT id, root_id, source_path, deleted_at FROM games
             WHERE source_path LIKE 'ttxq:%' OR source_path LIKE 'ttxq-order:%'",
        )?;
        statement
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let root_id: String = row.get(1)?;
                Ok((
                    Uuid::parse_str(&id).ok(),
                    Uuid::parse_str(&root_id).ok(),
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?.is_some(),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let mut active = HashMap::<String, (Uuid, Uuid)>::new();
    let mut deleted = HashMap::<String, Vec<(Uuid, Uuid)>>::new();
    for (id, root_id, source_path, tombstoned) in rows {
        let (Some(id), Some(root_id)) = (id, root_id) else {
            continue;
        };
        let Some(qipu_id) = source_path
            .as_deref()
            .and_then(qipu_id_from_source_path)
            .map(str::to_owned)
        else {
            continue;
        };
        if tombstoned {
            deleted.entry(qipu_id).or_default().push((id, root_id));
        } else {
            // Reconciliation runs before this helper, so the latest active
            // row is the canonical record for each provider id.
            active.entry(qipu_id).or_insert((id, root_id));
        }
    }
    let mut game_note_updates = Vec::<(Uuid, String)>::new();
    let mut node_updates = Vec::<(Uuid, String)>::new();
    for (qipu_id, (canonical_id, canonical_root)) in active {
        let Some(donors) = deleted.get(&qipu_id) else {
            continue;
        };
        let canonical_game = store.load_game(canonical_id)?;
        let Some(canonical_game) = canonical_game else {
            continue;
        };
        let canonical_nodes = store.load_move_nodes(canonical_id)?;
        let canonical_paths = node_paths(&canonical_nodes, canonical_root);
        let mut canonical_by_path = HashMap::<Vec<String>, (Uuid, String)>::new();
        for (path, index) in canonical_paths {
            if let Some(node) = canonical_nodes.get(index) {
                canonical_by_path.insert(path, (node.id, node.comment.clone()));
            }
        }
        let mut merged_note = canonical_game.note.clone();
        for (donor_id, donor_root) in donors {
            let Some(donor_game) = store.load_game_including_deleted(*donor_id)? else {
                continue;
            };
            merged_note = merge_ttxq_notes(&merged_note, &donor_game.note);
            let donor_nodes = store.load_move_nodes(*donor_id)?;
            let donor_paths = node_paths(&donor_nodes, *donor_root);
            for (path, donor_index) in donor_paths {
                let Some(donor_node) = donor_nodes.get(donor_index) else {
                    continue;
                };
                let Some((node_id, existing)) = canonical_by_path.get(&path).cloned() else {
                    continue;
                };
                let Some(comment) =
                    replace_node_annotation_from_duplicate(&existing, &donor_node.comment)
                else {
                    continue;
                };
                canonical_by_path.insert(path, (node_id, comment.clone()));
                node_updates.push((node_id, comment));
            }
        }
        if merged_note != canonical_game.note {
            game_note_updates.push((canonical_id, merged_note));
        }
    }
    if game_note_updates.is_empty() && node_updates.is_empty() {
        return Ok(0);
    }
    let transaction = store.connection.transaction()?;
    for (game_id, note) in &game_note_updates {
        transaction.execute(
            "UPDATE games SET note=?1, updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
            params![note, chrono::Utc::now().to_rfc3339(), game_id.to_string()],
        )?;
    }
    for (node_id, comment) in &node_updates {
        transaction.execute(
            "UPDATE move_nodes SET comment=?1 WHERE id=?2 AND deleted_at IS NULL",
            params![comment, node_id.to_string()],
        )?;
    }
    transaction.commit()?;
    Ok(game_note_updates.len() + node_updates.len())
}

/// Merge active rows left behind by older Tencent imports. This is local
/// housekeeping only: obsolete copies are soft-deleted and never emitted as
/// cloud delete operations. Prefer the richest row so a transient retry cannot
/// replace a record that already contains Tencent annotations.
pub fn reconcile_duplicate_games(store: &mut LocalStore) -> Result<usize, StoreError> {
    // This repair is deliberately idempotent. Explicit user deletion writes a
    // per-qipu marker, so running it on every reconciliation can heal damage
    // produced after an older one-shot migration without reviving records the
    // user intentionally removed.
    let restored = restore_fully_tombstoned_groups(store)?;
    store.connection.execute(
        "INSERT INTO sync_state (key, value) VALUES ('ttxq_tombstone_repair_v2', '1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )?;
    struct Row {
        id: Uuid,
        qipu_id: String,
        note: String,
        library_folder: Option<String>,
        favorite: bool,
        tags_json: String,
        node_count: usize,
        managed_node_count: usize,
        active: bool,
    }
    let mut statement = store.connection.prepare(
        "SELECT games.id, games.source_path, games.note, games.library_folder,
                games.favorite, games.tags_json, imports.external_id,
                games.deleted_at,
                (SELECT COUNT(*) FROM move_nodes nodes
                  WHERE nodes.game_id = games.id AND nodes.deleted_at IS NULL)
                ,(SELECT COUNT(*) FROM move_nodes nodes
                  WHERE nodes.game_id = games.id
                    AND nodes.deleted_at IS NULL
                    AND nodes.comment LIKE '%【天天象棋注解】%')
         FROM games
         LEFT JOIN external_game_imports imports
           ON imports.game_id = games.id AND imports.provider = 'ttxq'
         -- Tombstoned Tencent rows are historical records, not import
         -- candidates. Including them here can select a deleted row as the
         -- canonical record when every visible copy was already soft-deleted,
         -- making the whole qipu disappear from the library on refresh.
         WHERE games.deleted_at IS NULL
           AND (games.source_path LIKE 'ttxq:%'
                OR games.source_path LIKE 'ttxq-order:%'
                OR imports.external_id IS NOT NULL)
         ORDER BY games.updated_at DESC, games.id DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let source_path: Option<String> = row.get(1)?;
            Ok((
                id,
                source_path,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)? != 0,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?.is_none(),
                row.get::<_, i64>(8)? as usize,
                row.get::<_, i64>(9)? as usize,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut groups = std::collections::HashMap::<String, Vec<Row>>::new();
    let mut seen_physical_rows = HashSet::new();
    for (
        id,
        source_path,
        note,
        library_folder,
        favorite,
        tags_json,
        external_id,
        active,
        node_count,
        managed_node_count,
    ) in rows
    {
        let Ok(id) = Uuid::parse_str(&id) else {
            continue;
        };
        // LEFT JOIN can return one physical row more than once when an older
        // build left conflicting provider mappings. A UUID must participate
        // in exactly one identity group during this reconciliation pass.
        if !seen_physical_rows.insert(id) {
            continue;
        }
        // A Tencent source path belongs to the physical game row and is more
        // reliable than a stale external mapping left by an interrupted
        // import. Use mappings only for legacy rows without a Tencent path.
        let Some(qipu_id) = source_path
            .as_deref()
            .and_then(qipu_id_from_source_path)
            .or_else(|| external_id.as_deref().filter(|value| !value.is_empty()))
        else {
            continue;
        };
        let row = Row {
            id,
            qipu_id: qipu_id.to_owned(),
            note,
            library_folder,
            favorite,
            tags_json,
            node_count,
            managed_node_count,
            active,
        };
        groups.entry(row.qipu_id.clone()).or_default().push(row);
    }
    let mut duplicates = Vec::new();
    for rows in groups.into_values() {
        if rows.len() < 2 {
            continue;
        }
        let rank = |row: &Row| {
            (
                row.active,
                row.note.contains(TTXQ_ANNOTATION_BEGIN),
                row.managed_node_count,
                row.node_count,
            )
        };
        let mut canonical_index = 0;
        for index in 1..rows.len() {
            if rank(&rows[index]) > rank(&rows[canonical_index]) {
                canonical_index = index;
            }
        }
        let canonical = &rows[canonical_index];
        let mut merged_note = canonical.note.clone();
        let mut merged_folder = canonical.library_folder.clone();
        let mut merged_favorite = canonical.favorite;
        let mut tags =
            serde_json::from_str::<Vec<String>>(&canonical.tags_json).unwrap_or_default();
        for (index, row) in rows.iter().enumerate() {
            if index == canonical_index {
                continue;
            }
            // A malformed/legacy import can duplicate the same game row
            // through an old external mapping. Never feed the canonical UUID
            // back into the tombstone update below.
            if row.id == canonical.id {
                continue;
            }
            merged_note = merge_ttxq_notes(&merged_note, &row.note);
            merged_folder = merged_folder.or_else(|| row.library_folder.clone());
            merged_favorite |= row.favorite;
            for tag in serde_json::from_str::<Vec<String>>(&row.tags_json).unwrap_or_default() {
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
            duplicates.push((
                row.id,
                canonical.id,
                merged_note.clone(),
                merged_folder.clone(),
                merged_favorite,
                serde_json::to_string(&tags)?,
            ));
        }
    }
    if duplicates.is_empty() {
        // Even after the duplicate rows were hidden by an earlier build, an
        // active canonical row may still be missing the node annotations that
        // existed on one of those tombstones. Recover those comments without
        // resurrecting or re-exposing the old row.
        recover_tombstoned_annotations(store)?;
        return Ok(restored);
    }
    let transaction = store.connection.transaction()?;
    for (duplicate_id, canonical_id, note, folder, favorite, tags_json) in &duplicates {
        transaction.execute(
            "UPDATE games SET note=?1, library_folder=?2, favorite=?3, tags_json=?4, updated_at=?5 WHERE id=?6",
            params![note, folder, *favorite as i32, tags_json, chrono::Utc::now().to_rfc3339(), canonical_id.to_string()],
        )?;
        transaction.execute(
            "UPDATE games SET deleted_at=?1, updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",
            params![chrono::Utc::now().to_rfc3339(), duplicate_id.to_string()],
        )?;
        transaction.execute(
            "DELETE FROM external_game_imports WHERE game_id=?1",
            [duplicate_id.to_string()],
        )?;
    }
    transaction.commit()?;
    recover_tombstoned_annotations(store)?;
    Ok(duplicates.len() + restored)
}

impl LocalStore {
    pub fn mark_ttxq_user_deleted(&mut self, qipu_id: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![user_deleted_key(qipu_id), chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn clear_ttxq_user_deleted(&mut self, qipu_id: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "DELETE FROM sync_state WHERE key=?1",
            [user_deleted_key(qipu_id)],
        )?;
        Ok(())
    }

    pub fn mark_ttxq_game_user_deleted(&mut self, game_id: Uuid) -> Result<(), StoreError> {
        let source_path = self
            .connection
            .query_row(
                "SELECT source_path FROM games WHERE id=?1",
                [game_id.to_string()],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if let Some(qipu_id) = source_path.as_deref().and_then(qipu_id_from_source_path) {
            self.mark_ttxq_user_deleted(qipu_id)?;
        }
        Ok(())
    }

    /// Resolve the active local row for a Tencent provider id. External import
    /// mappings are authoritative when an older bridge changed the source path
    /// format, while the source-path fallback keeps legacy rows readable.
    pub fn find_ttxq_game_id(&self, qipu_id: &str) -> Result<Option<Uuid>, StoreError> {
        let mapped = self
            .connection
            .query_row(
                "SELECT games.id
                 FROM external_game_imports imports
                 JOIN games ON games.id = imports.game_id
                 WHERE imports.provider = 'ttxq'
                   AND imports.external_id = ?1
                   AND games.deleted_at IS NULL
                 ORDER BY games.updated_at DESC, games.id DESC
                 LIMIT 1",
                [qipu_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(id) = mapped {
            return Ok(Uuid::parse_str(&id).ok());
        }
        let fallback = self
            .connection
            .query_row(
                "SELECT id FROM games
                 WHERE deleted_at IS NULL
                   AND (source_path = ?1 OR source_path LIKE ?2)
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1",
                rusqlite::params![format!("ttxq:{qipu_id}"), format!("ttxq-order:%:{qipu_id}")],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(fallback.and_then(|id| Uuid::parse_str(&id).ok()))
    }

    pub fn reconcile_ttxq_duplicates(&mut self) -> Result<usize, StoreError> {
        reconcile_duplicate_games(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_ttxq_notes, qipu_id_from_source_path};

    #[test]
    fn parses_current_and_legacy_ttxq_paths() {
        assert_eq!(
            qipu_id_from_source_path("ttxq-order:000007:51244181592"),
            Some("51244181592")
        );
        assert_eq!(
            qipu_id_from_source_path("ttxq:51244181592"),
            Some("51244181592")
        );
        assert_eq!(qipu_id_from_source_path("pgn:51244181592"), None);
    }

    #[test]
    fn merging_duplicate_notes_keeps_all_source_text_inside_the_managed_block() {
        let merged = merge_ttxq_notes(
            "【天天象棋注解】\n第一条\n【天天象棋注解结束】\n\n本地甲",
            "【天天象棋注解】\n第二条\n【天天象棋注解结束】\n\n本地乙",
        );

        assert_eq!(merged.matches("【天天象棋注解】").count(), 1);
        assert_eq!(merged.matches("【天天象棋注解结束】").count(), 1);
        assert!(merged.contains("第一条\n第二条\n【天天象棋注解结束】"));
        assert!(merged.ends_with("本地甲\n本地乙"));
    }
}
