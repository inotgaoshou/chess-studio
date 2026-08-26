use super::*;
use crate::{
    engine_service::analyze_position,
    manual_service::{commit_move, sync_current_game_mirror},
    report_service::{fen_starting_ply, report_line_signature, report_material, report_phase},
};

pub(crate) fn flyknife_templates() -> Vec<FlyknifeTemplateDto> {
    const ITEMS: [(&str, &str, &[&str]); 10] = [
        (
            "zhongpao-pingfeng",
            "中炮对屏风马",
            &["h2e2", "h9g7", "b2c4", "b7c7"],
        ),
        ("zhongpao-zhongpao", "中炮对中炮", &["h2e2", "h7e7"]),
        ("xianren-zu-di-pao", "仙人指路对卒底炮", &["a3a4", "b7b3"]),
        ("xianren-fei-xiang", "仙人指路对飞象", &["a3a4", "c9e7"]),
        ("fei-xiang-juzhong", "飞相局", &["c0e2", "h9g7"]),
        ("guogongpao", "过宫炮", &["b2e2", "h9g7"]),
        ("shunshou-pao", "顺手炮", &["h2e2", "h7e7"]),
        ("lie-shou-pao", "列手炮", &["h2e2", "b7e7"]),
        ("dan-ti-ma", "单提马", &["b0c2", "h9g7"]),
        ("bian-ma", "边马局", &["b0a2", "h9g7"]),
    ];
    ITEMS
        .into_iter()
        .filter_map(|(id, name, moves)| {
            let board = moves
                .iter()
                .try_fold(Board::from_fen(STARTING_FEN).ok()?, |board, iccs| {
                    board.apply_iccs(iccs).ok()
                })?;
            Some(FlyknifeTemplateDto {
                id,
                name,
                moves: moves.iter().map(|item| (*item).into()).collect(),
                fen: board.to_fen(),
            })
        })
        .collect()
}

const FLYKNIFE_TOPICS: [(&str, &str, &str, &str, &str, &str, usize); 12] = [
    (
        "xianren-zudi-pao-1",
        "34仙人指路对卒底炮（一）",
        "仙人指路对卒底炮",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6535.html",
        "01-34仙人指路对卒底炮-一.pgn",
        12,
    ),
    (
        "xianren-zudi-pao-2",
        "35仙人指路对卒底炮（二）",
        "仙人指路对卒底炮",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6534.html",
        "02-35仙人指路对卒底炮-二.pgn",
        9,
    ),
    (
        "ma-ru-gui-xin",
        "02马入归心，化凶为吉",
        "中炮类战术",
        "布局陷阱",
        "https://mp.xiangqiqipu.com/Category/View-6497.html",
        "03-02马入归心-化凶为吉.pgn",
        32,
    ),
    (
        "zhang-wang-yi-dai",
        "21张网以待，中计败北",
        "中炮类战术",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6457.html",
        "04-21张网以待-中计败北.pgn",
        26,
    ),
    (
        "xianshou-pingfeng-vs-zhongpao",
        "02先手屏风马对中炮局",
        "屏风马对中炮",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6571.html",
        "05-02先手屏风马对中炮局.pgn",
        18,
    ),
    (
        "pingfeng-po-guoheche",
        "15屏风马破中炮过河车",
        "屏风马破过河车",
        "布局陷阱",
        "https://xiangqiqipu.com/Category/View-6558.html",
        "06-15屏风马破中炮过河车.pgn",
        16,
    ),
    (
        "shunpao-qima-fengsuo",
        "27顺炮弃马破单边封锁局",
        "顺炮弃马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6546.html",
        "07-27顺炮弃马破单边封锁局.pgn",
        31,
    ),
    (
        "zhongpao-guoheche-pingfeng",
        "03中炮过河车对屏风马局",
        "中炮过河车对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6570.html",
        "08-03中炮过河车对屏风马局.pgn",
        12,
    ),
    (
        "xianren-qizu",
        "31仙人指路对弃卒局",
        "仙人指路对弃卒",
        "布局陷阱",
        "https://mp.xiangqiqipu.com/Category/View-6538.html",
        "09-31仙人指路对弃卒局.pgn",
        16,
    ),
    (
        "zhongpao-shuangpao-guohe",
        "24中炮对屏风马双炮过河",
        "中炮对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6549.html",
        "10-24中炮对屏风马双炮过河.pgn",
        16,
    ),
    (
        "zuoma-panhe",
        "25中炮过河车对屏风马左马盘河",
        "中炮过河车对屏风马",
        "布局陷阱",
        "https://www.xiangqiqipu.com/Category/View-6548.html",
        "11-25中炮过河车对屏风马左马盘河.pgn",
        10,
    ),
    (
        "shunpao-hengche-shijiaopao",
        "42顺炮横车攻先补士角炮局",
        "顺炮横车",
        "布局陷阱",
        "https://source.xiangqiqipu.com/Category/View-6527.html",
        "12-42顺炮横车攻先补士角炮局.pgn",
        21,
    ),
];

pub(crate) fn flyknife_topics() -> Vec<FlyknifeTopicDto> {
    let mut topics: Vec<_> = FLYKNIFE_TOPICS
        .iter()
        .map(
            |(id, title, opening, category, source, _filename, move_count)| FlyknifeTopicDto {
                id: *id,
                title: *title,
                opening: *opening,
                category: *category,
                source: *source,
                move_count: *move_count,
            },
        )
        .collect();
    topics.insert(
        0,
        FlyknifeTopicDto {
            id: "book-game-53-hong-zhi-huang-shiqing",
            title: "第53局 洪智胜黄仕清 · 车八平五飞刀",
            opening: "中炮对反宫马，五六炮进三兵局",
            category: "原书飞刀拆解",
            source: "已授权原书第82页",
            move_count: 23,
        },
    );
    topics
}

pub(crate) fn flyknife_topic_file_name(id: &str) -> Option<&'static str> {
    if id == "book-game-53-hong-zhi-huang-shiqing" {
        return Some("../book-topics/game-53/game-53.pgn");
    }
    FLYKNIFE_TOPICS
        .iter()
        .find(|(topic_id, ..)| *topic_id == id)
        .map(|(_, _, _, _, _, filename, _)| *filename)
}

pub(crate) fn flyknife_topic_candidates(resource_dir: &Path, filename: &str) -> Vec<PathBuf> {
    if let Some(relative) = filename.strip_prefix("../") {
        return vec![resource_dir.join(relative)];
    }
    vec![
        resource_dir
            .join("resources/flyknife-library/single-pgn")
            .join(filename),
        resource_dir
            .join("flyknife-library/single-pgn")
            .join(filename),
    ]
}

pub(crate) fn resolve_flyknife_topic_path(
    app: &tauri::AppHandle,
    filename: &str,
) -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(relative) = filename.strip_prefix("../") {
        let mut candidates = vec![manifest_dir.join("resources").join(relative)];
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join(relative));
        }
        return candidates.into_iter().find(|path| path.is_file());
    }
    let mut candidates = vec![
        manifest_dir
            .join("resources/flyknife-library/single-pgn")
            .join(filename),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(flyknife_topic_candidates(&resource_dir, filename));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[tauri::command]
pub(crate) fn list_flyknife_topics() -> Vec<FlyknifeTopicDto> {
    flyknife_topics()
}

pub(crate) fn book_topic_resource_path(
    app: &tauri::AppHandle,
    filename: &str,
) -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/book-topics/game-53")
        .join(filename);
    if manifest.is_file() {
        return Ok(manifest);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let candidates = [
        resource_dir.join("book-topics/game-53").join(filename),
        resource_dir
            .join("resources/book-topics/game-53")
            .join(filename),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("书籍专题资源不存在：{filename}"))
}

#[tauri::command]
pub(crate) fn get_book_topic_detail(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    if id != "book-game-53-hong-zhi-huang-shiqing" {
        return Ok(None);
    }
    let path = book_topic_resource_path(&app, "detail.json")?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let mut detail: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("书籍专题详情格式错误：{error}"))?;
    if let Some(images) = detail
        .get_mut("images")
        .and_then(serde_json::Value::as_array_mut)
    {
        for image in images {
            if let Some(name) = image.as_str() {
                let file_name = Path::new(name)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default();
                // Bundled pages must also load after the packaged app is moved. Passing a
                // data URL avoids webview asset-protocol path permissions altogether.
                let bytes = fs::read(book_topic_resource_path(&app, file_name)?)
                    .map_err(|error| format!("无法读取书页图片：{error}"))?;
                *image = serde_json::Value::String(format!(
                    "data:image/jpeg;base64,{}",
                    BASE64.encode(bytes)
                ));
            }
        }
    }
    if let Some(checkpoints) = detail
        .get_mut("diagramCheckpoints")
        .and_then(serde_json::Value::as_array_mut)
    {
        for checkpoint in checkpoints {
            if let Some(path) = checkpoint.get_mut("imagePath") {
                if let Some(name) = path.as_str() {
                    let file_name = Path::new(name)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default();
                    *path = serde_json::Value::String(
                        book_topic_resource_path(&app, file_name)?
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }
        }
    }
    let checkpoint_fens = detail
        .get("diagramCheckpoints")
        .and_then(serde_json::Value::as_array)
        .map(|checkpoints| {
            let moves: Vec<String> = detail
                .get("mainline")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect();
            checkpoints
                .iter()
                .filter_map(|checkpoint| checkpoint.get("ply").and_then(serde_json::Value::as_u64))
                .filter_map(|ply| {
                    let mut board = Board::from_fen(STARTING_FEN).ok()?;
                    for move_text in moves.iter().take(ply as usize) {
                        board = board.apply_move(Move::from_iccs(move_text).ok()?).ok()?;
                    }
                    Some(serde_json::Value::String(board.to_fen()))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(object) = detail.as_object_mut() {
        object.insert(
            "checkpointFens".into(),
            serde_json::Value::Array(checkpoint_fens),
        );
    }
    Ok(Some(detail))
}

#[tauri::command]
pub(crate) fn recognize_book_page(image_path: String) -> Result<BookImportDraftDto, String> {
    let path = PathBuf::from(image_path);
    let metadata = fs::metadata(&path).map_err(|_| "未找到书页图片".to_owned())?;
    if !metadata.is_file() || metadata.len() > 24 * 1024 * 1024 {
        return Err("书页图片必须是小于 24MB 的普通文件".into());
    }
    let output = ProcessCommand::new("tesseract")
        .arg(&path)
        .arg("stdout")
        .args(["-l", "chi_sim", "--psm", "6"])
        .output()
        .map_err(|_| "本机离线 OCR 不可用；请安装中文 Tesseract 数据或手工录入".to_owned())?;
    if !output.status.success() {
        return Err("离线 OCR 未能识别此书页，请调整照片或改用手工录入".into());
    }
    let raw_text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let moves_text = raw_text
        .lines()
        .filter(|line| {
            line.contains('炮')
                || line.contains('马')
                || line.contains('车')
                || line.contains('兵')
                || line.contains('卒')
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(BookImportDraftDto {
        image_path: path.to_string_lossy().into_owned(),
        raw_text,
        confidence: 0.55,
        title: String::new(),
        red_player: String::new(),
        black_player: String::new(),
        event_name: String::new(),
        moves_text,
        warnings: vec!["OCR 初稿必须逐项校对；棋谱必须通过合法着法验证后才能入库。".into()],
    })
}

pub(crate) fn chinese_move_tokens(text: &str) -> Vec<String> {
    let characters: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    for index in 0..characters.len().saturating_sub(3) {
        let piece = characters[index];
        let file = characters[index + 1];
        let action = characters[index + 2];
        let target = characters[index + 3];
        if matches!(
            piece,
            '车' | '車'
                | '马'
                | '馬'
                | '炮'
                | '砲'
                | '兵'
                | '卒'
                | '相'
                | '象'
                | '仕'
                | '士'
                | '帅'
                | '將'
                | '将'
                | '帥'
        ) && matches!(
            file,
            '前' | '后'
                | '後'
                | '中'
                | '一'
                | '二'
                | '三'
                | '四'
                | '五'
                | '六'
                | '七'
                | '八'
                | '九'
                | '１'
                | '２'
                | '３'
                | '４'
                | '５'
                | '６'
                | '７'
                | '８'
                | '９'
                | '1'
                | '2'
                | '3'
                | '4'
                | '5'
                | '6'
                | '7'
                | '8'
                | '9'
        ) && matches!(action, '进' | '進' | '退' | '平')
            && matches!(
                target,
                '一' | '二'
                    | '三'
                    | '四'
                    | '五'
                    | '六'
                    | '七'
                    | '八'
                    | '九'
                    | '１'
                    | '２'
                    | '３'
                    | '４'
                    | '５'
                    | '６'
                    | '７'
                    | '８'
                    | '９'
                    | '1'
                    | '2'
                    | '3'
                    | '4'
                    | '5'
                    | '6'
                    | '7'
                    | '8'
                    | '9'
            )
        {
            tokens.push(characters[index..=index + 3].iter().collect());
        }
    }
    tokens
}

pub(crate) fn parse_book_import_moves(moves_text: &str) -> Result<Vec<String>, String> {
    let notation = chinese_move_tokens(moves_text);
    if notation.is_empty() {
        return Err("未识别到中文着法；请按“车八平五”的格式校对棋谱".into());
    }
    let mut board = Board::from_fen(STARTING_FEN).map_err(|error| error.to_string())?;
    let mut moves = Vec::with_capacity(notation.len());
    for (index, input) in notation.iter().enumerate() {
        let expected = normalize_chinese_move_text(input);
        let candidates = board
            .legal_moves()
            .into_iter()
            .filter(|mv| {
                board
                    .chinese_move_notation(*mv)
                    .map(|value| normalize_chinese_move_text(&value) == expected)
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        let mv = match candidates.as_slice() {
            [mv] => *mv,
            [] => {
                return Err(format!(
                    "第 {} 步“{}”不是当前局面的合法中文着法",
                    index + 1,
                    input
                ));
            }
            _ => {
                return Err(format!(
                    "第 {} 步“{}”存在歧义，请改为在棋盘上录入",
                    index + 1,
                    input
                ));
            }
        };
        moves.push(mv.to_iccs());
        board = board
            .apply_move(mv)
            .map_err(|error| format!("第 {} 步非法：{error}", index + 1))?;
    }
    Ok(moves)
}

#[tauri::command]
pub(crate) fn save_book_import(
    request: SaveBookImportRequest,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let image = PathBuf::from(request.image_path.trim());
    if !image.is_file() {
        return Err("原书照片不存在，无法建立可追溯的本地专题".into());
    }
    let moves = parse_book_import_moves(&request.moves_text)?;
    let mut document = ManualDocument::new(STARTING_FEN).map_err(|error| error.to_string())?;
    document.metadata = ManualMetadata {
        title: if request.title.trim().is_empty() {
            "书页棋谱导入".into()
        } else {
            request.title.trim().into()
        },
        event: request.event_name.trim().into(),
        red: request.red_player.trim().into(),
        black: request.black_player.trim().into(),
        result: "*".into(),
        ..ManualMetadata::default()
    };
    document.note = format!(
        "来源：用户本机书页导入\n原图：{}\n状态：已人工校对并通过逐着棋规校验\n\nOCR 原文：\n{}\n\n确认棋谱：\n{}",
        image.to_string_lossy(),
        request.raw_text.trim(),
        request.moves_text.trim()
    );
    let mut parent = document.tree.root_id();
    for iccs in moves {
        let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
        parent = document
            .tree
            .add_move(parent, mv, "")
            .map_err(|error| error.to_string())?;
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(image.to_string_lossy().into_owned()),
        Some("book-page-import".into()),
    )?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只能打开 http 或 https 来源地址".into());
    }
    #[cfg(target_os = "macos")]
    let status = ProcessCommand::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = ProcessCommand::new("cmd")
        .args(["/C", "start", "", &url])
        .status();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = ProcessCommand::new("xdg-open").arg(&url).status();
    status
        .map_err(|error| format!("无法调用系统浏览器：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "系统浏览器未能打开该来源".into())
}

#[tauri::command]
pub(crate) fn open_flyknife_topic(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let filename = flyknife_topic_file_name(&id).ok_or("飞刀专题不存在")?;
    let path = resolve_flyknife_topic_path(&app, filename)
        .ok_or_else(|| format!("飞刀专题资源不存在：{filename}"))?;
    let bytes = std::fs::read(&path).map_err(|error| format!("读取飞刀专题失败：{error}"))?;
    let document =
        import_document(&bytes, Some(ManualFormat::Pgn)).map_err(|error| error.to_string())?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(path.to_string_lossy().into_owned()),
        Some("flyknife-topic".into()),
    )?;
    board_dto(&model)
}

pub(crate) fn normalize_chinese_move_text(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter_map(|character| match character {
            ' ' | '\t' | '\n' | '\r' | '-' | '－' => None,
            '０' => Some('0'),
            '１' | '一' => Some('1'),
            '２' | '二' => Some('2'),
            '３' | '三' => Some('3'),
            '４' | '四' => Some('4'),
            '５' | '五' => Some('5'),
            '６' | '六' => Some('6'),
            '７' | '七' => Some('7'),
            '８' | '八' => Some('8'),
            '９' | '九' => Some('9'),
            '車' => Some('车'),
            '馬' => Some('马'),
            '砲' => Some('炮'),
            '帥' => Some('帅'),
            '將' => Some('将'),
            '進' => Some('进'),
            character => Some(character),
        })
        .collect()
}

pub(crate) fn resolve_flyknife_lure(board: &Board, value: &str) -> Result<String, String> {
    let input = value.trim();
    if board.apply_iccs(input).is_ok() {
        return Ok(input.to_owned());
    }
    let expected = normalize_chinese_move_text(input);
    let matches: Vec<_> = board
        .legal_moves()
        .into_iter()
        .filter(|mv| {
            board
                .chinese_move_notation(*mv)
                .map(|notation| normalize_chinese_move_text(&notation) == expected)
                .unwrap_or(false)
        })
        .collect();
    match matches.as_slice() {
        [mv] => Ok(mv.to_iccs()),
        [] => Err(format!("“{input}”不是当前局面的合法中文着法")),
        _ => Err(format!("“{input}”存在歧义，请从候选着法中选择")),
    }
}

pub(crate) fn chinese_color_name(color: Color) -> &'static str {
    match color {
        Color::Red => "红方",
        Color::Black => "黑方",
    }
}

pub(crate) fn prepare_flyknife_position(
    before: &Board,
    requested: Color,
    setup_value: &str,
    lure_value: &str,
) -> Result<(String, String, Board, Board), String> {
    let input_setup = setup_value.trim();
    let input_lure = lure_value.trim();
    if !input_setup.is_empty() {
        if before.side_to_move() != requested {
            return Err(format!(
                "当前局面轮到{}行棋；不能由{}先设局",
                chinese_color_name(before.side_to_move()),
                chinese_color_name(requested)
            ));
        }
        if input_lure.is_empty() {
            return Err("设局飞刀需要填写对手的常见应手".into());
        }
        let setup_move = resolve_flyknife_lure(before, input_setup)?;
        let after_setup = before
            .apply_iccs(&setup_move)
            .map_err(|_| "预埋第一手不是起始局面的合法着法".to_string())?;
        let lure_move = resolve_flyknife_lure(&after_setup, input_lure)?;
        let after_lure = after_setup
            .apply_iccs(&lure_move)
            .map_err(|_| "对手应手不是预埋局面的合法着法".to_string())?;
        if after_lure.side_to_move() != requested {
            return Err("对手应手后未轮到设局方出刀，请检查着法顺序".into());
        }
        return Ok((setup_move, lure_move, after_setup, after_lure));
    }
    if input_lure.is_empty() {
        if before.side_to_move() != requested {
            return Err(format!(
                "当前局面轮到{}行棋；若要让{}出刀，请先填写一手对手诱导着法",
                chinese_color_name(before.side_to_move()),
                chinese_color_name(requested)
            ));
        }
        return Ok((String::new(), String::new(), before.clone(), before.clone()));
    }
    let lure_move = resolve_flyknife_lure(before, input_lure)?;
    let after_lure = before
        .apply_iccs(&lure_move)
        .map_err(|_| "诱导着法不是起始局面的合法着法".to_string())?;
    if after_lure.side_to_move() != requested {
        return Err(format!(
            "诱导着后轮到{}行棋，不是{}出刀；请调整出刀方或换一手诱导着",
            chinese_color_name(after_lure.side_to_move()),
            chinese_color_name(requested)
        ));
    }
    Ok((String::new(), lure_move, before.clone(), after_lure))
}

pub(crate) fn flyknife_best_defense_notation(
    starting_fen: &str,
    mainline: &[String],
    knife_move: &str,
    best_defense: &[String],
) -> Vec<String> {
    let Some(knife_index) = mainline
        .iter()
        .position(|move_text| move_text == knife_move)
    else {
        return Vec::new();
    };
    let mut board = match Board::from_fen(starting_fen) {
        Ok(board) => board,
        Err(_) => return Vec::new(),
    };
    for move_text in &mainline[..=knife_index] {
        match board.apply_iccs(move_text) {
            Ok(next) => board = next,
            Err(_) => return Vec::new(),
        }
    }
    board.chinese_pv_notation(best_defense).unwrap_or_default()
}

pub(crate) fn flyknife_step_annotations(
    starting_fen: &str,
    attacker: Color,
    setup_move: Option<&str>,
    lure_move: &str,
    knife_move: &str,
    mainline: &[String],
    best_defense: &[String],
    score_cp: Option<i64>,
    swing_cp: Option<i64>,
) -> Vec<FlyknifeStepAnnotationDto> {
    let mut board = match Board::from_fen(starting_fen) {
        Ok(board) => board,
        Err(_) => return Vec::new(),
    };
    let setup = setup_move.filter(|value| !value.is_empty());
    let defense = best_defense.first().map(String::as_str);
    let knife_index = mainline.iter().position(|value| value == knife_move);
    let attacker_label = if attacker == Color::Red {
        "红方"
    } else {
        "黑方"
    };
    let defender_label = if attacker == Color::Red {
        "黑方"
    } else {
        "红方"
    };

    mainline.iter().enumerate().filter_map(|(index, move_text)| {
        let mover = if board.side_to_move() == Color::Red { "红方" } else { "黑方" };
        let notation = board
            .chinese_pv_notation(std::slice::from_ref(move_text))
            .ok()
            .and_then(|items| items.into_iter().next())
            .unwrap_or_else(|| move_text.clone());
        let role = if setup == Some(move_text.as_str()) {
            Some("setup")
        } else if !lure_move.is_empty() && move_text == lure_move {
            Some("lure")
        } else if move_text == knife_move {
            Some("knife")
        } else if defense == Some(move_text.as_str()) && knife_index.is_some_and(|knife| index > knife) {
            Some("bestDefense")
        } else {
            None
        };
        let next = board.apply_iccs(move_text).ok()?;
        board = next;
        let role = role?;
        let intent = match role {
            "setup" => format!("{attacker_label}先走“{notation}”完成设局，等待对方出现预定应手；这一步本身不等于已经得分。"),
            "lure" => format!("{defender_label}走“{notation}”后，中刀条件成立，轮到{attacker_label}执行预先验证的反击。"),
            "knife" => match score_cp {
                Some(score) if score >= 100 => format!("{attacker_label}以“{notation}”出刀。引擎验证此处形成明显主动，出刀后为 {:+.2} 分。", score as f64 / 100.0),
                Some(score) => format!("{attacker_label}以“{notation}”反击；当前为 {:+.2} 分，属于研究候选，仍需核对最佳防守。", score as f64 / 100.0),
                None => format!("{attacker_label}以“{notation}”反击；分值尚未稳定，需继续提高引擎深度确认。"),
            },
            "bestDefense" => format!("{defender_label}以“{notation}”进行较强防守。这不是中刀线，而是检验该方案风险与可行性的参考应对。"),
            _ => String::new(),
        };
        Some(FlyknifeStepAnnotationDto {
            role: role.into(), iccs: move_text.clone(), notation, side: mover.into(), fen: Some(board.to_fen()),
            score_cp: (role == "knife").then_some(score_cp).flatten(),
            swing_cp: (role == "knife").then_some(swing_cp).flatten(),
            intent, note: None,
        })
    }).collect()
}

#[tauri::command]
pub(crate) async fn generate_flyknife_candidates(
    request: GenerateFlyknifeRequest,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Vec<FlyknifeCandidateDto>, String> {
    let before = Board::from_fen(&request.starting_fen).map_err(|error| error.to_string())?;
    let requested = match request.side.as_str() {
        "red" => Color::Red,
        "black" => Color::Black,
        _ => return Err("飞刀执方必须为红方或黑方".into()),
    };
    let (setup_move, lure_move, before_lure, after_lure) = prepare_flyknife_position(
        &before,
        requested,
        request.setup_move.as_deref().unwrap_or_default(),
        &request.lure_move,
    )?;
    let setup_notation = if setup_move.is_empty() {
        None
    } else {
        before
            .chinese_pv_notation(std::slice::from_ref(&setup_move))
            .ok()
            .and_then(|items| items.into_iter().next())
    };
    let lure_notation = if lure_move.is_empty() {
        None
    } else {
        let lure_position = if setup_move.is_empty() {
            before.clone()
        } else {
            before
                .apply_iccs(&setup_move)
                .map_err(|error| error.to_string())?
        };
        lure_position
            .chinese_pv_notation(std::slice::from_ref(&lure_move))
            .ok()
            .and_then(|items| items.into_iter().next())
    };
    // The cloud book tells us whether an opponent reply is common. The engine alone
    // establishes whether that reply actually loses ground for the attacking side.
    let baseline_score_cp = if lure_move.is_empty() {
        None
    } else {
        let baseline = analyze_position(
            request.engine_path.clone(),
            None,
            Some("飞刀条件基准".into()),
            None,
            before_lure.to_fen(),
            request.search_mode.clone(),
            request.search_value,
            request.threads,
            request.hash_mb,
            1,
            Vec::new(),
            None,
            app.clone(),
            state.clone(),
        )
        .await?;
        // At this point it is the defender's turn. Convert the UCI score to the
        // requested attacker's perspective so both numbers can be compared directly.
        baseline
            .first()
            .and_then(|line| line.score_cp)
            .map(|score| -i64::from(score))
    };
    let lines = analyze_position(
        request.engine_path,
        None,
        Some("飞刀验证".into()),
        None,
        after_lure.to_fen(),
        request.search_mode,
        request.search_value,
        request.threads,
        request.hash_mb,
        3,
        Vec::new(),
        None,
        app,
        state,
    )
    .await?;
    let mut unique = std::collections::BTreeSet::new();
    Ok(lines
        .into_iter()
        .filter_map(|line| {
            let knife_move = line.pv.first()?.clone();
            if !unique.insert(knife_move.clone()) {
                return None;
            }
            let score = line.score_cp;
            let score_cp = score.map(i64::from);
            let swing_cp = score_cp
                .zip(baseline_score_cp)
                .map(|(after, before)| after - before);
            // UCI/Pikafish scores are from the side-to-move perspective. After the lure that
            // side is the requested attacker, regardless of whether it is red or black.
            let favorable =
                score.is_some_and(|value| value >= 100) || line.mate.is_some_and(|value| value > 0);
            let best_defense: Vec<String> = line.pv.iter().skip(1).take(4).cloned().collect();
            let verification = if lure_move.is_empty() {
                "资料案例"
            } else if favorable
                && swing_cp.is_some_and(|swing| swing >= 100)
                && !best_defense.is_empty()
            {
                "已验证飞刀"
            } else {
                "待验证候选"
            };
            let notation = after_lure.chinese_pv_notation(&line.pv).unwrap_or_default();
            let best_defense_notation = after_lure
                .apply_iccs(&knife_move)
                .and_then(|board| board.chinese_pv_notation(&best_defense))
                .unwrap_or_default();
            let full_line = (!setup_move.is_empty())
                .then(|| setup_move.clone())
                .into_iter()
                .chain((!lure_move.is_empty()).then(|| lure_move.clone()))
                .chain(line.pv.iter().cloned())
                .collect::<Vec<_>>();
            let annotations = flyknife_step_annotations(
                &request.starting_fen,
                requested,
                (!setup_move.is_empty()).then_some(setup_move.as_str()),
                &lure_move,
                &knife_move,
                &full_line,
                &best_defense,
                score_cp,
                swing_cp,
            );
            Some(FlyknifeCandidateDto {
                setup_move: (!setup_move.is_empty()).then(|| setup_move.clone()),
                setup_notation: setup_notation.clone(),
                lure_move: lure_move.clone(),
                lure_notation: lure_notation.clone(),
                knife_move,
                mainline: line.pv,
                notation,
                best_defense,
                best_defense_notation,
                score_cp,
                baseline_score_cp,
                swing_cp,
                mate: line.mate.map(i64::from),
                verification: verification.into(),
                verification_depth: line.depth,
                risk: if lure_move.is_empty() {
                    if favorable {
                        "局面强招：当前轮可取得明显主动；这不是预埋飞刀。".into()
                    } else {
                        "局面候选：引擎未确认明显优势，适合继续研究。".into()
                    }
                } else if favorable {
                    "实战可用：对常见应手形成主动攻势；已附引擎主变中的最佳防守。".into()
                } else {
                    "反击候选：引擎未确认明显优势，适合练习和人工复核。".into()
                },
                annotations,
            })
        })
        .take(3)
        .collect())
}

#[tauri::command]
pub(crate) fn list_flyknife_templates() -> Vec<FlyknifeTemplateDto> {
    flyknife_templates()
}

#[tauri::command]
pub(crate) fn list_flyknife_plans(
    state: State<'_, DesktopState>,
) -> Result<Vec<FlyknifePlanDto>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .flyknife_plans()
        .map(|plans| plans.into_iter().map(Into::into).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_flyknife_plan(
    plan: FlyknifePlanDto,
    state: State<'_, DesktopState>,
) -> Result<FlyknifePlanDto, String> {
    if !matches!(plan.side.as_str(), "red" | "black") {
        return Err("飞刀执方必须为红方或黑方".into());
    }
    let mut board = Board::from_fen(&plan.starting_fen).map_err(|error| error.to_string())?;
    let is_starting_position = plan.mainline.is_empty()
        && plan.lure_move.trim().is_empty()
        && plan.knife_move.trim().is_empty();
    let line = if is_starting_position {
        Vec::new()
    } else if plan.mainline.is_empty() {
        vec![plan.lure_move.clone(), plan.knife_move.clone()]
    } else {
        plan.mainline.clone()
    };
    for iccs in &line {
        board = board
            .apply_iccs(iccs)
            .map_err(|_| format!("飞刀主线包含非法着法：{iccs}"))?;
    }
    let id = plan.id.unwrap_or_else(Uuid::new_v4);
    let annotations = if plan.annotations.is_empty() {
        let attacker = if plan.side == "red" {
            Color::Red
        } else {
            Color::Black
        };
        flyknife_step_annotations(
            &plan.starting_fen,
            attacker,
            None,
            &plan.lure_move,
            &plan.knife_move,
            &line,
            &plan.best_defense,
            plan.score_cp,
            None,
        )
        .into_iter()
        .map(Into::into)
        .collect()
    } else {
        plan.annotations.into_iter().map(Into::into).collect()
    };
    let mut stored = FlyknifePlan {
        id,
        title: plan.title.trim().to_owned(),
        side: plan.side.clone(),
        starting_fen: plan.starting_fen.clone(),
        template_id: plan.template_id.clone(),
        template_name: plan.template_name.trim().to_owned(),
        lure_move: plan.lure_move.clone(),
        knife_move: plan.knife_move.clone(),
        mainline: line,
        best_defense: plan.best_defense.clone(),
        score_cp: plan.score_cp,
        mate: plan.mate,
        baseline_score_cp: plan.baseline_score_cp,
        swing_cp: plan.swing_cp,
        verification: plan.verification.clone(),
        verification_depth: plan.verification_depth,
        risk: plan.risk.clone(),
        source_game_id: None,
        source_node_id: None,
        note: plan.note.clone(),
        annotations,
        created_at: Utc::now().to_rfc3339(),
    };
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let source_matches_current = model.board.to_fen() == stored.starting_fen;
    if source_matches_current && !stored.mainline.is_empty() {
        stored.source_game_id = Some(model.game_id);
        stored.source_node_id = model.current_node;
    }
    model
        .store
        .save_flyknife_plan(&stored)
        .map_err(|error| error.to_string())?;
    if source_matches_current
        && !stored.mainline.is_empty()
        && let Some(current_node) = model.current_node
    {
        let tags = vec!["飞刀".into(), "布局陷阱".into(), "最佳防守".into()];
        let task_game_id = model.game_id;
        model
            .store
            .upsert_training_task_with_context(
                task_game_id,
                &format!("flyknife:{}", stored.id),
                current_node,
                &format!("飞刀防守复练：{}", stored.title),
                "先判断诱导条件是否成立；再找出刀着，并写出对方最强防守。保存方案不改变原主线。",
                Some("opening"),
                &tags,
                None,
                "reinforcement",
                "flyknife",
                "flyknife-defense",
                Some(&stored.template_name),
            )
            .map_err(|error| error.to_string())?;
    }
    if source_matches_current {
        let original_board = model.board.clone();
        let original_node = model.current_node;
        let mut first_node = None;
        let mut committed_nodes = Vec::new();
        for iccs in &stored.mainline {
            let _ = commit_move(&mut model, iccs)?;
            if first_node.is_none() {
                first_node = model.current_node;
            }
            if let Some(node_id) = model.current_node {
                committed_nodes.push((node_id, iccs.clone()));
            }
        }
        if first_node.is_some() {
            let notation = Board::from_fen(&stored.starting_fen)
                .and_then(|board| board.chinese_pv_notation(&stored.mainline))
                .unwrap_or_else(|_| stored.mainline.clone());
            let best_defense = flyknife_best_defense_notation(
                &stored.starting_fen,
                &stored.mainline,
                &stored.knife_move,
                &stored.best_defense,
            );
            let summary = format!(
                "飞刀方案：{}\n执方：{}\n诱导：{}\n主变：{}\n最佳防守：{}\n风险：{}\n{}",
                stored.title,
                if stored.side == "red" {
                    "红方"
                } else {
                    "黑方"
                },
                stored.lure_move,
                notation.join(" "),
                if best_defense.is_empty() {
                    "引擎未给出后续".into()
                } else {
                    best_defense.join(" ")
                },
                stored.risk,
                stored.note,
            );
            for (index, (comment_node_id, iccs)) in committed_nodes.iter().enumerate() {
                let annotation = stored.annotations.iter().find(|item| item.iccs == *iccs);
                let annotation_block = annotation.map(|item| {
                    format!(
                        "【飞刀标注】\n阶段：{}\n意图：{}\n分值：{}{}\n【/飞刀标注】",
                        item.role,
                        item.note
                            .as_deref()
                            .filter(|note| !note.trim().is_empty())
                            .unwrap_or(&item.intent),
                        item.score_cp
                            .map(|score| format!("{:+.2} 分", score as f64 / 100.0))
                            .unwrap_or_else(|| "待确认".into()),
                        item.swing_cp
                            .map(|swing| format!(" · 变化 {:+.2} 分", swing as f64 / 100.0))
                            .unwrap_or_default(),
                    )
                });
                let comment = [
                    if index == 0 {
                        Some(summary.clone())
                    } else {
                        None
                    },
                    annotation_block,
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("\n");
                let mut tree = model.tree.clone();
                tree.update_comment(*comment_node_id, comment.clone())
                    .map_err(|error| error.to_string())?;
                let operation = next_operation(
                    &mut model,
                    *comment_node_id,
                    OperationKind::UpdateComment,
                    serde_json::to_value(UpdateCommentPayload {
                        node_id: *comment_node_id,
                        comment: comment.clone(),
                    })
                    .map_err(|error| error.to_string())?,
                );
                model
                    .store
                    .update_comment_with_operation(*comment_node_id, &comment, &operation)
                    .map_err(|error| error.to_string())?;
                model.tree = tree;
            }
        }
        model.board = original_board;
        model.current_node = original_node;
        let game_id = model.game_id;
        model
            .store
            .set_current_node(game_id, original_node)
            .map_err(|error| error.to_string())?;
        let _ = sync_current_game_mirror(&mut model);
    }
    Ok(stored.into())
}

#[tauri::command]
pub(crate) fn delete_flyknife_plan(id: Uuid, state: State<'_, DesktopState>) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .delete_flyknife_plan(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn open_flyknife_practice(
    id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let plan = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .flyknife_plans()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|plan| plan.id == id)
        .ok_or("飞刀方案不存在")?;
    let mut document =
        ManualDocument::new(plan.starting_fen.clone()).map_err(|error| error.to_string())?;
    let best_defense = flyknife_best_defense_notation(
        &plan.starting_fen,
        &plan.mainline,
        &plan.knife_move,
        &plan.best_defense,
    );
    document.metadata.title = format!("飞刀练习 · {}", plan.title);
    document.note = format!(
        "飞刀练习\n执方：{}\n诱导：{}\n出刀：{}\n最佳防守：{}\n风险：{}\n{}",
        if plan.side == "red" {
            "红方"
        } else {
            "黑方"
        },
        plan.lure_move,
        plan.knife_move,
        if best_defense.is_empty() {
            "引擎未给出后续".into()
        } else {
            best_defense.join(" ")
        },
        plan.risk,
        plan.note
    );
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, Some("flyknife-practice".into()))?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn list_coach_reports(
    state: State<'_, DesktopState>,
) -> Result<Vec<GameReportDatasetDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(model
        .store
        .load_latest_game_reports()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|stored| {
            serde_json::from_str::<GameReportDatasetDto>(&stored.dataset_json).ok()
        })
        .filter(|report| !report.stale)
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmitGuidedAnalysisRequest {
    pub(crate) session_id: Uuid,
    pub(crate) submission: GuidedAnalysisSubmission,
    pub(crate) lines: Vec<GuidedEngineLine>,
    pub(crate) task_id: Option<Uuid>,
    #[serde(default)]
    pub(crate) parent_note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuidedAnalysisStartDto {
    pub(crate) session: GuidedAnalysisSession,
    pub(crate) board: BoardDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuidedAnalysisSubmissionDto {
    pub(crate) session: GuidedAnalysisSession,
    pub(crate) result: GuidedAnalysisResultDto,
    pub(crate) attempt: Option<TrainingAttempt>,
}

#[tauri::command]
pub(crate) fn get_learning_profile(
    state: State<'_, DesktopState>,
) -> Result<LearningProfile, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .learning_profile()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_learning_profile(
    profile: LearningProfile,
    state: State<'_, DesktopState>,
) -> Result<LearningProfile, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .save_learning_profile(&profile)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn start_guided_analysis(
    node_id: Option<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<GuidedAnalysisStartDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let problem_node_id = node_id.or(model.current_node);
    let start_node_id = match problem_node_id {
        Some(problem) => {
            let parent = model
                .tree
                .node(problem)
                .map_err(|error| error.to_string())?
                .parent_id;
            (parent != model.tree.root_id()).then_some(parent)
        }
        None => model.current_node,
    };
    let start_board = board_at(&model.starting_fen, &model.tree, start_node_id)?;
    let signature = report_line_signature(&model.tree, model.current_node)?;
    let ply = fen_starting_ply(&model.starting_fen)
        + start_node_id
            .and_then(|node| model.tree.active_line(node).ok().map(|line| line.len()))
            .unwrap_or(0);
    let phase = report_phase(ply, report_material(&start_board));
    let game_id = model.game_id;
    let session = model
        .store
        .start_guided_analysis(
            game_id,
            problem_node_id,
            start_node_id,
            &signature,
            &start_board.to_fen(),
            phase,
        )
        .map_err(|error| error.to_string())?;
    let preview_model = AppModel {
        board: start_board,
        starting_fen: model.starting_fen.clone(),
        tree: model.tree.clone(),
        current_node: start_node_id,
        game_id: model.game_id,
        device_id: model.device_id,
        lamport: model.lamport,
        store: LocalStore::open_in_memory().map_err(|error| error.to_string())?,
        metadata: model.metadata.clone(),
        note: model.note.clone(),
        source_path: model.source_path.clone(),
        source_format: model.source_format.clone(),
        playable: model.playable,
    };
    // The preview DTO is read-only. Its temporary in-memory store prevents this
    // training position from becoming the current persisted manual.
    let board = board_dto(&preview_model)?;
    Ok(GuidedAnalysisStartDto { session, board })
}

#[tauri::command]
pub(crate) fn submit_guided_analysis(
    request: SubmitGuidedAnalysisRequest,
    state: State<'_, DesktopState>,
) -> Result<GuidedAnalysisSubmissionDto, String> {
    if request.submission.chosen_move.trim().is_empty() {
        return Err("请先在棋盘上选择首选着".into());
    }
    if request.submission.candidates.is_empty() {
        return Err("请至少保留一个首选着".into());
    }
    if !(2..=8).contains(&request.submission.predicted_line.len()) {
        return Err("请至少在棋盘上推演 2 个半回合，最多 8 个半回合".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let session = model
        .store
        .guided_analysis_session(request.session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "拆棋会话不存在".to_owned())?;
    if session.status != "thinking" || !session.answer_hidden {
        return Err("本次拆棋已经提交或取消".into());
    }
    if session.game_id != model.game_id
        || session.report_signature != report_line_signature(&model.tree, model.current_node)?
    {
        return Err("棋谱已变化，请从当前问题局面重新开始 U10 拆棋".into());
    }
    let result = classify_submission(request.session_id, &request.submission, request.lines);
    let result_json = serde_json::to_string(&result).map_err(|error| error.to_string())?;
    let game_id = model.game_id;
    let task_id = match (request.task_id, session.problem_node_id) {
        (Some(task_id), _) => Some(task_id),
        (None, Some(node_id)) => {
            model
                .store
                .upsert_training_task_with_context(
                    game_id,
                    &session.report_signature,
                    node_id,
                    "U10 引导拆棋",
                    "先独立判断威胁、强制着和走一思三候选，再用 Pikafish 核对。",
                    Some(&session.phase),
                    &result.theory_signals,
                    None,
                    "reinforcement",
                    "guided-analysis",
                    "guided-analysis",
                    None,
                )
                .map_err(|error| error.to_string())?;
            model
                .store
                .list_training_tasks()
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|task| {
                    task.game_id == game_id
                        && task.report_signature == session.report_signature
                        && task.node_id == node_id
                })
                .map(|task| task.id)
        }
        (None, None) => None,
    };
    let session = model
        .store
        .submit_guided_analysis(
            request.session_id,
            &request.submission,
            &result.result_kind,
            result.score,
            &result_json,
        )
        .map_err(|error| error.to_string())?;
    let attempt = task_id
        .map(|task_id| {
            model.store.save_training_attempt(
                task_id,
                Some(request.session_id),
                &request.submission,
                result.score,
                &result.result_kind,
                &request.parent_note,
            )
        })
        .transpose()
        .map_err(|error| error.to_string())?;
    Ok(GuidedAnalysisSubmissionDto {
        session,
        result,
        attempt,
    })
}

#[tauri::command]
pub(crate) fn cancel_guided_analysis(
    session_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .cancel_guided_analysis(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn generate_daily_training_plan(
    state: State<'_, DesktopState>,
) -> Result<DailyTrainingPlanDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model
        .store
        .learning_profile()
        .map_err(|error| error.to_string())?;
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?;
    let attempts = model
        .store
        .training_attempts(None)
        .map_err(|error| error.to_string())?;
    Ok(daily_plan(&profile, &tasks, &attempts, Utc::now()))
}

#[tauri::command]
pub(crate) fn get_weekly_learning_report(
    state: State<'_, DesktopState>,
) -> Result<WeeklyLearningReportDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?;
    let attempts = model
        .store
        .training_attempts(None)
        .map_err(|error| error.to_string())?;
    Ok(weekly_report(&attempts, &tasks, Utc::now()))
}

#[tauri::command]
pub(crate) fn infer_opening_repertoire_command(
    state: State<'_, DesktopState>,
) -> Result<OpeningRepertoireDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let profile = model
        .store
        .learning_profile()
        .map_err(|error| error.to_string())?;
    let reports = model
        .store
        .load_latest_game_reports()
        .map_err(|error| error.to_string())?;
    let report_by_game = reports
        .into_iter()
        .filter_map(|stored| {
            serde_json::from_str::<GameReportDatasetDto>(&stored.dataset_json)
                .ok()
                .map(|report| (stored.game_id, report))
        })
        .collect::<HashMap<_, _>>();
    let samples = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some("比赛复盘"))
        .filter_map(|game| {
            let report = report_by_game.get(&game.id)?;
            let opening_name = report
                .positions
                .iter()
                .filter_map(|position| position.opening.as_ref())
                .max_by_key(|opening| opening.ply)?
                .name
                .clone();
            let opening_positions = report
                .positions
                .iter()
                .filter(|position| position.phase == "opening")
                .collect::<Vec<_>>();
            let quality_values = opening_positions
                .windows(2)
                .filter_map(|pair| {
                    let before = pair[0].score_cp?;
                    let after = pair[1].score_cp?;
                    let moved_by = pair[1].move_.as_ref()?.moved_by.as_str();
                    let loss = if moved_by == "红方" {
                        before - after
                    } else {
                        after - before
                    }
                    .max(0);
                    Some((100 - (loss / 8)).clamp(0, 100) as u8)
                })
                .collect::<Vec<_>>();
            let average_quality = (!quality_values.is_empty()).then(|| {
                (quality_values
                    .iter()
                    .map(|score| u32::from(*score))
                    .sum::<u32>()
                    / quality_values.len() as u32) as u8
            });
            let typical_deviation = opening_positions
                .windows(2)
                .filter_map(|pair| {
                    let before = pair[0].score_cp?;
                    let after = pair[1].score_cp?;
                    let moved = pair[1].move_.as_ref()?;
                    let loss = if moved.moved_by == "红方" {
                        before - after
                    } else {
                        after - before
                    };
                    (loss >= TRAINING_TASK_LOSS_THRESHOLD_CP).then(|| moved.notation.clone())
                })
                .next();
            let metadata: serde_json::Value = serde_json::from_str(&game.metadata_json).ok()?;
            let child = profile.child_name.trim();
            let side = if !child.is_empty() && metadata["red"].as_str() == Some(child) {
                "red"
            } else if !child.is_empty() && metadata["black"].as_str() == Some(child) {
                "black"
            } else if game.tags.iter().any(|tag| tag == "红方" || tag == "先手") {
                "red"
            } else if game.tags.iter().any(|tag| tag == "黑方" || tag == "后手") {
                "black"
            } else {
                return None;
            };
            Some(OpeningSample {
                game_id: game.id,
                side: side.into(),
                opening_name,
                updated_at: game.updated_at,
                average_quality,
                typical_deviation,
                outcome: metadata["result"].as_str().map(ToOwned::to_owned),
            })
        })
        .collect();
    Ok(infer_opening_repertoire(samples))
}

#[tauri::command]
pub(crate) fn list_training_tasks(
    state: State<'_, DesktopState>,
) -> Result<Vec<TrainingTaskDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())
        .map(|tasks| tasks.into_iter().map(Into::into).collect())
}

const TRAINING_TASK_LOSS_THRESHOLD_CP: i32 = 80;

#[tauri::command]
pub(crate) fn generate_training_tasks(
    state: State<'_, DesktopState>,
) -> Result<TrainingGenerationResultDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let current_signature = report_line_signature(&model.tree, model.current_node)?;
    let Some(stored) = model
        .store
        .load_game_report(model.game_id, &current_signature)
        .map_err(|error| error.to_string())?
    else {
        return Err("请先生成一份整局复盘报告".into());
    };
    let report: GameReportDatasetDto =
        serde_json::from_str(&stored.dataset_json).map_err(|_| "本地复盘报告无效".to_owned())?;
    if report.game_id != model.game_id || report.line_signature != current_signature {
        return Err("棋谱线路已变化，请重新生成整局报告后再创建训练".into());
    }
    let approved_cards = model
        .store
        .theory_cards()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|card| card.review_status == "approved")
        .collect::<Vec<_>>();
    let mut candidates = Vec::new();
    for (index, position) in report.positions.iter().enumerate().skip(1) {
        let Some(moved) = position.move_.as_ref() else {
            continue;
        };
        let (Some(before), Some(after)) = (report.positions[index - 1].score_cp, position.score_cp)
        else {
            continue;
        };
        let loss = if moved.moved_by == "红方" {
            before - after
        } else {
            after - before
        };
        if loss < 30 {
            continue;
        }
        candidates.push((index, loss));
    }

    let critical = candidates
        .iter()
        .copied()
        .filter(|(_, loss)| *loss >= TRAINING_TASK_LOSS_THRESHOLD_CP)
        .collect::<Vec<_>>();
    let reinforcement = if critical.is_empty() {
        let mut rows = candidates
            .iter()
            .copied()
            .filter(|(_, loss)| *loss < TRAINING_TASK_LOSS_THRESHOLD_CP)
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| right.1.cmp(&left.1));
        rows.into_iter().take(3).collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for (index, loss) in critical.iter().chain(reinforcement.iter()).copied() {
        let position = &report.positions[index];
        let moved = position
            .move_
            .as_ref()
            .expect("training candidate has move");
        let move_number = (position.ply + 1) / 2;
        let best = position
            .best_notation
            .as_deref()
            .unwrap_or("重新寻找更稳健的着法");
        let task_type = if loss >= TRAINING_TASK_LOSS_THRESHOLD_CP {
            "critical"
        } else {
            "reinforcement"
        };
        let tags = training_tags_for_position(position, loss);
        let engine_signal = engine_signal_for_position(position, &tags, loss);
        let source_card =
            best_matching_theory_card(&approved_cards, &position.phase, &tags, engine_signal);
        model
            .store
            .upsert_training_task_with_context(
                report.game_id,
                &report.line_signature,
                moved.node_id,
                &format!(
                    "{}第 {move_number} 手：{}",
                    if task_type == "critical" {
                        "关键复练"
                    } else {
                        "巩固复练"
                    },
                    moved.notation
                ),
                &format!(
                    "本着评价变化约 {loss}cp。先按{}阶段重算候选，再比较推荐着法：{best}。标签：{}",
                    phase_label(&position.phase),
                    tags.join(" / ")
                ),
                Some(&position.phase),
                &tags,
                source_card.map(|card| card.id),
                task_type,
                if position.phase == "opening" {
                    "report"
                } else {
                    "report"
                },
                if position.phase == "opening" {
                    "opening-deviation"
                } else {
                    "guided-analysis"
                },
                position
                    .opening
                    .as_ref()
                    .map(|opening| opening.name.as_str()),
            )
            .map_err(|error| error.to_string())?;
        if let Some(card) = source_card {
            let _ = model.store.record_theory_card_match(
                report.game_id,
                &report.line_signature,
                moved.node_id,
                card.id,
                card.version,
                engine_signal,
                &tags,
                &format!("复盘第 {move_number} 手自动命中：{}", moved.notation),
            );
        }
    }
    if let Some(position) = report.positions.iter().find(|position| {
        position.phase == "opening" && position.opening.is_some() && position.move_.is_some()
    }) {
        let moved = position.move_.as_ref().expect("opening position has move");
        let opening = position.opening.as_ref().expect("opening is present");
        let tags = vec!["开局".into(), "专属布局".into(), "标准路线".into()];
        model
            .store
            .upsert_training_task_with_context(
                report.game_id,
                &format!("{}:opening-route", report.line_signature),
                moved.node_id,
                &format!("标准布局路线：{}", opening.name),
                "从该局面开始，用本地开局资料和 Pikafish 核对关键主线；每一步先写出目的，再确认主要应手。",
                Some("opening"),
                &tags,
                None,
                "reinforcement",
                "opening-route",
                "standard-route",
                Some(&opening.name),
            )
            .map_err(|error| error.to_string())?;
    }
    let tasks = model
        .store
        .list_training_tasks()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|task| {
            task.game_id == model.game_id
                && (task.report_signature == current_signature
                    || task.report_signature == format!("{}:opening-route", current_signature))
        })
        .map(Into::into)
        .collect();
    Ok(TrainingGenerationResultDto {
        tasks,
        critical_count: critical.len(),
        reinforcement_count: reinforcement.len(),
    })
}

pub(crate) fn best_matching_theory_card<'a>(
    cards: &'a [TheoryCard],
    phase: &str,
    tags: &[String],
    engine_signal: &str,
) -> Option<&'a TheoryCard> {
    let normalized_tags = tags
        .iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let normalized_signal = engine_signal.trim().to_lowercase();
    cards
        .iter()
        .filter(|card| (card.phase == phase || card.phase == "all") && !card.needs_recheck)
        .filter_map(|card| {
            let haystack = format!(
                "{} {} {} {} {}",
                card.title,
                card.summary,
                card.applies_when,
                card.risk,
                card.tags.join(" ")
            )
            .to_lowercase();
            let tag_score = normalized_tags
                .iter()
                .filter(|tag| haystack.contains(tag.as_str()))
                .map(|tag| theory_tag_weight(tag))
                .sum::<i64>();
            let correlation_hits = card
                .engine_correlations
                .iter()
                .filter(|correlation| correlation.trim().to_lowercase() == normalized_signal)
                .count() as i64;
            let score = tag_score + correlation_hits * 12 - card.match_penalty * 3;
            (score > 0).then_some((score, card))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, card)| card)
}

pub(crate) fn theory_tag_weight(tag: &str) -> i64 {
    match tag {
        "开局" | "中局" | "残局" | "复盘" | "推荐着对比" => 1,
        "脱离体系" | "战略方向" | "子力协调" | "候选着" | "计算" | "理论胜和" | "兑子" => {
            5
        }
        "残局打底" | "战术漏算" | "候选着计算" | "专属布局" | "深度复盘" | "慢棋训练"
        | "心态管理" => 18,
        _ => 14,
    }
}

pub(crate) fn engine_signal_for_position(
    position: &GameReportPositionDto,
    tags: &[String],
    loss: i32,
) -> &'static str {
    if position.mate.is_some() {
        return "missed_tactic";
    }
    if tags.iter().any(|tag| tag.contains("兑子")) {
        return "exchange_miscalculation";
    }
    if tags.iter().any(|tag| tag.contains("理论胜和")) {
        return "endgame_theoretical_win_draw";
    }
    if tags.iter().any(|tag| tag.contains("脱离体系")) {
        return "opening_deviation";
    }
    if tags.iter().any(|tag| tag.contains("子力协调")) {
        return "development_lag";
    }
    if loss >= 300 || tags.iter().any(|tag| tag.contains("战术漏算")) {
        return "missed_tactic";
    }
    if tags.iter().any(|tag| tag.contains("候选着")) {
        return "missed_candidate";
    }
    "plan_without_counterplay_check"
}

pub(crate) fn phase_label(phase: &str) -> &'static str {
    match phase {
        "opening" => "开局",
        "middle" => "中局",
        "endgame" => "残局",
        _ => "复盘",
    }
}

pub(crate) fn training_tags_for_position(
    position: &GameReportPositionDto,
    loss: i32,
) -> Vec<String> {
    let mut tags = match position.phase.as_str() {
        "opening" => vec![
            "开局",
            "脱离体系",
            "战略方向",
            "子力协调",
            "专属布局",
            "开局失误",
        ],
        "middle" => vec!["中局", "候选着", "计算", "候选着计算"],
        "endgame" => vec!["残局", "理论胜和", "兑子", "残局打底", "残局处理"],
        _ => vec!["复盘", "深度复盘"],
    }
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    tags.push("深度复盘".into());
    if position.mate.is_some() {
        tags.push("漏杀/防杀".into());
        tags.push("战术漏算".into());
    } else if loss >= 300 {
        tags.push("战术漏算".into());
    }
    if loss >= 150 {
        tags.push("随手棋".into());
    }
    if loss >= 500 {
        tags.push("心态管理".into());
        tags.push("心态波动".into());
    }
    if position.best_notation.is_some() {
        tags.push("推荐着对比".into());
        tags.push("候选着计算".into());
    }
    add_notation_tags(position, &mut tags);
    tags.sort();
    tags.dedup();
    tags
}

pub(crate) fn add_notation_tags(position: &GameReportPositionDto, tags: &mut Vec<String>) {
    let text = position
        .move_
        .as_ref()
        .map(|move_| move_.notation.as_str())
        .unwrap_or_default();
    let mut add = |tag: &str| tags.push(tag.to_owned());
    if text.contains('车') {
        add("出车选择");
        add("线路控制");
    }
    if text.contains('马') {
        add("活马");
    }
    if text.contains('炮') {
        add("炮位");
        add("炮路");
    }
    if text.contains('兵') || text.contains('卒') {
        add("兵卒出动");
        add("兵卒效率");
    }
    if text.contains('仕') || text.contains('士') {
        add("补士");
        add("将位");
    }
    if text.contains("肋") {
        add("肋道");
    }
    if text.contains('兑') {
        add("兑子");
    }
}

#[tauri::command]
pub(crate) fn complete_training_task(
    task_id: Uuid,
    completed: bool,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .complete_training_task(task_id, completed)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_training_summary(
    state: State<'_, DesktopState>,
) -> Result<TrainingSummaryDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(TrainingSummaryDto {
        weak_spots: model
            .store
            .weakness_stats(12)
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub(crate) fn save_theory_feedback(
    feedback: TheoryFeedbackRequest,
    state: State<'_, DesktopState>,
) -> Result<TheoryCardFeedback, String> {
    if !matches!(
        feedback.verdict.as_str(),
        "correct" | "incorrect" | "needs_revision"
    ) {
        return Err("反馈只能是 correct、incorrect 或 needs_revision".into());
    }
    if feedback.note.chars().count() > 1_000 {
        return Err("反馈说明最多 1000 字".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .save_theory_card_feedback(
            feedback.match_id,
            feedback.card_id,
            feedback.card_version,
            &feedback.verdict,
            feedback.note.trim(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_study_sessions(
    state: State<'_, DesktopState>,
) -> Result<Vec<StudySession>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .study_sessions(model.game_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_study_session(
    reflection: String,
    tags: Vec<String>,
    state: State<'_, DesktopState>,
) -> Result<StudySession, String> {
    let reflection = reflection.trim();
    if reflection.is_empty() {
        return Err("请先写下本局要核验的问题或复盘结论".into());
    }
    if reflection.chars().count() > 2_000 {
        return Err("训练总结最多 2000 字".into());
    }
    let tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .take(8)
        .collect::<Vec<_>>();
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game_id = model.game_id;
    let node_id = model.current_node;
    model
        .store
        .save_study_session(game_id, node_id, reflection, &tags)
        .map_err(|error| error.to_string())
}

pub(crate) fn collect_theory_videos(
    directory: &Path,
    files: &mut Vec<PathBuf>,
    downloading: &mut usize,
) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("读取课程目录失败：{error}")),
    };
    for entry in entries {
        let path = entry
            .map_err(|error| format!("读取课程文件失败：{error}"))?
            .path();
        if path.is_dir() {
            collect_theory_videos(&path, files, downloading)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("mp4") {
            files.push(path);
        } else if path.to_string_lossy().ends_with(".baiduyun.p.downloading") {
            *downloading += 1;
        }
    }
    Ok(())
}

pub(crate) fn theory_fingerprint(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取课程文件信息失败：{error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    Ok(format!("{}:{modified}", metadata.len()))
}

pub(crate) fn theory_library_dto(
    store: &LocalStore,
    downloading_files: usize,
) -> Result<TheoryLibraryDto, String> {
    Ok(TheoryLibraryDto {
        lessons: store.theory_lessons().map_err(|error| error.to_string())?,
        cards: store.theory_cards().map_err(|error| error.to_string())?,
        downloading_files,
    })
}

#[tauri::command]
pub(crate) fn scan_theory_library(
    state: State<'_, DesktopState>,
) -> Result<TheoryLibraryDto, String> {
    let mut discovered = Vec::new();
    let mut downloading_files = 0;
    for (phase, course_name, root) in THEORY_COURSE_ROOTS {
        let root_path = Path::new(root);
        let mut videos = Vec::new();
        collect_theory_videos(root_path, &mut videos, &mut downloading_files)?;
        for path in videos {
            let title = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("未命名课程")
                .to_owned();
            discovered.push((phase, course_name, path, title));
        }
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    for (phase, course_name, path, title) in discovered {
        let source_path = path.to_string_lossy().into_owned();
        let fingerprint = theory_fingerprint(&path)?;
        model
            .store
            .upsert_theory_lesson(phase, course_name, &title, &source_path, &fingerprint)
            .map_err(|error| error.to_string())?;
    }
    theory_library_dto(&model.store, downloading_files)
}

#[tauri::command]
pub(crate) fn get_theory_library(
    state: State<'_, DesktopState>,
) -> Result<TheoryLibraryDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    theory_library_dto(&model.store, 0)
}

#[tauri::command]
pub(crate) fn review_theory_card(
    card: TheoryCard,
    state: State<'_, DesktopState>,
) -> Result<TheoryCard, String> {
    if !matches!(
        card.review_status.as_str(),
        "pending" | "approved" | "rejected"
    ) {
        return Err("无效的原则卡审核状态".into());
    }
    if card.title.trim().is_empty()
        || card.summary.trim().is_empty()
        || card.applies_when.trim().is_empty()
        || card.risk.trim().is_empty()
    {
        return Err("原则卡需要标题、短摘要、适用条件和风险说明".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .review_theory_card(&card)
        .map_err(|error| error.to_string())?;
    Ok(card)
}

#[tauri::command]
pub(crate) fn create_theory_card(
    lesson_id: i64,
    title: String,
    summary: String,
    applies_when: String,
    risk: String,
    timecode: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<TheoryCard, String> {
    if title.trim().is_empty()
        || summary.trim().is_empty()
        || applies_when.trim().is_empty()
        || risk.trim().is_empty()
    {
        return Err("原则卡需要标题、短摘要、适用条件和风险说明".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .create_theory_card(
            lesson_id,
            &title,
            &summary,
            &applies_when,
            &risk,
            timecode.as_deref(),
        )
        .map_err(|error| error.to_string())
}
