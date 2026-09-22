use manual_format::{ManualDocument, ManualMetadata};
use serde::Deserialize;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;
use xiangqi_core::{Board, Move, STARTING_FEN};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Branch {
    parent_path: Vec<String>,
    parent_cursor: usize,
    moves: Vec<String>,
    #[serde(default)]
    branch_order: u64,
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Metadata {
    event: String,
    red_player: String,
    black_player: String,
    played_at: String,
    game_type: String,
    result: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Game {
    title: String,
    note: String,
    starting_fen: String,
    moves: Vec<String>,
    branches: Vec<Branch>,
    comments: BTreeMap<String, String>,
    created_at: String,
    #[serde(default)]
    metadata: Metadata,
}

fn document(json: &str) -> Result<ManualDocument, String> {
    let mut game: Game = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let mut doc = ManualDocument::new(&game.starting_fen).map_err(|e| e.to_string())?;
    let black_first = game.starting_fen.split_whitespace().nth(1) == Some("b");
    let result = match game.metadata.result.as_str() {
        "first-win" => {
            if black_first {
                "0-1"
            } else {
                "1-0"
            }
        }
        "first-loss" => {
            if black_first {
                "1-0"
            } else {
                "0-1"
            }
        }
        "draw" => "1/2-1/2",
        _ => "*",
    };
    let kind = match game.metadata.game_type.as_str() {
        "middle" => "中残局",
        "endgame" => "残局",
        _ => "全局",
    };
    let result_label = match game.metadata.result.as_str() {
        "first-win" => "先胜",
        "first-loss" => "先负",
        "draw" => "先和",
        "multiple" => "多种结果",
        _ => "未知",
    };
    doc.metadata = ManualMetadata {
        title: game.title,
        event: game.metadata.event,
        red: game.metadata.red_player,
        black: game.metadata.black_player,
        date: if game.metadata.played_at.is_empty() {
            game.created_at
        } else {
            game.metadata.played_at
        },
        result: result.into(),
        ..Default::default()
    };
    doc.note = format!(
        "棋谱类型：{kind}；棋谱结果：{result_label}（先指初始先行方）\n{}",
        game.note
    );
    if let Some(root_comment) = game.comments.remove("") {
        doc.note.push_str(&format!("\n{root_comment}"));
    }
    let mut nodes = BTreeMap::new();
    nodes.insert(String::new(), doc.tree.root_id());
    game.branches
        .sort_by_key(|b| (b.parent_path.len(), b.branch_order));
    let mut lines = vec![(Vec::new(), game.moves)];
    for b in game.branches {
        if b.parent_cursor != b.parent_path.len() {
            return Err("分支起点与路径不一致".into());
        }
        lines.push((b.parent_path, b.moves));
    }
    for (prefix, suffix) in lines {
        if !nodes.contains_key(&prefix.join(",")) {
            return Err("分支起点无法对应到棋谱".into());
        }
        let line = [prefix, suffix].concat();
        let mut board = Board::from_fen(&game.starting_fen).map_err(|e| e.to_string())?;
        let mut parent = doc.tree.root_id();
        let mut path = Vec::new();
        for token in line {
            let mv = Move::from_iccs(&token).map_err(|e| e.to_string())?;
            board = board
                .apply_move(mv)
                .map_err(|e| format!("着法 {token} 无法导出：{e}"))?;
            path.push(token);
            let key = path.join(",");
            let id = doc
                .tree
                .add_move(parent, mv, game.comments.remove(&key).unwrap_or_default())
                .map_err(|e| e.to_string())?;
            nodes.insert(key, id);
            parent = id;
        }
    }
    if game.comments.values().any(|s| !s.trim().is_empty()) {
        return Err("存在无法对应到着法的注释，无法完整导出".into());
    }
    Ok(doc)
}

pub(crate) fn export(json: &str, format: &str) -> Result<String, String> {
    let doc = document(json)?;
    match format {
        "pgn" => Ok(manual_format::export_pgn(&doc)),
        "dhtmlxq" => manual_format::export_dhtmlxq(&doc).map_err(|e| e.to_string()),
        "chinese" => {
            let mut body = doc.clone();
            body.metadata.title.clear();
            body.metadata.red.clear();
            body.metadata.black.clear();
            body.note.clear();
            let moves = manual_format::export_chinese_text(&body).map_err(|e| e.to_string())?;
            let moves = moves
                .trim_end()
                .strip_suffix(&doc.metadata.result)
                .unwrap_or(&moves)
                .trim();
            let mut rows = vec![doc.metadata.title.clone()];
            for (label, value) in [
                ("赛事", &doc.metadata.event),
                ("红方", &doc.metadata.red),
                ("黑方", &doc.metadata.black),
                ("时间", &doc.metadata.date),
            ] {
                if !value.is_empty() {
                    rows.push(format!("{label}：{value}"));
                }
            }
            rows.push(doc.note.clone());
            if doc.starting_fen != STARTING_FEN {
                rows.push(format!("初始 FEN：{}", doc.starting_fen));
            }
            rows.push(String::new());
            rows.push(if moves.is_empty() {
                "暂无着法".into()
            } else {
                moves.into()
            });
            Ok(rows.join("\n"))
        }
        _ => Err("不支持的分享格式".into()),
    }
}
#[wasm_bindgen(js_name = exportLocalManual)]
pub fn export_local_manual(json: &str, format: &str) -> Result<String, JsValue> {
    export(json, format).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> serde_json::Value {
        serde_json::json!({"title":"佛山\"测试", "note":"备注", "startingFen":STARTING_FEN,"moves":["h2e2","h9g7"],"branches":[{"parentPath":[],"parentCursor":0,"moves":["b2e2"],"branchOrder":0}],"comments":{"h2e2":"中炮注释","b2e2":"变招注释"},"createdAt":"2026-09-22","metadata":{"event":"比赛","redPlayer":"甲","blackPlayer":"乙","result":"first-win","gameType":"full"}})
    }
    #[test]
    fn exports_all_formats_and_roundtrips_tree() {
        let json = fixture().to_string();
        let pgn = export(&json, "pgn").unwrap();
        let original = document(&json).unwrap();
        let restored =
            manual_format::import_document(pgn.as_bytes(), Some(manual_format::ManualFormat::Pgn))
                .unwrap();
        assert_eq!(restored.metadata, original.metadata);
        assert_eq!(restored.starting_fen, original.starting_fen);
        assert_eq!(restored.note, original.note);
        assert_eq!(
            restored
                .tree
                .branches(restored.tree.root_id())
                .unwrap()
                .len(),
            2
        );
        assert!(manual_format::export_pgn(&restored).contains("变招注释"));
        let chinese = export(&json, "chinese").unwrap();
        assert!(chinese.contains("比赛") && chinese.contains("中炮注释"));
        assert!(!chinese.contains("h2e2"));
        let ubb = export(&json, "dhtmlxq").unwrap();
        assert!(ubb.contains("[DhtmlXQ_length]2[/DhtmlXQ_length]"));
    }
    #[test]
    fn rejects_unreachable_branches_and_orphan_comments() {
        let mut game = fixture();
        game["branches"][0]["parentPath"] = serde_json::json!(["a3a4"]);
        game["branches"][0]["parentCursor"] = 1.into();
        assert!(export(&game.to_string(), "pgn").is_err());
        let mut game = fixture();
        game["comments"]["a3a4"] = "orphan".into();
        assert!(export(&game.to_string(), "pgn").is_err());
    }
    #[test]
    fn black_first_and_empty_game() {
        let mut game = fixture();
        game["startingFen"] = STARTING_FEN.replace(" w ", " b ").into();
        game["moves"] = serde_json::json!([]);
        game["branches"] = serde_json::json!([]);
        game["comments"] = serde_json::json!({});
        let pgn = export(&game.to_string(), "pgn").unwrap();
        assert!(pgn.contains("[Result \"0-1\"]"));
        assert!(
            export(&game.to_string(), "chinese")
                .unwrap()
                .contains("初始 FEN")
        );
    }
}
