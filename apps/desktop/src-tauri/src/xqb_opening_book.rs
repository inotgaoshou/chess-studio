//! Reader for the SQLite XQB opening-book layout used by TChess.
//! XQB is a position-to-candidate-move database, not a game-record format.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use xiangqi_core::{Board, Move};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XqbCandidateDto {
    pub iccs: String,
    pub notation: String,
    pub score: i32,
    pub win: u32,
    pub draw: u32,
    pub loss: u32,
    pub win_rate: Option<f64>,
    pub memo: Option<String>,
    pub source: String,
}

struct XqbKey {
    bytes: Vec<u8>,
    mirror_ud: bool,
    mirror_lr: bool,
}

pub(crate) fn validate(path: &Path) -> Result<(), String> {
    let connection = open(path)?;
    let mut statement = connection
        .prepare("PRAGMA table_info(book)")
        .map_err(|error| format!("读取 XQB 表结构失败：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取 XQB 表结构失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 XQB 表结构失败：{error}"))?;
    for required in ["key", "Move", "Score", "Win", "Draw", "Lost", "Memo"] {
        if !columns
            .iter()
            .any(|column| column.eq_ignore_ascii_case(required))
        {
            return Err(format!(
                "不是兼容的 XQB 开局库：book 表缺少 {required} 字段"
            ));
        }
    }
    Ok(())
}

pub(crate) fn query(path: &Path, board: &Board) -> Result<Vec<XqbCandidateDto>, String> {
    let connection = open(path)?;
    let key = fen_to_key(&board.to_fen())?;
    let mut statement = connection
        .prepare("SELECT Move, Score, Win, Draw, Lost, Memo FROM book WHERE key = ?1")
        .map_err(|error| format!("查询 XQB 开局库失败：{error}"))?;
    let source = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("XQB 开局库")
        .to_owned();
    let mut candidates = Vec::new();
    let rows = statement
        .query_map([&key.bytes], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|error| format!("查询 XQB 开局库失败：{error}"))?;
    for row in rows {
        let (encoded, score, win, draw, loss, memo) =
            row.map_err(|error| format!("读取 XQB 数据失败：{error}"))?;
        let Some(mv) = decode_move(encoded as u16, &key) else {
            continue;
        };
        // A malformed book must not offer a move that the actual current position cannot play.
        if !board.legal_moves().contains(&mv) {
            continue;
        }
        let total = win.max(0) + draw.max(0) + loss.max(0);
        candidates.push(XqbCandidateDto {
            iccs: mv.to_iccs(),
            notation: board
                .chinese_move_notation(mv)
                .map_err(|error| error.to_string())?,
            score,
            win: win.max(0) as u32,
            draw: draw.max(0) as u32,
            loss: loss.max(0) as u32,
            win_rate: (total > 0)
                .then(|| (win.max(0) as f64 + draw.max(0) as f64 / 2.0) * 100.0 / total as f64),
            memo,
            source: source.clone(),
        });
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.iccs.cmp(&right.iccs))
    });
    Ok(candidates)
}

fn open(path: &Path) -> Result<Connection, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("xqb"))
        != Some(true)
    {
        return Err("请选择 .xqb 开局库文件".into());
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("无法打开 XQB 开局库：{error}"))
}

fn fen_to_key(fen: &str) -> Result<XqbKey, String> {
    let mut fields = fen.split_whitespace();
    let placement = fields.next().ok_or("XQB 局面缺少棋盘")?;
    let turn = fields.next().ok_or("XQB 局面缺少行棋方")?;
    let mut squares = Vec::with_capacity(90);
    for symbol in placement.chars() {
        match symbol {
            '/' => {}
            '1'..='9' => squares.extend(std::iter::repeat_n(
                -1i8,
                symbol.to_digit(10).unwrap() as usize,
            )),
            _ => squares.push(piece_code(if turn == "b" {
                swap_case(symbol)
            } else {
                symbol
            })),
        }
    }
    if squares.len() != 90 {
        return Err("XQB 仅支持标准 9×10 象棋局面".into());
    }
    let mirror_ud = turn == "b";
    if mirror_ud {
        for row in 0..5 {
            for col in 0..9 {
                squares.swap(row * 9 + col, (9 - row) * 9 + (8 - col));
            }
        }
    }
    let mut mirror_lr = false;
    'compare: for row in 0..10 {
        for col in 0..4 {
            let left = squares[row * 9 + col];
            let right = squares[row * 9 + 8 - col];
            if left != right {
                mirror_lr = right > left;
                break 'compare;
            }
        }
    }
    if mirror_lr {
        for row in 0..10 {
            for col in 0..4 {
                squares.swap(row * 9 + col, row * 9 + 8 - col);
            }
        }
    }
    let mut bytes = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits: i16 = 0;
    for (index, value) in squares.iter().enumerate() {
        if *value == -1 {
            bits += 1;
        } else {
            buffer |= 1 << (31 - bits);
            buffer |= (*value as u32) << (27 - bits);
            bits += 5;
        }
        let next_bits = if index == 89 {
            0
        } else if squares[index + 1] == -1 {
            1
        } else {
            5
        };
        if index == 89 || 32 - bits < next_bits {
            let threshold = if index == 89 { 1 } else { 8 };
            while bits >= threshold {
                bytes.push((buffer >> 24) as u8);
                buffer <<= 8;
                bits -= 8;
            }
        }
    }
    Ok(XqbKey {
        bytes,
        mirror_ud,
        mirror_lr,
    })
}

fn piece_code(symbol: char) -> i8 {
    match symbol {
        'X' | 'x' => 0,
        'R' => 1,
        'N' => 2,
        'B' => 3,
        'A' => 4,
        'K' => 5,
        'C' => 6,
        'P' => 7,
        'r' => 9,
        'n' => 10,
        'b' => 11,
        'a' => 12,
        'k' => 13,
        'c' => 14,
        'p' => 15,
        _ => -1,
    }
}
fn swap_case(symbol: char) -> char {
    if symbol.is_ascii_lowercase() {
        symbol.to_ascii_uppercase()
    } else {
        symbol.to_ascii_lowercase()
    }
}

fn decode_move(encoded: u16, key: &XqbKey) -> Option<Move> {
    let mut from_row = (encoded >> 12) as i16;
    let mut from_col = ((encoded >> 8) & 0xf) as i16;
    let mut to_row = ((encoded >> 4) & 0xf) as i16;
    let mut to_col = (encoded & 0xf) as i16;
    if key.mirror_ud {
        from_row = 9 - from_row;
        to_row = 9 - to_row;
        from_col = 8 - from_col;
        to_col = 8 - to_col;
    }
    if key.mirror_lr {
        from_col = 8 - from_col;
        to_col = 8 - to_col;
    }
    (0..10).contains(&from_row).then_some(())?;
    (0..10).contains(&to_row).then_some(())?;
    (0..9).contains(&from_col).then_some(())?;
    (0..9).contains(&to_col).then_some(())?;
    Some(Move {
        from: xiangqi_core::Square {
            row: from_row as u8,
            col: from_col as u8,
        },
        to: xiangqi_core::Square {
            row: to_row as u8,
            col: to_col as u8,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiangqi_core::STARTING_FEN;

    #[test]
    fn standard_position_key_is_stable_and_has_expected_size() {
        let key = fen_to_key(STARTING_FEN).unwrap();
        assert_eq!(key.bytes.len(), 28);
        assert!(!key.mirror_ud);
    }
    #[test]
    fn mirrors_a_black_move_back_to_iccs() {
        let key =
            fen_to_key("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1")
                .unwrap();
        // The canonical coordinates are inverted back for a black-to-move position.
        let move_ = decode_move(0x9172, &key).unwrap();
        assert_eq!(move_.to_iccs(), "h9g7");
    }

    #[test]
    fn validates_and_reads_a_sqlite_xqb_book() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.xqb");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE book (key BLOB, Move INTEGER, Score INTEGER, Win INTEGER, Draw INTEGER, Lost INTEGER, Valid INTEGER, Memo TEXT);").unwrap();
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = fen_to_key(STARTING_FEN).unwrap();
        // h2e2 (炮二平五) in the canonical red-side coordinates.
        connection
            .execute(
                "INSERT INTO book VALUES (?1, ?2, 36, 10, 4, 2, 1, '中炮')",
                rusqlite::params![key.bytes, 0x7774i32],
            )
            .unwrap();
        drop(connection);
        validate(&path).unwrap();
        let candidates = query(&path, &board).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].iccs, "h2e2");
        assert_eq!(candidates[0].notation, "炮二平五");
        assert_eq!(candidates[0].win_rate, Some(75.0));
    }
}
