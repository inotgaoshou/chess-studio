use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const STARTING_FEN: &str =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
pub const DOMESTIC_RULE_NAME: &str = "国内中国象棋规则（2020版导向）";
pub const ASIAN_RULE_NAME: &str = "亚洲象棋规则（AXF导向）";
pub const NATURAL_LIMIT_PLIES: u32 = 120;

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
    Stalemate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleMode {
    Domestic2020,
    AsianAxf,
}

impl RuleMode {
    pub fn code(self) -> &'static str {
        match self {
            Self::Domestic2020 => "domestic2020",
            Self::AsianAxf => "asianAxf",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Domestic2020 => DOMESTIC_RULE_NAME,
            Self::AsianAxf => ASIAN_RULE_NAME,
        }
    }
}

impl Default for RuleMode {
    fn default() -> Self {
        Self::Domestic2020
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleVerdict {
    Ongoing,
    Check,
    Checkmate { loser: Color },
    Stalemate { loser: Color },
    DrawByNaturalLimit,
    PendingRepetition,
    PendingAsianRepetition,
    LossByPerpetualCheck { loser: Color },
    LossByPerpetualChase { loser: Color },
    DrawByRepetitionMvp,
}

impl RuleVerdict {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Ongoing | Self::Check | Self::PendingRepetition)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleMoveRecord {
    pub mover: Color,
    pub captured: bool,
    pub gives_check: bool,
    pub position_key: String,
    #[serde(default)]
    pub chase_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomesticRuleState {
    positions: Vec<String>,
    moves: Vec<RuleMoveRecord>,
    capture_free_plies: u32,
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

    pub fn with_side_to_move(&self, side_to_move: Color) -> Self {
        let mut board = self.clone();
        board.side_to_move = side_to_move;
        board
    }

    pub fn rule_position_key(&self) -> String {
        self.to_fen()
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn would_capture(&self, mv: Move) -> bool {
        self.piece_at(mv.to).is_some()
    }

    pub fn piece_at(&self, square: Square) -> Option<Piece> {
        if square.row < 10 && square.col < 9 {
            self.squares[index(square)]
        } else {
            None
        }
    }

    pub fn chinese_move_notation(&self, mv: Move) -> Result<String, ChessError> {
        self.apply_move(mv)?;
        let piece = self.piece_at(mv.from).ok_or(ChessError::IllegalMove)?;
        let piece_name = chinese_piece_name(piece);
        let same_file = self.same_file_pieces(piece, mv.from.col);
        let prefix = if same_file.len() > 1 {
            let index = same_file
                .iter()
                .position(|square| *square == mv.from)
                .ok_or(ChessError::IllegalMove)?;
            Some(disambiguation_prefix(piece.kind, index, same_file.len()))
        } else {
            None
        };

        let mut notation = String::new();
        if let Some(prefix) = prefix {
            notation.push_str(prefix);
            notation.push_str(piece_name);
        } else {
            notation.push_str(piece_name);
            notation.push_str(file_number(piece.color, mv.from.col));
        }

        if mv.from.row == mv.to.row {
            notation.push('平');
            notation.push_str(file_number(piece.color, mv.to.col));
            return Ok(notation);
        }

        let advances = match piece.color {
            Color::Red => mv.to.row < mv.from.row,
            Color::Black => mv.to.row > mv.from.row,
        };
        notation.push(if advances { '进' } else { '退' });
        let operand = match piece.kind {
            PieceKind::Horse | PieceKind::Elephant | PieceKind::Advisor => {
                file_number(piece.color, mv.to.col)
            }
            PieceKind::King | PieceKind::Rook | PieceKind::Cannon | PieceKind::Pawn => {
                move_number(piece.color, mv.from.row.abs_diff(mv.to.row))
            }
        };
        notation.push_str(operand);
        Ok(notation)
    }

    pub fn chinese_pv_notation(&self, moves: &[String]) -> Result<Vec<String>, ChessError> {
        let mut board = self.clone();
        let mut notation = Vec::with_capacity(moves.len());
        for iccs in moves {
            let mv = Move::from_iccs(iccs)?;
            notation.push(board.chinese_move_notation(mv)?);
            board = board.apply_move(mv)?;
        }
        Ok(notation)
    }

    fn same_file_pieces(&self, piece: Piece, col: u8) -> Vec<Square> {
        let mut squares: Vec<_> = (0..10)
            .filter_map(|row| {
                let square = Square { row, col };
                (self.piece_at(square) == Some(piece)).then_some(square)
            })
            .collect();
        if piece.color == Color::Black {
            squares.reverse();
        }
        squares
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
        let legal_moves = self.legal_moves();
        if in_check && legal_moves.is_empty() {
            GameStatus::Checkmate
        } else if in_check {
            GameStatus::Check
        } else if legal_moves.is_empty() {
            GameStatus::Stalemate
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

    fn unprotected_targets_attacked_by(&self, attacker: Color) -> Vec<String> {
        let mut targets = Vec::new();
        for target_index in 0..90 {
            let target_square = square_from_index(target_index);
            let Some(target_piece) = self.squares[target_index] else {
                continue;
            };
            if target_piece.color == attacker || target_piece.kind == PieceKind::King {
                continue;
            }
            let attacked = (0..90).any(|attacker_index| {
                let from = square_from_index(attacker_index);
                self.squares[attacker_index].is_some_and(|piece| {
                    piece.color == attacker
                        && self.attacks(
                            Move {
                                from,
                                to: target_square,
                            },
                            piece,
                        )
                })
            });
            if attacked && !self.is_defended(target_square, target_piece.color) {
                targets.push(piece_target_key(target_piece, target_square));
            }
        }
        targets.sort();
        targets.dedup();
        targets
    }

    fn is_defended(&self, target: Square, defender: Color) -> bool {
        (0..90).any(|defender_index| {
            let from = square_from_index(defender_index);
            from != target
                && self.squares[defender_index].is_some_and(|piece| {
                    piece.color == defender && self.attacks(Move { from, to: target }, piece)
                })
        })
    }
}

impl DomesticRuleState {
    pub fn new(initial: &Board) -> Self {
        Self {
            positions: vec![initial.rule_position_key()],
            moves: Vec::new(),
            capture_free_plies: 0,
        }
    }

    pub fn from_fen_and_moves(fen: &str, moves: &[Move]) -> Result<(Self, Board), ChessError> {
        let mut board = Board::from_fen(fen)?;
        let mut state = Self::new(&board);
        for mv in moves {
            let next = board.apply_move(*mv)?;
            state.record_applied_move(&board, *mv, &next)?;
            board = next;
        }
        Ok((state, board))
    }

    pub fn record_applied_move(
        &mut self,
        before: &Board,
        mv: Move,
        after: &Board,
    ) -> Result<(), ChessError> {
        let piece = before.piece_at(mv.from).ok_or(ChessError::IllegalMove)?;
        if piece.color != before.side_to_move {
            return Err(ChessError::IllegalMove);
        }
        let captured = before.would_capture(mv);
        let expected = before.apply_move(mv)?;
        if expected != *after {
            return Err(ChessError::IllegalMove);
        }
        self.capture_free_plies = if captured {
            0
        } else {
            self.capture_free_plies + 1
        };
        self.positions.push(after.rule_position_key());
        self.moves.push(RuleMoveRecord {
            mover: piece.color,
            captured,
            gives_check: after.is_in_check(after.side_to_move()),
            position_key: after.rule_position_key(),
            chase_targets: after.unprotected_targets_attacked_by(piece.color),
        });
        Ok(())
    }

    pub fn evaluate(&self, board: &Board) -> RuleVerdict {
        self.evaluate_with_mode(board, RuleMode::Domestic2020)
    }

    pub fn evaluate_with_mode(&self, board: &Board, mode: RuleMode) -> RuleVerdict {
        match board.status() {
            GameStatus::Checkmate => {
                return RuleVerdict::Checkmate {
                    loser: board.side_to_move(),
                };
            }
            GameStatus::Stalemate => {
                return RuleVerdict::Stalemate {
                    loser: board.side_to_move(),
                };
            }
            GameStatus::Check => {}
            GameStatus::Ongoing => {}
        }
        if self.capture_free_plies >= NATURAL_LIMIT_PLIES {
            return RuleVerdict::DrawByNaturalLimit;
        }
        if self.current_repetition_count() >= 3 {
            if let Some(loser) = self.perpetual_check_loser() {
                return RuleVerdict::LossByPerpetualCheck { loser };
            }
            if mode == RuleMode::AsianAxf {
                if let Some(loser) = self.perpetual_chase_loser() {
                    return RuleVerdict::LossByPerpetualChase { loser };
                }
                if self.has_complex_chase_cycle() {
                    return RuleVerdict::PendingAsianRepetition;
                }
                return RuleVerdict::DrawByRepetitionMvp;
            }
            return RuleVerdict::PendingRepetition;
        }
        if board.status() == GameStatus::Check {
            RuleVerdict::Check
        } else {
            RuleVerdict::Ongoing
        }
    }

    pub fn capture_free_plies(&self) -> u32 {
        self.capture_free_plies
    }

    pub fn current_repetition_count(&self) -> usize {
        let Some(current) = self.positions.last() else {
            return 0;
        };
        self.positions
            .iter()
            .filter(|position| *position == current)
            .count()
    }

    fn current_cycle_records(&self) -> Option<&[RuleMoveRecord]> {
        let current = self.positions.last()?;
        let previous = self
            .positions
            .iter()
            .enumerate()
            .rev()
            .skip(1)
            .find_map(|(index, position)| (position == current).then_some(index))?;
        Some(&self.moves[previous..])
    }

    fn perpetual_check_loser(&self) -> Option<Color> {
        let cycle = self.current_cycle_records()?;
        if cycle.is_empty() || cycle.iter().any(|record| record.captured) {
            return None;
        }
        [Color::Red, Color::Black].into_iter().find(|color| {
            let own: Vec<_> = cycle
                .iter()
                .filter(|record| record.mover == *color)
                .collect();
            !own.is_empty()
                && own.iter().all(|record| record.gives_check)
                && cycle
                    .iter()
                    .filter(|record| record.mover == color.opposite())
                    .all(|record| !record.gives_check)
        })
    }

    fn perpetual_chase_loser(&self) -> Option<Color> {
        let cycle = self.current_cycle_records()?;
        if cycle.is_empty() || cycle.iter().any(|record| record.captured) {
            return None;
        }
        [Color::Red, Color::Black].into_iter().find(|color| {
            let own: Vec<_> = cycle
                .iter()
                .filter(|record| record.mover == *color)
                .collect();
            let other: Vec<_> = cycle
                .iter()
                .filter(|record| record.mover == color.opposite())
                .collect();
            if own.is_empty()
                || other.is_empty()
                || own.iter().any(|record| record.gives_check)
                || other
                    .iter()
                    .any(|record| record.gives_check || !record.chase_targets.is_empty())
            {
                return false;
            }
            let Some(first_target) = own
                .iter()
                .find_map(|record| single_chase_target(record).map(str::to_owned))
            else {
                return false;
            };
            own.iter()
                .all(|record| single_chase_target(record) == Some(first_target.as_str()))
        })
    }

    fn has_complex_chase_cycle(&self) -> bool {
        self.current_cycle_records().is_some_and(|cycle| {
            cycle.iter().all(|record| !record.gives_check)
                && cycle.iter().any(|record| !record.chase_targets.is_empty())
        })
    }
}

fn single_chase_target(record: &RuleMoveRecord) -> Option<&str> {
    (record.chase_targets.len() == 1).then(|| record.chase_targets[0].as_str())
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

fn piece_target_key(piece: Piece, square: Square) -> String {
    format!(
        "{}{}{}{}",
        if piece.color == Color::Red { 'R' } else { 'B' },
        symbol_from_piece(Piece {
            color: Color::Black,
            kind: piece.kind,
        }),
        square.row,
        square.col
    )
}

fn chinese_piece_name(piece: Piece) -> &'static str {
    match (piece.color, piece.kind) {
        (Color::Red, PieceKind::King) => "帅",
        (Color::Black, PieceKind::King) => "将",
        (Color::Red, PieceKind::Advisor) => "仕",
        (Color::Black, PieceKind::Advisor) => "士",
        (Color::Red, PieceKind::Elephant) => "相",
        (Color::Black, PieceKind::Elephant) => "象",
        (_, PieceKind::Horse) => "马",
        (_, PieceKind::Rook) => "车",
        (_, PieceKind::Cannon) => "炮",
        (Color::Red, PieceKind::Pawn) => "兵",
        (Color::Black, PieceKind::Pawn) => "卒",
    }
}

fn disambiguation_prefix(kind: PieceKind, index: usize, count: usize) -> &'static str {
    match (kind, count, index) {
        (_, 2, 0) => "前",
        (_, 2, _) => "后",
        (PieceKind::Pawn, 3, 0) => "前",
        (PieceKind::Pawn, 3, 1) => "中",
        (PieceKind::Pawn, 3, _) => "后",
        (PieceKind::Pawn, _, 0) => "一",
        (PieceKind::Pawn, _, 1) => "二",
        (PieceKind::Pawn, _, 2) => "三",
        (PieceKind::Pawn, _, 3) => "四",
        (PieceKind::Pawn, _, _) => "五",
        (_, _, 0) => "前",
        (_, _, index) if index + 1 == count => "后",
        _ => "中",
    }
}

fn file_number(color: Color, col: u8) -> &'static str {
    let number = match color {
        Color::Red => 9 - col,
        Color::Black => col + 1,
    };
    move_number(color, number)
}

fn move_number(color: Color, number: u8) -> &'static str {
    const RED: [&str; 10] = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const BLACK: [&str; 10] = ["", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    match color {
        Color::Red => RED[number as usize],
        Color::Black => BLACK[number as usize],
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
    fn changes_side_to_move_without_changing_piece_placement() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let corrected = board.with_side_to_move(Color::Black);

        assert_eq!(corrected.side_to_move(), Color::Black);
        assert_eq!(
            corrected.to_fen().split_whitespace().next(),
            board.to_fen().split_whitespace().next()
        );
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

    #[test]
    fn formats_the_opening_line_with_traditional_chinese_numerals() {
        let mut board = Board::from_fen(STARTING_FEN).unwrap();
        for (iccs, notation) in [
            ("h2e2", "炮二平五"),
            ("h9g7", "马8进7"),
            ("h0g2", "马二进三"),
            ("g6g5", "卒7进1"),
        ] {
            let mv = Move::from_iccs(iccs).unwrap();
            assert_eq!(board.chinese_move_notation(mv).unwrap(), notation);
            board = board.apply_move(mv).unwrap();
        }
    }

    #[test]
    fn formats_an_engine_pv_as_a_chinese_move_sequence() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let pv = ["h2e2".to_owned(), "h9g7".to_owned(), "h0g2".to_owned()];

        assert_eq!(
            board.chinese_pv_notation(&pv).unwrap(),
            ["炮二平五", "马8进7", "马二进三"]
        );
    }

    #[test]
    fn rule_state_reports_checkmate_loser() {
        let board = Board::from_fen("4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1").unwrap();
        let state = DomesticRuleState::new(&board);

        assert_eq!(
            state.evaluate(&board),
            RuleVerdict::Checkmate {
                loser: Color::Black
            }
        );
    }

    #[test]
    fn rule_state_reports_natural_limit_after_120_capture_free_plies() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let mut state = DomesticRuleState::new(&board);
        state.capture_free_plies = NATURAL_LIMIT_PLIES;

        assert_eq!(state.evaluate(&board), RuleVerdict::DrawByNaturalLimit);
    }

    #[test]
    fn rule_state_resets_natural_limit_when_a_move_captures() {
        let board = Board::from_fen("4k4/9/9/9/r3p4/R8/9/9/9/4K4 b - - 119 1").unwrap();
        let mv = Move::from_iccs("a5a4").unwrap();
        let next = board.apply_move(mv).unwrap();
        let mut state = DomesticRuleState::new(&board);
        state.capture_free_plies = NATURAL_LIMIT_PLIES - 1;

        state.record_applied_move(&board, mv, &next).unwrap();

        assert_eq!(state.capture_free_plies(), 0);
        assert_eq!(state.evaluate(&next), RuleVerdict::Ongoing);
    }

    #[test]
    fn rule_state_marks_third_repeated_position_as_pending() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = board.rule_position_key();
        let mut state = DomesticRuleState::new(&board);
        state.positions = vec![
            key.clone(),
            "after-red".into(),
            key.clone(),
            "after-red".into(),
            key,
        ];
        state.moves = vec![
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "after-red".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "after-red".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
        ];

        assert_eq!(state.current_repetition_count(), 3);
        assert_eq!(state.evaluate(&board), RuleVerdict::PendingRepetition);
        assert_eq!(
            state.evaluate_with_mode(&board, RuleMode::AsianAxf),
            RuleVerdict::DrawByRepetitionMvp
        );
    }

    #[test]
    fn rule_state_marks_single_side_perpetual_check_as_loss() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = board.rule_position_key();
        let mut state = DomesticRuleState::new(&board);
        state.positions = vec![
            key.clone(),
            "black-to-move-in-check".into(),
            key.clone(),
            "black-to-move-in-check".into(),
            key,
        ];
        state.moves = vec![
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: true,
                position_key: "black-to-move-in-check".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: true,
                position_key: "black-to-move-in-check".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
        ];

        assert_eq!(
            state.evaluate(&board),
            RuleVerdict::LossByPerpetualCheck { loser: Color::Red }
        );
    }

    #[test]
    fn asian_rule_marks_mechanical_perpetual_chase_as_loss() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = board.rule_position_key();
        let mut state = DomesticRuleState::new(&board);
        state.positions = vec![
            key.clone(),
            "black-to-move-chased".into(),
            key.clone(),
            "black-to-move-chased".into(),
            key,
        ];
        state.moves = vec![
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "black-to-move-chased".into(),
                chase_targets: vec!["Bn22".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "black-to-move-chased".into(),
                chase_targets: vec!["Bn22".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
        ];

        assert_eq!(
            state.evaluate_with_mode(&board, RuleMode::AsianAxf),
            RuleVerdict::LossByPerpetualChase { loser: Color::Red }
        );
        assert_eq!(state.evaluate(&board), RuleVerdict::PendingRepetition);
    }

    #[test]
    fn asian_rule_keeps_complex_chase_repetition_pending() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = board.rule_position_key();
        let mut state = DomesticRuleState::new(&board);
        state.positions = vec![
            key.clone(),
            "black-to-move-chased".into(),
            key.clone(),
            "black-to-move-chased".into(),
            key,
        ];
        state.moves = vec![
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "black-to-move-chased".into(),
                chase_targets: vec!["Bn22".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "black-to-move-chased".into(),
                chase_targets: vec!["Bn22".into(), "Bc27".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
        ];

        assert_eq!(
            state.evaluate_with_mode(&board, RuleMode::AsianAxf),
            RuleVerdict::PendingAsianRepetition
        );
    }

    #[test]
    fn asian_rule_draws_mixed_check_and_chase_repetition() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let key = board.rule_position_key();
        let mut state = DomesticRuleState::new(&board);
        state.positions = vec![
            key.clone(),
            "after-red-check".into(),
            "after-black-reply-one".into(),
            "after-red-chase".into(),
            key.clone(),
            "after-red-check".into(),
            "after-black-reply-one".into(),
            "after-red-chase".into(),
            key,
        ];
        state.moves = vec![
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: true,
                position_key: "after-red-check".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: "after-black-reply-one".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "after-red-chase".into(),
                chase_targets: vec!["Bn22".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: true,
                position_key: "after-red-check".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: "after-black-reply-one".into(),
                chase_targets: Vec::new(),
            },
            RuleMoveRecord {
                mover: Color::Red,
                captured: false,
                gives_check: false,
                position_key: "after-red-chase".into(),
                chase_targets: vec!["Bn22".into()],
            },
            RuleMoveRecord {
                mover: Color::Black,
                captured: false,
                gives_check: false,
                position_key: board.rule_position_key(),
                chase_targets: Vec::new(),
            },
        ];

        assert_eq!(
            state.evaluate_with_mode(&board, RuleMode::AsianAxf),
            RuleVerdict::DrawByRepetitionMvp
        );
    }
    #[test]
    fn disambiguates_same_file_rooks_from_the_movers_perspective() {
        let board = Board::from_fen("4k4/9/9/9/4P4/R8/9/R8/9/4K4 w - - 0 1").unwrap();
        assert_eq!(
            board
                .chinese_move_notation(Move::from_iccs("a4b4").unwrap())
                .unwrap(),
            "前车平八"
        );
        assert_eq!(
            board
                .chinese_move_notation(Move::from_iccs("a2b2").unwrap())
                .unwrap(),
            "后车平八"
        );
    }

    #[test]
    fn disambiguates_three_same_file_pawns() {
        let board = Board::from_fen("4k4/9/P8/P8/P8/4P4/9/9/9/4K4 w - - 0 1").unwrap();
        for (iccs, notation) in [
            ("a7a8", "前兵进一"),
            ("a6b6", "中兵平八"),
            ("a5b5", "后兵平八"),
        ] {
            assert_eq!(
                board
                    .chinese_move_notation(Move::from_iccs(iccs).unwrap())
                    .unwrap(),
                notation
            );
        }
    }
}
