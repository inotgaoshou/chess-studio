use std::collections::BTreeMap;

use serde::Deserialize;
use xiangqi_core::{Board, Move, STARTING_FEN};

use crate::{GameReportPositionDto, OpeningBookHitDto};

const BOOK_JSON: &str = include_str!("../resources/openings/xiangqi-openings-v1.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpeningBookData {
    version: String,
    license: String,
    sources: Vec<String>,
    categories: Vec<OpeningCategory>,
}

#[derive(Deserialize)]
struct OpeningCategory {
    code: String,
    name: String,
    lines: Vec<OpeningLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpeningLine {
    name: Option<String>,
    moves: Vec<String>,
}

fn board_key(board: &Board) -> String {
    board
        .to_fen()
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}

fn standard_key() -> Option<String> {
    Board::from_fen(STARTING_FEN)
        .ok()
        .map(|board| board_key(&board))
}

fn source_label(book: &OpeningBookData) -> String {
    let first = book
        .sources
        .first()
        .cloned()
        .unwrap_or_else(|| "内置开局库".to_owned());
    format!("{} · {} · {}", book.version, book.license, first)
}

fn insert_hit(
    hits: &mut BTreeMap<(String, String), OpeningBookHitDto>,
    board: &Board,
    code: &str,
    name: String,
    iccs: &str,
    ply: usize,
    source: &str,
) {
    let key = (board_key(board), iccs.to_owned());
    let hit = OpeningBookHitDto {
        code: code.to_owned(),
        name,
        ply,
        source: source.to_owned(),
    };
    hits.entry(key)
        .and_modify(|current| {
            if hit.ply > current.ply || (hit.ply == current.ply && hit.code < current.code) {
                *current = hit.clone();
            }
        })
        .or_insert(hit);
}

fn build_hits() -> Result<BTreeMap<(String, String), OpeningBookHitDto>, String> {
    let book: OpeningBookData =
        serde_json::from_str(BOOK_JSON).map_err(|error| error.to_string())?;
    validate_book_shape(&book)?;
    let source = source_label(&book);
    let root = Board::from_fen(STARTING_FEN).map_err(|error| error.to_string())?;
    let mut hits = BTreeMap::new();
    for category in &book.categories {
        for (line_index, line) in category.lines.iter().enumerate() {
            let mut board = root.clone();
            let line_name = line.name.clone().unwrap_or_else(|| category.name.clone());
            for (ply_index, iccs) in line.moves.iter().enumerate() {
                let mv = Move::from_iccs(iccs).map_err(|error| error.to_string())?;
                let code = if line.moves.len() == 1 {
                    category.code.clone()
                } else {
                    format!("{}-{:03}", category.code, line_index + 1)
                };
                insert_hit(
                    &mut hits,
                    &board,
                    &code,
                    line_name.clone(),
                    iccs,
                    ply_index + 1,
                    &source,
                );
                board = board.apply_move(mv).map_err(|error| {
                    format!(
                        "开局库线路 {} 第{}着 {} 不合法：{}",
                        category.code,
                        ply_index + 1,
                        iccs,
                        error
                    )
                })?;
            }
        }
    }
    Ok(hits)
}

fn validate_book_shape(book: &OpeningBookData) -> Result<(), String> {
    if book.categories.len() < 30 {
        return Err(format!("开局库分类不足：{}", book.categories.len()));
    }
    let line_count: usize = book
        .categories
        .iter()
        .map(|category| category.lines.len())
        .sum();
    if line_count < 100 {
        return Err(format!("开局库线路不足：{line_count}"));
    }
    for category in &book.categories {
        if category.code.trim().is_empty() || category.name.trim().is_empty() {
            return Err("开局库分类编号和名称不能为空".into());
        }
        if category.lines.is_empty() {
            return Err(format!("开局库分类 {} 没有线路", category.code));
        }
        for (line_index, line) in category.lines.iter().enumerate() {
            if line.moves.is_empty() {
                return Err(format!(
                    "开局库线路 {}:{} 为空",
                    category.code,
                    line_index + 1
                ));
            }
            for iccs in &line.moves {
                Move::from_iccs(iccs).map_err(|error| {
                    format!(
                        "开局库线路 {}:{} 着法 {} 无效：{}",
                        category.code,
                        line_index + 1,
                        iccs,
                        error
                    )
                })?;
            }
        }
    }
    Ok(())
}

pub(crate) fn annotate_positions(
    starting_fen: &str,
    positions: &mut [GameReportPositionDto],
) -> Result<usize, String> {
    let start = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    if Some(board_key(&start)) != standard_key() {
        for position in positions {
            position.opening = None;
        }
        return Ok(0);
    }
    let hits = build_hits()?;
    let mut count = 0;
    for index in 1..positions.len() {
        let Some(move_) = &positions[index].move_ else {
            continue;
        };
        if move_.iccs.is_empty() {
            continue;
        }
        let Ok(before) = Board::from_fen(&positions[index - 1].fen) else {
            continue;
        };
        positions[index].opening = hits.get(&(board_key(&before), move_.iccs.clone())).cloned();
        if positions[index].opening.is_some() {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_book_expands_to_at_least_thirty_categories_and_one_hundred_legal_lines() {
        let book: OpeningBookData = serde_json::from_str(BOOK_JSON).unwrap();
        validate_book_shape(&book).unwrap();
        let lines: usize = book
            .categories
            .iter()
            .map(|category| category.lines.len())
            .sum();
        assert!(book.categories.len() >= 30);
        assert!(lines >= 100);
        let hits = build_hits().unwrap();
        assert!(hits.len() >= 100);
    }

    #[test]
    fn annotates_official_moves_from_standard_position() {
        let root = Board::from_fen(STARTING_FEN).unwrap();
        let after = root.apply_iccs("h2e2").unwrap();
        let after_black = after.apply_iccs("h9g7").unwrap();
        let mut positions = vec![
            GameReportPositionDto {
                fen: root.to_fen(),
                side_to_move: "红方".into(),
                ply: 1,
                phase: "opening".into(),
                material: 5660,
                score_cp: None,
                mate: None,
                depth: None,
                elapsed_ms: None,
                cached: false,
                best_iccs: None,
                best_notation: None,
                pv_notation: Vec::new(),
                opening: None,
                master_style_hints: Vec::new(),
                move_: None,
            },
            GameReportPositionDto {
                fen: after.to_fen(),
                side_to_move: "黑方".into(),
                ply: 2,
                phase: "opening".into(),
                material: 5660,
                score_cp: None,
                mate: None,
                depth: None,
                elapsed_ms: None,
                cached: false,
                best_iccs: None,
                best_notation: None,
                pv_notation: Vec::new(),
                opening: None,
                master_style_hints: Vec::new(),
                move_: Some(crate::GameReportMoveDto {
                    node_id: uuid::Uuid::new_v4(),
                    iccs: "h2e2".into(),
                    notation: "炮二平五".into(),
                    moved_by: "红方".into(),
                }),
            },
            GameReportPositionDto {
                fen: after_black.to_fen(),
                side_to_move: "红方".into(),
                ply: 3,
                phase: "opening".into(),
                material: 5660,
                score_cp: None,
                mate: None,
                depth: None,
                elapsed_ms: None,
                cached: false,
                best_iccs: None,
                best_notation: None,
                pv_notation: Vec::new(),
                opening: None,
                master_style_hints: Vec::new(),
                move_: Some(crate::GameReportMoveDto {
                    node_id: uuid::Uuid::new_v4(),
                    iccs: "h9g7".into(),
                    notation: "马8进7".into(),
                    moved_by: "黑方".into(),
                }),
            },
        ];
        assert_eq!(annotate_positions(STARTING_FEN, &mut positions).unwrap(), 2);
        assert_eq!(positions[1].opening.as_ref().unwrap().name, "中炮对屏风马");
        assert_eq!(positions[2].opening.as_ref().unwrap().name, "中炮对屏风马");
    }

    #[test]
    fn custom_starting_positions_do_not_match_the_opening_book() {
        let custom = "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1";
        let mut positions = Vec::new();
        assert_eq!(annotate_positions(custom, &mut positions).unwrap(), 0);
    }
}
