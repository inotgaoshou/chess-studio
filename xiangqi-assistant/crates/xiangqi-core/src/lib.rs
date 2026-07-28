use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const STARTING_FEN: &str =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Color {
    Red,
    Black,
}

impl Color {
    pub fn opposite(self) -> Self {
        match self {
            Self::Red => Self::Black,
            Self::Black => Self::Red,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PieceKind {
    King,
    Advisor,
    Elephant,
    Horse,
    Rook,
    Cannon,
    Pawn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Piece {
    pub color: Color,
    pub kind: PieceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Square {
    pub row: u8,
    pub col: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Move {
    pub from: Square,
    pub to: Square,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    squares: [Option<Piece>; 90],
    side_to_move: Color,
    halfmove: u32,
    fullmove: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameStatus {
    Ongoing,
    Check,
    Checkmate,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ChessError {
    #[error("invalid FEN: {0}")]
    InvalidFen(String),
    #[error("invalid ICCS move: {0}")]
    InvalidMoveNotation(String),
    #[error("illegal move")]
    IllegalMove,
}

impl Move {
    pub fn from_iccs(value: &str) -> Result<Self, ChessError> {
        let bytes = value.as_bytes();
        if bytes.len() != 4
            || !matches!(bytes[0], b'a'..=b'i')
            || !matches!(bytes[2], b'a'..=b'i')
            || !bytes[1].is_ascii_digit()
            || !bytes[3].is_ascii_digit()
        {
            return Err(ChessError::InvalidMoveNotation(value.to_owned()));
        }
        Ok(Self {
            from: Square {
                row: 9 - (bytes[1] - b'0'),
                col: bytes[0] - b'a',
            },
            to: Square {
                row: 9 - (bytes[3] - b'0'),
                col: bytes[2] - b'a',
            },
        })
    }

    pub fn to_iccs(self) -> String {
        format!(
            "{}{}{}{}",
            (b'a' + self.from.col) as char,
            9 - self.from.row,
            (b'a' + self.to.col) as char,
            9 - self.to.row
        )
    }
}

impl Board {
    pub fn from_fen(fen: &str) -> Result<Self, ChessError> {
        let fields: Vec<&str> = fen.split_whitespace().collect();
        if fields.len() < 2 {
            return Err(ChessError::InvalidFen("missing fields".into()));
        }
        let ranks: Vec<&str> = fields[0].split('/').collect();
        if ranks.len() != 10 {
            return Err(ChessError::InvalidFen("expected 10 ranks".into()));
        }
        let mut squares = [None; 90];
        for (row, rank) in ranks.iter().enumerate() {
            let mut col = 0usize;
            for symbol in rank.chars() {
                if let Some(empty) = symbol.to_digit(10) {
                    if empty == 0 || empty > 9 {
                        return Err(ChessError::InvalidFen("invalid empty run".into()));
                    }
                    col += empty as usize;
                } else {
                    if col >= 9 {
                        return Err(ChessError::InvalidFen("rank is too wide".into()));
                    }
                    squares[row * 9 + col] = Some(piece_from_symbol(symbol).ok_or_else(|| {
                        ChessError::InvalidFen(format!("unknown piece {symbol}"))
                    })?);
                    col += 1;
                }
            }
            if col != 9 {
                return Err(ChessError::InvalidFen(format!(
                    "rank {} has {col} files",
                    row + 1
                )));
            }
        }
        let side_to_move = match fields[1] {
            "w" | "r" => Color::Red,
            "b" => Color::Black,
            _ => return Err(ChessError::InvalidFen("invalid side to move".into())),
        };
        let halfmove = fields.get(4).and_then(|v| v.parse().ok()).unwrap_or(0);
        let fullmove = fields.get(5).and_then(|v| v.parse().ok()).unwrap_or(1);
        Ok(Self {
            squares,
            side_to_move,
            halfmove,
            fullmove,
        })
    }

    pub fn to_fen(&self) -> String {
        let mut placement = String::new();
        for row in 0..10 {
            if row > 0 {
                placement.push('/');
            }
            let mut empty = 0;
            for col in 0..9 {
                match self.squares[row * 9 + col] {
                    Some(piece) => {
                        if empty > 0 {
                            placement.push(char::from_digit(empty, 10).unwrap());
                            empty = 0;
                        }
                        placement.push(symbol_from_piece(piece));
                    }
                    None => empty += 1,
                }
            }
            if empty > 0 {
                placement.push(char::from_digit(empty, 10).unwrap());
            }
        }
        format!(
            "{placement} {} - - {} {}",
            if self.side_to_move == Color::Red {
                "w"
            } else {
                "b"
            },
            self.halfmove,
            self.fullmove
        )
    }

    pub fn side_to_move(&self) -> Color {
        self.side_to_move
    }

    pub fn piece_at(&self, square: Square) -> Option<Piece> {
        if square.row < 10 && square.col < 9 {
            self.squares[index(square)]
        } else {
            None
        }
    }

    pub fn apply_iccs(&self, value: &str) -> Result<Self, ChessError> {
        self.apply_move(Move::from_iccs(value)?)
    }

    pub fn apply_move(&self, mv: Move) -> Result<Self, ChessError> {
        let Some(piece) = self.piece_at(mv.from) else {
            return Err(ChessError::IllegalMove);
        };
        if piece.color != self.side_to_move || !self.is_pseudo_legal(mv, piece.color) {
            return Err(ChessError::IllegalMove);
        }
        let captured = self.piece_at(mv.to);
        let mut next = self.clone();
        next.squares[index(mv.to)] = Some(piece);
        next.squares[index(mv.from)] = None;
        if next.is_in_check(piece.color) {
            return Err(ChessError::IllegalMove);
        }
        next.side_to_move = piece.color.opposite();
        next.halfmove = if captured.is_some() || piece.kind == PieceKind::Pawn {
            0
        } else {
            self.halfmove + 1
        };
        if piece.color == Color::Black {
            next.fullmove += 1;
        }
        Ok(next)
    }

    pub fn legal_moves(&self) -> Vec<Move> {
        let mut moves = Vec::new();
        for from_row in 0..10 {
            for from_col in 0..9 {
                let from = Square {
                    row: from_row,
                    col: from_col,
                };
                if self
                    .piece_at(from)
                    .is_some_and(|piece| piece.color == self.side_to_move)
                {
                    for to_row in 0..10 {
                        for to_col in 0..9 {
                            let mv = Move {
                                from,
                                to: Square {
                                    row: to_row,
                                    col: to_col,
                                },
                            };
                            if self.apply_move(mv).is_ok() {
                                moves.push(mv);
                            }
                        }
                    }
                }
            }
        }
        moves
    }

    pub fn status(&self) -> GameStatus {
        let in_check = self.is_in_check(self.side_to_move);
        if in_check && self.legal_moves().is_empty() {
            GameStatus::Checkmate
        } else if in_check {
            GameStatus::Check
        } else {
            GameStatus::Ongoing
        }
    }

    pub fn is_in_check(&self, color: Color) -> bool {
        let king = (0..90).find_map(|idx| {
            self.squares[idx]
                .filter(|piece| piece.color == color && piece.kind == PieceKind::King)
                .map(|_| square_from_index(idx))
        });
        let Some(king) = king else {
            return true;
        };
        (0..90).any(|idx| {
            self.squares[idx].is_some_and(|piece| {
                piece.color != color
                    && self.attacks(
                        Move {
                            from: square_from_index(idx),
                            to: king,
                        },
                        piece,
                    )
            })
        })
    }

    fn is_pseudo_legal(&self, mv: Move, color: Color) -> bool {
        if mv.from == mv.to || mv.to.row >= 10 || mv.to.col >= 9 {
            return false;
        }
        let Some(piece) = self.piece_at(mv.from) else {
            return false;
        };
        if piece.color != color
            || self
                .piece_at(mv.to)
                .is_some_and(|target| target.color == color)
        {
            return false;
        }
        self.attacks(mv, piece)
    }

    fn attacks(&self, mv: Move, piece: Piece) -> bool {
        let dr = mv.to.row as i16 - mv.from.row as i16;
        let dc = mv.to.col as i16 - mv.from.col as i16;
        match piece.kind {
            PieceKind::Rook => (dr == 0 || dc == 0) && self.between_count(mv) == 0,
            PieceKind::Cannon => {
                if dr != 0 && dc != 0 {
                    return false;
                }
                let screens = self.between_count(mv);
                if self.piece_at(mv.to).is_some() {
                    screens == 1
                } else {
                    screens == 0
                }
            }
            PieceKind::Horse => {
                let (adr, adc) = (dr.unsigned_abs(), dc.unsigned_abs());
                if !((adr == 2 && adc == 1) || (adr == 1 && adc == 2)) {
                    return false;
                }
                let leg = if adr == 2 {
                    Square {
                        row: (mv.from.row as i16 + dr.signum()) as u8,
                        col: mv.from.col,
                    }
                } else {
                    Square {
                        row: mv.from.row,
                        col: (mv.from.col as i16 + dc.signum()) as u8,
                    }
                };
                self.piece_at(leg).is_none()
            }
            PieceKind::Elephant => {
                if dr.unsigned_abs() != 2 || dc.unsigned_abs() != 2 {
                    return false;
                }
                if (piece.color == Color::Red && mv.to.row < 5)
                    || (piece.color == Color::Black && mv.to.row > 4)
                {
                    return false;
                }
                self.piece_at(Square {
                    row: ((mv.from.row as u16 + mv.to.row as u16) / 2) as u8,
                    col: ((mv.from.col as u16 + mv.to.col as u16) / 2) as u8,
                })
                .is_none()
            }
            PieceKind::Advisor => {
                dr.unsigned_abs() == 1 && dc.unsigned_abs() == 1 && in_palace(mv.to, piece.color)
            }
            PieceKind::King => {
                let adjacent =
                    dr.unsigned_abs() + dc.unsigned_abs() == 1 && in_palace(mv.to, piece.color);
                let flying = dc == 0
                    && self.piece_at(mv.to).is_some_and(|target| {
                        target.kind == PieceKind::King && target.color != piece.color
                    })
                    && self.between_count(mv) == 0;
                adjacent || flying
            }
            PieceKind::Pawn => {
                let forward = if piece.color == Color::Red { -1 } else { 1 };
                let crossed = if piece.color == Color::Red {
                    mv.from.row <= 4
                } else {
                    mv.from.row >= 5
                };
                (dr == forward && dc == 0) || (crossed && dr == 0 && dc.unsigned_abs() == 1)
            }
        }
    }

    fn between_count(&self, mv: Move) -> usize {
        if mv.from.row != mv.to.row && mv.from.col != mv.to.col {
            return usize::MAX;
        }
        let dr = (mv.to.row as i16 - mv.from.row as i16).signum();
        let dc = (mv.to.col as i16 - mv.from.col as i16).signum();
        let mut row = mv.from.row as i16 + dr;
        let mut col = mv.from.col as i16 + dc;
        let mut count = 0;
        while row != mv.to.row as i16 || col != mv.to.col as i16 {
            if self
                .piece_at(Square {
                    row: row as u8,
                    col: col as u8,
                })
                .is_some()
            {
                count += 1;
            }
            row += dr;
            col += dc;
        }
        count
    }
}

fn index(square: Square) -> usize {
    square.row as usize * 9 + square.col as usize
}
fn square_from_index(index: usize) -> Square {
    Square {
        row: (index / 9) as u8,
        col: (index % 9) as u8,
    }
}

fn in_palace(square: Square, color: Color) -> bool {
    (3..=5).contains(&square.col)
        && match color {
            Color::Red => (7..=9).contains(&square.row),
            Color::Black => square.row <= 2,
        }
}

fn piece_from_symbol(value: char) -> Option<Piece> {
    let color = if value.is_ascii_uppercase() {
        Color::Red
    } else {
        Color::Black
    };
    let kind = match value.to_ascii_lowercase() {
        'k' => PieceKind::King,
        'a' => PieceKind::Advisor,
        'b' => PieceKind::Elephant,
        'n' | 'h' => PieceKind::Horse,
        'r' => PieceKind::Rook,
        'c' => PieceKind::Cannon,
        'p' => PieceKind::Pawn,
        _ => return None,
    };
    Some(Piece { color, kind })
}

fn symbol_from_piece(piece: Piece) -> char {
    let symbol = match piece.kind {
        PieceKind::King => 'k',
        PieceKind::Advisor => 'a',
        PieceKind::Elephant => 'b',
        PieceKind::Horse => 'n',
        PieceKind::Rook => 'r',
        PieceKind::Cannon => 'c',
        PieceKind::Pawn => 'p',
    };
    if piece.color == Color::Red {
        symbol.to_ascii_uppercase()
    } else {
        symbol
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starting_fen_round_trips() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        assert_eq!(board.to_fen(), STARTING_FEN);
        assert_eq!(board.side_to_move(), Color::Red);
    }

    #[test]
    fn iccs_coordinates_follow_red_side_rank_zero() {
        let mv = Move::from_iccs("a0a1").unwrap();
        assert_eq!(mv.from, Square { row: 9, col: 0 });
        assert_eq!(mv.to, Square { row: 8, col: 0 });
        assert_eq!(mv.to_iccs(), "a0a1");
    }

    #[test]
    fn applies_a_legal_rook_move_and_changes_side() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let next = board.apply_iccs("a0a1").unwrap();
        assert_eq!(next.side_to_move(), Color::Black);
        assert!(
            next.to_fen()
                .starts_with("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/R8/1NBAKABNR b")
        );
    }

    #[test]
    fn rejects_a_move_that_exposes_flying_generals() {
        let board = Board::from_fen("4k4/9/9/9/4R4/9/9/9/9/4K4 w - - 0 1").unwrap();
        assert_eq!(board.apply_iccs("e5f5"), Err(ChessError::IllegalMove));
    }

    #[test]
    fn rejects_a_horse_move_when_its_leg_is_blocked() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        assert_eq!(board.apply_iccs("b0d1"), Err(ChessError::IllegalMove));
    }
}
