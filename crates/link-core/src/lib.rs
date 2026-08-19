use serde::{Deserialize, Serialize};
use thiserror::Error;
use xiangqi_core::{Board, Color, Move, PieceKind, Square};

pub const BOARD_ROWS: u8 = 10;
pub const BOARD_COLS: u8 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureSource {
    WindowLink,
    DesktopDetect,
    ImageImport,
    CameraBoard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecognitionMode {
    YoloBoard,
    PerspectiveGrid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkMode {
    Spectate,
    ConfirmPlay,
    AutoPlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkSessionState {
    Stopped,
    DetectingCorners,
    RectifyingBoard,
    ClassifyingSquares,
    Calibrating,
    NeedsManualCorrection,
    WaitingStableFrames,
    Tracking,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardCorners {
    pub top_left: Point,
    pub top_right: Point,
    pub bottom_right: Point,
    pub bottom_left: Point,
}

impl BoardCorners {
    /// Orders four arbitrary corner detections into the board's visual reading order.
    ///
    /// The caller remains responsible for selecting the board region; this helper only
    /// establishes a stable orientation for perspective rectification.
    pub fn ordered(points: [Point; 4]) -> Result<Self, GeometryError> {
        let mut sorted = points;
        sorted.sort_by(|left, right| left.y.total_cmp(&right.y));
        let (mut top, mut bottom) = ([sorted[0], sorted[1]], [sorted[2], sorted[3]]);
        top.sort_by(|left, right| left.x.total_cmp(&right.x));
        bottom.sort_by(|left, right| left.x.total_cmp(&right.x));
        let corners = Self {
            top_left: top[0],
            top_right: top[1],
            bottom_right: bottom[1],
            bottom_left: bottom[0],
        };
        corners.homography()?;
        Ok(corners)
    }

    pub fn grid_point(&self, row: u8, col: u8) -> Option<Point> {
        if row >= BOARD_ROWS || col >= BOARD_COLS {
            return None;
        }
        let homography = self.homography().ok()?;
        let u = col as f32 / (BOARD_COLS - 1) as f32;
        let v = row as f32 / (BOARD_ROWS - 1) as f32;
        homography.project(u, v)
    }

    fn homography(&self) -> Result<Homography, GeometryError> {
        // Canonical board coordinates are a unit rectangle. Solve the 8 projective
        // coefficients once and use them for all 90 intersections.
        Homography::from_corners(self.clone())
    }
}

#[derive(Debug, Clone, Copy)]
struct Homography {
    values: [f32; 8],
}

impl Homography {
    fn from_corners(corners: BoardCorners) -> Result<Self, GeometryError> {
        let pairs = [
            (0.0, 0.0, corners.top_left),
            (1.0, 0.0, corners.top_right),
            (1.0, 1.0, corners.bottom_right),
            (0.0, 1.0, corners.bottom_left),
        ];
        let mut matrix = [[0.0_f32; 9]; 8];
        for (index, (u, v, target)) in pairs.into_iter().enumerate() {
            matrix[index * 2] = [
                u,
                v,
                1.0,
                0.0,
                0.0,
                0.0,
                -u * target.x,
                -v * target.x,
                target.x,
            ];
            matrix[index * 2 + 1] = [
                0.0,
                0.0,
                0.0,
                u,
                v,
                1.0,
                -u * target.y,
                -v * target.y,
                target.y,
            ];
        }
        for pivot in 0..8 {
            let row = (pivot..8)
                .max_by(|left, right| {
                    matrix[*left][pivot]
                        .abs()
                        .total_cmp(&matrix[*right][pivot].abs())
                })
                .ok_or(GeometryError::DegenerateCorners)?;
            if matrix[row][pivot].abs() < 0.000_01 {
                return Err(GeometryError::DegenerateCorners);
            }
            matrix.swap(pivot, row);
            let scale = matrix[pivot][pivot];
            for value in &mut matrix[pivot][pivot..] {
                *value /= scale;
            }
            for other in 0..8 {
                if other == pivot {
                    continue;
                }
                let factor = matrix[other][pivot];
                for column in pivot..9 {
                    matrix[other][column] -= factor * matrix[pivot][column];
                }
            }
        }
        let mut values = [0.0; 8];
        for (index, row) in matrix.iter().enumerate() {
            values[index] = row[8];
        }
        Ok(Self { values })
    }

    fn project(self, u: f32, v: f32) -> Option<Point> {
        let [a, b, c, d, e, f, g, h] = self.values;
        let divisor = g * u + h * v + 1.0;
        (divisor.abs() >= 0.000_01).then_some(Point {
            x: (a * u + b * v + c) / divisor,
            y: (d * u + e * v + f) / divisor,
        })
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum GeometryError {
    #[error("board corners do not form a usable quadrilateral")]
    DegenerateCorners,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardOrientation {
    RedAtBottom,
    BlackAtBottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecognizedPiece {
    RedKing,
    RedAdvisor,
    RedElephant,
    RedHorse,
    RedRook,
    RedCannon,
    RedPawn,
    BlackKing,
    BlackAdvisor,
    BlackElephant,
    BlackHorse,
    BlackRook,
    BlackCannon,
    BlackPawn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionSquare {
    pub row: u8,
    pub col: u8,
    pub piece: Option<RecognizedPiece>,
    /// The classifier confidence for this exact grid point, in 0.0..=1.0.
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    /// The position after the adapter has mapped its detections to the 9x10 grid.
    pub fen: String,
    pub source: CaptureSource,
    pub recognition_mode: RecognitionMode,
    pub corners: Option<BoardCorners>,
    pub perspective_rectified: bool,
    pub orientation: BoardOrientation,
    /// Exactly 90 grid-point classifications, including empty intersections.
    pub squares: Vec<RecognitionSquare>,
    /// A confidence value in the inclusive 0.0..=1.0 range.
    pub confidence: f32,
}

impl RecognitionResult {
    pub fn validates_confidence(&self, threshold: f32) -> Result<(), String> {
        self.validate_grid()?;
        let threshold = threshold.clamp(0.0, 1.0);
        if !(0.0..=1.0).contains(&self.confidence) {
            return Err("识别置信度必须在 0 到 1 之间".into());
        }
        if self.confidence < threshold {
            return Err(format!(
                "识别置信度 {:.0}% 低于阈值 {:.0}%",
                self.confidence * 100.0,
                threshold * 100.0
            ));
        }
        if let Some(square) = self
            .squares
            .iter()
            .find(|square| square.confidence < threshold)
        {
            return Err(format!(
                "交叉点（{}, {}）识别置信度 {:.0}% 低于阈值 {:.0}%",
                square.row,
                square.col,
                square.confidence * 100.0,
                threshold * 100.0
            ));
        }
        Ok(())
    }

    pub fn validate_grid(&self) -> Result<(), String> {
        if self.squares.len() != usize::from(BOARD_ROWS) * usize::from(BOARD_COLS) {
            return Err("识别结果必须包含完整的 9×10 交叉点分类".into());
        }
        let mut seen = [[false; BOARD_COLS as usize]; BOARD_ROWS as usize];
        for square in &self.squares {
            if square.row >= BOARD_ROWS || square.col >= BOARD_COLS {
                return Err("识别结果包含棋盘范围外的交叉点".into());
            }
            if !(0.0..=1.0).contains(&square.confidence) {
                return Err("交叉点识别置信度必须在 0 到 1 之间".into());
            }
            let item = &mut seen[square.row as usize][square.col as usize];
            if *item {
                return Err("识别结果包含重复的交叉点".into());
            }
            *item = true;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapturePolicy {
    pub recognition_mode: RecognitionMode,
    pub stable_frames: u8,
    pub allows_external_click: bool,
}

impl CapturePolicy {
    pub fn for_source(source: CaptureSource) -> Self {
        match source {
            CaptureSource::WindowLink | CaptureSource::DesktopDetect => Self {
                recognition_mode: RecognitionMode::YoloBoard,
                stable_frames: 2,
                allows_external_click: true,
            },
            CaptureSource::ImageImport => Self {
                recognition_mode: RecognitionMode::PerspectiveGrid,
                stable_frames: 1,
                allows_external_click: false,
            },
            CaptureSource::CameraBoard => Self {
                recognition_mode: RecognitionMode::PerspectiveGrid,
                stable_frames: 3,
                allows_external_click: false,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReconcileDecision {
    Unchanged,
    ApplyMove(Move),
    NeedsManualCorrection { reason: String },
}

pub fn reconcile_position(current: &Board, recognized_fen: &str) -> ReconcileDecision {
    let recognized = match Board::from_fen(recognized_fen) {
        Ok(board) => board,
        Err(error) => {
            return ReconcileDecision::NeedsManualCorrection {
                reason: format!("识别局面格式无效：{error}"),
            };
        }
    };
    if let Err(reason) = validate_board(&recognized) {
        return ReconcileDecision::NeedsManualCorrection { reason };
    }
    let recognized_placement = recognized_fen.split_whitespace().next().unwrap_or_default();
    let current_placement = current
        .to_fen()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    if current_placement == recognized_placement {
        return ReconcileDecision::Unchanged;
    }
    let candidates: Vec<_> = current
        .legal_moves()
        .into_iter()
        .filter(|mv| {
            current.apply_move(*mv).is_ok_and(|next| {
                next.to_fen().split_whitespace().next() == Some(recognized_placement)
            })
        })
        .collect();
    match candidates.as_slice() {
        [mv] => ReconcileDecision::ApplyMove(*mv),
        [] => ReconcileDecision::NeedsManualCorrection {
            reason: "识别局面无法由当前局面的一步合法着法得到".into(),
        },
        _ => ReconcileDecision::NeedsManualCorrection {
            reason: "识别局面对应多个候选着法，需要人工确认".into(),
        },
    }
}

pub fn reconcile_recognition(
    current: &Board,
    recognition: &RecognitionResult,
    confidence_threshold: f32,
) -> ReconcileDecision {
    if let Err(reason) = recognition.validates_confidence(confidence_threshold) {
        return ReconcileDecision::NeedsManualCorrection { reason };
    }
    reconcile_position(current, &recognition.fen)
}

pub fn validate_board(board: &Board) -> Result<(), String> {
    let mut red_king = 0;
    let mut black_king = 0;
    let mut red = 0;
    let mut black = 0;
    for row in 0..BOARD_ROWS {
        for col in 0..BOARD_COLS {
            if let Some(piece) = board.piece_at(Square { row, col }) {
                match piece.color {
                    Color::Red => red += 1,
                    Color::Black => black += 1,
                }
                if piece.kind == PieceKind::King {
                    match piece.color {
                        Color::Red => red_king += 1,
                        Color::Black => black_king += 1,
                    }
                }
            }
        }
    }
    if red > 16 || black > 16 {
        return Err("识别到的单方棋子超过 16 枚".into());
    }
    if red_king != 1 || black_king != 1 {
        let mut reasons = Vec::new();
        if red_king == 0 {
            reasons.push("缺少红帅".to_owned());
        } else if red_king > 1 {
            reasons.push(format!("红帅数量为 {red_king}"));
        }
        if black_king == 0 {
            reasons.push("缺少黑将".to_owned());
        } else if black_king > 1 {
            reasons.push(format!("黑将数量为 {black_king}"));
        }
        return Err(format!(
            "识别结果必须各有一个帅和将：{}",
            reasons.join("，")
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct StabilityGate {
    required_frames: u8,
    last_key: Option<String>,
    matching_frames: u8,
}

impl StabilityGate {
    pub fn new(required_frames: u8) -> Self {
        Self {
            required_frames: required_frames.max(1),
            last_key: None,
            matching_frames: 0,
        }
    }

    pub fn observe(&mut self, fen: &str) -> Result<bool, LinkError> {
        let board = Board::from_fen(fen).map_err(LinkError::InvalidFen)?;
        let key = board.rule_position_key();
        if self.last_key.as_ref() == Some(&key) {
            self.matching_frames = self.matching_frames.saturating_add(1);
        } else {
            self.last_key = Some(key);
            self.matching_frames = 1;
        }
        Ok(self.matching_frames >= self.required_frames)
    }

    pub fn reset(&mut self) {
        self.last_key = None;
        self.matching_frames = 0;
    }

    pub fn required_frames(&self) -> u8 {
        self.required_frames
    }

    pub fn matching_frames(&self) -> u8 {
        self.matching_frames
    }
}

#[derive(Debug, Error)]
pub enum LinkError {
    #[error("invalid recognized FEN: {0}")]
    InvalidFen(xiangqi_core::ChessError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiangqi_core::STARTING_FEN;

    #[test]
    fn recognizes_a_single_legal_external_move() {
        let current = Board::from_fen(STARTING_FEN).unwrap();
        let observed = current.apply_iccs("h2h3").unwrap();
        assert_eq!(
            reconcile_position(&current, &observed.to_fen()),
            ReconcileDecision::ApplyMove(Move::from_iccs("h2h3").unwrap())
        );
    }

    #[test]
    fn recognizes_a_single_move_even_when_vision_side_to_move_is_wrong() {
        let current = Board::from_fen(STARTING_FEN).unwrap();
        let observed = current.apply_iccs("h2h3").unwrap();
        let wrong_side_fen = observed.to_fen().replacen(" b ", " w ", 1);

        assert_eq!(
            reconcile_position(&current, &wrong_side_fen),
            ReconcileDecision::ApplyMove(Move::from_iccs("h2h3").unwrap())
        );
    }

    #[test]
    fn rejects_a_position_that_skips_multiple_moves() {
        let current = Board::from_fen(STARTING_FEN).unwrap();
        let observed = current
            .apply_iccs("h2h3")
            .unwrap()
            .apply_iccs("h7h6")
            .unwrap();
        assert!(matches!(
            reconcile_position(&current, &observed.to_fen()),
            ReconcileDecision::NeedsManualCorrection { .. }
        ));
    }

    #[test]
    fn requires_stable_frames_before_accepting_a_position() {
        let mut gate = StabilityGate::new(3);
        assert!(!gate.observe(STARTING_FEN).unwrap());
        assert!(!gate.observe(STARTING_FEN).unwrap());
        assert!(gate.observe(STARTING_FEN).unwrap());
    }

    #[test]
    fn maps_all_grid_corners() {
        let corners = BoardCorners {
            top_left: Point { x: 0.0, y: 0.0 },
            top_right: Point { x: 80.0, y: 0.0 },
            bottom_right: Point { x: 80.0, y: 90.0 },
            bottom_left: Point { x: 0.0, y: 90.0 },
        };
        assert_eq!(corners.grid_point(0, 0), Some(Point { x: 0.0, y: 0.0 }));
        assert_eq!(corners.grid_point(9, 8), Some(Point { x: 80.0, y: 90.0 }));
    }

    #[test]
    fn maps_a_perspective_board_with_a_projective_transform() {
        let corners = BoardCorners {
            top_left: Point { x: 100.0, y: 100.0 },
            top_right: Point { x: 500.0, y: 130.0 },
            bottom_right: Point { x: 540.0, y: 700.0 },
            bottom_left: Point { x: 60.0, y: 650.0 },
        };
        let center = corners.grid_point(5, 4).unwrap();
        assert!((center.x - 297.45).abs() < 0.1, "center: {center:?}");
        assert!((center.y - 400.48).abs() < 0.1);
        assert_eq!(corners.grid_point(0, 0), Some(corners.top_left));
        assert_eq!(corners.grid_point(9, 8), Some(corners.bottom_right));
    }

    #[test]
    fn recognition_below_threshold_needs_correction() {
        let current = Board::from_fen(STARTING_FEN).unwrap();
        let recognition = RecognitionResult {
            fen: STARTING_FEN.into(),
            source: CaptureSource::ImageImport,
            recognition_mode: RecognitionMode::PerspectiveGrid,
            corners: None,
            perspective_rectified: false,
            orientation: BoardOrientation::RedAtBottom,
            squares: empty_grid(),
            confidence: 0.69,
        };
        assert!(matches!(
            reconcile_recognition(&current, &recognition, 0.70),
            ReconcileDecision::NeedsManualCorrection { .. }
        ));
    }

    #[test]
    fn capture_policy_keeps_camera_from_external_clicks() {
        let policy = CapturePolicy::for_source(CaptureSource::CameraBoard);
        assert_eq!(policy.stable_frames, 3);
        assert!(!policy.allows_external_click);
    }

    #[test]
    fn recognition_requires_each_intersection_once() {
        let current = Board::from_fen(STARTING_FEN).unwrap();
        let mut squares = empty_grid();
        squares.pop();
        let recognition = RecognitionResult {
            fen: STARTING_FEN.into(),
            source: CaptureSource::ImageImport,
            recognition_mode: RecognitionMode::PerspectiveGrid,
            corners: None,
            perspective_rectified: false,
            orientation: BoardOrientation::RedAtBottom,
            squares,
            confidence: 0.95,
        };
        assert!(matches!(
            reconcile_recognition(&current, &recognition, 0.70),
            ReconcileDecision::NeedsManualCorrection { .. }
        ));
    }

    fn empty_grid() -> Vec<RecognitionSquare> {
        (0..BOARD_ROWS)
            .flat_map(|row| {
                (0..BOARD_COLS).map(move |col| RecognitionSquare {
                    row,
                    col,
                    piece: None,
                    confidence: 1.0,
                })
            })
            .collect()
    }
}
