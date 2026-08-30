use super::*;
use std::collections::{HashMap, HashSet};

const TTXQ_WINDOW_LABEL: &str = "ttxq-sync";
const BRIDGE_VERSION: u32 = 1;
const MAX_GAMES: usize = 20_000;
const MAX_SCAN_NODES: usize = 20_000;
const MAX_MOVES_PER_GAME: usize = 1_000;
const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
const TTXQ_BACKUP_FOLDER: &str = "天天象棋备份";
const TTXQ_ORDERED_SOURCE_PREFIX: &str = "ttxq-order:";
const BRIDGE_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const BRIDGE_PROGRESS_STALL_TIMEOUT: Duration = Duration::from_secs(20);

fn normalize_ttxq_target_folder(target_folder: Option<String>) -> Result<String, String> {
    let folder = target_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(TTXQ_BACKUP_FOLDER);
    crate::manual_service::normalize_library_folder_path(folder)
}

fn ordered_source_path(qipu_id: &str, source_order: usize) -> String {
    format!("{TTXQ_ORDERED_SOURCE_PREFIX}{source_order:06}:{qipu_id}")
}

pub(crate) fn source_order_from_path(source_path: Option<&str>) -> Option<usize> {
    source_path?
        .strip_prefix(TTXQ_ORDERED_SOURCE_PREFIX)?
        .split_once(':')?
        .0
        .parse()
        .ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqVariationDto {
    pub after_ply: usize,
    pub moves: Vec<String>,
    #[serde(default)]
    pub route_no: Option<usize>,
    #[serde(default)]
    pub source_key: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub children: Vec<TtxqVariationDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqGameRecordDto {
    pub qipu_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub starting_fen: String,
    #[serde(default)]
    pub moves: Vec<String>,
    #[serde(default)]
    pub raw_moves: String,
    #[serde(default)]
    pub raw_move_path: String,
    #[serde(default)]
    pub raw_move_type: String,
    #[serde(default)]
    pub raw_move_length: usize,
    #[serde(default)]
    pub variations: Vec<TtxqVariationDto>,
    /// Raw branch metadata is local-only until a deterministic QQ branch decoder
    /// has converted it into `variations`.
    #[serde(default)]
    pub branch_data: String,
    #[serde(default)]
    pub branch_path: String,
    #[serde(default)]
    pub branch_complete: bool,
    #[serde(default)]
    pub red: String,
    #[serde(default)]
    pub black: String,
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub site: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub round: String,
    #[serde(default)]
    pub played_at: String,
    #[serde(default)]
    pub duration: String,
    #[serde(default)]
    pub time_control: String,
    /// Bounded metadata-only probe used to adapt to QQ display-object changes.
    /// It is stored only in the local diagnostic ring and never participates in
    /// payload hashes, outbox operations, or cloud synchronization.
    #[serde(default, skip_serializing)]
    pub metadata_probe: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqBridgePayloadDto {
    pub version: u32,
    pub games: Vec<TtxqGameRecordDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqSyncProgressDto {
    pub state: String,
    pub read_phase: String,
    pub read_scanned: usize,
    pub read_current: usize,
    pub read_total: usize,
    pub read_completed: usize,
    pub read_failed: usize,
    pub loaded: usize,
    pub completed: usize,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqGamePreviewDto {
    pub qipu_id: String,
    pub title: String,
    pub red: String,
    pub black: String,
    pub event: String,
    pub date: String,
    pub result: String,
    pub round: String,
    pub played_at: String,
    pub duration: String,
    pub move_count: usize,
    pub variation_count: usize,
    pub route_count: usize,
    pub decoded_route_count: usize,
    pub variation_node_count: usize,
    pub branch_complete: bool,
    pub valid: bool,
    pub error: Option<String>,
    pub diagnostic: Option<String>,
}

impl Default for TtxqSyncProgressDto {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            read_phase: String::new(),
            read_scanned: 0,
            read_current: 0,
            read_total: 0,
            read_completed: 0,
            read_failed: 0,
            loaded: 0,
            completed: 0,
            imported: 0,
            skipped: 0,
            failed: 0,
            message: "未连接天天象棋".into(),
        }
    }
}

#[derive(Default)]
pub(crate) struct TtxqSyncState {
    pub(crate) progress: TtxqSyncProgressDto,
    payload: Option<TtxqBridgePayloadDto>,
    active_attempt: u64,
    next_attempt: u64,
    bridge_acknowledged: bool,
    progress_revision: u64,
}

fn advance_progress_revision(sync: &mut TtxqSyncState) {
    sync.progress_revision = sync.progress_revision.wrapping_add(1);
}

fn begin_read_attempt(sync: &mut TtxqSyncState) -> u64 {
    sync.next_attempt = sync.next_attempt.wrapping_add(1).max(1);
    sync.active_attempt = sync.next_attempt;
    sync.bridge_acknowledged = false;
    sync.progress = TtxqSyncProgressDto {
        state: "reading".into(),
        read_phase: "discovering".into(),
        message: "正在连接天天象棋网页桥接；请保持授权窗口打开".into(),
        ..TtxqSyncProgressDto::default()
    };
    sync.payload = None;
    advance_progress_revision(sync);
    sync.active_attempt
}

fn acknowledge_bridge(sync: &mut TtxqSyncState, attempt_id: u64) -> Result<(), String> {
    if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
        return Err("天天象棋读取任务已失效，请重新读取".into());
    }
    sync.bridge_acknowledged = true;
    Ok(())
}

fn set_read_error(sync: &mut TtxqSyncState, attempt_id: u64, message: &str) -> bool {
    if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
        return false;
    }
    let read_total = sync.progress.read_total;
    let read_completed = sync.progress.read_completed;
    let read_failed = sync.progress.read_failed;
    sync.progress = TtxqSyncProgressDto {
        state: "error".into(),
        read_total,
        read_completed,
        read_failed,
        message: format!(
            "读取失败：{}",
            message.chars().take(160).collect::<String>()
        ),
        ..TtxqSyncProgressDto::default()
    };
    true
}

fn fail_unacknowledged_bridge(sync: &mut TtxqSyncState, attempt_id: u64, host: &str) -> bool {
    if sync.progress.state != "reading"
        || sync.active_attempt != attempt_id
        || sync.bridge_acknowledged
    {
        return false;
    }
    let safe_host: String = host
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
        .take(120)
        .collect();
    set_read_error(
        sync,
        attempt_id,
        &format!(
            "远程 IPC 未启动或页面已导航（{}）；请关闭授权窗口后重新打开，再进入最近对局",
            if safe_host.is_empty() {
                "未知页面"
            } else {
                &safe_host
            }
        ),
    )
}

fn fail_stalled_read(sync: &mut TtxqSyncState, attempt_id: u64, observed_revision: u64) -> bool {
    if sync.progress.state != "reading"
        || sync.active_attempt != attempt_id
        || sync.progress_revision != observed_revision
    {
        return false;
    }
    let location = if sync.progress.read_current > 0 && sync.progress.read_total > 0 {
        format!(
            "第 {}/{} 盘",
            sync.progress.read_current, sync.progress.read_total
        )
    } else {
        "棋谱列表".into()
    };
    set_read_error(
        sync,
        attempt_id,
        &format!(
            "{location}长时间没有进度；已停止本次读取。请确认授权窗口中的棋谱详情可回放后重试"
        ),
    )
}

fn payload_hash(game: &TtxqGameRecordDto) -> Result<String, String> {
    Ok(format!(
        "sha256:{:x}",
        sha2::Sha256::digest(serde_json::to_vec(game).map_err(|error| error.to_string())?)
    ))
}

fn source_note(record: &TtxqGameRecordDto) -> String {
    source_note_with_existing(&record.note, record)
}

fn source_note_with_existing(existing_note: &str, record: &TtxqGameRecordDto) -> String {
    let source_labels = [
        "来源",
        "棋谱手数",
        "回合",
        "对局时间",
        "对局用时",
        "用时规则",
        "网页分支",
    ];
    let mut lines: Vec<String> = existing_note
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            !source_labels
                .iter()
                .any(|label| line.starts_with(&format!("{label}：")))
        })
        .map(ToOwned::to_owned)
        .collect();
    let move_count = if record.moves.len() % 2 == 0 {
        format!(
            "{} 回合（{} 半回合）",
            record.moves.len() / 2,
            record.moves.len()
        )
    } else {
        format!("{} 半回合", record.moves.len())
    };
    for (label, value) in [
        ("来源", "天天象棋网页"),
        ("棋谱手数", move_count.as_str()),
        ("回合", record.round.as_str()),
        ("对局时间", record.played_at.as_str()),
        ("对局用时", record.duration.as_str()),
        ("用时规则", record.time_control.as_str()),
        (
            "网页分支",
            if !record.branch_data.trim().is_empty() && !record.branch_complete {
                "已发现分支数据，当前版本仅确定导入主线；分支结构待适配"
            } else {
                ""
            },
        ),
    ] {
        let value = value.trim();
        if !value.is_empty() {
            let line = format!("{label}：{value}");
            if !lines.contains(&line) {
                lines.push(line);
            }
        }
    }
    lines.join("\n")
}

fn is_placeholder_title(title: &str) -> bool {
    let title = title.trim();
    title.is_empty()
        || title.starts_with("Panel_")
        || title.starts_with("preLink")
        || title.contains("<PrefabLink>")
        || title.contains("QipuChessBoardControl")
        || title.starts_with("天天象棋 ")
        || matches!(
            title,
            "自建棋谱" | "棋力评测" | "收藏棋谱" | "最近对局" | "棋谱&记谱"
        )
}

fn ttxq_player_name(value: &str) -> String {
    let value = value.trim();
    value
        .rsplit_once('[')
        .filter(|(_, rank)| rank.ends_with(']'))
        .map(|(name, _)| name.trim())
        .unwrap_or(value)
        .to_owned()
}

fn ttxq_title(record: &TtxqGameRecordDto) -> String {
    if !is_placeholder_title(&record.title) {
        return record.title.trim().to_owned();
    }
    let result = match record.result.trim() {
        "1-0" => "红胜",
        "0-1" => "黑胜",
        "1/2-1/2" => "和棋",
        value => value,
    };
    match (record.red.trim(), record.black.trim()) {
        (red, black) if !red.is_empty() && !black.is_empty() => {
            format!("{red} vs {black} · 天天象棋")
        }
        (red, _) if !red.is_empty() => [red, result, record.round.trim()]
            .into_iter()
            .filter(|value| !value.is_empty() && *value != "*")
            .collect::<Vec<_>>()
            .join(" · "),
        _ => {
            let summary = [record.event.trim(), record.played_at.trim(), result]
                .into_iter()
                .filter(|value| !value.is_empty() && *value != "*")
                .collect::<Vec<_>>()
                .join(" · ");
            if summary.is_empty() {
                format!("天天象棋 {}", record.qipu_id)
            } else {
                summary
            }
        }
    }
}

fn enrich_title_metadata(record: &mut TtxqGameRecordDto) {
    let move_count = if record.moves.is_empty() {
        let starting_fen = if record.starting_fen.trim().is_empty() {
            STARTING_FEN
        } else {
            record.starting_fen.as_str()
        };
        resolved_moves(record, starting_fen)
            .ok()
            .map(|moves| moves.len())
    } else {
        Some(record.moves.len())
    };
    let expected_round = move_count
        .filter(|count| *count > 0)
        .map(|count| count.div_ceil(2));
    let title = record.title.trim().to_owned();
    if !title.is_empty()
        && record.black.trim().is_empty()
        && ttxq_player_name(&record.red) == ttxq_player_name(&title)
    {
        // Self-recorded/favourite QQ chess manuals often expose the card title
        // again through `sRedName`. Treat it as a title, not as a real player.
        record.red.clear();
    }
    if is_placeholder_title(&title) {
        if let Some(round) = expected_round {
            record.round = format!("{round} 回合");
        }
        return;
    }
    let outcome = ["先胜", "先负", "先和", "后胜", "后负", "后和"]
        .into_iter()
        .find_map(|marker| title.find(marker).map(|index| (marker, index)));
    let title_round = title
        .split_once("回合")
        .map(|(value, _)| value.trim_end())
        .map(|value| {
            value
                .chars()
                .rev()
                .skip_while(|character| !character.is_ascii_digit())
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        })
        .filter(|digits| !digits.is_empty())
        .and_then(|digits| digits.parse::<usize>().ok());
    let title_player = outcome.map(|(_, index)| ttxq_player_name(&title[..index]));
    let stale_title = title_player.is_some_and(|player| {
        !record.red.trim().is_empty() && player != ttxq_player_name(&record.red)
    }) || expected_round
        .zip(title_round)
        .is_some_and(|(expected, actual)| expected != actual);
    if stale_title {
        record.title.clear();
    }
    let title = record.title.trim().to_owned();
    let outcome = ["先胜", "先负", "先和", "后胜", "后负", "后和"]
        .into_iter()
        .find_map(|marker| title.find(marker).map(|index| (marker, index)));
    if let Some((marker, index)) = outcome {
        if record.red.trim().is_empty() {
            let player = ttxq_player_name(&title[..index]);
            if !player.is_empty() {
                record.red = player;
            }
        }
        if record.result.trim().is_empty() || record.result == "*" {
            record.result = match marker {
                "先胜" | "后负" => "1-0",
                "先负" | "后胜" => "0-1",
                "先和" | "后和" => "1/2-1/2",
                _ => "*",
            }
            .to_owned();
        }
    }
    if let Some(round) = expected_round {
        record.round = format!("{round} 回合");
    } else if record.round.trim().is_empty() {
        let before_round = title
            .split_once("回合")
            .map(|(value, _)| value.trim_end())
            .unwrap_or("");
        let digits = before_round
            .chars()
            .rev()
            .skip_while(|character| !character.is_ascii_digit())
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        if !digits.is_empty() {
            record.round = format!("{digits} 回合");
        }
    }
}

fn same_persisted_mainline(
    model: &AppModel,
    game: &local_store::LocalGame,
    moves: &[String],
) -> Result<bool, String> {
    let nodes = model
        .store
        .load_move_nodes(game.id)
        .map_err(|error| error.to_string())?;
    let mut parent = game.root_id;
    for expected in moves {
        let next = nodes
            .iter()
            .filter(|node| !node.deleted && node.parent_id == parent && node.is_mainline)
            .min_by_key(|node| node.order_key);
        let Some(node) = next else {
            return Ok(false);
        };
        if node.mv.to_iccs() != expected.as_str() {
            return Ok(false);
        }
        parent = node.id;
    }
    Ok(!nodes
        .iter()
        .any(|node| !node.deleted && node.parent_id == parent && node.is_mainline))
}

fn backfill_existing_game(
    model: &mut AppModel,
    game: &local_store::LocalGame,
    record: &TtxqGameRecordDto,
) -> Result<bool, String> {
    let mut metadata =
        serde_json::from_str::<ManualMetadata>(&game.metadata_json).unwrap_or_default();
    let previous_metadata = metadata.clone();
    if is_placeholder_title(&game.title) {
        metadata.title = ttxq_title(record);
    }
    if metadata.event.trim().is_empty() {
        metadata.event = record.event.trim().to_owned();
    }
    if metadata.site.trim().is_empty() {
        metadata.site = record.site.trim().to_owned();
    }
    if metadata.date.trim().is_empty() {
        metadata.date = record.date.trim().to_owned();
    }
    if metadata.red.trim().is_empty() {
        metadata.red = record.red.trim().to_owned();
    }
    if metadata.black.trim().is_empty() {
        metadata.black = record.black.trim().to_owned();
    }
    if metadata.result.trim().is_empty() || metadata.result == "*" {
        metadata.result = if record.result.trim().is_empty() {
            "*".into()
        } else {
            record.result.trim().to_owned()
        };
    }
    let note = source_note_with_existing(&game.note, record);
    if metadata == previous_metadata && note == game.note {
        return Ok(false);
    }
    let operation = next_operation_for_game(
        model,
        game.id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(metadata_payload(&metadata, &note))
            .map_err(|error| error.to_string())?,
    );
    let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
    model
        .store
        .update_game_metadata_with_operation(
            game.id,
            &metadata.title,
            &note,
            &metadata_json,
            &operation,
        )
        .map_err(|error| error.to_string())?;
    Ok(true)
}

fn append_ttxq_variations_to_existing(
    model: &mut AppModel,
    game: &local_store::LocalGame,
    record: &TtxqGameRecordDto,
) -> Result<usize, String> {
    if record.variations.is_empty() {
        return Ok(0);
    }
    let stored_nodes = model
        .store
        .load_move_nodes(game.id)
        .map_err(|error| error.to_string())?;
    let existing_ids = stored_nodes
        .iter()
        .map(|node| node.id)
        .collect::<HashSet<_>>();
    let mut tree = xiangqi_manual::ManualTree::with_root(game.root_id);
    tree.restore_nodes(stored_nodes)
        .map_err(|error| error.to_string())?;
    let mut document =
        ManualDocument::new(&game.starting_fen).map_err(|error| error.to_string())?;
    document.tree = tree;
    let mut parent = game.root_id;
    let mut parents = vec![game.root_id];
    for raw_move in &record.moves {
        let next = document
            .tree
            .branches(parent)
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|node| node.is_mainline && node.mv.to_iccs() == raw_move.as_str())
            .map(|node| node.id)
            .ok_or("现有棋谱主线与天天象棋主线不一致")?;
        parent = next;
        parents.push(parent);
    }
    for variation in &record.variations {
        insert_ttxq_variation(
            &mut document,
            &game.starting_fen,
            &record.moves,
            &parents,
            variation,
        )?;
    }
    let mut entries = Vec::new();
    let nodes = collect_nodes(&document.tree)?;
    for node in nodes
        .into_iter()
        .filter(|node| !existing_ids.contains(&node.id))
    {
        model.lamport += 1;
        let operation = Operation {
            op_id: Uuid::new_v4(),
            device_id: model.device_id,
            entity_id: node.id,
            game_id: game.id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id: node.id,
                parent_id: node.parent_id,
                move_iccs: node.mv.to_iccs(),
                order_key: node.order_key,
                is_mainline: node.is_mainline,
            })
            .map_err(|error| error.to_string())?,
            lamport: model.lamport,
            created_at: Utc::now(),
        };
        entries.push((node, operation));
    }
    let added = entries.len();
    model
        .store
        .append_move_nodes_with_operations(game.id, game.current_node_id, &entries)
        .map_err(|error| error.to_string())?;
    Ok(added)
}

fn reload_active_game_after_ttxq_import(
    model: &mut AppModel,
    active_game_id: Uuid,
) -> Result<(), String> {
    let game = model
        .store
        .load_game(active_game_id)
        .map_err(|error| error.to_string())?
        .ok_or("导入前打开的棋谱不存在")?;
    load_game_into_model(model, game)
}

fn finish_ttxq_import_attempt<T>(
    model: &mut AppModel,
    active_game_id: Uuid,
    import_result: Result<T, String>,
) -> Result<T, String> {
    let restore_result = reload_active_game_after_ttxq_import(model, active_game_id);
    match (import_result, restore_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(restore_error)) => {
            Err(format!("{error}；恢复导入前棋谱失败：{restore_error}"))
        }
    }
}

fn resolved_moves(record: &TtxqGameRecordDto, starting_fen: &str) -> Result<Vec<String>, String> {
    if !record.moves.is_empty() {
        return Ok(record.moves.clone());
    }
    let dhtml = extract_dhtml_moves(record);
    if !dhtml.is_empty() {
        return Ok(dhtml);
    }
    let raw_iccs = extract_iccs_moves(&record.raw_moves);
    if !raw_iccs.is_empty() {
        return Ok(raw_iccs);
    }
    let notation = crate::training_service::chinese_move_tokens(&record.raw_moves);
    if notation.is_empty() {
        return Err(if bridge_snapshot_mentions_move_field(record) {
            "走法格式不兼容：已找到天天象棋走法字段，但元素类型/序列化失败"
        } else {
            "走法格式不兼容：未识别 ICCS 或中文着法"
        }
        .into());
    }
    crate::manual_service::parse_chinese_line(starting_fen.into(), notation)
        .map(|parsed| parsed.moves)
}

#[derive(Debug, Clone)]
struct TtxqBranchCandidate {
    source_key: String,
    raw: String,
    after_ply: Option<usize>,
    route_no: Option<usize>,
    comment: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DhtmlBranchKey {
    parent_branch_id: usize,
    parent_ply: usize,
    branch_id: usize,
}

#[derive(Debug, Clone)]
struct DecodedDhtmlBranch {
    key: DhtmlBranchKey,
    prefix_before_moves: Vec<String>,
    variation: TtxqVariationDto,
}

fn prepare_import_record(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> Result<TtxqGameRecordDto, String> {
    let mut prepared = record.clone();
    prepared.moves = resolved_moves(&prepared, starting_fen)?;
    let decoded = decode_ttxq_branch_variations(&prepared, starting_fen)?;
    let expected_routes = expected_branch_routes(&prepared.branch_data);
    let decoded_routes = decoded_branch_routes(&decoded);
    if decoded.is_empty() && !prepared.branch_data.trim().is_empty() && !prepared.branch_complete {
        return Err(ttxq_branch_failure_message(&prepared));
    }
    let missing_routes = expected_routes
        .iter()
        .copied()
        .filter(|route_no| !decoded_routes.contains(route_no))
        .collect::<Vec<_>>();
    if !missing_routes.is_empty() {
        return Err(format!(
            "天天象棋分支路线 {} 未完整解析；本盘未导入",
            missing_routes
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("/")
        ));
    }
    if !decoded.is_empty() {
        prepared.variations = merge_variations(prepared.variations, decoded);
        prepared.branch_complete = true;
    }
    Ok(prepared)
}

fn branch_route_numbers(payload: &str) -> Vec<usize> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    fn collect(value: &serde_json::Value, result: &mut Vec<usize>, depth: usize) {
        if depth > 8 || result.len() >= 64 {
            return;
        }
        match value {
            serde_json::Value::Array(values) => {
                for value in values.iter().take(64) {
                    collect(value, result, depth + 1);
                }
            }
            serde_json::Value::Object(values) => {
                if let Some(routes) = values
                    .get("routeNumbers")
                    .and_then(serde_json::Value::as_array)
                {
                    result.extend(
                        routes
                            .iter()
                            .filter_map(json_usize)
                            .filter(|route_no| (1..=16).contains(route_no)),
                    );
                }
                let numeric_keys = values
                    .keys()
                    .filter_map(|key| key.parse::<usize>().ok())
                    .filter(|route_no| (1..=16).contains(route_no))
                    .collect::<Vec<_>>();
                if numeric_keys.len() >= 2 {
                    result.extend(numeric_keys);
                }
                for value in values.values().take(64) {
                    collect(value, result, depth + 1);
                }
            }
            _ => {}
        }
    }
    let mut result = Vec::new();
    collect(&value, &mut result, 0);
    result.sort_unstable();
    result.dedup();
    result
}

fn expected_branch_routes(payload: &str) -> Vec<usize> {
    branch_route_numbers(payload)
        .into_iter()
        .filter(|route_no| *route_no >= 2)
        .collect()
}

fn decoded_branch_routes(variations: &[TtxqVariationDto]) -> HashSet<usize> {
    let mut routes = HashSet::new();
    for variation in variations {
        if let Some(route_no) = variation.route_no {
            routes.insert(route_no);
        }
        routes.extend(decoded_branch_routes(&variation.children));
    }
    routes
}

fn recursive_variation_count(variations: &[TtxqVariationDto]) -> usize {
    variations
        .iter()
        .map(|variation| 1 + recursive_variation_count(&variation.children))
        .sum()
}

fn recursive_variation_node_count(variations: &[TtxqVariationDto]) -> usize {
    variations
        .iter()
        .map(|variation| {
            variation.moves.len() + recursive_variation_node_count(&variation.children)
        })
        .sum()
}

fn variation_has_too_many_moves(variation: &TtxqVariationDto) -> bool {
    variation.moves.len() > MAX_MOVES_PER_GAME
        || variation.children.iter().any(variation_has_too_many_moves)
}

fn variation_has_invalid_iccs(variation: &TtxqVariationDto) -> bool {
    variation.moves.iter().any(|mv| !is_iccs(mv))
        || variation.children.iter().any(variation_has_invalid_iccs)
}

fn merge_variations(
    mut existing: Vec<TtxqVariationDto>,
    decoded: Vec<TtxqVariationDto>,
) -> Vec<TtxqVariationDto> {
    for variation in decoded {
        let duplicate = existing
            .iter()
            .any(|known| known.after_ply == variation.after_ply && known.moves == variation.moves);
        if !duplicate {
            existing.push(variation);
        }
    }
    existing
}

fn decode_ttxq_branch_variations(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> Result<Vec<TtxqVariationDto>, String> {
    if record.branch_data.trim().is_empty() {
        return Ok(Vec::new());
    }
    let candidates = branch_candidates_from_payload(&record.branch_data);
    let (dhtml_candidates, regular_candidates): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .partition(|candidate| dhtml_branch_key(&candidate.source_key).is_some());
    let mut variations = decode_dhtml_branch_tree(&record.moves, dhtml_candidates, starting_fen)?;
    for candidate in regular_candidates {
        let candidate_moves =
            branch_candidate_moves(&candidate.raw, starting_fen, candidate.after_ply);
        if candidate_moves.is_empty() {
            continue;
        }
        let Some((after_ply, moves)) = locate_branch_tail(
            &record.moves,
            &candidate_moves,
            candidate.after_ply,
            starting_fen,
        ) else {
            continue;
        };
        if moves.is_empty() || moves.len() > MAX_MOVES_PER_GAME {
            continue;
        }
        if variation_is_legal(starting_fen, &record.moves, after_ply, &moves) {
            variations.push(TtxqVariationDto {
                after_ply,
                moves,
                route_no: candidate.route_no,
                source_key: candidate.source_key,
                comment: candidate.comment,
                children: Vec::new(),
            });
        }
    }
    Ok(dedupe_variations(variations))
}

fn decode_dhtml_branch_tree(
    mainline: &[String],
    mut candidates: Vec<TtxqBranchCandidate>,
    starting_fen: &str,
) -> Result<Vec<TtxqVariationDto>, String> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    candidates.sort_by_key(|candidate| {
        dhtml_branch_key(&candidate.source_key)
            .map(|key| key.branch_id)
            .unwrap_or(usize::MAX)
    });
    let mut pending = candidates;
    let mut decoded = HashMap::<usize, DecodedDhtmlBranch>::new();
    while !pending.is_empty() {
        let mut next = Vec::new();
        let mut progressed = false;
        for candidate in pending {
            let Some(key) = dhtml_branch_key(&candidate.source_key) else {
                continue;
            };
            if decoded.contains_key(&key.branch_id) {
                continue;
            }
            let (parent_line, parent_prefix_len, parent_local_len) = if key.parent_branch_id == 0 {
                (mainline.to_vec(), 0, mainline.len())
            } else if let Some(parent) = decoded.get(&key.parent_branch_id) {
                let mut line = parent.prefix_before_moves.clone();
                let prefix_len = line.len();
                let local_len = parent.variation.moves.len();
                line.extend(parent.variation.moves.iter().cloned());
                (line, prefix_len, local_len)
            } else {
                next.push(candidate);
                continue;
            };
            if key.parent_ply > parent_local_len {
                return Err(format!(
                    "天天象棋分支 {} 的锚点超出父分支 {}：第 {} 半回合，父线路仅 {} 半回合；本盘未导入",
                    candidate.source_key,
                    key.parent_branch_id,
                    key.parent_ply,
                    parent_local_len
                ));
            }
            let candidate_moves = dhtml_branch_candidate_moves(&candidate.raw);
            if candidate_moves.is_empty() {
                return Err(format!(
                    "天天象棋分支 {} 的走法格式无法按原生 ICCS 坐标解析；本盘未导入",
                    candidate.source_key
                ));
            }
            let Some(absolute_after_ply) = parent_prefix_len.checked_add(key.parent_ply) else {
                return Err(format!(
                    "天天象棋分支 {} 的锚点数值溢出；本盘未导入",
                    candidate.source_key
                ));
            };
            if !branch_tail_differs(&parent_line, absolute_after_ply, &candidate_moves) {
                return Err(format!(
                    "天天象棋分支 {} 在父线路第 {} 半回合后与原路线相同；本盘未导入",
                    candidate.source_key, key.parent_ply
                ));
            }
            validate_dhtml_branch_at_exact_anchor(
                starting_fen,
                &parent_line,
                absolute_after_ply,
                &candidate_moves,
                &candidate.source_key,
                key,
            )?;
            let prefix_before_moves = parent_line[..absolute_after_ply].to_vec();
            decoded.insert(
                key.branch_id,
                DecodedDhtmlBranch {
                    key,
                    prefix_before_moves,
                    variation: TtxqVariationDto {
                        after_ply: key.parent_ply,
                        moves: candidate_moves,
                        route_no: candidate.route_no,
                        source_key: candidate.source_key,
                        comment: candidate.comment,
                        children: Vec::new(),
                    },
                },
            );
            progressed = true;
        }
        if !progressed {
            let unresolved = next
                .iter()
                .filter_map(|candidate| dhtml_branch_key(&candidate.source_key))
                .map(|key| key.branch_id.to_string())
                .collect::<Vec<_>>()
                .join("/");
            return Err(format!(
                "天天象棋分支父路线缺失或形成循环（分支 {unresolved}）；本盘未导入"
            ));
        }
        pending = next;
    }

    let mut children_by_parent = HashMap::<usize, Vec<usize>>::new();
    for branch in decoded.values() {
        children_by_parent
            .entry(branch.key.parent_branch_id)
            .or_default()
            .push(branch.key.branch_id);
    }
    for children in children_by_parent.values_mut() {
        children.sort_unstable();
    }

    fn assemble_branch(
        branch_id: usize,
        decoded: &mut HashMap<usize, DecodedDhtmlBranch>,
        children_by_parent: &HashMap<usize, Vec<usize>>,
    ) -> Option<TtxqVariationDto> {
        let mut branch = decoded.remove(&branch_id)?;
        if let Some(child_ids) = children_by_parent.get(&branch_id) {
            branch.variation.children = child_ids
                .iter()
                .filter_map(|child_id| assemble_branch(*child_id, decoded, children_by_parent))
                .collect();
        }
        Some(branch.variation)
    }

    let root_ids = children_by_parent.get(&0).cloned().unwrap_or_default();
    let mut result = Vec::with_capacity(root_ids.len());
    for branch_id in root_ids {
        if let Some(variation) = assemble_branch(branch_id, &mut decoded, &children_by_parent) {
            result.push(variation);
        }
    }
    if !decoded.is_empty() {
        return Err("天天象棋分支树存在无法连接的节点；本盘未导入".into());
    }
    Ok(result)
}

fn branch_candidates_from_payload(payload: &str) -> Vec<TtxqBranchCandidate> {
    let mut candidates = Vec::new();
    if payload.trim().is_empty() || payload.len() > 32 * 1024 {
        return candidates;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
        if let Some(items) = value
            .get("candidates")
            .and_then(serde_json::Value::as_array)
        {
            for item in items.iter().take(512) {
                let Some(map) = item.as_object() else {
                    continue;
                };
                let source_key = map
                    .get("path")
                    .and_then(json_text)
                    .unwrap_or("branchData.candidates")
                    .to_owned();
                let Some(raw) = map
                    .get("raw")
                    .and_then(|raw| branch_raw_text(raw, &source_key))
                else {
                    continue;
                };
                let after_ply = dhtml_branch_key(&source_key)
                    .map(|key| key.parent_ply)
                    .or_else(|| map.get("afterPly").and_then(json_usize));
                let route_no = map
                    .get("routeNo")
                    .and_then(json_usize)
                    .or_else(|| route_no_from_source_path(&source_key));
                let comment = map
                    .get("comment")
                    .and_then(json_text)
                    .unwrap_or_default()
                    .trim()
                    .chars()
                    .take(240)
                    .collect();
                candidates.push(TtxqBranchCandidate {
                    source_key,
                    raw,
                    after_ply,
                    route_no,
                    comment,
                });
            }
        }
        if candidates.is_empty() {
            collect_branch_candidates(&value, "$", None, None, "", 0, &mut candidates);
        }
    } else {
        candidates.push(TtxqBranchCandidate {
            source_key: "branchData".into(),
            raw: payload.to_owned(),
            after_ply: None,
            route_no: None,
            comment: String::new(),
        });
    }
    candidates
}

fn collect_branch_candidates(
    value: &serde_json::Value,
    path: &str,
    inherited_after_ply: Option<usize>,
    inherited_route_no: Option<usize>,
    inherited_comment: &str,
    depth: usize,
    candidates: &mut Vec<TtxqBranchCandidate>,
) {
    if depth > 10 || candidates.len() >= 512 {
        return;
    }
    let after_ply = inherited_after_ply.or_else(|| branch_after_ply_hint(value, path));
    let route_no = inherited_route_no.or_else(|| branch_route_no_hint(value, path));
    let comment = branch_comment_hint(value).unwrap_or_else(|| inherited_comment.to_owned());
    if let Some(raw) = branch_raw_text(value, path) {
        candidates.push(TtxqBranchCandidate {
            source_key: path.to_owned(),
            raw,
            after_ply,
            route_no,
            comment: comment.clone(),
        });
    }
    match value {
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate().take(256) {
                collect_branch_candidates(
                    item,
                    &format!("{path}[{index}]"),
                    after_ply,
                    route_no,
                    &comment,
                    depth + 1,
                    candidates,
                );
            }
        }
        serde_json::Value::Object(map) => {
            for (key, child) in map.iter().take(256) {
                collect_branch_candidates(
                    child,
                    &format!("{path}.{key}"),
                    after_ply,
                    route_no,
                    &comment,
                    depth + 1,
                    candidates,
                );
            }
        }
        _ => {}
    }
}

fn branch_route_no_hint(value: &serde_json::Value, path: &str) -> Option<usize> {
    if let serde_json::Value::Object(map) = value {
        for key in ["routeNo", "route", "branchNo", "lineNo", "variationNo"] {
            if let Some(route_no) = map.get(key).and_then(json_usize) {
                if (1..=16).contains(&route_no) {
                    return Some(route_no);
                }
            }
        }
        if let Some(source_path) = map.get("path").and_then(json_text) {
            if let Some(route_no) = route_no_from_source_path(source_path) {
                return Some(route_no);
            }
        }
    }
    route_no_from_source_path(path)
}

fn route_no_from_source_path(path: &str) -> Option<usize> {
    let marker = "route[";
    let start = path.find(marker)? + marker.len();
    let end = path[start..].find(']')? + start;
    path[start..end]
        .parse::<usize>()
        .ok()
        .filter(|route_no| (1..=16).contains(route_no))
}

fn branch_after_ply_hint(value: &serde_json::Value, path: &str) -> Option<usize> {
    if let Some(key) = dhtml_branch_key(path) {
        return Some(key.parent_ply);
    }
    if let serde_json::Value::Object(map) = value {
        for key in [
            "afterPly",
            "after_ply",
            "ply",
            "parentPly",
            "moveIndex",
            "stepIndex",
            "startPly",
            "branchPly",
        ] {
            if let Some(number) = map.get(key).and_then(json_usize) {
                return Some(number);
            }
        }
    }
    path.split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<usize>().ok())
        .next_back()
}

fn dhtml_branch_key(path: &str) -> Option<DhtmlBranchKey> {
    let (_, key) = path.rsplit_once("getMoveBranchKey.")?;
    let key = key.trim();
    if key.contains('.') {
        return None;
    }
    let mut parts = key.split('-');
    let parent_branch_id = parts.next()?.parse().ok()?;
    let parent_ply = parts.next()?.parse().ok()?;
    let branch_id = parts.next()?.parse().ok()?;
    if parts.next().is_some() || branch_id == 0 {
        return None;
    }
    Some(DhtmlBranchKey {
        parent_branch_id,
        parent_ply,
        branch_id,
    })
}

fn branch_comment_hint(value: &serde_json::Value) -> Option<String> {
    let serde_json::Value::Object(map) = value else {
        return None;
    };
    for key in ["comment", "remark", "memo", "name", "title", "label"] {
        if let Some(text) = map.get(key).and_then(json_text) {
            let text = text.trim();
            if !text.is_empty() && text.len() <= 240 {
                return Some(text.to_owned());
            }
        }
    }
    None
}

fn json_usize(value: &serde_json::Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|number| usize::try_from(number).ok())
        .or_else(|| value.as_str()?.trim().parse::<usize>().ok())
}

fn json_text(value: &serde_json::Value) -> Option<&str> {
    match value {
        serde_json::Value::String(text) => Some(text),
        _ => None,
    }
}

fn branch_raw_text(value: &serde_json::Value, path: &str) -> Option<String> {
    let move_like_path = path
        .rsplit_once('.')
        .map(|(_, key)| key)
        .unwrap_or(path)
        .chars()
        .any(|ch| ch.is_ascii_digit())
        || [
            "move", "moves", "step", "steps", "msg", "raw", "text", "value", "line", "branch",
            "DhtmlXQ", "movelist", "MOVE_STR",
        ]
        .iter()
        .any(|marker| {
            path.to_ascii_lowercase()
                .contains(&marker.to_ascii_lowercase())
        });
    if !move_like_path {
        return None;
    }
    match value {
        serde_json::Value::String(text) => {
            let text = text.trim();
            (text.len() <= 32 * 1024
                && (looks_like_move_payload(text) || contains_dhtml_move_tag(text)))
            .then(|| text.to_owned())
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Array(items) => {
            let numeric = items
                .iter()
                .map(|item| match item {
                    serde_json::Value::Number(number) => {
                        number.as_u64().map(|value| value.to_string())
                    }
                    serde_json::Value::String(text)
                        if text.chars().all(|ch| ch.is_ascii_digit()) =>
                    {
                        Some(text.clone())
                    }
                    _ => None,
                })
                .collect::<Option<Vec<_>>>();
            numeric.map(|items| items.join("")).filter(|text| {
                !text.is_empty() && text.len() <= 32 * 1024 && looks_like_move_payload(text)
            })
        }
        serde_json::Value::Object(map) => {
            for key in [
                "raw", "text", "value", "data", "move", "moves", "step", "steps", "msg", "movelist",
            ] {
                if let Some(raw) = map.get(key).and_then(|child| branch_raw_text(child, key)) {
                    return Some(raw);
                }
            }
            None
        }
        _ => None,
    }
}

fn looks_like_move_payload(text: &str) -> bool {
    if text.is_empty() || text.len() > 32 * 1024 {
        return false;
    }
    text.chars().all(|character| {
        character.is_ascii_digit()
            || character.is_ascii_whitespace()
            || matches!(character, '[' | ']' | ',')
    }) || !extract_iccs_moves(text).is_empty()
        || !crate::training_service::chinese_move_tokens(text).is_empty()
}

fn contains_dhtml_move_tag(text: &str) -> bool {
    text.contains("[DhtmlXQ_move_") || text.contains("[DhtmlXQ_movelist]")
}

fn branch_candidate_moves(raw: &str, starting_fen: &str, after_ply: Option<usize>) -> Vec<String> {
    if raw.len() > 32 * 1024 {
        return Vec::new();
    }
    if contains_dhtml_move_tag(raw) {
        let mut moves = Vec::new();
        for (_, segment) in dhtml_tagged_move_segments(raw) {
            let decoded = crate::ttxq_decoder::dhtml_move_list_to_iccs(&segment);
            if !decoded.is_empty() {
                moves.extend(decoded);
            }
        }
        if !moves.is_empty() {
            return moves;
        }
    }
    let dhtml = crate::ttxq_decoder::dhtml_move_list_to_iccs(raw);
    if !dhtml.is_empty() {
        return dhtml;
    }
    let iccs = extract_iccs_moves(raw);
    if !iccs.is_empty() {
        return iccs;
    }
    let notation = crate::training_service::chinese_move_tokens(raw);
    if notation.is_empty() {
        return Vec::new();
    }
    let fen = after_ply
        .and_then(|_| Some(starting_fen.to_owned()))
        .unwrap_or_else(|| starting_fen.to_owned());
    crate::manual_service::parse_chinese_line(fen, notation)
        .map(|parsed| parsed.moves)
        .unwrap_or_default()
}

fn dhtml_branch_candidate_moves(raw: &str) -> Vec<String> {
    if raw.len() > 32 * 1024 {
        return Vec::new();
    }
    if contains_dhtml_move_tag(raw) {
        let mut moves = Vec::new();
        for (_, segment) in dhtml_tagged_move_segments(raw) {
            let decoded = crate::ttxq_decoder::dhtml_branch_move_list_to_iccs(&segment);
            if !decoded.is_empty() {
                moves.extend(decoded);
            }
        }
        if !moves.is_empty() {
            return moves;
        }
    }
    let dhtml = crate::ttxq_decoder::dhtml_branch_move_list_to_iccs(raw);
    if !dhtml.is_empty() {
        return dhtml;
    }
    let iccs = extract_iccs_moves(raw);
    if !iccs.is_empty() {
        return iccs;
    }
    Vec::new()
}

fn validate_dhtml_branch_at_exact_anchor(
    starting_fen: &str,
    parent_line: &[String],
    after_ply: usize,
    tail: &[String],
    source_key: &str,
    key: DhtmlBranchKey,
) -> Result<(), String> {
    let mut board = Board::from_fen(starting_fen).map_err(|_| {
        format!("天天象棋分支 {source_key} 缺少可用的起始 FEN，无法校验原生 ICCS 坐标；本盘未导入")
    })?;
    for raw_move in parent_line.iter().take(after_ply) {
        let mv = Move::from_iccs(raw_move).map_err(|_| {
            format!("天天象棋分支 {source_key} 的父线路包含无效走法 {raw_move}；本盘未导入")
        })?;
        board = board.apply_move(mv).map_err(|_| {
            format!("天天象棋分支 {source_key} 的父线路走法 {raw_move} 非法；本盘未导入")
        })?;
    }
    let anchor_side = if board.side_to_move() == Color::Red {
        "红方"
    } else {
        "黑方"
    };
    for (index, raw_move) in tail.iter().enumerate() {
        let mv = Move::from_iccs(raw_move).map_err(|_| {
            format!(
                "天天象棋分支 {source_key}（原生 ICCS 坐标，父分支 {}）在第 {} 半回合后第 {} 着 {raw_move} 格式无效（锚点由{anchor_side}行棋）；本盘未导入",
                key.parent_branch_id,
                key.parent_ply,
                index + 1
            )
        })?;
        board = board.apply_move(mv).map_err(|_| {
            let move_label = if index == 0 {
                format!("首着 {raw_move}")
            } else {
                format!("第 {} 着 {raw_move}", index + 1)
            };
            format!(
                "天天象棋分支 {source_key}（原生 ICCS 坐标，父分支 {}）在第 {} 半回合后{move_label} 非法（锚点由{anchor_side}行棋）；本盘未导入",
                key.parent_branch_id, key.parent_ply
            )
        })?;
    }
    Ok(())
}

fn dhtml_tagged_move_segments(raw: &str) -> Vec<(Option<usize>, String)> {
    let mut result = Vec::new();
    let mut offset = 0;
    while let Some(start) = raw[offset..].find("[DhtmlXQ_move_") {
        let tag_start = offset + start;
        let number_start = tag_start + "[DhtmlXQ_move_".len();
        let Some(number_end_relative) = raw[number_start..].find(']') else {
            break;
        };
        let number_end = number_start + number_end_relative;
        let tag_number = raw[number_start..number_end].parse::<usize>().ok();
        let content_start = number_end + 1;
        let Some(content_end_relative) = raw[content_start..].find("[/DhtmlXQ_move_") else {
            break;
        };
        let content_end = content_start + content_end_relative;
        result.push((tag_number, raw[content_start..content_end].to_owned()));
        offset = content_end + "[/DhtmlXQ_move_".len();
    }
    if let Some(start) = raw.find("[DhtmlXQ_movelist]") {
        let content_start = start + "[DhtmlXQ_movelist]".len();
        if let Some(end_relative) = raw[content_start..].find("[/DhtmlXQ_movelist]") {
            result.push((
                None,
                raw[content_start..content_start + end_relative].to_owned(),
            ));
        }
    }
    result
}

fn locate_branch_tail(
    mainline: &[String],
    candidate_moves: &[String],
    hinted_after_ply: Option<usize>,
    starting_fen: &str,
) -> Option<(usize, Vec<String>)> {
    if let Some(after_ply) = hinted_after_ply.filter(|value| *value <= mainline.len()) {
        let tail = candidate_moves.to_vec();
        if branch_tail_differs(mainline, after_ply, &tail)
            && variation_is_legal(starting_fen, mainline, after_ply, &tail)
        {
            return Some((after_ply, tail));
        }
    }
    let common = mainline
        .iter()
        .zip(candidate_moves.iter())
        .take_while(|(left, right)| left == right)
        .count();
    if common < candidate_moves.len() {
        let tail = candidate_moves[common..].to_vec();
        if branch_tail_differs(mainline, common, &tail)
            && variation_is_legal(starting_fen, mainline, common, &tail)
        {
            return Some((common, tail));
        }
    }
    // Some QQ branch snippets only contain the variation tail and encode their
    // owner ply in an unstable key. If no reliable hint exists, find the unique
    // legal attachment point whose first move is not already the mainline child.
    let mut legal = Vec::new();
    for after_ply in 0..=mainline.len() {
        if branch_tail_differs(mainline, after_ply, candidate_moves)
            && variation_is_legal(starting_fen, mainline, after_ply, candidate_moves)
        {
            legal.push((after_ply, candidate_moves.to_vec()));
        }
        if legal.len() > 1 {
            return None;
        }
    }
    legal.pop()
}

fn branch_tail_differs(mainline: &[String], after_ply: usize, tail: &[String]) -> bool {
    !tail.is_empty()
        && match mainline.get(after_ply) {
            Some(mainline_move) => mainline_move != &tail[0],
            None => true,
        }
}

fn variation_is_legal(
    starting_fen: &str,
    mainline: &[String],
    after_ply: usize,
    tail: &[String],
) -> bool {
    if after_ply > mainline.len() || tail.is_empty() {
        return false;
    }
    let mut board = match Board::from_fen(starting_fen) {
        Ok(board) => board,
        Err(_) => return false,
    };
    for raw_move in mainline.iter().take(after_ply) {
        let Ok(mv) = Move::from_iccs(raw_move) else {
            return false;
        };
        let Ok(next_board) = board.apply_move(mv) else {
            return false;
        };
        board = next_board;
    }
    for raw_move in tail {
        let Ok(mv) = Move::from_iccs(raw_move) else {
            return false;
        };
        let Ok(next_board) = board.apply_move(mv) else {
            return false;
        };
        board = next_board;
    }
    true
}

fn dedupe_variations(mut variations: Vec<TtxqVariationDto>) -> Vec<TtxqVariationDto> {
    let mut seen = HashSet::new();
    variations.retain(|variation| {
        seen.insert(format!(
            "{}:{}:{}",
            variation.after_ply,
            variation.route_no.unwrap_or_default(),
            variation.moves.join(" ")
        ))
    });
    variations.sort_by(|left, right| {
        left.after_ply
            .cmp(&right.after_ply)
            .then_with(|| left.moves.len().cmp(&right.moves.len()))
            .then_with(|| left.moves.cmp(&right.moves))
    });
    variations
}

fn extract_dhtml_moves(record: &TtxqGameRecordDto) -> Vec<String> {
    let known_dhtml_field = [
        "getQipuMoveStep",
        "getMainMoveList",
        "getLessonNextMoveStep",
        "qipuMoveStep",
        "_qipuMoveStep",
        "moveStep",
        "_moveStep",
        "moveList",
        "_moveList",
        "MOVE_STR",
        "moveData",
    ]
    .iter()
    .any(|field| record.raw_move_path.ends_with(field));
    if !known_dhtml_field {
        return Vec::new();
    }
    if !record.raw_moves.chars().all(|character| {
        character.is_ascii_digit()
            || matches!(character, '[' | ']' | ',' | ' ' | '\t' | '\r' | '\n')
    }) {
        return Vec::new();
    }
    crate::ttxq_decoder::dhtml_move_list_to_iccs(&record.raw_moves)
}

fn bridge_snapshot_mentions_move_field(record: &TtxqGameRecordDto) -> bool {
    record.raw_move_path == "bridge-snapshot"
        && [
            "getQipuMoveStep",
            "getMainMoveList",
            "getLessonNextMoveStep",
            "qipuMoveStep",
            "moveStep",
            "moveList",
            "MOVE_STR",
            "moveData",
        ]
        .iter()
        .any(|field| record.raw_moves.contains(field))
}

fn extract_iccs_moves(text: &str) -> Vec<String> {
    text.char_indices()
        .filter_map(|(index, _)| text.get(index..).and_then(|remaining| remaining.get(..4)))
        .filter(|value| is_iccs(value))
        .map(str::to_ascii_lowercase)
        .collect()
}

fn ttxq_branch_route_summary(record: &TtxqGameRecordDto) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(&record.branch_data).ok()?;
    let route_numbers = expected_branch_routes(&record.branch_data);
    let routes_attempted = value
        .get("routesAttempted")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(json_usize)
                .filter(|route| *route >= 2)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let route_count = route_numbers.len().max(routes_attempted.len());
    if route_count == 0 {
        return None;
    }
    let failures = value
        .get("routeFailures")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .take(3)
                .filter_map(|item| {
                    let route_no = item.get("routeNo").and_then(json_usize)?;
                    let reason = item
                        .get("reason")
                        .and_then(json_text)
                        .unwrap_or("未取得分支走法");
                    Some(format!("{route_no}路：{reason}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut message = format!("发现 {route_count} 个分支导航，但未取得可校验的分支走法");
    if !routes_attempted.is_empty() {
        message.push_str(&format!(
            "；已尝试路线 {}",
            routes_attempted
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("/")
        ));
    }
    if !failures.is_empty() {
        message.push_str(&format!("；{}", failures.join("；")));
    }
    Some(message)
}

fn ttxq_branch_failure_message(record: &TtxqGameRecordDto) -> String {
    ttxq_branch_route_summary(record).unwrap_or_else(|| {
        "已发现天天象棋分支字段，但未识别到可校验的分支走法；为避免丢失变招，本盘暂不导入".into()
    })
}

fn ttxq_branch_decode_failure(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
    resolved_mainline: Option<&[String]>,
) -> Option<String> {
    if record.branch_data.trim().is_empty() || record.branch_complete {
        return None;
    }
    let mut diagnostic_record = record.clone();
    if let Some(moves) = resolved_mainline {
        diagnostic_record.moves = moves.to_vec();
    }
    match decode_ttxq_branch_variations(&diagnostic_record, starting_fen) {
        Ok(variations) if variations.is_empty() => Some(ttxq_branch_failure_message(record)),
        Err(error) => Some(error),
        _ => None,
    }
}

fn dhtml_branch_absolute_anchor(
    key: DhtmlBranchKey,
    keys_by_id: &HashMap<usize, DhtmlBranchKey>,
    visiting: &mut HashSet<usize>,
) -> Option<usize> {
    if key.parent_branch_id == 0 {
        return Some(key.parent_ply);
    }
    if !visiting.insert(key.branch_id) {
        return None;
    }
    let parent = *keys_by_id.get(&key.parent_branch_id)?;
    let absolute =
        dhtml_branch_absolute_anchor(parent, keys_by_id, visiting)?.checked_add(key.parent_ply);
    visiting.remove(&key.branch_id);
    absolute
}

fn ttxq_branch_diagnostic_sample(record: &TtxqGameRecordDto, starting_fen: &str) -> String {
    let candidates = branch_candidates_from_payload(&record.branch_data);
    let keys_by_id = candidates
        .iter()
        .filter_map(|candidate| dhtml_branch_key(&candidate.source_key))
        .map(|key| (key.branch_id, key))
        .collect::<HashMap<_, _>>();
    let starting_side = Board::from_fen(starting_fen)
        .ok()
        .map(|board| board.side_to_move());
    let branches = candidates
        .iter()
        .take(32)
        .map(|candidate| {
            if let Some(key) = dhtml_branch_key(&candidate.source_key) {
                let absolute_anchor =
                    dhtml_branch_absolute_anchor(key, &keys_by_id, &mut HashSet::new());
                let anchor_side = absolute_anchor.and_then(|ply| {
                    starting_side.map(|side| {
                        let side = if ply % 2 == 0 { side } else { side.opposite() };
                        if side == Color::Red {
                            "red"
                        } else {
                            "black"
                        }
                    })
                });
                let decoded = dhtml_branch_candidate_moves(&candidate.raw);
                serde_json::json!({
                    "sourcePath": candidate.source_key,
                    "coordinateMode": "branch-native-iccs",
                    "parentBranchId": key.parent_branch_id,
                    "anchorPly": key.parent_ply,
                    "absoluteAnchorPly": absolute_anchor,
                    "branchId": key.branch_id,
                    "decodedFirstMove": decoded.first(),
                    "anchorSide": anchor_side,
                    "rawLength": candidate.raw.len(),
                    "rawSample": candidate.raw.chars().take(64).collect::<String>(),
                })
            } else {
                serde_json::json!({
                    "sourcePath": candidate.source_key,
                    "coordinateMode": "existing-candidate-parser",
                    "anchorPly": candidate.after_ply,
                    "rawLength": candidate.raw.len(),
                    "rawSample": candidate.raw.chars().take(64).collect::<String>(),
                })
            }
        })
        .collect::<Vec<_>>();
    let sample = serde_json::json!({
        "startingFenPresent": !record.starting_fen.trim().is_empty(),
        "mainlineCoordinateSample": record.raw_moves.chars().take(256).collect::<String>(),
        "branches": branches,
    })
    .to_string();
    sample.chars().take(32 * 1024).collect()
}

fn diagnostic_summary(record: &TtxqGameRecordDto) -> Option<String> {
    if !record.branch_data.trim().is_empty() && !record.branch_complete {
        if let Some(summary) = ttxq_branch_route_summary(record) {
            return Some(summary);
        }
    }
    (!record.raw_move_path.is_empty() || !record.raw_move_type.is_empty()).then(|| {
        format!(
            "字段：{} · 类型：{} · 长度：{}",
            if record.raw_move_path.is_empty() {
                "未知"
            } else {
                &record.raw_move_path
            },
            if record.raw_move_type.is_empty() {
                "未知"
            } else {
                &record.raw_move_type
            },
            record.raw_move_length.max(record.raw_moves.len()),
        )
    })
}

fn ttxq_game_preview(game: &TtxqGameRecordDto) -> TtxqGamePreviewDto {
    let starting_fen = if game.starting_fen.trim().is_empty() {
        STARTING_FEN
    } else {
        game.starting_fen.as_str()
    };
    let parsed_mainline = resolved_moves(game, starting_fen).unwrap_or_default();
    let parsed_mainline_count = parsed_mainline.len();
    match prepare_import_record(game, starting_fen) {
        Ok(prepared) => {
            let route_numbers = branch_route_numbers(&prepared.branch_data);
            let decoded_routes = decoded_branch_routes(&prepared.variations);
            TtxqGamePreviewDto {
                qipu_id: game.qipu_id.clone(),
                title: ttxq_title(&prepared),
                red: game.red.clone(),
                black: game.black.clone(),
                event: game.event.clone(),
                date: game.date.clone(),
                result: game.result.clone(),
                round: game.round.clone(),
                played_at: game.played_at.clone(),
                duration: game.duration.clone(),
                move_count: prepared.moves.len(),
                variation_count: recursive_variation_count(&prepared.variations),
                route_count: route_numbers.len().max(1),
                decoded_route_count: if route_numbers.is_empty() {
                    1
                } else {
                    1 + decoded_routes
                        .iter()
                        .filter(|route_no| **route_no >= 2)
                        .count()
                },
                variation_node_count: recursive_variation_node_count(&prepared.variations),
                branch_complete: prepared.branch_complete,
                valid: true,
                error: None,
                diagnostic: None,
            }
        }
        Err(error) => {
            let route_numbers = branch_route_numbers(&game.branch_data);
            let mut diagnostic_record = game.clone();
            diagnostic_record.moves = parsed_mainline;
            let decoded_variations =
                decode_ttxq_branch_variations(&diagnostic_record, starting_fen).unwrap_or_default();
            let decoded_routes = decoded_branch_routes(&decoded_variations);
            TtxqGamePreviewDto {
                qipu_id: game.qipu_id.clone(),
                title: ttxq_title(game),
                red: game.red.clone(),
                black: game.black.clone(),
                event: game.event.clone(),
                date: game.date.clone(),
                result: game.result.clone(),
                round: game.round.clone(),
                played_at: game.played_at.clone(),
                duration: game.duration.clone(),
                move_count: parsed_mainline_count,
                variation_count: recursive_variation_count(&decoded_variations),
                route_count: route_numbers.len().max(1),
                decoded_route_count: if route_numbers.is_empty() {
                    usize::from(parsed_mainline_count > 0)
                } else {
                    usize::from(parsed_mainline_count > 0)
                        + decoded_routes
                            .iter()
                            .filter(|route_no| **route_no >= 2)
                            .count()
                },
                variation_node_count: recursive_variation_node_count(&decoded_variations),
                branch_complete: false,
                valid: false,
                error: Some(error),
                diagnostic: diagnostic_summary(game),
            }
        }
    }
}

fn validate_payload(payload: &TtxqBridgePayloadDto) -> Result<(), String> {
    let encoded = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let metadata_probe_bytes = payload
        .games
        .iter()
        .map(|game| game.metadata_probe.len())
        .sum::<usize>();
    if encoded.len() > MAX_PAYLOAD_BYTES || metadata_probe_bytes > MAX_PAYLOAD_BYTES {
        return Err("天天象棋同步数据过大，已拒绝导入".into());
    }
    if payload.version != BRIDGE_VERSION {
        return Err("天天象棋页面已更新，当前桥接版本不兼容".into());
    }
    if payload.games.is_empty() {
        return Err("未读取到已加载的棋谱；请在天天象棋窗口滚动历史列表后重试".into());
    }
    if payload.games.len() > MAX_GAMES {
        return Err("棋谱数量超过本次同步上限".into());
    }
    for game in &payload.games {
        if game.qipu_id.trim().is_empty() || game.qipu_id.len() > 160 {
            return Err("天天象棋返回了无效棋谱标识".into());
        }
        if game.metadata_probe.len() > 8 * 1024 {
            return Err(format!("棋谱 {} 的元数据诊断样本过大", game.qipu_id));
        }
        if (game.moves.is_empty() && game.raw_moves.trim().is_empty())
            || game.raw_moves.len() > 32 * 1024
            || game.moves.len() > MAX_MOVES_PER_GAME
            || game.variations.iter().any(variation_has_too_many_moves)
        {
            return Err(format!("棋谱 {} 的着法数量异常", game.qipu_id));
        }
        if game
            .moves
            .iter()
            .chain(
                game.variations
                    .iter()
                    .flat_map(|branch| branch.moves.iter()),
            )
            .any(|mv| !is_iccs(mv))
            || game.variations.iter().any(variation_has_invalid_iccs)
        {
            return Err(format!(
                "棋谱 {} 的走法格式不兼容，请更新同步适配器",
                game.qipu_id
            ));
        }
    }
    Ok(())
}

fn is_iccs(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 4
        && (b'a'..=b'i').contains(&bytes[0])
        && bytes[1].is_ascii_digit()
        && (b'a'..=b'i').contains(&bytes[2])
        && bytes[3].is_ascii_digit()
}

#[tauri::command]
pub(crate) fn get_ttxq_sync_progress(
    state: State<'_, DesktopState>,
) -> Result<TtxqSyncProgressDto, String> {
    Ok(state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?
        .progress
        .clone())
}

#[tauri::command]
pub(crate) fn preview_ttxq_history(
    state: State<'_, DesktopState>,
) -> Result<Vec<TtxqGamePreviewDto>, String> {
    let payload = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?
        .payload
        .clone()
        .ok_or("尚未读取天天象棋历史棋谱")?;
    Ok(payload.games.iter().map(ttxq_game_preview).collect())
}

#[tauri::command]
pub(crate) fn start_ttxq_authorization(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TTXQ_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            TTXQ_WINDOW_LABEL,
            tauri::WebviewUrl::External(
                "https://h5login.qqchess.qq.com/"
                    .parse()
                    .map_err(|error: url::ParseError| error.to_string())?,
            ),
        )
        .title("Xiangqi Studio · 天天象棋授权")
        .inner_size(980.0, 760.0)
        .min_inner_size(720.0, 560.0)
        .on_navigation(|url| {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| {
                    host == "qq.com"
                        || host.ends_with(".qq.com")
                        || host == "qqchess.qq.com"
                        || host.ends_with(".qqchess.qq.com")
                })
        })
        .build()
        .map_err(|error| error.to_string())?;
    }
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    sync.progress = TtxqSyncProgressDto {
        state: "authorizing".into(),
        message: "请在独立窗口内自行登录，并进入最近对局后滚动加载历史棋谱".into(),
        ..TtxqSyncProgressDto::default()
    };
    Ok(())
}

#[tauri::command]
pub(crate) fn submit_ttxq_bridge_payload(
    mut payload: TtxqBridgePayloadDto,
    attempt_id: u64,
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<TtxqSyncProgressDto, String> {
    if window.label() != TTXQ_WINDOW_LABEL {
        return Err("天天象棋桥接只能由授权窗口调用".into());
    }
    {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        acknowledge_bridge(&mut sync, attempt_id)?;
    }
    for game in &mut payload.games {
        enrich_title_metadata(game);
    }
    validate_payload(&payload)?;
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "本地棋谱库不可用".to_owned())?;
        let mut recorded_diagnostics = HashSet::new();
        for game in &payload.games {
            let starting_fen = if game.starting_fen.trim().is_empty() {
                STARTING_FEN
            } else {
                &game.starting_fen
            };
            let resolved_mainline = resolved_moves(game, starting_fen);
            if let Err(error) = &resolved_mainline {
                // All rows share one detail board while Tencent's page is
                // loading. Keep a representative local sample for a shared
                // structural failure instead of filling all ten slots with it.
                let signature = format!(
                    "{}\u{1f}{}\u{1f}{error}",
                    game.raw_move_path, game.raw_move_type
                );
                if !recorded_diagnostics.insert(signature) {
                    continue;
                }
                model
                    .store
                    .record_ttxq_diagnostic_sample(
                        &game.qipu_id,
                        &game.raw_move_path,
                        &game.raw_move_type,
                        game.raw_move_length.max(game.raw_moves.len()),
                        &game.raw_moves.chars().take(32 * 1024).collect::<String>(),
                        error,
                        &chrono::Utc::now().to_rfc3339(),
                    )
                    .map_err(|error| error.to_string())?;
            }
            let branch_failure =
                ttxq_branch_decode_failure(game, starting_fen, resolved_mainline.as_deref().ok());
            if let Some(branch_failure) = branch_failure {
                let diagnostic_sample = ttxq_branch_diagnostic_sample(game, starting_fen);
                let signature = format!("branch\u{1f}{}\u{1f}{}", game.branch_path, branch_failure);
                if recorded_diagnostics.insert(signature) {
                    model
                        .store
                        .record_ttxq_diagnostic_sample(
                            &game.qipu_id,
                            if game.branch_path.trim().is_empty() {
                                "branch-data"
                            } else {
                                &game.branch_path
                            },
                            "branch-data",
                            game.branch_data.len(),
                            &diagnostic_sample,
                            &branch_failure,
                            &chrono::Utc::now().to_rfc3339(),
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            if is_placeholder_title(&game.title) && !game.metadata_probe.trim().is_empty() {
                let signature = "metadata-snapshot".to_owned();
                if recorded_diagnostics.insert(signature) {
                    model
                        .store
                        .record_ttxq_diagnostic_sample(
                            &game.qipu_id,
                            "metadata-snapshot",
                            "metadata-scalars",
                            game.metadata_probe.len(),
                            &game
                                .metadata_probe
                                .chars()
                                .take(8 * 1024)
                                .collect::<String>(),
                            "未解析天天象棋标题或棋手字段",
                            &chrono::Utc::now().to_rfc3339(),
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    let read_total = sync.progress.read_total.max(payload.games.len());
    let read_completed = sync.progress.read_completed.max(read_total);
    let read_failed = sync.progress.read_failed;
    sync.progress = TtxqSyncProgressDto {
        state: "ready".into(),
        read_total,
        read_completed,
        read_failed,
        loaded: payload.games.len(),
        message: if read_failed == 0 {
            "已读取已加载的历史棋谱，可开始导入".into()
        } else {
            format!(
                "已读取 {} 盘，{} 盘读取失败，可导入 {} 盘",
                read_total,
                read_failed,
                payload.games.len()
            )
        },
        ..TtxqSyncProgressDto::default()
    };
    sync.payload = Some(payload);
    Ok(sync.progress.clone())
}

#[tauri::command]
pub(crate) fn list_ttxq_diagnostic_samples(
    state: State<'_, DesktopState>,
) -> Result<Vec<local_store::TtxqDiagnosticSample>, String> {
    state
        .model
        .lock()
        .map_err(|_| "本地棋谱库不可用".to_owned())?
        .store
        .ttxq_diagnostic_samples()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn clear_ttxq_diagnostic_samples(state: State<'_, DesktopState>) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "本地棋谱库不可用".to_owned())?
        .store
        .clear_ttxq_diagnostic_samples()
        .map_err(|error| error.to_string())
}

fn validate_read_progress(
    total: usize,
    completed: usize,
    failed: usize,
    scanned: usize,
    current: usize,
) -> Result<(), String> {
    if total > MAX_GAMES {
        return Err("棋谱数量超过本次同步上限".into());
    }
    if completed > total || failed > completed {
        return Err("天天象棋读取进度无效".into());
    }
    if scanned > MAX_SCAN_NODES || current > total {
        return Err("天天象棋读取进度超出上限".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn report_ttxq_read_progress(
    total: usize,
    completed: usize,
    failed: usize,
    attempt_id: u64,
    phase: Option<String>,
    scanned: Option<usize>,
    current: Option<usize>,
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if window.label() != TTXQ_WINDOW_LABEL {
        return Err("天天象棋桥接只能由授权窗口调用".into());
    }
    let scanned = scanned.unwrap_or(0);
    let current = current.unwrap_or(completed);
    validate_read_progress(total, completed, failed, scanned, current)?;
    let read_phase = phase.unwrap_or_else(|| "reading".into());
    if read_phase != "discovering"
        && read_phase != "loading"
        && read_phase != "metadata"
        && read_phase != "branches"
        && read_phase != "reading"
    {
        return Err("天天象棋读取阶段无效".into());
    }
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    acknowledge_bridge(&mut sync, attempt_id)?;
    sync.progress = TtxqSyncProgressDto {
        state: "reading".into(),
        read_phase: read_phase.clone(),
        read_scanned: scanned,
        read_current: current,
        read_total: total,
        read_completed: completed,
        read_failed: failed,
        message: if read_phase == "discovering" {
            format!("正在扫描天天象棋网页，已发现 {total} 盘")
        } else if read_phase == "loading" {
            format!("正在加载第 {current}/{total} 盘棋谱")
        } else if read_phase == "metadata" {
            format!("正在解析第 {current}/{total} 盘棋谱信息")
        } else if read_phase == "branches" {
            format!("正在读取第 {current}/{total} 盘分支变化")
        } else if total == 0 {
            "未发现已加载的历史棋谱；请在天天象棋窗口滚动历史列表后重试".into()
        } else {
            format!("正在读取已加载的历史棋谱（{completed}/{total}）")
        },
        ..TtxqSyncProgressDto::default()
    };
    advance_progress_revision(&mut sync);
    Ok(())
}

#[tauri::command]
pub(crate) fn report_ttxq_bridge_error(
    message: String,
    attempt_id: u64,
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if window.label() != TTXQ_WINDOW_LABEL {
        return Err("天天象棋桥接只能由授权窗口调用".into());
    }
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    acknowledge_bridge(&mut sync, attempt_id)?;
    set_read_error(&mut sync, attempt_id, &message);
    Ok(())
}

#[tauri::command]
pub(crate) fn collect_ttxq_h5_history(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(TTXQ_WINDOW_LABEL)
        .ok_or("请先打开天天象棋授权窗口")?;
    let current_host = window
        .url()
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "未知页面".into());
    state
        .model
        .lock()
        .map_err(|_| "本地棋谱库不可用".to_owned())?
        .store
        .clear_ttxq_diagnostic_samples()
        .map_err(|error| error.to_string())?;
    let attempt_id = {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        begin_read_attempt(&mut sync)
    };

    // A tiny preflight is injected separately so expensive page traversal can
    // never hide a missing or unusable remote IPC bridge.
    let preflight_script = format!(
        r#"(async () => {{
          const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
          if (typeof invoke !== 'function') return;
          await invoke('report_ttxq_read_progress', {{ attemptId: {attempt_id}, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' }});
        }})().catch(() => undefined)"#
    );
    if let Err(error) = window.eval(&preflight_script) {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        fail_unacknowledged_bridge(&mut sync, attempt_id, &current_host);
        return Err(format!("无法注入天天象棋桥接：{error}"));
    }
    // The remote page never receives filesystem or generic application APIs. This
    // bridge only serializes a narrow, validated DTO back to the dedicated command.
    let collector_script = r#"(async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (!invoke) throw new Error('天天象棋授权窗口未获得导入权限；请关闭窗口后重新打开');
      await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' });
      const bridgeError = async (error) => {
        await invoke('report_ttxq_bridge_error', { attemptId: __TTXQ_ATTEMPT_ID__, message: String(error && error.message || error) });
      };
      // Matches the proven desktop exporter traversal limit. Tencent's `fdk`
      // graph commonly exceeds 20,000 objects before the notification owner.
      const findObjectWithOwnProperty = (root, property, limit = 100_000) => {
        if (!root || typeof root !== 'object') return null;
        const stack = [root];
        const seen = new WeakSet();
        let visited = 0;
        while (stack.length && visited < limit) {
          const value = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value)) continue;
          seen.add(value);
          visited += 1;
          try {
            if (Object.prototype.hasOwnProperty.call(value, property)) return value;
            const children = Array.isArray(value) ? value : Object.values(value);
            for (const child of children) if (child && typeof child === 'object' && !seen.has(child)) stack.push(child);
          } catch (_) { /* Ignore protected display objects and transient getters. */ }
        }
        return null;
      };
      let model = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try { model = window.fdk && window.fdk.getModel && window.fdk.getModel('QipuModel'); } catch (_) { model = null; }
        const hasAnyQipuListRoot = () => {
          if (!model) return false;
          if (model._qipuRecentView || model._qipuWallDataList || model._qipuWallPreViewData || model._qipuDataList || model._qipuCollectDataList || model._qipuCreateDataList) return true;
          try {
            return Object.keys(model).some(key => /(?:qipu|recent|wall|collect|favor|create|record|manual|list|data)/i.test(key) && model[key] && typeof model[key] === 'object');
          } catch (_) {
            return false;
          }
        };
        if (model && hasAnyQipuListRoot() && model.jumpQipuGame) break;
        if (attempt % 8 === 0) await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' });
        await delay(250);
      }
      if (!model || !model.jumpQipuGame) throw new Error('未检测到天天象棋棋谱数据，请在授权窗口进入“最近对局 / 我的收藏 / 我创建的 / 记谱”列表后重试');
      // Tencent's H5 list is virtualized. Trigger bounded scrolls before scanning
      // so the page has a chance to append older items without an unbounded loop.
      const scrollPageAndLists = () => {
        const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        window.scrollTo(0, height);
        for (const element of Array.from(document.querySelectorAll('*')).slice(0, 800)) {
          try {
            if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight;
          } catch (_) { /* Ignore detached nodes. */ }
        }
        return height;
      };
      let stableScrolls = 0;
      let previousHeight = 0;
      for (let pass = 0; pass < 24 && stableScrolls < 3; pass += 1) {
        const height = scrollPageAndLists();
        await delay(500);
        const nextHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        stableScrolls = nextHeight > previousHeight ? 0 : stableScrolls + 1;
        previousHeight = Math.max(previousHeight, nextHeight);
      }
      const qipuListRoots = () => {
        const roots = [];
        const add = (value) => { if (value && typeof value === 'object' && !roots.includes(value)) roots.push(value); };
        for (const key of ['_qipuRecentView', '_qipuWallDataList', '_qipuWallPreViewData', '_qipuDataList', '_qipuCollectDataList', '_qipuCreateDataList', '_qipuListData', '_qipuFavoriteDataList']) {
          try { add(model[key]); } catch (_) { /* Ignore transient getters. */ }
        }
        try {
          for (const key of Object.keys(model).slice(0, 240)) {
            if (/(?:daily|live|friend|report|statistics|result|rsp|response)/i.test(key)) continue;
            if (!/(?:qipu|recent|wall|collect|favor|create|created|record|manual|list|data|folder)/i.test(key)) continue;
            try { add(model[key]); } catch (_) { /* Ignore transient getters. */ }
          }
        } catch (_) { /* Model keys can be inaccessible while switching pages. */ }
        return roots;
      };
      const qipuIdOf = (value) => {
        const candidateId = value && (value.qipuId ?? value.qipuID ?? value.iQipuId ?? value.iQipuID ?? value.lQipuId ?? value.lQiPuID ?? value.qipu_id);
        if (candidateId == null) return '';
        const id = String(candidateId).trim();
        // Real QQ chess qipu ids are numeric and non-zero. Model placeholders
        // such as qipuId=0 and unrelated caches must not become phantom rows.
        if (!/^[1-9]\d{4,}$/.test(id)) return '';
        return id;
      };
      const found = new Map();
      // QQ exposes different list roots for recent games, favourites, and
      // self-recorded manuals. Each root is a display-object graph as well as a
      // data source. Its
      // parent/stage/event branches can be effectively unbounded, so only follow
      // data-shaped children and always retain records discovered before a limit.
      const stack = qipuListRoots().map(value => ({ value, depth: 0 }));
      const seen = new WeakSet();
      const scanLimit = 16000;
      const depthLimit = 14;
      const dataKey = /(?:qipu|recent|list|items?|records?|data|result|page|collection|collect|favor|create|created|manual|wall|provider|extDataBody|stTittleInfo)/i;
      const ignoredKey = /^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?|children|_children)$/;
      let scanned = 0;
      let lastReported = 0;
      while (stack.length && scanned < scanLimit) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value); scanned += 1;
        const candidateId = qipuIdOf(value);
        if (candidateId) found.set(candidateId, value);
        if (depth < depthLimit) {
          const keys = Object.keys(value).slice(0, 80);
          // The traversal stack is LIFO. Push children in reverse so Tencent's
          // array index 0 (the visible top row) is visited before later rows.
          for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex -= 1) {
            const key = keys[keyIndex];
            if (ignoredKey.test(key)) continue;
            try {
              const child = value[key];
              if (!child || typeof child !== 'object') continue;
              const childId = qipuIdOf(child);
              if (Array.isArray(child) || childId || dataKey.test(key)) stack.push({ value: child, depth: depth + 1 });
            } catch (_) { /* Ignore inaccessible H5 properties. */ }
          }
        }
        if (scanned - lastReported >= 256 || (!lastReported && found.size > 0)) {
          lastReported = scanned;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: found.size, completed: 0, failed: 0, scanned, current: 0, phase: 'discovering' });
          await delay(0);
        }
      }
      if (!found.size) {
        throw new Error('未在“最近对局”列表中找到棋谱。请在授权窗口打开“最近对局”，等待列表显示后重试');
      }
      const games = [];
      const total = found.size;
      let completed = 0;
      let failed = 0;
      await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current: 0, phase: 'reading' });
      // The current QQ H5 has shipped both the original `fdk.NOTIFY_QIPU_DATA`
      // layout and a model-owned layout. Keep this traversal narrow: it only
      // reads known chess-view roots and never serializes page state.
      const bridgeRoots = () => [
        window.fdk,
        model,
        model && model._qipuRecentView,
        model && model._qipuWallDataList,
        model && model._qipuWallPreViewData,
        model && model._qipuDataList,
        model && model._qipuCollectDataList,
        model && model._qipuCreateDataList,
        model && model._qipuView,
        model && model.currentQipu,
      ].filter(Boolean);
      const propertyNames = (value) => {
        const names = new Set();
        let current = value;
        for (let depth = 0; current && depth < 3; depth += 1) {
          try { Object.getOwnPropertyNames(current).forEach(name => names.add(name)); } catch (_) { /* Ignore protected objects. */ }
          try { current = Object.getPrototypeOf(current); } catch (_) { current = null; }
        }
        return [...names];
      };
      const displayAncestorRoots = (seeds) => {
        const roots = [];
        const seen = new WeakSet();
        for (const seed of seeds.filter(Boolean)) {
          let current = seed;
          for (let depth = 0; current && typeof current === 'object' && depth < 12; depth += 1) {
            if (!seen.has(current)) { seen.add(current); roots.push(current); }
            let parent = null;
            try { parent = current.parent || current._parent; } catch (_) { parent = null; }
            if (!parent || parent === current || parent === window || parent === document) break;
            current = parent;
          }
        }
        return roots;
      };
      let notifyOwnerCache = null;
      let notifySearchAt = 0;
      let notifySearches = 0;
      const notificationOwner = () => {
        if (notifyOwnerCache && Object.prototype.hasOwnProperty.call(notifyOwnerCache, 'NOTIFY_QIPU_DATA')) return notifyOwnerCache;
        // The board notification object is installed asynchronously. Avoid a
        // complete fdk traversal on each 200ms polling iteration.
        if (Date.now() - notifySearchAt < 1_000) return null;
        notifySearchAt = Date.now();
        notifySearches += 1;
        notifyOwnerCache = findObjectWithOwnProperty(window.fdk, 'NOTIFY_QIPU_DATA', 100_000);
        return notifyOwnerCache;
      };
      const boardControls = () => {
        const controls = [];
        const add = (value) => { if (value && !controls.includes(value)) controls.push(value); };
        const notifyOwner = notificationOwner();
        try {
          const entries = notifyOwner && notifyOwner.NOTIFY_QIPU_DATA;
          for (const entry of Array.isArray(entries) ? entries : [entries]) {
            add(entry && entry._boardControl);
            add(entry && entry.thisObj && entry.thisObj._boardControl);
          }
        } catch (_) { /* QQ H5 may replace notification state while a game is loading. */ }
        for (const root of bridgeRoots()) {
          try { add(root._boardControl); } catch (_) { /* Ignore transient getters. */ }
          for (const key of ['NOTIFY_QIPU_DATA', '_NOTIFY_QIPU_DATA', 'notifyQipuData']) {
            try {
              const entries = root[key];
              for (const entry of Array.isArray(entries) ? entries : [entries]) {
                add(entry && entry._boardControl);
                add(entry && entry.thisObj && entry.thisObj._boardControl);
              }
            } catch (_) { /* Ignore transient notification state. */ }
          }
        }
        return controls;
      };
      const detailDisplayRoots = () => {
        const seeds = [...boardControls(), model && model._qipuView, model && model.currentQipu];
        const notifyOwner = notificationOwner();
        try {
          const entries = notifyOwner && notifyOwner.NOTIFY_QIPU_DATA;
          for (const entry of Array.isArray(entries) ? entries : [entries]) {
            if (!entry) continue;
            seeds.push(entry, entry.thisObj, entry._boardControl, entry.thisObj && entry.thisObj._boardControl);
          }
        } catch (_) { /* The active detail view can be replaced between games. */ }
        return displayAncestorRoots(seeds);
      };
      let moveOwnerCache = null;
      let moveOwnerSearchAt = 0;
      const moveSurfaceOwners = () => {
        if (moveOwnerCache && Object.prototype.hasOwnProperty.call(moveOwnerCache, 'getQipuMoveStep')) return [moveOwnerCache];
        if (Date.now() - moveOwnerSearchAt < 1_000) return [];
        moveOwnerSearchAt = Date.now();
        for (const root of [model, window.fdk, model && model._qipuView, model && model.currentQipu]) {
          const owner = findObjectWithOwnProperty(root, 'getQipuMoveStep', 100_000);
          if (owner) { moveOwnerCache = owner; return [owner]; }
        }
        return [];
      };
      const qipuSources = (extraSources = []) => {
        const controls = boardControls();
        return [
          ...extraSources,
          ...controls,
          ...moveSurfaceOwners(),
          ...controls.flatMap(control => [control && control._qipuData, control && control._qipuInfo]),
          ...bridgeRoots(),
          model._qipuData,
          model._qipuInfo,
          model.currentQipu,
        ].filter(Boolean);
      };
      const moveText = (value) => {
        if (value == null) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
        try { return JSON.stringify(value); } catch (_) { return ''; }
      };
      const knownMoveField = /(?:^|\.)(?:getQipuMoveStep|getMainMoveList|getLessonNextMoveStep|qipuMoveStep|_qipuMoveStep|moveStep|_moveStep|moveList|_moveList|MOVE_STR|moveData)$/i;
      const safeMoveText = /^[0-9,\s\[\]]+$/;
      const stringifyMoveValue = (value) => {
        if (!value || typeof value !== 'object') return { status: 'not-object', text: '', length: 0 };
        try {
          const text = String(value).trim();
          if (!text) return { status: 'empty', text: '', length: 0 };
          if (text.length > 32 * 1024) return { status: 'too-long', text: '', length: text.length };
          return { status: 'ok', text, length: text.length };
        } catch (_) {
          return { status: 'error', text: '', length: 0 };
        }
      };
      const moveCandidate = (value, path, owner = null) => {
        const perMoveField = /(?:getMainMoveList|getLessonNextMoveStep)$/i.test(path);
        const digitStreamField = !perMoveField && /(?:getQipuMoveStep|qipuMoveStep|_?moveStep)$/i.test(path);
        const dhtmlField = knownMoveField.test(path);
        // QQ's live board exposes DhtmlXQ coordinates as an array. The proven
        // exporter consumes Array#toString() and removes commas; JSON encoding
        // turns string elements into quoted JSON and made this exact live field
        // look invalid. Prefer primitive/boxed numeric members, then use the
        // bounded whole-value toString fallback for Tencent's wrapper objects.
        const numericToken = (item) => {
          let token = item;
          if (token && typeof token === 'object') {
            try { token = token.valueOf(); } catch (_) { return null; }
            if (token === item) return null;
          }
          if (typeof token === 'number' && Number.isInteger(token)) return String(token);
          if (typeof token === 'string' && /^\d+$/.test(token)) return token;
          return null;
        };
        const numericTokens = dhtmlField && Array.isArray(value) ? value.map(numericToken) : [];
        const numericArray = numericTokens.length > 0 && numericTokens.every(Boolean)
          && (digitStreamField
            ? numericTokens.every(token => token.length === 1 && Number(token) <= 9)
            : numericTokens.every(token => token.length === 4));
        const wholeValue = dhtmlField ? stringifyMoveValue(value) : null;
        const wholeText = wholeValue && wholeValue.status === 'ok' && wholeValue.text !== '[object Object]'
          ? wholeValue.text
          : '';
        // Only use a whole-value serialization as a coordinate stream when it
        // contains the restricted DhtmlXQ alphabet. Otherwise retain JSON/ICCS
        // object extraction for legitimate non-Dhtml move aliases.
        const text = numericArray
          ? numericTokens.join('')
          : wholeText && safeMoveText.test(wholeText) ? wholeText : moveText(value);
        if (!text || text === '[]' || text === '{}') return null;
        const type = numericArray
          ? `array<${value.every(item => typeof item === 'number') ? 'number' : 'numeric-string'}>`
          : wholeText && safeMoveText.test(wholeText)
          ? `${Array.isArray(value) ? 'array' : 'object'}<toString>`
          : Array.isArray(value) ? 'array' : typeof value;
        const iccs = (text.match(/[a-i][0-9][a-i][0-9]/gi) || []).length;
        const chinese = (text.match(/[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/g) || []).length;
        const compactDigits = text.replace(/[^0-9]/g, '');
        const dhtml = dhtmlField
          && safeMoveText.test(text)
          && compactDigits.length >= 4
          && compactDigits.length % 4 === 0;
        // Do not accept a generic object merely because its property contains
        // "move". Board animations such as moveFailEffect are not move lists.
        if (!iccs && !chinese && !dhtml) return null;
        return { text: dhtml ? compactDigits : text, path, type, length: text.length, score: dhtml * 120 + iccs * 100 + chinese * 80 + (Array.isArray(value) ? value.length : 0) + Math.min(text.length, 40) / 100, owner };
      };
      const readRawMoves = (extraSources = []) => {
        const candidates = [];
        const visit = (value, path, depth) => {
          if (depth > 2 || !value || typeof value !== 'object') return;
          for (const key of propertyNames(value).slice(0, 120)) {
            if (!/(?:qipu.*move|move|step|notation|record|chess.*data)/i.test(key)) continue;
            try {
              const child = value[key];
              const candidate = moveCandidate(child, `${path}.${key}`, value);
              if (candidate) candidates.push(candidate);
              visit(child, `${path}.${key}`, depth + 1);
            } catch (_) { /* Ignore transient getters. */ }
          }
        };
        for (const [sourceIndex, source] of qipuSources(extraSources).entries()) {
          const path = `source[${sourceIndex}]`;
          try {
            for (const key of ['getQipuMoveStep', 'getMainMoveList', 'getLessonNextMoveStep', 'qipuMoveStep', '_qipuMoveStep', 'moveStep', '_moveStep', 'moveList', '_moveList', 'MOVE_STR', 'moveData']) {
              if (!(key in source)) continue;
              const candidate = moveCandidate(source[key], `${path}.${key}`, source);
              if (candidate) candidates.push(candidate);
            }
            visit(source, path, 0);
          } catch (_) { /* A page model can expose transient getters while loading. */ }
        }
        candidates.sort((left, right) => right.score - left.score || right.length - left.length);
        return candidates[0] || { text: '', path: '', type: '', length: 0, score: 0 };
      };
      const directNotifyMove = () => {
        const owner = notificationOwner();
        try {
          const entries = owner && owner.NOTIFY_QIPU_DATA;
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const control = entry && entry.thisObj && entry.thisObj._boardControl;
          return moveCandidate(control && control.getQipuMoveStep, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', control);
        } catch (_) { return null; }
      };
      const directModelMove = () => {
        for (const owner of moveSurfaceOwners()) {
          try {
            const candidate = moveCandidate(owner.getQipuMoveStep, 'QipuModel.*.getQipuMoveStep', owner);
            if (candidate) return candidate;
          } catch (_) { /* The live board can be replaced while changing games. */ }
        }
        return null;
      };
      const moveFieldSnapshot = (key, value) => {
        const base = `${key}:${Array.isArray(value) ? `array(${value.length})` : typeof value}`;
        if (!knownMoveField.test(key) || (!Array.isArray(value) && (!value || typeof value !== 'object'))) return base;
        const elementTypes = Array.isArray(value)
          ? [...new Set(value.slice(0, 12).map(item => item === null ? 'null' : typeof item))].join('|') || 'empty'
          : '';
        const serialized = stringifyMoveValue(value);
        if (!serialized || serialized.status !== 'ok') {
          return `${base}${elementTypes ? ` · elements:${elementTypes}` : ''} · toString:${serialized ? serialized.status : 'unavailable'}`;
        }
        const compact = serialized.text.replace(/[^0-9]/g, '');
        const coordinateStream = safeMoveText.test(serialized.text) && compact.length >= 4 && compact.length % 4 === 0;
        const sample = serialized.text.slice(0, 160).replace(/[^0-9,\s\[\]]/g, '?');
        return `${base}${elementTypes ? ` · elements:${elementTypes}` : ''} · toString:${serialized.length} chars · ${coordinateStream ? 'coordinate-candidate' : 'serialization-invalid'} · sample:${sample}`;
      };
      const bridgeSnapshot = (extraSources = []) => {
        const owner = notificationOwner();
        let notifyState = `NOTIFY_QIPU_DATA:${owner ? 'found' : 'missing'} (searched ${notifySearches} times)`;
        if (owner) try {
          const entries = owner.NOTIFY_QIPU_DATA;
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const control = entry && (entry.thisObj || entry)._boardControl;
          notifyState += ` · entries:${Array.isArray(entries) ? entries.length : 1} · boardControl:${control ? typeof control : 'missing'} · ${control ? moveFieldSnapshot('getQipuMoveStep', control.getQipuMoveStep) : 'getQipuMoveStep:missing'}`;
        } catch (_) { notifyState += ' · entries:unavailable'; }
        const modelDetail = ['jumpQipuGame', 'requestGetQipuInfo', '_qipuRecentView', '_qipuWallDataList', '_qipuWallPreViewData']
          .map(key => `${key}:${typeof model[key]}`).join(', ');
        const sources = qipuSources(extraSources).slice(0, 12).map((source, index) => {
        const fields = propertyNames(source)
          .filter(key => /(?:qipu|move|step|notation|record|chess|board|data)/i.test(key))
          .slice(0, 24)
          .map(key => {
            try {
              const value = source[key];
              return moveFieldSnapshot(key, value);
            } catch (_) { return `${key}:unavailable`; }
          });
        const nested = propertyNames(source)
          .filter(key => /(?:qipu|record|list|data)/i.test(key))
          .slice(0, 6)
          .map(key => {
            try {
              const value = source[key];
              const item = Array.isArray(value) ? value[0] : value;
              if (!item || typeof item !== 'object') return '';
              const itemFields = propertyNames(item)
                .filter(name => /(?:qipu|move|step|notation|record|chess|player|date|result)/i.test(name))
                .slice(0, 18)
                .map(name => {
                  try {
                    const field = item[name];
                    return moveFieldSnapshot(name, field);
                  } catch (_) { return `${name}:unavailable`; }
                });
              return itemFields.length ? `${key}[0]{${itemFields.join(', ')}}` : '';
            } catch (_) { return ''; }
          })
          .filter(Boolean);
          return `source[${index}] ${[fields.join(', '), ...nested].filter(Boolean).join(' | ') || '(no known chess fields)'}`;
        });
        return [notifyState, `QipuModel ${modelDetail}`, ...sources].join('\n').slice(0, 8 * 1024);
      };
      const normalizeInitialFen = (value) => {
        if (typeof value !== 'string') return '';
        const text = value.trim();
        if (!text.includes('/') || text.length > 240) return '';
        const fields = text.split(/\s+/).filter(Boolean);
        const placement = fields[0] || '';
        const ranks = placement.split('/');
        if (ranks.length !== 10) return '';
        for (const rank of ranks) {
          let files = 0;
          for (const symbol of rank) {
            if (/^[1-9]$/.test(symbol)) {
              files += Number(symbol);
            } else if (/^[rheakcpRHEAKCPnbagpsNBAGPS]$/.test(symbol)) {
              files += 1;
            } else {
              return '';
            }
          }
          if (files !== 9) return '';
        }
        const side = /^(?:w|r|b)$/.test(fields[1] || '') ? (fields[1] === 'r' ? 'w' : fields[1]) : 'w';
        return `${placement} ${side} - - 0 1`;
      };
      const initialFen = () => {
        const roots = boardControls().flatMap(control => [
          control,
          control && control._qipuData,
          control && control._qipuInfo,
          control && control.qipuData,
          control && control.qipuInfo,
        ]).filter(Boolean);
        const seen = new WeakSet();
        const stack = roots.map(value => ({ value, depth: 0 }));
        let visited = 0;
        while (stack.length && visited < 8_000) {
          const { value, depth } = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue;
          seen.add(value); visited += 1;
          for (const key of propertyNames(value).slice(0, 120)) {
            if (/cookie|token|ticket|skey|p_skey|credential|password|html/i.test(key)) continue;
            try {
              const child = value[key];
              if (typeof child === 'string') {
                const fen = normalizeInitialFen(child);
                if (fen) return fen;
              } else if (child && typeof child === 'object' && /(?:fen|init|start|qipu|board|chess|data|info|ju|jumian|局面)/i.test(key)) {
                stack.push({ value: child, depth: depth + 1 });
              }
            } catch (_) { /* Ignore transient board-control fields. */ }
          }
        }
        return '';
      };
      const branchPayload = (preferredControl = null) => {
        const branchDeadline = Date.now() + 800;
        let branchScanTimedOut = false;
        const branchScanExpired = () => {
          if (Date.now() < branchDeadline) return false;
          branchScanTimedOut = true;
          return true;
        };
        const safeBranchClone = (value, depth = 0, seen = new WeakSet()) => {
          if (branchScanExpired()) return '[scan-timeout]';
          if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
          if (typeof value === 'string') return value.slice(0, 1000);
          if (typeof value === 'function') return '[function]';
          if (typeof value !== 'object' || depth > 4) return `[${typeof value}]`;
          if (seen.has(value)) return '[cycle]';
          seen.add(value);
          if (Array.isArray(value)) return value.slice(0, 80).map(item => safeBranchClone(item, depth + 1, seen));
          const copy = {};
          let keys = [];
          try { keys = Object.getOwnPropertyNames(value).slice(0, 80); } catch (_) { keys = propertyNames(value).slice(0, 80); }
          for (const key of keys) {
            if (/cookie|token|ticket|skey|p_skey|credential|password|html/i.test(key)) continue;
            try { copy[key] = safeBranchClone(value[key], depth + 1, seen); } catch (_) { copy[key] = '[unavailable]'; }
          }
          return copy;
        };
        const branchPlyHint = (path, owner) => {
          const dhtmlKey = String(path).match(/(?:^|\.)(\d+)-(\d+)-(\d+)$/);
          if (dhtmlKey) return Number(dhtmlKey[2]);
          if (owner && typeof owner === 'object') {
            for (const key of ['afterPly', 'after_ply', 'ply', 'parentPly', 'moveIndex', 'stepIndex', 'startPly', 'branchPly']) {
              try {
                const value = owner[key];
                if (Number.isInteger(value) && value >= 0) return value;
                if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
              } catch (_) { /* Ignore transient branch getters. */ }
            }
          }
          const numbers = String(path).match(/\d+/g) || [];
          return numbers.length ? Number(numbers[numbers.length - 1]) : undefined;
        };
        const branchMoveCandidate = (value, path, owner = null) => {
          if (/(?:^|\.)(?:getQipuMoveStep|qipuMoveStep|_qipuMoveStep)$/.test(path) && !/^route\[\d+\]\./.test(path)) return null;
          if (/(?:^|\.)(?:msg|_msg|comment|remark|note)$/i.test(path)) return null;
          if (/(?:^|\.)(?:content|text|body|title|label|description)(?:\.|$)/i.test(path)) return null;
          const directDhtmlBranch = /(?:^|\.)getMoveBranchKey(?:\.|$)/.test(path);
          const explicitMoveField = /(?:^|\.)(?:move|moves|moveList|movelist|moveStep|steps|step|raw|MOVE_STR|variationMoves)(?:\.|$)/i.test(path);
          const activatedRoute = /^route\[\d+\]\./.test(path);
          const referenceMsgField = path.includes('.msgContainer.');
          if (!directDhtmlBranch && !explicitMoveField && !activatedRoute && !referenceMsgField) return null;
          let text = '';
          const primitiveToken = (item) => {
            if (typeof item === 'number' && Number.isInteger(item)) return String(item);
            if (typeof item === 'string' && /^\d+$/.test(item)) return item;
            return null;
          };
          if (Array.isArray(value)) {
            const tokens = value.map(primitiveToken);
            if (tokens.length && tokens.every(Boolean)) text = tokens.join('');
          }
          if (!text && (typeof value === 'string' || typeof value === 'number')) text = String(value).trim();
          if (!text && value && typeof value === 'object') {
            const serialized = stringifyMoveValue(value);
            if (serialized.status === 'ok' && serialized.text !== '[object Object]') text = serialized.text;
          }
          if (!text || text.length > 32 * 1024) return null;
          const compactDigits = text.replace(/[^0-9]/g, '');
          const dhtml = safeMoveText.test(text) && compactDigits.length >= 4 && compactDigits.length % 4 === 0;
          const tagged = text.includes('[DhtmlXQ_move_') || text.includes('[DhtmlXQ_movelist]');
          const iccs = (text.match(/[a-i][0-9][a-i][0-9]/gi) || []).length;
          const chinese = (text.match(/[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/g) || []).length;
          if (!dhtml && !tagged && !iccs && !chinese) return null;
          return {
            path,
            raw: dhtml ? compactDigits : text.slice(0, 32 * 1024),
            valueType: Array.isArray(value) ? 'array' : typeof value,
            afterPly: branchPlyHint(path, owner),
          };
        };
        const collectBranchCandidates = (roots) => {
          const candidates = [];
          const seen = new WeakSet();
          const stack = roots.filter(Boolean).map(({ value, path }) => ({ value, path, depth: 0, owner: null }));
          let visited = 0;
          while (stack.length && visited < 4000 && candidates.length < 256 && !branchScanExpired()) {
            const { value, path, depth, owner } = stack.pop();
            if (value == null) continue;
            const candidate = branchMoveCandidate(value, path, owner);
            if (candidate) candidates.push(candidate);
            if (!value || typeof value !== 'object' || depth >= 7 || seen.has(value)) continue;
            seen.add(value); visited += 1;
            for (const key of propertyNames(value).slice(0, 100)) {
              if (branchScanExpired()) break;
              if (/cookie|token|ticket|skey|p_skey|credential|password|html/i.test(key)) continue;
              // Tencent's msg rows mix branch payloads with comment metadata.
              // Keep unknown/obfuscated keys available, but never interpret
              // stable account, author, or timestamp fields as coordinates.
              if (/^(?:msg|comment|remark|note|content|text|body|title|label|description|id|uUin|uin|userId|userName|uname|nickName|avatar|face|time|date|timestamp|createTime|updateTime|qipuId)$/i.test(key)) continue;
              try {
                const child = value[key];
                const namedBranchField = /(?:move|step|msg|branch|qipu|data|list|line|comment|remark|DhtmlXQ|key|^\d+$)/i.test(key);
                const insideBranchContainer = /(?:branch|variation|msgContainer|getMoveBranchKey)/i.test(path);
                if (!namedBranchField && !insideBranchContainer) continue;
                stack.push({ value: child, path: `${path}.${key}`, depth: depth + 1, owner: value });
              } catch (_) { /* Ignore transient branch getters. */ }
            }
          }
          const seenSignatures = new Set();
          return candidates.filter(candidate => {
            const signature = `${candidate.afterPly ?? ''}:${candidate.raw}`;
            if (seenSignatures.has(signature)) return false;
            seenSignatures.add(signature);
            return true;
          });
        };
        const branchMessageContainers = (root, property, rootPath, limit = 8_000) => {
          const containers = [];
          if (!root || typeof root !== 'object') return containers;
          const seen = new WeakSet();
          const returned = new WeakSet();
          const stack = [{ value: root, path: rootPath, depth: 0 }];
          let visited = 0;
          while (stack.length && visited < limit && containers.length < 32 && !branchScanExpired()) {
            const { value, path, depth } = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) continue;
            seen.add(value); visited += 1;
            for (const key of propertyNames(value).slice(0, 120)) {
              if (branchScanExpired()) break;
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
              if (/cookie|token|ticket|skey|p_skey|credential|password|html/i.test(key)) continue;
              let child; try { child = value[key]; } catch (_) { continue; }
              if (Array.isArray(child) && child.some(item => item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, property))) {
                if (!returned.has(value)) {
                  returned.add(value);
                  containers.push({ value, path });
                }
              }
              if (child && typeof child === 'object' && !seen.has(child)) {
                stack.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
              }
            }
          }
          return containers;
        };
        const routeNumberFromText = (text) => {
          const normalized = String(text || '').trim();
          if (!/^\d{1,2}$/.test(normalized)) return null;
          const route = Number(normalized);
          return route >= 1 && route <= 16 ? route : null;
        };
        const collectRouteControlGroup = () => {
          const textOf = (value) => {
            if (!value || typeof value !== 'object') return '';
            for (const key of ['text', '_text', 'value', '_value', 'label', '_label', 'name', '_name']) {
              try {
                const candidate = value[key];
                if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim().length <= 32) {
                  return String(candidate).trim();
                }
              } catch (_) { /* Ignore display-object getters. */ }
            }
            return '';
          };
          const childValues = (value) => {
            const children = [];
            for (const key of propertyNames(value).slice(0, 120)) {
              if (branchScanExpired()) break;
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
              if (/cookie|token|ticket|skey|p_skey|credential|password|html/i.test(key)) continue;
              try {
                const child = value[key];
                if (child && typeof child === 'object') children.push(child);
              } catch (_) { /* Ignore inaccessible display properties. */ }
            }
            return children;
          };
          const consecutiveRouteGroup = (numbers) => {
            const unique = [...new Set(numbers)].sort((left, right) => left - right);
            if (unique.length < 2 || unique.length > 8 || unique[0] !== 1) return [];
            for (let index = 0; index < unique.length; index += 1) {
              if (unique[index] !== index + 1) return [];
            }
            return unique;
          };
          const containsControl = (root, control) => {
            if (!root || !control || typeof root !== 'object' || typeof control !== 'object') return false;
            const seen = new WeakSet();
            const stack = [{ value: root, depth: 0 }];
            let visited = 0;
            while (stack.length && visited < 8_000 && !branchScanExpired()) {
              const { value, depth } = stack.pop();
              if (value === control) return true;
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 14) continue;
              seen.add(value); visited += 1;
              for (const child of childValues(value)) stack.push({ value: child, depth: depth + 1 });
            }
            return false;
          };
          const groups = [];
          const seen = new WeakSet();
          const globalDetailRoots = typeof detailDisplayRoots === 'function' ? detailDisplayRoots() : [];
          const roots = preferredControl && typeof preferredControl === 'object'
            ? [preferredControl, ...globalDetailRoots.filter(root => containsControl(root, preferredControl))]
            : [
                ...globalDetailRoots,
                ...(typeof boardControls === 'function' ? boardControls() : []),
              ].filter(Boolean);
          const stack = roots.map(value => ({ value, depth: 0 }));
          let visited = 0;
          while (stack.length && visited < 16_000 && groups.length < 8 && !branchScanExpired()) {
            const { value, depth } = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 14) continue;
            seen.add(value); visited += 1;
            const children = childValues(value);
            const routeButtons = children
              .map(child => ({ routeNo: routeNumberFromText(textOf(child)), control: child }))
              .filter(item => item.routeNo != null);
            const childRoutes = consecutiveRouteGroup(routeButtons.map(item => item.routeNo));
            const context = [textOf(value), ...children.map(textOf)].filter(Boolean).join(' ');
            const routeContext = /(?:编辑|完成|下一步|下变|播放|棋谱导航)/.test(context);
            const activatable = routeButtons.filter(item =>
              typeof item.control.dispatchEvent === 'function'
              || typeof item.control.emit === 'function'
              || typeof item.control.click === 'function'
              || typeof item.control.onClick === 'function'
            );
            const belongsToPreferredControl = childRoutes.length && routeContext && activatable.length === childRoutes.length
              ? (!preferredControl || containsControl(value, preferredControl))
              : false;
            if (belongsToPreferredControl) {
              groups.push({
                numbers: childRoutes,
                buttons: activatable
                  .filter(item => childRoutes.includes(item.routeNo))
                  .sort((left, right) => left.routeNo - right.routeNo),
                container: value,
              });
            }
            for (const child of children) stack.push({ value: child, depth: depth + 1 });
          }
          groups.sort((left, right) => right.numbers.length - left.numbers.length);
          return groups[0] || { numbers: [], buttons: [], container: null };
        };
        const routeNumbersFromBranchSignals = (signals) => {
          const routes = new Set();
          const visit = (value, depth = 0, explicitRouteField = false) => {
            if (value == null || depth > 4 || routes.size >= 16 || branchScanExpired()) return;
            if (typeof value === 'number' || typeof value === 'string') {
              if (explicitRouteField) {
                const route = routeNumberFromText(value);
                if (route != null) routes.add(route);
              }
              return;
            }
            if (typeof value !== 'object') return;
            if (Array.isArray(value)) {
              if (value.length >= 2 && value.length <= 16) {
                for (let index = 1; index <= value.length; index += 1) routes.add(index);
              }
              value.slice(0, 32).forEach(item => visit(item, depth + 1));
              return;
            }
            const numericKeys = Object.keys(value)
              .map(key => /^\d{1,2}$/.test(key) ? Number(key) : null)
              .filter(route => Number.isInteger(route) && route >= 1 && route <= 16);
            if (numericKeys.length >= 2) numericKeys.forEach(route => routes.add(route));
            for (const key of propertyNames(value).slice(0, 80)) {
              try {
                const child = value[key];
                if (/^(?:route|routeNo|branchNo|branchIndex|lineNo|variationNo|index|idx)$/i.test(key)) {
                  const route = routeNumberFromText(child);
                  if (route != null) routes.add(route);
                }
                visit(child, depth + 1, /^(?:route|routeNo|branchNo|branchIndex|lineNo|variationNo)$/i.test(key));
              } catch (_) { /* Ignore transient branch values. */ }
            }
          };
          for (const signal of signals) visit(signal.value);
          return [...routes].filter(route => route >= 1 && route <= 16).sort((left, right) => left - right);
        };
        const discoveredControls = boardControls();
        const controls = preferredControl && typeof preferredControl === 'object'
          ? [preferredControl]
          : discoveredControls;
        const branchOwner = controls[0] || null;
        if (!controls.length) return { data: '', path: '', complete: true, owner: null };
        const branchSources = [];
        const branchSignals = [];
        const referenceContainers = [];
        let hasStructuralBranchSignal = false;
        const addBranchSource = (value, path) => {
          if (value == null) return;
          branchSources.push({ value, path });
        };
        const hasBranchValue = (value) => Array.isArray(value) ? value.length > 0
          : value && typeof value === 'object' ? Object.keys(value).length > 0
          : Boolean(value);
        const branchFieldNames = [
          'getMoveBranchKey', 'moveBranchKey', '_moveBranchKey', 'branchKey',
          'msg', '_msg', 'branchData', '_branchData', 'variationData',
          '_variationData', 'moveBranchData', '_moveBranchData', 'qipuBranchData',
        ];
        for (const [index, control] of controls.entries()) {
          for (const key of branchFieldNames) {
            try {
              if (!(key in control)) continue;
              const value = control[key];
              if (/branch|msg/i.test(key) && hasBranchValue(value)) {
                branchSignals.push({ path: `boardControl[${index}].${key}`, value });
                if (/branch|MoveBranchKey/i.test(key)) hasStructuralBranchSignal = true;
              }
              addBranchSource(value, `boardControl[${index}].${key}`);
            } catch (_) { /* Ignore transient branch fields. */ }
          }
          for (const key of ['getMoveBranchKey', 'msg']) {
            try {
              const owner = findObjectWithOwnProperty(control, key, 8_000);
              if (owner && owner !== control) {
                const value = owner[key];
                if (hasBranchValue(value)) branchSignals.push({ path: `boardControl[${index}].*.${key}`, value });
                if (/branch|MoveBranchKey/i.test(key) && hasBranchValue(value)) hasStructuralBranchSignal = true;
                addBranchSource(value, `boardControl[${index}].*.${key}`);
              }
            } catch (_) { /* Branch message data is optional. */ }
          }
          for (const container of branchMessageContainers(control, 'msg', `boardControl[${index}]`)) {
            // Tencent also stores ordinary move comments / recommendations as
            // `{msg, time, uname}` rows. They are useful search roots for real
            // branch move fields, but a comment-only msg container must not
            // block importing the mainline as "分支未识别".
            addBranchSource(container.value, `${container.path}.msgContainer`);
            referenceContainers.push({ path: `${container.path}.msgContainer`, value: container.value });
          }
        }
        const detailRoots = preferredControl ? []
          : [model && model._qipuView, model && model.currentQipu, model && model._qipuData, model && model._qipuInfo].filter(Boolean);
        for (const [index, root] of detailRoots.entries()) {
          for (const key of ['getMoveBranchKey', 'msg']) {
            try {
              const owner = findObjectWithOwnProperty(root, key, 8_000);
              if (!owner) continue;
              const value = owner[key];
              if (hasBranchValue(value)) branchSignals.push({ path: `detailRoot[${index}].*.${key}`, value });
              if (/branch|MoveBranchKey/i.test(key) && hasBranchValue(value)) hasStructuralBranchSignal = true;
              addBranchSource(value, `detailRoot[${index}].*.${key}`);
            } catch (_) { /* Detail roots vary by Tencent build. */ }
          }
          for (const container of branchMessageContainers(root, 'msg', `detailRoot[${index}]`)) {
            addBranchSource(container.value, `${container.path}.msgContainer`);
            referenceContainers.push({ path: `${container.path}.msgContainer`, value: container.value });
          }
        }
        const candidates = collectBranchCandidates(branchSources);
        const routeNumbers = routeNumbersFromBranchSignals(branchSignals);
        const routeControls = hasStructuralBranchSignal
          ? { numbers: [], buttons: [], container: null }
          : preferredControl
            && branchPayload.routeControlOwner === preferredControl
            && branchPayload.routeControls
            ? branchPayload.routeControls
            : collectRouteControlGroup();
        branchPayload.routeControls = routeControls;
        branchPayload.routeControlOwner = preferredControl;
        const visibleRouteNumbers = routeControls.numbers;
        const signalSamples = branchSignals.slice(0, 12).map(signal => ({
          path: signal.path,
          value: safeBranchClone(signal.value),
        }));
        const referenceSamples = referenceContainers.slice(0, 4).map(container => {
          const value = container.value;
          let keys = [];
          try { keys = propertyNames(value).slice(0, 24); } catch (_) { keys = []; }
          return {
            path: container.path,
            valueType: Array.isArray(value) ? 'array' : typeof value,
            length: Array.isArray(value) ? value.length : keys.length,
            keys,
          };
        });
        const hasIndependentCandidate = candidates.some(candidate => !/msgContainer/i.test(candidate.path));
        const hasBranchSignal = hasStructuralBranchSignal || visibleRouteNumbers.length > 1 || hasIndependentCandidate;
        if (branchScanTimedOut && !hasBranchSignal) {
          return {
            data: JSON.stringify({ scanTimedOut: true, signals: signalSamples, candidates: [] }).slice(0, 32 * 1024),
            path: 'ttxq-branch-scan-timeout',
            complete: false,
            owner: branchOwner,
          };
        }
        if (!hasBranchSignal) {
          if (visibleRouteNumbers.length > 1) {
            return {
              data: JSON.stringify({ signals: [], candidates: [], visibleRouteNumbers }).slice(0, 32 * 1024),
              path: 'routeButtons',
              complete: false,
              owner: branchOwner,
            };
          }
          return { data: '', path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey', complete: true, owner: branchOwner };
        }
        try {
          return {
            data: JSON.stringify({ signals: signalSamples, referenceSamples, candidates, routeNumbers, visibleRouteNumbers }).slice(0, 32 * 1024),
            path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey + msg + routeButtons',
            complete: false,
            owner: branchOwner,
          };
        } catch (_) {
          return { data: '[网页变招字段无法序列化]', path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey', complete: false, owner: branchOwner };
        }
      };
      const liveLoadedId = () => {
        // Never inspect the requested recent-list item here: its qipuId is the
        // target id even while the visible board is still showing the previous
        // game. Only live board/model objects can prove the switch completed.
        for (const source of qipuSources()) {
          const id = source && (source.qipuId || source._qipuId || source.qipu_id || source.qipuID || source._qipuID);
          if (id != null) return String(id);
        }
        return '';
      };
      const snapshotHasCoordinateCandidate = (snapshot) =>
        typeof snapshot === 'string' && /getQipuMoveStep:[^\n]*coordinate-candidate/.test(snapshot);
      const acceptsTargetCandidate = (candidate, qipuId, beforeSignature, beforeOwner = null, options = {}) => {
        if (!candidate || !candidate.text) return false;
        const signature = `${candidate.path}:${candidate.type}:${candidate.text}`;
        const controllerChanged = candidate.owner && beforeOwner && candidate.owner !== beforeOwner;
        const loadedId = liveLoadedId();
        if (loadedId && loadedId !== String(qipuId)) return false;
        if (loadedId === String(qipuId) || controllerChanged) return true;
        if (signature !== beforeSignature && options.stableSignature === signature) return true;
        // Some QQ pages reuse the same board controller and can produce the
        // same coordinate stream for adjacent records. After a bounded wait,
        // a snapshot of the live notification board that already marks the
        // move field as a DhtmlXQ coordinate candidate is the best available
        // positive signal; a contradictory loadedId above still wins.
        return Boolean(options.coordinateSnapshot);
      };
      const waitForTarget = async (qipuId, beforeSignature, beforeOwner = null, extraSources = [], maxPolls = 12) => {
        let stableSignature = '';
        for (let poll = 0; poll < maxPolls; poll += 1) {
          await delay(200);
          const candidate = directNotifyMove() || directModelMove() || readRawMoves(extraSources);
          if (acceptsTargetCandidate(candidate, qipuId, beforeSignature, beforeOwner, { stableSignature })) return candidate;
          const signature = candidateSignature(candidate);
          stableSignature = signature && signature !== beforeSignature ? signature : '';
        }
        throw new Error('棋谱加载超时');
      };
      const candidateSignature = (candidate) => candidate && candidate.text
        ? `${candidate.path}:${candidate.type}:${candidate.text}`
        : '';
      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '') => {
        const reportBranchHeartbeat = async () => {
          if (typeof invoke !== 'function'
            || typeof total === 'undefined'
            || typeof completed === 'undefined'
            || typeof failed === 'undefined'
            || typeof scanned === 'undefined'
            || typeof current === 'undefined') return;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'branches' });
        };
        // getQipuMoveStep becomes available before QQ finishes installing the
        // branch-key/msg structures. The reference exporter polls the board
        // control as a whole; do the same here instead of permanently trusting
        // the first (often empty) snapshot taken as soon as the mainline loads.
        const preferredOwner = mainRaw && mainRaw.owner || null;
        const passiveOwnedByTarget = Boolean(
          preferredOwner && passiveBranch && passiveBranch.owner === preferredOwner,
        );
        let settledBranch = preferredOwner && passiveBranch && passiveBranch.owner && !passiveOwnedByTarget
          ? { data: '', path: '', complete: true, owner: preferredOwner }
          : (passiveBranch || { data: '', path: '', complete: true, owner: preferredOwner });
        let previousSnapshotUnverified = passiveOwnedByTarget
          && Boolean(settledBranch.data)
          && String(settledBranch.data) === beforeBranchSignature;
        let verifiedNonEmptySnapshot = passiveOwnedByTarget
          && Boolean(settledBranch.data)
          && !previousSnapshotUnverified;
        let consecutiveEmptySnapshots = 0;
        for (let poll = 0; poll < 5; poll += 1) {
          if (poll > 0) await delay(150);
          await reportBranchHeartbeat();
          const observed = branchPayload(preferredOwner);
          const signature = String(observed && observed.data || '');
          if (signature || (observed && observed.complete === false)) {
            if (signature && previousSnapshotUnverified && signature === beforeBranchSignature) {
              consecutiveEmptySnapshots = 0;
              continue;
            }
            settledBranch = observed;
            if (preferredOwner && observed && observed.owner === preferredOwner && signature) {
              verifiedNonEmptySnapshot = true;
              previousSnapshotUnverified = false;
            }
            consecutiveEmptySnapshots = 0;
          } else if (!verifiedNonEmptySnapshot) {
            consecutiveEmptySnapshots += 1;
            // A stale controller can expose the previous game's branches for
            // the first read after jumpQipuGame. Two explicit empty snapshots
            // from the settled target clear that old payload without masking a
            // branch structure that appears later in this bounded window.
            if (consecutiveEmptySnapshots >= 2) {
              settledBranch = observed;
              previousSnapshotUnverified = false;
            }
          }
        }
        if (previousSnapshotUnverified && !verifiedNonEmptySnapshot) {
          settledBranch = {
            data: JSON.stringify({ staleSnapshot: true, signals: [], candidates: [] }),
            path: 'previous-game-branch-signature',
            complete: false,
            owner: preferredOwner,
          };
        }
        passiveBranch = settledBranch;
        let envelope = {};
        if (passiveBranch && passiveBranch.data) {
          try {
            envelope = JSON.parse(passiveBranch.data);
          } catch (_) {
            envelope = { rawBranchData: String(passiveBranch.data).slice(0, 2000) };
          }
        }
        const structuralRouteNumbers = [...new Set(Array.isArray(envelope.routeNumbers) ? envelope.routeNumbers : [])]
          .map(route => Number(route))
          .filter(route => Number.isInteger(route) && route >= 2 && route <= 16)
          .sort((left, right) => left - right);
        const visibleRouteNumbers = [...new Set(Array.isArray(envelope.visibleRouteNumbers) ? envelope.visibleRouteNumbers : [])]
          .map(route => Number(route))
          .filter(route => Number.isInteger(route) && route >= 1 && route <= 16)
          .sort((left, right) => left - right);
        const routeControlGroup = branchPayload.routeControls || { numbers: [], buttons: [] };
        const controlsByRoute = new Map((routeControlGroup.buttons || []).map(item => [Number(item.routeNo), item.control]));
        const routeNumbers = [...new Set([...structuralRouteNumbers, ...visibleRouteNumbers, ...(routeControlGroup.numbers || [])])]
          .filter(route => Number.isInteger(route) && route >= 1 && route <= 16)
          .sort((left, right) => left - right);
        const routesToTry = routeNumbers.filter(route => route >= 2 && controlsByRoute.has(route)).slice(0, 15);
        const routeCandidates = [];
        const routeFailures = [];
        const seenRoutes = new Set();
        let previousBranchSignature = String(passiveBranch && passiveBranch.data || '');
        const routeSelectionConfirmed = (routeNo) => {
          const control = controlsByRoute.get(routeNo);
          if (!control) return false;
          for (const key of ['selected', '_selected', 'checked', '_checked', 'active', '_active']) {
            try { if (control[key] === true) return true; } catch (_) { /* Ignore transient selection fields. */ }
          }
          const container = routeControlGroup.container;
          if (container && typeof container === 'object') {
            for (const key of ['selectedRoute', '_selectedRoute', 'routeNo', '_routeNo', 'currentRoute', '_currentRoute']) {
              try { if (Number(container[key]) === routeNo) return true; } catch (_) { /* Ignore transient selection fields. */ }
            }
            for (const key of ['selectedIndex', '_selectedIndex', 'currentIndex', '_currentIndex']) {
              try {
                const index = Number(container[key]);
                if (Number.isInteger(index) && (index === routeNo || index + 1 === routeNo)) return true;
              } catch (_) { /* Ignore transient selection fields. */ }
            }
          }
          return false;
        };
        const activateRoute = (routeNo) => {
          const control = controlsByRoute.get(routeNo);
          if (!control) return false;
          const attempts = [
            () => typeof control.dispatchEvent === 'function' && control.dispatchEvent('click'),
            () => typeof control.emit === 'function' && control.emit('click'),
            () => typeof control.click === 'function' && control.click(),
            () => typeof control.onClick === 'function' && control.onClick({ type: 'click', currentTarget: control }),
          ];
          for (const attempt of attempts) {
            try {
              const result = attempt();
              if (result !== false) return true;
            } catch (_) { /* Try the next display-object event adapter. */ }
          }
          return false;
        };
        for (const routeNo of routesToTry) {
          const beforeRouteRaw = directNotifyMove() || directModelMove() || readRawMoves([]);
          const beforeRouteText = beforeRouteRaw && beforeRouteRaw.text || '';
          if (!activateRoute(routeNo)) {
            routeFailures.push({ routeNo, reason: '路线按钮无法触发' });
            continue;
          }
          let collected = false;
          let previousRouteRawSignature = '';
          for (let poll = 0; poll < 6 && !collected; poll += 1) {
            await delay(150);
            await reportBranchHeartbeat();
            const loadedId = liveLoadedId();
            if (loadedId && loadedId !== String(qipuId)) continue;
            const activeBranch = branchPayload(preferredOwner);
            const activeBranchSignature = String(activeBranch && activeBranch.data || '');
            const branchChanged = activeBranchSignature
              && activeBranchSignature !== previousBranchSignature;
            if (!routeSelectionConfirmed(routeNo)) continue;
            let activeEnvelope = {};
            try { activeEnvelope = activeBranch && activeBranch.data ? JSON.parse(activeBranch.data) : {}; } catch (_) { activeEnvelope = {}; }
            if (branchChanged) {
              const activeCandidates = Array.isArray(activeEnvelope.candidates) ? activeEnvelope.candidates : [];
              for (const candidate of activeCandidates) {
                if (!candidate || !candidate.raw || candidate.raw === (mainRaw && mainRaw.text)) continue;
                const signature = `${routeNo}:${candidate.afterPly ?? ''}:${candidate.raw}`;
                if (seenRoutes.has(signature)) continue;
                seenRoutes.add(signature);
                routeCandidates.push({
                  ...candidate,
                  routeNo,
                  path: `route[${routeNo}].${candidate.path || 'branchData'}`,
                  comment: candidate.comment || `天天象棋路线 ${routeNo}`,
                });
                previousBranchSignature = activeBranchSignature;
                collected = true;
              }
            }
            if (collected) break;
            const routeRaw = directNotifyMove() || directModelMove() || readRawMoves([]);
            const routeRawChanged = routeRaw && routeRaw.text
              && routeRaw.text !== (mainRaw && mainRaw.text)
              && routeRaw.text !== beforeRouteText;
            if (routeRawChanged) {
              const rawSignature = candidateSignature(routeRaw);
              if (rawSignature && rawSignature === previousRouteRawSignature) {
                const signature = `${routeNo}:${routeRaw.text}`;
                if (!seenRoutes.has(signature)) {
                  seenRoutes.add(signature);
                  routeCandidates.push({
                    routeNo,
                    path: `route[${routeNo}].${routeRaw.path || 'getQipuMoveStep'}`,
                    raw: routeRaw.text.slice(0, 32 * 1024),
                    valueType: routeRaw.type || '',
                    afterPly: null,
                    comment: `天天象棋路线 ${routeNo}`,
                  });
                }
                previousBranchSignature = activeBranchSignature;
                collected = true;
              } else {
                previousRouteRawSignature = rawSignature;
              }
            }
          }
          if (!collected) {
            routeFailures.push({ routeNo, reason: '未取得与主线不同的分支走法' });
          }
        }
        if (controlsByRoute.has(1)) {
          activateRoute(1);
          for (let poll = 0; poll < 6; poll += 1) {
            await delay(100);
            if (routeSelectionConfirmed(1)) break;
          }
        }
        envelope.routeNumbers = routeNumbers;
        envelope.visibleRouteNumbers = visibleRouteNumbers;
        envelope.routesAttempted = routesToTry;
        envelope.routeFailures = routeFailures.slice(0, 16);
        if (!routeCandidates.length) {
          if (routeNumbers.length > 1 || (passiveBranch && passiveBranch.complete === false)) {
            try {
              return {
                data: JSON.stringify(envelope).slice(0, 32 * 1024),
                path: `${passiveBranch && passiveBranch.path || 'ttxq-branch'} + routeControls`,
                complete: false,
              };
            } catch (_) { /* Fall back to passive branch below. */ }
          }
          return passiveBranch;
        }
        const existingCandidates = Array.isArray(envelope.candidates) ? envelope.candidates : [];
        envelope.candidates = [...existingCandidates, ...routeCandidates].slice(0, 256);
        envelope.routeCandidates = routeCandidates.map(candidate => ({
          routeNo: candidate.routeNo,
          path: candidate.path,
          valueType: candidate.valueType,
          length: candidate.raw.length,
          comment: candidate.comment,
        }));
        if (routeFailures.length) envelope.routeFailures = routeFailures.slice(0, 16);
        try {
          return {
            data: JSON.stringify(envelope).slice(0, 32 * 1024),
            path: `${passiveBranch && passiveBranch.path || 'ttxq-branch'} + routeControls`,
            complete: false,
          };
        } catch (_) {
          return passiveBranch;
        }
      };
      let current = 0;
      const failures = [];
      for (const [qipuId, info] of found) {
        current += 1;
        try {
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'loading' });
          let raw = { text: '', path: '', type: '', length: 0, score: 0 };
          const beforeCandidate = directNotifyMove() || directModelMove() || readRawMoves([info]);
          const beforeSignature = `${beforeCandidate.path}:${beforeCandidate.type}:${beforeCandidate.text}`;
          const beforeOwner = beforeCandidate.owner || null;
          const beforeBranchSignature = typeof branchPayload === 'function'
            ? String((branchPayload(beforeOwner || null) || {}).data || '')
            : '';
          moveOwnerCache = null;
          moveOwnerSearchAt = 0;
          if (typeof branchPayload === 'function') {
            branchPayload.routeControls = null;
            branchPayload.routeControlOwner = null;
          }
          const jumpResult = model.jumpQipuGame(qipuId, -1, false, 0, 1, 0);
          // The first page needs enough time to mount QQ's board controls.
          // Each remaining game is bounded independently so a full virtual
          // history is not silently dropped after an arbitrary batch deadline.
          const polls = current === 1 ? 60 : 12;
          try { raw = await waitForTarget(qipuId, beforeSignature, beforeOwner, [info, jumpResult], polls); } catch (_) { /* Retry the boundary state below. */ }
          if (!raw.text) {
            const settled = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const settledSignature = settled && settled.text ? `${settled.path}:${settled.type}:${settled.text}` : '';
            await new Promise(resolve => setTimeout(resolve, 100));
            const confirmed = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const confirmedSignature = confirmed && confirmed.text ? `${confirmed.path}:${confirmed.type}:${confirmed.text}` : '';
            if (settledSignature && settledSignature === confirmedSignature
              && acceptsTargetCandidate(confirmed, qipuId, beforeSignature, beforeOwner, { stableSignature: settledSignature })) raw = confirmed;
          }
          if (!raw.text) {
            const snapshot = bridgeSnapshot([info]);
            // Snapshot traversal takes long enough for some QQ records to
            // finish replacing getQipuMoveStep's loading object with the real
            // coordinate array. Re-read once before committing a false
            // missing diagnostic, while retaining the stale-game guard.
            const settledAfterSnapshot = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const snapshotSignature = settledAfterSnapshot && settledAfterSnapshot.text
              ? `${settledAfterSnapshot.path}:${settledAfterSnapshot.type}:${settledAfterSnapshot.text}` : '';
            await new Promise(resolve => setTimeout(resolve, 100));
            const confirmedAfterSnapshot = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const confirmedSnapshotSignature = confirmedAfterSnapshot && confirmedAfterSnapshot.text
              ? `${confirmedAfterSnapshot.path}:${confirmedAfterSnapshot.type}:${confirmedAfterSnapshot.text}` : '';
            if (snapshotSignature && snapshotSignature === confirmedSnapshotSignature
              && acceptsTargetCandidate(confirmedAfterSnapshot, qipuId, beforeSignature, beforeOwner, {
                stableSignature: snapshotSignature,
                coordinateSnapshot: snapshotHasCoordinateCandidate(snapshot),
              })) {
              raw = confirmedAfterSnapshot;
            } else {
              raw = {
                text: snapshot || '[网页未发现走法字段；未找到棋谱详情对象]',
                path: snapshot ? 'bridge-snapshot' : '未发现走法字段',
                type: 'missing',
                length: snapshot.length,
                score: 0,
              };
            }
          }
          if (typeof invoke === 'function') {
            await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'metadata' });
          }
          const moves = raw.text ? (raw.text.match(/[a-i][0-9][a-i][0-9]/gi) || []).map(move => move.toLowerCase()) : [];
          // Tencent keeps the visible detail fields under version-dependent model
          // objects. Read only approved scalar names from a bounded graph; never
          // serialize the graph, HTML, credentials, or page data.
          const metadata = [
            info,
            raw.owner,
            ...(typeof boardControls === 'function' ? boardControls() : []),
            model && model.currentQipu,
            model && model._qipuData,
            model && model._qipuInfo,
            model && model._qipuView,
          ].filter(Boolean);
          // A display-control title such as Panel_BoardContainer can appear
          // before the actual game title under the same field name. Keep a
          // small ordered candidate set instead of letting that first value
          // permanently mask the useful one.
          const scalarFields = new Map();
          const wantedField = /^(?:title|name|qipuName|qipuTitle|qipuTitleName|qipuGameName|gameName|sTitle|szQipuName|getToWallQipuName|red|redName|redPlayer|redNick|redUserName|redPlayerName|redUserNick|sRedName|szRedName|black|blackName|blackPlayer|blackNick|blackUserName|blackPlayerName|blackUserNick|sBlackName|szBlackName|event|eventName|competition|competitionName|matchName|sEventName|szEventName|site|location|platform|date|gameDate|gameDateTime|createdDate|createTime|sCreateTime|result|gameResult|resultText|resultDesc|winLose|winner|winSide|round|roundNo|roundNumber|roundName|gameRound|iRound|stage|playedAt|gameTime|startTime|createdAt|duration|gameDuration|durationText|elapsedTime|usedTime|totalTime|iTime|timeControl|timeRule|clockRule|gameRule|ruleName|playRule)$/i;
          const seenMetadata = new WeakSet(); let metadataNodes = 0;
          const metadataDeadline = Date.now() + 250;
          const collectMetadata = (value, depth = 0) => {
            if (!value || depth > 4 || metadataNodes >= 1800 || Date.now() >= metadataDeadline || typeof value !== 'object') return;
            if (seenMetadata.has(value)) return; seenMetadata.add(value); metadataNodes += 1;
            for (const key of propertyNames(value).slice(0, 100)) {
              if (Date.now() >= metadataDeadline) break;
              let child; try { child = value[key]; } catch (_) { continue; }
              if (wantedField.test(key) && (typeof child === 'string' || typeof child === 'number')) {
                const text = String(child).trim();
                const normalizedKey = key.toLowerCase();
                const values = scalarFields.get(normalizedKey) || [];
                if (text && text.length <= 240 && !values.includes(text) && values.length < 8) {
                  values.push(text); scalarFields.set(normalizedKey, values);
                }
              }
              if (child && typeof child === 'object' && /(?:qipu|game|match|player|detail|info|data|model|board|body|title|tittle|battle|user|profile|avatar|^va$)/i.test(key)) collectMetadata(child, depth + 1);
              // Some QQ H5 revisions put the detail object into a JSON string.
              // Only parse bounded strings under known detail/data keys; the
              // parsed object is used in-memory for the approved scalar fields.
              if (typeof child === 'string' && child.length <= 16 * 1024 && /(?:qipu|game|match|player|detail|info|data|record)/i.test(key)) {
                try {
                  const parsed = JSON.parse(child);
                  if (parsed && typeof parsed === 'object') collectMetadata(parsed, depth + 1);
                } catch (_) { /* This field is ordinary text, not JSON. */ }
              }
            }
          };
          metadata.forEach(source => collectMetadata(source));
          const firstText = (...keys) => {
            for (const key of keys) {
              const texts = scalarFields.get(String(key).toLowerCase());
              if (texts && texts[0]) return texts[0];
            }
            return '';
          };
          const firstUsableTitle = (...keys) => {
            const internalTitle = value => /(?:^Panel_|^preLink|<PrefabLink>|QipuChessBoardControl|ChessBoard(?:Mark|Control|Container))/i.test(value);
            for (const key of keys) {
              const texts = scalarFields.get(String(key).toLowerCase()) || [];
              const text = texts.find(value => !internalTitle(value));
              if (text) return text;
            }
            return '';
          };
          const semanticDetailFields = () => {
            const fields = { title: '', event: '', date: '', site: '', red: '', black: '', result: '', round: '' };
            const labels = {
              title: ['标题'], event: ['场次', '赛事'], date: ['日期'], site: ['地点'],
              red: ['红方'], black: ['黑方'], result: ['结果'], round: ['回合'],
            };
            const acceptText = (candidate) => {
              if (typeof candidate !== 'string' && typeof candidate !== 'number') return;
              const text = String(candidate).trim();
              if (!text || text.length > 240 || /(?:<PrefabLink>|^preLink|^Panel_|QipuChessBoardControl)/i.test(text)) return;
              for (const [field, fieldLabels] of Object.entries(labels)) {
                for (const label of fieldLabels) {
                  const match = text.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
                  if (match && match[1].trim() && !fields[field]) fields[field] = match[1].trim();
                }
              }
              if (!fields.title && /(?:[一二三四五六七八九十百千万\d]+轮|布局|开局|中局|残局|顺炮|列炮|飞相|屏风马|反宫马|横车|直车|过宫炮|士角炮|仙人指路|起马|巡河炮|急进中兵|创建于\s*20\d{2})/.test(text)) fields.title = text;
              // Full QQ titles are generated as player/rank + result + rank +
              // move count, for example 放飞[业9-2]先和[业9-2],29回合.
              if (/(?:先胜|先负|先和|后胜|后负|后和)/.test(text) && /[,，]?\d+\s*回合/.test(text)) fields.title = text;
              const heading = text.match(/^(.+?)\s+(先胜|先负|先和|后胜|后负|后和)\s*\(\s*\d+\s*\/\s*(\d+)\s*\)$/);
              if (heading) {
                if (!fields.title) fields.title = `${heading[1]} ${heading[2]}（${heading[3]} 半回合）`;
                if (!fields.red) fields.red = heading[1].trim();
                if (!fields.result) fields.result = heading[2];
                if (!fields.round) fields.round = `${Math.ceil(Number(heading[3]) / 2)} 回合`;
              }
              if (!fields.date && /^20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)) fields.date = text;
              if (!fields.site && text === '天天象棋') fields.site = text;
            };
            const seen = new WeakSet();
            // The traversal stack is LIFO. Put the global FDK root first so
            // current detail roots are popped and searched before the broad
            // application graph.
            const stack = [window.fdk, ...detailDisplayRoots()].filter(Boolean).map(value => ({ value, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 350;
            while (stack.length && visited < 40_000 && Date.now() < traversalDeadline) {
              const { value, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 16) continue;
              seen.add(value); visited += 1;
              for (const key of propertyNames(value).slice(0, 140)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (typeof child === 'string' || typeof child === 'number') {
                    if (/^(?:sTitle|qipuName|qipuTitle|gameName)$/i.test(key)) {
                      const text = String(child).trim();
                      if (text && text.length <= 240 && !fields.title) fields.title = text;
                    }
                    if (/^(?:iRound|round|gameRound)$/i.test(key)) {
                      const text = String(child).trim();
                      if (/^\d+$/.test(text) && !fields.round) fields.round = `${text} 回合`;
                    }
                    acceptText(child);
                  }
                  else if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
                } catch (_) { /* Ignore transient FDK getters. */ }
              }
              if (fields.title && fields.event && fields.date && fields.red && fields.result) break;
            }
            return fields;
          };
          // QQ's detail panel is the user-facing source of truth. Its backing
          // model often exposes Unity control names instead of the title shown
          // in the page, so read only its small labelled text segment.
          const visibleDetailFields = () => {
            const body = document.body;
            // Some QQ H5 releases update textContent before innerText. Combine
            // the two render projections locally, then retain only labelled
            // scalar values below; neither representation is sent to the app.
            const pageText = [body && body.innerText, body && body.textContent]
              .filter(Boolean).join('\n').replace(/\r/g, '');
            const panelStart = pageText.indexOf('棋谱属性');
            const panel = panelStart >= 0 ? pageText.slice(panelStart, panelStart + 2_400) : '';
            const field = (...labels) => {
              for (const label of labels) {
                const sameLine = panel.match(new RegExp(`(?:^|\\n)${label}\\s*[:：]\\s*([^\\n]+)`, 'm'));
                const nextLine = panel.match(new RegExp(`(?:^|\\n)${label}\\s*[:：]?\\s*\\n\\s*([^\\n]+)`, 'm'));
                const value = (sameLine && sameLine[1] || nextLine && nextLine[1] || '').trim();
                if (value && value.length <= 240) return value;
              }
              return '';
            };
            return {
              title: field('标题'),
              event: field('场次', '赛事'),
              date: field('日期'),
              site: field('地点'),
              red: field('红方'),
              black: field('黑方'),
              result: field('结果'),
            };
          };
          const displayObjectDetailFields = () => {
            // QQ renders the right property panel through its FDK display
            // objects, not consistently through DOM text. Walk only the
            // current detail/board roots, find the `棋谱属性` subtree, and keep
            // the neighbouring label values. No display-object graph or other
            // text is serialized back to the desktop app.
            const textOf = (value) => {
              if (!value || typeof value !== 'object') return '';
              for (const key of ['text', '_text', 'value', '_value', 'label', '_label']) {
                try {
                  const candidate = value[key];
                  if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim().length <= 240) return String(candidate).trim();
                } catch (_) { /* Display objects can have transient getters. */ }
              }
              return '';
            };
            const childValues = (value) => {
              const children = [];
              for (const key of propertyNames(value).slice(0, 140)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (child && typeof child === 'object') children.push(child);
                } catch (_) { /* Ignore inaccessible FDK properties. */ }
              }
              return children;
            };
            const emptyFields = () => ({ title: '', event: '', date: '', site: '', red: '', black: '', result: '' });
            const fieldsFromTexts = (detailTexts) => {
              const find = (...labels) => {
                for (let index = 0; index < detailTexts.length; index += 1) {
                const current = detailTexts[index];
                for (const label of labels) {
                  const inline = current.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
                  if (inline && inline[1].trim()) return inline[1].trim();
                  if (new RegExp(`^${label}\\s*[:：]?$`).test(current)) {
                    const next = detailTexts.slice(index + 1, index + 5)
                      .find(value => value && !/^(?:标题|场次|赛事|日期|地点|红方|黑方|结果)\s*[:：]?$/.test(value));
                    if (next) return next;
                  }
                }
              }
              return '';
              };
              return {
                title: find('标题'),
                event: find('场次', '赛事'),
                date: find('日期'),
                site: find('地点'),
                red: find('红方'),
                black: find('黑方'),
                result: find('结果'),
              };
            };
            const subtreeTexts = (root, limit = 800) => {
              const texts = [];
              const seen = new WeakSet();
              const stack = [root];
              let visited = 0;
              while (stack.length && visited < limit) {
                const value = stack.pop();
                if (!value || typeof value !== 'object' || seen.has(value)) continue;
                seen.add(value); visited += 1;
                const text = textOf(value);
                if (text) texts.push(text);
                for (const child of childValues(value)) stack.push(child);
              }
              return texts;
            };
            // The board control is the fast path. The FDK root is necessary for
            // current QQ builds where the right-side property panel is a sibling
            // of the board rather than a child of it.
            // The stack below is LIFO: keep the broad FDK graph as the final
            // fallback after the current board/detail roots.
            const roots = [window.fdk, ...detailDisplayRoots()]
              .filter(Boolean);
            const seen = new WeakSet();
            const stack = roots.map(value => ({ value, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 350;
            while (stack.length && visited < 40_000 && Date.now() < traversalDeadline) {
              const { value, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 16) continue;
              seen.add(value); visited += 1;
              const text = textOf(value);
              if (text === '棋谱属性' || text === '棋谱属性：') {
                let panel = value;
                for (let level = 0; panel && level < 7; level += 1) {
                  const fields = fieldsFromTexts(subtreeTexts(panel));
                  if (fields.title || fields.red || fields.event) return fields;
                  try { panel = panel.parent || panel._parent; } catch (_) { panel = null; }
                }
              }
              for (const child of childValues(value)) stack.push({ value: child, depth: depth + 1 });
            }
            return emptyFields();
          };
          const metadataProbe = () => {
            const samples = [];
            const seen = new WeakSet();
            const stack = detailDisplayRoots().map((value, index) => ({ value, path: `detailRoot[${index}]`, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 250;
            const usefulKey = /(?:text|label|value|title|name|qipu|red|black|result|event|date|round|site)/i;
            const usefulText = /(?:标题|场次|赛事|日期|地点|红方|黑方|结果|回合|先胜|先负|先和|后胜|后负|后和|天天象棋|^20\d{2}[\/-])/;
            while (stack.length && visited < 8_000 && samples.length < 80 && Date.now() < traversalDeadline) {
              const { value, path, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) continue;
              seen.add(value); visited += 1;
              for (const key of propertyNames(value).slice(0, 120)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (typeof child === 'string' || typeof child === 'number') {
                    const text = String(child).trim();
                    if (text && text.length <= 240 && (usefulKey.test(key) || usefulText.test(text))) {
                      samples.push(`${path}.${key}=${text}`);
                    }
                  } else if (child && typeof child === 'object') {
                    stack.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
                  }
                } catch (_) { /* Ignore transient display-object getters. */ }
              }
            }
            return samples.join('\n').slice(0, 8 * 1024);
          };
          const displayDate = (value) => {
            if (!/^\d{10,13}$/.test(value)) return value;
            const epoch = Number(value) * (value.length === 10 ? 1000 : 1);
            const date = new Date(epoch);
            if (!Number.isFinite(epoch) || date.getFullYear() < 2000 || date.getFullYear() > 2100) return value;
            const two = part => String(part).padStart(2, '0');
            return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
          };
          const mergeDetailFields = (...sources) => {
            const keys = new Set(sources.flatMap(source => Object.keys(source || {})));
            return Object.fromEntries([...keys].map(key => [key, sources.find(source => source && source[key])?.[key] || '']));
          };
          const detailFields = () => {
            const dom = visibleDetailFields();
            if (dom.title || dom.red || dom.black || dom.event) return dom;
            const display = displayObjectDetailFields();
            const semantic = semanticDetailFields();
            return mergeDetailFields(display, dom, semantic);
          };
          let visible = detailFields();
          // The board control reaches getQipuMoveStep before QQ paints the
          // right-hand property panel. Give that panel a short bounded chance
          // to settle, otherwise a valid game incorrectly falls back to its id.
          for (let detailPoll = 0; detailPoll < 10 && !visible.title && !visible.red && !visible.event; detailPoll += 1) {
            await delay(150);
            visible = mergeDetailFields(visibleDetailFields(), visible);
          }
          if (!visible.title && !visible.red && !visible.event) {
            visible = mergeDetailFields(detailFields(), visible);
          }
          if (typeof invoke === 'function') {
            await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'branches' });
          }
          const passiveBranch = branchPayload(raw.owner || null);
          const branch = await readBranchRoutes(qipuId, raw, passiveBranch, beforeBranchSignature);
          const rawResult = firstText('result', 'gameResult', 'resultText', 'resultDesc', 'winLose', 'winner', 'winSide') || visible.result;
          const normalizedResult = /和/.test(rawResult) ? '1/2-1/2'
            : /(?:先胜|红胜|后负)/.test(rawResult) ? '1-0'
            : /(?:后胜|黑胜|先负)/.test(rawResult) ? '0-1' : rawResult;
          games.push({
            qipuId,
            title: firstUsableTitle('sTitle', 'title', 'qipuName', 'qipuTitle', 'szQipuName', 'getToWallQipuName', 'gameName', 'name') || visible.title,
            startingFen: initialFen(),
            red: firstText('red', 'redName', 'redPlayer', 'redNick', 'redUserName', 'redPlayerName', 'sRedName', 'szRedName') || visible.red,
            black: firstText('black', 'blackName', 'blackPlayer', 'blackNick', 'blackUserName', 'blackPlayerName', 'sBlackName', 'szBlackName') || visible.black,
            event: firstText('event', 'eventName', 'competition', 'competitionName', 'matchName', 'sEventName', 'szEventName') || visible.event,
            site: firstText('site', 'location', 'platform') || visible.site || '天天象棋',
            date: displayDate(firstText('date', 'gameDate', 'createdDate') || visible.date),
            result: normalizedResult,
            note: rawResult && rawResult !== normalizedResult ? `天天象棋赛果：${rawResult}` : '',
            round: firstText('round', 'roundNo', 'roundNumber', 'roundName', 'gameRound', 'iRound', 'stage') || visible.round,
            playedAt: displayDate(firstText('playedAt', 'gameTime', 'startTime', 'createdAt', 'gameDateTime', 'createTime', 'sCreateTime') || visible.date),
            duration: firstText('duration', 'gameDuration', 'durationText', 'elapsedTime', 'usedTime', 'totalTime', 'iTime'),
            timeControl: firstText('timeControl', 'timeRule', 'clockRule', 'gameRule', 'ruleName', 'playRule'),
            moves,
            rawMoves: raw.text.slice(0, 32 * 1024),
            rawMovePath: raw.path,
            rawMoveType: raw.type,
            rawMoveLength: raw.length,
            branchData: branch.data,
            branchPath: branch.path,
            branchComplete: branch.complete,
            metadataProbe: visible.title ? '' : metadataProbe(),
          });
        } catch (error) {
          failed += 1;
          failures.push(`第 ${current} 盘：${String(error && error.message || error)}`);
        } finally {
          completed += 1;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'reading' });
        }
      }
      if (!games.length) throw new Error(`未读取到有效棋谱${failures.length ? `；${failures.slice(0, 3).join('；')}` : ''}`);
      await invoke('submit_ttxq_bridge_payload', { attemptId: __TTXQ_ATTEMPT_ID__, payload: { version: 1, games } });
    })().catch(async error => {
      const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (invoke) await invoke('report_ttxq_bridge_error', { attemptId: __TTXQ_ATTEMPT_ID__, message: String(error && error.message || error) });
    })"#
        .replace("__TTXQ_ATTEMPT_ID__", &attempt_id.to_string());
    if let Err(error) = window.eval(&collector_script) {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        set_read_error(
            &mut sync,
            attempt_id,
            &format!("无法启动天天象棋采集器：{error}"),
        );
        return Err(format!("无法启动天天象棋采集器：{error}"));
    }

    let watchdog_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BRIDGE_HANDSHAKE_TIMEOUT).await;
        let state = watchdog_app.state::<DesktopState>();
        if let Ok(mut sync) = state.ttxq_sync.lock() {
            fail_unacknowledged_bridge(&mut sync, attempt_id, &current_host);
        }
    });
    let stall_watchdog_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let observed_revision = {
                let state = stall_watchdog_app.state::<DesktopState>();
                let Ok(sync) = state.ttxq_sync.lock() else {
                    return;
                };
                if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
                    return;
                }
                sync.progress_revision
            };
            tokio::time::sleep(BRIDGE_PROGRESS_STALL_TIMEOUT).await;
            let state = stall_watchdog_app.state::<DesktopState>();
            let Ok(mut sync) = state.ttxq_sync.lock() else {
                return;
            };
            if fail_stalled_read(&mut sync, attempt_id, observed_revision) {
                return;
            }
            if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
                return;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn import_ttxq_history(
    target_folder: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<TtxqSyncProgressDto, String> {
    let payload = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?
        .payload
        .clone()
        .ok_or("尚未读取天天象棋历史棋谱")?;
    validate_payload(&payload)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let target_folder = normalize_ttxq_target_folder(target_folder)?;
    let active_game_id = model.game_id;
    let mut progress = TtxqSyncProgressDto {
        state: "importing".into(),
        loaded: payload.games.len(),
        message: "正在导入天天象棋棋谱".into(),
        ..TtxqSyncProgressDto::default()
    };
    let import_result = (|| -> Result<(), String> {
        for (source_order, game) in payload.games.iter().enumerate() {
            progress.completed += 1;
            let mut imported_record = game.clone();
            let starting_fen = if imported_record.starting_fen.trim().is_empty() {
                STARTING_FEN.to_owned()
            } else {
                imported_record.starting_fen.trim().to_owned()
            };
            imported_record = match prepare_import_record(&imported_record, &starting_fen) {
                Ok(record) => record,
                Err(_) => {
                    progress.failed += 1;
                    continue;
                }
            };
            let hash = payload_hash(&imported_record)?;
            if let Some(existing) = model
                .store
                .external_game_import("ttxq", &game.qipu_id)
                .map_err(|error| error.to_string())?
            {
                model
                    .store
                    .set_game_source(
                        existing.game_id,
                        Some(&ordered_source_path(&game.qipu_id, source_order)),
                        Some("ttxq-h5"),
                    )
                    .map_err(|error| error.to_string())?;
                if existing.payload_hash == hash {
                    let (updated, added_variations) = if let Some(previous) = model
                        .store
                        .load_game(existing.game_id)
                        .map_err(|error| error.to_string())?
                    {
                        (
                            backfill_existing_game(&mut model, &previous, &imported_record)?,
                            append_ttxq_variations_to_existing(
                                &mut model,
                                &previous,
                                &imported_record,
                            )?,
                        )
                    } else {
                        (false, 0)
                    };
                    if updated || added_variations > 0 {
                        progress.imported += 1;
                    } else {
                        progress.skipped += 1;
                    }
                    if let Some(previous) = model
                        .store
                        .load_game(existing.game_id)
                        .map_err(|error| error.to_string())?
                    {
                        if previous.library_folder.as_deref() != Some(target_folder.as_str()) {
                            let payload =
                                library_metadata_payload(&previous, Some(target_folder.clone()));
                            let operation = next_operation_for_game(
                                &mut model,
                                existing.game_id,
                                OperationKind::UpdateGameMetadata,
                                serde_json::to_value(payload).map_err(|error| error.to_string())?,
                            );
                            model
                                .store
                                .update_game_library_with_operation(
                                    existing.game_id,
                                    Some(&target_folder),
                                    previous.favorite,
                                    &previous.tags,
                                    &operation,
                                )
                                .map_err(|error| error.to_string())?;
                        }
                    }
                    continue;
                }
                if let Some(previous) = model
                    .store
                    .load_game(existing.game_id)
                    .map_err(|error| error.to_string())?
                {
                    if same_persisted_mainline(&model, &previous, &imported_record.moves)? {
                        let metadata_updated =
                            backfill_existing_game(&mut model, &previous, &imported_record)?;
                        let added_variations = append_ttxq_variations_to_existing(
                            &mut model,
                            &previous,
                            &imported_record,
                        )?;
                        if previous.library_folder.as_deref() != Some(target_folder.as_str()) {
                            let payload =
                                library_metadata_payload(&previous, Some(target_folder.clone()));
                            let operation = next_operation_for_game(
                                &mut model,
                                previous.id,
                                OperationKind::UpdateGameMetadata,
                                serde_json::to_value(payload).map_err(|error| error.to_string())?,
                            );
                            model
                                .store
                                .update_game_library_with_operation(
                                    previous.id,
                                    Some(&target_folder),
                                    previous.favorite,
                                    &previous.tags,
                                    &operation,
                                )
                                .map_err(|error| error.to_string())?;
                        }
                        model
                            .store
                            .record_external_game_import(
                                "ttxq",
                                &game.qipu_id,
                                previous.id,
                                &hash,
                                &Utc::now().to_rfc3339(),
                            )
                            .map_err(|error| error.to_string())?;
                        if metadata_updated || added_variations > 0 {
                            progress.imported += 1;
                        } else {
                            progress.skipped += 1;
                        }
                        continue;
                    }
                }
                let base_title = if game.title.trim().is_empty() {
                    format!("天天象棋 {}", game.qipu_id)
                } else {
                    game.title.clone()
                };
                imported_record.title = format!(
                    "{} · 修订 {}",
                    base_title,
                    Utc::now().format("%Y-%m-%d %H:%M")
                );
            }
            let imported_at = Utc::now().to_rfc3339();
            match import_game(
                &mut model,
                &imported_record,
                &hash,
                &imported_at,
                source_order,
                &target_folder,
            ) {
                Ok(game_id) => {
                    model
                        .store
                        .record_external_game_import(
                            "ttxq",
                            &game.qipu_id,
                            game_id,
                            &hash,
                            &imported_at,
                        )
                        .map_err(|error| error.to_string())?;
                    progress.imported += 1;
                }
                Err(_) => progress.failed += 1,
            }
        }
        Ok(())
    })();
    // Always restore and reload the review workspace, including after a
    // partially persisted batch fails before reaching the final game.
    finish_ttxq_import_attempt(&mut model, active_game_id, import_result)?;
    progress.state = if progress.failed == 0 {
        "complete".into()
    } else {
        "partial".into()
    };
    progress.message = format!(
        "导入 {} 盘，跳过 {} 盘，失败 {} 盘",
        progress.imported, progress.skipped, progress.failed
    );
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    sync.progress = progress.clone();
    Ok(progress)
}

fn insert_ttxq_variation(
    document: &mut ManualDocument,
    starting_fen: &str,
    mainline: &[String],
    mainline_parents: &[Uuid],
    variation: &TtxqVariationDto,
) -> Result<(), String> {
    if variation.after_ply > mainline.len() {
        return Err("变招位置超出主线".into());
    }
    let mut board = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    for raw_move in mainline.iter().take(variation.after_ply) {
        board = board
            .apply_move(Move::from_iccs(raw_move).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    }
    let parent = *mainline_parents
        .get(variation.after_ply)
        .ok_or("变招位置超出主线")?;
    insert_ttxq_variation_tail(document, board, parent, variation)
}

fn insert_ttxq_variation_tail(
    document: &mut ManualDocument,
    mut board: Board,
    parent: Uuid,
    variation: &TtxqVariationDto,
) -> Result<(), String> {
    if variation.moves.len() > MAX_MOVES_PER_GAME {
        return Err("变招着法数量异常".into());
    }
    let mut parent_ids = vec![parent];
    let mut boards = vec![board.clone()];
    let mut current_parent = parent;
    let route_comment = variation.route_no.map(|route_no| {
        let label = format!("天天象棋路线 {route_no}");
        let comment = variation.comment.trim();
        if comment.is_empty() || comment.contains(&label) {
            if comment.is_empty() {
                label
            } else {
                comment.to_owned()
            }
        } else {
            format!("{label}\n{comment}")
        }
    });
    for (index, raw_move) in variation.moves.iter().enumerate() {
        let mv = Move::from_iccs(raw_move).map_err(|error| error.to_string())?;
        board = board.apply_move(mv).map_err(|error| error.to_string())?;
        let comment = if index == 0 {
            route_comment
                .as_deref()
                .unwrap_or(variation.comment.as_str())
        } else {
            ""
        };
        current_parent = document
            .tree
            .add_move(current_parent, mv, comment)
            .map_err(|error| error.to_string())?;
        parent_ids.push(current_parent);
        boards.push(board.clone());
    }
    for child in &variation.children {
        let child_parent = *parent_ids
            .get(child.after_ply)
            .ok_or("子变招位置超出父分支")?;
        let child_board = boards
            .get(child.after_ply)
            .cloned()
            .ok_or("子变招局面超出父分支")?;
        insert_ttxq_variation_tail(document, child_board, child_parent, child)?;
    }
    Ok(())
}

fn import_game(
    model: &mut AppModel,
    record: &TtxqGameRecordDto,
    payload_hash: &str,
    imported_at: &str,
    source_order: usize,
    target_folder: &str,
) -> Result<Uuid, String> {
    let mut record = record.clone();
    let starting_fen = if record.starting_fen.trim().is_empty() {
        STARTING_FEN.to_owned()
    } else {
        record.starting_fen.trim().to_owned()
    };
    record.moves = resolved_moves(&record, &starting_fen)?;
    if record.moves.len() > MAX_MOVES_PER_GAME {
        return Err(format!("棋谱 {} 的着法数量异常", record.qipu_id));
    }
    let mut document = ManualDocument::new(&starting_fen).map_err(|error| error.to_string())?;
    document.metadata = ManualMetadata {
        title: ttxq_title(&record),
        event: record.event.clone(),
        site: record.site.clone(),
        date: record.date.clone(),
        red: record.red.clone(),
        black: record.black.clone(),
        result: if record.result.trim().is_empty() {
            "*".into()
        } else {
            record.result.clone()
        },
        ..ManualMetadata::default()
    };
    document.note = source_note(&record);
    let mut board = Board::from_fen(&starting_fen).map_err(|error| error.to_string())?;
    let mut parents = vec![document.tree.root_id()];
    for raw_move in &record.moves {
        let mv = Move::from_iccs(raw_move).map_err(|error| error.to_string())?;
        board = board
            .apply_move(mv)
            .map_err(|error| format!("{}: {error}", record.qipu_id))?;
        let parent = *parents.last().ok_or("棋谱树缺少根节点")?;
        parents.push(
            document
                .tree
                .add_move(parent, mv, "")
                .map_err(|error| error.to_string())?,
        );
    }
    for variation in &record.variations {
        insert_ttxq_variation(
            &mut document,
            &starting_fen,
            &record.moves,
            &parents,
            variation,
        )?;
    }
    let game_id = Uuid::new_v4();
    let root_id = document.tree.root_id();
    let nodes = collect_nodes(&document.tree)?;
    let mut operations = Vec::with_capacity(nodes.len() + 2);
    let now = Utc::now();
    model.lamport += 1;
    operations.push(Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
        kind: OperationKind::CreateGame,
        payload: serde_json::to_value(CreateGamePayload {
            title: document.metadata.title.clone(),
            fen: starting_fen.clone(),
            root_id,
            external_source: Some(ExternalGameSourcePayload {
                provider: "ttxq".into(),
                external_id: record.qipu_id.clone(),
                source_format: "ttxq-h5".into(),
                payload_hash: payload_hash.into(),
                imported_at: imported_at.into(),
            }),
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: now,
    });
    model.lamport += 1;
    operations.push(Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
        kind: OperationKind::UpdateGameMetadata,
        payload: serde_json::to_value(metadata_payload(&document.metadata, &document.note))
            .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: now,
    });
    for node in &nodes {
        model.lamport += 1;
        operations.push(Operation {
            op_id: Uuid::new_v4(),
            device_id: model.device_id,
            entity_id: node.id,
            game_id,
            kind: OperationKind::AddMove,
            payload: serde_json::to_value(AddMovePayload {
                node_id: node.id,
                parent_id: node.parent_id,
                move_iccs: node.mv.to_iccs(),
                order_key: node.order_key,
                is_mainline: node.is_mainline,
            })
            .map_err(|error| error.to_string())?,
            lamport: model.lamport,
            created_at: now,
        });
    }
    let metadata_json =
        serde_json::to_string(&document.metadata).map_err(|error| error.to_string())?;
    let source_path = ordered_source_path(&record.qipu_id, source_order);
    model
        .store
        .import_game_with_operations(
            ImportedGame {
                id: game_id,
                title: &document.metadata.title,
                starting_fen: &starting_fen,
                root_id,
                current_node_id: None,
                note: &document.note,
                source_path: Some(&source_path),
                source_format: Some("ttxq-h5"),
                playable: position_is_playable(
                    &Board::from_fen(&starting_fen).map_err(|error| error.to_string())?,
                ),
                metadata_json: &metadata_json,
            },
            &nodes,
            &operations,
        )
        .map_err(|error| error.to_string())?;
    model
        .store
        .create_library_folder(target_folder)
        .map_err(|error| error.to_string())?;
    model.lamport += 1;
    let library_operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: game_id,
        game_id,
        kind: OperationKind::UpdateGameMetadata,
        payload: serde_json::to_value(UpdateGameMetadataPayload {
            title: document.metadata.title.clone(),
            note: document.note.clone(),
            event: Some(document.metadata.event.clone()),
            site: Some(document.metadata.site.clone()),
            date: Some(document.metadata.date.clone()),
            red: Some(document.metadata.red.clone()),
            black: Some(document.metadata.black.clone()),
            result: Some(document.metadata.result.clone()),
            library_folder: Some(target_folder.into()),
            favorite: None,
            tags: None,
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport,
        created_at: Utc::now(),
    };
    model
        .store
        .update_game_library_with_operation(
            game_id,
            Some(target_folder),
            false,
            &[],
            &library_operation,
        )
        .map_err(|error| error.to_string())?;
    Ok(game_id)
}

#[tauri::command]
pub(crate) fn disconnect_ttxq(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TTXQ_WINDOW_LABEL) {
        window
            .clear_all_browsing_data()
            .map_err(|error| error.to_string())?;
        window.destroy().map_err(|error| error.to_string())?;
    }
    let mut sync = state
        .ttxq_sync
        .lock()
        .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
    *sync = TtxqSyncState::default();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn collector_source_between(start_marker: &str, end_marker: &str) -> String {
        let source = include_str!("ttxq_sync.rs");
        let start = source
            .find(start_marker)
            .expect("collector marker must exist");
        let end = source[start..]
            .find(end_marker)
            .expect("collector end marker must exist")
            + start;
        source[start..end].to_owned()
    }

    fn collector_candidate_guard_source() -> String {
        collector_source_between(
            "      const snapshotHasCoordinateCandidate = (snapshot) =>",
            "      const waitForTarget = async",
        )
    }

    fn collector_recovery_source(end_marker: &str) -> String {
        format!(
            "{}\n{}",
            collector_candidate_guard_source(),
            collector_source_between(
                "          let raw = { text: '', path: '', type: '', length: 0, score: 0 };",
                end_marker,
            )
        )
    }

    fn ttxq_record(qipu_id: &str) -> TtxqGameRecordDto {
        TtxqGameRecordDto {
            qipu_id: qipu_id.into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: Vec::new(),
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: Vec::new(),
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        }
    }

    fn test_app_model() -> AppModel {
        AppModel {
            board: Board::from_fen(STARTING_FEN).unwrap(),
            starting_fen: STARTING_FEN.into(),
            tree: xiangqi_manual::ManualTree::new(),
            current_node: None,
            game_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            lamport: 1,
            store: LocalStore::open_in_memory().unwrap(),
            metadata: ManualMetadata::default(),
            note: String::new(),
            source_path: None,
            source_format: None,
            playable: true,
        }
    }

    #[test]
    fn decodes_ttxq_branch_candidates_into_variations() {
        let mut record = ttxq_record("self-recorded-branch");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.moves = resolved_moves(&record, STARTING_FEN).unwrap();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [
                {
                    "path": "msg.variation1.move",
                    "raw": "7062",
                    "valueType": "string",
                    "afterPly": 1,
                    "comment": "绿色分支 1"
                }
            ]
        })
        .to_string();

        let prepared = prepare_import_record(&record, STARTING_FEN).unwrap();

        assert!(prepared.branch_complete);
        assert_eq!(prepared.variations.len(), 1);
        assert_eq!(prepared.variations[0].after_ply, 1);
        assert_eq!(prepared.variations[0].moves, ["h9g7"]);
        assert_eq!(prepared.variations[0].comment, "绿色分支 1");
    }

    #[test]
    fn decodes_ttxq_arrow_route_full_line_into_a_local_variation_tail() {
        let mut record = ttxq_record("self-recorded-arrow-route");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.moves = resolved_moves(&record, STARTING_FEN).unwrap();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "routeNumbers": [1, 2],
            "routesAttempted": [2],
            "candidates": [
                {
                    "path": "route[2].NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep",
                    "raw": "26257062",
                    "valueType": "array<number>",
                    "afterPly": null,
                    "comment": "天天象棋分支 2"
                }
            ]
        })
        .to_string();

        let prepared = prepare_import_record(&record, STARTING_FEN).unwrap();

        assert!(prepared.branch_complete);
        assert_eq!(prepared.variations.len(), 1);
        assert_eq!(prepared.variations[0].after_ply, 1);
        assert_eq!(prepared.variations[0].moves, ["h9g7"]);
        assert_eq!(prepared.variations[0].comment, "天天象棋分支 2");
    }

    #[test]
    fn detected_routes_require_every_alternative_before_import() {
        let mut record = ttxq_record("self-recorded-partial-routes");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "routeNumbers": [1, 2, 3, 4],
            "routesAttempted": [2, 3, 4],
            "candidates": [
                {
                    "routeNo": 2,
                    "path": "route[2].boardControl.branchData.rows[0].move",
                    "raw": "26257062",
                    "afterPly": null,
                    "comment": "天天象棋路线 2"
                }
            ]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("路线 3/4"), "unexpected error: {error}");
        assert!(error.contains("未完整解析"), "unexpected error: {error}");

        let preview = ttxq_game_preview(&record);
        assert!(!preview.valid);
        assert_eq!(preview.move_count, 2);
        assert_eq!(preview.route_count, 4);
        assert_eq!(preview.decoded_route_count, 2);
        assert_eq!(preview.variation_node_count, 1);
    }

    #[test]
    fn numeric_branch_keys_require_every_alternative_before_import() {
        let mut record = ttxq_record("self-recorded-numeric-route-keys");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "signals": [{
                "path": "boardControl[0].getMoveBranchKey",
                "value": {
                    "1": { "key": "main" },
                    "2": { "key": "green" },
                    "3": { "key": "blue" }
                }
            }],
            "candidates": [{
                "routeNo": 2,
                "path": "route[2].move",
                "raw": "26257062",
                "afterPly": null
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("路线 3"), "unexpected error: {error}");
        assert_eq!(expected_branch_routes(&record.branch_data), vec![2, 3]);
    }

    #[test]
    fn dhtml_branch_keys_build_nested_variations_instead_of_using_branch_id_as_ply() {
        let mut record = ttxq_record("self-recorded-nested-dhtml-branches");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.moves = resolved_moves(&record, STARTING_FEN).unwrap();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [
                {
                    "path": "boardControl[0].getMoveBranchKey.0-1-1",
                    "raw": "19271022",
                    "valueType": "string",
                    "afterPly": 1
                },
                {
                    "path": "boardControl[0].getMoveBranchKey.1-1-22",
                    "raw": "7274",
                    "valueType": "string",
                    "afterPly": 22
                }
            ]
        })
        .to_string();

        let prepared = prepare_import_record(&record, STARTING_FEN).unwrap();

        assert_eq!(prepared.variations.len(), 1);
        let root_branch = &prepared.variations[0];
        assert_eq!(root_branch.after_ply, 1);
        assert_eq!(root_branch.moves, ["b9c7", "b0c2"]);
        assert_eq!(root_branch.children.len(), 1);
        assert_eq!(root_branch.children[0].after_ply, 1);
        assert_eq!(root_branch.children[0].moves, ["h2h4"]);
    }

    #[test]
    fn dhtml_branch_key_never_searches_for_another_legal_anchor() {
        let mut record = ttxq_record("exact-dhtml-branch-anchor");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.moves = resolved_moves(&record, STARTING_FEN).unwrap();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-1-1",
                "raw": "7062",
                "valueType": "string",
                "afterPly": 1
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("第 1 半回合后首着 h0g2 非法"), "{error}");
        assert!(error.contains("原生 ICCS 坐标"), "{error}");
    }

    #[test]
    fn real_dhtml_branch_keys_preserve_parent_local_anchors() {
        assert!(dhtml_branch_key("msg.variation.0-11-1").is_none());
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-11-1"),
            Some(DhtmlBranchKey {
                parent_branch_id: 0,
                parent_ply: 11,
                branch_id: 1,
            })
        );
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-13-4"),
            Some(DhtmlBranchKey {
                parent_branch_id: 0,
                parent_ply: 13,
                branch_id: 4,
            })
        );
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-19-5"),
            Some(DhtmlBranchKey {
                parent_branch_id: 0,
                parent_ply: 19,
                branch_id: 5,
            })
        );
        let nested = dhtml_branch_key("boardControl[0].getMoveBranchKey.3-8-6").unwrap();
        let keys = HashMap::from([
            (
                3,
                DhtmlBranchKey {
                    parent_branch_id: 0,
                    parent_ply: 10,
                    branch_id: 3,
                },
            ),
            (6, nested),
        ]);
        assert_eq!(
            dhtml_branch_absolute_anchor(nested, &keys, &mut HashSet::new()),
            Some(18)
        );
    }

    #[test]
    fn branch_diagnostic_identifies_coordinate_mode_move_and_anchor_side() {
        let mut record = ttxq_record("branch-coordinate-diagnostic");
        record.starting_fen = STARTING_FEN.into();
        record.raw_moves = "26252042".into();
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-1-1",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();

        let sample: serde_json::Value =
            serde_json::from_str(&ttxq_branch_diagnostic_sample(&record, STARTING_FEN)).unwrap();

        assert_eq!(sample["startingFenPresent"], true);
        assert_eq!(sample["mainlineCoordinateSample"], "26252042");
        assert_eq!(
            sample["branches"][0]["coordinateMode"],
            "branch-native-iccs"
        );
        assert_eq!(sample["branches"][0]["decodedFirstMove"], "b9c7");
        assert_eq!(sample["branches"][0]["anchorPly"], 1);
        assert_eq!(sample["branches"][0]["anchorSide"], "black");
    }

    #[test]
    fn branch_diagnostic_uses_the_resolved_numeric_mainline() {
        let mut record = ttxq_record("resolved-mainline-branch-diagnostic");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-1-1",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();
        let resolved = resolved_moves(&record, STARTING_FEN).unwrap();

        assert!(record.moves.is_empty());
        assert!(ttxq_branch_decode_failure(&record, STARTING_FEN, Some(&resolved)).is_none());
    }

    #[test]
    fn branch_signal_without_decodable_moves_is_not_importable() {
        let mut record = ttxq_record("self-recorded-branch-diagnostic");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "signals": [
                {
                    "path": "boardControl[1].getMoveBranchKey",
                    "value": { "10": "green-branch" }
                }
            ],
            "candidates": []
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("为避免丢失变招"));
    }

    #[test]
    fn route_signal_without_moves_reports_arrow_navigation_diagnostic() {
        let mut record = ttxq_record("self-recorded-route-diagnostic");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "routeNumbers": [1, 2, 3, 4],
            "routesAttempted": [2, 3, 4],
            "routeFailures": [
                { "routeNo": 2, "reason": "未取得与主线不同的分支走法" },
                { "routeNo": 3, "reason": "未取得与主线不同的分支走法" }
            ],
            "candidates": []
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("发现 3 个分支导航"));
        assert!(error.contains("已尝试路线 2/3/4"));
    }

    #[test]
    fn decoded_ttxq_variations_are_written_as_recursive_sibling_branches() {
        let mainline = vec!["c3c4".to_owned(), "c9e7".to_owned()];
        let variation = TtxqVariationDto {
            after_ply: 1,
            moves: vec!["b9c7".into(), "b0c2".into()],
            route_no: None,
            source_key: String::new(),
            comment: "绿色分支 1".into(),
            children: vec![TtxqVariationDto {
                after_ply: 1,
                moves: vec!["h2h4".into()],
                route_no: None,
                source_key: String::new(),
                comment: "嵌套分支".into(),
                children: Vec::new(),
            }],
        };
        let mut document = ManualDocument::new(STARTING_FEN).unwrap();
        let mut board = Board::from_fen(STARTING_FEN).unwrap();
        let mut parents = vec![document.tree.root_id()];
        for raw_move in &mainline {
            let mv = Move::from_iccs(raw_move).unwrap();
            board = board.apply_move(mv).unwrap();
            let parent = *parents.last().unwrap();
            parents.push(document.tree.add_move(parent, mv, "").unwrap());
        }

        insert_ttxq_variation(&mut document, STARTING_FEN, &mainline, &parents, &variation)
            .unwrap();

        let branches = document.tree.branches(parents[1]).unwrap();
        assert_eq!(branches.len(), 2);
        assert!(branches
            .iter()
            .any(|node| node.is_mainline && node.mv.to_iccs() == "c9e7"));
        let branch_root = branches
            .iter()
            .find(|node| !node.is_mainline && node.mv.to_iccs() == "b9c7")
            .unwrap();
        assert_eq!(branch_root.comment, "绿色分支 1");
        let nested = document.tree.branches(branch_root.id).unwrap();
        assert!(nested.iter().any(|node| node.mv.to_iccs() == "b0c2"));
        assert!(nested
            .iter()
            .any(|node| node.mv.to_iccs() == "h2h4" && node.comment == "嵌套分支"));
    }

    #[test]
    fn reimporting_existing_ttxq_mainline_backfills_new_branch_nodes() {
        let mut model = test_app_model();
        let mut original = ttxq_record("self-recorded-existing");
        original.raw_moves = "26252042".into();
        original.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        original.raw_move_type = "array<number>".into();
        let imported_at = Utc::now().to_rfc3339();
        let game_id = import_game(
            &mut model,
            &original,
            "sha256:mainline",
            &imported_at,
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let preserved_node = model
            .store
            .load_move_nodes(game_id)
            .unwrap()
            .into_iter()
            .find(|node| node.is_mainline && node.mv.to_iccs() == "c3c4")
            .map(|node| node.id)
            .unwrap();
        model
            .store
            .set_current_node(game_id, Some(preserved_node))
            .unwrap();
        let previous = model.store.load_game(game_id).unwrap().unwrap();
        assert_eq!(
            model
                .store
                .load_move_nodes(game_id)
                .unwrap()
                .iter()
                .filter(|node| !node.deleted && !node.is_mainline)
                .count(),
            0
        );

        let mut reread = original.clone();
        reread.branch_complete = false;
        reread.branch_data = serde_json::json!({
            "candidates": [
                {
                    "path": "msg.variation1.move",
                    "raw": "7062",
                    "valueType": "string",
                    "afterPly": 1
                }
            ]
        })
        .to_string();
        let prepared = prepare_import_record(&reread, STARTING_FEN).unwrap();

        let added = append_ttxq_variations_to_existing(&mut model, &previous, &prepared).unwrap();

        assert_eq!(added, 1);
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        assert!(nodes
            .iter()
            .any(|node| !node.deleted && !node.is_mainline && node.mv.to_iccs() == "h9g7"));
        assert!(model
            .store
            .pending_operations(50)
            .unwrap()
            .iter()
            .any(|operation| {
                operation.kind == OperationKind::AddMove && operation.game_id == game_id
            }));
        assert_eq!(
            model
                .store
                .load_game(game_id)
                .unwrap()
                .unwrap()
                .current_node_id,
            Some(preserved_node)
        );

        let variation_id = nodes
            .iter()
            .find(|node| !node.deleted && !node.is_mainline && node.mv.to_iccs() == "h9g7")
            .map(|node| node.id)
            .unwrap();
        let comment_operation = next_operation_for_game(
            &mut model,
            game_id,
            OperationKind::UpdateComment,
            serde_json::to_value(UpdateCommentPayload {
                node_id: variation_id,
                comment: "用户复盘注释".into(),
            })
            .unwrap(),
        );
        model
            .store
            .update_comment_with_operation(variation_id, "用户复盘注释", &comment_operation)
            .unwrap();
        let refreshed = model.store.load_game(game_id).unwrap().unwrap();

        let added_again =
            append_ttxq_variations_to_existing(&mut model, &refreshed, &prepared).unwrap();

        assert_eq!(added_again, 0);
        let refreshed_nodes = model.store.load_move_nodes(game_id).unwrap();
        assert_eq!(
            refreshed_nodes
                .iter()
                .filter(|node| !node.deleted && !node.is_mainline)
                .count(),
            1
        );
        assert_eq!(
            refreshed_nodes
                .iter()
                .find(|node| node.id == variation_id)
                .unwrap()
                .comment,
            "用户复盘注释"
        );
    }

    #[test]
    fn reloading_active_game_after_ttxq_import_refreshes_tree_and_metadata_without_moving() {
        let mut model = test_app_model();
        let mut original = ttxq_record("self-recorded-active-refresh");
        original.raw_moves = "26252042".into();
        original.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        original.raw_move_type = "array<number>".into();
        let imported_at = Utc::now().to_rfc3339();
        let game_id = import_game(
            &mut model,
            &original,
            "sha256:active-mainline",
            &imported_at,
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let game = model.store.load_game(game_id).unwrap().unwrap();
        load_game_into_model(&mut model, game).unwrap();
        let original_title = model.metadata.title.clone();
        let preserved_node = model.tree.branches(model.tree.root_id()).unwrap()[0].id;
        model.current_node = Some(preserved_node);
        model
            .store
            .set_current_node(game_id, Some(preserved_node))
            .unwrap();

        let previous = model.store.load_game(game_id).unwrap().unwrap();
        let mut reread = original.clone();
        reread.title = "牛头滚后手".into();
        reread.branch_complete = false;
        reread.branch_data = serde_json::json!({
            "candidates": [{
                "path": "msg.variation1.move",
                "raw": "7062",
                "valueType": "string",
                "afterPly": 1
            }]
        })
        .to_string();
        let prepared = prepare_import_record(&reread, STARTING_FEN).unwrap();

        backfill_existing_game(&mut model, &previous, &prepared).unwrap();
        append_ttxq_variations_to_existing(&mut model, &previous, &prepared).unwrap();

        assert_eq!(model.metadata.title, original_title);
        assert_eq!(
            model
                .tree
                .branches(preserved_node)
                .unwrap()
                .iter()
                .filter(|node| !node.is_mainline)
                .count(),
            0
        );

        reload_active_game_after_ttxq_import(&mut model, game_id).unwrap();

        assert_eq!(model.current_node, Some(preserved_node));
        assert_eq!(model.metadata.title, "牛头滚后手");
        assert_eq!(
            model
                .tree
                .branches(preserved_node)
                .unwrap()
                .iter()
                .filter(|node| !node.is_mainline)
                .count(),
            1
        );
    }

    #[test]
    fn failed_ttxq_import_attempt_restores_the_previously_open_game() {
        let mut model = test_app_model();
        let mut active = ttxq_record("active-before-failed-import");
        active.raw_moves = "2625".into();
        active.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        active.raw_move_type = "array<number>".into();
        let active_game_id = import_game(
            &mut model,
            &active,
            "sha256:active-before-error",
            &Utc::now().to_rfc3339(),
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let active_game = model.store.load_game(active_game_id).unwrap().unwrap();
        load_game_into_model(&mut model, active_game).unwrap();
        let active_node = model.current_node;
        let mut imported = ttxq_record("temporary-import-before-error");
        imported.raw_moves = "2625".into();
        imported.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        imported.raw_move_type = "array<number>".into();
        let imported_game_id = import_game(
            &mut model,
            &imported,
            "sha256:temporary",
            &Utc::now().to_rfc3339(),
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        assert_eq!(
            model.store.active_game_id().unwrap(),
            Some(imported_game_id)
        );

        let error = finish_ttxq_import_attempt::<()>(
            &mut model,
            active_game_id,
            Err("模拟导入中途失败".into()),
        )
        .unwrap_err();

        assert_eq!(error, "模拟导入中途失败");
        assert_eq!(model.game_id, active_game_id);
        assert_eq!(model.current_node, active_node);
        assert_eq!(model.store.active_game_id().unwrap(), Some(active_game_id));
    }

    #[test]
    fn collector_reads_branch_data_from_later_board_controls() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const firstControl = {{ getMoveBranchKey: {{}} }};
const secondControl = {{
  getMoveBranchKey: {{ '10': 'green-branch' }},
  nested: {{
    msg: {{
      branches: [
        {{ afterPly: 1, move: '7062', comment: '局面分支 1' }},
      ],
    }},
  }},
}};
const model = {{}};
const boardControls = () => [firstControl, secondControl];
{branch_source}
const branch = branchPayload();
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1) {{
  throw new Error(`expected one branch candidate from the second board control, got ${{branch.data}}`);
}}
if (payload.candidates[0].raw !== '7062') {{
  throw new Error(`unexpected branch raw move: ${{payload.candidates[0].raw}}`);
}}
if (branch.complete) throw new Error('branch signal with candidates must be decoded by Rust, not marked complete in JS');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise branch extraction");
        child
            .stdin
            .as_mut()
            .expect("branch extraction checker stdin")
            .write_all(harness.as_bytes())
            .expect("write branch extraction harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run branch extraction harness");
        assert!(
            output.status.success(),
            "collector missed branch data from a later board control: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_does_not_treat_branch_renderer_properties_as_move_candidates() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const control = {{
  getMoveBranchKey: {{ '0-1-1': '7062' }},
  branchChooseComponent: {{
    normalColor: {{ _data: 214214214255 }},
    sprite: {{ uuid: 'a5d590e8-2570-43d7-9f8d-7b8f7e17e5c5@f9941' }},
    renderData: {{ vertexOffset: 7028 }},
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
const candidates = payload.candidates || [];
if (candidates.length !== 1) {{
  throw new Error(`renderer properties polluted branch candidates: ${{JSON.stringify(candidates)}}`);
}}
if (candidates[0].path !== 'boardControl[0].getMoveBranchKey.0-1-1' || candidates[0].raw !== '7062') {{
  throw new Error(`direct DhtmlXQ branch key was not preserved: ${{JSON.stringify(candidates)}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise branch renderer filtering");
        child
            .stdin
            .as_mut()
            .expect("branch renderer checker stdin")
            .write_all(harness.as_bytes())
            .expect("write branch renderer harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run branch renderer harness");
        assert!(
            output.status.success(),
            "collector accepted branch renderer properties as moves: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_branch_scan_is_time_bounded() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
let clock = 0;
const Date = {{ now: () => (clock += 10) }};
let propertyReads = 0;
const propertyNames = value => {{ propertyReads += 1; return Object.getOwnPropertyNames(value); }};
const stringifyMoveValue = value => ({{ status: 'ok', text: String(value), length: String(value).length }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property, limit = 8_000) => {{
  const stack = [root]; const seen = new WeakSet(); let visited = 0;
  while (stack.length && visited < limit) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); visited += 1;
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const key of propertyNames(value)) {{
      const child = value[key];
      if (child && typeof child === 'object') stack.push(child);
    }}
  }}
  return null;
}};
const control = {{ getMoveBranchKey: {{}} }};
const detailRoot = {{ board: control }};
for (let outer = 0; outer < 24; outer += 1) {{
  const group = {{}};
  for (let inner = 0; inner < 24; inner += 1) group[`data${{inner}}`] = {{ value: inner }};
  detailRoot[`group${{outer}}`] = group;
}}
const model = {{}};
const boardControls = () => [control];
const detailDisplayRoots = () => [detailRoot];
{branch_source}
const branch = branchPayload(control);
if (branch.complete !== false || !branch.path.includes('scan-timeout')) {{
  throw new Error(`exhausted branch scan was reported as complete: ${{JSON.stringify(branch)}}`);
}}
if (propertyReads > 1_200) throw new Error(`branch scan exceeded its read budget: ${{propertyReads}}`);
}})();
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise branch traversal bounds");
        assert!(
            output.status.success(),
            "collector branch traversal exceeded its budget: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_reference_exporter_msg_container_siblings() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const branchContainer = {{
  markerRows: [{{ msg: {{ current: 'branch-tab-visible' }} }}],
  branchRows: [{{ afterPly: 1, move: '7062', comment: '父容器同级分支' }}],
}};
const control = {{
  getMoveBranchKey: {{ '10': 'green-branch' }},
  holder: {{ branchContainer }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload();
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1) {{
  throw new Error(`expected one branch candidate from msg container siblings, got ${{branch.data}}`);
}}
if (payload.candidates[0].raw !== '7062') {{
  throw new Error(`unexpected branch raw move: ${{payload.candidates[0].raw}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise reference exporter branch shape");
        child
            .stdin
            .as_mut()
            .expect("reference branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write reference branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run reference branch harness");
        assert!(
            output.status.success(),
            "collector missed sibling branch data from the msg container: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_obfuscated_move_fields_inside_reference_msg_container() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const referenceContainer = {{
  a: [{{ msg: '路线 2' }}],
  b: [{{ afterPly: 1, x: '7062' }}],
}};
const control = {{
  getMoveBranchKey: {{ '10': {{ routeNo: 2 }} }},
  holder: {{ referenceContainer }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1) {{
  throw new Error(`expected an obfuscated branch move from the reference msg parent, got ${{branch.data}}`);
}}
if (payload.candidates[0].raw !== '7062' || payload.candidates[0].afterPly !== 1) {{
  throw new Error(`unexpected obfuscated branch candidate: ${{JSON.stringify(payload.candidates[0])}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise obfuscated branch fields");
        child
            .stdin
            .as_mut()
            .expect("obfuscated branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write obfuscated branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run obfuscated branch collection harness");
        assert!(
            output.status.success(),
            "collector filtered a move stored under an ordinary Tencent field name: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_does_not_treat_comment_only_msg_rows_as_missing_branches() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const control = {{
  getMoveBranchKey: {{ '10': {{ routeNo: 1 }} }},
  comments: {{
    '6-1': [
      {{
        msg: '软件推荐：炮二平五 马8进7',
        content: {{ text: '车一进一' }},
        time: '24-09-05 13:24',
        uUin: 48477741,
        uname: 'Zero',
      }},
    ],
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload();
const payload = JSON.parse(branch.data);
if (payload.candidates.length) throw new Error(`nested comment text was treated as a branch move: ${{branch.data}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise comment-only msg rows");
        child
            .stdin
            .as_mut()
            .expect("comment-only msg checker stdin")
            .write_all(harness.as_bytes())
            .expect("write comment-only msg harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run comment-only msg harness");
        assert!(
            output.status.success(),
            "collector misclassified comment-only msg rows as branches: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_global_detail_branches_after_binding_the_target_control() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = () => null;
const targetControl = {{}};
const staleRoutePanel = {{
  context: {{ text: '下变' }},
  routeOne: {{ text: '1', click() {{}} }},
  routeTwo: {{ text: '2', click() {{}} }},
}};
const model = {{ _qipuView: {{ getMoveBranchKey: {{ stale: '7062' }} }} }};
const boardControls = () => [targetControl, staleRoutePanel];
const sharedDetailRoot = {{ activeBoardControl: targetControl, staleRoutePanel }};
const detailDisplayRoots = () => [sharedDetailRoot];
{branch_source}
const branch = branchPayload(targetControl);
if (!branch.complete || branch.data) {{
  throw new Error(`global stale detail or route controls leaked into the target control: ${{branch.data}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise target-bound branch collection");
        child
            .stdin
            .as_mut()
            .expect("target-bound branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write target-bound branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run target-bound branch collection harness");
        assert!(
            output.status.success(),
            "collector mixed a global detail root into the target game: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_waits_for_branch_structures_that_settle_after_mainline() {
        let branch_and_route_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const qipuId = '77610272440';
let branchPolls = 0;
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const control = {{
  get getMoveBranchKey() {{ return branchPolls >= 2 ? {{ anchor: '10' }} : {{}}; }},
  get branchData() {{
    return branchPolls >= 2
      ? {{ rows: [{{ afterPly: 1, move: '7062', comment: '延迟安装的分支' }}] }}
      : {{}};
  }},
}};
const model = {{ jumpQipuGame: () => undefined }};
const boardControls = () => [control];
const detailDisplayRoots = () => [];
const delay = async () => {{ branchPolls += 1; }};
const qipuSources = () => [{{ qipuId }}];
const mainRaw = {{
  text: '26252042',
  path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep',
  type: 'array<number>',
  owner: control,
}};
const directNotifyMove = () => mainRaw;
const directModelMove = () => null;
const readRawMoves = () => mainRaw;
{branch_and_route_source}
const early = branchPayload();
if (!early.complete || early.data) throw new Error(`fixture must start before branch data settles: ${{JSON.stringify(early)}}`);
const branch = await readBranchRoutes(qipuId, mainRaw, early);
if (branch.complete) throw new Error(`late branch data was silently treated as complete mainline: ${{JSON.stringify(branch)}}`);
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1 || payload.candidates[0].raw !== '7062') {{
  throw new Error(`late branch candidate was not collected: ${{branch.data}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise delayed branch collection");
        child
            .stdin
            .as_mut()
            .expect("delayed branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write delayed branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run delayed branch collection harness");
        assert!(
            output.status.success(),
            "collector missed branch data that settled after the mainline: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_clears_a_previous_games_stale_branch_snapshot() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const delay = async () => undefined;
const previousControl = {{}};
const currentControl = {{}};
const emptyBranch = {{ data: '', path: 'current-board', complete: true, owner: currentControl }};
const branchPayload = () => emptyBranch;
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const liveLoadedId = () => 'current-game';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const stale = {{
  data: JSON.stringify({{ candidates: [{{ raw: '26257062', afterPly: 1 }}] }}),
  path: 'previous-board',
  complete: false,
  owner: previousControl,
}};
const branch = await readBranchRoutes('current-game', {{ text: '26252042', owner: currentControl }}, stale);
if (!branch.complete || branch.data) {{
  throw new Error(`previous-game branch payload survived current empty snapshots: ${{JSON.stringify(branch)}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise stale branch clearing");
        child
            .stdin
            .as_mut()
            .expect("stale branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write stale branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run stale branch clearing harness");
        assert!(
            output.status.success(),
            "collector retained a previous game's branch data: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_clears_a_stale_branch_snapshot_when_tencent_reuses_the_controller() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const delay = async () => undefined;
const reusedControl = {{}};
const emptyBranch = {{ data: '', path: 'current-board', complete: true, owner: reusedControl }};
const branchPayload = () => emptyBranch;
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const liveLoadedId = () => 'current-game';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const staleData = JSON.stringify({{ candidates: [{{ raw: '26257062', afterPly: 1 }}] }});
const stale = {{ data: staleData, path: 'reused-board', complete: false, owner: reusedControl }};
const branch = await readBranchRoutes(
  'current-game',
  {{ text: '26252042', owner: reusedControl }},
  stale,
  staleData,
);
if (!branch.complete || branch.data) {{
  throw new Error(`same-controller previous branch survived current empty snapshots: ${{JSON.stringify(branch)}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise same-controller branch clearing");
        child
            .stdin
            .as_mut()
            .expect("same-controller branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write same-controller branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run same-controller branch clearing harness");
        assert!(
            output.status.success(),
            "collector retained a previous branch on Tencent's reused controller: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_preserves_a_target_owned_branch_snapshot_during_empty_reads() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const control = {{}};
const delay = async () => undefined;
const branchPayload = () => ({{ data: '', path: 'current-board', complete: true, owner: control }});
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const liveLoadedId = () => 'current-game';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const targetBranch = {{
  data: JSON.stringify({{ candidates: [{{ raw: '7062', afterPly: 1 }}] }}),
  path: 'current-board',
  complete: false,
  owner: control,
}};
const branch = await readBranchRoutes(
  'current-game',
  {{ text: '26252042', owner: control }},
  targetBranch,
);
if (branch.complete || !branch.data) {{
  throw new Error(`current target branch was erased by transient empty reads: ${{JSON.stringify(branch)}}`);
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise target-owned branch settling");
        child
            .stdin
            .as_mut()
            .expect("target-owned branch checker stdin")
            .write_all(harness.as_bytes())
            .expect("write target-owned branch harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run target-owned branch settling harness");
        assert!(
            output.status.success(),
            "collector erased a branch snapshot already tied to the target board: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_does_not_block_import_for_visible_number_groups_without_branch_data() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = () => null;
const numericToolbar = {{
  child1: {{ text: '1' }},
  child2: {{ text: '2' }},
  child3: {{ text: '3' }},
  child4: {{ text: '4' }},
  child5: {{ text: '5' }},
}};
const model = {{}};
const boardControls = () => [{{ getQipuMoveStep: '26252042' }}];
const detailDisplayRoots = () => [numericToolbar];
{branch_source}
const branch = branchPayload();
if (!branch.complete) throw new Error(`plain visible number groups must not block import: ${{branch.data}}`);
if (branch.data) throw new Error(`plain visible number groups must be ignored: ${{branch.data}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise visible number groups");
        child
            .stdin
            .as_mut()
            .expect("visible number group checker stdin")
            .write_all(harness.as_bytes())
            .expect("write visible number group harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run visible number group harness");
        assert!(
            output.status.success(),
            "collector treated a plain visible number group as a missing branch: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_initial_fen_from_board_control_slash_string() {
        let fen_source = collector_source_between(
            "      const normalizeInitialFen = (value) =>",
            "      const branchPayload = (preferredControl = null) => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => Object.getOwnPropertyNames(value);
const customFen = '4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1';
const control = {{
  progressText: '10/22',
  url: 'https://qqchess.qq.com/',
  _qipuData: {{ chushijumian: customFen }},
}};
const boardControls = () => [control];
{fen_source}
if (normalizeInitialFen('10/22')) throw new Error('move progress text was accepted as FEN');
if (normalizeInitialFen('https://qqchess.qq.com/')) throw new Error('URL was accepted as FEN');
const result = initialFen();
if (result !== customFen) throw new Error(`initial FEN was not collected: ${{result}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise initial FEN collection");
        child
            .stdin
            .as_mut()
            .expect("initial FEN checker stdin")
            .write_all(harness.as_bytes())
            .expect("write initial FEN harness to Node.js");
        let output = child.wait_with_output().expect("run initial FEN harness");
        assert!(
            output.status.success(),
            "collector did not safely collect a board-control initial FEN: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_activates_real_route_controls_when_mainline_stream_does_not_change() {
        let branch_and_route_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const qipuId = '77610272440';
let activeRoute = 1;
let dataRoute = 1;
let pendingRoute = 1;
let pendingPolls = 0;
const activations = [];
let moveOwnerCache = null;
let moveOwnerSearchAt = 0;
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => {{
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length) {{
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, property)) return value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }}
  return null;
}};
const routeMoves = {{ 2: '26257062', 3: '26258979', 4: '26254454' }};
const control = {{
  getQipuMoveStep: '26252042',
  get getMoveBranchKey() {{ return dataRoute === 1 ? {{}} : {{ '10': `route-${{dataRoute}}` }}; }},
  get branchData() {{
    return dataRoute === 1 ? {{}} : {{ rows: [{{ msg: `路线${{dataRoute}}`, afterPly: 1, move: routeMoves[dataRoute] }}] }};
  }},
}};
const routeButton = (routeNo) => ({{
  text: String(routeNo),
  get selected() {{ return activeRoute === routeNo; }},
  dispatchEvent(type) {{
    if (type !== 'click') return false;
    activeRoute = routeNo;
    pendingRoute = routeNo;
    pendingPolls = 0;
    activations.push(routeNo);
    return true;
  }},
}});
const routePanel = {{
  boardControl: control,
  route1: routeButton(1),
  route2: routeButton(2),
  route3: routeButton(3),
  route4: routeButton(4),
  edit: {{ text: '编辑' }},
  next: {{ text: '下一步' }},
}};
const detailRoot = {{ control, routePanel }};
const model = {{ jumpQipuGame: () => undefined }};
const boardControls = () => [control];
const detailDisplayRoots = () => [routePanel, detailRoot];
const delay = async () => {{
  pendingPolls += 1;
  if (pendingPolls >= 2) dataRoute = pendingRoute;
}};
const qipuSources = () => [{{ qipuId }}];
const mainRaw = {{
  text: control.getQipuMoveStep,
  path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep',
  type: 'array<number>',
  owner: control,
}};
const directNotifyMove = () => mainRaw;
const directModelMove = () => null;
const readRawMoves = () => mainRaw;
{branch_and_route_source}
const passive = branchPayload();
const branch = await readBranchRoutes(qipuId, mainRaw, passive);
if (branch.complete) throw new Error(`real route controls were not fully collected: ${{JSON.stringify(branch)}}`);
const payload = JSON.parse(branch.data);
const routes = (payload.candidates || []).map(candidate => candidate.routeNo).sort();
if (JSON.stringify(routes) !== JSON.stringify([2, 3, 4])) {{
  throw new Error(`expected routes 2/3/4 from display controls, got ${{branch.data}}`);
}}
for (const candidate of payload.candidates || []) {{
  if (candidate.raw !== routeMoves[candidate.routeNo]) {{
    throw new Error(`route ${{candidate.routeNo}} reused stale branch data: ${{candidate.raw}}`);
  }}
}}
if (activations.join(',') !== '2,3,4,1') {{
  throw new Error(`route controls were not activated and restored: ${{activations.join(',')}}`);
}}
if (activeRoute !== 1) throw new Error(`route selection was not restored: ${{activeRoute}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise real QQ route controls");
        child
            .stdin
            .as_mut()
            .expect("route control checker stdin")
            .write_all(harness.as_bytes())
            .expect("write route control harness to Node.js");
        let output = child.wait_with_output().expect("run route control harness");
        assert!(
            output.status.success(),
            "collector did not activate QQ route controls: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_a_stable_direct_route_move_stream_without_branch_data() {
        let branch_and_route_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const qipuId = '77610272440';
let activeRoute = 1;
let pendingRoute = 1;
let pendingPolls = 0;
const activations = [];
const propertyNames = (value) => {{
  const names = new Set();
  let current = value;
  for (let depth = 0; current && depth < 3; depth += 1) {{
    Object.getOwnPropertyNames(current).forEach(name => names.add(name));
    current = Object.getPrototypeOf(current);
  }}
  return [...names];
}};
const stringifyMoveValue = (value) => {{
  if (!value || typeof value !== 'object') return {{ status: 'not-object', text: '', length: 0 }};
  const text = String(value).trim();
  return text ? {{ status: 'ok', text, length: text.length }} : {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = () => null;
const routeMoves = {{ 2: '26257062', 3: '26258979', 4: '26254454' }};
const control = {{
  get getQipuMoveStep() {{ return activeRoute === 1 ? '26252042' : routeMoves[activeRoute]; }},
}};
const routeButton = (routeNo) => ({{
  text: String(routeNo),
  get selected() {{ return activeRoute === routeNo; }},
  dispatchEvent(type) {{
    if (type !== 'click') return false;
    pendingRoute = routeNo;
    pendingPolls = 0;
    activations.push(routeNo);
    return true;
  }},
}});
const routePanel = {{
  boardControl: control,
  route1: routeButton(1),
  route2: routeButton(2),
  route3: routeButton(3),
  route4: routeButton(4),
  edit: {{ text: '编辑' }},
  next: {{ text: '下一步' }},
}};
const detailRoot = {{ control, routePanel }};
const model = {{ jumpQipuGame: () => undefined }};
const boardControls = () => [control];
const detailDisplayRoots = () => [routePanel, detailRoot];
const delay = async () => {{
  pendingPolls += 1;
  if (pendingPolls >= 2) activeRoute = pendingRoute;
}};
const qipuSources = () => [{{ qipuId }}];
const currentRaw = () => ({{
  text: control.getQipuMoveStep,
  path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep',
  type: 'array<number>',
  owner: control,
}});
const mainRaw = currentRaw();
const directNotifyMove = () => currentRaw();
const directModelMove = () => null;
const readRawMoves = () => currentRaw();
{branch_and_route_source}
const passive = branchPayload();
const branch = await readBranchRoutes(qipuId, mainRaw, passive);
if (branch.complete) throw new Error(`direct route stream was not collected: ${{JSON.stringify(branch)}}`);
const payload = JSON.parse(branch.data);
const routes = (payload.candidates || []).map(candidate => candidate.routeNo).sort();
if (JSON.stringify(routes) !== JSON.stringify([2, 3, 4])) {{
  throw new Error(`expected routes 2/3/4 from direct move stream, got ${{branch.data}}`);
}}
for (const candidate of payload.candidates || []) {{
  if (candidate.raw !== routeMoves[candidate.routeNo]) {{
    throw new Error(`route ${{candidate.routeNo}} reused stale direct move: ${{candidate.raw}}`);
  }}
}}
if (activations.join(',') !== '2,3,4,1') {{
  throw new Error(`route controls were not activated and restored: ${{activations.join(',')}}`);
}}
if (activeRoute !== 1) throw new Error(`route selection was not restored: ${{activeRoute}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise direct route move streams");
        child
            .stdin
            .as_mut()
            .expect("direct route checker stdin")
            .write_all(harness.as_bytes())
            .expect("write direct route harness to Node.js");
        let output = child.wait_with_output().expect("run direct route harness");
        assert!(
            output.status.success(),
            "collector rejected a stable direct route move stream: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn reading_attempt_without_bridge_acknowledgement_times_out() {
        let mut sync = TtxqSyncState::default();
        let attempt_id = begin_read_attempt(&mut sync);

        assert!(fail_unacknowledged_bridge(
            &mut sync,
            attempt_id,
            "h5login.qqchess.qq.com"
        ));
        assert_eq!(sync.progress.state, "error");
        assert!(sync.progress.message.contains("远程 IPC 未启动"));
        assert!(sync.progress.message.contains("h5login.qqchess.qq.com"));

        let newer_attempt_id = begin_read_attempt(&mut sync);
        assert!(!fail_unacknowledged_bridge(
            &mut sync,
            attempt_id,
            "h5login.qqchess.qq.com"
        ));
        assert_eq!(sync.progress.state, "reading");
        assert_eq!(sync.active_attempt, newer_attempt_id);
    }

    #[test]
    fn acknowledged_attempt_can_still_finish_with_a_bridge_error() {
        let mut sync = TtxqSyncState::default();
        let attempt_id = begin_read_attempt(&mut sync);
        sync.bridge_acknowledged = true;
        sync.progress.read_total = 16;
        sync.progress.read_completed = 4;

        assert!(set_read_error(
            &mut sync,
            attempt_id,
            "无法启动天天象棋采集器"
        ));
        assert_eq!(sync.progress.state, "error");
        assert_eq!(sync.progress.read_total, 16);
        assert_eq!(sync.progress.read_completed, 4);
        assert!(sync.progress.message.contains("无法启动天天象棋采集器"));
    }

    #[test]
    fn acknowledged_attempt_times_out_when_loading_progress_stalls() {
        let mut sync = TtxqSyncState::default();
        let attempt_id = begin_read_attempt(&mut sync);
        sync.bridge_acknowledged = true;
        sync.progress.read_phase = "loading".into();
        sync.progress.read_current = 1;
        sync.progress.read_total = 9;
        let observed_revision = sync.progress_revision;

        assert!(fail_stalled_read(&mut sync, attempt_id, observed_revision));
        assert_eq!(sync.progress.state, "error");
        assert!(sync.progress.message.contains("第 1/9 盘"));
        assert!(sync.progress.message.contains("长时间没有进度"));
    }

    #[test]
    fn acknowledged_attempt_does_not_time_out_after_progress_advances() {
        let mut sync = TtxqSyncState::default();
        let attempt_id = begin_read_attempt(&mut sync);
        sync.bridge_acknowledged = true;
        let observed_revision = sync.progress_revision;

        sync.progress.read_current = 2;
        advance_progress_revision(&mut sync);

        assert!(!fail_stalled_read(&mut sync, attempt_id, observed_revision));
        assert_eq!(sync.progress.state, "reading");
    }

    #[test]
    fn collector_script_is_valid_javascript() {
        let source = include_str!("ttxq_sync.rs");
        let bridge_start = source
            .find("let collector_script = r#\"")
            .expect("collector script must exist")
            + "let collector_script = r#\"".len();
        let bridge_end = source[bridge_start..]
            .find("\"#\n        .replace(\"__TTXQ_ATTEMPT_ID__\"")
            .expect("collector script must terminate")
            + bridge_start;
        let script = source[bridge_start..bridge_end].replace("__TTXQ_ATTEMPT_ID__", "1");
        let mut child = std::process::Command::new("node")
            .args(["--check", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to validate the injected collector script");
        child
            .stdin
            .as_mut()
            .expect("collector syntax checker stdin")
            .write_all(script.as_bytes())
            .expect("write collector script to Node.js");
        let output = child.wait_with_output().expect("run Node.js syntax check");
        assert!(
            output.status.success(),
            "collector script is invalid JavaScript: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_current_detail_root_before_the_global_fdk_graph() {
        let display_source = collector_source_between(
            "          const displayObjectDetailFields = () => {",
            "          const metadataProbe = () => {",
        );
        let harness = format!(
            r#"(async () => {{
let propertyReads = 0;
const propertyNames = (value) => {{ propertyReads += 1; return Object.getOwnPropertyNames(value); }};
const panel = {{
  header: {{ text: '棋谱属性' }},
  title: {{ text: '标题：世界象棋选拔赛第五轮' }},
  red: {{ text: '红方：测试棋手' }},
}};
panel.header.parent = panel;
const globalFdk = {{}};
for (let outer = 0; outer < 120; outer += 1) {{
  const group = {{}};
  for (let inner = 0; inner < 120; inner += 1) group[`item${{inner}}`] = {{ value: inner }};
  globalFdk[`group${{outer}}`] = group;
}}
const window = {{ fdk: globalFdk }};
const detailDisplayRoots = () => [panel];
{display_source}
const fields = displayObjectDetailFields();
if (fields.title !== '世界象棋选拔赛第五轮') throw new Error(`detail title was not read: ${{JSON.stringify(fields)}}`);
if (propertyReads >= 200) throw new Error(`global FDK graph was scanned first: ${{propertyReads}} property reads`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise detail traversal order");
        child
            .stdin
            .as_mut()
            .expect("detail traversal checker stdin")
            .write_all(harness.as_bytes())
            .expect("write detail traversal harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run detail traversal harness");
        assert!(
            output.status.success(),
            "collector traversed the global FDK graph before the current detail: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_metadata_scan_is_time_bounded() {
        let metadata_source = collector_source_between(
            "          const scalarFields = new Map();",
            "          const firstText = (...keys) => {",
        );
        let harness = format!(
            r#"(() => {{
let clock = 0;
const Date = {{ now: () => ++clock }};
let propertyReads = 0;
const propertyNames = value => {{ propertyReads += 1; return Object.getOwnPropertyNames(value); }};
const root = {{ title: '世界象棋选拔赛第五轮' }};
for (let outer = 0; outer < 80; outer += 1) {{
  const group = {{}};
  for (let inner = 0; inner < 80; inner += 1) group[`data${{inner}}`] = {{ title: `候选${{outer}}-${{inner}}` }};
  root[`data${{outer}}`] = group;
}}
const metadata = [root];
{metadata_source}
if ((scalarFields.get('title') || [])[0] !== '世界象棋选拔赛第五轮') throw new Error('root title was not collected');
if (propertyReads > 350) throw new Error(`metadata scan was not time bounded: ${{propertyReads}} object reads`);
}})();
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise metadata traversal bounds");
        assert!(
            output.status.success(),
            "collector metadata traversal exceeded its budget: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_preserves_recent_list_top_to_bottom_order() {
        let source = include_str!("ttxq_sync.rs");
        let traversal_start = source
            .find("      const qipuListRoots = () => {")
            .expect("recent-list traversal must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source =
            source[traversal_start..traversal_end].replace("__TTXQ_ATTEMPT_ID__", "1");
        let harness = format!(
            r#"(async () => {{
	const model = {{ _qipuRecentView: {{ records: [
	  {{ qipuId: '77000000001', title: '列表顶部' }},
	  {{ qipuId: '77000000002', title: '列表中间' }},
	  {{ qipuId: '77000000003', title: '列表底部' }},
	] }} }};
const invoke = async () => undefined;
const delay = async () => undefined;
	{traversal_source}
	const order = [...found.keys()].join(',');
	if (order !== '77000000001,77000000002,77000000003') throw new Error(`collector order was ${{order}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise recent-list traversal");
        child
            .stdin
            .as_mut()
            .expect("recent-list traversal checker stdin")
            .write_all(harness.as_bytes())
            .expect("write recent-list traversal harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run recent-list traversal harness");
        assert!(
            output.status.success(),
            "collector reversed the visible recent-list order: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_discovers_favourite_and_created_qipu_list_roots() {
        let source = include_str!("ttxq_sync.rs");
        let traversal_start = source
            .find("      const qipuListRoots = () => {")
            .expect("recent-list traversal must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source =
            source[traversal_start..traversal_end].replace("__TTXQ_ATTEMPT_ID__", "1");
        let harness = format!(
            r#"(async () => {{
	const model = {{
	  _qipuRecentView: {{ records: [{{ qipuId: '77000000011' }}] }},
	  _qipuWallDataList: {{ favourites: [{{ iQipuId: '77000000012', extDataBody: {{ sTitle: '收藏布局' }} }}] }},
	  _qipuCreateDataList: {{ created: [{{ lQipuId: '77000000013', extDataBody: {{ sTitle: '自录布局' }} }}] }},
}};
const invoke = async () => undefined;
const delay = async () => undefined;
	{traversal_source}
	const ids = [...found.keys()];
	for (const id of ['77000000011', '77000000012', '77000000013']) {{
	  if (!ids.includes(id)) throw new Error(`collector missed ${{id}} from mixed qipu roots: ${{ids.join(',')}}`);
	}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise mixed qipu list roots");
        child
            .stdin
            .as_mut()
            .expect("mixed qipu roots checker stdin")
            .write_all(harness.as_bytes())
            .expect("write mixed qipu roots harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run mixed qipu roots harness");
        assert!(
            output.status.success(),
            "collector missed favourite or created list roots: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_known_49_move_coordinate_arrays() {
        let source = include_str!("ttxq_sync.rs");
        let candidate_start = source
            .find("      const moveText =")
            .expect("move candidate must exist");
        let candidate_end = source[candidate_start..]
            .find("      const readRawMoves =")
            .expect("move candidate must terminate")
            + candidate_start;
        let candidate_source = &source[candidate_start..candidate_end];
        let harness = format!(
            r#"{candidate_source}
const moves = Array.from({{ length: 49 }}, (_, index) => index % 2 ? '7767' : '2625');
for (const field of ['getMainMoveList', 'getLessonNextMoveStep']) {{
  const candidate = moveCandidate(moves, `source[1].${{field}}`);
  if (!candidate || candidate.text.length !== 196 || candidate.type !== 'array<numeric-string>') {{
    throw new Error(`${{field}} array(49) was discarded before Rust decoding`);
  }}
}}
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise the collector move candidate");
        child
            .stdin
            .as_mut()
            .expect("collector candidate checker stdin")
            .write_all(harness.as_bytes())
            .expect("write collector candidate harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run move candidate harness");
        assert!(
            output.status.success(),
            "collector rejected a known coordinate array: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_move_objects_with_coordinate_to_string() {
        let source = include_str!("ttxq_sync.rs");
        let candidate_start = source
            .find("      const moveText =")
            .expect("move candidate must exist");
        let candidate_end = source[candidate_start..]
            .find("      const readRawMoves =")
            .expect("move candidate must terminate")
            + candidate_start;
        let candidate_source = &source[candidate_start..candidate_end];
        let harness = format!(
            r#"{candidate_source}
const digits = Array.from({{ length: 49 }}, (_, index) => index % 2 ? '7767' : '2625')
  .join('').split('').join(',');
const moveObject = {{ toString: () => digits }};
const candidate = moveCandidate(moveObject, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep');
if (!candidate || candidate.type !== 'object<toString>' || candidate.text !== digits.replaceAll(',', '')) {{
  throw new Error('coordinate object was discarded before Rust decoding');
}}
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise object move candidates");
        child
            .stdin
            .as_mut()
            .expect("object move candidate checker stdin")
            .write_all(harness.as_bytes())
            .expect("write object move candidate harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run object move candidate harness");
        assert!(
            output.status.success(),
            "collector rejected a coordinate-bearing move object: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_wrapped_array_elements_with_coordinate_to_string() {
        let source = include_str!("ttxq_sync.rs");
        let candidate_start = source
            .find("      const moveText =")
            .expect("move candidate must exist");
        let candidate_end = source[candidate_start..]
            .find("      const readRawMoves =")
            .expect("move candidate must terminate")
            + candidate_start;
        let candidate_source = &source[candidate_start..candidate_end];
        let harness = format!(
            r#"{candidate_source}
const wrapped = Array.from({{ length: 49 }}, (_, index) => ({{
  toString: () => index % 2 ? '7767' : '2625',
}}));
const candidate = moveCandidate(wrapped, 'source[0].getMainMoveList');
const expected = Array.from({{ length: 49 }}, (_, index) => index % 2 ? '7767' : '2625').join('');
if (!candidate || candidate.type !== 'array<toString>' || candidate.text !== expected) {{
  throw new Error(`wrapped array elements were not normalized: ${{candidate && candidate.type}} ${{candidate && candidate.text}}`);
}}
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise wrapped array candidates");
        child
            .stdin
            .as_mut()
            .expect("wrapped array checker stdin")
            .write_all(harness.as_bytes())
            .expect("write wrapped array candidate harness");
        let output = child
            .wait_with_output()
            .expect("run wrapped array candidate harness");
        assert!(
            output.status.success(),
            "collector rejected an array whose elements expose coordinates through toString: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_rejects_unsafe_or_unbounded_move_serialization() {
        let source = include_str!("ttxq_sync.rs");
        let candidate_start = source
            .find("      const moveText =")
            .expect("move candidate must exist");
        let candidate_end = source[candidate_start..]
            .find("      const readRawMoves =")
            .expect("move candidate must terminate")
            + candidate_start;
        let candidate_source = &source[candidate_start..candidate_end];
        let harness = format!(
            r#"{candidate_source}
const path = 'source[0].getQipuMoveStep';
for (const value of [
  {{}},
  {{ toString: () => '2625<script>' }},
  {{ toString: () => '2625'.repeat(8193) }},
]) {{
  if (moveCandidate(value, path)) throw new Error('unsafe move serialization was accepted');
}}
const animation = {{ toString: () => 'moveFailEffect' }};
if (moveCandidate(animation, 'source[0].moveFailEffect')) throw new Error('animation state was accepted as moves');
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise unsafe move candidates");
        child
            .stdin
            .as_mut()
            .expect("unsafe move checker stdin")
            .write_all(harness.as_bytes())
            .expect("write unsafe move candidate harness");
        let output = child
            .wait_with_output()
            .expect("run unsafe move candidate harness");
        assert!(
            output.status.success(),
            "collector accepted an unsafe move serialization: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_placeholder_and_non_visible_qipu_cache_ids() {
        let source = include_str!("ttxq_sync.rs");
        let traversal_start = source
            .find("      const qipuListRoots = () => {")
            .expect("qipu-list root selection must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source =
            source[traversal_start..traversal_end].replace("__TTXQ_ATTEMPT_ID__", "1");
        let harness = format!(
            r#"(async () => {{
	const realRows = Array.from({{ length: 9 }}, (_, index) => ({{
	  qipuId: String(77000000100 + index),
	  title: `目录棋谱 ${{index + 1}}`,
	}}));
	const model = {{
	  _qipuWallDataList: {{ rows: realRows, placeholder: {{ qipuId: 0, title: '占位' }} }},
	  _dailyQipuIdRsp: [{{ lQiPuID: 77999999999, sTitle: '每日推荐，不属于当前目录' }}],
	  _qipuLiveWallDataList: [{{ qipuId: 77888888888, sTitle: '直播缓存，不属于当前目录' }}],
	}};
	const invoke = async () => undefined;
	const delay = async () => undefined;
	{traversal_source}
	const ids = [...found.keys()];
	if (ids.length !== 9) throw new Error(`collector counted ${{ids.length}} rows: ${{ids.join(',')}}`);
	if (ids.includes('0') || ids.includes('77999999999') || ids.includes('77888888888')) {{
	  throw new Error(`collector included placeholder/cache ids: ${{ids.join(',')}}`);
	}}
	}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
	"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise phantom qipu filtering");
        child
            .stdin
            .as_mut()
            .expect("phantom qipu checker stdin")
            .write_all(harness.as_bytes())
            .expect("write phantom qipu harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run phantom qipu traversal harness");
        assert!(
            output.status.success(),
            "collector counted a placeholder or non-visible cache as a qipu: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_same_moves_from_a_new_board_controller() {
        let wait_source = collector_source_between(
            "      const snapshotHasCoordinateCandidate = (snapshot) =>",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
let switched = false;
const previousOwner = {{}};
const currentOwner = {{}};
const directNotifyMove = () => ({{ text: '2625', path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', type: 'array<number>', owner: switched ? currentOwner : previousOwner }});
const directModelMove = () => null;
const readRawMoves = () => null;
const liveLoadedId = () => '';
const delay = async () => {{ switched = true; }};
{wait_source}
const candidate = await waitForTarget('target', 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep:array<number>:2625', previousOwner, [], 1);
if (candidate.owner !== currentOwner) throw new Error('new board controller was not accepted when moves were unchanged');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise board-controller identity");
        child
            .stdin
            .as_mut()
            .expect("board-controller identity checker stdin")
            .write_all(harness.as_bytes())
            .expect("write board-controller identity harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run board-controller identity harness");
        assert!(
            output.status.success(),
            "collector rejected unchanged moves from a new board controller: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_recovers_a_move_array_that_settles_at_the_wait_boundary() {
        let recovery_source = collector_recovery_source("          const moves =");
        let harness = format!(
            r#"(async () => {{
let ready = false;
const current = 16;
const qipuId = '77047568900';
const info = {{ qipuId }};
const model = {{ jumpQipuGame: () => ({{}}) }};
const empty = () => ({{ text: '', path: '', type: '', length: 0, score: 0 }});
const directNotifyMove = () => null;
const directModelMove = () => null;
const liveLoadedId = () => '';
const readRawMoves = () => ready
  ? ({{ text: '2625', path: 'source[1].getQipuMoveStep', type: 'array<number>', length: 4, score: 120 }})
  : empty();
const waitForTarget = async () => {{ ready = true; throw new Error('棋谱加载超时'); }};
{recovery_source}
if (raw.text !== '2625') throw new Error('settled move array was discarded after the bounded wait');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise boundary recovery");
        child
            .stdin
            .as_mut()
            .expect("boundary recovery checker stdin")
            .write_all(harness.as_bytes())
            .expect("write boundary recovery harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run boundary recovery harness");
        assert!(
            output.status.success(),
            "collector lost a move array at the wait boundary: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_recovers_a_move_array_that_settles_during_snapshot() {
        let recovery_source = collector_recovery_source("          const moves =");
        let harness = format!(
            r#"(async () => {{
let ready = false;
const current = 16;
const qipuId = '77047568900';
const info = {{ qipuId }};
const model = {{ jumpQipuGame: () => ({{}}) }};
const empty = () => ({{ text: '', path: '', type: '', length: 0, score: 0 }});
const directNotifyMove = () => null;
const directModelMove = () => null;
const liveLoadedId = () => '';
const readRawMoves = () => ready
  ? ({{ text: '2625', path: 'source[1].getQipuMoveStep', type: 'array<number>', length: 4, score: 120 }})
  : empty();
const waitForTarget = async () => {{ throw new Error('棋谱加载超时'); }};
const bridgeSnapshot = () => {{ ready = true; return 'getQipuMoveStep:array(196)'; }};
{recovery_source}
if (raw.path === 'bridge-snapshot' || raw.text !== '2625') {{
  throw new Error('move array that settled during snapshot remained a missing diagnostic');
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise snapshot-boundary recovery");
        child
            .stdin
            .as_mut()
            .expect("snapshot-boundary checker stdin")
            .write_all(harness.as_bytes())
            .expect("write snapshot-boundary harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run snapshot-boundary harness");
        assert!(
            output.status.success(),
            "collector lost moves that settled while capturing diagnostics: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_same_signature_after_coordinate_snapshot() {
        let recovery_source = collector_recovery_source("          const moves =");
        let harness = format!(
            r#"(async () => {{
const current = 9;
const qipuId = '77047568900';
const info = {{ qipuId }};
const model = {{ jumpQipuGame: () => ({{}}) }};
const rawMove = '77471242192710220919725289877062875750417967807057536364464500101713424567464547';
const previousOwner = {{}};
const directNotifyMove = () => ({{ text: rawMove, path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', type: 'array<number>', length: 196, score: 23560, owner: previousOwner }});
const directModelMove = () => null;
const liveLoadedId = () => '';
const readRawMoves = () => directNotifyMove();
const waitForTarget = async () => {{ throw new Error('棋谱加载超时'); }};
const bridgeSnapshot = () => 'NOTIFY_QIPU_DATA:found · boardControl:object · getQipuMoveStep:array(196) · elements:number · toString:391 chars · coordinate-candidate';
{recovery_source}
if (raw.path === 'bridge-snapshot' || raw.text !== rawMove) {{
  throw new Error('same-signature coordinate candidate was discarded as a missing diagnostic');
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise same-signature recovery");
        child
            .stdin
            .as_mut()
            .expect("same-signature checker stdin")
            .write_all(harness.as_bytes())
            .expect("write same-signature harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run same-signature harness");
        assert!(
            output.status.success(),
            "collector discarded a same-signature coordinate snapshot: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_requires_a_stable_changed_signature_without_a_live_qipu_id() {
        let source = collector_source_between(
            "      const acceptsTargetCandidate = (candidate, qipuId",
            "      const waitForTarget = async",
        );
        let harness = format!(
            r#"(() => {{
const liveLoadedId = () => '';
const owner = {{}};
const candidate = {{ text: '26257767', path: 'board.getQipuMoveStep', type: 'array<number>', owner }};
const beforeSignature = 'board.getQipuMoveStep:array<number>:2625';
{source}
if (acceptsTargetCandidate(candidate, 'target', beforeSignature, owner)) {{
  throw new Error('one changed loading signature was accepted without target identity');
}}
const stableSignature = `${{candidate.path}}:${{candidate.type}}:${{candidate.text}}`;
if (!acceptsTargetCandidate(candidate, 'target', beforeSignature, owner, {{ stableSignature }})) {{
  throw new Error('two stable reads were not accepted for a controller reused by QQ');
}}
}})();
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise stable target confirmation");
        assert!(
            output.status.success(),
            "collector did not require stable target evidence: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_never_treats_a_generic_control_id_as_qipu_identity() {
        let source = collector_source_between(
            "      const liveLoadedId = () => {",
            "      const snapshotHasCoordinateCandidate = (snapshot) =>",
        );
        let harness = format!(
            r#"(() => {{
let sources = [{{ id: 'board-control-17' }}, {{ qipuId: 'target-qipu' }}];
const qipuSources = () => sources;
{source}
if (liveLoadedId() !== 'target-qipu') throw new Error('explicit qipuId was not preferred');
sources = [{{ id: 'board-control-17' }}];
if (liveLoadedId() !== '') throw new Error('generic control id was treated as qipuId');
}})();
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise qipu identity filtering");
        assert!(
            output.status.success(),
            "collector accepted a generic control id as qipu identity: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_rejects_unchanged_previous_game_at_the_wait_boundary() {
        let recovery_source = collector_recovery_source("          const moves =");
        let harness = format!(
            r#"(async () => {{
const current = 16;
const qipuId = 'target';
const info = {{ qipuId }};
const model = {{ jumpQipuGame: () => ({{}}) }};
let staleReads = 0;
const directNotifyMove = () => {{
  staleReads += 1;
  return {{ text: staleReads === 1 ? '2625' : '26257767', path: 'previous.getQipuMoveStep', type: 'array<number>', length: staleReads === 1 ? 4 : 8, score: 120 }};
}};
const directModelMove = () => null;
const liveLoadedId = () => 'previous';
const readRawMoves = () => null;
const waitForTarget = async () => {{ throw new Error('棋谱加载超时'); }};
const bridgeSnapshot = () => 'previous game remained visible';
{recovery_source}
if (raw.path !== 'bridge-snapshot') throw new Error('unchanged previous-game moves were accepted for the target game');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise stale boundary recovery");
        child
            .stdin
            .as_mut()
            .expect("stale boundary checker stdin")
            .write_all(harness.as_bytes())
            .expect("write stale boundary harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run stale boundary harness");
        assert!(
            output.status.success(),
            "collector accepted stale moves at the wait boundary: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn rejects_invalid_bridge_moves() {
        let payload = TtxqBridgePayloadDto {
            version: BRIDGE_VERSION,
            games: vec![TtxqGameRecordDto {
                qipu_id: "1".into(),
                title: String::new(),
                starting_fen: String::new(),
                moves: vec!["not-a-move".into()],
                raw_moves: String::new(),
                raw_move_path: String::new(),
                raw_move_type: String::new(),
                raw_move_length: 0,
                variations: vec![],
                branch_data: String::new(),
                branch_path: String::new(),
                branch_complete: true,
                red: String::new(),
                black: String::new(),
                event: String::new(),
                site: String::new(),
                date: String::new(),
                result: String::new(),
                note: String::new(),
                round: String::new(),
                played_at: String::new(),
                duration: String::new(),
                time_control: String::new(),
                metadata_probe: String::new(),
            }],
        };
        assert!(validate_payload(&payload).is_err());
    }

    #[test]
    fn rejects_impossible_read_progress() {
        assert!(validate_read_progress(3, 4, 0, 0, 0).is_err());
        assert!(validate_read_progress(3, 2, 3, 0, 0).is_err());
        assert!(validate_read_progress(MAX_GAMES + 1, 0, 0, 0, 0).is_err());
        assert!(validate_read_progress(3, 2, 1, MAX_SCAN_NODES + 1, 0).is_err());
        assert!(validate_read_progress(3, 2, 1, 12, 4).is_err());
        assert!(validate_read_progress(3, 2, 1, 12, 3).is_ok());
    }

    #[test]
    fn payload_hash_changes_when_the_imported_game_changes() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "qipu-1".into(),
            title: "对局".into(),
            starting_fen: String::new(),
            moves: vec!["h2e2".into()],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        let original = payload_hash(&game).unwrap();
        game.note = "后补注释".into();
        assert_ne!(original, payload_hash(&game).unwrap());
    }

    #[test]
    fn local_metadata_probe_does_not_change_the_import_payload_hash() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "qipu-probe".into(),
            title: "放飞[业9-2]先和[业9-2],29回合".into(),
            starting_fen: String::new(),
            moves: vec!["h2e2".into()],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        let original = payload_hash(&game).unwrap();
        game.metadata_probe = "detailRoot[2]._text=标题：放飞".into();
        assert_eq!(original, payload_hash(&game).unwrap());
        assert!(serde_json::to_value(&game)
            .unwrap()
            .get("metadataProbe")
            .is_none());
    }

    #[test]
    fn title_metadata_enrichment_keeps_the_real_title_and_derives_safe_fields() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "qipu-title".into(),
            title: "放飞[业9-2] 先和 [业9-2],29回合".into(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        enrich_title_metadata(&mut game);
        assert_eq!(game.title, "放飞[业9-2] 先和 [业9-2],29回合");
        assert_eq!(game.red, "放飞");
        assert_eq!(game.result, "1/2-1/2");
        assert_eq!(game.round, "29 回合");
    }

    #[test]
    fn title_metadata_accepts_a_rank_suffix_in_the_red_player_field() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "qipu-ranked-player".into(),
            title: "放飞[业9-2] 先和 [业9-2],29回合".into(),
            starting_fen: String::new(),
            moves: vec!["h2e2".into(); 57],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: "放飞[业9-2]".into(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };

        enrich_title_metadata(&mut game);

        assert_eq!(game.title, "放飞[业9-2] 先和 [业9-2],29回合");
        assert_eq!(game.red, "放飞[业9-2]");
        assert_eq!(game.round, "29 回合");
    }

    #[test]
    fn title_metadata_rejects_the_previous_games_player_and_round() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "third-game".into(),
            title: "林金明[业9-2] 先和 [业9-2],69回合".into(),
            starting_fen: String::new(),
            moves: vec!["h2e2".into(); 65],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: "邵彦闳".into(),
            black: String::new(),
            event: "棋力评测".into(),
            site: "天天象棋".into(),
            date: "2026/08/09 09:16:17".into(),
            result: "1-0".into(),
            note: String::new(),
            round: "69 回合".into(),
            played_at: "2026/08/09 09:16:17".into(),
            duration: "五分钟".into(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };

        enrich_title_metadata(&mut game);

        assert_eq!(game.round, "33 回合");
        assert_eq!(ttxq_title(&game), "邵彦闳 · 红胜 · 33 回合");
    }

    #[test]
    fn title_metadata_treats_self_recorded_card_title_as_title_not_player() {
        let mut game = TtxqGameRecordDto {
            qipu_id: "self-recorded".into(),
            title: "世界象棋选拔赛第五轮".into(),
            starting_fen: String::new(),
            moves: vec!["h2e2".into(); 34],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: "世界象棋选拔赛第五轮".into(),
            black: String::new(),
            event: "自建棋谱".into(),
            site: "天天象棋".into(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: "17".into(),
            played_at: "2026-08-26 17:13".into(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };

        enrich_title_metadata(&mut game);

        assert_eq!(ttxq_title(&game), "世界象棋选拔赛第五轮");
        assert!(game.red.is_empty());
        assert_eq!(game.round, "17 回合");
    }

    #[test]
    fn source_note_preserves_ttxq_game_timing_and_round() {
        let record = TtxqGameRecordDto {
            qipu_id: "qipu-1".into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: "原始备注".into(),
            round: "第 3 轮".into(),
            played_at: "2026-08-27 16:00".into(),
            duration: "12 分 34 秒".into(),
            time_control: "10 分钟 + 5 秒".into(),
            metadata_probe: String::new(),
        };
        assert_eq!(
            source_note(&record),
            "原始备注\n来源：天天象棋网页\n棋谱手数：0 回合（0 半回合）\n回合：第 3 轮\n对局时间：2026-08-27 16:00\n对局用时：12 分 34 秒\n用时规则：10 分钟 + 5 秒"
        );
    }

    #[test]
    fn resolves_chinese_provider_moves_before_import() {
        let record = TtxqGameRecordDto {
            qipu_id: "qipu-chinese".into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves: "1. 炮二平五 马8进7 2. 马二进三".into(),
            raw_move_path: "_qipuData.moveStep".into(),
            raw_move_type: "string".into(),
            raw_move_length: 22,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        assert_eq!(
            resolved_moves(&record, STARTING_FEN).unwrap(),
            vec!["h2e2", "h9g7", "h0g2"]
        );
    }

    #[test]
    fn resolves_iccs_embedded_in_a_provider_object_sample() {
        let record = TtxqGameRecordDto {
            qipu_id: "qipu-object".into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves: r#"[{"step":"h2e2"},{"move":"h9g7"}]"#.into(),
            raw_move_path: "source[0]._qipuData.moveList".into(),
            raw_move_type: "array".into(),
            raw_move_length: 35,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        assert_eq!(
            resolved_moves(&record, STARTING_FEN).unwrap(),
            vec!["h2e2", "h9g7"]
        );
    }

    #[test]
    fn resolves_ttxq_dhtml_move_step_to_iccs() {
        let record = TtxqGameRecordDto {
            qipu_id: "qipu-dhtml".into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves: "26252042".into(),
            raw_move_path: "source[0].getQipuMoveStep".into(),
            raw_move_type: "array".into(),
            raw_move_length: 8,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        assert_eq!(
            resolved_moves(&record, STARTING_FEN).unwrap(),
            vec!["c3c4", "c9e7"]
        );
        let mut alias = record.clone();
        alias.raw_move_path = "source[0].MOVE_STR".into();
        assert_eq!(
            resolved_moves(&alias, STARTING_FEN).unwrap(),
            vec!["c3c4", "c9e7"]
        );
    }

    #[test]
    fn reports_serialization_failure_for_a_move_field_snapshot() {
        let record = TtxqGameRecordDto {
            qipu_id: "qipu-diagnostic".into(),
            title: String::new(),
            starting_fen: String::new(),
            moves: vec![],
            raw_moves:
                "getQipuMoveStep:array(196) · elements:object · toString:serialization-invalid"
                    .into(),
            raw_move_path: "bridge-snapshot".into(),
            raw_move_type: "missing".into(),
            raw_move_length: 92,
            variations: vec![],
            branch_data: String::new(),
            branch_path: String::new(),
            branch_complete: true,
            red: String::new(),
            black: String::new(),
            event: String::new(),
            site: String::new(),
            date: String::new(),
            result: String::new(),
            note: String::new(),
            round: String::new(),
            played_at: String::new(),
            duration: String::new(),
            time_control: String::new(),
            metadata_probe: String::new(),
        };
        assert_eq!(
            resolved_moves(&record, STARTING_FEN).unwrap_err(),
            "走法格式不兼容：已找到天天象棋走法字段，但元素类型/序列化失败"
        );
    }

    #[test]
    fn bridge_searches_model_roots_and_prototype_move_fields() {
        let source = include_str!("ttxq_sync.rs");
        let bridge_start = source
            .find("let collector_script = r#\"")
            .expect("bridge script must exist")
            + "let collector_script = r#\"".len();
        let bridge_end = source[bridge_start..]
            .find("\"#\n        .replace(\"__TTXQ_ATTEMPT_ID__\"")
            .expect("bridge script must terminate")
            + bridge_start;
        let bridge = &source[bridge_start..bridge_end];
        for marker in [
            "model && model._qipuRecentView",
            "model && model._qipuWallDataList",
            "model && model._qipuCreateDataList",
            "const findObjectWithOwnProperty",
            "findObjectWithOwnProperty(window.fdk, 'NOTIFY_QIPU_DATA', 100_000)",
            "limit = 100_000",
            "const directNotifyMove",
            "const moveSurfaceOwners",
            "const directModelMove",
            "const perMoveField = /(?:getMainMoveList|getLessonNextMoveStep)$/i.test(path)",
            "const numericTokens = dhtmlField && Array.isArray(value) ? value.map(numericToken) : []",
            "numericTokens.every(token => token.length === 4)",
            "numericTokens.join('')",
            "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep",
            "Object.getPrototypeOf(current)",
            "const displayAncestorRoots = (seeds) =>",
            "const detailDisplayRoots = () =>",
            "current.parent || current._parent",
            "'getQipuMoveStep'",
            "'MOVE_STR'",
            "const bridgeSnapshot",
            "const polls = current === 1 ? 60 : 12",
            "maxPolls = 12",
            "const liveLoadedId = () =>",
            "loadedId === String(qipuId)",
            "const qipuSources = (extraSources = [])",
            "readRawMoves([info])",
            "bridgeSnapshot([info])",
            "const visibleDetailFields = () =>",
            "const displayObjectDetailFields = () =>",
            "const semanticDetailFields = () =>",
            "const metadataProbe = () =>",
            "sTitle",
            "sRedName",
            "iRound",
            "metadataProbe: visible.title ? '' : metadataProbe()",
            "(?:先胜|先负|先和|后胜|后负|后和)",
            "[window.fdk, ...detailDisplayRoots()]",
            "visited < 40_000",
            "Date.now() < traversalDeadline",
            "const panelStart = pageText.indexOf('棋谱属性');",
            "title: firstUsableTitle('sTitle'",
            ") || visible.title,",
            "const rawResult = firstText('result'",
            ") || visible.result;",
        ] {
            assert!(
                bridge.contains(marker),
                "bridge script must retain {marker}"
            );
        }
        assert!(
            !bridge.contains("readDeadline"),
            "each game must receive its own bounded wait"
        );
    }

    #[test]
    fn rejects_qq_display_control_names_as_game_titles() {
        for title in [
            "Panel_BoardContainer<QipuChessBoardControl>",
            "preLinkChessBoardMark<PrefabLink>",
            "Panel_Qipu<PrefabLink>",
            "天天象棋 76867710688",
        ] {
            assert!(
                is_placeholder_title(title),
                "{title} must not become a game title"
            );
        }
        assert!(!is_placeholder_title("放飞[业9-2]先和[业9-2],29回合"));
    }

    #[test]
    fn bridge_does_not_treat_board_animation_state_as_moves() {
        let source = include_str!("ttxq_sync.rs");
        for marker in [
            "const knownMoveField = /(?:^|\\.)(?:getQipuMoveStep|getMainMoveList|getLessonNextMoveStep|qipuMoveStep|_qipuMoveStep|moveStep|_moveStep|moveList|_moveList|MOVE_STR|moveData)$/i;",
            "const safeMoveText = /^[0-9,\\s\\[\\]]+$/;",
            "Board animations such as moveFailEffect are not move lists.",
            "if (!iccs && !chinese && !dhtml) return null;",
        ] {
            assert!(
                source.contains(marker),
                "bridge must reject moveFailEffect: {marker}"
            );
        }
    }

    #[test]
    fn backup_folder_is_stable_and_non_empty() {
        assert_eq!(TTXQ_BACKUP_FOLDER, "天天象棋备份");
    }

    #[test]
    fn ordered_source_path_round_trips_without_misreading_legacy_paths() {
        let path = ordered_source_path("77048935338", 12);
        assert_eq!(path, "ttxq-order:000012:77048935338");
        assert_eq!(source_order_from_path(Some(&path)), Some(12));
        assert_eq!(source_order_from_path(Some("ttxq:77048935338")), None);
        assert_eq!(source_order_from_path(None), None);
    }

    #[test]
    fn remote_bridge_capability_is_limited_to_ttxq_and_three_commands() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/ttxq-bridge.json")).unwrap();
        assert_eq!(capability["local"], false);
        assert_eq!(
            capability["windows"],
            serde_json::json!([TTXQ_WINDOW_LABEL])
        );
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["ttxq-bridge"])
        );
        assert_eq!(
            capability["remote"]["urls"],
            serde_json::json!([
                "https://h5login.qqchess.qq.com/*",
                "https://*.qqchess.qq.com/*"
            ])
        );
        let permissions = include_str!("../permissions/desktop.toml");
        for command in [
            "submit_ttxq_bridge_payload",
            "report_ttxq_read_progress",
            "report_ttxq_bridge_error",
        ] {
            assert!(permissions.contains(&format!("\"{command}\"")));
        }
    }
}
