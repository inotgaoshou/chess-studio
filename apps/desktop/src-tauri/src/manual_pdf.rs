use std::io::Write;
use std::path::{Path, PathBuf};

use lopdf::{Document, Object, text_string};
use printpdf::{
    Color, FontId, Mm, Op, ParsedFont, PdfDocument, PdfPage, PdfSaveOptions, Point, Pt, Rgb,
    TextItem,
};
use manual_format::ManualDocument;
use xiangqi_core::{Board, Color as XiangqiColor};

const FONT: &[u8] = include_bytes!("../resources/fonts/NotoSansSC-VF.ttf");
const PAGE_HEIGHT: f32 = 841.89;
const MARGIN: f32 = 42.0;
const CONTENT_UNITS: f32 = 58.0;

struct ManualPdfLayout {
    font: FontId,
    pages: Vec<Vec<Op>>,
    ops: Vec<Op>,
    y: f32,
}

impl ManualPdfLayout {
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
        if self.y - height < MARGIN + 12.0 {
            self.finish_page();
        }
    }

    fn finish_page(&mut self) {
        if self.ops.is_empty() {
            return;
        }
        let page_number = self.pages.len() + 1;
        self.text_at(
            format!("象棋棋谱 PDF · 第 {page_number} 页"),
            MARGIN,
            22.0,
            8.0,
            rgb(116, 126, 135),
        );
        self.pages.push(std::mem::take(&mut self.ops));
        self.y = PAGE_HEIGHT - MARGIN;
    }

    fn heading(&mut self, value: &str) {
        self.ensure(30.0);
        self.text_at(value, MARGIN, self.y, 22.0, rgb(25, 55, 82));
        self.y -= 30.0;
    }

    fn subtitle(&mut self, value: &str) {
        self.ensure(18.0);
        self.text_at(value, MARGIN, self.y, 9.5, rgb(94, 115, 132));
        self.y -= 18.0;
    }

    fn paragraph(&mut self, value: &str, size: f32, units: f32, color: Color) {
        let line_height = size * 1.55;
        for raw_line in value.lines() {
            if raw_line.trim().is_empty() {
                self.y -= line_height * 0.6;
                continue;
            }
            for line in wrap_text(raw_line, units) {
                self.ensure(line_height);
                self.text_at(line, MARGIN, self.y, size, color.clone());
                self.y -= line_height;
            }
        }
    }

    fn line(&mut self, value: &str, indent: f32, size: f32, color: Color) {
        let line_height = size * 1.58;
        for line in wrap_text(value, CONTENT_UNITS - indent / 9.0) {
            self.ensure(line_height);
            self.text_at(line, MARGIN + indent, self.y, size, color.clone());
            self.y -= line_height;
        }
    }

    fn section(&mut self, value: &str) {
        self.ensure(22.0);
        self.y -= 4.0;
        self.text_at(value, MARGIN, self.y, 12.5, rgb(22, 93, 147));
        self.y -= 19.0;
    }
}

fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::Rgb(Rgb::new(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        None,
    ))
}

fn char_units(character: char) -> f32 {
    if character.is_ascii() { 0.58 } else { 1.0 }
}

fn wrap_text(value: &str, max_units: f32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut units = 0.0;
    for character in value.chars() {
        let next = char_units(character);
        if !current.is_empty() && units + next > max_units {
            lines.push(current.trim_end().to_owned());
            current.clear();
            units = 0.0;
        }
        current.push(character);
        units += next;
    }
    if !current.trim().is_empty() {
        lines.push(current.trim_end().to_owned());
    }
    lines
}

fn sanitize_pdf_filename(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
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
        "未命名棋谱".into()
    } else {
        sanitized.chars().take(100).collect()
    }
}

fn encode_pdf_info_title(bytes: Vec<u8>, title: &str) -> Result<Vec<u8>, String> {
    let mut document =
        Document::load_mem(&bytes).map_err(|error| format!("无法读取 PDF 元数据：{error}"))?;
    let title = text_string(title);
    let info = document.trailer.get(b"Info").cloned();
    match info {
        Ok(Object::Reference(id)) => {
            let info = document
                .get_object_mut(id)
                .and_then(Object::as_dict_mut)
                .map_err(|error| format!("无法更新 PDF 标题：{error}"))?;
            info.set("Title", title);
        }
        Ok(Object::Dictionary(_)) => {
            let info = document
                .trailer
                .get_mut(b"Info")
                .and_then(Object::as_dict_mut)
                .map_err(|error| format!("无法更新 PDF 标题：{error}"))?;
            info.set("Title", title);
        }
        Ok(_) | Err(_) => {
            return Err("PDF 缺少可写入的文档信息字典".to_owned());
        }
    }
    let mut output = Vec::new();
    document
        .save_to(&mut output)
        .map_err(|error| format!("无法写入 PDF 元数据：{error}"))?;
    Ok(output)
}

fn starting_ply(document: &ManualDocument, board: &Board) -> usize {
    let fields: Vec<_> = document.starting_fen.split_whitespace().collect();
    let fullmove = fields
        .get(5)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1);
    (fullmove.saturating_sub(1) * 2) + usize::from(board.side_to_move() == XiangqiColor::Black)
}

fn move_number_label(ply: usize) -> String {
    let number = ply / 2 + 1;
    if ply % 2 == 0 {
        format!("{number}.")
    } else {
        format!("{number}...")
    }
}

fn mainline_rows(document: &ManualDocument) -> Result<Vec<String>, String> {
    let mut board = Board::from_fen(&document.starting_fen)
        .map_err(|error| format!("起始局面无效：{error}"))?;
    let mut parent_id = document.tree.root_id();
    let mut ply = starting_ply(document, &board);
    let mut rows = Vec::new();
    loop {
        let branches = document
            .tree
            .branches(parent_id)
            .map_err(|error| format!("读取棋谱分支失败：{error}"))?;
        let Some(node) = branches
            .iter()
            .find(|node| node.is_mainline)
            .or_else(|| branches.first())
            .copied()
        else {
            break;
        };
        let notation = board
            .chinese_move_notation(node.mv)
            .map_err(|error| format!("生成中文着法失败：{error}"))?;
        let branch_hint = if branches.len() > 1 {
            format!("    另有{}条变招", branches.len() - 1)
        } else {
            String::new()
        };
        let comment = if node.comment.trim().is_empty() {
            String::new()
        } else {
            format!("    注：{}", node.comment.trim())
        };
        rows.push(format!("{}  {}{}{}", move_number_label(ply), notation, branch_hint, comment));
        board = board
            .apply_move(node.mv)
            .map_err(|error| format!("棋谱着法不合法：{error}"))?;
        parent_id = node.id;
        ply += 1;
    }
    Ok(rows)
}

fn collect_variation_lines(
    lines: &mut Vec<String>,
    document: &ManualDocument,
    board: &Board,
    parent_id: uuid::Uuid,
    ply: usize,
    depth: usize,
    prefix: &str,
) -> Result<(), String> {
    let branches = document
        .tree
        .branches(parent_id)
        .map_err(|error| format!("读取棋谱分支失败：{error}"))?;
    if branches.len() > 1 {
        let mainline_id = branches
            .iter()
            .find(|node| node.is_mainline)
            .or_else(|| branches.first())
            .map(|node| node.id);
        for (index, sibling) in branches
            .iter()
            .filter(|node| Some(node.id) != mainline_id)
            .enumerate()
        {
            let notation = board
                .chinese_move_notation(sibling.mv)
                .map_err(|error| format!("生成中文变招失败：{error}"))?;
            let comment = if sibling.comment.trim().is_empty() {
                String::new()
            } else {
                format!("    注：{}", sibling.comment.trim())
            };
            lines.push(format!(
                "{}{}变招{}：{}  {}{}",
                "  ".repeat(depth),
                prefix,
                index + 1,
                move_number_label(ply),
                notation,
                comment
            ));
            let next = board
                .apply_move(sibling.mv)
                .map_err(|error| format!("变招着法不合法：{error}"))?;
            collect_line_preview(lines, document, &next, sibling.id, ply + 1, depth + 1, 8)?;
        }
    }

    let Some(mainline) = branches
        .iter()
        .find(|node| node.is_mainline)
        .or_else(|| branches.first())
        .copied()
    else {
        return Ok(());
    };
    let next = board
        .apply_move(mainline.mv)
        .map_err(|error| format!("棋谱着法不合法：{error}"))?;
    collect_variation_lines(lines, document, &next, mainline.id, ply + 1, depth, prefix)
}

fn collect_line_preview(
    lines: &mut Vec<String>,
    document: &ManualDocument,
    board: &Board,
    parent_id: uuid::Uuid,
    ply: usize,
    depth: usize,
    limit: usize,
) -> Result<(), String> {
    if limit == 0 {
        return Ok(());
    }
    let branches = document
        .tree
        .branches(parent_id)
        .map_err(|error| format!("读取棋谱分支失败：{error}"))?;
    let Some(node) = branches
        .iter()
        .find(|node| node.is_mainline)
        .or_else(|| branches.first())
        .copied()
    else {
        return Ok(());
    };
    let notation = board
        .chinese_move_notation(node.mv)
        .map_err(|error| format!("生成中文着法失败：{error}"))?;
    let branch_count = branches.len().saturating_sub(1);
    let branch_hint = if branch_count > 0 {
        format!("    另有{branch_count}条后续变招")
    } else {
        String::new()
    };
    let comment = if node.comment.trim().is_empty() {
        String::new()
    } else {
        format!("    注：{}", node.comment.trim())
    };
    lines.push(format!(
        "{}↳ {}  {}{}{}",
        "  ".repeat(depth),
        move_number_label(ply),
        notation,
        branch_hint,
        comment
    ));
    let next = board
        .apply_move(node.mv)
        .map_err(|error| format!("棋谱着法不合法：{error}"))?;
    collect_line_preview(lines, document, &next, node.id, ply + 1, depth, limit - 1)
}

fn variation_rows(document: &ManualDocument) -> Result<Vec<String>, String> {
    let board = Board::from_fen(&document.starting_fen)
        .map_err(|error| format!("起始局面无效：{error}"))?;
    let mut lines = Vec::new();
    collect_variation_lines(
        &mut lines,
        document,
        &board,
        document.tree.root_id(),
        starting_ply(document, &board),
        0,
        "",
    )?;
    Ok(lines)
}

fn render_manual_pdf(document: &ManualDocument) -> Result<Vec<u8>, String> {
    let mut warnings = Vec::new();
    let font = ParsedFont::from_bytes(FONT, 0, &mut warnings)
        .ok_or_else(|| "无法解析内嵌中文字体".to_owned())?;
    let title = document.metadata.title.trim();
    let title = if title.is_empty() { "未命名棋谱" } else { title };
    let mut pdf = PdfDocument::new(&format!("{title}棋谱"));
    let font_id = pdf.add_font(&font);
    let mut layout = ManualPdfLayout::new(font_id);
    layout.heading(&format!("{title} · 棋谱"));
    layout.subtitle("适合手机微信预览的棋谱 PDF · 按主线与变招分区展示。");
    if !document.metadata.red.trim().is_empty() || !document.metadata.black.trim().is_empty() {
        layout.subtitle(&format!(
            "红方：{}    黑方：{}",
            if document.metadata.red.trim().is_empty() { "-" } else { document.metadata.red.trim() },
            if document.metadata.black.trim().is_empty() { "-" } else { document.metadata.black.trim() },
        ));
    }
    if !document.note.trim().is_empty() {
        layout.paragraph(
            &format!("棋局说明：{}", document.note.trim()),
            9.5,
            CONTENT_UNITS,
            rgb(67, 83, 96),
        );
        layout.y -= 8.0;
    }
    let mainline = mainline_rows(document)?;
    layout.section("主线棋谱");
    if mainline.is_empty() {
        layout.line("暂无着法。", 0.0, 10.5, rgb(116, 126, 135));
    } else {
        for row in mainline {
            layout.line(&row, 0.0, 10.5, rgb(30, 44, 56));
        }
    }
    let variations = variation_rows(document)?;
    if !variations.is_empty() {
        layout.section("变招分支");
        for row in variations {
            layout.line(&row, 0.0, 9.8, rgb(61, 82, 98));
        }
    }
    layout.section("说明");
    layout.line("这是棋谱 PDF，不是思维导图。变招按分支文字列表展示，便于手机和微信打开查看。", 0.0, 9.0, rgb(116, 126, 135));
    layout.finish_page();
    let pages = layout
        .pages
        .into_iter()
        .map(|ops| PdfPage::new(Mm(210.0), Mm(297.0), ops))
        .collect();
    let bytes = pdf
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings);
    encode_pdf_info_title(bytes, &format!("{title}棋谱"))
}

pub(crate) fn write_manual_pdf(path: &Path, document: &ManualDocument) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_pdf_filename)
        .unwrap_or_else(|| "未命名棋谱".into());
    let final_path = parent.join(format!("{stem}.pdf"));
    let bytes = render_manual_pdf(document)?;
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
    use tempfile::tempdir;

    #[test]
    fn writes_chinese_manual_pdf_atomically() {
        let directory = tempdir().unwrap();
        let mut document = ManualDocument::new(xiangqi_core::STARTING_FEN).unwrap();
        document.metadata.title = "中文棋谱".into();
        document.note = "包含主线和变招".into();
        let path = directory.path().join("中文棋谱.pdf");
        let saved = write_manual_pdf(&path, &document).unwrap();
        let bytes = std::fs::read(saved).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn formats_mainline_and_variations_as_chess_record_sections() {
        let mut document = ManualDocument::new(xiangqi_core::STARTING_FEN).unwrap();
        let first = document
            .tree
            .add_move(
                document.tree.root_id(),
                xiangqi_core::Move::from_iccs("h2e2").unwrap(),
                "中炮开局",
            )
            .unwrap();
        let _reply = document
            .tree
            .add_move(first, xiangqi_core::Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        document
            .tree
            .add_move(first, xiangqi_core::Move::from_iccs("b9c7").unwrap(), "变招选择")
            .unwrap();

        let mainline = mainline_rows(&document).unwrap();
        assert!(mainline.iter().any(|line| line.contains("另有1条变招")));
        assert!(mainline.iter().any(|line| line.contains("炮二平五")));

        let variations = variation_rows(&document).unwrap();
        assert!(variations.iter().any(|line| line.contains("变招1")));
        assert!(variations.iter().any(|line| line.contains("马2进3")));
        assert!(variations.iter().any(|line| line.contains("变招选择")));
    }
}
