use serde::{Deserialize, Serialize};
use xiangqi_core::{Board, Move};

const LIBRARY_MAGIC: &[u8; 16] = b"CCBridgeLibrary\0";
const RECORD_MAGIC: &[u8; 16] = b"CCBridge Record\0";
const HEADER_SIZE: usize = 576;
const RECORD_SIZE: usize = 4096;
const RECORD_HEADER_SIZE: usize = 2214;
const MOVE_SIDE_OFFSET: usize = 2116;
const STANDARD_STARTING_BOARD: &str = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR";
pub const CBL_PARSER_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CblMove {
    pub iccs: String,
    pub comment: String,
    pub children: Vec<CblMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CblProblem {
    pub source_index: u32,
    pub title: String,
    pub category: String,
    pub starting_fen: String,
    pub note: String,
    pub solution: Vec<CblMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CblLibrary {
    pub title: String,
    pub declared_count: u32,
    pub problems: Vec<CblProblem>,
    pub warnings: Vec<String>,
}

/// Decode a CCBridge CBL library.  This deliberately produces a library model,
/// rather than a normal editable manual: a CBL contains many independent puzzles.
pub fn import_cbl_library(bytes: &[u8]) -> Result<CblLibrary, String> {
    if bytes.len() < HEADER_SIZE || &bytes[..16] != LIBRARY_MAGIC {
        return Err("不是受支持的 CCBridge CBL 文件".into());
    }
    let declared_count = le_u32(bytes, 60)?;
    let title = utf16z(&bytes[64..576]);
    let data_offset = match declared_count {
        0..=128 => 101_952,
        129..=256 => 137_280,
        257..=384 => 151_080,
        385..=512 => 207_936,
        _ => 349_248,
    };
    if bytes.len() <= data_offset {
        return Err("CBL 文件缺少棋谱记录区".into());
    }
    let start = find_record(bytes, data_offset).ok_or("CBL 文件没有 CCBridge 记录")?;
    if (bytes.len() - start) % RECORD_SIZE != 0 {
        return Err("CBL 记录区长度不是 4096 字节的整数倍".into());
    }
    let mut result = CblLibrary {
        title,
        declared_count,
        problems: Vec::new(),
        warnings: Vec::new(),
    };
    for (index, record) in bytes[start..].chunks_exact(RECORD_SIZE).enumerate() {
        if &record[..16] != RECORD_MAGIC {
            continue;
        }
        match parse_record(record, index as u32) {
            Ok(problem) => result.problems.push(problem),
            Err(error) => result
                .warnings
                .push(format!("第 {} 条记录已跳过：{error}", index + 1)),
        }
    }
    Ok(result)
}

fn parse_record(record: &[u8], source_index: u32) -> Result<CblProblem, String> {
    if record.len() != RECORD_SIZE || &record[..16] != RECORD_MAGIC {
        return Err("无效记录头".into());
    }
    let title = utf16z(&record[180..308]);
    let category = utf16z(&record[692..756]);
    let note = read_initial_note(&record[RECORD_HEADER_SIZE..])?;
    let side = side_from_cbl_marker(record[MOVE_SIDE_OFFSET])?;
    let fen = board_fen(&record[2120..2210], side)?;
    if is_standard_starting_fen(&fen) {
        return Err("标准开局记录不是残局题目".into());
    }
    let board = Board::from_fen(&fen).map_err(|error| format!("初始局面非法：{error}"))?;
    let mut cursor = Cursor {
        bytes: &record[RECORD_HEADER_SIZE..],
        at: initial_note_end(&record[RECORD_HEADER_SIZE..])?,
    };
    let solution = parse_steps(&mut cursor, board)?;
    if solution.is_empty() {
        return Err("没有可验证的题解着法".into());
    }
    let title = if title.is_empty() {
        format!("残局题 {}", source_index + 1)
    } else {
        title
    };
    Ok(CblProblem {
        source_index,
        title: title.clone(),
        category: if category.is_empty() {
            inferred_category(&title).into()
        } else {
            category
        },
        starting_fen: fen,
        note,
        solution,
    })
}

fn parse_steps(cursor: &mut Cursor<'_>, board: Board) -> Result<Vec<CblMove>, String> {
    if cursor.remaining() < 4 {
        return Ok(Vec::new());
    }
    let step = cursor.take(4)?;
    if step == [0, 0, 0, 0] {
        return Ok(Vec::new());
    }
    let mark = step[0];
    let comment = if mark & 4 != 0 {
        utf16z(
            cursor
                .take(le_u32(cursor.bytes, cursor.at)? as usize + 4)?
                .get(4..)
                .unwrap_or_default(),
        )
    } else {
        String::new()
    };
    let from = Move::from_iccs(&format!(
        "{}{}{}{}",
        (b'a' + step[2] % 9) as char,
        9 - step[2] / 9,
        (b'a' + step[3] % 9) as char,
        9 - step[3] / 9
    ))
    .map_err(|_| "走子坐标非法")?;
    let iccs = from.to_iccs();
    let next_board = board
        .apply_move(from)
        .map_err(|_| format!("非法题解着法 {iccs}"))?;
    let children = if mark & 1 == 0 {
        parse_steps(cursor, next_board)?
    } else {
        Vec::new()
    };
    let mut moves = vec![CblMove {
        iccs,
        comment,
        children,
    }];
    if mark & 2 != 0 {
        moves.extend(parse_steps(cursor, board)?);
    }
    Ok(moves)
}

fn read_initial_note(bytes: &[u8]) -> Result<String, String> {
    let end = initial_note_end(bytes)?;
    if end <= 4 {
        return Ok(String::new());
    }
    Ok(utf16z(&bytes[8..end]))
}
fn initial_note_end(bytes: &[u8]) -> Result<usize, String> {
    let marker = le_u32(bytes, 0)? as usize;
    if marker == 0 {
        return Ok(4);
    }
    let length = le_u32(bytes, 4)? as usize;
    let end = 8usize.checked_add(length).ok_or("题注长度溢出")?;
    if end > bytes.len() {
        return Err("题注被截断".into());
    }
    Ok(end)
}
fn board_fen(squares: &[u8], side: &str) -> Result<String, String> {
    if squares.len() != 90 {
        return Err("棋盘数据长度错误".into());
    }
    let mut rows = vec![String::new(); 10];
    for row in 0..10 {
        let mut empty = 0;
        for col in 0..9 {
            let value = squares[row * 9 + col];
            let piece = match value {
                0x11 => Some('R'),
                0x12 => Some('N'),
                0x13 => Some('B'),
                0x14 => Some('A'),
                0x15 => Some('K'),
                0x16 => Some('C'),
                0x17 => Some('P'),
                0x21 => Some('r'),
                0x22 => Some('n'),
                0x23 => Some('b'),
                0x24 => Some('a'),
                0x25 => Some('k'),
                0x26 => Some('c'),
                0x27 => Some('p'),
                0 => None,
                _ => return Err("棋盘包含未知棋子".into()),
            };
            if let Some(piece) = piece {
                if empty > 0 {
                    rows[row].push(char::from_digit(empty, 10).unwrap());
                    empty = 0;
                }
                rows[row].push(piece);
            } else {
                empty += 1;
            }
        }
        if empty > 0 {
            rows[row].push(char::from_digit(empty, 10).unwrap());
        }
    }
    Ok(format!("{} {side} - - 0 1", rows.join("/")))
}

fn side_from_cbl_marker(marker: u8) -> Result<&'static str, String> {
    match marker {
        1 => Ok("w"),
        0 => Ok("b"),
        _ => Err("先手标记非法".into()),
    }
}

fn is_standard_starting_fen(fen: &str) -> bool {
    fen.split_whitespace().next() == Some(STANDARD_STARTING_BOARD)
}

fn inferred_category(title: &str) -> &'static str {
    let material = title
        .trim_start_matches(|character: char| {
            matches!(character, '（' | '）' | '(' | ')' | '零' | '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九' | '十' | '、' | '-' | ' ')
        });
    if material.starts_with("双马") || material.starts_with("双炮") {
        "双马双炮类"
    } else if material.starts_with('马') {
        "马类"
    } else if material.starts_with('炮') || material.starts_with("残棋炮") {
        "炮类"
    } else if material.starts_with('兵') || material.starts_with("一兵") || material.starts_with("双兵") || material.starts_with("三兵") {
        "兵类"
    } else if material.starts_with('车') || material.starts_with("双车") {
        "车类"
    } else {
        "综合残局"
    }
}
fn utf16z(bytes: &[u8]) -> String {
    let end = bytes
        .chunks_exact(2)
        .position(|pair| pair == [0, 0])
        .map(|index| index * 2)
        .unwrap_or(bytes.len() & !1);
    String::from_utf16_lossy(
        &bytes[..end]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>(),
    )
    .trim()
    .to_owned()
}
fn le_u32(bytes: &[u8], at: usize) -> Result<u32, String> {
    bytes
        .get(at..at + 4)
        .and_then(|value| value.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or("二进制字段被截断".into())
}
fn find_record(bytes: &[u8], from: usize) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(RECORD_MAGIC.len())
        .position(|value| value == RECORD_MAGIC)
        .map(|index| from + index)
}
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Cursor<'a> {
    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.at)
    }
    fn take(&mut self, size: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(size).ok_or("题解长度溢出")?;
        let value = self.bytes.get(self.at..end).ok_or("题解被截断")?;
        self.at = end;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_cbl_header() {
        assert!(import_cbl_library(b"not a cbl").is_err());
    }
    #[test]
    fn converts_a_cbl_board_to_fen_without_reversing_ranks() {
        let mut squares = [0u8; 90];
        squares[4] = 0x15;
        squares[85] = 0x25;
        assert_eq!(
            board_fen(&squares, "w").unwrap(),
            "4K4/9/9/9/9/9/9/9/9/4k4 w - - 0 1"
        );
    }

    #[test]
    fn decodes_the_single_horse_capture_advisor_position() {
        let mut record = vec![0u8; RECORD_SIZE];
        record[..RECORD_MAGIC.len()].copy_from_slice(RECORD_MAGIC);
        record[MOVE_SIDE_OFFSET] = 1;
        record[2120 + 12] = 0x25;
        record[2120 + 13] = 0x24;
        record[2120 + 14] = 0x12;
        record[2120 + 85] = 0x15;
        record[RECORD_HEADER_SIZE + 4..RECORD_HEADER_SIZE + 8].copy_from_slice(&[0, 0, 14, 31]);

        let problem = parse_record(&record, 48).unwrap();
        assert_eq!(problem.starting_fen, "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1");
        assert_eq!(problem.solution[0].iccs, "f8e6");
    }

    #[test]
    fn rejects_unknown_side_marker() {
        assert!(side_from_cbl_marker(2).is_err());
    }

    #[test]
    fn identifies_standard_opening_records_as_non_endgames() {
        assert!(is_standard_starting_fen(
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
        ));
    }
    #[test]
    fn locally_supplied_cbl_can_be_decoded() {
        let Ok(path) = std::env::var("CBL_SAMPLE") else {
            return;
        };
        let library = import_cbl_library(&std::fs::read(path).unwrap()).unwrap();
        assert!(!library.title.is_empty());
        assert!(library.problems.len() >= 44);
        assert!(library
            .problems
            .iter()
            .all(|problem| !is_standard_starting_fen(&problem.starting_fen)));
        let horse = library
            .problems
            .iter()
            .find(|problem| problem.title.contains("马取单士--着法1"))
            .expect("单马擒单仕题目应被导入");
        assert_eq!(horse.starting_fen, "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1");
        assert_eq!(horse.solution[0].iccs, "f8e6");
        assert_eq!(horse.category, "马类");
    }

    #[test]
    fn locally_supplied_cbl_mainlines_have_chinese_notation() {
        let Ok(path) = std::env::var("CBL_SAMPLE") else {
            return;
        };
        let library = import_cbl_library(&std::fs::read(path).unwrap()).unwrap();
        for problem in library.problems {
            let mut moves = Vec::new();
            let mut branch = problem.solution.first();
            while let Some(move_item) = branch {
                moves.push(move_item.iccs.clone());
                branch = move_item.children.first();
            }
            Board::from_fen(&problem.starting_fen)
                .unwrap()
                .chinese_pv_notation(&moves)
                .unwrap_or_else(|error| panic!("{}: {error}", problem.title));
        }
    }
}
