use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Cursor as IoCursor, Read, Seek, SeekFrom};
use xiangqi_core::{Board, Move};
use xiangqi_manual::ManualTree;

use crate::{ManualDocument, ManualMetadata};

const LIBRARY_MAGIC: &[u8; 16] = b"CCBridgeLibrary\0";
const RECORD_MAGIC: &[u8; 16] = b"CCBridge Record\0";
const HEADER_SIZE: usize = 576;
const RECORD_SIZE: usize = 4096;
const RECORD_HEADER_SIZE: usize = 2214;
const MOVE_SIDE_OFFSET: usize = 2116;
const STANDARD_STARTING_BOARD: &str = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR";
pub const CBL_PARSER_VERSION: u32 = 4;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CblGame {
    pub source_index: u32,
    pub record_hash: String,
    pub red_team: String,
    pub black_team: String,
    pub round: String,
    pub time_rule: String,
    pub document: ManualDocument,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CblGameLibrarySummary {
    pub title: String,
    pub declared_count: u32,
    pub game_count: u32,
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

/// Decode a CCBridge CBL library as normal full-game manuals.
pub fn import_cbl_game_library<F>(
    bytes: &[u8],
    mut on_game: F,
) -> Result<CblGameLibrarySummary, String>
where
    F: FnMut(CblGame) -> Result<(), String>,
{
    import_cbl_game_library_reader(&mut IoCursor::new(bytes), None, &mut on_game)
}

pub fn import_cbl_game_library_with_limit<F>(
    bytes: &[u8],
    max_games: Option<usize>,
    mut on_game: F,
) -> Result<CblGameLibrarySummary, String>
where
    F: FnMut(CblGame) -> Result<(), String>,
{
    import_cbl_game_library_reader(&mut IoCursor::new(bytes), max_games, &mut on_game)
}

pub fn import_cbl_game_library_reader<R, F>(
    reader: &mut R,
    max_games: Option<usize>,
    mut on_game: F,
) -> Result<CblGameLibrarySummary, String>
where
    R: Read + Seek,
    F: FnMut(CblGame) -> Result<(), String>,
{
    let file_len = reader
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("读取 CBL 长度失败：{error}"))?;
    if file_len < HEADER_SIZE as u64 {
        return Err("不是受支持的 CCBridge CBL 文件".into());
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("定位 CBL 文件头失败：{error}"))?;
    let mut header = [0u8; HEADER_SIZE];
    reader
        .read_exact(&mut header)
        .map_err(|error| format!("读取 CBL 文件头失败：{error}"))?;
    if &header[..16] != LIBRARY_MAGIC {
        return Err("不是受支持的 CCBridge CBL 文件".into());
    }
    let declared_count = le_u32(&header, 60)?;
    let title = utf16z(&header[64..576]);
    let data_offset = match declared_count {
        0..=128 => 101_952,
        129..=256 => 137_280,
        257..=384 => 151_080,
        385..=512 => 207_936,
        _ => 349_248,
    };
    let mut game_count = 0u32;
    let mut warnings = Vec::new();
    let Some(start) = find_record_in_reader(reader, data_offset as u64, file_len)? else {
        warnings.push("CBL 文件没有棋谱记录".into());
        return Ok(CblGameLibrarySummary {
            title,
            declared_count,
            game_count,
            warnings,
        });
    };
    let trailing = file_len.saturating_sub(start);
    if trailing % RECORD_SIZE as u64 != 0 {
        warnings.push("CBL 记录区尾部不完整，已忽略截断数据".into());
    }
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| format!("定位 CBL 记录区失败：{error}"))?;
    let slots = trailing / RECORD_SIZE as u64;
    let mut record = [0u8; RECORD_SIZE];
    for index in 0..slots {
        reader
            .read_exact(&mut record)
            .map_err(|error| format!("读取第 {} 条 CBL 记录失败：{error}", index + 1))?;
        if &record[..16] != RECORD_MAGIC {
            continue;
        }
        match parse_game_record(&record, index as u32) {
            Ok(game) => {
                warnings.extend(
                    game.warnings
                        .iter()
                        .map(|warning| format!("第 {} 条记录：{warning}", index + 1)),
                );
                on_game(game)?;
                game_count += 1;
                if max_games.is_some_and(|limit| game_count as usize >= limit) {
                    break;
                }
            }
            Err(error) => warnings.push(format!("第 {} 条记录已跳过：{error}", index + 1)),
        }
    }
    Ok(CblGameLibrarySummary {
        title,
        declared_count,
        game_count,
        warnings,
    })
}

fn find_record_in_reader<R: Read + Seek>(
    reader: &mut R,
    from: u64,
    file_len: u64,
) -> Result<Option<u64>, String> {
    if from >= file_len {
        return Ok(None);
    }
    const CHUNK_SIZE: usize = 64 * 1024;
    let mut buffer = vec![0u8; CHUNK_SIZE + RECORD_MAGIC.len() - 1];
    let mut position = from;
    let mut carry = 0usize;
    reader
        .seek(SeekFrom::Start(from))
        .map_err(|error| format!("定位 CBL 记录区失败：{error}"))?;
    while position < file_len {
        let read = reader
            .read(&mut buffer[carry..])
            .map_err(|error| format!("扫描 CBL 记录区失败：{error}"))?;
        if read == 0 {
            break;
        }
        let available = carry + read;
        if let Some(index) = buffer[..available]
            .windows(RECORD_MAGIC.len())
            .position(|value| value == RECORD_MAGIC)
        {
            return Ok(Some(position.saturating_sub(carry as u64) + index as u64));
        }
        carry = (RECORD_MAGIC.len() - 1).min(available);
        buffer.copy_within(available - carry..available, 0);
        position += read as u64;
    }
    Ok(None)
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

fn parse_game_record(record: &[u8], source_index: u32) -> Result<CblGame, String> {
    if record.len() != RECORD_SIZE || &record[..16] != RECORD_MAGIC {
        return Err("无效记录头".into());
    }
    let title = utf16z(&record[180..308]);
    let category = utf16z(&record[692..756]);
    let round = utf16z(&record[756..820]);
    let date = utf16z(&record[884..948]);
    let site = utf16z(&record[948..1012]);
    let time_rule = utf16z(&record[1012..1076]);
    let red_name = utf16z(&record[1076..1140]);
    let red_team = utf16z(&record[1140..1204]);
    let black_name = utf16z(&record[1300..1364]);
    let black_team = utf16z(&record[1364..1428]);
    let side = side_from_cbl_marker(record[MOVE_SIDE_OFFSET])?;
    let fen = board_fen(&record[2120..2210], side)?;
    let board = Board::from_fen(&fen).map_err(|error| format!("初始局面非法：{error}"))?;
    let mut cursor = Cursor {
        bytes: &record[RECORD_HEADER_SIZE..],
        at: initial_note_end(&record[RECORD_HEADER_SIZE..])?,
    };
    let (moves, warnings) = match parse_steps(&mut cursor, board.clone()) {
        Ok(moves) => (moves, Vec::new()),
        Err(error) => {
            cursor.at = initial_note_end(&record[RECORD_HEADER_SIZE..])?;
            let (moves, partial_error) = parse_steps_lossy(&mut cursor, board.clone());
            if moves.is_empty() {
                return Err(error);
            }
            (
                moves,
                vec![format!(
                    "棋谱尾部不完整，已保留可验证着法：{}",
                    partial_error.unwrap_or(error)
                )],
            )
        }
    };
    if moves.is_empty() {
        return Err("没有可导入的棋谱着法".into());
    }
    let mut document = ManualDocument::new(fen).map_err(|error| error.to_string())?;
    document.metadata = metadata_from_game_record(
        source_index,
        &title,
        &category,
        &site,
        &date,
        &red_name,
        &black_name,
    );
    document.note = read_initial_note(&record[RECORD_HEADER_SIZE..])?;
    let root_id = document.tree.root_id();
    append_cbl_moves(&mut document.tree, root_id, &board, &moves)?;
    Ok(CblGame {
        source_index,
        record_hash: format!("{:x}", Sha256::digest(record)),
        red_team,
        black_team,
        round,
        time_rule,
        document,
        warnings,
    })
}

fn append_cbl_moves(
    tree: &mut ManualTree,
    parent_id: uuid::Uuid,
    board: &Board,
    moves: &[CblMove],
) -> Result<(), String> {
    for item in moves {
        let mv = Move::from_iccs(&item.iccs).map_err(|error| error.to_string())?;
        let next_board = board
            .apply_move(mv)
            .map_err(|_| format!("非法棋谱着法 {}", item.iccs))?;
        let node_id = tree
            .add_move(parent_id, mv, item.comment.clone())
            .map_err(|error| error.to_string())?;
        append_cbl_moves(tree, node_id, &next_board, &item.children)?;
    }
    Ok(())
}

fn metadata_from_game_record(
    source_index: u32,
    title: &str,
    category: &str,
    site: &str,
    date: &str,
    red_name: &str,
    black_name: &str,
) -> ManualMetadata {
    let title = if title.trim().is_empty() {
        format!("CBL 棋谱 {}", source_index + 1)
    } else {
        title.trim().to_owned()
    };
    let (title_red, title_black, result) = players_and_result_from_title(&title);
    let red = if red_name.trim().is_empty() {
        title_red
    } else {
        red_name.trim().to_owned()
    };
    let black = if black_name.trim().is_empty() {
        title_black
    } else {
        black_name.trim().to_owned()
    };
    ManualMetadata {
        title,
        event: category.trim().to_owned(),
        site: site.trim().to_owned(),
        date: clean_cbl_date(date),
        red,
        black,
        result,
    }
}

fn players_and_result_from_title(title: &str) -> (String, String, String) {
    let parts = title.split_whitespace().collect::<Vec<_>>();
    let Some((index, result)) = parts.iter().enumerate().find_map(|(index, value)| {
        let result = match *value {
            "胜" | "红胜" => "1-0",
            "负" | "黑胜" => "0-1",
            "和" | "和棋" => "1/2-1/2",
            _ => return None,
        };
        Some((index, result.to_owned()))
    }) else {
        return (String::new(), String::new(), "*".into());
    };
    let red = parts[..index]
        .last()
        .copied()
        .unwrap_or_default()
        .to_owned();
    let black = parts[index + 1..]
        .last()
        .copied()
        .unwrap_or_default()
        .to_owned();
    (red, black, result)
}

fn clean_cbl_date(value: &str) -> String {
    let date = value.trim();
    if date.is_empty() || date == "0000-00-00" {
        String::new()
    } else {
        date.to_owned()
    }
}

fn parse_steps(cursor: &mut Cursor<'_>, board: Board) -> Result<Vec<CblMove>, String> {
    if cursor.remaining() < 4 {
        return if cursor.remaining() == 0 {
            Ok(Vec::new())
        } else {
            Err("题解被截断".into())
        };
    }
    let step = cursor.take(4)?;
    if step == [0, 0, 0, 0] {
        return Ok(Vec::new());
    }
    let mark = step[0];
    let comment = if mark & 4 != 0 {
        let comment_length =
            usize::try_from(le_u32(cursor.bytes, cursor.at)?).map_err(|_| "题解注释长度非法")?;
        let total_length = comment_length.checked_add(4).ok_or("题解注释长度溢出")?;
        utf16z(cursor.take(total_length)?.get(4..).unwrap_or_default())
    } else {
        String::new()
    };
    let from = Move::from_iccs(&format!("{}{}", cbl_square(step[2])?, cbl_square(step[3])?))
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

fn parse_steps_lossy(cursor: &mut Cursor<'_>, board: Board) -> (Vec<CblMove>, Option<String>) {
    if cursor.remaining() < 4 {
        return (
            Vec::new(),
            (cursor.remaining() != 0).then(|| "题解被截断".into()),
        );
    }
    let step = match cursor.take(4) {
        Ok(step) => step,
        Err(error) => return (Vec::new(), Some(error)),
    };
    if step == [0, 0, 0, 0] {
        return (Vec::new(), None);
    }
    let mark = step[0];
    let comment = if mark & 4 != 0 {
        let comment_length = match le_u32(cursor.bytes, cursor.at)
            .and_then(|value| usize::try_from(value).map_err(|_| "题解注释长度非法".into()))
        {
            Ok(length) => length,
            Err(error) => return (Vec::new(), Some(error)),
        };
        let Some(total_length) = comment_length.checked_add(4) else {
            return (Vec::new(), Some("题解注释长度溢出".into()));
        };
        match cursor.take(total_length) {
            Ok(value) => utf16z(value.get(4..).unwrap_or_default()),
            Err(error) => return (Vec::new(), Some(error)),
        }
    } else {
        String::new()
    };
    let mv = match cbl_square(step[2])
        .and_then(|from| cbl_square(step[3]).map(|to| format!("{from}{to}")))
        .and_then(|value| Move::from_iccs(&value).map_err(|_| "走子坐标非法".into()))
    {
        Ok(mv) => mv,
        Err(error) => return (Vec::new(), Some(error)),
    };
    let iccs = mv.to_iccs();
    let next_board = match board.apply_move(mv) {
        Ok(next) => next,
        Err(_) => return (Vec::new(), Some(format!("非法题解着法 {iccs}"))),
    };
    let (children, mut warning) = if mark & 1 == 0 {
        parse_steps_lossy(cursor, next_board)
    } else {
        (Vec::new(), None)
    };
    let mut moves = vec![CblMove {
        iccs,
        comment,
        children,
    }];
    if warning.is_none() && mark & 2 != 0 {
        let (siblings, sibling_warning) = parse_steps_lossy(cursor, board);
        moves.extend(siblings);
        warning = sibling_warning;
    }
    (moves, warning)
}

fn cbl_square(index: u8) -> Result<String, String> {
    if index >= 90 {
        return Err("走子坐标非法".into());
    }
    Ok(format!("{}{}", (b'a' + index % 9) as char, 9 - index / 9))
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
    let material = title.trim_start_matches(|character: char| {
        matches!(
            character,
            '（' | '）'
                | '('
                | ')'
                | '零'
                | '一'
                | '二'
                | '三'
                | '四'
                | '五'
                | '六'
                | '七'
                | '八'
                | '九'
                | '十'
                | '、'
                | '-'
                | ' '
        )
    });
    if material.starts_with("双马") || material.starts_with("双炮") {
        "双马双炮类"
    } else if material.starts_with('马') {
        "马类"
    } else if material.starts_with('炮') || material.starts_with("残棋炮") {
        "炮类"
    } else if material.starts_with('兵')
        || material.starts_with("一兵")
        || material.starts_with("双兵")
        || material.starts_with("三兵")
    {
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
    use std::io::Cursor as IoCursor;

    fn write_utf16z(target: &mut [u8], value: &str) {
        for (index, unit) in value.encode_utf16().enumerate() {
            let at = index * 2;
            if at + 2 > target.len() {
                break;
            }
            target[at..at + 2].copy_from_slice(&unit.to_le_bytes());
        }
    }

    fn streaming_game_fixture() -> Vec<u8> {
        let mut bytes = vec![0u8; 101_952 + RECORD_SIZE];
        bytes[..LIBRARY_MAGIC.len()].copy_from_slice(LIBRARY_MAGIC);
        bytes[60..64].copy_from_slice(&1u32.to_le_bytes());
        write_utf16z(&mut bytes[64..576], "测试实战库");
        let record = &mut bytes[101_952..];
        record[..RECORD_MAGIC.len()].copy_from_slice(RECORD_MAGIC);
        write_utf16z(&mut record[180..308], "广东 陈松顺 胜 江苏 惠颂祥");
        write_utf16z(&mut record[692..756], "测试赛事");
        write_utf16z(&mut record[756..820], "第03轮");
        write_utf16z(&mut record[884..948], "2026-09-08");
        write_utf16z(&mut record[948..1012], "广州");
        write_utf16z(&mut record[1012..1076], "20分+5秒");
        write_utf16z(&mut record[1076..1140], "陈松顺");
        write_utf16z(&mut record[1140..1204], "广东");
        write_utf16z(&mut record[1300..1364], "惠颂祥");
        write_utf16z(&mut record[1364..1428], "江苏");
        record[MOVE_SIDE_OFFSET] = 1;
        let board = &mut record[2120..2210];
        board[..9].copy_from_slice(&[0x21, 0x22, 0x23, 0x24, 0x25, 0x24, 0x23, 0x22, 0x21]);
        board[2 * 9 + 1] = 0x26;
        board[2 * 9 + 7] = 0x26;
        for col in [0, 2, 4, 6, 8] {
            board[3 * 9 + col] = 0x27;
        }
        for col in [0, 2, 4, 6, 8] {
            board[6 * 9 + col] = 0x17;
        }
        board[7 * 9 + 1] = 0x16;
        board[7 * 9 + 7] = 0x16;
        board[9 * 9..].copy_from_slice(&[0x11, 0x12, 0x13, 0x14, 0x15, 0x14, 0x13, 0x12, 0x11]);
        record[RECORD_HEADER_SIZE + 4..RECORD_HEADER_SIZE + 8].copy_from_slice(&[1, 0, 70, 67]);
        bytes
    }

    #[test]
    fn streams_game_records_and_preserves_extended_metadata() {
        let mut games = Vec::new();
        let summary = import_cbl_game_library_reader(
            &mut IoCursor::new(streaming_game_fixture()),
            None,
            |game| {
                games.push(game);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(summary.title, "测试实战库");
        assert_eq!(summary.game_count, 1);
        let game = &games[0];
        assert_eq!(game.document.metadata.red, "陈松顺");
        assert_eq!(game.document.metadata.black, "惠颂祥");
        assert_eq!(game.red_team, "广东");
        assert_eq!(game.black_team, "江苏");
        assert_eq!(game.round, "第03轮");
        assert_eq!(game.time_rule, "20分+5秒");
        assert_eq!(game.record_hash.len(), 64);
    }

    #[test]
    fn streaming_empty_library_is_a_successful_empty_batch() {
        let mut bytes = vec![0u8; 101_952];
        bytes[..LIBRARY_MAGIC.len()].copy_from_slice(LIBRARY_MAGIC);
        bytes[60..64].copy_from_slice(&128u32.to_le_bytes());
        let summary = import_cbl_game_library_reader(&mut IoCursor::new(bytes), None, |_| {
            panic!("empty library must not yield games")
        })
        .unwrap();
        assert_eq!(summary.game_count, 0);
        assert_eq!(summary.warnings, vec!["CBL 文件没有棋谱记录"]);
    }
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
    fn preserves_a_valid_position_when_the_cbl_record_has_no_saved_solution() {
        let mut record = vec![0u8; RECORD_SIZE];
        record[..RECORD_MAGIC.len()].copy_from_slice(RECORD_MAGIC);
        record[MOVE_SIDE_OFFSET] = 1;
        record[2120 + 12] = 0x25;
        record[2120 + 13] = 0x24;
        record[2120 + 14] = 0x12;
        record[2120 + 85] = 0x15;

        let problem = parse_record(&record, 0).unwrap();

        assert_eq!(problem.title, "残局题 1");
        assert!(problem.solution.is_empty());
    }

    #[test]
    fn rejects_unknown_side_marker() {
        assert!(side_from_cbl_marker(2).is_err());
    }

    #[test]
    fn rejects_invalid_move_coordinates_without_panicking() {
        let board = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut cursor = Cursor {
            bytes: &[0, 0, 90, 0],
            at: 0,
        };
        assert_eq!(parse_steps(&mut cursor, board).unwrap_err(), "走子坐标非法");
    }

    #[test]
    fn strict_step_parser_rejects_a_truncated_tail() {
        let board = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut cursor = Cursor {
            bytes: &[1, 2, 3],
            at: 0,
        };
        assert_eq!(parse_steps(&mut cursor, board).unwrap_err(), "题解被截断");
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
        assert!(
            library
                .problems
                .iter()
                .all(|problem| !is_standard_starting_fen(&problem.starting_fen))
        );
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

    #[test]
    fn locally_supplied_cbl_game_library_can_be_decoded() {
        let Ok(path) = std::env::var("CBL_GAME_SAMPLE") else {
            return;
        };
        let bytes = std::fs::read(path).unwrap();
        let mut first = None;
        let summary = import_cbl_game_library_with_limit(&bytes, Some(8), |game| {
            if first.is_none() {
                first = Some(game.document.clone());
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(summary.title, "东萍大师棋谱");
        assert_eq!(summary.game_count, 8);
        let first = first.expect("东萍大师棋谱应至少导入一盘");
        assert_eq!(first.metadata.title, "广东 陈松顺 胜 江苏 惠颂祥");
        assert_eq!(first.metadata.event, "近代名家对局");
        assert_eq!(first.metadata.red, "陈松顺");
        assert_eq!(first.metadata.black, "惠颂祥");
        assert_eq!(first.metadata.result, "1-0");
        assert!(
            !first
                .tree
                .branches(first.tree.root_id())
                .unwrap()
                .is_empty()
        );
    }
}
