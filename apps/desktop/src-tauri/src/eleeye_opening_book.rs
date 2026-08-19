//! Read-only reader for ElephantEye `BOOK.DAT` files selected by the local user.
//! The file is never copied into application resources or synchronized.

use std::{fs, path::Path};

use xiangqi_core::{Board, Move, Square};

use crate::xqb_opening_book::XqbCandidateDto;

const RECORD_SIZE: usize = 8;

pub(crate) fn validate(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("无法读取 ElephantEye 开局库：{error}"))?;
    if !metadata.is_file() {
        return Err("请选择 ElephantEye 的 BOOK.DAT 文件".into());
    }
    if metadata.len() == 0 || metadata.len() as usize % RECORD_SIZE != 0 {
        return Err("不是有效的 ElephantEye BOOK.DAT：文件记录长度应为 8 字节".into());
    }
    Ok(())
}

pub(crate) fn query(path: &Path, board: &Board) -> Result<Vec<XqbCandidateDto>, String> {
    validate(path)?;
    let bytes = fs::read(path).map_err(|error| format!("读取 ElephantEye 开局库失败：{error}"))?;
    let source = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .map(|name| format!("ElephantEye · {name}"))
        .unwrap_or_else(|| "ElephantEye 本地开局库".into());
    let mut candidates = Vec::new();
    for mirrored in [false, true] {
        let lock = position_lock(board, mirrored)?;
        let (start, end) = matching_range(&bytes, lock);
        if start == end {
            continue;
        }
        for record in bytes[start * RECORD_SIZE..end * RECORD_SIZE].chunks_exact(RECORD_SIZE) {
            let encoded = u16::from_le_bytes([record[4], record[5]]);
            let weight = u16::from_le_bytes([record[6], record[7]]);
            let Some(mv) = decode_move(encoded, mirrored) else {
                continue;
            };
            if !board.legal_moves().contains(&mv) {
                continue;
            }
            candidates.push(XqbCandidateDto {
                iccs: mv.to_iccs(),
                notation: board
                    .chinese_move_notation(mv)
                    .map_err(|error| error.to_string())?,
                score: weight as i32,
                win: 0,
                draw: 0,
                loss: 0,
                win_rate: None,
                memo: Some(format!("开局权重 {weight}")),
                source: source.clone(),
            });
        }
        if !candidates.is_empty() {
            break;
        }
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.iccs.cmp(&right.iccs))
    });
    candidates.dedup_by(|left, right| left.iccs == right.iccs);
    Ok(candidates)
}

fn matching_range(bytes: &[u8], lock: u32) -> (usize, usize) {
    let count = bytes.len() / RECORD_SIZE;
    let mut low = 0;
    let mut high = count;
    while low < high {
        let middle = (low + high) / 2;
        if record_lock(bytes, middle) < lock {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    let start = low;
    high = count;
    while low < high {
        let middle = (low + high) / 2;
        if record_lock(bytes, middle) <= lock {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    (start, low)
}

fn record_lock(bytes: &[u8], index: usize) -> u32 {
    let offset = index * RECORD_SIZE;
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("book record lock"),
    )
}

fn position_lock(board: &Board, mirrored: bool) -> Result<u32, String> {
    let mut generator = Rc4::zero_seed();
    let player = generator.next_zobrist();
    let mut table = [[0u32; 256]; 14];
    for row in &mut table {
        for item in row {
            *item = generator.next_zobrist().2;
        }
    }
    let mut lock = if board.side_to_move() == xiangqi_core::Color::Black {
        player.2
    } else {
        0
    };
    for row in 0..10 {
        for col in 0..9 {
            let Some(piece) = board.piece_at(Square { row, col }) else {
                continue;
            };
            let kind = match piece.kind {
                xiangqi_core::PieceKind::King => 0,
                xiangqi_core::PieceKind::Advisor => 1,
                xiangqi_core::PieceKind::Elephant => 2,
                xiangqi_core::PieceKind::Horse => 3,
                xiangqi_core::PieceKind::Rook => 4,
                xiangqi_core::PieceKind::Cannon => 5,
                xiangqi_core::PieceKind::Pawn => 6,
            } + if piece.color == xiangqi_core::Color::Black {
                7
            } else {
                0
            };
            let col = if mirrored { 8 - col } else { col };
            let square = 3 + col + ((3 + row) << 4);
            lock ^= table[kind][square as usize];
        }
    }
    Ok(lock)
}

fn decode_move(encoded: u16, mirrored: bool) -> Option<Move> {
    let source = (encoded & 0xff) as u8;
    let target = (encoded >> 8) as u8;
    let decode_square = |square: u8| {
        let row = (square >> 4).checked_sub(3)?;
        let mut col = (square & 15).checked_sub(3)?;
        if mirrored {
            col = 8_u8.checked_sub(col)?;
        }
        (row < 10 && col < 9).then_some(Square { row, col })
    };
    Some(Move {
        from: decode_square(source)?,
        to: decode_square(target)?,
    })
}

struct Rc4 {
    state: [u8; 256],
    x: u8,
    y: u8,
}

impl Rc4 {
    fn zero_seed() -> Self {
        let mut state = std::array::from_fn(|index| index as u8);
        let mut j = 0u8;
        for index in 0..256 {
            j = j.wrapping_add(state[index]);
            state.swap(index, j as usize);
        }
        Self { state, x: 0, y: 0 }
    }
    fn byte(&mut self) -> u8 {
        self.x = self.x.wrapping_add(1);
        self.y = self.y.wrapping_add(self.state[self.x as usize]);
        self.state.swap(self.x as usize, self.y as usize);
        self.state[(self.state[self.x as usize].wrapping_add(self.state[self.y as usize])) as usize]
    }
    fn next_zobrist(&mut self) -> (u32, u32, u32) {
        let number =
            |rc4: &mut Self| u32::from_le_bytes([rc4.byte(), rc4.byte(), rc4.byte(), rc4.byte()]);
        (number(self), number(self), number(self))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiangqi_core::STARTING_FEN;

    #[test]
    fn decodes_eleeye_move_to_iccs() {
        // ElephantEye squares: h2 => 0xaa, e2 => 0xa7.
        let move_ = decode_move(0xa7aa, false).unwrap();
        assert_eq!(move_.to_iccs(), "h2e2");
    }

    #[test]
    fn reads_matching_record() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("BOOK.DAT");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&position_lock(&board, false).unwrap().to_le_bytes());
        bytes.extend_from_slice(&0xa7aau16.to_le_bytes());
        bytes.extend_from_slice(&42u16.to_le_bytes());
        fs::write(&path, bytes).unwrap();
        let candidates = query(&path, &board).unwrap();
        assert_eq!(candidates[0].iccs, "h2e2");
        assert_eq!(candidates[0].score, 42);
    }
}
