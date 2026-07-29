use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use printpdf::{
    Color, FontId, Line, LinePoint, Mm, Op, ParsedFont, PdfDocument, PdfPage, PdfSaveOptions,
    Point, Pt, Rgb, TextItem,
};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportQualityCountsDto {
    pub excellent: usize,
    pub good: usize,
    pub average: usize,
    pub poor: usize,
    pub error: usize,
    pub missed_mate: usize,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportSidePresentationDto {
    pub side: String,
    pub overall: Option<u8>,
    pub grade: Option<String>,
    pub phases: BTreeMap<String, Option<u8>>,
    pub phase_grades: BTreeMap<String, Option<String>>,
    pub counts: ReportQualityCountsDto,
    pub coach_quality: String,
    pub coach_summary: String,
    pub dimensions: BTreeMap<String, Option<u8>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportTrendDto {
    pub label: String,
    pub score_cp: i32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportIssueDto {
    pub notation: String,
    pub moved_by: String,
    pub loss_cp: u32,
    pub score: u8,
    pub grade: String,
    pub missed_mate: bool,
    pub red_score_cp: i32,
    pub delta_cp: i32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportStandardDto {
    pub grade: String,
    pub quality_range: String,
    pub description: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameReportPresentationDto {
    pub title: String,
    pub generated_at: String,
    pub stale: bool,
    pub red: ReportSidePresentationDto,
    pub black: ReportSidePresentationDto,
    pub trend: Vec<ReportTrendDto>,
    pub issues: Vec<ReportIssueDto>,
    pub standards: Vec<ReportStandardDto>,
    pub disclaimer: String,
}

const PAGE_WIDTH: f32 = 595.0;
const PAGE_HEIGHT: f32 = 842.0;
const MARGIN: f32 = 42.0;
const REPORT_FONT: &[u8] = include_bytes!("../resources/fonts/NotoSansSC-VF.ttf");

fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::Rgb(Rgb {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        icc_profile: None,
    })
}

fn grade_color(grade: &str) -> Color {
    match grade {
        "优" => rgb(43, 139, 83),
        "良" => rgb(94, 139, 51),
        "中" => rgb(173, 126, 20),
        "差" => rgb(190, 82, 34),
        _ => rgb(190, 48, 48),
    }
}

fn line(points: impl IntoIterator<Item = (f32, f32)>, closed: bool) -> Line {
    Line {
        points: points
            .into_iter()
            .map(|(x, y)| LinePoint {
                p: Point { x: Pt(x), y: Pt(y) },
                bezier: false,
            })
            .collect(),
        is_closed: closed,
    }
}

fn wrap_text(value: &str, max_units: f32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut units = 0.0;
    for character in value.chars() {
        if character == '\n' {
            lines.push(std::mem::take(&mut current));
            units = 0.0;
            continue;
        }
        let width = if character.is_ascii() { 0.55 } else { 1.0 };
        if units + width > max_units && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
            units = 0.0;
        }
        current.push(character);
        units += width;
    }
    if !current.is_empty() || lines.is_empty() {
        lines.push(current);
    }
    lines
}

struct ReportLayout {
    font: FontId,
    pages: Vec<Vec<Op>>,
    ops: Vec<Op>,
    y: f32,
}

impl ReportLayout {
    fn new(font: FontId) -> Self {
        Self {
            font,
            pages: Vec::new(),
            ops: Vec::new(),
            y: PAGE_HEIGHT - MARGIN,
        }
    }

    fn text_at(&mut self, value: impl Into<String>, x: f32, y: f32, size: f32, color: Color) {
        self.ops.extend([
            Op::StartTextSection,
            Op::SetTextCursor {
                pos: Point { x: Pt(x), y: Pt(y) },
            },
            Op::SetFontSize {
                size: Pt(size),
                font: self.font.clone(),
            },
            Op::SetFillColor { col: color },
            Op::WriteText {
                items: vec![TextItem::Text(value.into())],
                font: self.font.clone(),
            },
            Op::EndTextSection,
        ]);
    }

    fn ensure(&mut self, height: f32) {
        if self.y - height < MARGIN + 16.0 {
            self.finish_page();
        }
    }

    fn finish_page(&mut self) {
        if self.ops.is_empty() {
            return;
        }
        let page_number = self.pages.len() + 1;
        self.text_at(
            format!("象棋复盘报告 · 第 {page_number} 页"),
            MARGIN,
            22.0,
            8.0,
            rgb(105, 112, 108),
        );
        self.pages.push(std::mem::take(&mut self.ops));
        self.y = PAGE_HEIGHT - MARGIN;
    }

    fn heading(&mut self, value: &str, size: f32) {
        self.ensure(size + 20.0);
        self.text_at(value, MARGIN, self.y, size, rgb(34, 42, 38));
        self.y -= size + 12.0;
    }

    fn paragraph(&mut self, value: &str, size: f32, max_units: f32) {
        let line_height = size * 1.55;
        for line in wrap_text(value, max_units) {
            self.ensure(line_height);
            self.text_at(line, MARGIN, self.y, size, rgb(67, 75, 71));
            self.y -= line_height;
        }
        self.y -= 5.0;
    }

    fn horizontal_rule(&mut self) {
        self.ops.extend([
            Op::SetOutlineColor {
                col: rgb(206, 211, 208),
            },
            Op::SetOutlineThickness { pt: Pt(0.7) },
            Op::DrawLine {
                line: line([(MARGIN, self.y), (PAGE_WIDTH - MARGIN, self.y)], false),
            },
        ]);
        self.y -= 12.0;
    }

    fn score_cards(&mut self, report: &GameReportPresentationDto) {
        self.ensure(112.0);
        let top = self.y;
        for (index, side) in [&report.red, &report.black].into_iter().enumerate() {
            let x = MARGIN + index as f32 * 258.0;
            let grade = side.grade.as_deref().unwrap_or("--");
            self.ops.extend([
                Op::SetOutlineColor {
                    col: if index == 0 {
                        rgb(181, 70, 61)
                    } else {
                        rgb(64, 104, 127)
                    },
                },
                Op::SetOutlineThickness { pt: Pt(1.1) },
                Op::DrawLine {
                    line: line(
                        [
                            (x, top),
                            (x + 246.0, top),
                            (x + 246.0, top - 92.0),
                            (x, top - 92.0),
                        ],
                        true,
                    ),
                },
            ]);
            self.text_at(
                format!("{}综合评分", side.side),
                x + 12.0,
                top - 18.0,
                10.0,
                rgb(82, 90, 86),
            );
            self.text_at(
                side.overall
                    .map(|score| score.to_string())
                    .unwrap_or_else(|| "--".into()),
                x + 12.0,
                top - 55.0,
                28.0,
                if index == 0 {
                    rgb(181, 70, 61)
                } else {
                    rgb(64, 104, 127)
                },
            );
            self.text_at(grade, x + 208.0, top - 22.0, 12.0, grade_color(grade));
            self.text_at(
                format!(
                    "优 {}  良 {}  中 {}",
                    side.counts.excellent, side.counts.good, side.counts.average
                ),
                x + 74.0,
                top - 48.0,
                8.5,
                rgb(82, 90, 86),
            );
            self.text_at(
                format!(
                    "差 {}  错 {}  漏杀 {}",
                    side.counts.poor, side.counts.error, side.counts.missed_mate
                ),
                x + 74.0,
                top - 68.0,
                8.5,
                rgb(82, 90, 86),
            );
        }
        self.y -= 108.0;
    }

    fn radar(&mut self, report: &GameReportPresentationDto) {
        self.ensure(190.0);
        self.text_at("五维对局质量", MARGIN, self.y, 13.0, rgb(34, 42, 38));
        self.y -= 18.0;
        let center = (PAGE_WIDTH / 2.0, self.y - 75.0);
        let radius = 63.0;
        let keys = ["opening", "middle", "endgame", "accuracy", "stability"];
        let labels = ["开局", "中局", "残局", "精准", "稳定"];
        let axis_point = |index: usize, ratio: f32| {
            let angle = -std::f32::consts::FRAC_PI_2 + index as f32 * std::f32::consts::TAU / 5.0;
            (
                center.0 + angle.cos() * radius * ratio,
                center.1 + angle.sin() * radius * ratio,
            )
        };
        self.ops.extend([
            Op::SetOutlineThickness { pt: Pt(0.7) },
            Op::SetOutlineColor {
                col: rgb(205, 211, 207),
            },
        ]);
        for ring in [0.2, 0.4, 0.6, 0.8, 1.0] {
            self.ops.push(Op::DrawLine {
                line: line((0..5).map(|index| axis_point(index, ring)), true),
            });
        }
        for index in 0..5 {
            self.ops.push(Op::DrawLine {
                line: line([center, axis_point(index, 1.0)], false),
            });
            let label = axis_point(index, 1.22);
            self.text_at(
                labels[index],
                label.0 - 8.0,
                label.1 - 3.0,
                8.0,
                rgb(82, 90, 86),
            );
        }
        for (side, color) in [
            (&report.black, rgb(64, 104, 127)),
            (&report.red, rgb(181, 70, 61)),
        ] {
            let fallback = side
                .dimensions
                .get("accuracy")
                .copied()
                .flatten()
                .unwrap_or(0) as f32
                / 100.0;
            let points = keys.iter().enumerate().map(|(index, key)| {
                let ratio = side
                    .dimensions
                    .get(*key)
                    .copied()
                    .flatten()
                    .map(|value| value as f32 / 100.0)
                    .unwrap_or(fallback);
                axis_point(index, ratio)
            });
            self.ops.extend([
                Op::SetOutlineColor { col: color },
                Op::SetOutlineThickness { pt: Pt(1.8) },
                Op::DrawLine {
                    line: line(points, true),
                },
            ]);
        }
        self.y -= 162.0;
    }

    fn trend(&mut self, report: &GameReportPresentationDto) {
        self.ensure(165.0);
        self.text_at(
            "局势走势（红方视角）",
            MARGIN,
            self.y,
            13.0,
            rgb(34, 42, 38),
        );
        self.y -= 20.0;
        if report.trend.is_empty() {
            self.text_at(
                "暂无可绘制的局势数据",
                MARGIN,
                self.y - 20.0,
                10.0,
                rgb(105, 112, 108),
            );
            self.y -= 50.0;
            return;
        }
        let left = MARGIN;
        let right = PAGE_WIDTH - MARGIN;
        let top = self.y;
        let height = 110.0;
        let zero = top - height / 2.0;
        self.ops.extend([
            Op::SetOutlineColor {
                col: rgb(205, 211, 207),
            },
            Op::SetOutlineThickness { pt: Pt(0.7) },
            Op::DrawLine {
                line: line([(left, zero), (right, zero)], false),
            },
        ]);
        let denominator = report.trend.len().saturating_sub(1).max(1) as f32;
        let points = report
            .trend
            .iter()
            .enumerate()
            .map(|(index, sample)| {
                let x = left + index as f32 / denominator * (right - left);
                let value = sample.score_cp.clamp(-1000, 1000) as f32 / 1000.0;
                (x, zero + value * (height / 2.0 - 5.0))
            })
            .collect::<Vec<_>>();
        self.ops.extend([
            Op::SetOutlineColor {
                col: rgb(43, 139, 83),
            },
            Op::SetOutlineThickness { pt: Pt(2.0) },
            Op::DrawLine {
                line: line(points, false),
            },
        ]);
        let first_label = report
            .trend
            .first()
            .map(|sample| sample.label.as_str())
            .unwrap_or("初始局面");
        let last_label = report
            .trend
            .last()
            .map(|sample| sample.label.as_str())
            .unwrap_or("终局");
        self.text_at(
            first_label,
            left,
            top - height - 14.0,
            8.0,
            rgb(105, 112, 108),
        );
        self.text_at(
            last_label,
            right - 58.0,
            top - height - 14.0,
            8.0,
            rgb(105, 112, 108),
        );
        self.y -= 145.0;
    }

    fn phase_table(&mut self, report: &GameReportPresentationDto) {
        self.ensure(112.0);
        self.text_at("阶段评分", MARGIN, self.y, 13.0, rgb(34, 42, 38));
        self.y -= 22.0;
        for (key, label) in [("opening", "开局"), ("middle", "中局"), ("endgame", "残局")] {
            self.text_at(label, MARGIN, self.y, 9.5, rgb(67, 75, 71));
            for (index, side) in [&report.red, &report.black].into_iter().enumerate() {
                let score = side
                    .phases
                    .get(key)
                    .copied()
                    .flatten()
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "--".into());
                let grade = side
                    .phase_grades
                    .get(key)
                    .and_then(|value| value.as_deref())
                    .unwrap_or("--");
                self.text_at(
                    format!("{score}  {grade}"),
                    265.0 + index as f32 * 145.0,
                    self.y,
                    9.5,
                    grade_color(grade),
                );
            }
            self.y -= 23.0;
        }
        self.y -= 4.0;
    }

    fn issues(&mut self, report: &GameReportPresentationDto) {
        self.heading("关键问题着法", 14.0);
        if report.issues.is_empty() {
            self.paragraph("当前线路没有达到“差”或“错”的着法。", 10.0, 48.0);
            return;
        }
        for (index, issue) in report.issues.iter().enumerate() {
            self.ensure(27.0);
            let marker = if issue.missed_mate {
                "错 · 漏杀"
            } else {
                issue.grade.as_str()
            };
            self.text_at(
                format!("{}. {}  {}", index + 1, issue.moved_by, issue.notation),
                MARGIN,
                self.y,
                9.5,
                rgb(45, 53, 49),
            );
            self.text_at(
                format!(
                    "局面 {:+.2}  变化 {:+.2}  损失 {}cp  质量 {}分",
                    issue.red_score_cp as f32 / 100.0,
                    issue.delta_cp as f32 / 100.0,
                    issue.loss_cp,
                    issue.score
                ),
                290.0,
                self.y,
                9.0,
                rgb(82, 90, 86),
            );
            self.text_at(marker, 495.0, self.y, 9.5, grade_color(&issue.grade));
            self.y -= 22.0;
        }
        self.y -= 8.0;
    }

    fn standards(&mut self, report: &GameReportPresentationDto) {
        self.heading("评分标准", 14.0);
        for standard in &report.standards {
            self.ensure(30.0);
            self.text_at(
                &standard.grade,
                MARGIN,
                self.y,
                11.0,
                grade_color(&standard.grade),
            );
            self.text_at(&standard.quality_range, 92.0, self.y, 9.5, rgb(45, 53, 49));
            self.text_at(&standard.description, 190.0, self.y, 9.0, rgb(82, 90, 86));
            self.y -= 24.0;
        }
        self.paragraph(
            "局面分：Pikafish 的 centipawn（cp）优劣值，正数表示红方占优，负数表示黑方占优。",
            9.0,
            58.0,
        );
        self.paragraph("质量分：该着相对引擎评价造成的局面损失折算为 0-100 分；综合分是一方所有有效着法质量分的平均值。", 9.0, 58.0);
        self.paragraph(&report.disclaimer, 8.5, 62.0);
    }
}

fn render_report_pdf(
    report: &GameReportPresentationDto,
    font_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let mut warnings = Vec::new();
    let font = ParsedFont::from_bytes(font_bytes, 0, &mut warnings)
        .ok_or_else(|| "无法解析系统中文字体".to_owned())?;
    let mut document = PdfDocument::new(&format!("{}复盘报告", report.title));
    let font_id = document.add_font(&font);
    let mut layout = ReportLayout::new(font_id);
    layout.text_at(&report.title, MARGIN, layout.y, 23.0, rgb(28, 37, 32));
    layout.y -= 32.0;
    layout.text_at(
        format!("整局分析报告 · 生成时间 {}", report.generated_at),
        MARGIN,
        layout.y,
        9.0,
        rgb(82, 90, 86),
    );
    layout.y -= 20.0;
    if report.stale {
        layout.text_at(
            "线路已变化，此报告已过期",
            MARGIN,
            layout.y,
            11.0,
            rgb(190, 48, 48),
        );
        layout.y -= 22.0;
    }
    layout.horizontal_rule();
    layout.score_cards(report);
    for side in [&report.red, &report.black] {
        layout.heading(
            &format!("{}私教总结 · {}", side.side, side.coach_quality),
            13.0,
        );
        layout.paragraph(&side.coach_summary, 9.5, 54.0);
    }
    layout.radar(report);
    layout.trend(report);
    layout.phase_table(report);
    layout.issues(report);
    layout.standards(report);
    layout.finish_page();
    let pages = layout
        .pages
        .into_iter()
        .map(|ops| PdfPage::new(Mm(210.0), Mm(297.0), ops))
        .collect();
    Ok(document
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings))
}

pub(crate) fn sanitize_pdf_filename(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let sanitized = sanitized
        .trim_matches(|character| character == '.' || character == ' ')
        .trim();
    if sanitized.is_empty() {
        "未命名棋局".into()
    } else {
        sanitized.chars().take(100).collect()
    }
}

pub(crate) fn write_report_pdf(
    path: &Path,
    report: &GameReportPresentationDto,
) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_pdf_filename)
        .unwrap_or_else(|| "未命名棋局-复盘报告".into());
    let final_path = parent.join(format!("{stem}.pdf"));
    let bytes = render_report_pdf(report, REPORT_FONT)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("无法创建 PDF 临时文件：{error}"))?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.flush())
        .map_err(|error| format!("无法写入 PDF：{error}"))?;
    temporary
        .persist(&final_path)
        .map_err(|error| format!("无法保存 PDF：{}", error.error))?;
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side(name: &str) -> ReportSidePresentationDto {
        ReportSidePresentationDto {
            side: name.into(),
            overall: Some(86),
            grade: Some("优".into()),
            phases: BTreeMap::from([
                ("opening".into(), Some(90)),
                ("middle".into(), Some(82)),
                ("endgame".into(), None),
            ]),
            phase_grades: BTreeMap::from([
                ("opening".into(), Some("优".into())),
                ("middle".into(), Some("优".into())),
                ("endgame".into(), None),
            ]),
            counts: ReportQualityCountsDto {
                excellent: 3,
                good: 1,
                average: 0,
                poor: 0,
                error: 1,
                missed_mate: 1,
            },
            coach_quality: "优".into(),
            coach_summary: format!("{name}整体表现优秀，建议重点复盘关键问题着法。"),
            dimensions: BTreeMap::from([
                ("opening".into(), Some(90)),
                ("middle".into(), Some(82)),
                ("endgame".into(), None),
                ("accuracy".into(), Some(86)),
                ("stability".into(), Some(80)),
            ]),
        }
    }

    fn report() -> GameReportPresentationDto {
        GameReportPresentationDto {
            title: "中文测试棋局".into(),
            generated_at: "2026-07-29T08:30:00Z".into(),
            stale: true,
            red: side("红方"),
            black: side("黑方"),
            trend: (0..40)
                .map(|index| ReportTrendDto {
                    label: format!("第{}着", index + 1),
                    score_cp: index * 35 - 500,
                })
                .collect(),
            issues: (0..28)
                .map(|index| ReportIssueDto {
                    notation: "炮二平五".into(),
                    moved_by: if index % 2 == 0 {
                        "红方".into()
                    } else {
                        "黑方".into()
                    },
                    loss_cp: 500,
                    score: 14,
                    grade: "错".into(),
                    missed_mate: index == 0,
                    red_score_cp: 240,
                    delta_cp: -320,
                })
                .collect(),
            standards: [
                ("优", "80-100 分"),
                ("良", "60-79 分"),
                ("中", "40-59 分"),
                ("差", "20-39 分"),
                ("错", "0-19 分"),
            ]
            .into_iter()
            .map(|(grade, range)| ReportStandardDto {
                grade: grade.into(),
                quality_range: range.into(),
                description: "质量分等级说明".into(),
            })
            .collect(),
            disclaimer: "参考常见象棋复盘产品的信息层次与分档方式，不等同于天天象棋内部算法。"
                .into(),
        }
    }

    #[test]
    fn sanitizes_cross_platform_pdf_file_names() {
        assert_eq!(sanitize_pdf_filename("  测试:/棋局*?  "), "测试__棋局__");
        assert_eq!(sanitize_pdf_filename("..."), "未命名棋局");
    }

    #[test]
    fn writes_a_self_contained_multipage_chinese_pdf_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("中文报告.pdf");
        std::fs::write(&path, b"old report").unwrap();
        let saved = write_report_pdf(&path, &report()).unwrap();
        let bytes = std::fs::read(&saved).unwrap();

        assert_eq!(
            saved.extension().and_then(|value| value.to_str()),
            Some("pdf")
        );
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(
            bytes
                .windows(10)
                .filter(|window| *window == b"/Type/Page")
                .count()
                >= 2
        );
    }

    #[test]
    fn reports_write_errors_without_leaving_a_partial_pdf() {
        let directory = tempfile::tempdir().unwrap();
        let missing_parent = directory.path().join("missing");
        let path = missing_parent.join("报告.pdf");

        let error = write_report_pdf(&path, &report()).unwrap_err();

        assert!(error.contains("无法创建 PDF 临时文件"));
        assert!(!path.exists());
    }
}
