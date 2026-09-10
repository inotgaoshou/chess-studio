use chrono::Utc;
use manual_format::{CBL_PARSER_VERSION, CblGame, import_cbl_game_library_reader};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    collections::BTreeSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};
use thiserror::Error;
use uuid::Uuid;
use xiangqi_core::{Board, Color};

#[derive(Debug, Error)]
pub enum ReferenceLibraryError {
    #[error("SQLite 错误：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("文件错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("棋谱数据错误：{0}")]
    InvalidData(String),
    #[error("找不到资料源：{0}")]
    SourceNotFound(String),
    #[error("找不到导入批次：{0}")]
    BatchNotFound(String),
}

pub type Result<T> = std::result::Result<T, ReferenceLibraryError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSource {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub auto_scan: bool,
    pub license_status: String,
    pub active: bool,
    pub last_scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceImportBatch {
    pub id: String,
    pub source_id: String,
    pub status: String,
    pub review_status: String,
    pub discovered_files: u32,
    pub changed_files: u32,
    pub imported_records: u32,
    pub revised_records: u32,
    pub duplicate_records: u32,
    pub invalid_records: u32,
    pub empty_files: u32,
    pub unclassified_records: u32,
    pub warnings: Vec<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PositionMoveStat {
    pub iccs: String,
    pub notation: String,
    pub samples: u64,
    pub red_wins: u64,
    pub draws: u64,
    pub black_wins: u64,
    pub first_year: Option<u16>,
    pub last_year: Option<u16>,
    pub opening_code: Option<String>,
    pub opening_name: Option<String>,
    pub opening_confidence: Option<u8>,
    pub representative_game_id: Option<String>,
    pub representative_game_title: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PositionExplorerRequest {
    pub fen: String,
    pub limit: Option<usize>,
    pub player: Option<String>,
    pub event: Option<String>,
    pub year_from: Option<i32>,
    pub year_to: Option<i32>,
    pub side: Option<String>,
    pub master_only: Option<bool>,
    pub include_details: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGameFilters {
    pub player: Option<String>,
    pub event: Option<String>,
    pub year_from: Option<i32>,
    pub year_to: Option<i32>,
    pub side: Option<String>,
    pub master_only: Option<bool>,
    pub classification_status: Option<String>,
    pub position_fen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpeningCategory {
    pub code: String,
    pub series_code: String,
    pub parent_code: Option<String>,
    pub name: String,
    pub aliases: Vec<String>,
    pub sort_order: i32,
    pub game_count: u64,
    pub red_wins: u64,
    pub draws: u64,
    pub black_wins: u64,
    pub first_year: Option<u16>,
    pub last_year: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpeningMatch {
    pub game_id: String,
    pub primary_code: Option<String>,
    pub candidates: Vec<String>,
    pub method: String,
    pub confidence: f64,
    pub matched_plies: u32,
    pub classifier_version: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpeningCatalogBuildResult {
    pub classifier_version: i64,
    pub category_count: u64,
    pub alias_count: u64,
    pub pattern_count: u64,
    pub classified_games: u64,
    pub pending_games: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceReviewIssue {
    pub id: String,
    pub kind: String,
    pub game_id: String,
    pub candidate_game_id: Option<String>,
    pub title: String,
    pub red_player: String,
    pub black_player: String,
    pub game_date: String,
    pub opening: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGameSummary {
    pub id: String,
    pub canonical_fingerprint: String,
    pub title: String,
    pub red_player: String,
    pub black_player: String,
    pub result: String,
    pub event_name: String,
    pub round_name: String,
    pub game_date: String,
    pub opening: String,
    pub opening_code: Option<String>,
    pub move_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGameDocument {
    pub game: ReferenceGameSummary,
    pub document_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePublishBatch {
    pub source_id: String,
    pub client_batch_id: String,
    pub parser_version: u32,
    pub games: Vec<ReferencePublishGame>,
    pub removed_records: Vec<ReferencePublishRemoval>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePublishRemoval {
    pub relative_path: String,
    pub record_index: u32,
    pub record_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePublishGame {
    pub relative_path: String,
    pub file_sha256: String,
    pub record_index: u32,
    pub record_hash: String,
    pub canonical_fingerprint: String,
    pub moves_hash: String,
    pub title: String,
    pub red_player: String,
    pub black_player: String,
    pub event_name: Option<String>,
    pub round_name: Option<String>,
    pub game_date: Option<String>,
    pub result: String,
    pub opening: Option<String>,
    pub starting_fen: String,
    pub moves: Vec<String>,
    pub opening_code: Option<String>,
    pub license_note: String,
}

pub struct ReferenceLibrary {
    connection: Connection,
    canonical_fingerprint_cache: RefCell<Option<Arc<[String]>>>,
    published_fingerprint_cache: RefCell<Option<Arc<[String]>>>,
    query_exclusion_cache: RefCell<Option<Arc<[String]>>>,
}

impl ReferenceLibrary {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    pub fn validate_offline_package(path: impl AsRef<Path>) -> Result<u64> {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(ReferenceLibraryError::InvalidData(format!(
                "离线参考库完整性校验失败：{integrity}"
            )));
        }
        for table in [
            "reference_games",
            "reference_game_moves",
            "reference_position_move_stats",
            "opening_categories",
        ] {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(ReferenceLibraryError::InvalidData(format!(
                    "离线参考库缺少数据表 {table}"
                )));
            }
        }
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM reference_games
             WHERE active=1 AND validation_status='valid'",
            [],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as u64)
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(SCHEMA)?;
        migrate_local_schema(&connection)?;
        connection.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS temp_reference_exclusions (
               canonical_fingerprint TEXT PRIMARY KEY
             );",
        )?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        seed_opening_catalog(&connection)?;
        Ok(Self {
            connection,
            canonical_fingerprint_cache: RefCell::new(None),
            published_fingerprint_cache: RefCell::new(None),
            query_exclusion_cache: RefCell::new(None),
        })
    }

    pub fn register_source(
        &mut self,
        root_path: impl AsRef<Path>,
        display_name: &str,
        auto_scan: bool,
        license_status: &str,
    ) -> Result<ReferenceSource> {
        let root_path = fs::canonicalize(root_path.as_ref())?;
        if !root_path.is_dir() && !root_path.is_file() {
            return Err(ReferenceLibraryError::InvalidData(
                "资料源必须是 CBL 文件或目录".into(),
            ));
        }
        let root_path = root_path.to_string_lossy().into_owned();
        let existing: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM reference_sources WHERE root_path = ?1",
                [&root_path],
                |row| row.get(0),
            )
            .optional()?;
        let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        self.connection.execute(
            "INSERT INTO reference_sources
             (id, display_name, root_path, source_type, auto_scan, license_status, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'cbl', ?4, ?5, 1, ?6, ?6)
             ON CONFLICT(root_path) DO UPDATE SET display_name=excluded.display_name,
               auto_scan=excluded.auto_scan, license_status=excluded.license_status,
               active=1, updated_at=excluded.updated_at",
            params![id, display_name.trim(), root_path, auto_scan, license_status.trim(), now()],
        )?;
        self.source(&id)
    }

    pub fn sources(&self) -> Result<Vec<ReferenceSource>> {
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, root_path, auto_scan, license_status, active, last_scanned_at
             FROM reference_sources ORDER BY display_name, id",
        )?;
        let rows = statement.query_map([], map_source)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn game_count(&self) -> Result<u64> {
        let count: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM reference_games
             WHERE active=1 AND validation_status='valid'",
            [],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as u64)
    }

    pub fn canonical_fingerprints(&self) -> Result<Arc<[String]>> {
        if let Some(cached) = self.canonical_fingerprint_cache.borrow().as_ref() {
            return Ok(Arc::clone(cached));
        }
        let mut statement = self.connection.prepare(
            "SELECT canonical_fingerprint FROM reference_games
             WHERE active=1 AND validation_status='valid' AND identity_complete=1
             ORDER BY canonical_fingerprint",
        )?;
        let fingerprints: Arc<[String]> = statement
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into();
        *self.canonical_fingerprint_cache.borrow_mut() = Some(Arc::clone(&fingerprints));
        Ok(fingerprints)
    }

    fn published_fingerprints(&self) -> Result<Arc<[String]>> {
        if let Some(cached) = self.published_fingerprint_cache.borrow().as_ref() {
            return Ok(Arc::clone(cached));
        }
        let mut statement = self.connection.prepare(
            "SELECT canonical_fingerprint FROM reference_published_fingerprints
             ORDER BY canonical_fingerprint",
        )?;
        let fingerprints: Arc<[String]> = statement
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into();
        *self.published_fingerprint_cache.borrow_mut() = Some(Arc::clone(&fingerprints));
        Ok(fingerprints)
    }

    fn replace_query_exclusions(&self, fingerprints: Option<&Arc<[String]>>) -> Result<()> {
        let unchanged = {
            let cached = self.query_exclusion_cache.borrow();
            match (cached.as_ref(), fingerprints) {
                (None, None) => true,
                (Some(cached), Some(next)) => Arc::ptr_eq(cached, next),
                _ => false,
            }
        };
        if unchanged {
            return Ok(());
        }
        self.connection
            .execute("DELETE FROM temp_reference_exclusions", [])?;
        if let Some(fingerprints) = fingerprints {
            let mut statement = self.connection.prepare(
                "INSERT OR IGNORE INTO temp_reference_exclusions (canonical_fingerprint) VALUES (?1)",
            )?;
            for fingerprint in fingerprints.iter() {
                statement.execute([fingerprint])?;
            }
        }
        *self.query_exclusion_cache.borrow_mut() = fingerprints.cloned();
        Ok(())
    }

    pub fn auto_scan_sources(&mut self) -> Result<Vec<ReferenceImportBatch>> {
        let ids = self
            .sources()?
            .into_iter()
            .filter(|source| source.active && source.auto_scan)
            .map(|source| source.id)
            .collect::<Vec<_>>();
        ids.into_iter().map(|id| self.scan_source(&id)).collect()
    }

    pub fn batches(
        &self,
        source_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ReferenceImportBatch>> {
        let mut statement = self.connection.prepare(
            "SELECT id, source_id, status, review_status, discovered_files, changed_files,
                    imported_records, revised_records, duplicate_records, invalid_records,
                    empty_files, unclassified_records, warnings_json, created_at, completed_at
             FROM reference_import_batches
             WHERE (?1 IS NULL OR source_id = ?1)
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )?;
        let rows =
            statement.query_map(params![source_id, limit.clamp(1, 500) as i64], map_batch)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn scan_source(&mut self, source_id: &str) -> Result<ReferenceImportBatch> {
        self.canonical_fingerprint_cache.get_mut().take();
        let source = self.source(source_id)?;
        let root = PathBuf::from(&source.root_path);
        let files = cbl_files(&root)?;
        let discovered_files = files.len() as u32;
        let batch_id = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO reference_import_batches
             (id, source_id, status, review_status, discovered_files, created_at, parser_version)
             VALUES (?1, ?2, 'running', 'pending', ?3, ?4, ?5)",
            params![
                batch_id,
                source_id,
                discovered_files,
                now(),
                CBL_PARSER_VERSION
            ],
        )?;

        let mut counts = ScanCounts::default();
        let mut warnings = Vec::new();
        let mut seen = BTreeSet::new();
        for path in files {
            let relative_path = relative_source_path(&root, &path);
            seen.insert(relative_path.clone());
            let file_hash = match hash_file(&path) {
                Ok(hash) => hash,
                Err(error) => {
                    counts.invalid_records += 1;
                    warnings.push(format!("{relative_path}：{error}"));
                    continue;
                }
            };
            let previous = latest_source_file(&self.connection, source_id, &relative_path)?;
            if previous.as_ref().is_some_and(|item| {
                item.active
                    && item.sha256 == file_hash
                    && matches!(item.status.as_str(), "parsed" | "empty")
            }) {
                self.connection.execute(
                    "UPDATE reference_import_files SET active=1, last_seen_at=?1
                     WHERE id=?2",
                    params![now(), previous.as_ref().map(|item| item.id.as_str())],
                )?;
                self.connection.execute(
                    "UPDATE reference_game_sources SET active=1, last_seen_at=?1
                     WHERE source_id=?2 AND relative_path=?3",
                    params![now(), source_id, relative_path],
                )?;
                continue;
            }
            counts.changed_files += 1;
            let revision = previous.as_ref().map_or(1, |item| item.revision + 1);
            let file_id = Uuid::new_v4().to_string();
            let byte_size = match fs::metadata(&path) {
                Ok(metadata) => metadata.len() as i64,
                Err(error) => {
                    counts.invalid_records += 1;
                    warnings.push(format!("{relative_path}：读取文件信息失败：{error}"));
                    continue;
                }
            };
            self.connection.execute(
                "INSERT INTO reference_import_files
                 (id, batch_id, source_id, relative_path, sha256, byte_size, revision,
                  status, active, first_seen_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'parsing', 0, ?8, ?8)",
                params![
                    file_id,
                    batch_id,
                    source_id,
                    relative_path,
                    file_hash,
                    byte_size,
                    revision,
                    now()
                ],
            )?;
            let mut file = match File::open(&path) {
                Ok(file) => file,
                Err(error) => {
                    counts.invalid_records += 1;
                    warnings.push(format!("{relative_path}：打开文件失败：{error}"));
                    self.connection.execute(
                        "UPDATE reference_import_files SET status='invalid', warning_count=1 WHERE id=?1",
                        [&file_id],
                    )?;
                    continue;
                }
            };
            let mut per_file = ScanCounts::default();
            let parse_result = {
                let transaction = self.connection.transaction()?;
                let previous_sources =
                    active_path_sources(&transaction, source_id, &relative_path)?;
                transaction.execute(
                    "UPDATE reference_import_files SET active=0
                     WHERE source_id=?1 AND relative_path=?2 AND id<>?3",
                    params![source_id, relative_path, file_id],
                )?;
                transaction.execute(
                    "UPDATE reference_game_sources SET active=0
                     WHERE source_id=?1 AND relative_path=?2",
                    params![source_id, relative_path],
                )?;
                let parsed = import_cbl_game_library_reader(&mut file, None, |game| {
                    ingest_game(
                        &transaction,
                        source_id,
                        &file_id,
                        &batch_id,
                        &relative_path,
                        game,
                        &mut per_file,
                    )
                    .map_err(|error| error.to_string())
                });
                match parsed {
                    Ok(summary) => {
                        record_removed_sources(
                            &transaction,
                            source_id,
                            &batch_id,
                            &relative_path,
                            &previous_sources,
                        )?;
                        transaction.execute(
                            "UPDATE reference_import_files SET status=?1, active=1, declared_records=?2,
                             parsed_records=?3, warning_count=?4 WHERE id=?5",
                            params![
                                if summary.game_count == 0 { "empty" } else { "parsed" },
                                summary.declared_count,
                                summary.game_count,
                                summary.warnings.len() as i64,
                                file_id
                            ],
                        )?;
                        transaction.commit()?;
                        Ok(summary)
                    }
                    Err(error) => Err(error),
                }
            };
            match parse_result {
                Ok(summary) => {
                    warnings.extend(
                        summary
                            .warnings
                            .iter()
                            .map(|warning| format!("{relative_path}：{warning}")),
                    );
                    per_file.invalid_records += summary
                        .warnings
                        .iter()
                        .filter(|warning| warning.contains("记录已跳过"))
                        .count() as u32;
                    if summary.game_count == 0 {
                        per_file.empty_files += 1;
                    }
                }
                Err(error) => {
                    per_file = ScanCounts::default();
                    per_file.invalid_records = 1;
                    warnings.push(format!("{relative_path}：{error}"));
                    self.connection.execute(
                        "UPDATE reference_import_files SET status='invalid', warning_count=warning_count+1 WHERE id=?1",
                        [&file_id],
                    )?;
                }
            }
            counts.merge(per_file);
        }
        let transaction = self.connection.transaction()?;
        let removed_files = deactivate_missing_files(&transaction, source_id, &batch_id, &seen)?;
        if counts.changed_files > 0 || removed_files > 0 {
            reconcile_active_games(&transaction)?;
            rebuild_position_statistics(&transaction)?;
        }
        transaction.commit()?;

        let status = if counts.invalid_records > 0 {
            "completed_with_issues"
        } else {
            "completed"
        };
        let completed_at = now();
        self.connection.execute(
            "UPDATE reference_import_batches SET status=?1, changed_files=?2,
             imported_records=?3, revised_records=?4, duplicate_records=?5,
             invalid_records=?6, empty_files=?7, unclassified_records=?8,
             warnings_json=?9, completed_at=?10 WHERE id=?11",
            params![
                status,
                counts.changed_files,
                counts.imported_records,
                counts.revised_records,
                counts.duplicate_records,
                counts.invalid_records,
                counts.empty_files,
                counts.unclassified_records,
                serde_json::to_string(&warnings).unwrap_or_else(|_| "[]".into()),
                completed_at,
                batch_id
            ],
        )?;
        self.connection.execute(
            "UPDATE reference_sources SET last_scanned_at=?1, updated_at=?1 WHERE id=?2",
            params![completed_at, source_id],
        )?;
        if counts.changed_files > 0 {
            self.classify_batch(&batch_id)?;
        } else if removed_files > 0 {
            rebuild_opening_category_stats(&self.connection)?;
        }
        self.batch(&batch_id)
    }

    pub fn review_batch(
        &mut self,
        batch_id: &str,
        approved: bool,
        note: &str,
    ) -> Result<ReferenceImportBatch> {
        if approved
            && self
                .batch_review_issues(batch_id)?
                .iter()
                .any(|issue| matches!(issue.kind.as_str(), "identity" | "duplicate"))
        {
            return Err(ReferenceLibraryError::InvalidData(
                "批次仍有棋手身份或重复候选问题，请先处理".into(),
            ));
        }
        let changed = self.connection.execute(
            "UPDATE reference_import_batches SET review_status=?1, review_note=?2,
             reviewed_at=?3 WHERE id=?4",
            params![
                if approved { "approved" } else { "rejected" },
                note.trim(),
                now(),
                batch_id
            ],
        )?;
        if changed == 0 {
            return Err(ReferenceLibraryError::BatchNotFound(batch_id.into()));
        }
        self.batch(batch_id)
    }

    pub fn classify_batch(&mut self, batch_id: &str) -> Result<Vec<OpeningMatch>> {
        seed_opening_catalog(&self.connection)?;
        self.batch(batch_id)?;
        let classifier_version: i64 = self.connection.query_row(
            "SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT DISTINCT g.id, g.opening, g.starting_fen, g.moves_json
             FROM reference_import_records r JOIN reference_games g ON g.id=r.game_id
             WHERE r.batch_id=?1 AND r.status IN ('imported','duplicate','revised')",
        )?;
        let games = statement
            .query_map([batch_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        let mut matches = Vec::with_capacity(games.len());
        let standard_key = Board::from_fen(xiangqi_core::STARTING_FEN)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?
            .rule_position_key();
        for (game_id, raw_opening, starting_fen, moves_json) in games {
            let moves: Vec<String> = serde_json::from_str(&moves_json).unwrap_or_default();
            let is_standard_start = Board::from_fen(&starting_fen)
                .map(|board| board.rule_position_key() == standard_key)
                .unwrap_or(false);
            let opening_match = classify_game(
                &self.connection,
                &game_id,
                &raw_opening,
                &moves,
                is_standard_start,
                classifier_version,
            )?;
            matches.push(opening_match);
        }
        let unclassified = matches
            .iter()
            .filter(|item| item.primary_code.is_none())
            .count() as i64;
        self.connection.execute(
            "UPDATE reference_import_batches SET unclassified_records=?1 WHERE id=?2",
            params![unclassified, batch_id],
        )?;
        rebuild_opening_category_stats(&self.connection)?;
        Ok(matches)
    }

    pub fn rebuild_opening_catalog(&mut self) -> Result<OpeningCatalogBuildResult> {
        seed_opening_catalog(&self.connection)?;
        seed_opening_alias_candidates(&self.connection)?;
        rebuild_opening_category_stats(&self.connection)?;
        opening_catalog_build_result(&self.connection)
    }

    pub fn classify_library(&mut self, limit: Option<usize>) -> Result<OpeningCatalogBuildResult> {
        seed_opening_catalog(&self.connection)?;
        let classifier_version: i64 = self.connection.query_row(
            "SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, opening, starting_fen, moves_json
             FROM reference_games
             WHERE active=1 AND validation_status='valid'
             ORDER BY updated_at DESC, id DESC LIMIT ?1",
        )?;
        let games = statement
            .query_map(
                [limit.unwrap_or(usize::MAX).min(i64::MAX as usize) as i64],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        let standard_key = Board::from_fen(xiangqi_core::STARTING_FEN)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?
            .rule_position_key();
        for (game_id, raw_opening, starting_fen, moves_json) in games {
            let moves: Vec<String> = serde_json::from_str(&moves_json).unwrap_or_default();
            let is_standard_start = Board::from_fen(&starting_fen)
                .map(|board| board.rule_position_key() == standard_key)
                .unwrap_or(false);
            classify_game(
                &self.connection,
                &game_id,
                &raw_opening,
                &moves,
                is_standard_start,
                classifier_version,
            )?;
        }
        rebuild_opening_category_stats(&self.connection)?;
        opening_catalog_build_result(&self.connection)
    }

    pub fn batch_review_issues(&self, batch_id: &str) -> Result<Vec<ReferenceReviewIssue>> {
        self.batch(batch_id)?;
        let mut statement = self.connection.prepare(
            "SELECT DISTINCT g.id,g.title,g.red_player,g.black_player,g.game_date,g.opening,
                    g.identity_complete,g.validation_status,
                    NOT EXISTS (
                      SELECT 1 FROM game_opening_classifications c
                      WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                        AND c.classifier_version_id=(
                          SELECT id FROM opening_classifier_versions WHERE active=1
                          ORDER BY id DESC LIMIT 1
                        )
                    )
             FROM reference_import_records r JOIN reference_games g ON g.id=r.game_id
             WHERE r.batch_id=?1 ORDER BY g.title,g.id",
        )?;
        let rows = statement
            .query_map([batch_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, bool>(8)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        let mut issues = Vec::new();
        for (game_id, title, red, black, date, opening, identity_complete, status, unclassified) in
            rows
        {
            if !identity_complete {
                issues.push(ReferenceReviewIssue {
                    id: format!("identity:{game_id}"),
                    kind: "identity".into(),
                    game_id: game_id.clone(),
                    candidate_game_id: None,
                    title: title.clone(),
                    red_player: red.clone(),
                    black_player: black.clone(),
                    game_date: date.clone(),
                    opening: opening.clone(),
                    detail: "棋手或完整日期缺失".into(),
                });
            }
            if unclassified && status != "duplicate_pending" {
                issues.push(ReferenceReviewIssue {
                    id: format!("opening:{game_id}"),
                    kind: "opening".into(),
                    game_id: game_id.clone(),
                    candidate_game_id: None,
                    title: title.clone(),
                    red_player: red.clone(),
                    black_player: black.clone(),
                    game_date: date.clone(),
                    opening: opening.clone(),
                    detail: "没有唯一布局分类".into(),
                });
            }
        }
        let mut duplicates = self.connection.prepare(
            "SELECT d.id,d.incoming_game_id,d.candidate_game_id,g.title,g.red_player,
                    g.black_player,g.game_date,g.opening
             FROM reference_duplicate_candidates d
             JOIN reference_games g ON g.id=d.incoming_game_id
             JOIN reference_import_records r ON r.game_id=d.incoming_game_id
             WHERE r.batch_id=?1 AND d.status='pending'
             ORDER BY g.title,d.id",
        )?;
        let duplicate_rows = duplicates.query_map([batch_id], |row| {
            Ok(ReferenceReviewIssue {
                id: row.get(0)?,
                kind: "duplicate".into(),
                game_id: row.get(1)?,
                candidate_game_id: row.get(2)?,
                title: row.get(3)?,
                red_player: row.get(4)?,
                black_player: row.get(5)?,
                game_date: row.get(6)?,
                opening: row.get(7)?,
                detail: "主线着法相同但身份信息不足".into(),
            })
        })?;
        issues.extend(duplicate_rows.collect::<std::result::Result<Vec<_>, _>>()?);
        Ok(issues)
    }

    pub fn update_game_identity(
        &mut self,
        game_id: &str,
        red_player: &str,
        black_player: &str,
        game_date: &str,
    ) -> Result<()> {
        let red_player = normalize_name(red_player);
        let black_player = normalize_name(black_player);
        let game_date = normalize_date(game_date);
        if red_player.is_empty() || black_player.is_empty() || !is_full_date(&game_date) {
            return Err(ReferenceLibraryError::InvalidData(
                "红黑棋手和 YYYY-MM-DD 完整日期均为必填".into(),
            ));
        }
        let (starting_fen, moves_json): (String, String) = self
            .connection
            .query_row(
                "SELECT starting_fen,moves_json FROM reference_games WHERE id=?1",
                [game_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| ReferenceLibraryError::InvalidData("找不到待修正棋局".into()))?;
        let board = Board::from_fen(&starting_fen)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let moves: Vec<String> = serde_json::from_str(&moves_json)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let fingerprint =
            canonical_fingerprint_parts(&board, &red_player, &black_player, &game_date, &moves);
        let collision: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM reference_games WHERE dedupe_key=?1 AND id<>?2 LIMIT 1",
                params![fingerprint, game_id],
                |row| row.get(0),
            )
            .optional()?;
        if collision.is_some() {
            return Err(ReferenceLibraryError::InvalidData(
                "修正后的身份与现有棋局重复，请在重复候选中合并".into(),
            ));
        }
        self.connection.execute(
            "UPDATE reference_games SET red_player=?1,black_player=?2,game_date=?3,
             canonical_fingerprint=?4,dedupe_key=?4,identity_complete=1,
             validation_status='valid',updated_at=?5 WHERE id=?6",
            params![
                red_player,
                black_player,
                game_date,
                fingerprint,
                now(),
                game_id
            ],
        )?;
        self.connection.execute(
            "UPDATE reference_duplicate_candidates SET status='identity_corrected',reviewed_at=?1
             WHERE incoming_game_id=?2 AND status='pending'",
            params![now(), game_id],
        )?;
        self.connection.execute(
            "UPDATE reference_import_records SET status='imported'
             WHERE game_id=?1 AND status='duplicate_pending'",
            [game_id],
        )?;
        rebuild_position_statistics(&self.connection)?;
        self.canonical_fingerprint_cache.get_mut().take();
        Ok(())
    }

    pub fn override_game_opening(
        &mut self,
        game_id: &str,
        category_code: &str,
        reviewed_alias: Option<&str>,
    ) -> Result<()> {
        let category_code = category_code.trim().to_ascii_uppercase();
        if !category_exists(&self.connection, &category_code)? {
            return Err(ReferenceLibraryError::InvalidData("布局编码不存在".into()));
        }
        self.list_game(game_id)?
            .ok_or_else(|| ReferenceLibraryError::InvalidData("找不到待修正棋局".into()))?;
        let version: i64 = self.connection.query_row(
            "SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE game_opening_classifications SET is_primary=0
             WHERE game_id=?1 AND classifier_version_id=?2",
            params![game_id, version],
        )?;
        transaction.execute(
            "INSERT INTO game_opening_classifications
             (game_id,category_code,candidate_codes_json,method,confidence,matched_plies,
              classifier_version_id,is_primary,status,created_at)
             VALUES (?1,?2,?3,'manual_override',1.0,0,?4,1,'classified',?5)",
            params![
                game_id,
                category_code,
                serde_json::to_string(&vec![category_code.clone()]).unwrap_or_else(|_| "[]".into()),
                version,
                now()
            ],
        )?;
        if let Some(alias) = reviewed_alias.filter(|value| !value.trim().is_empty()) {
            transaction.execute(
                "INSERT INTO opening_aliases (alias,category_code,reviewed,source)
                 VALUES (?1,?2,1,'manual')
                 ON CONFLICT(alias,category_code) DO UPDATE SET reviewed=1,source='manual'",
                params![alias.trim(), category_code],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn resolve_duplicate_candidate(&mut self, issue_id: &str, merge: bool) -> Result<()> {
        let (incoming, candidate): (String, String) = self
            .connection
            .query_row(
                "SELECT incoming_game_id,candidate_game_id
                 FROM reference_duplicate_candidates WHERE id=?1 AND status='pending'",
                [issue_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| ReferenceLibraryError::InvalidData("重复候选已处理或不存在".into()))?;
        if !merge {
            self.connection.execute(
                "UPDATE reference_duplicate_candidates SET status='distinct',reviewed_at=?1
                 WHERE id=?2",
                params![now(), issue_id],
            )?;
            let pending: i64 = self.connection.query_row(
                "SELECT COUNT(*) FROM reference_duplicate_candidates
                 WHERE incoming_game_id=?1 AND status='pending'",
                [&incoming],
                |row| row.get(0),
            )?;
            if pending == 0 {
                self.connection.execute(
                    "UPDATE reference_games SET validation_status='valid' WHERE id=?1",
                    [&incoming],
                )?;
                self.connection.execute(
                    "UPDATE reference_import_records SET status='imported'
                     WHERE game_id=?1 AND status='duplicate_pending'",
                    [&incoming],
                )?;
                rebuild_position_statistics(&self.connection)?;
            }
            return Ok(());
        }
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE reference_import_records SET status='duplicate'
             WHERE game_id=?1 AND status='duplicate_pending'",
            [&incoming],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO reference_game_sources
             (game_id,source_id,relative_path,record_index,record_hash,first_seen_at,last_seen_at,active)
             SELECT ?1,source_id,relative_path,record_index,record_hash,first_seen_at,last_seen_at,active
             FROM reference_game_sources WHERE game_id=?2",
            params![candidate, incoming],
        )?;
        transaction.execute(
            "UPDATE reference_import_records SET game_id=?1 WHERE game_id=?2",
            params![candidate, incoming],
        )?;
        transaction.execute(
            "UPDATE reference_game_source_documents SET game_id=?1 WHERE game_id=?2",
            params![candidate, incoming],
        )?;
        transaction.execute(
            "DELETE FROM reference_duplicate_candidates
             WHERE incoming_game_id=?1 OR candidate_game_id=?1",
            [&incoming],
        )?;
        transaction.execute(
            "DELETE FROM reference_game_sources WHERE game_id=?1",
            [&incoming],
        )?;
        transaction.execute(
            "DELETE FROM game_opening_classifications WHERE game_id=?1",
            [&incoming],
        )?;
        transaction.execute(
            "DELETE FROM reference_game_moves WHERE game_id=?1",
            [&incoming],
        )?;
        transaction.execute(
            "DELETE FROM reference_game_documents WHERE game_id=?1",
            [&incoming],
        )?;
        transaction.execute("DELETE FROM reference_games WHERE id=?1", [&incoming])?;
        reconcile_active_games(&transaction)?;
        rebuild_position_statistics(&transaction)?;
        transaction.commit()?;
        self.canonical_fingerprint_cache.get_mut().take();
        Ok(())
    }

    pub fn query_position(&self, fen: &str, limit: usize) -> Result<Vec<PositionMoveStat>> {
        self.query_position_filtered(&PositionExplorerRequest {
            fen: fen.into(),
            limit: Some(limit),
            ..PositionExplorerRequest::default()
        })
    }

    pub fn query_position_filtered(
        &self,
        request: &PositionExplorerRequest,
    ) -> Result<Vec<PositionMoveStat>> {
        self.query_position_filtered_impl(request, None)
    }

    pub fn query_position_filtered_excluding(
        &self,
        request: &PositionExplorerRequest,
        excluded_fingerprints: &Arc<[String]>,
    ) -> Result<Vec<PositionMoveStat>> {
        self.query_position_filtered_impl(request, Some(excluded_fingerprints))
    }

    pub fn query_position_filtered_unpublished(
        &self,
        request: &PositionExplorerRequest,
    ) -> Result<Vec<PositionMoveStat>> {
        let published = self.published_fingerprints()?;
        self.query_position_filtered_impl(request, Some(&published))
    }

    fn query_position_filtered_impl(
        &self,
        request: &PositionExplorerRequest,
        excluded_fingerprints: Option<&Arc<[String]>>,
    ) -> Result<Vec<PositionMoveStat>> {
        self.replace_query_exclusions(excluded_fingerprints)?;
        let board = Board::from_fen(&request.fen)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let key = board.rule_position_key();
        let position_hash = short_hash(&key);
        let include_details = request.include_details.unwrap_or(true);
        let side = request.side.as_deref().unwrap_or_default().trim();
        if !matches!(side, "" | "red" | "black") {
            return Err(ReferenceLibraryError::InvalidData(
                "side must be red or black".into(),
            ));
        }
        if request.master_only.unwrap_or(false) {
            return Ok(Vec::new());
        }
        let no_filters = request
            .player
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
            && request
                .event
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            && request.year_from.is_none()
            && request.year_to.is_none()
            && request.side.is_none();
        if no_filters && excluded_fingerprints.is_none() {
            let mut statement = self.connection.prepare(
                "SELECT move_iccs, notation, samples, red_wins, draws, black_wins, first_year, last_year
                 FROM reference_position_move_stats WHERE position_hash=?1 AND position_key=?2
                 ORDER BY samples DESC, move_iccs LIMIT ?3",
            )?;
            let rows = statement.query_map(
                params![
                    position_hash,
                    key,
                    request.limit.unwrap_or(20).clamp(1, 100) as i64
                ],
                map_move_stat,
            )?;
            let mut result = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            if include_details {
                enrich_position_stats(
                    &self.connection,
                    &key,
                    &position_hash,
                    request,
                    &mut result,
                )?;
            }
            return Ok(result);
        }
        let player = request.player.as_deref().unwrap_or_default().trim();
        let event = request.event.as_deref().unwrap_or_default().trim();
        let mut statement = self.connection.prepare(
            "SELECT m.move_iccs, MAX(m.notation), COUNT(*),
                    SUM(g.result='1-0'), SUM(g.result='1/2-1/2'), SUM(g.result='0-1'),
                    MIN(CAST(substr(g.game_date,1,4) AS INTEGER)),MAX(CAST(substr(g.game_date,1,4) AS INTEGER))
             FROM reference_game_moves m JOIN reference_games g ON g.id=m.game_id
             WHERE m.position_hash=?1 AND m.position_key=?2 AND g.active=1 AND g.validation_status='valid'
               AND NOT EXISTS (SELECT 1 FROM temp_reference_exclusions e WHERE e.canonical_fingerprint=g.canonical_fingerprint)
               AND (?3='' OR g.red_player LIKE '%' || ?3 || '%' OR g.black_player LIKE '%' || ?3 || '%')
               AND (?4='' OR g.event_name LIKE '%' || ?4 || '%')
               AND (?5 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)>=?5)
               AND (?6 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)<=?6)
               AND (?7='' OR (?7='red' AND g.red_player LIKE '%' || ?3 || '%') OR (?7='black' AND g.black_player LIKE '%' || ?3 || '%'))
             GROUP BY m.move_iccs ORDER BY COUNT(*) DESC, m.move_iccs LIMIT ?8",
        )?;
        let rows = statement.query_map(
            params![
                position_hash,
                key,
                player,
                event,
                request.year_from,
                request.year_to,
                side,
                request.limit.unwrap_or(20).clamp(1, 100) as i64
            ],
            map_move_stat,
        )?;
        let mut result = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        if include_details {
            enrich_position_stats(&self.connection, &key, &position_hash, request, &mut result)?;
        }
        Ok(result)
    }

    pub fn browse_openings(&self, parent_code: Option<&str>) -> Result<Vec<OpeningCategory>> {
        self.browse_openings_impl(parent_code, None)
    }

    pub fn browse_openings_excluding(
        &self,
        parent_code: Option<&str>,
        excluded_fingerprints: &Arc<[String]>,
    ) -> Result<Vec<OpeningCategory>> {
        self.browse_openings_impl(parent_code, Some(excluded_fingerprints))
    }

    pub fn browse_unpublished_openings(
        &self,
        parent_code: Option<&str>,
    ) -> Result<Vec<OpeningCategory>> {
        let published = self.published_fingerprints()?;
        self.browse_openings_impl(parent_code, Some(&published))
    }

    fn browse_openings_impl(
        &self,
        parent_code: Option<&str>,
        excluded_fingerprints: Option<&Arc<[String]>>,
    ) -> Result<Vec<OpeningCategory>> {
        self.replace_query_exclusions(excluded_fingerprints)?;
        if excluded_fingerprints.is_none() {
            let mut statement = self.connection.prepare(
                "SELECT c.code, c.series_code, c.parent_code, c.name, c.sort_order,
                        COALESCE(s.game_count,0), COALESCE(s.red_wins,0),
                        COALESCE(s.draws,0), COALESCE(s.black_wins,0),
                        s.first_year, s.last_year
                 FROM opening_categories c
                 LEFT JOIN opening_category_stats s ON s.category_code=c.code
                 WHERE c.active=1 AND ((?1 IS NULL AND c.parent_code IS NULL) OR c.parent_code=?1)
                 ORDER BY c.sort_order, c.code",
            )?;
            let base = statement
                .query_map([parent_code], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i32>(4)?,
                        row.get::<_, i64>(5)?.max(0) as u64,
                        row.get::<_, i64>(6)?.max(0) as u64,
                        row.get::<_, i64>(7)?.max(0) as u64,
                        row.get::<_, i64>(8)?.max(0) as u64,
                        row.get::<_, Option<i64>>(9)?
                            .and_then(|value| u16::try_from(value).ok()),
                        row.get::<_, Option<i64>>(10)?
                            .and_then(|value| u16::try_from(value).ok()),
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            return self.opening_categories_with_aliases(base);
        }
        let mut statement = self.connection.prepare(
            "SELECT c.code, c.series_code, c.parent_code, c.name, c.sort_order,
                    COUNT(DISTINCT CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL THEN x.game_id END),
                    COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL AND g.result='1-0' THEN 1 ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL AND g.result='1/2-1/2' THEN 1 ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL AND g.result='0-1' THEN 1 ELSE 0 END),0),
                    MIN(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL THEN CAST(substr(g.game_date,1,4) AS INTEGER) END),
                    MAX(CASE WHEN x.is_primary=1 AND x.status='classified' AND g.active=1 AND g.validation_status='valid' AND e.canonical_fingerprint IS NULL THEN CAST(substr(g.game_date,1,4) AS INTEGER) END)
             FROM opening_categories c
             LEFT JOIN game_opening_classifications x
               ON (x.category_code=c.code OR (length(c.code)=1 AND x.category_code LIKE c.code || '%'))
              AND x.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
             LEFT JOIN reference_games g ON g.id=x.game_id
             LEFT JOIN temp_reference_exclusions e ON e.canonical_fingerprint=g.canonical_fingerprint
             WHERE ((?1 IS NULL AND c.parent_code IS NULL) OR c.parent_code=?1)
             GROUP BY c.code ORDER BY c.sort_order, c.code",
        )?;
        let base = statement
            .query_map([parent_code], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i32>(4)?,
                    row.get::<_, i64>(5)?.max(0) as u64,
                    row.get::<_, i64>(6)?.max(0) as u64,
                    row.get::<_, i64>(7)?.max(0) as u64,
                    row.get::<_, i64>(8)?.max(0) as u64,
                    row.get::<_, Option<i64>>(9)?
                        .and_then(|value| u16::try_from(value).ok()),
                    row.get::<_, Option<i64>>(10)?
                        .and_then(|value| u16::try_from(value).ok()),
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        self.opening_categories_with_aliases(base)
    }

    fn opening_categories_with_aliases(
        &self,
        base: Vec<(
            String,
            String,
            Option<String>,
            String,
            i32,
            u64,
            u64,
            u64,
            u64,
            Option<u16>,
            Option<u16>,
        )>,
    ) -> Result<Vec<OpeningCategory>> {
        let mut result = Vec::with_capacity(base.len());
        for (
            code,
            series_code,
            parent_code,
            name,
            sort_order,
            game_count,
            red_wins,
            draws,
            black_wins,
            first_year,
            last_year,
        ) in base
        {
            let mut aliases_statement = self.connection.prepare(
                "SELECT alias FROM opening_aliases WHERE category_code=?1 ORDER BY reviewed DESC, alias",
            )?;
            let aliases = aliases_statement
                .query_map([&code], |row| row.get(0))?
                .collect::<std::result::Result<Vec<String>, _>>()?;
            result.push(OpeningCategory {
                code,
                series_code,
                parent_code,
                name,
                aliases,
                sort_order,
                game_count,
                red_wins,
                draws,
                black_wins,
                first_year,
                last_year,
            });
        }
        Ok(result)
    }

    pub fn list_games(
        &self,
        opening_code: Option<&str>,
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ReferenceGameSummary>> {
        self.list_games_filtered(
            opening_code,
            query,
            &ReferenceGameFilters::default(),
            limit,
            offset,
        )
    }

    pub fn list_games_filtered(
        &self,
        opening_code: Option<&str>,
        query: Option<&str>,
        filters: &ReferenceGameFilters,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ReferenceGameSummary>> {
        self.list_games_filtered_impl(opening_code, query, filters, limit, offset, None)
    }

    pub fn list_games_filtered_excluding(
        &self,
        opening_code: Option<&str>,
        query: Option<&str>,
        filters: &ReferenceGameFilters,
        limit: usize,
        offset: usize,
        excluded_fingerprints: &Arc<[String]>,
    ) -> Result<Vec<ReferenceGameSummary>> {
        self.list_games_filtered_impl(
            opening_code,
            query,
            filters,
            limit,
            offset,
            Some(excluded_fingerprints),
        )
    }

    pub fn list_unpublished_games_filtered(
        &self,
        opening_code: Option<&str>,
        query: Option<&str>,
        filters: &ReferenceGameFilters,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ReferenceGameSummary>> {
        let published = self.published_fingerprints()?;
        self.list_games_filtered_impl(
            opening_code,
            query,
            filters,
            limit,
            offset,
            Some(&published),
        )
    }

    pub fn mark_batch_published(&mut self, batch_id: &str) -> Result<()> {
        self.batch(batch_id)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT OR IGNORE INTO reference_published_fingerprints
             (canonical_fingerprint, published_at)
             SELECT DISTINCT g.canonical_fingerprint, ?1
             FROM reference_import_records r
             JOIN reference_games g ON g.id=r.game_id
             WHERE r.batch_id=?2 AND r.status IN ('imported','duplicate','revised')
               AND g.validation_status='valid'",
            params![now(), batch_id],
        )?;
        transaction.execute(
            "UPDATE reference_import_batches SET published_at=COALESCE(published_at,?1)
             WHERE id=?2",
            params![now(), batch_id],
        )?;
        transaction.execute(
            "DELETE FROM reference_published_fingerprints
             WHERE canonical_fingerprint IN (
               SELECT canonical_fingerprint FROM reference_import_removals WHERE batch_id=?1
             ) AND NOT EXISTS (
               SELECT 1 FROM reference_games g
               WHERE g.canonical_fingerprint=reference_published_fingerprints.canonical_fingerprint
                 AND g.active=1 AND g.validation_status='valid'
             )",
            [batch_id],
        )?;
        transaction.commit()?;
        self.published_fingerprint_cache.get_mut().take();
        Ok(())
    }

    fn list_games_filtered_impl(
        &self,
        opening_code: Option<&str>,
        query: Option<&str>,
        filters: &ReferenceGameFilters,
        limit: usize,
        offset: usize,
        excluded_fingerprints: Option<&Arc<[String]>>,
    ) -> Result<Vec<ReferenceGameSummary>> {
        self.replace_query_exclusions(excluded_fingerprints)?;
        let query = query.unwrap_or_default().trim();
        let player = filters.player.as_deref().unwrap_or_default().trim();
        let event = filters.event.as_deref().unwrap_or_default().trim();
        let side = filters.side.as_deref().unwrap_or_default().trim();
        if !matches!(side, "" | "red" | "black") {
            return Err(ReferenceLibraryError::InvalidData(
                "side must be red or black".into(),
            ));
        }
        let position_filter = match filters.position_fen.as_deref() {
            Some(fen) if !fen.trim().is_empty() => {
                let board = Board::from_fen(fen)
                    .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
                let key = board.rule_position_key();
                Some((short_hash(&key), key))
            }
            _ => None,
        };
        if filters.master_only.unwrap_or(false) {
            return Ok(Vec::new());
        }
        let classification_status = filters
            .classification_status
            .as_deref()
            .unwrap_or_default()
            .trim();
        if !matches!(classification_status, "" | "classified" | "pending") {
            return Err(ReferenceLibraryError::InvalidData(
                "classificationStatus must be classified or pending".into(),
            ));
        }
        if let Some((position_hash, position_key)) = position_filter.as_ref() {
            let fast_position_only = opening_code.is_none()
                && query.is_empty()
                && player.is_empty()
                && event.is_empty()
                && filters.year_from.is_none()
                && filters.year_to.is_none()
                && side.is_empty()
                && classification_status.is_empty()
                && !filters.master_only.unwrap_or(false);
            if fast_position_only {
                let mut statement = self.connection.prepare(
                    "SELECT g.id, g.title, g.red_player, g.black_player, g.result, g.event_name,
                            g.round_name, g.game_date, g.opening, NULL,
                            g.canonical_fingerprint,g.move_count
                     FROM reference_games g INDEXED BY idx_reference_games_valid_date
                     WHERE g.active=1 AND g.validation_status='valid'
                       AND NOT EXISTS (SELECT 1 FROM temp_reference_exclusions e WHERE e.canonical_fingerprint=g.canonical_fingerprint)
                       AND EXISTS (SELECT 1 FROM reference_game_moves m INDEXED BY idx_reference_moves_position_game
                            WHERE m.position_hash=?1 AND m.position_key=?2 AND m.game_id=g.id)
                     ORDER BY g.game_date DESC, g.created_at DESC, g.id DESC
                     LIMIT ?3 OFFSET ?4",
                )?;
                let rows = statement.query_map(
                    params![
                        position_hash,
                        position_key,
                        limit.min(i64::MAX as usize).max(1) as i64,
                        offset.min(i64::MAX as usize) as i64
                    ],
                    map_game,
                )?;
                return Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?);
            }
        }
        let mut statement = self.connection.prepare(
            "SELECT g.id, g.title, g.red_player, g.black_player, g.result, g.event_name,
                    g.round_name, g.game_date, g.opening,
                    (SELECT category_code FROM game_opening_classifications c
                     WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                       AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                     ORDER BY c.id DESC LIMIT 1),
                    g.canonical_fingerprint,g.move_count
             FROM reference_games g
             WHERE g.active=1 AND g.validation_status='valid'
               AND NOT EXISTS (SELECT 1 FROM temp_reference_exclusions e WHERE e.canonical_fingerprint=g.canonical_fingerprint)
               AND (?1 IS NULL OR EXISTS (SELECT 1 FROM game_opening_classifications c
                    WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                      AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                      AND (c.category_code=?1 OR (length(?1)=1 AND c.category_code LIKE ?1 || '%'))))
               AND (?2='' OR g.title LIKE '%' || ?2 || '%' OR g.red_player LIKE '%' || ?2 || '%'
                    OR g.black_player LIKE '%' || ?2 || '%' OR g.event_name LIKE '%' || ?2 || '%')
               AND (?3='' OR g.red_player LIKE '%' || ?3 || '%' OR g.black_player LIKE '%' || ?3 || '%')
               AND (?4='' OR g.event_name LIKE '%' || ?4 || '%')
               AND (?5 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)>=?5)
               AND (?6 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)<=?6)
               AND (?7='' OR (?7='red' AND g.red_player LIKE '%' || ?3 || '%') OR (?7='black' AND g.black_player LIKE '%' || ?3 || '%'))
               AND (?8='' OR (?8='classified' AND EXISTS (SELECT 1 FROM game_opening_classifications c
                    WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                      AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)))
                 OR (?8='pending' AND NOT EXISTS (SELECT 1 FROM game_opening_classifications c
                    WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                      AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1))
                    AND EXISTS (SELECT 1 FROM game_opening_classifications c
                    WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='pending'
                      AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1))))
               AND (?9 IS NULL OR EXISTS (SELECT 1 FROM reference_game_moves m
                    WHERE m.game_id=g.id AND m.position_hash=?9 AND m.position_key=?10))
             ORDER BY g.game_date DESC, g.created_at DESC LIMIT ?11 OFFSET ?12",
        )?;
        let (position_hash, position_key) = position_filter
            .as_ref()
            .map(|(hash, key)| (Some(hash.as_str()), Some(key.as_str())))
            .unwrap_or((None, None));
        let rows = statement.query_map(
            params![
                opening_code,
                query,
                player,
                event,
                filters.year_from,
                filters.year_to,
                side,
                classification_status,
                position_hash,
                position_key,
                limit.min(i64::MAX as usize).max(1) as i64,
                offset.min(i64::MAX as usize) as i64
            ],
            map_game,
        )?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn game_document(&self, game_id: &str) -> Result<Option<ReferenceGameDocument>> {
        let game = self.list_game(game_id)?;
        let Some(game) = game else { return Ok(None) };
        let document_json = self
            .connection
            .query_row(
                "SELECT document_json FROM reference_game_documents WHERE game_id=?1",
                [game_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(document_json.map(|document_json| ReferenceGameDocument {
            game,
            document_json,
        }))
    }

    pub fn publish_batch_payload_chunk(
        &self,
        batch_id: &str,
        server_source_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<ReferencePublishBatch> {
        let batch = self.batch(batch_id)?;
        if batch.review_status != "approved" {
            return Err(ReferenceLibraryError::InvalidData(
                "批次必须先审核通过才能发布".into(),
            ));
        }
        let license_status: String = self.connection.query_row(
            "SELECT license_status FROM reference_sources WHERE id=?1",
            [&batch.source_id],
            |row| row.get(0),
        )?;
        if !is_publishable_license(&license_status) {
            return Err(ReferenceLibraryError::InvalidData(
                "本地自用或未审核来源不能发布到共享库".into(),
            ));
        }
        let mut statement = self.connection.prepare(
            "SELECT r.relative_path,f.sha256,r.record_index,r.record_hash,g.canonical_fingerprint,
                    g.moves_hash,g.title,g.red_player,g.black_player,g.event_name,g.round_name,
                    g.game_date,g.result,g.opening,g.starting_fen,g.moves_json,
                    (SELECT category_code FROM game_opening_classifications c
                     WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                       AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                     ORDER BY c.id DESC LIMIT 1)
             FROM reference_import_records r
             JOIN reference_import_files f ON f.id=r.file_id
             JOIN reference_games g ON g.id=r.game_id
             WHERE r.batch_id=?1 AND r.status IN ('imported','duplicate','revised')
               AND g.active=1 AND g.validation_status='valid' AND g.identity_complete=1
             ORDER BY r.relative_path,r.record_index LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement.query_map(
            params![batch_id, limit.clamp(1, 500) as i64, offset as i64],
            |row| {
                let event_name: String = row.get(9)?;
                let round_name: String = row.get(10)?;
                let game_date: String = row.get(11)?;
                let opening: String = row.get(13)?;
                let moves_json: String = row.get(15)?;
                Ok(ReferencePublishGame {
                    relative_path: row.get(0)?,
                    file_sha256: row.get(1)?,
                    record_index: row.get(2)?,
                    record_hash: row.get(3)?,
                    canonical_fingerprint: row.get(4)?,
                    moves_hash: row.get(5)?,
                    title: row.get(6)?,
                    red_player: row.get(7)?,
                    black_player: row.get(8)?,
                    event_name: (!event_name.is_empty()).then_some(event_name),
                    round_name: (!round_name.is_empty()).then_some(round_name),
                    game_date: is_full_date(&game_date).then_some(game_date),
                    result: row.get(12)?,
                    opening: (!opening.is_empty()).then_some(opening),
                    starting_fen: row.get(14)?,
                    moves: serde_json::from_str(&moves_json).unwrap_or_default(),
                    opening_code: row.get(16)?,
                    license_note: license_status.clone(),
                })
            },
        )?;
        let games = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        let removed_records = self.publish_batch_removals(batch_id, limit, offset)?;
        Ok(ReferencePublishBatch {
            source_id: server_source_id.into(),
            client_batch_id: batch.id,
            parser_version: CBL_PARSER_VERSION,
            games,
            removed_records,
        })
    }

    fn publish_batch_removals(
        &self,
        batch_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ReferencePublishRemoval>> {
        let mut statement = self.connection.prepare(
            "SELECT relative_path,record_index,record_hash
             FROM reference_import_removals WHERE batch_id=?1
             ORDER BY relative_path,record_index LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement.query_map(
            params![batch_id, limit.clamp(1, 500) as i64, offset as i64],
            |row| {
                Ok(ReferencePublishRemoval {
                    relative_path: row.get(0)?,
                    record_index: row.get(1)?,
                    record_hash: row.get(2)?,
                })
            },
        )?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn list_game(&self, game_id: &str) -> Result<Option<ReferenceGameSummary>> {
        self.connection
            .query_row(
                "SELECT g.id, g.title, g.red_player, g.black_player, g.result, g.event_name,
                    g.round_name, g.game_date, g.opening,
                    (SELECT category_code FROM game_opening_classifications c
                     WHERE c.game_id=g.id AND c.is_primary=1 AND c.status='classified'
                       AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
                     ORDER BY c.id DESC LIMIT 1),
                    g.canonical_fingerprint,g.move_count FROM reference_games g WHERE g.id=?1",
                [game_id],
                map_game,
            )
            .optional()
            .map_err(Into::into)
    }

    fn source(&self, source_id: &str) -> Result<ReferenceSource> {
        self.connection.query_row(
            "SELECT id, display_name, root_path, auto_scan, license_status, active, last_scanned_at
             FROM reference_sources WHERE id=?1", [source_id], map_source,
        ).optional()?.ok_or_else(|| ReferenceLibraryError::SourceNotFound(source_id.into()))
    }

    fn batch(&self, batch_id: &str) -> Result<ReferenceImportBatch> {
        self.connection
            .query_row(
                "SELECT id, source_id, status, review_status, discovered_files, changed_files,
                    imported_records, revised_records, duplicate_records, invalid_records,
                    empty_files, unclassified_records, warnings_json, created_at, completed_at
             FROM reference_import_batches WHERE id=?1",
                [batch_id],
                map_batch,
            )
            .optional()?
            .ok_or_else(|| ReferenceLibraryError::BatchNotFound(batch_id.into()))
    }
}

#[derive(Default)]
struct ScanCounts {
    changed_files: u32,
    imported_records: u32,
    revised_records: u32,
    duplicate_records: u32,
    invalid_records: u32,
    empty_files: u32,
    unclassified_records: u32,
}

impl ScanCounts {
    fn merge(&mut self, other: Self) {
        self.imported_records += other.imported_records;
        self.revised_records += other.revised_records;
        self.duplicate_records += other.duplicate_records;
        self.invalid_records += other.invalid_records;
        self.empty_files += other.empty_files;
        self.unclassified_records += other.unclassified_records;
    }
}

struct SourceFileRevision {
    id: String,
    sha256: String,
    revision: i64,
    status: String,
    active: bool,
}

struct ActiveSourceRecord {
    record_index: u32,
    record_hash: String,
    canonical_fingerprint: String,
}

struct PriorRecord {
    record_hash: String,
    revision: i64,
    game_id: Option<String>,
}

fn ingest_game(
    connection: &Connection,
    source_id: &str,
    file_id: &str,
    batch_id: &str,
    relative_path: &str,
    game: CblGame,
    counts: &mut ScanCounts,
) -> Result<()> {
    let prior_record: Option<PriorRecord> = connection
        .query_row(
            "SELECT record_hash, revision, game_id FROM reference_import_records
         WHERE source_id=?1 AND relative_path=?2 AND record_index=?3
         ORDER BY revision DESC, created_at DESC, id DESC LIMIT 1",
            params![source_id, relative_path, game.source_index],
            |row| {
                Ok(PriorRecord {
                    record_hash: row.get(0)?,
                    revision: row.get(1)?,
                    game_id: row.get(2)?,
                })
            },
        )
        .optional()?;
    let is_revision = prior_record
        .as_ref()
        .is_some_and(|record| record.record_hash != game.record_hash);
    let record_revision = prior_record
        .as_ref()
        .map_or(1, |record| record.revision + 1);
    let mainline = mainline_iccs(&game.document)?;
    let starting_board = Board::from_fen(&game.document.starting_fen)
        .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
    let moves_hash = digest_text(&mainline.join(" "));
    let canonical_fingerprint = canonical_fingerprint(&game, &starting_board, &mainline);
    let identity_complete = has_complete_identity(&game);
    let prior_same_game = if let Some(prior_game_id) = prior_record
        .as_ref()
        .and_then(|record| record.game_id.as_deref())
    {
        connection
            .query_row(
                "SELECT id FROM reference_games
                 WHERE id=?1 AND starting_fen=?2 AND moves_hash=?3",
                params![prior_game_id, game.document.starting_fen, moves_hash],
                |row| row.get(0),
            )
            .optional()?
    } else {
        None
    };
    let canonical_game: Option<String> = if identity_complete {
        connection
            .query_row(
                "SELECT id FROM reference_games WHERE dedupe_key=?1 LIMIT 1",
                [&canonical_fingerprint],
                |row| row.get(0),
            )
            .optional()?
    } else {
        None
    };
    let existing_game = canonical_game.or(prior_same_game);
    let document_json = serde_json::to_string(&game.document)
        .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
    let (game_id, status) = if let Some(game_id) = existing_game {
        counts.duplicate_records += 1;
        if is_revision
            && prior_record
                .as_ref()
                .and_then(|record| record.game_id.as_deref())
                == Some(game_id.as_str())
        {
            let opening = raw_opening(&game);
            ensure_imported_category(connection, &opening)?;
            connection.execute(
                "UPDATE reference_games SET
                   title=?1,red_player=?2,black_player=?3,red_team=?4,black_team=?5,result=?6,
                   event_name=?7,round_name=?8,game_date=?9,site=?10,time_rule=?11,opening=?12,
                   canonical_fingerprint=?13,dedupe_key=?14,identity_complete=?15,
                   validation_status='valid',updated_at=?16 WHERE id=?17",
                params![
                    game.document.metadata.title.trim(),
                    normalize_name(&game.document.metadata.red),
                    normalize_name(&game.document.metadata.black),
                    game.red_team.trim(),
                    game.black_team.trim(),
                    normalize_result(&game.document.metadata.result),
                    game.document.metadata.event.trim(),
                    game.round.trim(),
                    normalize_date(&game.document.metadata.date),
                    game.document.metadata.site.trim(),
                    game.time_rule.trim(),
                    opening,
                    canonical_fingerprint,
                    identity_complete.then_some(canonical_fingerprint.as_str()),
                    i64::from(identity_complete),
                    now(),
                    game_id
                ],
            )?;
            connection.execute(
                "UPDATE reference_game_documents SET document_json=?1, updated_at=?2 WHERE game_id=?3",
                params![document_json, now(), game_id],
            )?;
            (game_id, "revised")
        } else {
            (game_id, "duplicate")
        }
    } else {
        let game_id = Uuid::new_v4().to_string();
        let opening = raw_opening(&game);
        ensure_imported_category(connection, &opening)?;
        let duplicate_candidates = if identity_complete {
            Vec::new()
        } else {
            find_move_duplicate_candidates(connection, &game.document.starting_fen, &moves_hash)?
        };
        let validation_status = if duplicate_candidates.is_empty() {
            "valid"
        } else {
            "duplicate_pending"
        };
        connection.execute(
            "INSERT INTO reference_games
             (id, title, red_player, black_player, red_team, black_team, result,
              event_name, round_name, game_date, site, time_rule, opening, starting_fen,
              canonical_fingerprint, dedupe_key, identity_complete, moves_hash, moves_json,
              move_count, validation_status, active, ingestion_version, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,1,?22,?23,?23)",
            params![game_id, game.document.metadata.title.trim(), normalize_name(&game.document.metadata.red),
                normalize_name(&game.document.metadata.black), game.red_team.trim(), game.black_team.trim(),
                normalize_result(&game.document.metadata.result), game.document.metadata.event.trim(), game.round.trim(),
                game.document.metadata.date.trim(), game.document.metadata.site.trim(), game.time_rule.trim(), opening,
                game.document.starting_fen, canonical_fingerprint,
                identity_complete.then_some(canonical_fingerprint.as_str()), i64::from(identity_complete), moves_hash,
                serde_json::to_string(&mainline).map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?,
                mainline.len() as i64, validation_status, CBL_PARSER_VERSION, now()],
        )?;
        connection.execute(
            "INSERT INTO reference_game_documents (game_id, document_json, created_at, updated_at)
             VALUES (?1,?2,?3,?3)",
            params![game_id, document_json, now()],
        )?;
        expand_mainline(
            connection,
            &game_id,
            starting_board,
            &mainline,
            normalize_result(&game.document.metadata.result),
        )?;
        for candidate_game_id in duplicate_candidates {
            connection.execute(
                "INSERT OR IGNORE INTO reference_duplicate_candidates
                 (id,incoming_game_id,candidate_game_id,source_id,reason,status,created_at)
                 VALUES (?1,?2,?3,?4,'same_moves_incomplete_identity','pending',?5)",
                params![
                    Uuid::new_v4().to_string(),
                    game_id,
                    candidate_game_id,
                    source_id,
                    now()
                ],
            )?;
        }
        if validation_status == "duplicate_pending" {
            counts.duplicate_records += 1;
        } else {
            counts.imported_records += 1;
            counts.unclassified_records += 1;
        }
        (
            game_id,
            if validation_status == "duplicate_pending" {
                "duplicate_pending"
            } else {
                "imported"
            },
        )
    };
    if is_revision {
        counts.revised_records += 1;
    }
    connection.execute(
        "INSERT INTO reference_import_records
         (id, batch_id, file_id, source_id, relative_path, record_index, record_hash,
          revision, status, game_id, warning, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'',?11)",
        params![
            Uuid::new_v4().to_string(),
            batch_id,
            file_id,
            source_id,
            relative_path,
            game.source_index,
            game.record_hash,
            record_revision,
            status,
            game_id,
            now()
        ],
    )?;
    connection.execute(
        "INSERT INTO reference_game_sources
         (game_id, source_id, relative_path, record_index, record_hash, first_seen_at, last_seen_at)
         VALUES (?1,?2,?3,?4,?5,?6,?6)
         ON CONFLICT(source_id,relative_path,record_index,record_hash)
         DO UPDATE SET game_id=excluded.game_id, active=1, last_seen_at=excluded.last_seen_at",
        params![
            game_id,
            source_id,
            relative_path,
            game.source_index,
            game.record_hash,
            now()
        ],
    )?;
    connection.execute(
        "INSERT INTO reference_game_source_documents
         (source_id,relative_path,record_index,record_hash,game_id,document_json,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(source_id,relative_path,record_index,record_hash)
         DO UPDATE SET game_id=excluded.game_id,document_json=excluded.document_json",
        params![
            source_id,
            relative_path,
            game.source_index,
            game.record_hash,
            game_id,
            document_json,
            now()
        ],
    )?;
    upsert_source_player(
        connection,
        source_id,
        &normalize_name(&game.document.metadata.red),
        game.document.metadata.red.trim(),
    )?;
    upsert_source_player(
        connection,
        source_id,
        &normalize_name(&game.document.metadata.black),
        game.document.metadata.black.trim(),
    )?;
    Ok(())
}

fn upsert_source_player(
    connection: &Connection,
    source_id: &str,
    normalized_name: &str,
    display_name: &str,
) -> Result<()> {
    if normalized_name.is_empty() {
        return Ok(());
    }
    let player_id = digest_text(normalized_name)[..32].to_owned();
    connection.execute(
        "INSERT INTO reference_players (id,normalized_name,display_name,created_at)
         VALUES (?1,?2,?3,?4)
         ON CONFLICT(normalized_name) DO UPDATE SET display_name=excluded.display_name",
        params![player_id, normalized_name, display_name, now()],
    )?;
    let resolved_id: String = connection.query_row(
        "SELECT id FROM reference_players WHERE normalized_name=?1",
        [normalized_name],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT INTO reference_player_source_refs
         (player_id,source_id,source_player_id,source_name)
         VALUES (?1,?2,?3,?4)
         ON CONFLICT(source_id,source_player_id) DO UPDATE SET
           player_id=excluded.player_id,source_name=excluded.source_name",
        params![resolved_id, source_id, normalized_name, display_name],
    )?;
    Ok(())
}

fn expand_mainline(
    connection: &Connection,
    game_id: &str,
    mut board: Board,
    moves: &[String],
    _result: &str,
) -> Result<()> {
    for (index, iccs) in moves.iter().enumerate() {
        let before_fen = board.to_fen();
        let position_key = board.rule_position_key();
        let position_hash = short_hash(&position_key);
        let mv = xiangqi_core::Move::from_iccs(iccs)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let notation = board
            .chinese_move_notation(mv)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let side = if board.side_to_move() == Color::Red {
            "red"
        } else {
            "black"
        };
        board = board.apply_move(mv).map_err(|error| {
            ReferenceLibraryError::InvalidData(format!("第 {} 手 {iccs} 非法：{error}", index + 1))
        })?;
        connection.execute(
            "INSERT INTO reference_game_moves
             (game_id, ply, side_to_move, move_iccs, notation, before_fen, after_fen,
              position_key, position_hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                game_id,
                index + 1,
                side,
                iccs,
                notation,
                before_fen,
                board.to_fen(),
                position_key,
                position_hash
            ],
        )?;
    }
    Ok(())
}

fn mainline_iccs(document: &manual_format::ManualDocument) -> Result<Vec<String>> {
    let mut parent = document.tree.root_id();
    let mut result = Vec::new();
    loop {
        let branches = document
            .tree
            .branches(parent)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        let Some(node) = branches
            .iter()
            .find(|node| node.is_mainline)
            .or_else(|| branches.first())
        else {
            break;
        };
        result.push(node.mv.to_iccs());
        parent = node.id;
    }
    if result.is_empty() {
        return Err(ReferenceLibraryError::InvalidData(
            "棋谱没有主线着法".into(),
        ));
    }
    Ok(result)
}

fn classify_game(
    connection: &Connection,
    game_id: &str,
    raw_opening: &str,
    moves: &[String],
    is_standard_start: bool,
    version: i64,
) -> Result<OpeningMatch> {
    let mut candidates = Vec::new();
    let mut method = "unclassified".to_owned();
    let mut matched_plies = 0u32;
    if is_standard_start && let Some(code) = trusted_opening_code(raw_opening) {
        if category_exists(connection, &code)? {
            candidates.push(code);
            method = "trusted_code".into();
        }
    }
    if is_standard_start && candidates.is_empty() && !raw_opening.trim().is_empty() {
        let mut statement = connection.prepare(
            "SELECT category_code FROM opening_aliases WHERE alias=?1 AND reviewed=1 ORDER BY category_code",
        )?;
        candidates = statement
            .query_map([raw_opening.trim()], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        if !candidates.is_empty() {
            method = "reviewed_alias".into();
        }
    }
    if is_standard_start && candidates.is_empty() {
        let mut statement = connection.prepare(
            "SELECT category_code, move_prefix_json, match_depth, priority
             FROM opening_patterns WHERE classifier_version_id=?1 AND pattern_type='move_prefix'
             ORDER BY match_depth DESC, priority DESC",
        )?;
        let patterns = statement
            .query_map([version], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut deepest = 0u32;
        for (code, json, depth) in patterns {
            let prefix: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
            if depth >= deepest && moves.starts_with(&prefix) {
                if depth > deepest {
                    candidates.clear();
                    deepest = depth;
                }
                candidates.push(code);
            }
        }
        if !candidates.is_empty() {
            method = "longest_move_prefix".into();
            matched_plies = deepest;
        }
    }
    if is_standard_start && candidates.is_empty() {
        let position_matches = matching_position_patterns(connection, moves, version)?;
        if !position_matches.is_empty() {
            let deepest = position_matches[0].1;
            candidates = position_matches
                .into_iter()
                .take_while(|(_, depth)| *depth == deepest)
                .map(|(code, _)| code)
                .collect();
            method = "deepest_position".into();
            matched_plies = deepest;
        }
    }
    candidates.sort();
    candidates.dedup();
    let primary_code = (candidates.len() == 1).then(|| candidates[0].clone());
    let status = if primary_code.is_some() {
        "classified"
    } else {
        "pending"
    };
    let confidence = match method.as_str() {
        "trusted_code" => 1.0,
        "reviewed_alias" => 0.98,
        "longest_move_prefix" if primary_code.is_some() => 0.9,
        "deepest_position" if primary_code.is_some() => 0.88,
        _ => 0.0,
    };
    connection.execute(
        "UPDATE game_opening_classifications SET is_primary=0 WHERE game_id=?1 AND classifier_version_id=?2",
        params![game_id, version],
    )?;
    if candidates.is_empty() {
        connection.execute(
            "INSERT INTO game_opening_classifications
             (game_id, category_code, candidate_codes_json, method, confidence, matched_plies,
              classifier_version_id, is_primary, status, created_at)
             VALUES (?1,NULL,'[]',?2,?3,?4,?5,0,'pending',?6)",
            params![game_id, method, confidence, matched_plies, version, now()],
        )?;
    } else {
        for code in &candidates {
            connection.execute(
                "INSERT INTO game_opening_classifications
                 (game_id, category_code, candidate_codes_json, method, confidence, matched_plies,
                  classifier_version_id, is_primary, status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    game_id,
                    code,
                    serde_json::to_string(&candidates).unwrap_or_else(|_| "[]".into()),
                    method,
                    confidence,
                    matched_plies,
                    version,
                    i64::from(primary_code.as_deref() == Some(code.as_str())),
                    status,
                    now()
                ],
            )?;
        }
    }
    Ok(OpeningMatch {
        game_id: game_id.into(),
        primary_code,
        candidates,
        method,
        confidence,
        matched_plies,
        classifier_version: version,
        status: status.into(),
    })
}

fn raw_opening(game: &CblGame) -> String {
    for value in [
        game.document.metadata.title.as_str(),
        game.document.metadata.event.as_str(),
    ] {
        if trusted_opening_code(value).is_some() {
            return value.trim().into();
        }
    }
    game.document.metadata.event.trim().to_owned()
}

fn trusted_opening_code(value: &str) -> Option<String> {
    for token in value.split(|character: char| !character.is_ascii_alphanumeric()) {
        let token = token.to_ascii_uppercase();
        let bytes = token.as_bytes();
        if (bytes.len() == 1 || bytes.len() == 3)
            && matches!(bytes.first(), Some(b'A'..=b'E'))
            && (bytes.len() == 1 || bytes[1..].iter().all(u8::is_ascii_digit))
        {
            return Some(token);
        }
    }
    None
}

fn category_exists(connection: &Connection, code: &str) -> Result<bool> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM opening_categories WHERE code=?1",
            [code],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn canonical_fingerprint(game: &CblGame, board: &Board, moves: &[String]) -> String {
    canonical_fingerprint_parts(
        board,
        &game.document.metadata.red,
        &game.document.metadata.black,
        &game.document.metadata.date,
        moves,
    )
}

fn canonical_fingerprint_parts(
    board: &Board,
    red_player: &str,
    black_player: &str,
    game_date: &str,
    moves: &[String],
) -> String {
    digest_text(&format!(
        "{}|{}|{}|{}|{}",
        board.rule_position_key(),
        normalize_name(red_player),
        normalize_name(black_player),
        normalize_date(game_date),
        moves.join(" ")
    ))
}

fn has_complete_identity(game: &CblGame) -> bool {
    !normalize_name(&game.document.metadata.red).is_empty()
        && !normalize_name(&game.document.metadata.black).is_empty()
        && is_full_date(&normalize_date(&game.document.metadata.date))
}

fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}
fn normalize_date(value: &str) -> String {
    value.trim().replace(['.', '/'], "-")
}
fn is_full_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}
fn normalize_result(value: &str) -> &str {
    match value.trim() {
        "1-0" => "1-0",
        "0-1" => "0-1",
        "1/2-1/2" | "0.5-0.5" => "1/2-1/2",
        _ => "*",
    }
}
fn digest_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn short_hash(value: &str) -> String {
    digest_text(value)[..32].to_owned()
}
fn now() -> String {
    Utc::now().to_rfc3339()
}

fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn cbl_files(root: &Path) -> Result<Vec<PathBuf>> {
    if root.is_file() {
        return Ok(root
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("cbl"))
            .then(|| root.to_owned())
            .into_iter()
            .collect());
    }
    let mut result = Vec::new();
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("cbl"))
            {
                result.push(path);
            }
        }
    }
    result.sort();
    Ok(result)
}

fn relative_source_path(root: &Path, path: &Path) -> String {
    if root.is_file() {
        root.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    } else {
        path.strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned()
    }
}

fn latest_source_file(
    connection: &Connection,
    source_id: &str,
    relative_path: &str,
) -> Result<Option<SourceFileRevision>> {
    connection
        .query_row(
            "SELECT id, sha256, revision, status, active FROM reference_import_files
         WHERE source_id=?1 AND relative_path=?2 ORDER BY revision DESC LIMIT 1",
            params![source_id, relative_path],
            |row| {
                Ok(SourceFileRevision {
                    id: row.get(0)?,
                    sha256: row.get(1)?,
                    revision: row.get(2)?,
                    status: row.get(3)?,
                    active: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn active_path_sources(
    connection: &Connection,
    source_id: &str,
    relative_path: &str,
) -> Result<Vec<ActiveSourceRecord>> {
    let mut statement = connection.prepare(
        "SELECT s.record_index,s.record_hash,g.canonical_fingerprint
         FROM reference_game_sources s JOIN reference_games g ON g.id=s.game_id
         WHERE s.source_id=?1 AND s.relative_path=?2 AND s.active=1",
    )?;
    let records = statement
        .query_map(params![source_id, relative_path], |row| {
            Ok(ActiveSourceRecord {
                record_index: row.get(0)?,
                record_hash: row.get(1)?,
                canonical_fingerprint: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(records)
}

fn record_removed_sources(
    connection: &Connection,
    source_id: &str,
    batch_id: &str,
    relative_path: &str,
    previous_sources: &[ActiveSourceRecord],
) -> Result<()> {
    for source in previous_sources {
        let still_active: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM reference_game_sources
             WHERE source_id=?1 AND relative_path=?2 AND record_index=?3
               AND record_hash=?4 AND active=1)",
            params![
                source_id,
                relative_path,
                source.record_index,
                source.record_hash
            ],
            |row| row.get(0),
        )?;
        if !still_active {
            connection.execute(
                "INSERT OR IGNORE INTO reference_import_removals
                 (id,batch_id,source_id,relative_path,record_index,record_hash,canonical_fingerprint,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    Uuid::new_v4().to_string(),
                    batch_id,
                    source_id,
                    relative_path,
                    source.record_index,
                    source.record_hash,
                    source.canonical_fingerprint,
                    now()
                ],
            )?;
        }
    }
    Ok(())
}

fn deactivate_missing_files(
    connection: &Connection,
    source_id: &str,
    batch_id: &str,
    seen: &BTreeSet<String>,
) -> Result<u32> {
    let mut statement = connection.prepare(
        "SELECT id, relative_path FROM reference_import_files WHERE source_id=?1 AND active=1",
    )?;
    let rows = statement
        .query_map([source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    let mut removed_files = 0;
    for (id, relative_path) in rows {
        if !seen.contains(&relative_path) {
            removed_files += 1;
            let mut sources = connection.prepare(
                "SELECT s.record_index,s.record_hash,g.canonical_fingerprint
                 FROM reference_game_sources s JOIN reference_games g ON g.id=s.game_id
                 WHERE s.source_id=?1 AND s.relative_path=?2 AND s.active=1",
            )?;
            let removed = sources
                .query_map(params![source_id, relative_path], |row| {
                    Ok((
                        row.get::<_, u32>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(sources);
            for (record_index, record_hash, canonical_fingerprint) in removed {
                connection.execute(
                    "INSERT OR IGNORE INTO reference_import_removals
                     (id,batch_id,source_id,relative_path,record_index,record_hash,canonical_fingerprint,created_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        Uuid::new_v4().to_string(),
                        batch_id,
                        source_id,
                        relative_path,
                        record_index,
                        record_hash,
                        canonical_fingerprint,
                        now()
                    ],
                )?;
            }
            connection.execute(
                "UPDATE reference_import_files SET active=0 WHERE id=?1",
                [id],
            )?;
            connection.execute(
                "UPDATE reference_game_sources SET active=0
                 WHERE source_id=?1 AND relative_path=?2",
                params![source_id, relative_path],
            )?;
        }
    }
    Ok(removed_files)
}

fn reconcile_active_games(connection: &Connection) -> Result<()> {
    connection.execute(
        "UPDATE reference_games SET active=CASE WHEN EXISTS (
           SELECT 1 FROM reference_game_sources s
           WHERE s.game_id=reference_games.id AND s.active=1
         ) THEN 1 ELSE 0 END",
        [],
    )?;
    Ok(())
}

fn rebuild_position_statistics(connection: &Connection) -> Result<()> {
    connection.execute("DELETE FROM reference_position_move_stats", [])?;
    connection.execute(
        "INSERT INTO reference_position_move_stats
         (position_key,position_hash,move_iccs,notation,samples,red_wins,draws,black_wins,first_year,last_year)
         SELECT m.position_key,m.position_hash,m.move_iccs,MAX(m.notation),COUNT(*),
                SUM(g.result='1-0'),SUM(g.result='1/2-1/2'),SUM(g.result='0-1'),
                MIN(CAST(substr(g.game_date,1,4) AS INTEGER)),MAX(CAST(substr(g.game_date,1,4) AS INTEGER))
         FROM reference_game_moves m
         JOIN reference_games g ON g.id=m.game_id
         WHERE g.active=1 AND g.validation_status='valid'
         GROUP BY m.position_hash,m.position_key,m.move_iccs",
        [],
    )?;
    Ok(())
}

fn rebuild_opening_category_stats(connection: &Connection) -> Result<()> {
    connection.execute("DELETE FROM opening_category_stats", [])?;
    connection.execute(
        "INSERT INTO opening_category_stats
         (category_code,game_count,red_wins,draws,black_wins,first_year,last_year,updated_at)
         SELECT c.code,
                COUNT(DISTINCT CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' THEN x.game_id END),
                COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' AND g.result='1-0' THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' AND g.result='1/2-1/2' THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' AND g.result='0-1' THEN 1 ELSE 0 END),0),
                MIN(CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' THEN CAST(substr(g.game_date,1,4) AS INTEGER) END),
                MAX(CASE WHEN x.is_primary=1 AND x.status='classified'
                       AND g.active=1 AND g.validation_status='valid' THEN CAST(substr(g.game_date,1,4) AS INTEGER) END),
                ?1
         FROM opening_categories c
         LEFT JOIN game_opening_classifications x
           ON ((c.parent_code IS NULL AND (x.category_code=c.code OR x.category_code LIKE c.code || '%'))
             OR (c.parent_code IS NOT NULL AND x.category_code=c.code))
          AND x.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
         LEFT JOIN reference_games g ON g.id=x.game_id
         WHERE c.active=1
         GROUP BY c.code",
        [now()],
    )?;
    Ok(())
}

fn opening_catalog_build_result(connection: &Connection) -> Result<OpeningCatalogBuildResult> {
    let classifier_version: i64 = connection.query_row(
        "SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1",
        [],
        |row| row.get(0),
    )?;
    let category_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM opening_categories WHERE active=1",
        [],
        |row| row.get(0),
    )?;
    let alias_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM opening_aliases", [], |row| row.get(0))?;
    let pattern_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM opening_patterns WHERE classifier_version_id=?1",
        [classifier_version],
        |row| row.get(0),
    )?;
    let classified_games: i64 = connection.query_row(
        "SELECT COUNT(DISTINCT game_id) FROM game_opening_classifications
         WHERE classifier_version_id=?1 AND is_primary=1 AND status='classified'",
        [classifier_version],
        |row| row.get(0),
    )?;
    let pending_games: i64 = connection.query_row(
        "SELECT COUNT(DISTINCT game_id) FROM game_opening_classifications
         WHERE classifier_version_id=?1 AND status='pending'",
        [classifier_version],
        |row| row.get(0),
    )?;
    Ok(OpeningCatalogBuildResult {
        classifier_version,
        category_count: category_count.max(0) as u64,
        alias_count: alias_count.max(0) as u64,
        pattern_count: pattern_count.max(0) as u64,
        classified_games: classified_games.max(0) as u64,
        pending_games: pending_games.max(0) as u64,
    })
}

fn find_move_duplicate_candidates(
    connection: &Connection,
    starting_fen: &str,
    moves_hash: &str,
) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT id FROM reference_games
         WHERE starting_fen=?1 AND moves_hash=?2 AND active=1
         ORDER BY created_at,id LIMIT 20",
    )?;
    let rows = statement.query_map(params![starting_fen, moves_hash], |row| row.get(0))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn ensure_imported_category(connection: &Connection, raw_opening: &str) -> Result<()> {
    let Some(code) = trusted_opening_code(raw_opening) else {
        return Ok(());
    };
    if category_exists(connection, &code)? {
        return Ok(());
    }
    let series = &code[..1];
    connection.execute(
        "INSERT OR IGNORE INTO opening_categories
         (code,series_code,parent_code,name,sort_order,active)
         VALUES (?1,?2,?2,?3,?4,1)",
        params![
            code,
            series,
            raw_opening.trim(),
            code[1..].parse::<i32>().unwrap_or(0)
        ],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO opening_aliases (alias,category_code,reviewed,source)
         VALUES (?1,?2,1,'trusted-import-code')",
        params![raw_opening.trim(), code],
    )?;
    Ok(())
}

fn matching_position_patterns(
    connection: &Connection,
    moves: &[String],
    version: i64,
) -> Result<Vec<(String, u32)>> {
    let mut board = Board::from_fen(xiangqi_core::STARTING_FEN)
        .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
    let mut positions = vec![(board.rule_position_key(), 0u32)];
    for (index, iccs) in moves.iter().enumerate() {
        board = board
            .apply_iccs(iccs)
            .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?;
        positions.push((board.rule_position_key(), index as u32 + 1));
    }
    let mut statement = connection.prepare(
        "SELECT category_code,position_key,match_depth
         FROM opening_patterns
         WHERE classifier_version_id=?1 AND pattern_type='position' AND position_key IS NOT NULL
         ORDER BY match_depth DESC,priority DESC,category_code",
    )?;
    let patterns = statement
        .query_map([version], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut result = patterns
        .into_iter()
        .filter_map(|(code, key, match_depth)| {
            positions
                .iter()
                .rev()
                .find(|(position, _)| position == &key)
                .map(|_| (code, match_depth))
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    Ok(result)
}

fn seed_opening_catalog(connection: &Connection) -> Result<()> {
    for (index, (code, name)) in [
        ("A", "非中炮类开局"),
        ("B", "中炮对反宫马及其他"),
        ("C", "中炮对屏风马"),
        ("D", "顺炮与列炮"),
        ("E", "仙人指路与对兵局"),
    ]
    .into_iter()
    .enumerate()
    {
        connection.execute(
            "INSERT OR IGNORE INTO opening_series (code,name,sort_order) VALUES (?1,?2,?3)",
            params![code, name, index as i32],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO opening_categories
             (code,series_code,parent_code,name,sort_order,active) VALUES (?1,?1,NULL,?2,?3,1)",
            params![code, name, index as i32],
        )?;
    }
    for (code, series, name, sort_order) in [
        ("A01", "A", "飞相局", 101),
        ("A02", "A", "起马局", 102),
        ("A03", "A", "仕角炮与过宫炮", 103),
        ("B01", "B", "中炮类开局", 201),
        ("B02", "B", "中炮对反宫马及其他", 202),
        ("C01", "C", "中炮对屏风马", 301),
        ("D01", "D", "顺炮与列炮", 401),
        ("E01", "E", "仙人指路与挺兵局", 501),
    ] {
        connection.execute(
            "INSERT OR IGNORE INTO opening_categories
             (code,series_code,parent_code,name,sort_order,active) VALUES (?1,?2,?2,?3,?4,1)",
            params![code, series, name, sort_order],
        )?;
    }
    connection.execute(
        "INSERT OR IGNORE INTO opening_classifier_versions
         (id,name,status,active,created_at) VALUES (1,'builtin-ae-v1','active',0,?1)",
        [now()],
    )?;
    connection.execute(
        "INSERT INTO opening_classifier_versions (name,status,active,created_at)
         VALUES ('builtin-practical-v1','active',1,?1)
         ON CONFLICT(name) DO UPDATE SET status='active', active=1",
        [now()],
    )?;
    connection.execute(
        "UPDATE opening_classifier_versions SET active=0 WHERE name<>'builtin-practical-v1'",
        [],
    )?;
    let version: i64 = connection.query_row(
        "SELECT id FROM opening_classifier_versions WHERE name='builtin-practical-v1'",
        [],
        |row| row.get(0),
    )?;
    connection.execute(
        "DELETE FROM opening_patterns WHERE classifier_version_id=?1",
        [version],
    )?;
    for (code, aliases) in [
        ("A01", &["飞相局", "飞相"] as &[&str]),
        ("A02", &["起马局", "起马"]),
        ("A03", &["仕角炮", "过宫炮", "仕角炮局", "过宫炮局"]),
        ("B01", &["中炮", "中炮局", "当头炮"]),
        ("B02", &["中炮对反宫马", "反宫马"]),
        ("C01", &["中炮对屏风马", "屏风马"]),
        ("D01", &["顺炮", "列炮", "顺炮局", "列炮局"]),
        ("E01", &["仙人指路", "进兵局", "挺兵局", "对兵局"]),
    ] {
        for alias in aliases {
            connection.execute(
                "INSERT OR IGNORE INTO opening_aliases (alias,category_code,reviewed,source)
                 VALUES (?1,?2,1,'builtin-practical-v1')",
                params![alias, code],
            )?;
        }
    }
    for (code, priority, prefix) in [
        ("C01", 200, &["h2e2", "b9c7"] as &[&str]),
        ("C01", 200, &["h2e2", "h9g7"]),
        ("C01", 200, &["b2e2", "b9c7"]),
        ("C01", 200, &["b2e2", "h9g7"]),
        ("D01", 190, &["h2e2", "b7e7"]),
        ("D01", 190, &["h2e2", "h7e7"]),
        ("D01", 190, &["b2e2", "b7e7"]),
        ("D01", 190, &["b2e2", "h7e7"]),
        ("B01", 100, &["h2e2"]),
        ("B01", 100, &["b2e2"]),
        ("A01", 100, &["g0e2"]),
        ("A01", 100, &["c0e2"]),
        ("A02", 100, &["b0c2"]),
        ("A02", 100, &["h0g2"]),
        ("A02", 100, &["b0a2"]),
        ("A02", 100, &["h0i2"]),
        ("A03", 100, &["h2f2"]),
        ("A03", 100, &["b2d2"]),
        ("A03", 100, &["h2d2"]),
        ("A03", 100, &["b2f2"]),
        ("E01", 100, &["c3c4"]),
        ("E01", 100, &["g3g4"]),
        ("E01", 100, &["a3a4"]),
        ("E01", 100, &["i3i4"]),
        ("E01", 100, &["e3e4"]),
    ] {
        insert_move_prefix_pattern(connection, version, code, prefix, priority)?;
    }
    Ok(())
}

fn insert_move_prefix_pattern(
    connection: &Connection,
    version: i64,
    code: &str,
    prefix: &[&str],
    priority: i32,
) -> Result<()> {
    let moves = prefix
        .iter()
        .map(|item| item.to_string())
        .collect::<Vec<_>>();
    connection.execute(
        "INSERT INTO opening_patterns
         (classifier_version_id,category_code,pattern_type,move_prefix_json,position_key,match_depth,priority,support_count)
         VALUES (?1,?2,'move_prefix',?3,NULL,?4,?5,0)",
        params![
            version,
            code,
            serde_json::to_string(&moves)
                .map_err(|error| ReferenceLibraryError::InvalidData(error.to_string()))?,
            moves.len() as i64,
            priority
        ],
    )?;
    Ok(())
}

fn seed_opening_alias_candidates(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare(
        "SELECT opening, COUNT(*) FROM reference_games
         WHERE active=1 AND validation_status='valid' AND trim(opening)<>''
         GROUP BY opening HAVING COUNT(*)>=3 ORDER BY COUNT(*) DESC LIMIT 5000",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for (alias, _count) in rows {
        let alias = alias.trim();
        if looks_like_event_name(alias) {
            continue;
        }
        if let Some(code) = practical_alias_category(alias) {
            connection.execute(
                "INSERT OR IGNORE INTO opening_aliases (alias,category_code,reviewed,source)
                 VALUES (?1,?2,0,'auto-candidate')",
                params![alias, code],
            )?;
        }
    }
    Ok(())
}

fn looks_like_event_name(value: &str) -> bool {
    let value = value.trim();
    let has_digit = value.chars().any(|character| character.is_ascii_digit());
    has_digit
        && [
            "年",
            "届",
            "杯",
            "赛",
            "联赛",
            "团体",
            "个人",
            "锦标赛",
            "智运会",
            "棋甲",
        ]
        .iter()
        .any(|token| value.contains(token))
}

fn practical_alias_category(value: &str) -> Option<&'static str> {
    if value.contains("中炮") && value.contains("屏风马") {
        Some("C01")
    } else if value.contains("顺炮") || value.contains("列炮") {
        Some("D01")
    } else if value.contains("飞相") {
        Some("A01")
    } else if value.contains("起马") {
        Some("A02")
    } else if value.contains("仕角炮") || value.contains("过宫炮") {
        Some("A03")
    } else if value.contains("反宫马") {
        Some("B02")
    } else if value.contains("仙人指路")
        || value.contains("进兵")
        || value.contains("挺兵")
        || value.contains("对兵")
    {
        Some("E01")
    } else if value.contains("中炮") || value.contains("当头炮") {
        Some("B01")
    } else {
        None
    }
}

fn is_publishable_license(value: &str) -> bool {
    matches!(value.trim(), "authorized" | "public-domain" | "self-owned")
}

fn map_source(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceSource> {
    Ok(ReferenceSource {
        id: row.get(0)?,
        display_name: row.get(1)?,
        root_path: row.get(2)?,
        auto_scan: row.get(3)?,
        license_status: row.get(4)?,
        active: row.get(5)?,
        last_scanned_at: row.get(6)?,
    })
}
fn map_batch(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceImportBatch> {
    let warnings: String = row.get(12)?;
    Ok(ReferenceImportBatch {
        id: row.get(0)?,
        source_id: row.get(1)?,
        status: row.get(2)?,
        review_status: row.get(3)?,
        discovered_files: row.get(4)?,
        changed_files: row.get(5)?,
        imported_records: row.get(6)?,
        revised_records: row.get(7)?,
        duplicate_records: row.get(8)?,
        invalid_records: row.get(9)?,
        empty_files: row.get(10)?,
        unclassified_records: row.get(11)?,
        warnings: serde_json::from_str(&warnings).unwrap_or_default(),
        created_at: row.get(13)?,
        completed_at: row.get(14)?,
    })
}
fn map_move_stat(row: &rusqlite::Row<'_>) -> rusqlite::Result<PositionMoveStat> {
    Ok(PositionMoveStat {
        iccs: row.get(0)?,
        notation: row.get(1)?,
        samples: row.get::<_, i64>(2)?.max(0) as u64,
        red_wins: row.get::<_, i64>(3)?.max(0) as u64,
        draws: row.get::<_, i64>(4)?.max(0) as u64,
        black_wins: row.get::<_, i64>(5)?.max(0) as u64,
        first_year: row
            .get::<_, Option<i64>>(6)?
            .and_then(|value| u16::try_from(value).ok()),
        last_year: row
            .get::<_, Option<i64>>(7)?
            .and_then(|value| u16::try_from(value).ok()),
        opening_code: None,
        opening_name: None,
        opening_confidence: None,
        representative_game_id: None,
        representative_game_title: None,
    })
}

fn enrich_position_stats(
    connection: &Connection,
    position_key: &str,
    position_hash: &str,
    request: &PositionExplorerRequest,
    stats: &mut [PositionMoveStat],
) -> Result<()> {
    if stats.is_empty() {
        return Ok(());
    }
    let player = request.player.as_deref().unwrap_or_default().trim();
    let event = request.event.as_deref().unwrap_or_default().trim();
    let side = request.side.as_deref().unwrap_or_default().trim();
    let mut opening_statement = connection.prepare(
        "SELECT c.category_code,o.name,COUNT(DISTINCT g.id)
         FROM reference_game_moves m
         JOIN reference_games g ON g.id=m.game_id
         JOIN game_opening_classifications c ON c.game_id=g.id
           AND c.is_primary=1 AND c.status='classified'
           AND c.classifier_version_id=(SELECT id FROM opening_classifier_versions WHERE active=1 ORDER BY id DESC LIMIT 1)
         JOIN opening_categories o ON o.code=c.category_code
         WHERE m.position_hash=?1 AND m.position_key=?2 AND g.active=1 AND g.validation_status='valid'
           AND NOT EXISTS (SELECT 1 FROM temp_reference_exclusions e WHERE e.canonical_fingerprint=g.canonical_fingerprint)
           AND (?3='' OR g.red_player LIKE '%' || ?3 || '%' OR g.black_player LIKE '%' || ?3 || '%')
           AND (?4='' OR g.event_name LIKE '%' || ?4 || '%')
           AND (?5 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)>=?5)
           AND (?6 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)<=?6)
           AND (?7='' OR (?7='red' AND g.red_player LIKE '%' || ?3 || '%') OR (?7='black' AND g.black_player LIKE '%' || ?3 || '%'))
         GROUP BY c.category_code,o.name ORDER BY COUNT(DISTINCT g.id) DESC,c.category_code",
    )?;
    let opening_rows = opening_statement
        .query_map(
            params![
                position_hash,
                position_key,
                player,
                event,
                request.year_from,
                request.year_to,
                side
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let opening_total = opening_rows
        .iter()
        .map(|row| row.2.max(0) as u64)
        .sum::<u64>();
    let opening = opening_rows.first().map(|row| {
        let confidence = if opening_total == 0 {
            0
        } else {
            ((row.2.max(0) as u64 * 100) / opening_total) as u8
        };
        (row.0.clone(), row.1.clone(), confidence)
    });
    for stat in stats {
        let representative: Option<(String, String)> = connection
                .query_row(
                    "SELECT g.id,g.title
                     FROM reference_game_moves m
                     JOIN reference_games g ON g.id=m.game_id
                     WHERE m.position_hash=?1 AND m.position_key=?2 AND m.move_iccs=?3
                       AND g.active=1 AND g.validation_status='valid'
                       AND NOT EXISTS (SELECT 1 FROM temp_reference_exclusions e WHERE e.canonical_fingerprint=g.canonical_fingerprint)
                       AND (?4='' OR g.red_player LIKE '%' || ?4 || '%' OR g.black_player LIKE '%' || ?4 || '%')
                       AND (?5='' OR g.event_name LIKE '%' || ?5 || '%')
                       AND (?6 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)>=?6)
                       AND (?7 IS NULL OR CAST(substr(g.game_date,1,4) AS INTEGER)<=?7)
                       AND (?8='' OR (?8='red' AND g.red_player LIKE '%' || ?4 || '%') OR (?8='black' AND g.black_player LIKE '%' || ?4 || '%'))
                     ORDER BY g.game_date DESC,g.created_at DESC LIMIT 1",
                    params![
                        position_hash,
                        position_key,
                        stat.iccs,
                        player,
                        event,
                        request.year_from,
                        request.year_to,
                        side
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
        if let Some((game_id, title)) = representative {
            stat.representative_game_id = Some(game_id);
            stat.representative_game_title = Some(title);
        }
        if let Some((code, name, confidence)) = &opening {
            stat.opening_code = Some(code.clone());
            stat.opening_name = Some(name.clone());
            stat.opening_confidence = Some(*confidence);
        }
    }
    Ok(())
}
fn map_game(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceGameSummary> {
    Ok(ReferenceGameSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        red_player: row.get(2)?,
        black_player: row.get(3)?,
        result: row.get(4)?,
        event_name: row.get(5)?,
        round_name: row.get(6)?,
        game_date: row.get(7)?,
        opening: row.get(8)?,
        opening_code: row.get(9)?,
        canonical_fingerprint: row.get(10)?,
        move_count: row.get::<_, i64>(11)?.max(0) as u32,
    })
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS reference_sources (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL, auto_scan INTEGER NOT NULL DEFAULT 1,
  license_status TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_import_batches (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES reference_sources(id),
  status TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending', review_note TEXT NOT NULL DEFAULT '',
  discovered_files INTEGER NOT NULL DEFAULT 0, changed_files INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0, revised_records INTEGER NOT NULL DEFAULT 0,
  duplicate_records INTEGER NOT NULL DEFAULT 0, invalid_records INTEGER NOT NULL DEFAULT 0,
  empty_files INTEGER NOT NULL DEFAULT 0, unclassified_records INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]', parser_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, completed_at TEXT, reviewed_at TEXT, published_at TEXT
);
CREATE TABLE IF NOT EXISTS reference_import_files (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES reference_import_batches(id),
  source_id TEXT NOT NULL REFERENCES reference_sources(id), relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, revision INTEGER NOT NULL,
  status TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, declared_records INTEGER NOT NULL DEFAULT 0,
  parsed_records INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, relative_path, revision)
);
CREATE INDEX IF NOT EXISTS idx_reference_files_hash ON reference_import_files(source_id,relative_path,sha256);
CREATE TABLE IF NOT EXISTS reference_games (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, red_player TEXT NOT NULL, black_player TEXT NOT NULL,
  red_team TEXT NOT NULL, black_team TEXT NOT NULL, result TEXT NOT NULL,
  event_name TEXT NOT NULL, round_name TEXT NOT NULL, game_date TEXT NOT NULL,
  site TEXT NOT NULL, time_rule TEXT NOT NULL, opening TEXT NOT NULL,
  starting_fen TEXT NOT NULL, canonical_fingerprint TEXT NOT NULL, dedupe_key TEXT,
  identity_complete INTEGER NOT NULL DEFAULT 0, moves_hash TEXT NOT NULL,
  moves_json TEXT NOT NULL, move_count INTEGER NOT NULL, validation_status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  ingestion_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reference_games_start_moves_active
  ON reference_games(starting_fen,moves_hash,active);
CREATE INDEX IF NOT EXISTS idx_reference_games_valid_date
  ON reference_games(active,validation_status,game_date DESC,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS reference_game_documents (
  game_id TEXT PRIMARY KEY REFERENCES reference_games(id), document_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_game_source_documents (
  source_id TEXT NOT NULL REFERENCES reference_sources(id), relative_path TEXT NOT NULL,
  record_index INTEGER NOT NULL, record_hash TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES reference_games(id), document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_id,relative_path,record_index,record_hash)
);
CREATE TABLE IF NOT EXISTS reference_game_sources (
  game_id TEXT NOT NULL REFERENCES reference_games(id), source_id TEXT NOT NULL REFERENCES reference_sources(id),
  relative_path TEXT NOT NULL, record_index INTEGER NOT NULL, record_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_id,relative_path,record_index,record_hash)
);
CREATE TABLE IF NOT EXISTS reference_import_records (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES reference_import_batches(id),
  file_id TEXT NOT NULL REFERENCES reference_import_files(id), source_id TEXT NOT NULL REFERENCES reference_sources(id),
  relative_path TEXT NOT NULL, record_index INTEGER NOT NULL, record_hash TEXT NOT NULL,
  revision INTEGER NOT NULL, status TEXT NOT NULL, game_id TEXT REFERENCES reference_games(id),
  warning TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_id,relative_path,record_index,revision)
);
CREATE INDEX IF NOT EXISTS idx_reference_records_hash ON reference_import_records(source_id,relative_path,record_index,record_hash);
CREATE TABLE IF NOT EXISTS reference_import_removals (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES reference_import_batches(id),
  source_id TEXT NOT NULL REFERENCES reference_sources(id), relative_path TEXT NOT NULL,
  record_index INTEGER NOT NULL, record_hash TEXT NOT NULL, canonical_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id,relative_path,record_index,record_hash)
);
CREATE TABLE IF NOT EXISTS reference_published_fingerprints (
  canonical_fingerprint TEXT PRIMARY KEY, published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_duplicate_candidates (
  id TEXT PRIMARY KEY, incoming_game_id TEXT NOT NULL REFERENCES reference_games(id),
  candidate_game_id TEXT NOT NULL REFERENCES reference_games(id),
  source_id TEXT NOT NULL REFERENCES reference_sources(id), reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT,
  UNIQUE(incoming_game_id,candidate_game_id)
);
CREATE TABLE IF NOT EXISTS reference_game_moves (
  game_id TEXT NOT NULL REFERENCES reference_games(id), ply INTEGER NOT NULL, side_to_move TEXT NOT NULL,
  move_iccs TEXT NOT NULL, notation TEXT NOT NULL, before_fen TEXT NOT NULL, after_fen TEXT NOT NULL,
  position_key TEXT NOT NULL, position_hash TEXT NOT NULL, PRIMARY KEY(game_id,ply)
);
CREATE INDEX IF NOT EXISTS idx_reference_moves_position ON reference_game_moves(position_hash,move_iccs);
CREATE INDEX IF NOT EXISTS idx_reference_moves_key ON reference_game_moves(position_key,move_iccs);
CREATE INDEX IF NOT EXISTS idx_reference_moves_stat_rollup
  ON reference_game_moves(position_hash,position_key,move_iccs,game_id);
CREATE INDEX IF NOT EXISTS idx_reference_moves_position_game
  ON reference_game_moves(position_hash,position_key,game_id);
CREATE TABLE IF NOT EXISTS reference_position_move_stats (
  position_key TEXT NOT NULL, position_hash TEXT NOT NULL, move_iccs TEXT NOT NULL, notation TEXT NOT NULL,
  samples INTEGER NOT NULL, red_wins INTEGER NOT NULL, draws INTEGER NOT NULL, black_wins INTEGER NOT NULL,
  first_year INTEGER, last_year INTEGER,
  PRIMARY KEY(position_hash,position_key,move_iccs)
);
CREATE TABLE IF NOT EXISTS reference_players (
  id TEXT PRIMARY KEY, normalized_name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  title_label TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_player_source_refs (
  player_id TEXT NOT NULL REFERENCES reference_players(id), source_id TEXT NOT NULL REFERENCES reference_sources(id),
  source_player_id TEXT NOT NULL, source_name TEXT NOT NULL,
  PRIMARY KEY(source_id,source_player_id)
);
CREATE TABLE IF NOT EXISTS opening_series (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS opening_categories (
  code TEXT PRIMARY KEY, series_code TEXT NOT NULL REFERENCES opening_series(code),
  parent_code TEXT REFERENCES opening_categories(code), name TEXT NOT NULL,
  sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS opening_aliases (
  alias TEXT NOT NULL, category_code TEXT NOT NULL REFERENCES opening_categories(code),
  reviewed INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'migration',
  PRIMARY KEY(alias,category_code)
);
CREATE TABLE IF NOT EXISTS opening_category_stats (
  category_code TEXT PRIMARY KEY REFERENCES opening_categories(code),
  game_count INTEGER NOT NULL DEFAULT 0, red_wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0, black_wins INTEGER NOT NULL DEFAULT 0,
  first_year INTEGER, last_year INTEGER, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS opening_classifier_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS opening_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, classifier_version_id INTEGER NOT NULL REFERENCES opening_classifier_versions(id),
  category_code TEXT NOT NULL REFERENCES opening_categories(code), pattern_type TEXT NOT NULL,
  move_prefix_json TEXT NOT NULL DEFAULT '[]', position_key TEXT,
  match_depth INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0, support_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_opening_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES reference_games(id),
  category_code TEXT REFERENCES opening_categories(code), candidate_codes_json TEXT NOT NULL,
  method TEXT NOT NULL, confidence REAL NOT NULL, matched_plies INTEGER NOT NULL,
  classifier_version_id INTEGER NOT NULL REFERENCES opening_classifier_versions(id),
  is_primary INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_opening_primary ON game_opening_classifications(category_code,is_primary,status);
"#;

fn migrate_local_schema(connection: &Connection) -> Result<()> {
    if !has_column(connection, "reference_import_batches", "published_at")? {
        connection.execute(
            "ALTER TABLE reference_import_batches ADD COLUMN published_at TEXT",
            [],
        )?;
    }
    if !has_column(
        connection,
        "reference_import_removals",
        "canonical_fingerprint",
    )? {
        connection.execute(
            "ALTER TABLE reference_import_removals
             ADD COLUMN canonical_fingerprint TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !has_column(connection, "reference_position_move_stats", "first_year")? {
        connection.execute(
            "ALTER TABLE reference_position_move_stats ADD COLUMN first_year INTEGER",
            [],
        )?;
    }
    if !has_column(connection, "reference_position_move_stats", "last_year")? {
        connection.execute(
            "ALTER TABLE reference_position_move_stats ADD COLUMN last_year INTEGER",
            [],
        )?;
    }
    let games_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reference_games'",
        [],
        |row| row.get(0),
    )?;
    if !has_column(connection, "reference_games", "dedupe_key")?
        || games_sql.contains("canonical_fingerprint TEXT NOT NULL UNIQUE")
    {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE reference_games_v2 (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, red_player TEXT NOT NULL, black_player TEXT NOT NULL,
               red_team TEXT NOT NULL, black_team TEXT NOT NULL, result TEXT NOT NULL,
               event_name TEXT NOT NULL, round_name TEXT NOT NULL, game_date TEXT NOT NULL,
               site TEXT NOT NULL, time_rule TEXT NOT NULL, opening TEXT NOT NULL,
               starting_fen TEXT NOT NULL, canonical_fingerprint TEXT NOT NULL, dedupe_key TEXT,
               identity_complete INTEGER NOT NULL DEFAULT 0, moves_hash TEXT NOT NULL,
               moves_json TEXT NOT NULL, move_count INTEGER NOT NULL, validation_status TEXT NOT NULL,
               active INTEGER NOT NULL DEFAULT 1, ingestion_version INTEGER NOT NULL,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             INSERT INTO reference_games_v2
               (id,title,red_player,black_player,red_team,black_team,result,event_name,round_name,
                game_date,site,time_rule,opening,starting_fen,canonical_fingerprint,dedupe_key,
                identity_complete,moves_hash,moves_json,move_count,validation_status,active,
                ingestion_version,created_at,updated_at)
             SELECT id,title,red_player,black_player,red_team,black_team,result,event_name,round_name,
                    game_date,site,time_rule,opening,starting_fen,canonical_fingerprint,
                    CASE WHEN red_player<>'' AND black_player<>'' AND length(game_date)=10
                         THEN canonical_fingerprint ELSE NULL END,
                    CASE WHEN red_player<>'' AND black_player<>'' AND length(game_date)=10 THEN 1 ELSE 0 END,
                    moves_hash,moves_json,move_count,validation_status,1,ingestion_version,created_at,updated_at
             FROM reference_games;
             DROP TABLE reference_games;
             ALTER TABLE reference_games_v2 RENAME TO reference_games;
             COMMIT;",
        )?;
    }
    if !has_column(connection, "reference_game_sources", "active")? {
        connection.execute(
            "ALTER TABLE reference_game_sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    let records_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reference_import_records'",
        [],
        |row| row.get(0),
    )?;
    if records_sql.contains("UNIQUE(source_id,relative_path,record_index,record_hash)") {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE reference_import_records_v2 (
               id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES reference_import_batches(id),
               file_id TEXT NOT NULL REFERENCES reference_import_files(id),
               source_id TEXT NOT NULL REFERENCES reference_sources(id), relative_path TEXT NOT NULL,
               record_index INTEGER NOT NULL, record_hash TEXT NOT NULL, revision INTEGER NOT NULL,
               status TEXT NOT NULL, game_id TEXT REFERENCES reference_games(id),
               warning TEXT NOT NULL, created_at TEXT NOT NULL,
               UNIQUE(source_id,relative_path,record_index,revision)
             );
             INSERT INTO reference_import_records_v2
               (id,batch_id,file_id,source_id,relative_path,record_index,record_hash,revision,
                status,game_id,warning,created_at)
             SELECT id,batch_id,file_id,source_id,relative_path,record_index,record_hash,
                    ROW_NUMBER() OVER (
                      PARTITION BY source_id,relative_path,record_index ORDER BY created_at,id
                    ),status,game_id,warning,created_at
             FROM reference_import_records;
             DROP TABLE reference_import_records;
             ALTER TABLE reference_import_records_v2 RENAME TO reference_import_records;
             COMMIT;",
        )?;
    }
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_reference_games_fingerprint
           ON reference_games(canonical_fingerprint);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_games_dedupe
           ON reference_games(dedupe_key);
         CREATE INDEX IF NOT EXISTS idx_reference_games_start_moves_active
           ON reference_games(starting_fen,moves_hash,active);
         CREATE INDEX IF NOT EXISTS idx_reference_games_valid_date
           ON reference_games(active,validation_status,game_date DESC,created_at DESC,id DESC);
         CREATE INDEX IF NOT EXISTS idx_reference_records_hash
           ON reference_import_records(source_id,relative_path,record_index,record_hash);
         CREATE INDEX IF NOT EXISTS idx_reference_moves_stat_rollup
           ON reference_game_moves(position_hash,position_key,move_iccs,game_id);
         CREATE INDEX IF NOT EXISTS idx_reference_moves_position_game
           ON reference_game_moves(position_hash,position_key,game_id);
         CREATE TABLE IF NOT EXISTS opening_category_stats (
           category_code TEXT PRIMARY KEY REFERENCES opening_categories(code),
           game_count INTEGER NOT NULL DEFAULT 0, red_wins INTEGER NOT NULL DEFAULT 0,
           draws INTEGER NOT NULL DEFAULT 0, black_wins INTEGER NOT NULL DEFAULT 0,
           first_year INTEGER, last_year INTEGER, updated_at TEXT NOT NULL
         );",
    )?;
    Ok(())
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

#[cfg(test)]
mod tests {
    use super::*;
    use manual_format::CBL_PARSER_VERSION;
    use std::fs;

    const LIBRARY_MAGIC: &[u8; 16] = b"CCBridgeLibrary\0";
    const RECORD_MAGIC: &[u8; 16] = b"CCBridge Record\0";
    const RECORD_SIZE: usize = 4096;
    const RECORD_HEADER_SIZE: usize = 2214;
    const MOVE_SIDE_OFFSET: usize = 2116;

    fn write_utf16z(target: &mut [u8], value: &str) {
        for (index, unit) in value.encode_utf16().enumerate() {
            let at = index * 2;
            if at + 2 > target.len() {
                break;
            }
            target[at..at + 2].copy_from_slice(&unit.to_le_bytes());
        }
    }

    fn one_game_cbl() -> Vec<u8> {
        let mut bytes = vec![0u8; 101_952 + RECORD_SIZE];
        bytes[..16].copy_from_slice(LIBRARY_MAGIC);
        bytes[60..64].copy_from_slice(&1u32.to_le_bytes());
        write_utf16z(&mut bytes[64..576], "增量测试库");
        let record = &mut bytes[101_952..];
        record[..16].copy_from_slice(RECORD_MAGIC);
        write_utf16z(&mut record[180..308], "广东 陈松顺 胜 江苏 惠颂祥");
        write_utf16z(&mut record[692..756], "测试赛");
        write_utf16z(&mut record[884..948], "2026-09-08");
        write_utf16z(&mut record[1076..1140], "陈松顺");
        write_utf16z(&mut record[1300..1364], "惠颂祥");
        record[MOVE_SIDE_OFFSET] = 1;
        let board = &mut record[2120..2210];
        board[..9].copy_from_slice(&[0x21, 0x22, 0x23, 0x24, 0x25, 0x24, 0x23, 0x22, 0x21]);
        board[19] = 0x26;
        board[25] = 0x26;
        for col in [0, 2, 4, 6, 8] {
            board[27 + col] = 0x27;
            board[54 + col] = 0x17;
        }
        board[64] = 0x16;
        board[70] = 0x16;
        board[81..90].copy_from_slice(&[0x11, 0x12, 0x13, 0x14, 0x15, 0x14, 0x13, 0x12, 0x11]);
        record[RECORD_HEADER_SIZE + 4..RECORD_HEADER_SIZE + 8].copy_from_slice(&[1, 0, 70, 67]);
        bytes
    }

    fn two_game_cbl() -> Vec<u8> {
        let one = one_game_cbl();
        let mut bytes = vec![0u8; 101_952 + RECORD_SIZE * 2];
        bytes[..101_952 + RECORD_SIZE].copy_from_slice(&one);
        bytes[60..64].copy_from_slice(&2u32.to_le_bytes());
        let first = bytes[101_952..101_952 + RECORD_SIZE].to_vec();
        bytes[101_952 + RECORD_SIZE..].copy_from_slice(&first);
        bytes
    }

    fn anonymous_game_cbl() -> Vec<u8> {
        let mut bytes = one_game_cbl();
        let record = &mut bytes[101_952..];
        record[180..308].fill(0);
        write_utf16z(&mut record[180..308], "匿名棋谱");
        record[884..948].fill(0);
        record[1076..1140].fill(0);
        record[1300..1364].fill(0);
        bytes
    }

    #[test]
    fn source_scan_is_idempotent_and_builds_position_statistics() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("2026赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("第01轮.CBL"), one_game_cbl()).unwrap();
        let mut library =
            ReferenceLibrary::open(temp.path().join("reference-library.sqlite")).unwrap();
        let source = library
            .register_source(&source_dir, "2026赛事", true, "local-only")
            .unwrap();

        let first = library.scan_source(&source.id).unwrap();
        assert_eq!(first.status, "completed");
        assert_eq!(first.discovered_files, 1);
        assert_eq!(first.imported_records, 1);
        assert_eq!(first.invalid_records, 0);
        assert_eq!(first.unclassified_records, 0);

        let stats = library
            .query_position(xiangqi_core::STARTING_FEN, 10)
            .unwrap();
        assert_eq!(
            stats,
            vec![PositionMoveStat {
                iccs: "h2e2".into(),
                notation: "炮二平五".into(),
                samples: 1,
                red_wins: 1,
                draws: 0,
                black_wins: 0,
                first_year: Some(2026),
                last_year: Some(2026),
                opening_code: Some("B01".into()),
                opening_name: Some("中炮类开局".into()),
                opening_confidence: Some(100),
                representative_game_id: Some(
                    library.list_games(None, None, 1, 0).unwrap()[0].id.clone()
                ),
                representative_game_title: Some("广东 陈松顺 胜 江苏 惠颂祥".into()),
            }]
        );
        assert_eq!(
            library
                .list_games_filtered(
                    None,
                    None,
                    &ReferenceGameFilters {
                        player: Some("陈松顺".into()),
                        event: Some("测试赛".into()),
                        year_from: Some(2026),
                        year_to: Some(2026),
                        side: Some("red".into()),
                        master_only: Some(false),
                        classification_status: None,
                        position_fen: None,
                    },
                    10,
                    0,
                )
                .unwrap()
                .len(),
            1
        );
        assert!(
            library
                .list_games_filtered(
                    None,
                    None,
                    &ReferenceGameFilters {
                        player: Some("陈松顺".into()),
                        side: Some("black".into()),
                        ..ReferenceGameFilters::default()
                    },
                    10,
                    0,
                )
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            library
                .list_games_filtered(
                    None,
                    None,
                    &ReferenceGameFilters {
                        position_fen: Some(xiangqi_core::STARTING_FEN.into()),
                        ..ReferenceGameFilters::default()
                    },
                    10,
                    0,
                )
                .unwrap()
                .len(),
            1
        );

        let second = library.scan_source(&source.id).unwrap();
        assert_eq!(second.changed_files, 0);
        assert_eq!(second.imported_records, 0);
        assert_eq!(CBL_PARSER_VERSION, 3);
    }

    #[test]
    fn position_game_matches_are_newest_first() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("2026-09-08.CBL"), one_game_cbl()).unwrap();
        let mut newer = one_game_cbl();
        let record = &mut newer[101_952..];
        record[180..308].fill(0);
        write_utf16z(&mut record[180..308], "广东 新红方 胜 江苏 新黑方");
        record[884..948].fill(0);
        write_utf16z(&mut record[884..948], "2026-09-09");
        record[1076..1140].fill(0);
        write_utf16z(&mut record[1076..1140], "新红方");
        record[1300..1364].fill(0);
        write_utf16z(&mut record[1300..1364], "新黑方");
        fs::write(source_dir.join("2026-09-09.CBL"), newer).unwrap();

        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        let games = library
            .list_games_filtered(
                None,
                None,
                &ReferenceGameFilters {
                    position_fen: Some(xiangqi_core::STARTING_FEN.into()),
                    ..ReferenceGameFilters::default()
                },
                10,
                0,
            )
            .unwrap();

        assert_eq!(games.len(), 2);
        assert_eq!(games[0].game_date, "2026-09-09");
        assert_eq!(games[1].game_date, "2026-09-08");
    }

    #[test]
    fn practical_opening_catalog_is_idempotent_and_ignores_event_aliases() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("第01轮.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        let first = library.rebuild_opening_catalog().unwrap();
        let second = library.rebuild_opening_catalog().unwrap();
        assert_eq!(first.category_count, second.category_count);
        assert_eq!(first.pattern_count, second.pattern_count);
        assert_eq!(first.pattern_count, 25);
        assert_eq!(
            library
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM opening_aliases WHERE alias LIKE '%测试赛%'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn practical_opening_classification_populates_category_stats() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("第01轮.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        let result = library.classify_library(None).unwrap();
        assert_eq!(result.classified_games, 1);
        assert_eq!(result.pending_games, 0);
        let classified: String = library
            .connection
            .query_row(
                "SELECT category_code FROM game_opening_classifications
                 WHERE is_primary=1 AND status='classified'
                 ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(classified, "B01");
        let openings = library.browse_openings(Some("B")).unwrap();
        let central_cannon = openings.iter().find(|item| item.code == "B01").unwrap();
        assert_eq!(central_cannon.game_count, 1);
        assert_eq!(central_cannon.red_wins, 1);
    }

    #[test]
    fn overlay_queries_exclude_games_already_present_in_the_working_library() {
        let temp = tempfile::tempdir().unwrap();
        let working_dir = temp.path().join("working");
        let offline_dir = temp.path().join("offline");
        fs::create_dir(&working_dir).unwrap();
        fs::create_dir(&offline_dir).unwrap();
        fs::write(working_dir.join("game.CBL"), one_game_cbl()).unwrap();
        fs::write(offline_dir.join("game.CBL"), one_game_cbl()).unwrap();
        let mut working = ReferenceLibrary::open_in_memory().unwrap();
        let mut offline = ReferenceLibrary::open_in_memory().unwrap();
        let working_source = working
            .register_source(&working_dir, "工作库", true, "local-only")
            .unwrap();
        let offline_source = offline
            .register_source(&offline_dir, "离线包", true, "local-only")
            .unwrap();
        working.scan_source(&working_source.id).unwrap();
        offline.scan_source(&offline_source.id).unwrap();
        let fingerprints = working.canonical_fingerprints().unwrap();
        let cached_fingerprints = working.canonical_fingerprints().unwrap();
        assert!(Arc::ptr_eq(&fingerprints, &cached_fingerprints));

        assert!(
            offline
                .query_position_filtered_excluding(
                    &PositionExplorerRequest {
                        fen: xiangqi_core::STARTING_FEN.into(),
                        ..PositionExplorerRequest::default()
                    },
                    &fingerprints,
                )
                .unwrap()
                .is_empty()
        );
        assert!(
            offline
                .list_games_filtered_excluding(
                    None,
                    None,
                    &ReferenceGameFilters::default(),
                    10,
                    0,
                    &fingerprints,
                )
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            offline
                .list_games_filtered(None, None, &ReferenceGameFilters::default(), 10, 0,)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn filtered_position_representative_comes_from_the_filtered_games() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("旧.CBL"), one_game_cbl()).unwrap();
        let mut newer = one_game_cbl();
        let record = &mut newer[101_952..];
        record[180..308].fill(0);
        write_utf16z(&mut record[180..308], "广东 新红方 胜 江苏 新黑方");
        record[884..948].fill(0);
        write_utf16z(&mut record[884..948], "2026-09-09");
        record[1076..1140].fill(0);
        write_utf16z(&mut record[1076..1140], "新红方");
        record[1300..1364].fill(0);
        write_utf16z(&mut record[1300..1364], "新黑方");
        fs::write(source_dir.join("新.CBL"), newer).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        let stats = library
            .query_position_filtered(&PositionExplorerRequest {
                fen: xiangqi_core::STARTING_FEN.into(),
                player: Some("新红方".into()),
                ..PositionExplorerRequest::default()
            })
            .unwrap();

        assert_eq!(stats[0].samples, 1);
        assert_eq!(
            stats[0].representative_game_title.as_deref(),
            Some("广东 新红方 胜 江苏 新黑方")
        );
    }

    #[test]
    fn changed_file_creates_revision_without_duplicating_the_game() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        let path = source_dir.join("棋谱.CBL");
        fs::write(&path, one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        let mut revised = one_game_cbl();
        write_utf16z(&mut revised[101_952 + 308..101_952 + 436], "仅修改备注字段");
        fs::write(path, revised).unwrap();

        let batch = library.scan_source(&source.id).unwrap();
        assert_eq!(batch.changed_files, 1);
        assert_eq!(batch.revised_records, 1);
        assert_eq!(batch.duplicate_records, 1);
        assert_eq!(library.list_games(None, None, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn same_mainline_revision_updates_canonical_metadata_and_statistics() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        let path = source_dir.join("棋谱.CBL");
        fs::write(&path, one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        let mut revised = one_game_cbl();
        let record = &mut revised[101_952..];
        record[180..308].fill(0);
        write_utf16z(&mut record[180..308], "广东 新红方 负 江苏 新黑方");
        record[884..948].fill(0);
        write_utf16z(&mut record[884..948], "2026-09-09");
        record[1076..1140].fill(0);
        write_utf16z(&mut record[1076..1140], "新红方");
        record[1300..1364].fill(0);
        write_utf16z(&mut record[1300..1364], "新黑方");
        fs::write(path, revised).unwrap();

        library.scan_source(&source.id).unwrap();
        let games = library.list_games(None, None, 10, 0).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].red_player, "新红方");
        assert_eq!(games[0].black_player, "新黑方");
        assert_eq!(games[0].game_date, "2026-09-09");
        assert_eq!(games[0].result, "0-1");
        let stats = library
            .query_position(xiangqi_core::STARTING_FEN, 10)
            .unwrap();
        assert_eq!((stats[0].red_wins, stats[0].black_wins), (0, 1));
    }

    #[test]
    fn third_revision_can_return_to_an_older_record_hash() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        let path = source_dir.join("棋谱.CBL");
        let original = one_game_cbl();
        fs::write(&path, &original).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        let mut revised = original.clone();
        write_utf16z(&mut revised[101_952 + 308..101_952 + 436], "第二版备注");
        fs::write(&path, revised).unwrap();
        library.scan_source(&source.id).unwrap();
        fs::write(&path, original).unwrap();
        let third = library.scan_source(&source.id).unwrap();

        let revisions: (i64, i64) = library
            .connection
            .query_row(
                "SELECT COUNT(*),MAX(revision) FROM reference_import_records",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(revisions, (3, 3));
        assert_eq!(third.revised_records, 1);
        assert_eq!(library.list_games(None, None, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn missing_and_restored_file_updates_active_statistics() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        let path = source_dir.join("棋谱.CBL");
        let bytes = one_game_cbl();
        fs::write(&path, &bytes).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "authorized")
            .unwrap();
        let initial_batch = library.scan_source(&source.id).unwrap();
        library
            .review_batch(&initial_batch.id, true, "首次发布")
            .unwrap();
        library.mark_batch_published(&initial_batch.id).unwrap();
        fs::remove_file(&path).unwrap();
        let removed_batch = library.scan_source(&source.id).unwrap();
        assert!(
            library
                .query_position(xiangqi_core::STARTING_FEN, 10)
                .unwrap()
                .is_empty()
        );
        library
            .review_batch(&removed_batch.id, true, "确认来源文件已撤下")
            .unwrap();
        let removal_payload = library
            .publish_batch_payload_chunk(&removed_batch.id, "server-source", 250, 0)
            .unwrap();
        assert!(removal_payload.games.is_empty());
        assert_eq!(removal_payload.removed_records.len(), 1);
        assert_eq!(removal_payload.removed_records[0].record_index, 0);
        library.mark_batch_published(&removed_batch.id).unwrap();

        fs::write(path, bytes).unwrap();
        let restored_batch = library.scan_source(&source.id).unwrap();
        library
            .review_batch(&restored_batch.id, true, "确认来源文件已恢复")
            .unwrap();
        let restored_payload = library
            .publish_batch_payload_chunk(&restored_batch.id, "server-source", 250, 0)
            .unwrap();
        assert_eq!(restored_payload.games.len(), 1);
        assert!(restored_payload.removed_records.is_empty());
        assert_eq!(
            library
                .query_position(xiangqi_core::STARTING_FEN, 10)
                .unwrap()[0]
                .samples,
            1
        );
        assert_eq!(
            library
                .query_position_filtered_unpublished(&PositionExplorerRequest {
                    fen: xiangqi_core::STARTING_FEN.into(),
                    ..PositionExplorerRequest::default()
                })
                .unwrap()[0]
                .samples,
            1
        );
    }

    #[test]
    fn shortened_file_emits_removal_for_missing_tail_record() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        let path = source_dir.join("棋谱.CBL");
        fs::write(&path, two_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "authorized")
            .unwrap();
        library.scan_source(&source.id).unwrap();

        fs::write(path, one_game_cbl()).unwrap();
        let shortened = library.scan_source(&source.id).unwrap();
        library
            .review_batch(&shortened.id, true, "确认文件缩短")
            .unwrap();
        let payload = library
            .publish_batch_payload_chunk(&shortened.id, "server-source", 250, 0)
            .unwrap();
        assert_eq!(payload.games.len(), 1);
        assert_eq!(payload.removed_records.len(), 1);
        assert_eq!(payload.removed_records[0].record_index, 1);
    }

    #[test]
    fn incomplete_identity_moves_become_pending_duplicate_candidate() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("一.CBL"), anonymous_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        fs::write(source_dir.join("二.CBL"), anonymous_game_cbl()).unwrap();
        let batch = library.scan_source(&source.id).unwrap();
        let pending: i64 = library
            .connection
            .query_row(
                "SELECT COUNT(*) FROM reference_duplicate_candidates WHERE status='pending'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 1);
        assert_eq!(batch.duplicate_records, 1);
        assert_eq!(library.list_games(None, None, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn batch_review_can_resolve_identity_duplicate_and_opening_issues() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("一.CBL"), anonymous_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "authorized")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        fs::write(source_dir.join("二.CBL"), anonymous_game_cbl()).unwrap();
        let batch = library.scan_source(&source.id).unwrap();
        let issues = library.batch_review_issues(&batch.id).unwrap();
        let duplicate = issues
            .iter()
            .find(|issue| issue.kind == "duplicate")
            .unwrap();
        let game_id = duplicate.game_id.clone();
        let duplicate_id = duplicate.id.clone();

        library
            .resolve_duplicate_candidate(&duplicate_id, false)
            .unwrap();
        library
            .update_game_identity(&game_id, "红方", "黑方", "2026-09-09")
            .unwrap();
        library
            .override_game_opening(&game_id, "A", Some("人工审核布局"))
            .unwrap();

        assert!(library.batch_review_issues(&batch.id).unwrap().is_empty());
        assert_eq!(
            library
                .list_games_filtered(Some("A"), None, &ReferenceGameFilters::default(), 10, 0,)
                .unwrap()
                .len(),
            1
        );
        assert!(library.review_batch(&batch.id, true, "已处理").is_ok());
    }

    #[test]
    fn file_ingestion_rolls_back_all_games_when_a_record_write_fails() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("棋谱.CBL"), two_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        library
            .connection
            .execute_batch(
                "CREATE TRIGGER fail_second_record BEFORE INSERT ON reference_import_records
                 WHEN NEW.record_index=1 BEGIN SELECT RAISE(ABORT,'test failure'); END;",
            )
            .unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        let batch = library.scan_source(&source.id).unwrap();
        let games: i64 = library
            .connection
            .query_row("SELECT COUNT(*) FROM reference_games", [], |row| row.get(0))
            .unwrap();
        let records: i64 = library
            .connection
            .query_row("SELECT COUNT(*) FROM reference_import_records", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!((games, records), (0, 0));
        assert_eq!(batch.invalid_records, 1);
    }

    #[test]
    fn only_reviewed_authorized_batches_can_build_mainline_publish_chunks() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("授权赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("棋谱.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "授权赛事", true, "authorized")
            .unwrap();
        let batch = library.scan_source(&source.id).unwrap();
        assert!(
            library
                .publish_batch_payload_chunk(&batch.id, "server-source", 250, 0)
                .is_err()
        );

        library
            .review_batch(&batch.id, true, "来源许可已核对")
            .unwrap();
        let payload = library
            .publish_batch_payload_chunk(&batch.id, "server-source", 250, 0)
            .unwrap();
        assert_eq!(payload.games.len(), 1);
        assert_eq!(payload.games[0].moves, vec!["h2e2"]);
        assert_eq!(payload.games[0].file_sha256.len(), 64);
        assert_eq!(payload.games[0].opening.as_deref(), Some("测试赛"));
        let json = serde_json::to_value(payload).unwrap();
        assert!(json["games"][0].get("documentJson").is_none());
        assert!(json["games"][0].get("comment").is_none());
        let request = PositionExplorerRequest {
            fen: xiangqi_core::STARTING_FEN.into(),
            ..PositionExplorerRequest::default()
        };
        assert_eq!(
            library
                .query_position_filtered_unpublished(&request)
                .unwrap()
                .len(),
            1
        );
        library.mark_batch_published(&batch.id).unwrap();
        assert!(
            library
                .query_position_filtered_unpublished(&request)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn opening_catalog_starts_with_the_five_ae_series() {
        let library = ReferenceLibrary::open_in_memory().unwrap();
        let openings = library.browse_openings(None).unwrap();
        assert_eq!(
            openings
                .iter()
                .map(|item| item.code.as_str())
                .collect::<Vec<_>>(),
            vec!["A", "B", "C", "D", "E"]
        );
    }

    #[test]
    fn opening_browse_uses_only_the_active_classifier_and_rolls_up_series() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("棋谱.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        let game_id = library.list_games(None, None, 1, 0).unwrap()[0].id.clone();
        library
            .connection
            .execute(
                "INSERT INTO opening_categories
             (code,series_code,parent_code,name,sort_order,active)
             VALUES ('C03','C','C','测试布局',3,1)",
                [],
            )
            .unwrap();
        library.connection.execute(
            "INSERT INTO game_opening_classifications
             (game_id,category_code,candidate_codes_json,method,confidence,matched_plies,classifier_version_id,is_primary,status,created_at)
             VALUES (?1,'C03','[\"C03\"]','test',1,1,1,1,'classified',?2)",
            params![game_id, now()],
        ).unwrap();
        library
            .connection
            .execute("UPDATE opening_classifier_versions SET active=0", [])
            .unwrap();
        library
            .connection
            .execute(
                "INSERT INTO opening_classifier_versions (name,status,active,created_at)
             VALUES ('test-v2','active',1,?1)",
                [now()],
            )
            .unwrap();
        let test_version: i64 = library
            .connection
            .query_row(
                "SELECT id FROM opening_classifier_versions WHERE name='test-v2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        library.connection.execute(
            "INSERT INTO game_opening_classifications
             (game_id,category_code,candidate_codes_json,method,confidence,matched_plies,classifier_version_id,is_primary,status,created_at)
             VALUES (?1,'C03','[\"C03\"]','test',1,1,?2,1,'classified',?3)",
            params![game_id, test_version, now()],
        ).unwrap();
        rebuild_opening_category_stats(&library.connection).unwrap();

        let series = library.browse_openings(None).unwrap();
        assert_eq!(
            series
                .iter()
                .find(|item| item.code == "C")
                .unwrap()
                .game_count,
            1
        );
        assert_eq!(library.list_games(Some("C"), None, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn offline_package_validation_rejects_corruption_and_accepts_the_library_schema() {
        let temp = tempfile::tempdir().unwrap();
        let valid_path = temp.path().join("valid.sqlite");
        drop(ReferenceLibrary::open(&valid_path).unwrap());
        assert_eq!(
            ReferenceLibrary::validate_offline_package(&valid_path).unwrap(),
            0
        );

        let corrupt_path = temp.path().join("corrupt.sqlite");
        fs::write(&corrupt_path, b"not sqlite").unwrap();
        assert!(ReferenceLibrary::validate_offline_package(corrupt_path).is_err());
    }

    #[test]
    fn custom_start_is_not_forced_into_an_ae_opening() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("棋谱.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        let game_id = library.list_games(None, None, 1, 0).unwrap()[0].id.clone();

        let result = classify_game(
            &library.connection,
            &game_id,
            "C03 测试布局",
            &["h2e2".into()],
            false,
            1,
        )
        .unwrap();
        assert_eq!(result.primary_code, None);
        assert_eq!(result.status, "pending");
    }

    #[test]
    fn position_pattern_classifies_by_the_deepest_reached_position() {
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("赛事");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("棋谱.CBL"), one_game_cbl()).unwrap();
        let mut library = ReferenceLibrary::open_in_memory().unwrap();
        let source = library
            .register_source(&source_dir, "赛事", true, "local-only")
            .unwrap();
        library.scan_source(&source.id).unwrap();
        let game_id = library.list_games(None, None, 1, 0).unwrap()[0].id.clone();
        library
            .connection
            .execute(
                "INSERT INTO opening_categories
                 (code,series_code,parent_code,name,sort_order,active)
                 VALUES ('C03','C','C','测试布局',3,1)",
                [],
            )
            .unwrap();
        let position_key = Board::from_fen(xiangqi_core::STARTING_FEN)
            .unwrap()
            .apply_iccs("h2e2")
            .unwrap()
            .rule_position_key();
        library
            .connection
            .execute(
                "INSERT INTO opening_patterns
                 (classifier_version_id,category_code,pattern_type,position_key,match_depth)
                 VALUES (1,'C03','position',?1,1)",
                [position_key],
            )
            .unwrap();

        let result =
            classify_game(&library.connection, &game_id, "", &["h2e2".into()], true, 1).unwrap();
        assert_eq!(result.primary_code.as_deref(), Some("C03"));
        assert_eq!(result.method, "deepest_position");
        assert_eq!(result.matched_plies, 1);
    }

    #[test]
    fn position_pattern_prefers_the_largest_rule_match_depth() {
        let library = ReferenceLibrary::open_in_memory().unwrap();
        for (code, name) in [("C03", "浅规则"), ("C04", "深规则")] {
            library
                .connection
                .execute(
                    "INSERT INTO opening_categories
                 (code,series_code,parent_code,name,sort_order,active)
                 VALUES (?1,'C','C',?2,3,1)",
                    params![code, name],
                )
                .unwrap();
        }
        let start_key = Board::from_fen(xiangqi_core::STARTING_FEN)
            .unwrap()
            .rule_position_key();
        let after_key = Board::from_fen(xiangqi_core::STARTING_FEN)
            .unwrap()
            .apply_iccs("h2e2")
            .unwrap()
            .rule_position_key();
        library
            .connection
            .execute(
                "INSERT INTO opening_patterns
             (classifier_version_id,category_code,pattern_type,position_key,match_depth)
             VALUES (1,'C03','position',?1,1),(1,'C04','position',?2,8)",
                params![after_key, start_key],
            )
            .unwrap();

        let matches = matching_position_patterns(&library.connection, &["h2e2".into()], 1).unwrap();
        assert_eq!(matches[0], ("C04".into(), 8));
    }
}
