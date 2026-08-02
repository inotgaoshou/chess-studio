use std::fs::File;
use std::io::Cursor;
use std::path::Path;

use ab_glyph::FontArc;
use gif::{Encoder, Frame};
use image::imageops::{self, FilterType};
use image::{DynamicImage, ImageReader, Rgba, RgbaImage};
use imageproc::drawing::{draw_filled_rect_mut, draw_hollow_circle_mut, draw_text_mut};
use imageproc::rect::Rect;
use manual_format::ManualDocument;
use xiangqi_core::{Board, Color, PieceKind, Square};

#[derive(Clone, Copy)]
pub enum ReplayScope {
    CurrentSelection,
    Mainline,
}

const BOARD_WIDTH: u32 = 360;
const BOARD_HEIGHT: u32 = 399;
const HEADER_HEIGHT: u32 = 40;
const FRAME_WIDTH: u32 = BOARD_WIDTH;
const FRAME_HEIGHT: u32 = BOARD_HEIGHT + HEADER_HEIGHT;
const PIECE_SIZE: u32 = 42;

const BOARD_PNG: &[u8] = include_bytes!("../../public/skins/default/board.png");
const FONT: &[u8] = include_bytes!("../resources/fonts/NotoSansSC-VF.ttf");

pub fn export_replay_gif(
    path: &Path,
    document: &ManualDocument,
    current_node: Option<uuid::Uuid>,
    scope: ReplayScope,
) -> Result<(), String> {
    let mut board = Board::from_fen(&document.starting_fen).map_err(|error| error.to_string())?;
    let mut positions = vec![(board.clone(), None, None)];
    let line = match scope {
        ReplayScope::CurrentSelection => current_node
            .map(|node_id| {
                document
                    .tree
                    .active_line(node_id)
                    .map_err(|error| error.to_string())
            })
            .transpose()?
            .unwrap_or_default(),
        ReplayScope::Mainline => mainline_nodes(document)?,
    };
    for node in line {
        let notation = board
            .chinese_move_notation(node.mv)
            .map_err(|error| error.to_string())?;
        let next = board
            .apply_move(node.mv)
            .map_err(|error| error.to_string())?;
        positions.push((
            next.clone(),
            Some((node.mv.from, node.mv.to)),
            Some(notation),
        ));
        board = next;
    }

    let mut output = File::create(path).map_err(|error| format!("创建动态图失败：{error}"))?;
    let mut encoder = Encoder::new(&mut output, FRAME_WIDTH as u16, FRAME_HEIGHT as u16, &[])
        .map_err(|error| format!("初始化 GIF 失败：{error}"))?;
    let total_moves = positions.len().saturating_sub(1);
    for (index, (position, last_move, notation)) in positions.iter().enumerate() {
        let is_final = index + 1 == positions.len();
        let caption = if index == 0 {
            format!("起始局面 · 共 {total_moves} 着")
        } else if is_final {
            format!(
                "回放结束 · 第 {index} / {total_moves} 着 · {}",
                notation.as_deref().unwrap_or(&document.metadata.title)
            )
        } else {
            format!(
                "第 {index} / {total_moves} 着 · {}",
                notation.as_deref().unwrap_or(&document.metadata.title)
            )
        };
        let mut pixels = render_frame(position, *last_move, &caption)?;
        let mut frame =
            Frame::from_rgba_speed(FRAME_WIDTH as u16, FRAME_HEIGHT as u16, pixels.as_mut(), 30);
        // GIF delay is measured in centiseconds. The extended final frame makes the
        // end state clear even in viewers that force GIFs to loop.
        frame.delay = if index == 0 {
            40
        } else if is_final {
            100
        } else {
            40
        };
        encoder
            .write_frame(&frame)
            .map_err(|error| format!("写入 GIF 帧失败：{error}"))?;
    }
    Ok(())
}

fn mainline_nodes(document: &ManualDocument) -> Result<Vec<&xiangqi_manual::MoveNode>, String> {
    let mut result = Vec::new();
    let mut parent = document.tree.root_id();
    while let Some(node) = mainline_child(document, parent)? {
        parent = node.id;
        result.push(node);
    }
    Ok(result)
}

fn mainline_child<'a>(
    document: &'a ManualDocument,
    parent: uuid::Uuid,
) -> Result<Option<&'a xiangqi_manual::MoveNode>, String> {
    let branches = document
        .tree
        .branches(parent)
        .map_err(|error| error.to_string())?;
    Ok(branches
        .iter()
        .find(|node| node.is_mainline)
        .copied()
        .or_else(|| branches.first().copied()))
}

fn render_frame(
    board: &Board,
    last_move: Option<(Square, Square)>,
    caption: &str,
) -> Result<RgbaImage, String> {
    let mut frame = RgbaImage::from_pixel(FRAME_WIDTH, FRAME_HEIGHT, Rgba([27, 31, 29, 255]));
    draw_filled_rect_mut(
        &mut frame,
        Rect::at(0, 0).of_size(FRAME_WIDTH, HEADER_HEIGHT),
        Rgba([39, 47, 43, 255]),
    );
    let font =
        FontArc::try_from_slice(FONT).map_err(|error| format!("加载中文字体失败：{error}"))?;
    draw_text_mut(
        &mut frame,
        Rgba([238, 228, 204, 255]),
        12,
        10,
        17.0,
        &font,
        caption,
    );

    let mut board_image = decode(BOARD_PNG)?
        .resize_exact(BOARD_WIDTH, BOARD_HEIGHT, FilterType::Lanczos3)
        .to_rgba8();
    apply_desktop_board_theme(&mut board_image);
    imageops::overlay(&mut frame, &board_image, 0, HEADER_HEIGHT as i64);
    if let Some((from, to)) = last_move {
        for square in [from, to] {
            let (x, y) = center(square);
            draw_hollow_circle_mut(
                &mut frame,
                (x as i32, y as i32),
                22,
                Rgba([222, 76, 62, 235]),
            );
            draw_hollow_circle_mut(
                &mut frame,
                (x as i32, y as i32),
                23,
                Rgba([255, 239, 126, 190]),
            );
        }
    }
    for row in 0..10 {
        for col in 0..9 {
            let square = Square { row, col };
            let Some(piece) = board.piece_at(square) else {
                continue;
            };
            let image = decode(piece_png(piece.color, piece.kind))?
                .resize_exact(PIECE_SIZE, PIECE_SIZE, FilterType::Lanczos3)
                .to_rgba8();
            let (x, y) = center(square);
            imageops::overlay(
                &mut frame,
                &image,
                x as i64 - (PIECE_SIZE / 2) as i64,
                y as i64 - (PIECE_SIZE / 2) as i64,
            );
        }
    }
    Ok(frame)
}

fn center(square: Square) -> (u32, u32) {
    let x = (80 + square.col as u32 * 120) * BOARD_WIDTH / 1120;
    let y = HEADER_HEIGHT + (80 + square.row as u32 * 120) * BOARD_HEIGHT / 1240;
    (x, y)
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .decode()
        .map_err(|error| error.to_string())
}

// Mirrors `.board-art` in the desktop stylesheet: invert(1) brightness(.62)
// saturate(1.55). Piece PNGs intentionally retain their original colors.
fn apply_desktop_board_theme(image: &mut RgbaImage) {
    for pixel in image.pixels_mut() {
        let inverted = [
            255.0 - f32::from(pixel[0]),
            255.0 - f32::from(pixel[1]),
            255.0 - f32::from(pixel[2]),
        ];
        let dimmed = [inverted[0] * 0.62, inverted[1] * 0.62, inverted[2] * 0.62];
        let luminance = dimmed[0] * 0.2126 + dimmed[1] * 0.7152 + dimmed[2] * 0.0722;
        for channel in 0..3 {
            pixel[channel] =
                (luminance + (dimmed[channel] - luminance) * 1.55).clamp(0.0, 255.0) as u8;
        }
    }
}

fn piece_png(color: Color, kind: PieceKind) -> &'static [u8] {
    match (color, kind) {
        (Color::Red, PieceKind::King) => include_bytes!("../../public/skins/default/rk.png"),
        (Color::Red, PieceKind::Advisor) => include_bytes!("../../public/skins/default/ra.png"),
        (Color::Red, PieceKind::Elephant) => include_bytes!("../../public/skins/default/rb.png"),
        (Color::Red, PieceKind::Horse) => include_bytes!("../../public/skins/default/rn.png"),
        (Color::Red, PieceKind::Rook) => include_bytes!("../../public/skins/default/rr.png"),
        (Color::Red, PieceKind::Cannon) => include_bytes!("../../public/skins/default/rc.png"),
        (Color::Red, PieceKind::Pawn) => include_bytes!("../../public/skins/default/rp.png"),
        (Color::Black, PieceKind::King) => include_bytes!("../../public/skins/default/bk.png"),
        (Color::Black, PieceKind::Advisor) => include_bytes!("../../public/skins/default/ba.png"),
        (Color::Black, PieceKind::Elephant) => include_bytes!("../../public/skins/default/bb.png"),
        (Color::Black, PieceKind::Horse) => include_bytes!("../../public/skins/default/bn.png"),
        (Color::Black, PieceKind::Rook) => include_bytes!("../../public/skins/default/br.png"),
        (Color::Black, PieceKind::Cannon) => include_bytes!("../../public/skins/default/bc.png"),
        (Color::Black, PieceKind::Pawn) => include_bytes!("../../public/skins/default/bp.png"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiangqi_core::{Move, STARTING_FEN};

    #[test]
    fn writes_animated_gif_with_start_and_move_frames() {
        let mut document = ManualDocument::new(STARTING_FEN).unwrap();
        let root = document.tree.root_id();
        document
            .tree
            .add_move(root, Move::from_iccs("c3c4").unwrap(), "")
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("study.gif");
        export_replay_gif(&target, &document, None, ReplayScope::Mainline).unwrap();
        let bytes = std::fs::read(target).unwrap();
        assert!(bytes.starts_with(b"GIF89a"));
        assert!(bytes.len() > 10_000);
        assert!(
            !bytes
                .windows(b"NETSCAPE2.0".len())
                .any(|window| window == b"NETSCAPE2.0")
        );
    }

    #[test]
    fn board_theme_matches_the_desktop_blue_treatment() {
        let mut image = RgbaImage::from_pixel(1, 1, Rgba([196, 152, 92, 255]));
        apply_desktop_board_theme(&mut image);
        let pixel = image.get_pixel(0, 0);
        assert!(pixel[2] > pixel[0]);
        assert_eq!(pixel[3], 255);
    }
}
