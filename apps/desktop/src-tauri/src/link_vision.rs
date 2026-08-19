use std::path::Path;

use image::{DynamicImage, GenericImageView, RgbImage, imageops::FilterType};
use link_core::{
    BOARD_COLS, BOARD_ROWS, BoardOrientation, RecognitionResult, RecognitionSquare, RecognizedPiece,
};
use ndarray::Array4;
use ort::{session::Session, value::TensorRef};
use xiangqi_core::{Board, Color, Square};

const INPUT_SIZE: usize = 640;
const LABELS: [char; 15] = [
    'n', 'b', 'a', 'k', 'r', 'c', 'p', 'R', 'N', 'A', 'K', 'B', 'C', 'P', '0',
];

#[derive(Debug, Clone)]
pub struct Detection {
    pub label: char,
    pub confidence: f32,
    pub alternatives: Vec<(char, f32)>,
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnIndicatorSlot {
    LeftPlayer,
    RightPlayer,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TurnIndicator {
    pub side: Color,
    pub slot: TurnIndicatorSlot,
    pub confidence: f32,
    pub detail: String,
}

/// 天天象棋复盘截图会把白色空心圈留在走前交叉点，并在走后棋子下方显示白色底光。
/// 这只是视觉证据；调用方仍必须用棋规验证得到的起终点。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenshotMoveMarker {
    /// 天天象棋留在走前交叉点的白色空心圈。
    pub from: Option<Square>,
    /// 天天象棋显示在走后棋子下方的白色底光圈。
    pub to: Option<Square>,
    pub from_confidence: u32,
    pub to_confidence: u32,
}

pub fn board_bounds(detections: &[Detection]) -> Option<(f32, f32, f32, f32)> {
    detections
        .iter()
        .filter(|item| item.label == '0')
        .max_by(|left, right| (left.width * left.height).total_cmp(&(right.width * right.height)))
        .map(|board| {
            (
                board.center_x - board.width / 2.0,
                board.center_y - board.height / 2.0,
                board.width,
                board.height,
            )
        })
}

pub struct Yolo11Detector {
    session: Session,
}

impl Yolo11Detector {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if !path.is_file() {
            return Err(format!("ONNX 模型不存在：{}", path.display()));
        }
        let session = Session::builder()
            .map_err(|error| error.to_string())?
            .with_intra_threads(2)
            .map_err(|error| error.to_string())?
            .commit_from_file(path)
            .map_err(|error| format!("无法加载 ONNX 模型：{error}"))?;
        Ok(Self { session })
    }

    pub fn detect_png(&mut self, bytes: &[u8]) -> Result<Vec<Detection>, String> {
        let image =
            image::load_from_memory(bytes).map_err(|error| format!("无法读取截图：{error}"))?;
        self.detect(image)
    }

    pub fn detect(&mut self, image: DynamicImage) -> Result<Vec<Detection>, String> {
        let (source_width, source_height) = image.dimensions();
        if source_width == 0 || source_height == 0 {
            return Err("截图尺寸无效".into());
        }
        let rate = INPUT_SIZE as f32 / source_width.max(source_height) as f32;
        let resized_width = (source_width as f32 * rate).round().max(1.0) as u32;
        let resized_height = (source_height as f32 * rate).round().max(1.0) as u32;
        let resized = image
            .resize_exact(resized_width, resized_height, FilterType::Triangle)
            .to_rgb8();
        let mut canvas = RgbImage::from_pixel(
            INPUT_SIZE as u32,
            INPUT_SIZE as u32,
            image::Rgb([114, 114, 114]),
        );
        let left = (INPUT_SIZE as u32 - resized_width) / 2;
        let top = (INPUT_SIZE as u32 - resized_height) / 2;
        image::imageops::replace(&mut canvas, &resized, left.into(), top.into());

        let mut values = vec![0.0_f32; INPUT_SIZE * INPUT_SIZE * 3];
        for y in 0..INPUT_SIZE {
            for x in 0..INPUT_SIZE {
                let pixel = canvas.get_pixel(x as u32, y as u32);
                for channel in 0..3 {
                    values[channel * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] =
                        pixel[channel] as f32 / 255.0;
                }
            }
        }
        let input = Array4::from_shape_vec((1, 3, INPUT_SIZE, INPUT_SIZE), values)
            .map_err(|error| error.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs![
                TensorRef::from_array_view(&input).map_err(|error| error.to_string())?
            ])
            .map_err(|error| format!("ONNX 推理失败：{error}"))?;
        let (_, output) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?;
        let stride = 4 + LABELS.len();
        if output.len() % stride != 0 {
            return Err(format!("模型输出格式不支持：{} 个值", output.len()));
        }
        let candidate_count = output.len() / stride;
        let mut detections = Vec::new();
        for index in 0..candidate_count {
            let mut class_index = 0;
            let mut confidence = 0.0_f32;
            let mut alternatives = Vec::with_capacity(LABELS.len());
            for class in 0..LABELS.len() {
                let value = output[index + (class + 4) * candidate_count];
                alternatives.push((LABELS[class], value));
                if value > confidence {
                    confidence = value;
                    class_index = class;
                }
            }
            if confidence < 0.5 {
                continue;
            }
            alternatives.sort_by(|left, right| right.1.total_cmp(&left.1));
            alternatives.truncate(3);
            let center_x = (output[index] - left as f32) / rate;
            let center_y = (output[index + candidate_count] - top as f32) / rate;
            let width = output[index + candidate_count * 2] / rate;
            let height = output[index + candidate_count * 3] / rate;
            detections.push(Detection {
                label: LABELS[class_index],
                confidence,
                alternatives,
                center_x,
                center_y,
                width,
                height,
            });
        }
        Ok(non_maximum_suppression(detections))
    }
}

#[derive(Debug, Clone)]
struct CellCandidate {
    piece: char,
    confidence: f32,
    alternatives: Vec<(char, f32)>,
}

/// Converts the detector's largest board box and the piece centres into the shared 9×10
/// recognition format. The detector always sees visual coordinates; the orientation converts
/// them back to Xiangqi FEN coordinates (black at rank 0).
pub fn recognition_from_detections(
    detections: &[Detection],
    current: &Board,
) -> Result<RecognitionResult, String> {
    let board = detections
        .iter()
        .filter(|item| item.label == '0')
        .max_by(|left, right| (left.width * left.height).total_cmp(&(right.width * right.height)))
        .ok_or("未检测到完整棋盘，请保持第三方棋盘完整可见后重新框选")?;
    if board.width < 80.0 || board.height < 80.0 {
        return Err("检测到的棋盘区域过小，请重新框选".into());
    }
    let board_left = board.center_x - board.width / 2.0;
    let board_top = board.center_y - board.height / 2.0;
    let board_right = board.center_x + board.width / 2.0;
    let board_bottom = board.center_y + board.height / 2.0;
    let cell_width = board.width / 8.0;
    let cell_height = board.height / 9.0;
    let margin_x = cell_width * 0.45;
    let margin_y = cell_height * 0.45;
    let pieces: Vec<_> = detections
        .iter()
        .filter(|item| item.label != '0')
        .filter(|item| {
            item.center_x >= board_left - margin_x
                && item.center_x <= board_right + margin_x
                && item.center_y >= board_top - margin_y
                && item.center_y <= board_bottom + margin_y
        })
        .collect();
    let red_y = average_y(&pieces, true);
    let black_y = average_y(&pieces, false);
    let orientation = match (red_y, black_y) {
        (Some(red), Some(black)) if red < black => BoardOrientation::BlackAtBottom,
        _ => BoardOrientation::RedAtBottom,
    };
    let mut cells: [[Option<CellCandidate>; BOARD_COLS as usize]; BOARD_ROWS as usize] =
        std::array::from_fn(|_| std::array::from_fn(|_| None));
    for detection in pieces {
        let visual_col = ((detection.center_x - board_left) / cell_width).round() as i32;
        let visual_row = ((detection.center_y - board_top) / cell_height).round() as i32;
        if !(0..BOARD_COLS as i32).contains(&visual_col)
            || !(0..BOARD_ROWS as i32).contains(&visual_row)
        {
            continue;
        }
        let (row, col) = match orientation {
            BoardOrientation::RedAtBottom => (visual_row as usize, visual_col as usize),
            BoardOrientation::BlackAtBottom => (
                BOARD_ROWS as usize - 1 - visual_row as usize,
                BOARD_COLS as usize - 1 - visual_col as usize,
            ),
        };
        let piece = fen_piece(detection.label)?;
        if cells[row][col]
            .as_ref()
            .is_some_and(|candidate| candidate.confidence >= detection.confidence)
        {
            continue;
        }
        cells[row][col] = Some(CellCandidate {
            piece,
            confidence: detection.confidence,
            alternatives: detection.alternatives.clone(),
        });
    }
    repair_missing_kings(&mut cells)?;
    let mut ranks = Vec::with_capacity(BOARD_ROWS as usize);
    let mut squares = Vec::with_capacity((BOARD_ROWS * BOARD_COLS) as usize);
    let mut total = 0.0_f32;
    let mut seen = 0_u32;
    for row in 0..BOARD_ROWS as usize {
        let mut rank = String::new();
        let mut empty = 0_u8;
        for col in 0..BOARD_COLS as usize {
            if let Some(candidate) = &cells[row][col] {
                if empty > 0 {
                    rank.push(char::from_digit(empty as u32, 10).unwrap());
                    empty = 0;
                }
                rank.push(candidate.piece);
                total += candidate.confidence;
                seen += 1;
                squares.push(RecognitionSquare {
                    row: row as u8,
                    col: col as u8,
                    piece: Some(recognized_piece(candidate.piece)?),
                    confidence: candidate.confidence,
                });
            } else {
                empty += 1;
                squares.push(RecognitionSquare {
                    row: row as u8,
                    col: col as u8,
                    piece: None,
                    confidence: 1.0,
                });
            }
        }
        if empty > 0 {
            rank.push(char::from_digit(empty as u32, 10).unwrap());
        }
        ranks.push(rank);
    }
    let side = match current.side_to_move() {
        Color::Red => "w",
        Color::Black => "b",
    };
    Ok(RecognitionResult {
        fen: format!("{} {side} - - 0 1", ranks.join("/")),
        source: link_core::CaptureSource::WindowLink,
        recognition_mode: link_core::RecognitionMode::YoloBoard,
        corners: None,
        perspective_rectified: false,
        orientation,
        squares,
        confidence: if seen == 0 { 0.0 } else { total / seen as f32 },
    })
}

pub fn recognition_with_side_to_move(
    mut recognition: RecognitionResult,
    side: Color,
) -> RecognitionResult {
    recognition.fen = fen_with_side_to_move(&recognition.fen, side);
    recognition
}

pub fn fen_with_side_to_move(fen: &str, side: Color) -> String {
    let mut fields = fen.split_whitespace().collect::<Vec<_>>();
    if fields.len() >= 2 {
        fields[1] = match side {
            Color::Red => "w",
            Color::Black => "b",
        };
        fields.join(" ")
    } else {
        fen.to_owned()
    }
}

pub fn detect_turn_indicator_from_png(
    bytes: &[u8],
    detections: &[Detection],
    orientation: BoardOrientation,
) -> Result<Option<TurnIndicator>, String> {
    let image =
        image::load_from_memory(bytes).map_err(|error| format!("无法读取轮走提示截图：{error}"))?;
    Ok(detect_turn_indicator(&image, detections, orientation))
}

pub fn detect_screenshot_move_marker_from_png(
    bytes: &[u8],
    detections: &[Detection],
    orientation: BoardOrientation,
) -> Result<Option<ScreenshotMoveMarker>, String> {
    let image =
        image::load_from_memory(bytes).map_err(|error| format!("无法读取截图走子标记：{error}"))?;
    Ok(detect_screenshot_move_marker(
        &image,
        detections,
        orientation,
    ))
}

fn detect_screenshot_move_marker(
    image: &DynamicImage,
    detections: &[Detection],
    orientation: BoardOrientation,
) -> Option<ScreenshotMoveMarker> {
    let (left, top, width, height) = board_bounds(detections)?;
    if width < 160.0 || height < 180.0 {
        return None;
    }
    let rgb = image.to_rgb8();
    let cell_width = width / 8.0;
    let cell_height = height / 9.0;
    let pieces: Vec<_> = detections.iter().filter(|item| item.label != '0').collect();

    let selected = pieces
        .iter()
        .filter_map(|piece| {
            let score = white_halo_score(
                &rgb,
                piece.center_x,
                piece.center_y,
                piece.width.max(piece.height),
            );
            (score >= 16).then_some((piece, score))
        })
        .max_by_key(|(_, score)| *score);

    let target = (0..BOARD_ROWS)
        .flat_map(|visual_row| (0..BOARD_COLS).map(move |visual_col| (visual_row, visual_col)))
        .filter_map(|(visual_row, visual_col)| {
            let x = left + visual_col as f32 * cell_width;
            let y = top + visual_row as f32 * cell_height;
            // The target circle is always on an empty crossing. Avoid treating a
            // pale piece edge as a target marker.
            let near_piece = pieces.iter().any(|piece| {
                (piece.center_x - x).hypot(piece.center_y - y)
                    < piece.width.max(piece.height) * 0.42
            });
            (!near_piece).then_some((
                (visual_row, visual_col),
                white_target_ring_score(&rgb, x, y, cell_width.min(cell_height)),
            ))
        })
        .max_by_key(|(_, score)| *score);
    let destination = selected.and_then(|(piece, score)| {
        let second = pieces
            .iter()
            .filter(|other| !std::ptr::eq(*other, piece))
            .map(|other| {
                white_halo_score(
                    &rgb,
                    other.center_x,
                    other.center_y,
                    other.width.max(other.height),
                )
            })
            .max()
            .unwrap_or_default();
        (score >= 16 && score >= second.saturating_add(4))
            .then(|| {
                let col = ((piece.center_x - left) / cell_width).round() as i32;
                let row = ((piece.center_y - top) / cell_height).round() as i32;
                ((0..BOARD_COLS as i32).contains(&col) && (0..BOARD_ROWS as i32).contains(&row))
                    .then_some((visual_square(row as u8, col as u8, orientation), score))
            })
            .flatten()
    });
    let source = target.and_then(|((row, col), score)| {
        (score >= 13).then_some((visual_square(row, col, orientation), score))
    });
    if destination.is_none() && source.is_none() {
        return None;
    }
    // 天天象棋复盘截图的白色空心圈留在走前交叉点，白色棋子底光圈
    // 标在已经走到的棋子下方。因此空心圈是起点，白底棋子是终点。
    Some(ScreenshotMoveMarker {
        from: source.map(|(square, _)| square),
        to: destination.map(|(square, _)| square),
        from_confidence: source.map(|(_, score)| score).unwrap_or_default(),
        to_confidence: destination.map(|(_, score)| score).unwrap_or_default(),
    })
}

fn visual_square(visual_row: u8, visual_col: u8, orientation: BoardOrientation) -> Square {
    match orientation {
        BoardOrientation::RedAtBottom => Square {
            row: visual_row,
            col: visual_col,
        },
        BoardOrientation::BlackAtBottom => Square {
            row: BOARD_ROWS - 1 - visual_row,
            col: BOARD_COLS - 1 - visual_col,
        },
    }
}

fn is_marker_white(pixel: &image::Rgb<u8>) -> bool {
    // 天天象棋的标记是叠加在木纹上的半透明乳白色，并非纯白。JPEG
    // 压缩后常带少量暖色，不能再用三个通道几乎相等的纯白条件。
    let peak = pixel[0].max(pixel[1]).max(pixel[2]);
    let floor = pixel[0].min(pixel[1]).min(pixel[2]);
    peak >= 205 && floor >= 175 && peak.saturating_sub(floor) <= 64
}

fn white_target_ring_score(image: &RgbImage, x: f32, y: f32, cell: f32) -> u32 {
    let radius = (cell * 0.24).clamp(8.0, 26.0);
    let tolerance = (cell * 0.055).clamp(2.0, 5.0);
    let mut score: u32 = 0;
    let mut arc_hits = [0u32; 8];
    for dy in -(radius as i32 + 4)..=(radius as i32 + 4) {
        for dx in -(radius as i32 + 4)..=(radius as i32 + 4) {
            let distance = ((dx * dx + dy * dy) as f32).sqrt();
            if (distance - radius).abs() <= tolerance {
                let px = x.round() as i32 + dx;
                let py = y.round() as i32 + dy;
                if px >= 0
                    && py >= 0
                    && px < image.width() as i32
                    && py < image.height() as i32
                    && is_marker_white(image.get_pixel(px as u32, py as u32))
                {
                    score += 1;
                    let angle = (dy as f32).atan2(dx as f32);
                    let sector = (((angle + std::f32::consts::PI) / (std::f32::consts::TAU) * 8.0)
                        as usize)
                        .min(7);
                    arc_hits[sector] += 1;
                }
            }
        }
    }
    // A partial white circle is enough, provided it covers more than one arc.
    // This rejects a single bright wood-grain streak while accepting the broken
    // ring visible beside a selected 天天象棋 piece.
    let arcs = arc_hits.into_iter().filter(|hits| *hits >= 2).count() as u32;
    if arcs >= 2 {
        score.saturating_add(arcs * 5)
    } else {
        0
    }
}

fn white_halo_score(image: &RgbImage, x: f32, y: f32, piece_size: f32) -> u32 {
    let radius = (piece_size * 0.60).clamp(11.0, 42.0);
    let tolerance = (piece_size * 0.15).clamp(3.0, 9.0);
    let mut score: u32 = 0;
    let mut lower_base_hits: u32 = 0;
    for dy in -(radius as i32 + 8)..=(radius as i32 + 8) {
        for dx in -(radius as i32 + 8)..=(radius as i32 + 8) {
            let distance = ((dx * dx + dy * dy) as f32).sqrt();
            if (distance - radius).abs() <= tolerance {
                let px = x.round() as i32 + dx;
                let py = y.round() as i32 + dy;
                if px >= 0
                    && py >= 0
                    && px < image.width() as i32
                    && py < image.height() as i32
                    && is_marker_white(image.get_pixel(px as u32, py as u32))
                {
                    score += 1;
                    // The destination cue is frequently only visible beneath a
                    // piece, because the stone covers the upper half of the halo.
                    if dy > 0 {
                        lower_base_hits += 1;
                    }
                }
            }
        }
    }
    // A full halo yields a high annulus score. For phone screenshots accept a
    // strong lower-base crescent as the same destination evidence.
    if score >= 12 && lower_base_hits >= 5 {
        score.saturating_add(lower_base_hits / 2)
    } else {
        0
    }
}

fn detect_turn_indicator(
    image: &DynamicImage,
    detections: &[Detection],
    orientation: BoardOrientation,
) -> Option<TurnIndicator> {
    let (board_left, board_top, board_width, board_height) = board_bounds(detections)?;
    let board_right = board_left + board_width;
    let image_width = image.width();
    let image_height = image.height();
    if image_width < 160 || image_height < 120 {
        return None;
    }
    let side_panel_left = (board_right + board_width * 0.03).max(0.0);
    let side_panel_width = image_width as f32 - side_panel_left;
    if side_panel_width < board_width * 0.18 || side_panel_width < 96.0 {
        return None;
    }
    let top = (board_top - board_height * 0.12).max(0.0) as u32;
    let bottom = (board_top + board_height * 0.34)
        .min(image_height as f32)
        .max(top as f32) as u32;
    let left = side_panel_left.min(image_width as f32) as u32;
    let right = image_width;
    if bottom <= top + 8 || right <= left + 8 {
        return None;
    }
    let split = left + ((right - left) as f32 * 0.52) as u32;
    let rgb = image.to_rgb8();
    let mut left_score = 0_u32;
    let mut right_score = 0_u32;
    for y in top..bottom {
        for x in left..right {
            let pixel = rgb.get_pixel(x, y);
            if is_turn_green(pixel[0], pixel[1], pixel[2]) {
                if x < split {
                    left_score = left_score.saturating_add(1);
                } else {
                    right_score = right_score.saturating_add(1);
                }
            }
        }
    }
    let total = left_score + right_score;
    if total < 36 {
        return None;
    }
    let (slot, dominant, other) = if left_score > right_score {
        (TurnIndicatorSlot::LeftPlayer, left_score, right_score)
    } else {
        (TurnIndicatorSlot::RightPlayer, right_score, left_score)
    };
    if dominant < 48 || dominant < other.saturating_mul(3) / 2 {
        return None;
    }
    let side = turn_side_for_slot(slot, orientation);
    let confidence = dominant as f32 / total.max(1) as f32;
    let detail = format!(
        "轮走识别：{}头像高亮 → {}行棋",
        match slot {
            TurnIndicatorSlot::LeftPlayer => "左侧",
            TurnIndicatorSlot::RightPlayer => "右侧",
        },
        side_label(side)
    );
    Some(TurnIndicator {
        side,
        slot,
        confidence,
        detail,
    })
}

fn is_turn_green(red: u8, green: u8, blue: u8) -> bool {
    green >= 145
        && green as u16 >= red as u16 + 45
        && green as u16 >= blue as u16 + 35
        && green as f32 >= red as f32 * 1.28
        && green as f32 >= blue as f32 * 1.18
}

fn turn_side_for_slot(slot: TurnIndicatorSlot, orientation: BoardOrientation) -> Color {
    let bottom_side = match orientation {
        BoardOrientation::RedAtBottom => Color::Red,
        BoardOrientation::BlackAtBottom => Color::Black,
    };
    let top_side = bottom_side.opposite();
    match slot {
        // 天天象棋横屏对局中，左侧头像通常对应棋盘顶方，右侧头像对应棋盘底方。
        TurnIndicatorSlot::LeftPlayer => top_side,
        TurnIndicatorSlot::RightPlayer => bottom_side,
    }
}

fn side_label(side: Color) -> &'static str {
    match side {
        Color::Red => "红方",
        Color::Black => "黑方",
    }
}

fn repair_missing_kings(
    cells: &mut [[Option<CellCandidate>; BOARD_COLS as usize]; BOARD_ROWS as usize],
) -> Result<(), String> {
    repair_missing_king(cells, true)?;
    repair_missing_king(cells, false)
}

fn repair_missing_king(
    cells: &mut [[Option<CellCandidate>; BOARD_COLS as usize]; BOARD_ROWS as usize],
    red: bool,
) -> Result<(), String> {
    let king = if red { 'K' } else { 'k' };
    let advisor = if red { 'A' } else { 'a' };
    let side = if red { "红帅" } else { "黑将" };
    let king_count = cells
        .iter()
        .flatten()
        .filter(|cell| {
            cell.as_ref()
                .is_some_and(|candidate| candidate.piece == king)
        })
        .count();
    if king_count > 1 {
        return Err(format!("识别到多个{side}，请重新框选或等待画面稳定"));
    }
    if king_count == 1 {
        return Ok(());
    }

    let mut candidates = Vec::new();
    for (row, rank) in cells.iter().enumerate() {
        for (col, cell) in rank.iter().enumerate() {
            let Some(candidate) = cell else {
                continue;
            };
            if candidate.piece != advisor || !in_palace(row, col, red) {
                continue;
            }
            let Some((_, king_confidence)) = candidate
                .alternatives
                .iter()
                .find(|(label, _)| *label == king)
                .copied()
            else {
                continue;
            };
            if king_confidence >= 0.35 {
                candidates.push((row, col, king_confidence));
            }
        }
    }

    match candidates.as_slice() {
        [(row, col, king_confidence)] => {
            if let Some(candidate) = &mut cells[*row][*col] {
                candidate.piece = king;
                candidate.confidence = candidate.confidence.max(*king_confidence);
            }
            Ok(())
        }
        [] => Err(format!("缺少{side}；九宫内未发现可安全修正的{side}候选")),
        many => Err(format!(
            "缺少{side}；九宫内有 {} 个疑似{side}候选，需要重新框选或等待画面稳定",
            many.len()
        )),
    }
}

fn in_palace(row: usize, col: usize, red: bool) -> bool {
    (3..=5).contains(&col)
        && if red {
            (7..=9).contains(&row)
        } else {
            row <= 2
        }
}

fn average_y(items: &[&Detection], red: bool) -> Option<f32> {
    let values: Vec<_> = items
        .iter()
        .filter(|item| item.label.is_ascii_uppercase() == red)
        .map(|item| item.center_y)
        .collect();
    (!values.is_empty()).then(|| values.iter().sum::<f32>() / values.len() as f32)
}

fn fen_piece(label: char) -> Result<char, String> {
    if LABELS.contains(&label) && label != '0' {
        Ok(label)
    } else {
        Err("模型返回了未知棋子标签".into())
    }
}

fn recognized_piece(piece: char) -> Result<RecognizedPiece, String> {
    Ok(match piece {
        'K' => RecognizedPiece::RedKing,
        'A' => RecognizedPiece::RedAdvisor,
        'B' => RecognizedPiece::RedElephant,
        'N' => RecognizedPiece::RedHorse,
        'R' => RecognizedPiece::RedRook,
        'C' => RecognizedPiece::RedCannon,
        'P' => RecognizedPiece::RedPawn,
        'k' => RecognizedPiece::BlackKing,
        'a' => RecognizedPiece::BlackAdvisor,
        'b' => RecognizedPiece::BlackElephant,
        'n' => RecognizedPiece::BlackHorse,
        'r' => RecognizedPiece::BlackRook,
        'c' => RecognizedPiece::BlackCannon,
        'p' => RecognizedPiece::BlackPawn,
        _ => return Err("模型返回了未知棋子标签".into()),
    })
}

fn non_maximum_suppression(mut detections: Vec<Detection>) -> Vec<Detection> {
    detections.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    let mut kept: Vec<Detection> = Vec::new();
    for detection in detections {
        if kept
            .iter()
            .all(|other| other.label != detection.label || iou(other, &detection) < 0.45)
        {
            kept.push(detection);
        }
    }
    kept
}

fn iou(left: &Detection, right: &Detection) -> f32 {
    let left_x1 = left.center_x - left.width / 2.0;
    let left_y1 = left.center_y - left.height / 2.0;
    let left_x2 = left.center_x + left.width / 2.0;
    let left_y2 = left.center_y + left.height / 2.0;
    let right_x1 = right.center_x - right.width / 2.0;
    let right_y1 = right.center_y - right.height / 2.0;
    let right_x2 = right.center_x + right.width / 2.0;
    let right_y2 = right.center_y + right.height / 2.0;
    let intersection_width = (left_x2.min(right_x2) - left_x1.max(right_x1)).max(0.0);
    let intersection_height = (left_y2.min(right_y2) - left_y1.max(right_y1)).max(0.0);
    let intersection = intersection_width * intersection_height;
    intersection
        / (left.width * left.height + right.width * right.height - intersection).max(0.0001)
}

#[cfg(test)]
mod tests {
    use super::{
        Detection, TurnIndicatorSlot, Yolo11Detector, detect_screenshot_move_marker,
        detect_turn_indicator, fen_with_side_to_move, iou, non_maximum_suppression,
        recognition_from_detections,
    };
    use image::{DynamicImage, Rgb, RgbImage};
    use std::path::PathBuf;
    use xiangqi_core::{Board, Color, Square};

    fn detection(confidence: f32) -> Detection {
        Detection {
            label: 'R',
            confidence,
            alternatives: vec![('R', confidence)],
            center_x: 10.0,
            center_y: 10.0,
            width: 8.0,
            height: 8.0,
        }
    }

    #[test]
    fn suppression_keeps_the_highest_confidence_duplicate() {
        let result = non_maximum_suppression(vec![detection(0.6), detection(0.9)]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].confidence, 0.9);
    }

    #[test]
    fn iou_is_zero_for_disjoint_boxes() {
        let mut second = detection(0.8);
        second.center_x = 40.0;
        assert_eq!(iou(&detection(0.9), &second), 0.0);
    }

    #[test]
    fn maps_visual_piece_centres_to_a_fen_grid() {
        let current = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut board = detection(0.99);
        board.label = '0';
        board.center_x = 400.0;
        board.center_y = 450.0;
        board.width = 320.0;
        board.height = 360.0;
        let mut black = detection(0.98);
        black.label = 'k';
        black.center_x = 400.0;
        black.center_y = 270.0;
        let mut red = detection(0.97);
        red.label = 'K';
        red.center_x = 400.0;
        red.center_y = 630.0;
        let recognition = recognition_from_detections(&[board, black, red], &current).unwrap();
        assert_eq!(recognition.fen, "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
        assert_eq!(recognition.squares.len(), 90);
    }

    #[test]
    fn rotates_black_perspective_board_back_to_canonical_fen() {
        let current = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut board = detection(0.99);
        board.label = '0';
        board.center_x = 400.0;
        board.center_y = 450.0;
        board.width = 320.0;
        board.height = 360.0;
        let mut red = detection(0.97);
        red.label = 'K';
        red.center_x = 400.0;
        red.center_y = 270.0;
        let mut black = detection(0.98);
        black.label = 'k';
        black.center_x = 400.0;
        black.center_y = 630.0;

        let recognition = recognition_from_detections(&[board, red, black], &current).unwrap();

        assert_eq!(
            recognition.orientation,
            link_core::BoardOrientation::BlackAtBottom
        );
        assert_eq!(recognition.fen, "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    }

    #[test]
    fn ignores_floating_preview_board_and_keeps_highest_confidence_piece_per_cell() {
        let current = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut target_board = detection(0.99);
        target_board.label = '0';
        target_board.center_x = 400.0;
        target_board.center_y = 450.0;
        target_board.width = 320.0;
        target_board.height = 360.0;
        let mut preview_board = target_board.clone();
        preview_board.center_x = 900.0;
        preview_board.center_y = 450.0;
        preview_board.width = 180.0;
        preview_board.height = 200.0;

        let mut black_king = detection(0.96);
        black_king.label = 'k';
        black_king.center_x = 400.0;
        black_king.center_y = 270.0;
        let mut duplicate_lower_confidence = black_king.clone();
        duplicate_lower_confidence.label = 'a';
        duplicate_lower_confidence.confidence = 0.61;
        let mut red_king = detection(0.97);
        red_king.label = 'K';
        red_king.center_x = 400.0;
        red_king.center_y = 630.0;
        let mut preview_red_king = detection(0.99);
        preview_red_king.label = 'K';
        preview_red_king.center_x = 900.0;
        preview_red_king.center_y = 550.0;

        let recognition = recognition_from_detections(
            &[
                target_board,
                preview_board,
                black_king,
                duplicate_lower_confidence,
                red_king,
                preview_red_king,
            ],
            &current,
        )
        .unwrap();

        assert_eq!(recognition.fen, "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
        assert!(recognition.confidence > 0.95);
    }

    #[test]
    fn repairs_unique_king_advisor_confusion_inside_palace() {
        let current = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut board = detection(0.99);
        board.label = '0';
        board.center_x = 400.0;
        board.center_y = 450.0;
        board.width = 320.0;
        board.height = 360.0;
        let mut black_as_advisor = detection(0.72);
        black_as_advisor.label = 'a';
        black_as_advisor.alternatives = vec![('a', 0.72), ('k', 0.57), ('b', 0.21)];
        black_as_advisor.center_x = 400.0;
        black_as_advisor.center_y = 270.0;
        let mut red_as_advisor = detection(0.74);
        red_as_advisor.label = 'A';
        red_as_advisor.alternatives = vec![('A', 0.74), ('K', 0.61), ('B', 0.25)];
        red_as_advisor.center_x = 400.0;
        red_as_advisor.center_y = 630.0;

        let recognition =
            recognition_from_detections(&[board, black_as_advisor, red_as_advisor], &current)
                .unwrap();

        assert_eq!(recognition.fen, "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    }

    #[test]
    fn rejects_ambiguous_missing_king_candidates() {
        let current = Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap();
        let mut board = detection(0.99);
        board.label = '0';
        board.center_x = 400.0;
        board.center_y = 450.0;
        board.width = 320.0;
        board.height = 360.0;
        let mut black_one = detection(0.72);
        black_one.label = 'a';
        black_one.alternatives = vec![('a', 0.72), ('k', 0.57), ('b', 0.21)];
        black_one.center_x = 360.0;
        black_one.center_y = 270.0;
        let mut black_two = black_one.clone();
        black_two.center_x = 440.0;
        let mut red = detection(0.97);
        red.label = 'K';
        red.center_x = 400.0;
        red.center_y = 630.0;

        let error =
            recognition_from_detections(&[board, black_one, black_two, red], &current).unwrap_err();

        assert!(error.contains("缺少黑将"));
        assert!(error.contains("2 个疑似黑将候选"));
    }

    #[test]
    fn detects_right_avatar_turn_as_bottom_side_on_red_bottom_board() {
        let image = synthetic_turn_image(true);
        let board = synthetic_board_detection();

        let indicator = detect_turn_indicator(
            &DynamicImage::ImageRgb8(image),
            &[board],
            link_core::BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(indicator.slot, TurnIndicatorSlot::RightPlayer);
        assert_eq!(indicator.side, Color::Red);
        assert!(indicator.detail.contains("右侧头像高亮"));
        assert!(indicator.detail.contains("红方行棋"));
    }

    #[test]
    fn detects_left_avatar_turn_as_top_side_on_red_bottom_board() {
        let image = synthetic_turn_image(false);
        let board = synthetic_board_detection();

        let indicator = detect_turn_indicator(
            &DynamicImage::ImageRgb8(image),
            &[board],
            link_core::BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(indicator.slot, TurnIndicatorSlot::LeftPlayer);
        assert_eq!(indicator.side, Color::Black);
    }

    #[test]
    fn rewrites_recognized_fen_side_to_move() {
        assert_eq!(
            fen_with_side_to_move("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", Color::Black),
            "4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1"
        );
    }

    #[test]
    fn recognizes_tiantian_selected_piece_and_target_ring_as_a_move_marker() {
        let mut image = RgbImage::from_pixel(720, 840, Rgb([130, 94, 58]));
        let board = synthetic_board_detection();
        let board_left = board.center_x - board.width / 2.0;
        let board_top = board.center_y - board.height / 2.0;
        let cell_width = board.width / 8.0;
        let cell_height = board.height / 9.0;
        let mut horse = detection(0.94);
        horse.label = 'N';
        horse.center_x = board_left + cell_width * 2.0;
        horse.center_y = board_top + cell_height * 7.0;
        horse.width = 48.0;
        horse.height = 48.0;
        draw_white_ring(&mut image, horse.center_x, horse.center_y, 29.0, 4.0);
        draw_white_ring(
            &mut image,
            board_left + cell_width * 3.0,
            board_top + cell_height * 5.0,
            15.0,
            3.0,
        );

        let marker = detect_screenshot_move_marker(
            &DynamicImage::ImageRgb8(image),
            &[board, horse],
            link_core::BoardOrientation::RedAtBottom,
        )
        .expect("white selected-piece halo and target ring");

        assert_eq!(marker.from, Some(Square { row: 5, col: 3 }));
        assert_eq!(marker.to, Some(Square { row: 7, col: 2 }));
        assert!(marker.from_confidence > 0);
        assert!(marker.to_confidence > 0);
    }

    #[test]
    fn recognizes_partial_phone_screenshot_ring_and_piece_base_glow() {
        // Matches the non-ideal mobile rendering: a broken source circle and
        // only the lower crescent of the destination piece's white base glow.
        let mut image = RgbImage::from_pixel(720, 840, Rgb([167, 122, 73]));
        let board = synthetic_board_detection();
        let board_left = board.center_x - board.width / 2.0;
        let board_top = board.center_y - board.height / 2.0;
        let cell_width = board.width / 8.0;
        let cell_height = board.height / 9.0;
        let mut rook = detection(0.95);
        rook.label = 'R';
        rook.center_x = board_left + cell_width * 6.0;
        rook.center_y = board_top + cell_height * 6.0;
        rook.width = 54.0;
        rook.height = 54.0;
        draw_white_arc(
            &mut image,
            board_left + cell_width * 7.0,
            board_top + cell_height * 6.0,
            15.0,
            3.0,
            0.2,
            5.4,
        );
        draw_white_arc(
            &mut image,
            rook.center_x,
            rook.center_y,
            32.0,
            5.0,
            0.15,
            2.95,
        );

        let marker = detect_screenshot_move_marker(
            &DynamicImage::ImageRgb8(image),
            &[board, rook],
            link_core::BoardOrientation::RedAtBottom,
        )
        .expect("partial source ring and lower destination glow");

        assert_eq!(marker.from, Some(Square { row: 6, col: 7 }));
        assert_eq!(marker.to, Some(Square { row: 6, col: 6 }));
    }

    #[test]
    fn yolo11_anonymous_mobile_fixture_recognizes_or_safely_degrades() {
        // This is a real, privacy-sanitized 天天象棋 board crop. It intentionally
        // exercises the model rather than synthetic `Detection` values. The
        // fixture is allowed to degrade to manual correction when a model update
        // cannot reconstruct an exact, legal board; it must never create a move
        // from the white visual marks alone.
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let model = manifest_dir.join("resources/link-vision/yolov11.onnx");
        let fixture = include_bytes!("../tests/fixtures/tiantian-black-bottom-board.jpg");
        let current = Board::from_fen(
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
        )
        .expect("standard Xiangqi starting board");
        const EXPECTED_FEN: &str =
            "1r1akabn1/3r5/nc2b2c1/p1N1p1p1p/9/2R6/P3P1P1P/1C2C1N2/9/1RBAKAB2 w - - 0 1";

        let mut detector = Yolo11Detector::open(&model).unwrap_or_else(|error| {
            panic!("bundled YOLO11 model must load for fixture regression: {error}")
        });
        let detections = detector.detect_png(fixture).unwrap_or_else(|error| {
            panic!("YOLO11 must infer the bundled anonymous fixture: {error}")
        });

        assert!(
            detections.iter().any(|detection| detection.label == '0'),
            "fixture must contain a model-detected board region"
        );

        match recognition_from_detections(&detections, &current) {
            Ok(recognition) => {
                assert_eq!(
                    recognition.orientation,
                    link_core::BoardOrientation::BlackAtBottom,
                    "the fixture was intentionally captured from the black-at-bottom view"
                );
                assert_eq!(
                    recognition.fen, EXPECTED_FEN,
                    "the fixed YOLO11 model must reconstruct the known anonymous board placement"
                );
                assert_eq!(recognition.squares.len(), 90);
                Board::from_fen(&recognition.fen)
                    .expect("a recognized fixture board must remain a valid Xiangqi FEN");
            }
            Err(error) => {
                // The production flow maps these failures to `NeedsManualCorrection`.
                // Do not accept arbitrary inference failures as a safe fallback.
                assert!(
                    error.contains("未检测到完整棋盘")
                        || error.contains("棋盘区域过小")
                        || error.contains("缺少")
                        || error.contains("多个"),
                    "only an explicit board-recognition failure may use manual correction: {error}"
                );
            }
        }
    }

    fn synthetic_board_detection() -> Detection {
        let mut board = detection(0.99);
        board.label = '0';
        board.center_x = 330.0;
        board.center_y = 360.0;
        board.width = 520.0;
        board.height = 580.0;
        board
    }

    fn synthetic_turn_image(right_avatar: bool) -> RgbImage {
        let mut image = RgbImage::from_pixel(1080, 760, Rgb([70, 52, 36]));
        let (left, top) = if right_avatar { (930, 92) } else { (710, 92) };
        for y in top..top + 72 {
            for x in left..left + 72 {
                let on_border = !(8..64).contains(&(x - left)) || !(8..64).contains(&(y - top));
                if on_border {
                    image.put_pixel(x, y, Rgb([24, 215, 57]));
                }
            }
        }
        image
    }

    fn draw_white_ring(image: &mut RgbImage, x: f32, y: f32, radius: f32, thickness: f32) {
        for dy in -(radius as i32 + 4)..=(radius as i32 + 4) {
            for dx in -(radius as i32 + 4)..=(radius as i32 + 4) {
                let distance = ((dx * dx + dy * dy) as f32).sqrt();
                if (distance - radius).abs() <= thickness {
                    let px = x.round() as i32 + dx;
                    let py = y.round() as i32 + dy;
                    if px >= 0 && py >= 0 && px < image.width() as i32 && py < image.height() as i32
                    {
                        image.put_pixel(px as u32, py as u32, Rgb([248, 248, 236]));
                    }
                }
            }
        }
    }

    fn draw_white_arc(
        image: &mut RgbImage,
        x: f32,
        y: f32,
        radius: f32,
        thickness: f32,
        start: f32,
        end: f32,
    ) {
        for dy in -(radius as i32 + 4)..=(radius as i32 + 4) {
            for dx in -(radius as i32 + 4)..=(radius as i32 + 4) {
                let distance = ((dx * dx + dy * dy) as f32).sqrt();
                let angle = (dy as f32)
                    .atan2(dx as f32)
                    .rem_euclid(std::f32::consts::TAU);
                if (distance - radius).abs() <= thickness && angle >= start && angle <= end {
                    let px = x.round() as i32 + dx;
                    let py = y.round() as i32 + dy;
                    if px >= 0 && py >= 0 && px < image.width() as i32 && py < image.height() as i32
                    {
                        image.put_pixel(px as u32, py as u32, Rgb([222, 212, 196]));
                    }
                }
            }
        }
    }
}
