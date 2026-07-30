use std::collections::BTreeMap;

use serde::Serialize;
use xiangqi_core::{Board, Move};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudBookCandidateDto {
    pub iccs: String,
    pub notation: String,
    pub score: i32,
    pub rank: Option<i32>,
    pub win_rate: Option<f64>,
    pub memo: Option<String>,
    pub source: String,
    pub cached: bool,
}

pub(crate) async fn query(url: &str, fen: &str) -> Result<Vec<CloudBookCandidateDto>, String> {
    let mut endpoint = reqwest::Url::parse(url).map_err(|_| "云库地址格式不正确")?;
    endpoint
        .query_pairs_mut()
        .append_pair("action", "queryall")
        .append_pair("board", fen);
    let response = reqwest::Client::new()
        .get(endpoint)
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .map_err(|error| format!("云库请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("云库请求失败：{error}"))?
        .text()
        .await
        .map_err(|error| format!("读取云库响应失败：{error}"))?;
    parse_response(fen, &response)
}

pub(crate) fn parse_response(
    fen: &str,
    response: &str,
) -> Result<Vec<CloudBookCandidateDto>, String> {
    let board = Board::from_fen(fen).map_err(|error| error.to_string())?;
    let mut deduplicated = BTreeMap::new();
    for row in response.trim_matches(char::from(0)).split('|') {
        let fields = row
            .split(',')
            .filter_map(|part| part.split_once(':'))
            .collect::<BTreeMap<_, _>>();
        let Some(iccs) = fields.get("move").copied() else {
            continue;
        };
        let Ok(mv) = Move::from_iccs(iccs) else {
            continue;
        };
        if !board.legal_moves().contains(&mv) {
            continue;
        }
        let score = fields
            .get("score")
            .and_then(|value| value.parse().ok())
            .unwrap_or_default();
        let rank = fields.get("rank").and_then(|value| value.parse().ok());
        let win_rate = fields.get("winrate").and_then(|value| value.parse().ok());
        deduplicated
            .entry(iccs.to_owned())
            .or_insert_with(|| CloudBookCandidateDto {
                iccs: iccs.to_owned(),
                notation: board
                    .chinese_move_notation(mv)
                    .unwrap_or_else(|_| iccs.to_owned()),
                score,
                rank,
                win_rate,
                memo: fields
                    .get("note")
                    .map(|value| value.trim().to_owned())
                    .filter(|value| !value.is_empty()),
                source: "云库 · ChessDB".into(),
                cached: false,
            });
    }
    let mut candidates: Vec<_> = deduplicated.into_values().collect();
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.iccs.cmp(&right.iccs))
    });
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiangqi_core::STARTING_FEN;

    #[test]
    fn parses_chessdb_rows_and_rejects_illegal_moves() {
        let rows = "move:h2e2,score:1,rank:2,note:!,winrate:50.08|move:a0a9,score:999,rank:9";
        let candidates = parse_response(STARTING_FEN, rows).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].notation, "炮二平五");
        assert_eq!(candidates[0].win_rate, Some(50.08));
    }
}
