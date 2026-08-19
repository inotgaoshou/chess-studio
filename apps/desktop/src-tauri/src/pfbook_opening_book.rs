//! Read-only support for bundled Pengfei `.pfBook` opening books.
//!
//! Realtime candidates stay disabled until the FEN -> vkey hash is verified.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use xiangqi_core::{Board, Move, STARTING_FEN, Square};

use crate::xqb_opening_book::XqbCandidateDto;

const MANIFEST_JSON: &str = include_str!("../resources/opening-books/manifest.json");
pub(crate) const DEFAULT_BUILTIN_OPENING_BOOK_ID: &str = "learning-top3";
const EXPECTED_STARTING_VKEY: i64 = 7_101_337_512_282_506_414;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltinOpeningBookManifestDto {
    pub version: String,
    pub default_book_id: String,
    pub internal_use_only: bool,
    pub vkey_verification: PfbookVkeyVerificationDto,
    pub books: Vec<BuiltinOpeningBookDto>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltinOpeningBookDto {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub kind: String,
    pub file_name: String,
    pub description: String,
    pub row_count: u64,
    pub position_count: u64,
    pub max_candidates_per_position: u32,
    pub sha256: String,
    pub default: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PfbookVkeyVerificationDto {
    pub status: String,
    pub note: String,
    #[serde(default)]
    pub expected_starting_vkey: Option<i64>,
    #[serde(default)]
    pub calculated_starting_vkey: Option<i64>,
}

pub(crate) fn manifest() -> Result<BuiltinOpeningBookManifestDto, String> {
    let mut manifest: BuiltinOpeningBookManifestDto = serde_json::from_str(MANIFEST_JSON)
        .map_err(|error| format!("读取内嵌开局库清单失败：{error}"))?;
    manifest.vkey_verification = vkey_verification_status();
    if !manifest
        .books
        .iter()
        .any(|book| book.id == manifest.default_book_id)
    {
        manifest.default_book_id = DEFAULT_BUILTIN_OPENING_BOOK_ID.into();
    }
    Ok(manifest)
}

pub(crate) fn normalize_book_id(value: &str) -> String {
    let fallback = DEFAULT_BUILTIN_OPENING_BOOK_ID.to_owned();
    if is_known_book_id(value) {
        value.to_owned()
    } else {
        fallback
    }
}

pub(crate) fn is_known_book_id(value: &str) -> bool {
    manifest()
        .map(|manifest| manifest.books.iter().any(|book| book.id == value))
        .unwrap_or(value == DEFAULT_BUILTIN_OPENING_BOOK_ID)
}

pub(crate) fn query_builtin_book(
    book_id: &str,
    board: &Board,
) -> Result<Vec<XqbCandidateDto>, String> {
    let status = vkey_verification_status();
    if status.status != "verified" {
        return Ok(Vec::new());
    }
    let manifest = manifest()?;
    let book = manifest
        .books
        .iter()
        .find(|book| book.id == book_id)
        .or_else(|| manifest.books.iter().find(|book| book.default))
        .ok_or("内嵌开局库清单缺少默认库")?;
    let path = resolve_builtin_book_path(&book.file_name)
        .ok_or_else(|| format!("找不到内嵌开局库文件：{}", book.file_name))?;
    query(&path, board, &source_label(book))
}

#[cfg(test)]
pub(crate) fn validate(path: &Path) -> Result<(), String> {
    let connection = open(path)?;
    let columns = table_columns(&connection, "pfBook")?;
    for required in [
        "id", "vkey", "vmove", "vscore", "vwin", "vdraw", "vlost", "vvalid", "vmemo", "vindex",
    ] {
        if !columns
            .iter()
            .any(|column| column.eq_ignore_ascii_case(required))
        {
            return Err(format!(
                "不是兼容的 pfBook 开局库：pfBook 表缺少 {required} 字段"
            ));
        }
    }
    let version_columns = table_columns(&connection, "bookVersion")?;
    for required in ["key", "version"] {
        if !version_columns
            .iter()
            .any(|column| column.eq_ignore_ascii_case(required))
        {
            return Err(format!(
                "不是兼容的 pfBook 开局库：bookVersion 表缺少 {required} 字段"
            ));
        }
    }
    let version = connection
        .query_row(
            "SELECT version FROM bookVersion WHERE key='pfBook' LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("读取 pfBook 版本失败：{error}"))?;
    if version.trim().is_empty() {
        return Err("pfBook 版本不能为空".into());
    }
    Ok(())
}

fn query(path: &Path, board: &Board, source: &str) -> Result<Vec<XqbCandidateDto>, String> {
    let Some(vkey) = fen_to_vkey(&board.to_fen()) else {
        return Ok(Vec::new());
    };
    let connection = open(path)?;
    let mut statement = connection
        .prepare(
            "SELECT vmove, vscore, vwin, vdraw, vlost, vmemo
             FROM pfBook
             WHERE vkey = ?1 AND vvalid = 1
             ORDER BY vscore DESC, (vwin + vdraw + vlost) DESC, vmove ASC",
        )
        .map_err(|error| format!("查询 pfBook 开局库失败：{error}"))?;
    let rows = statement
        .query_map([vkey], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|error| format!("查询 pfBook 开局库失败：{error}"))?;
    let mut candidates = Vec::new();
    for row in rows {
        let (encoded, score, win, draw, loss, memo) =
            row.map_err(|error| format!("读取 pfBook 数据失败：{error}"))?;
        let Some(mv) = u16::try_from(encoded).ok().and_then(decode_move) else {
            continue;
        };
        if !board.legal_moves().contains(&mv) {
            continue;
        }
        let win = nonnegative_u32(win);
        let draw = nonnegative_u32(draw);
        let loss = nonnegative_u32(loss);
        let total = u64::from(win) + u64::from(draw) + u64::from(loss);
        candidates.push(XqbCandidateDto {
            iccs: mv.to_iccs(),
            notation: board
                .chinese_move_notation(mv)
                .map_err(|error| error.to_string())?,
            score: clamp_i32(score),
            win,
            draw,
            loss,
            win_rate: (total > 0).then(|| (win as f64 + draw as f64 / 2.0) * 100.0 / total as f64),
            memo,
            source: source.to_owned(),
        });
    }
    Ok(candidates)
}

fn open(path: &Path) -> Result<Connection, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pfbook"))
        != Some(true)
    {
        return Err("请选择 .pfBook 开局库文件".into());
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("无法打开 pfBook 开局库：{error}"))
}

#[cfg(test)]
fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("读取 {table} 表结构失败：{error}"))?;
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取 {table} 表结构失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 {table} 表结构失败：{error}"))
}

fn decode_move(encoded: u16) -> Option<Move> {
    let source = (encoded >> 8) as u8;
    let target = (encoded & 0xff) as u8;
    Some(Move {
        from: decode_square(source)?,
        to: decode_square(target)?,
    })
}

fn decode_square(square: u8) -> Option<Square> {
    let row = (square >> 4).checked_sub(3)?;
    let col = (square & 0x0f).checked_sub(3)?;
    (row < 10 && col < 9).then_some(Square { row, col })
}

fn fen_to_vkey(_fen: &str) -> Option<i64> {
    None
}

fn vkey_verification_status() -> PfbookVkeyVerificationDto {
    let calculated = fen_to_vkey(STARTING_FEN);
    match calculated {
        Some(EXPECTED_STARTING_VKEY) => PfbookVkeyVerificationDto {
            status: "verified".into(),
            note: "FEN to pfBook vkey is verified against the standard starting position.".into(),
            expected_starting_vkey: Some(EXPECTED_STARTING_VKEY),
            calculated_starting_vkey: calculated,
        },
        Some(value) => PfbookVkeyVerificationDto {
            status: "unverified".into(),
            note: format!(
                "FEN to pfBook vkey mismatch: expected {EXPECTED_STARTING_VKEY}, calculated {value}."
            ),
            expected_starting_vkey: Some(EXPECTED_STARTING_VKEY),
            calculated_starting_vkey: calculated,
        },
        None => PfbookVkeyVerificationDto {
            status: "unverified".into(),
            note:
                "FEN to pfBook vkey is not implemented yet; realtime pfBook candidates are hidden."
                    .into(),
            expected_starting_vkey: Some(EXPECTED_STARTING_VKEY),
            calculated_starting_vkey: None,
        },
    }
}

fn source_label(book: &BuiltinOpeningBookDto) -> String {
    match book.kind.as_str() {
        "learning" => format!("内嵌学习库 · {}", book.short_name),
        "complete" => format!("完整兼容库 · {}", book.short_name),
        "observation" => format!("obk观察库 · {}", book.short_name),
        _ => format!("内嵌开局库 · {}", book.short_name),
    }
}

fn resolve_builtin_book_path(filename: &str) -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = opening_book_candidates(&manifest_dir.join("resources"), filename);
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend(opening_book_candidates(parent, filename));
            candidates.extend(opening_book_candidates(
                &parent.join("../Resources"),
                filename,
            ));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn opening_book_candidates(base: &Path, filename: &str) -> Vec<PathBuf> {
    ["opening-books", "resources/opening-books"]
        .into_iter()
        .map(|relative| base.join(relative).join(filename))
        .collect()
}

fn clamp_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn nonnegative_u32(value: i64) -> u32 {
    value.max(0).min(i64::from(u32::MAX)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn bundled_manifest_lists_three_books_and_defaults_to_learning() {
        let manifest = manifest().unwrap();
        assert_eq!(manifest.default_book_id, DEFAULT_BUILTIN_OPENING_BOOK_ID);
        assert_eq!(manifest.books.len(), 3);
        assert!(
            manifest
                .books
                .iter()
                .any(|book| book.id == "learning-top3" && book.default)
        );
        assert_eq!(manifest.vkey_verification.status, "unverified");
    }

    #[test]
    fn opening_book_candidates_cover_packaged_and_development_layouts() {
        let base = PathBuf::from("/Applications/Xiangqi Studio.app/Contents/Resources");
        let candidates = opening_book_candidates(&base, "02_learning_top3.pfBook");
        assert!(candidates.contains(&base.join("opening-books/02_learning_top3.pfBook")));
        assert!(candidates.contains(&base.join("resources/opening-books/02_learning_top3.pfBook")));
    }

    #[test]
    fn development_learning_book_has_pfbook_schema() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/opening-books/02_learning_top3.pfBook");
        assert!(path.is_file());
        validate(&path).unwrap();
    }

    #[test]
    fn decodes_pfbook_moves_to_legal_starting_moves() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let moves = [43_687, 51_623, 38_277]
            .into_iter()
            .map(|encoded| decode_move(encoded).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(moves[0].to_iccs(), "h2e2");
        assert_eq!(moves[1].to_iccs(), "g0e2");
        assert_eq!(moves[2].to_iccs(), "c3c4");
        for mv in moves {
            assert!(board.legal_moves().contains(&mv), "{}", mv.to_iccs());
        }
    }

    #[test]
    fn vkey_gate_is_unverified_until_hash_is_implemented() {
        let status = vkey_verification_status();
        assert_eq!(status.status, "unverified");
        assert_eq!(status.expected_starting_vkey, Some(EXPECTED_STARTING_VKEY));
        assert_eq!(status.calculated_starting_vkey, None);
    }

    #[test]
    fn query_returns_empty_while_vkey_is_unverified() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.pfBook");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE pfBook(id INTEGER PRIMARY KEY AUTOINCREMENT, vkey INTEGER, vmove INTEGER, vscore INTEGER, vwin INTEGER, vdraw INTEGER, vlost INTEGER, vvalid INTEGER, vmemo TEXT, vindex INTEGER);
                 CREATE TABLE bookVersion([key] text, [version] text);
                 INSERT INTO bookVersion([key], [version]) VALUES ('pfBook', '1.0.0.0');
                 INSERT INTO pfBook(vkey, vmove, vscore, vwin, vdraw, vlost, vvalid, vmemo, vindex)
                 VALUES (7101337512282506414, 43687, 2985, 3487, 7327, 3772, 1, NULL, 1);",
            )
            .unwrap();
        drop(connection);
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let candidates = query(&path, &board, "fixture").unwrap();
        assert!(candidates.is_empty());
    }
}
