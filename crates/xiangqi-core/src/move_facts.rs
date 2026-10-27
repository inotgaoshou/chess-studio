//! Read-only, position-local evidence. No evaluation or inferred human intent.
use crate::{Board, ChessError, Color, GameStatus, Move, Piece, PieceKind, Square};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOpportunity {
    pub iccs: String,
    pub attacker: Piece,
    pub target: Piece,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialCount {
    pub color: Color,
    pub kind: PieceKind,
    pub count: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFacts {
    pub before_fen: String,
    pub after_fen: String,
    pub iccs: String,
    pub notation: String,
    pub mover: Piece,
    pub from: Square,
    pub to: Square,
    pub captured: Option<Piece>,
    pub was_in_check: bool,
    pub resolves_check: bool,
    pub gives_check: bool,
    pub status: GameStatus,
    /// Hypothetical captures with mover to play in each snapshot. These are
    /// not forced threats: the opponent still has their actual turn to reply.
    pub attacks_before: Vec<CaptureOpportunity>,
    pub attacks_after: Vec<CaptureOpportunity>,
    pub opponent_captures_after: Vec<CaptureOpportunity>,
    pub material_before: Vec<MaterialCount>,
    pub material_after: Vec<MaterialCount>,
}

fn captures(board: &Board, color: Color) -> Vec<CaptureOpportunity> {
    let position = board.with_side_to_move(color);
    position
        .legal_moves()
        .into_iter()
        .filter_map(|mv| {
            let target = position.piece_at(mv.to)?;
            // Check is represented separately; never suggest capturing a king.
            if target.kind == PieceKind::King {
                return None;
            }
            Some(CaptureOpportunity {
                iccs: mv.to_iccs(),
                attacker: position.piece_at(mv.from)?,
                target,
            })
        })
        .collect()
}

fn material(board: &Board) -> Vec<MaterialCount> {
    let mut result = Vec::<MaterialCount>::new();
    for row in 0..10 {
        for col in 0..9 {
            if let Some(piece) = board.piece_at(Square { row, col }) {
                if let Some(count) = result
                    .iter_mut()
                    .find(|c| c.color == piece.color && c.kind == piece.kind)
                {
                    count.count += 1;
                } else {
                    result.push(MaterialCount {
                        color: piece.color,
                        kind: piece.kind,
                        count: 1,
                    });
                }
            }
        }
    }
    result
}

pub fn move_facts(board: &Board, mv: Move) -> Result<MoveFacts, ChessError> {
    // apply_move is the single source of legality, including king safety.
    let after = board.apply_move(mv)?;
    let mover = board.piece_at(mv.from).ok_or(ChessError::IllegalMove)?;
    let was_in_check = board.is_in_check(mover.color);
    Ok(MoveFacts {
        before_fen: board.to_fen(),
        after_fen: after.to_fen(),
        iccs: mv.to_iccs(),
        notation: board.chinese_move_notation(mv)?,
        mover,
        from: mv.from,
        to: mv.to,
        captured: board.piece_at(mv.to),
        was_in_check,
        resolves_check: was_in_check && !after.is_in_check(mover.color),
        gives_check: after.is_in_check(mover.color.opposite()),
        status: after.status(),
        attacks_before: captures(board, mover.color),
        attacks_after: captures(&after, mover.color),
        opponent_captures_after: captures(&after, mover.color.opposite()),
        material_before: material(board),
        material_after: material(&after),
    })
}

/// Validate all returned evidence on temporary boards. PVs are reference lines,
/// not played moves. An invalid continuation fails the request atomically.
pub fn line_facts(fen: &str, moves: &[String]) -> Result<Vec<MoveFacts>, ChessError> {
    let mut board = Board::from_fen(fen)?;
    let mut result = Vec::new();
    for iccs in moves.iter().take(12) {
        let mv = Move::from_iccs(iccs)?;
        let facts = move_facts(&board, mv)?;
        board = board.apply_move(mv)?;
        let terminal = matches!(facts.status, GameStatus::Checkmate | GameStatus::Stalemate);
        result.push(facts);
        if terminal {
            break;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::STARTING_FEN;

    #[test]
    fn ordinary_line_preserves_original_and_alternates_sides() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let facts = line_facts(STARTING_FEN, &["h2e2".into(), "h9g7".into()]).unwrap();
        assert_eq!(facts[0].mover.color, Color::Red);
        assert_eq!(facts[1].mover.color, Color::Black);
        assert_eq!(facts[0].after_fen, facts[1].before_fen);
        assert_eq!(board.to_fen(), STARTING_FEN);
        assert!(facts[0].captured.is_none());
        assert_eq!(facts[0].material_before, facts[0].material_after);
    }

    #[test]
    fn capture_check_and_evasion_are_actual_facts() {
        let fen = "4k4/9/4p4/9/9/9/9/4R4/9/3K5 w - - 0 1";
        let facts = line_facts(fen, &["e2e7".into(), "e9f9".into()]).unwrap();
        assert_eq!(facts[0].captured.unwrap().kind, PieceKind::Pawn);
        assert!(facts[0].gives_check);
        assert!(facts[1].was_in_check && facts[1].resolves_check);
    }

    #[test]
    fn pinned_rook_has_no_sideways_capture_and_illegal_line_fails() {
        let fen = "4k4/9/9/9/9/4r4/9/p3R4/9/4K4 w - - 0 1";
        let board = Board::from_fen(fen).unwrap();
        assert!(
            !captures(&board, Color::Red)
                .iter()
                .any(|c| c.iccs == "e2a2")
        );
        assert!(line_facts(fen, &["e2a2".into()]).is_err());
        assert!(line_facts(STARTING_FEN, &["h2e2".into(), "bad".into()]).is_err());
    }
}
