use std::collections::BTreeMap;

use encoding_rs::GB18030;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use xiangqi_core::{Board, Color, Move, STARTING_FEN};
use xiangqi_manual::ManualTree;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManualFormat {
    Pgn,
    Xqf,
    Cbr,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualMetadata {
    pub title: String,
    pub event: String,
    pub site: String,
    pub date: String,
    pub red: String,
    pub black: String,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualDocument {
    pub metadata: ManualMetadata,
    pub starting_fen: String,
    pub note: String,
    pub tree: ManualTree,
    pub warnings: Vec<String>,
}

impl ManualDocument {
    pub fn new(starting_fen: impl Into<String>) -> Result<Self, FormatError> {
        let starting_fen = starting_fen.into();
        Board::from_fen(&starting_fen)
            .map_err(|error| FormatError::InvalidFen(error.to_string()))?;
        Ok(Self {
            metadata: ManualMetadata {
                title: "未命名棋谱".into(),
                result: "*".into(),
                ..ManualMetadata::default()
            },
            starting_fen,
            note: String::new(),
            tree: ManualTree::new(),
            warnings: Vec::new(),
        })
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FormatError {
    #[error("unable to decode the chess record")]
    Decode,
    #[error("invalid FEN: {0}")]
    InvalidFen(String),
    #[error("invalid move '{token}' at ply {ply}")]
    InvalidMove { token: String, ply: usize },
    #[error("invalid PGN: {0}")]
    InvalidPgn(String),
    #[error("{0:?} import is unavailable until verified sample files are provided")]
    Unsupported(ManualFormat),
    #[error("export is not supported for {0:?}")]
    UnsupportedExport(ManualFormat),
}

pub fn detect_format(bytes: &[u8], hint: Option<ManualFormat>) -> ManualFormat {
    if let Some(format) = hint {
        return format;
    }
    if bytes.starts_with(b"XQ") {
        return ManualFormat::Xqf;
    }
    if bytes.starts_with(b"CCBridge") || bytes.starts_with(b"CBR") {
        return ManualFormat::Cbr;
    }
    ManualFormat::Pgn
}

pub fn import_document(
    bytes: &[u8],
    hint: Option<ManualFormat>,
) -> Result<ManualDocument, FormatError> {
    match detect_format(bytes, hint) {
        ManualFormat::Pgn => import_pgn(bytes),
        format => Err(FormatError::Unsupported(format)),
    }
}

pub fn export_document(
    document: &ManualDocument,
    format: ManualFormat,
) -> Result<Vec<u8>, FormatError> {
    match format {
        ManualFormat::Pgn => Ok(export_pgn(document).into_bytes()),
        format => Err(FormatError::UnsupportedExport(format)),
    }
}

pub fn import_pgn(bytes: &[u8]) -> Result<ManualDocument, FormatError> {
    let (text, used_legacy_encoding) = decode_text(bytes)?;
    let (tags, movetext) = split_tags_and_movetext(&text)?;
    let starting_fen = tags
        .get("FEN")
        .cloned()
        .unwrap_or_else(|| STARTING_FEN.to_owned());
    let board = Board::from_fen(&starting_fen)
        .map_err(|error| FormatError::InvalidFen(error.to_string()))?;
    let mut document = ManualDocument::new(starting_fen)?;
    document.metadata = ManualMetadata {
        title: tags
            .get("Title")
            .or_else(|| tags.get("Event"))
            .cloned()
            .unwrap_or_else(|| "导入棋谱".into()),
        event: tags.get("Event").cloned().unwrap_or_default(),
        site: tags.get("Site").cloned().unwrap_or_default(),
        date: tags.get("Date").cloned().unwrap_or_default(),
        red: tags.get("Red").cloned().unwrap_or_default(),
        black: tags.get("Black").cloned().unwrap_or_default(),
        result: tags.get("Result").cloned().unwrap_or_else(|| "*".into()),
    };
    if used_legacy_encoding {
        document
            .warnings
            .push("文件使用 GB18030/GBK 编码，已转换为 UTF-8".into());
    }
    parse_movetext(&mut document, board, movetext)?;
    Ok(document)
}

pub fn export_pgn(document: &ManualDocument) -> String {
    let mut output = String::new();
    let metadata = &document.metadata;
    for (name, value) in [
        ("Game", "Chinese Chess"),
        ("Title", metadata.title.as_str()),
        ("Event", metadata.event.as_str()),
        ("Site", metadata.site.as_str()),
        ("Date", metadata.date.as_str()),
        ("Red", metadata.red.as_str()),
        ("Black", metadata.black.as_str()),
        ("Result", nonempty(&metadata.result, "*")),
        ("FEN", document.starting_fen.as_str()),
        ("Format", "ICCS"),
    ] {
        output.push_str(&format!("[{name} \"{}\"]\n", escape_tag(value)));
    }
    output.push('\n');
    if !document.note.trim().is_empty() {
        output.push_str(&format!("{{{}}} ", sanitize_comment(&document.note)));
    }
    if let Ok(board) = Board::from_fen(&document.starting_fen) {
        let fields: Vec<_> = document.starting_fen.split_whitespace().collect();
        let fullmove = fields
            .get(5)
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1);
        let ply =
            (fullmove.saturating_sub(1) * 2) + usize::from(board.side_to_move() == Color::Black);
        emit_position(&mut output, document, &board, document.tree.root_id(), ply);
    }
    output.push_str(nonempty(&metadata.result, "*"));
    output.push('\n');
    output
}

pub fn export_mainline_pgn(document: &ManualDocument) -> Result<String, FormatError> {
    let mut mainline = ManualDocument::new(document.starting_fen.clone())?;
    mainline.metadata = document.metadata.clone();
    mainline.note = document.note.clone();
    let mut source_parent = document.tree.root_id();
    let mut target_parent = mainline.tree.root_id();
    loop {
        let branches = document
            .tree
            .branches(source_parent)
            .map_err(manual_error)?;
        let Some(node) = branches
            .iter()
            .find(|node| node.is_mainline)
            .or_else(|| branches.first())
            .copied()
        else {
            break;
        };
        target_parent = mainline
            .tree
            .add_move(target_parent, node.mv, node.comment.clone())
            .map_err(manual_error)?;
        source_parent = node.id;
    }
    Ok(export_pgn(&mainline))
}

fn decode_text(bytes: &[u8]) -> Result<(String, bool), FormatError> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok((text.to_owned(), false));
    }
    let (text, _, had_errors) = GB18030.decode(bytes);
    if had_errors {
        return Err(FormatError::Decode);
    }
    Ok((text.into_owned(), true))
}

fn split_tags_and_movetext(text: &str) -> Result<(BTreeMap<String, String>, &str), FormatError> {
    let mut tags = BTreeMap::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            offset += line.len();
            continue;
        }
        if !trimmed.starts_with('[') {
            break;
        }
        let end = trimmed
            .rfind(']')
            .ok_or_else(|| FormatError::InvalidPgn("unterminated tag".into()))?;
        let body = &trimmed[1..end];
        let separator = body
            .find(char::is_whitespace)
            .ok_or_else(|| FormatError::InvalidPgn("tag value is missing".into()))?;
        let name = body[..separator].trim();
        let value = body[separator..].trim();
        if !(value.starts_with('"') && value.ends_with('"')) {
            return Err(FormatError::InvalidPgn(format!("invalid {name} tag")));
        }
        tags.insert(name.to_owned(), unescape_tag(&value[1..value.len() - 1]));
        offset += line.len();
    }
    Ok((tags, &text[offset..]))
}

#[derive(Clone)]
struct ParseState {
    board: Board,
    parent_id: Uuid,
    previous: Option<(Board, Uuid)>,
    last_node: Option<Uuid>,
    ply: usize,
}

fn parse_movetext(
    document: &mut ManualDocument,
    board: Board,
    movetext: &str,
) -> Result<(), FormatError> {
    let fields: Vec<_> = document.starting_fen.split_whitespace().collect();
    let fullmove = fields
        .get(5)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1);
    let starting_ply =
        (fullmove.saturating_sub(1) * 2) + usize::from(board.side_to_move() == Color::Black);
    let mut state = ParseState {
        board,
        parent_id: document.tree.root_id(),
        previous: None,
        last_node: None,
        ply: starting_ply,
    };
    let mut stack = Vec::new();
    for token in tokenize(movetext)? {
        match token {
            Token::Comment(comment) => {
                if let Some(node_id) = state.last_node {
                    let previous = document
                        .tree
                        .node(node_id)
                        .map_err(manual_error)?
                        .comment
                        .clone();
                    let comment = join_comments(&previous, &comment);
                    document
                        .tree
                        .update_comment(node_id, comment)
                        .map_err(manual_error)?;
                } else if stack.is_empty() {
                    document.note = join_comments(&document.note, &comment);
                }
            }
            Token::VariationStart => {
                let (board, parent_id) = state.previous.clone().ok_or_else(|| {
                    FormatError::InvalidPgn("variation has no preceding move".into())
                })?;
                stack.push(state.clone());
                state = ParseState {
                    board,
                    parent_id,
                    previous: None,
                    last_node: None,
                    ply: state.ply.saturating_sub(1),
                };
            }
            Token::VariationEnd => {
                state = stack
                    .pop()
                    .ok_or_else(|| FormatError::InvalidPgn("unexpected ')'".into()))?;
            }
            Token::Result(result) if stack.is_empty() => document.metadata.result = result,
            Token::Result(_) => {}
            Token::Move(raw) => {
                let mv = parse_move_token(&state.board, &raw).ok_or_else(|| {
                    FormatError::InvalidMove {
                        token: raw.clone(),
                        ply: state.ply + 1,
                    }
                })?;
                let before_board = state.board.clone();
                let before_parent = state.parent_id;
                let next_board =
                    state
                        .board
                        .apply_move(mv)
                        .map_err(|_| FormatError::InvalidMove {
                            token: raw,
                            ply: state.ply + 1,
                        })?;
                let node_id = document
                    .tree
                    .add_move(state.parent_id, mv, "")
                    .map_err(manual_error)?;
                state.previous = Some((before_board, before_parent));
                state.board = next_board;
                state.parent_id = node_id;
                state.last_node = Some(node_id);
                state.ply += 1;
            }
        }
    }
    if !stack.is_empty() {
        return Err(FormatError::InvalidPgn("unterminated variation".into()));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Token {
    Move(String),
    Comment(String),
    VariationStart,
    VariationEnd,
    Result(String),
}

fn tokenize(text: &str) -> Result<Vec<Token>, FormatError> {
    let chars: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            value if value.is_whitespace() => index += 1,
            '{' => {
                let start = index + 1;
                index = start;
                while index < chars.len() && chars[index] != '}' {
                    index += 1;
                }
                if index == chars.len() {
                    return Err(FormatError::InvalidPgn("unterminated comment".into()));
                }
                tokens.push(Token::Comment(
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .trim()
                        .to_owned(),
                ));
                index += 1;
            }
            ';' => {
                let start = index + 1;
                index = start;
                while index < chars.len() && chars[index] != '\n' {
                    index += 1;
                }
                tokens.push(Token::Comment(
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .trim()
                        .to_owned(),
                ));
            }
            '(' => {
                tokens.push(Token::VariationStart);
                index += 1;
            }
            ')' => {
                tokens.push(Token::VariationEnd);
                index += 1;
            }
            _ => {
                let start = index;
                while index < chars.len()
                    && !chars[index].is_whitespace()
                    && !matches!(chars[index], '{' | '}' | '(' | ')' | ';')
                {
                    index += 1;
                }
                let raw: String = chars[start..index].iter().collect();
                if matches!(raw.as_str(), "*" | "1-0" | "0-1" | "1/2-1/2") {
                    tokens.push(Token::Result(raw));
                } else if let Some(value) = clean_move_token(&raw) {
                    tokens.push(Token::Move(value));
                }
            }
        }
    }
    Ok(tokens)
}

fn clean_move_token(raw: &str) -> Option<String> {
    let mut value = raw.trim();
    if value.starts_with('$') {
        return None;
    }
    let prefix_len = value
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit() || *character == '.')
        .last()
        .map(|(index, character)| index + character.len_utf8())
        .unwrap_or(0);
    if value[..prefix_len].contains('.') {
        value = &value[prefix_len..];
    }
    value = value.trim_matches(|character: char| matches!(character, '!' | '?' | '+' | '#'));
    (!value.is_empty()).then(|| value.to_owned())
}

fn parse_move_token(board: &Board, token: &str) -> Option<Move> {
    let compact = token.to_ascii_lowercase().replace('-', "");
    if compact.len() == 4
        && compact.as_bytes()[0].is_ascii_alphabetic()
        && compact.as_bytes()[1].is_ascii_digit()
        && compact.as_bytes()[2].is_ascii_alphabetic()
        && compact.as_bytes()[3].is_ascii_digit()
    {
        if let Ok(mv) = Move::from_iccs(&compact) {
            if board.apply_move(mv).is_ok() {
                return Some(mv);
            }
        }
    }
    let normalized = normalize_chinese_move(token);
    let matches: Vec<_> = board
        .legal_moves()
        .into_iter()
        .filter(|mv| {
            board
                .chinese_move_notation(*mv)
                .is_ok_and(|notation| normalize_chinese_move(&notation) == normalized)
        })
        .collect();
    (matches.len() == 1).then_some(matches[0])
}

fn normalize_chinese_move(value: &str) -> String {
    value
        .chars()
        .filter_map(|character| match character {
            '車' => Some('车'),
            '俥' => Some('车'),
            '馬' => Some('马'),
            '傌' => Some('马'),
            '砲' => Some('炮'),
            '帥' => Some('帅'),
            '將' => Some('将'),
            '進' => Some('进'),
            '後' => Some('后'),
            '一' => Some('1'),
            '二' => Some('2'),
            '三' => Some('3'),
            '四' => Some('4'),
            '五' => Some('5'),
            '六' => Some('6'),
            '七' => Some('7'),
            '八' => Some('8'),
            '九' => Some('9'),
            value if value.is_whitespace() => None,
            value => Some(value),
        })
        .collect()
}

fn emit_position(
    output: &mut String,
    document: &ManualDocument,
    board: &Board,
    parent_id: Uuid,
    ply: usize,
) {
    let Ok(branches) = document.tree.branches(parent_id) else {
        return;
    };
    let Some(chosen) = branches
        .iter()
        .find(|node| node.is_mainline)
        .or_else(|| branches.first())
        .copied()
    else {
        return;
    };
    emit_branch(output, document, board, parent_id, chosen.id, ply, true);
}

fn emit_branch(
    output: &mut String,
    document: &ManualDocument,
    board: &Board,
    parent_id: Uuid,
    chosen_id: Uuid,
    ply: usize,
    include_siblings: bool,
) {
    let Ok(chosen) = document.tree.node(chosen_id) else {
        return;
    };
    output.push_str(&format_move_number(ply));
    output.push_str(&format_iccs(chosen.mv));
    output.push(' ');
    if !chosen.comment.trim().is_empty() {
        output.push_str(&format!("{{{}}} ", sanitize_comment(&chosen.comment)));
    }
    if include_siblings {
        if let Ok(branches) = document.tree.branches(parent_id) {
            for sibling in branches.into_iter().filter(|node| node.id != chosen_id) {
                output.push('(');
                emit_branch(output, document, board, parent_id, sibling.id, ply, false);
                output.push_str(") ");
            }
        }
    }
    if let Ok(next_board) = board.apply_move(chosen.mv) {
        emit_position(output, document, &next_board, chosen.id, ply + 1);
    }
}

fn format_move_number(ply: usize) -> String {
    let number = ply / 2 + 1;
    if ply % 2 == 0 {
        format!("{number}. ")
    } else {
        format!("{number}... ")
    }
}

fn format_iccs(mv: Move) -> String {
    let value = mv.to_iccs().to_ascii_uppercase();
    format!("{}-{}", &value[..2], &value[2..])
}

fn escape_tag(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn unescape_tag(value: &str) -> String {
    let mut result = String::new();
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            result.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else {
            result.push(character);
        }
    }
    result
}

fn sanitize_comment(value: &str) -> String {
    value.replace(['{', '}'], "").trim().to_owned()
}

fn join_comments(left: &str, right: &str) -> String {
    match (left.trim().is_empty(), right.trim().is_empty()) {
        (true, _) => right.trim().to_owned(),
        (_, true) => left.trim().to_owned(),
        _ => format!("{}\n{}", left.trim(), right.trim()),
    }
}

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn manual_error(error: impl std::fmt::Display) -> FormatError {
    FormatError::InvalidPgn(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_iccs_comments_and_rav_variations() {
        let document = import_pgn(
            br#"[Event "Test"]
[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"]
[Format "ICCS"]

{root} 1. H2-E2 {main} (1. B2-E2 {side}) 1... H9-G7 *
"#,
        )
        .unwrap();
        let root = document.tree.root_id();
        let branches = document.tree.branches(root).unwrap();
        assert_eq!(document.note, "root");
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].mv.to_iccs(), "h2e2");
        assert_eq!(branches[0].comment, "main");
        assert_eq!(branches[1].mv.to_iccs(), "b2e2");
        assert_eq!(branches[1].comment, "side");
        assert_eq!(
            document.tree.branches(branches[0].id).unwrap()[0]
                .mv
                .to_iccs(),
            "h9g7"
        );
    }

    #[test]
    fn imports_chinese_moves_by_matching_legal_notation() {
        let document =
            import_pgn("[Format \"Chinese\"]\n\n1. 炮二平五 马8进7 2. 马二进三 *".as_bytes())
                .unwrap();
        let first = document.tree.branches(document.tree.root_id()).unwrap()[0];
        assert_eq!(first.mv.to_iccs(), "h2e2");
        let second = document.tree.branches(first.id).unwrap()[0];
        assert_eq!(second.mv.to_iccs(), "h9g7");
    }

    #[test]
    fn imports_traditional_piece_aliases_and_movetext_result() {
        let document = import_pgn("1. 炮二平五 傌8進7 2. 傌二進三 1-0".as_bytes()).unwrap();
        assert_eq!(document.metadata.result, "1-0");
        let first = document.tree.branches(document.tree.root_id()).unwrap()[0];
        let second = document.tree.branches(first.id).unwrap()[0];
        let third = document.tree.branches(second.id).unwrap()[0];
        assert_eq!(third.mv.to_iccs(), "h0g2");
        assert!(export_pgn(&document).contains("[Result \"1-0\"]"));
    }

    #[test]
    fn falls_back_to_gb18030_and_warns() {
        let (encoded, _, _) = GB18030.encode("[Format \"Chinese\"]\n\n{𠮷} 1. 炮二平五 *");
        let document = import_pgn(&encoded).unwrap();
        assert_eq!(document.warnings.len(), 1);
        assert_eq!(document.note, "𠮷");
    }

    #[test]
    fn pgn_round_trip_preserves_nested_tree_and_comments() {
        let original =
            import_pgn("{局面} 1. h2e2 {主线} (1. b2e2 {变招}) 1... h9g7 *".as_bytes()).unwrap();
        let exported = export_pgn(&original);
        let restored = import_pgn(exported.as_bytes()).unwrap();
        let branches = restored.tree.branches(restored.tree.root_id()).unwrap();
        assert_eq!(restored.note, "局面");
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].comment, "主线");
        assert_eq!(branches[1].comment, "变招");
    }

    #[test]
    fn mainline_export_omits_sibling_variations() {
        let original = import_pgn("1. h2e2 (1. b2e2) 1... h9g7 *".as_bytes()).unwrap();
        let exported = export_mainline_pgn(&original).unwrap();
        let restored = import_pgn(exported.as_bytes()).unwrap();
        assert_eq!(
            restored
                .tree
                .branches(restored.tree.root_id())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn binary_formats_fail_without_claiming_unverified_compatibility() {
        assert_eq!(
            import_document(b"XQ\x0a", None).unwrap_err(),
            FormatError::Unsupported(ManualFormat::Xqf)
        );
        assert_eq!(
            import_document(b"CBR data", None).unwrap_err(),
            FormatError::Unsupported(ManualFormat::Cbr)
        );
    }
}
