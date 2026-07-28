use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wasm_bindgen::prelude::*;
use xiangqi_core::{Board, Color, GameStatus, Move, PieceKind, STARTING_FEN, Square};
use xiangqi_manual::{ManualTree, MoveNode};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddMovePayload {
    node_id: Uuid,
    parent_id: Uuid,
    #[serde(rename = "move")]
    move_iccs: String,
    #[serde(default)]
    order_key: u64,
    #[serde(default)]
    is_mainline: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCommentPayload {
    node_id: Uuid,
    comment: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetMainlinePayload {
    parent_id: Uuid,
    node_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteNodePayload {
    node_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PieceDto {
    row: u8,
    col: u8,
    color: &'static str,
    kind: &'static str,
    label: &'static str,
}

#[derive(Debug, Serialize)]
struct SquareDto {
    row: u8,
    col: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveDto {
    id: Uuid,
    iccs: String,
    notation: String,
    moved_by: &'static str,
    from: SquareDto,
    to: SquareDto,
    score_cp: Option<i32>,
    mate: Option<i32>,
    comment: String,
    is_mainline: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardDto {
    fen: String,
    side_to_move: &'static str,
    status: &'static str,
    pieces: Vec<PieceDto>,
    history: Vec<MoveDto>,
    branches: Vec<MoveDto>,
    current_node: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebGameSnapshot {
    starting_fen: String,
    tree: ManualTree,
    current_node: Option<Uuid>,
}

#[wasm_bindgen]
pub struct WebGame {
    board: Board,
    starting_fen: String,
    tree: ManualTree,
    current_node: Option<Uuid>,
}

#[wasm_bindgen]
impl WebGame {
    #[wasm_bindgen(constructor)]
    pub fn new(fen: Option<String>) -> Result<WebGame, JsValue> {
        let starting_fen = fen.unwrap_or_else(|| STARTING_FEN.to_owned());
        let board = Board::from_fen(&starting_fen).map_err(js_error)?;
        Ok(Self {
            board,
            starting_fen,
            tree: ManualTree::new(),
            current_node: None,
        })
    }

    #[wasm_bindgen(js_name = fromRemote)]
    pub fn from_remote(fen: String, root_id: &str) -> Result<WebGame, JsValue> {
        let board = Board::from_fen(&fen).map_err(js_error)?;
        Ok(Self {
            board,
            starting_fen: fen,
            tree: ManualTree::with_root(parse_uuid(root_id)?),
            current_node: None,
        })
    }

    #[wasm_bindgen(js_name = importJson)]
    pub fn import_json(value: &str) -> Result<WebGame, JsValue> {
        let snapshot: WebGameSnapshot = serde_json::from_str(value).map_err(js_error)?;
        let board = board_at(
            &snapshot.starting_fen,
            &snapshot.tree,
            snapshot.current_node,
        )
        .map_err(js_error)?;
        Ok(Self {
            board,
            starting_fen: snapshot.starting_fen,
            tree: snapshot.tree,
            current_node: snapshot.current_node,
        })
    }

    #[wasm_bindgen(js_name = stateJson)]
    pub fn state_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&board_dto(self).map_err(js_error)?).map_err(js_error)
    }

    #[wasm_bindgen(js_name = exportJson)]
    pub fn export_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&WebGameSnapshot {
            starting_fen: self.starting_fen.clone(),
            tree: self.tree.clone(),
            current_node: self.current_node,
        })
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = rootId)]
    pub fn root_id(&self) -> String {
        self.tree.root_id().to_string()
    }

    #[wasm_bindgen(js_name = playMove)]
    pub fn play_move(&mut self, iccs: &str) -> Result<String, JsValue> {
        let mv = Move::from_iccs(iccs).map_err(js_error)?;
        let next = self.board.apply_move(mv).map_err(js_error)?;
        let parent = self.current_node.unwrap_or_else(|| self.tree.root_id());
        let node_id = self.tree.add_move(parent, mv, "").map_err(js_error)?;
        self.board = next;
        self.current_node = Some(node_id);
        self.state_json()
    }

    #[wasm_bindgen(js_name = navigateTo)]
    pub fn navigate_to(&mut self, node_id: Option<String>) -> Result<String, JsValue> {
        let node_id = node_id.as_deref().map(parse_uuid).transpose()?;
        self.board = board_at(&self.starting_fen, &self.tree, node_id).map_err(js_error)?;
        self.current_node = node_id;
        self.state_json()
    }

    #[wasm_bindgen(js_name = updateComment)]
    pub fn update_comment(&mut self, node_id: &str, comment: String) -> Result<String, JsValue> {
        self.tree
            .update_comment(parse_uuid(node_id)?, comment)
            .map_err(js_error)?;
        self.state_json()
    }

    #[wasm_bindgen(js_name = setMainline)]
    pub fn set_mainline(&mut self, node_id: &str) -> Result<String, JsValue> {
        let node_id = parse_uuid(node_id)?;
        let parent_id = self.tree.node(node_id).map_err(js_error)?.parent_id;
        self.tree
            .set_mainline(parent_id, node_id)
            .map_err(js_error)?;
        self.state_json()
    }

    #[wasm_bindgen(js_name = deleteNode)]
    pub fn delete_node(&mut self, node_id: &str) -> Result<String, JsValue> {
        let node_id = parse_uuid(node_id)?;
        let parent_id = self.tree.node(node_id).map_err(js_error)?.parent_id;
        let affects_current = self
            .current_node
            .and_then(|current| self.tree.active_line(current).ok())
            .is_some_and(|line| line.iter().any(|node| node.id == node_id));
        self.tree.remove(node_id).map_err(js_error)?;
        if affects_current {
            self.current_node = (parent_id != self.tree.root_id()).then_some(parent_id);
            self.board =
                board_at(&self.starting_fen, &self.tree, self.current_node).map_err(js_error)?;
        }
        self.state_json()
    }

    #[wasm_bindgen(js_name = applyOperation)]
    pub fn apply_operation(&mut self, kind: &str, payload_json: &str) -> Result<String, JsValue> {
        match kind {
            "create_game" => {}
            "add_move" => {
                let payload: AddMovePayload =
                    serde_json::from_str(payload_json).map_err(js_error)?;
                if self.tree.node(payload.node_id).is_err() {
                    self.tree
                        .restore_node(MoveNode {
                            id: payload.node_id,
                            parent_id: payload.parent_id,
                            mv: Move::from_iccs(&payload.move_iccs).map_err(js_error)?,
                            comment: String::new(),
                            is_mainline: payload.is_mainline,
                            deleted: false,
                            order_key: payload.order_key,
                        })
                        .map_err(js_error)?;
                }
            }
            "update_comment" => {
                let payload: UpdateCommentPayload =
                    serde_json::from_str(payload_json).map_err(js_error)?;
                self.tree
                    .update_comment(payload.node_id, payload.comment)
                    .map_err(js_error)?;
            }
            "set_mainline" => {
                let payload: SetMainlinePayload =
                    serde_json::from_str(payload_json).map_err(js_error)?;
                self.tree
                    .set_mainline(payload.parent_id, payload.node_id)
                    .map_err(js_error)?;
            }
            "delete_node" => {
                let payload: DeleteNodePayload =
                    serde_json::from_str(payload_json).map_err(js_error)?;
                self.tree.remove(payload.node_id).map_err(js_error)?;
                if self.current_node == Some(payload.node_id) {
                    self.current_node = None;
                    self.board = Board::from_fen(&self.starting_fen).map_err(js_error)?;
                }
            }
            _ => return Err(js_error(format!("unsupported operation kind: {kind}"))),
        }
        self.state_json()
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, JsValue> {
    Uuid::parse_str(&value).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn board_at(starting_fen: &str, tree: &ManualTree, node_id: Option<Uuid>) -> Result<Board, String> {
    let mut board = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    if let Some(node_id) = node_id {
        for mv in tree.line_to(node_id).map_err(|error| error.to_string())? {
            board = board.apply_move(mv).map_err(|error| error.to_string())?;
        }
    }
    Ok(board)
}

fn move_dto(node: &MoveNode, board: &Board) -> Result<MoveDto, String> {
    let moved_by = board
        .piece_at(node.mv.from)
        .ok_or_else(|| "move source is empty".to_owned())?
        .color;
    Ok(MoveDto {
        id: node.id,
        iccs: node.mv.to_iccs(),
        notation: board
            .chinese_move_notation(node.mv)
            .map_err(|error| error.to_string())?,
        moved_by: if moved_by == Color::Red {
            "红方"
        } else {
            "黑方"
        },
        from: SquareDto {
            row: node.mv.from.row,
            col: node.mv.from.col,
        },
        to: SquareDto {
            row: node.mv.to.row,
            col: node.mv.to.col,
        },
        score_cp: None,
        mate: None,
        comment: node.comment.clone(),
        is_mainline: node.is_mainline,
    })
}

fn board_dto(game: &WebGame) -> Result<BoardDto, String> {
    let mut pieces = Vec::new();
    for row in 0..10 {
        for col in 0..9 {
            if let Some(piece) = game.board.piece_at(Square { row, col }) {
                let (kind, red_label, black_label) = match piece.kind {
                    PieceKind::King => ("king", "帅", "将"),
                    PieceKind::Advisor => ("advisor", "仕", "士"),
                    PieceKind::Elephant => ("elephant", "相", "象"),
                    PieceKind::Horse => ("horse", "马", "马"),
                    PieceKind::Rook => ("rook", "车", "车"),
                    PieceKind::Cannon => ("cannon", "炮", "炮"),
                    PieceKind::Pawn => ("pawn", "兵", "卒"),
                };
                pieces.push(PieceDto {
                    row,
                    col,
                    color: if piece.color == Color::Red {
                        "red"
                    } else {
                        "black"
                    },
                    kind,
                    label: if piece.color == Color::Red {
                        red_label
                    } else {
                        black_label
                    },
                });
            }
        }
    }
    let mut history = Vec::new();
    if let Some(node) = game.current_node {
        let mut board = Board::from_fen(&game.starting_fen).map_err(|error| error.to_string())?;
        for node in game
            .tree
            .active_line(node)
            .map_err(|error| error.to_string())?
        {
            history.push(move_dto(node, &board)?);
            board = board
                .apply_move(node.mv)
                .map_err(|error| error.to_string())?;
        }
    }
    let branch_parent = game.current_node.unwrap_or_else(|| game.tree.root_id());
    let branches = game
        .tree
        .branches(branch_parent)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|node| move_dto(node, &game.board))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(BoardDto {
        fen: game.board.to_fen(),
        side_to_move: if game.board.side_to_move() == Color::Red {
            "红方"
        } else {
            "黑方"
        },
        status: match game.board.status() {
            GameStatus::Ongoing => "进行中",
            GameStatus::Check => "将军",
            GameStatus::Checkmate => "将死",
        },
        pieces,
        history,
        branches,
        current_node: game.current_node,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_round_trips_with_variations_and_comments() {
        let mut game = WebGame::new(None).unwrap();
        let first: serde_json::Value =
            serde_json::from_str(&game.play_move("a0a1").unwrap()).unwrap();
        let first_id = first["currentNode"].as_str().unwrap();
        game.update_comment(first_id, "测试".into()).unwrap();
        game.navigate_to(None).unwrap();
        game.play_move("b0c2").unwrap();
        let restored = WebGame::import_json(&game.export_json().unwrap()).unwrap();
        let state: serde_json::Value =
            serde_json::from_str(&restored.state_json().unwrap()).unwrap();
        assert_eq!(state["history"].as_array().unwrap().len(), 1);
        assert_eq!(
            restored
                .tree
                .branches(restored.tree.root_id())
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn state_json_exposes_chinese_notation_and_last_move_metadata() {
        let mut game = WebGame::new(None).unwrap();
        game.play_move("h2e2").unwrap();
        let state: serde_json::Value = serde_json::from_str(&game.state_json().unwrap()).unwrap();
        let mv = &state["history"][0];
        assert_eq!(mv["notation"], "炮二平五");
        assert_eq!(mv["movedBy"], "红方");
        assert_eq!(mv["from"], serde_json::json!({ "row": 7, "col": 7 }));
        assert_eq!(mv["to"], serde_json::json!({ "row": 7, "col": 4 }));
        assert!(mv["scoreCp"].is_null());
        assert!(mv["mate"].is_null());
    }

    #[test]
    fn remote_moves_are_projected_with_their_original_ids() {
        let mut game = WebGame::new(None).unwrap();
        let node_id = Uuid::new_v4();
        let payload = serde_json::json!({
            "nodeId": node_id,
            "parentId": game.tree.root_id(),
            "move": "a0a1",
            "orderKey": 7,
            "isMainline": true
        });
        game.apply_operation("add_move", &payload.to_string())
            .unwrap();
        assert_eq!(game.tree.node(node_id).unwrap().order_key, 7);
    }

    #[test]
    fn remote_game_retains_the_server_root_id() {
        let root_id = Uuid::new_v4();
        let game = WebGame::from_remote(STARTING_FEN.into(), &root_id.to_string()).unwrap();
        assert_eq!(game.tree.root_id(), root_id);
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn illegal_moves_are_rejected_without_changing_state() {
        let mut game = WebGame::new(None).unwrap();
        let before = game.state_json().unwrap();
        assert!(game.play_move("b0d1").is_err());
        assert_eq!(game.state_json().unwrap(), before);
    }
}
