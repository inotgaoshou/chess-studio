use super::*;
use std::collections::{HashMap, HashSet};

#[path = "ttxq_annotations.rs"]
mod ttxq_annotations;
#[path = "ttxq_bridge.rs"]
mod ttxq_bridge;
#[path = "ttxq_diagnostics.rs"]
mod ttxq_diagnostics;
#[path = "ttxq_variations.rs"]
mod ttxq_variations;
pub(crate) use ttxq_annotations::{
    apply_annotations_to_document, local_ttxq_comment, merge_ttxq_local_comment, source_note,
    source_note_with_existing, update_existing_ttxq_annotations,
};
use ttxq_bridge::collect_ttxq_h5_history_impl;
#[allow(unused_imports)]
pub(crate) use ttxq_diagnostics::{
    dhtml_branch_absolute_anchor, diagnostic_summary, ttxq_annotation_diagnostic_sample,
    ttxq_annotation_failure_message, ttxq_annotation_key_samples, ttxq_branch_decode_failure,
    ttxq_branch_diagnostic_sample, ttxq_branch_failure_message, ttxq_branch_route_summary,
    ttxq_game_preview,
};
pub(crate) use ttxq_variations::*;

#[tauri::command]
pub(crate) fn collect_ttxq_h5_history(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    collect_ttxq_h5_history_impl(app, state)
}

const TTXQ_WINDOW_LABEL: &str = "ttxq-sync";
const BRIDGE_VERSION: u32 = 15;
const MAX_GAMES: usize = 20_000;
const MAX_SCAN_NODES: usize = 20_000;
const MAX_MOVES_PER_GAME: usize = 1_000;
const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
const TTXQ_BACKUP_FOLDER: &str = "天天象棋备份";
const TTXQ_ORDERED_SOURCE_PREFIX: &str = "ttxq-order:";
const BRIDGE_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const BRIDGE_PROGRESS_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const TTXQ_ANNOTATION_BEGIN: &str = "【天天象棋注解】";
const TTXQ_ANNOTATION_END: &str = "【天天象棋注解结束】";
const TTXQ_ANNOTATION_ITEM_BEGIN: &str = "【天天象棋注解条目】";
const TTXQ_ANNOTATION_ITEM_END: &str = "【天天象棋注解条目结束】";

fn default_true() -> bool {
    true
}

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

fn qipu_id_from_ordered_source_path(source_path: Option<&str>) -> Option<&str> {
    let source_path = source_path?;
    if let Some(id) = source_path.strip_prefix("ttxq:") {
        return (!id.is_empty()).then_some(id);
    }
    let id = source_path
        .strip_prefix(TTXQ_ORDERED_SOURCE_PREFIX)?
        .split_once(':')?
        .1;
    (!id.is_empty()).then_some(id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqVariationDto {
    pub after_ply: usize,
    pub moves: Vec<String>,
    #[serde(default)]
    pub route_no: Option<usize>,
    #[serde(default)]
    pub source_route_id: Option<usize>,
    #[serde(default)]
    pub source_key: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub children: Vec<TtxqVariationDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqAnnotationDto {
    pub source_route_id: usize,
    pub absolute_after_ply: usize,
    pub text: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub created_at: String,
    pub source_key: String,
    #[serde(default)]
    pub key_format: String,
}

impl<'de> Deserialize<'de> for TtxqAnnotationDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct WireAnnotation {
            #[serde(default)]
            source_route_id: Option<usize>,
            #[serde(default)]
            route_no: Option<usize>,
            #[serde(default)]
            absolute_after_ply: Option<usize>,
            #[serde(default)]
            after_ply: Option<usize>,
            text: String,
            #[serde(default)]
            author: String,
            #[serde(default)]
            created_at: String,
            source_key: String,
            #[serde(default)]
            key_format: String,
        }

        let wire = WireAnnotation::deserialize(deserializer)?;
        let (source_route_id, absolute_after_ply) = match (
            wire.source_route_id,
            wire.absolute_after_ply,
            wire.route_no,
            wire.after_ply,
        ) {
            (Some(source_route_id), Some(absolute_after_ply), _, _) => {
                (source_route_id, absolute_after_ply)
            }
            (None, None, Some(route_no), Some(after_ply)) if route_no > 0 => {
                (route_no - 1, after_ply)
            }
            _ => {
                return Err(<D::Error as serde::de::Error>::custom(
                    "天天象棋注解缺少完整的路线与绝对半回合位置",
                ));
            }
        };
        Ok(Self {
            source_route_id,
            absolute_after_ply,
            text: wire.text,
            author: wire.author,
            created_at: wire.created_at,
            source_key: wire.source_key,
            key_format: wire.key_format,
        })
    }
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
    #[serde(default)]
    pub annotations: Vec<TtxqAnnotationDto>,
    #[serde(default = "default_true")]
    pub annotations_complete: bool,
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
    /// Live bridge reads must carry the actual starting position.  Keeping
    /// this as a batch flag avoids silently replacing a self-recorded endgame
    /// with the standard opening position.
    #[serde(default)]
    pub require_starting_fen: bool,
    pub games: Vec<TtxqGameRecordDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtxqSyncProgressDto {
    pub state: String,
    pub bridge_version: u32,
    pub source_list: String,
    pub discovered_count: usize,
    pub ignored_stale_count: usize,
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
    pub annotation_count: usize,
    pub annotations_complete: bool,
    pub valid: bool,
    pub error: Option<String>,
    pub diagnostic: Option<String>,
}

impl Default for TtxqSyncProgressDto {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            bridge_version: BRIDGE_VERSION,
            source_list: String::new(),
            discovered_count: 0,
            ignored_stale_count: 0,
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
    fn has_same_variation(
        tree: &xiangqi_manual::ManualTree,
        anchor: Uuid,
        variation: &TtxqVariationDto,
    ) -> Result<bool, String> {
        let mut parent = anchor;
        let route_label = variation
            .route_no
            .map(|route_no| format!("天天象棋路线 {route_no}"));
        for (index, raw_move) in variation.moves.iter().enumerate() {
            let mv = Move::from_iccs(raw_move).map_err(|error| error.to_string())?;
            let branches = tree.branches(parent).map_err(|error| error.to_string())?;
            let node = branches
                .iter()
                .find(|node| {
                    node.mv == mv
                        && (index != 0
                            || route_label
                                .as_deref()
                                .is_none_or(|label| node.comment.contains(label)))
                })
                .or_else(|| branches.iter().find(|node| node.mv == mv));
            let Some(node) = node else { return Ok(false) };
            parent = node.id;
        }
        Ok(true)
    }
    for variation in &record.variations {
        let anchor = *parents.get(variation.after_ply).ok_or("变招位置超出主线")?;
        if has_same_variation(&document.tree, anchor, variation)? {
            continue;
        }
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
    let reordered = reconcile_ttxq_source_branch_order(model, game, record)?;
    Ok(added + reordered)
}

fn expected_ttxq_tree(
    starting_fen: &str,
    record: &TtxqGameRecordDto,
) -> Result<xiangqi_manual::ManualTree, String> {
    let mut document = ManualDocument::new(starting_fen).map_err(|error| error.to_string())?;
    let mut board = Board::from_fen(starting_fen).map_err(|error| error.to_string())?;
    let mut parents = vec![document.tree.root_id()];
    for raw_move in &record.moves {
        let mv = Move::from_iccs(raw_move).map_err(|error| error.to_string())?;
        board = board.apply_move(mv).map_err(|error| error.to_string())?;
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
            starting_fen,
            &record.moves,
            &parents,
            variation,
        )?;
    }
    Ok(document.tree)
}

fn reconcile_ttxq_source_branch_order(
    model: &mut AppModel,
    game: &local_store::LocalGame,
    record: &TtxqGameRecordDto,
) -> Result<usize, String> {
    let expected = expected_ttxq_tree(&game.starting_fen, record)?;
    let mut actual = xiangqi_manual::ManualTree::with_root(game.root_id);
    actual
        .restore_nodes(
            model
                .store
                .load_move_nodes(game.id)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    let mut pending = vec![(expected.root_id(), actual.root_id())];
    let mut reordered = 0;

    while let Some((expected_parent, actual_parent)) = pending.pop() {
        let expected_children = expected
            .branches(expected_parent)
            .map_err(|error| error.to_string())?;
        let actual_children = actual
            .branches(actual_parent)
            .map_err(|error| error.to_string())?;
        if expected_children.is_empty() || actual_children.is_empty() {
            continue;
        }

        let mut matched_actual_ids = HashSet::new();
        let mut source_ids = Vec::new();
        for expected_child in expected_children {
            if let Some(actual_child) = actual_children.iter().find(|actual_child| {
                !matched_actual_ids.contains(&actual_child.id)
                    && actual_child.mv == expected_child.mv
            }) {
                matched_actual_ids.insert(actual_child.id);
                source_ids.push(actual_child.id);
                pending.push((expected_child.id, actual_child.id));
            }
        }
        if source_ids.len() < 2 {
            continue;
        }

        let mut ordered_ids = source_ids;
        ordered_ids.extend(
            actual_children
                .iter()
                .filter(|node| !matched_actual_ids.contains(&node.id))
                .map(|node| node.id),
        );
        let current_ids = actual_children
            .iter()
            .map(|node| node.id)
            .collect::<Vec<_>>();
        if ordered_ids == current_ids {
            continue;
        }

        model.lamport += 1;
        let operation = Operation {
            op_id: Uuid::new_v4(),
            device_id: model.device_id,
            entity_id: actual_parent,
            game_id: game.id,
            kind: OperationKind::ReorderBranches,
            payload: serde_json::to_value(ReorderBranchesPayload {
                parent_id: actual_parent,
                node_ids: ordered_ids.clone(),
            })
            .map_err(|error| error.to_string())?,
            lamport: model.lamport,
            created_at: Utc::now(),
        };
        model
            .store
            .reorder_branches_with_operation(game.id, actual_parent, &ordered_ids, &operation)
            .map_err(|error| error.to_string())?;
        actual
            .reorder_branches(actual_parent, &ordered_ids)
            .map_err(|error| error.to_string())?;
        reordered += 1;
    }
    Ok(reordered)
}

fn reload_active_game_after_ttxq_import(
    model: &mut AppModel,
    active_game_id: Uuid,
    active_qipu_id: Option<&str>,
) -> Result<(), String> {
    // The active id can legitimately be stale after a local delete or after
    // list de-duplication of older Tencent imports. Import completion must not
    // turn that harmless race into a failed batch. Restore the same game when
    // possible, otherwise keep the current in-memory board and prefer the
    // newest valid local game as a replacement.
    if let Some(game) = model
        .store
        .load_game(active_game_id)
        .map_err(|error| error.to_string())?
    {
        return load_game_into_model(model, game);
    }
    if let Some(qipu_id) = active_qipu_id
        && let Some(canonical_id) = model
            .store
            .find_ttxq_game_id(qipu_id)
            .map_err(|error| error.to_string())?
        && let Some(game) = model
            .store
            .load_game(canonical_id)
            .map_err(|error| error.to_string())?
    {
        return load_game_into_model(model, game);
    }
    if let Some(game) = model
        .store
        .load_latest_game()
        .map_err(|error| error.to_string())?
    {
        return load_game_into_model(model, game);
    }
    Ok(())
}

fn finish_ttxq_import_attempt<T>(
    model: &mut AppModel,
    active_game_id: Uuid,
    active_qipu_id: Option<&str>,
    import_result: Result<T, String>,
) -> Result<T, String> {
    let restore_result =
        reload_active_game_after_ttxq_import(model, active_game_id, active_qipu_id);
    match (import_result, restore_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        // Import persistence has already completed at this point. A stale
        // active-game id or an invalid old replacement must not turn a
        // successful Tencent import into a misleading failure toast.
        (Ok(value), Err(_)) => Ok(value),
        (Err(error), Err(restore_error)) => {
            Err(format!("{error}；恢复导入前棋谱失败：{restore_error}"))
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
        if payload.require_starting_fen {
            let fen = game.starting_fen.trim();
            if fen.is_empty() {
                return Err(format!(
                    "棋谱 {} 未取得可校验的初始局面，拒绝导入以避免棋子丢失；请在天天象棋打开该盘后重新读取",
                    game.qipu_id
                ));
            }
            Board::from_fen(fen).map_err(|_| {
                format!(
                    "棋谱 {} 的初始局面格式无效，拒绝导入以避免棋子丢失",
                    game.qipu_id
                )
            })?;
        }
        if game.annotations.len() > 512
            || game.annotations.iter().any(|annotation| {
                annotation.source_route_id > 512
                    || annotation.absolute_after_ply > MAX_MOVES_PER_GAME
                    || annotation.text.len() > 8 * 1024
                    || annotation.author.len() > 200
                    || annotation.created_at.len() > 100
                    || annotation.source_key.len() > 500
                    || annotation.key_format.len() > 80
            })
        {
            return Err(format!("棋谱 {} 的注解数据异常", game.qipu_id));
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
    // Virtualized Tencent lists can expose the same qipu more than once while
    // its detail board is settling. Keep the most complete snapshot before
    // diagnostics and preview are generated; otherwise a transient
    // bridge-snapshot is shown beside the stable row and may win the import
    // race on a retry.
    payload.games = deduplicate_ttxq_batch(&payload.games)
        .into_iter()
        .cloned()
        .collect();
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
                // A shared loading/missing-move shape is recorded only once,
                // but it must never short-circuit this game's branch and
                // annotation validation.  The old `continue` here caused
                // later rows to lose their own annotation diagnostics and
                // made a single transient board snapshot look like a batch
                // of unrelated failures.
                if recorded_diagnostics.insert(signature) {
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
            if !game.annotations_complete {
                let annotation_failure = ttxq_annotation_failure_message(game);
                let annotation_sample = ttxq_annotation_diagnostic_sample(game);
                let signature = format!("annotation\u{1f}{annotation_failure}");
                if recorded_diagnostics.insert(signature) {
                    model
                        .store
                        .record_ttxq_diagnostic_sample(
                            &game.qipu_id,
                            if game.branch_path.trim().is_empty() {
                                "annotation-data"
                            } else {
                                &game.branch_path
                            },
                            "annotation-data",
                            game.branch_data.len(),
                            &annotation_sample,
                            &annotation_failure,
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
    let bridge_version = sync.progress.bridge_version;
    let source_list = sync.progress.source_list.clone();
    let discovered_count = sync.progress.discovered_count.max(read_total);
    let ignored_stale_count = sync.progress.ignored_stale_count;
    sync.progress = TtxqSyncProgressDto {
        state: "ready".into(),
        bridge_version,
        source_list,
        discovered_count,
        ignored_stale_count,
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
    bridge_version: Option<u32>,
    source_list: Option<String>,
    discovered_count: Option<usize>,
    ignored_stale_count: Option<usize>,
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
    let bridge_version = bridge_version.unwrap_or(sync.progress.bridge_version);
    if bridge_version != BRIDGE_VERSION {
        return Err(format!("天天象棋桥接版本不匹配：{bridge_version}"));
    }
    let source_list = source_list
        .unwrap_or_else(|| sync.progress.source_list.clone())
        .chars()
        .take(24)
        .collect::<String>();
    let discovered_count = discovered_count.unwrap_or(total.max(sync.progress.discovered_count));
    let ignored_stale_count = ignored_stale_count.unwrap_or(sync.progress.ignored_stale_count);
    sync.progress = TtxqSyncProgressDto {
        state: "reading".into(),
        bridge_version,
        source_list,
        discovered_count,
        ignored_stale_count,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TtxqImportOutcome {
    Imported(Uuid),
    Updated(Uuid),
    Skipped(Uuid),
    Failed,
}

fn move_imported_game_to_folder(
    model: &mut AppModel,
    game_id: Uuid,
    target_folder: &str,
) -> Result<(), String> {
    let Some(previous) = model
        .store
        .load_game(game_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    if previous.library_folder.as_deref() == Some(target_folder) {
        return Ok(());
    }
    let payload = library_metadata_payload(&previous, Some(target_folder.to_owned()));
    let operation = next_operation_for_game(
        model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_library_with_operation(
            game_id,
            Some(target_folder),
            previous.favorite,
            &previous.tags,
            &operation,
        )
        .map_err(|error| error.to_string())
}

fn import_ttxq_record(
    model: &mut AppModel,
    game: &TtxqGameRecordDto,
    source_order: usize,
    target_folder: &str,
    imported_at: &str,
) -> Result<TtxqImportOutcome, String> {
    // A missing FEN is ambiguous for self-recorded positions. The bridge
    // marks live payloads as requiring one, and import keeps the same guard
    // for retries or callers that bypass the collector.
    if game.starting_fen.trim().is_empty() {
        return Ok(TtxqImportOutcome::Failed);
    }
    let starting_fen = game.starting_fen.trim().to_owned();
    if Board::from_fen(&starting_fen).is_err() {
        return Ok(TtxqImportOutcome::Failed);
    }
    let imported_record = match prepare_import_record(game, &starting_fen) {
        Ok(record) => record,
        Err(_) => return Ok(TtxqImportOutcome::Failed),
    };
    let hash = payload_hash(&imported_record)?;
    // Prefer the provider mapping, but also recover rows created by older
    // bridge revisions that predate external_game_imports.  Without this
    // fallback, a retry after an interrupted import creates another copy even
    // though its ordered source path already identifies the same qipu.
    let existing_import = match model
        .store
        .external_game_import("ttxq", &game.qipu_id)
        .map_err(|error| error.to_string())?
    {
        Some(mapped)
            if model
                .store
                .load_game(mapped.game_id)
                .map_err(|error| error.to_string())?
                .is_some() =>
        {
            Some(mapped)
        }
        // A deleted row can leave an old mapping behind after an interrupted
        // deduplication. Ignore that mapping and recover the visible canonical
        // row by its provider-owned source path instead of reporting a skip for
        // a game that cannot be opened.
        _ => model
            .store
            .load_games()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|candidate| {
                qipu_id_from_ordered_source_path(candidate.source_path.as_deref())
                    == Some(game.qipu_id.as_str())
            })
            .map(|candidate| ExternalGameImport {
                provider: "ttxq".into(),
                external_id: game.qipu_id.clone(),
                game_id: candidate.id,
                payload_hash: String::new(),
                imported_at: candidate.updated_at,
            }),
    };
    if let Some(existing) = existing_import {
        model
            .store
            .set_game_source(
                existing.game_id,
                Some(&ordered_source_path(&game.qipu_id, source_order)),
                Some("ttxq-h5"),
            )
            .map_err(|error| error.to_string())?;
        let previous = model
            .store
            .load_game(existing.game_id)
            .map_err(|error| error.to_string())?;
        // A Tencent record can be observed more than once while its board is
        // settling. The transient payload may differ (for example, a shorter
        // mainline or a route activated in a different order) even though it
        // is still the same external qipu. Never create a revision copy for
        // that condition: the external mapping is the idempotency key.
        let same_mainline = previous
            .as_ref()
            .map(|game| same_persisted_mainline(model, game, &imported_record.moves))
            .transpose()?;
        if existing.payload_hash == hash && (previous.is_none() || same_mainline == Some(true)) {
            let (metadata_updated, added_variations, updated_annotations) = if let Some(previous) =
                &previous
            {
                let metadata_updated = backfill_existing_game(model, previous, &imported_record)?;
                let added_variations =
                    append_ttxq_variations_to_existing(model, previous, &imported_record)?;
                let updated_annotations =
                    update_existing_ttxq_annotations(model, previous, &imported_record)?;
                (metadata_updated, added_variations, updated_annotations)
            } else {
                (false, 0, 0)
            };
            move_imported_game_to_folder(model, existing.game_id, target_folder)?;
            let outcome = if metadata_updated || added_variations > 0 || updated_annotations > 0 {
                TtxqImportOutcome::Updated(existing.game_id)
            } else {
                TtxqImportOutcome::Skipped(existing.game_id)
            };
            model
                .store
                .clear_ttxq_user_deleted(&game.qipu_id)
                .map_err(|error| error.to_string())?;
            return Ok(outcome);
        }
        if let Some(previous) = previous {
            if same_mainline == Some(true) {
                let metadata_updated = backfill_existing_game(model, &previous, &imported_record)?;
                let added_variations =
                    append_ttxq_variations_to_existing(model, &previous, &imported_record)?;
                let updated_annotations =
                    update_existing_ttxq_annotations(model, &previous, &imported_record)?;
                move_imported_game_to_folder(model, previous.id, target_folder)?;
                model
                    .store
                    .record_external_game_import(
                        "ttxq",
                        &game.qipu_id,
                        previous.id,
                        &hash,
                        imported_at,
                    )
                    .map_err(|error| error.to_string())?;
                let outcome = if metadata_updated || added_variations > 0 || updated_annotations > 0
                {
                    TtxqImportOutcome::Updated(previous.id)
                } else {
                    TtxqImportOutcome::Skipped(previous.id)
                };
                model
                    .store
                    .clear_ttxq_user_deleted(&game.qipu_id)
                    .map_err(|error| error.to_string())?;
                return Ok(outcome);
            }

            // Keep the already imported game as the canonical record when the
            // live bridge supplied a conflicting mainline. Creating a new
            // "修订" game here made every retry produce another duplicate
            // title while the external mapping kept moving to the newest copy.
            // The next stable read can still enrich this same game in place.
            move_imported_game_to_folder(model, previous.id, target_folder)?;
            model
                .store
                .record_external_game_import("ttxq", &game.qipu_id, previous.id, &hash, imported_at)
                .map_err(|error| error.to_string())?;
            model
                .store
                .clear_ttxq_user_deleted(&game.qipu_id)
                .map_err(|error| error.to_string())?;
            return Ok(TtxqImportOutcome::Skipped(previous.id));
        }
    }
    match import_game(
        model,
        &imported_record,
        &hash,
        imported_at,
        source_order,
        target_folder,
    ) {
        Ok(game_id) => {
            model
                .store
                .record_external_game_import("ttxq", &game.qipu_id, game_id, &hash, imported_at)
                .map_err(|error| error.to_string())?;
            model
                .store
                .clear_ttxq_user_deleted(&game.qipu_id)
                .map_err(|error| error.to_string())?;
            Ok(TtxqImportOutcome::Imported(game_id))
        }
        Err(_) => Ok(TtxqImportOutcome::Failed),
    }
}

fn ttxq_record_stability_score(game: &TtxqGameRecordDto) -> u32 {
    let mut score = 0;
    let fen = game.starting_fen.trim();
    if !fen.is_empty() && Board::from_fen(fen).is_ok() {
        score += 1_000;
        if resolved_moves(game, fen).is_ok() {
            score += 500;
        }
    }
    if !game.moves.is_empty() {
        score += 250;
    } else if !game.raw_moves.trim().is_empty() {
        score += 25;
    }
    if game.branch_complete {
        score += 100;
    }
    if game.annotations_complete {
        score += 50;
    }
    score + game.annotations.len().min(32) as u32
}

fn deduplicate_ttxq_batch<'a>(games: &'a [TtxqGameRecordDto]) -> Vec<&'a TtxqGameRecordDto> {
    let mut selected = HashMap::<String, (usize, u32)>::new();
    for (index, game) in games.iter().enumerate() {
        let score = ttxq_record_stability_score(game);
        match selected.get_mut(&game.qipu_id) {
            Some((selected_index, selected_score)) if score > *selected_score => {
                *selected_index = index;
                *selected_score = score;
            }
            Some(_) => {}
            None => {
                selected.insert(game.qipu_id.clone(), (index, score));
            }
        }
    }
    let mut entries = selected.into_values().collect::<Vec<_>>();
    entries.sort_by_key(|(index, _)| *index);
    entries
        .into_iter()
        .filter_map(|(index, _)| games.get(index))
        .collect()
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
    let active_game_id = model.game_id;
    let active_qipu_id = model
        .store
        .load_game(active_game_id)
        .map_err(|error| error.to_string())?
        .and_then(|game| game.source_path)
        .and_then(|path| local_store::ttxq::qipu_id_from_source_path(&path).map(str::to_owned));
    // Repair duplicate active rows created by pre-idempotency bridge builds
    // before assigning this batch's source order. The canonical row keeps
    // user metadata; obsolete copies are local soft-deletes.
    model
        .store
        .reconcile_ttxq_duplicates()
        .map_err(|error| error.to_string())?;
    let target_folder = normalize_ttxq_target_folder(target_folder)?;
    // QQ can expose the same self-recorded game through several list roots.
    // Collapse the batch before assigning source order so a single read cannot
    // enqueue repeated imports for one provider-owned qipu id.
    let unique_games = deduplicate_ttxq_batch(&payload.games);
    let mut progress = TtxqSyncProgressDto {
        state: "importing".into(),
        loaded: unique_games.len(),
        message: "正在导入天天象棋棋谱".into(),
        ..TtxqSyncProgressDto::default()
    };
    let import_result = (|| -> Result<(), String> {
        for (source_order, game) in unique_games.iter().enumerate() {
            progress.completed += 1;
            let imported_at = Utc::now().to_rfc3339();
            match import_ttxq_record(&mut model, game, source_order, &target_folder, &imported_at)?
            {
                TtxqImportOutcome::Imported(_) | TtxqImportOutcome::Updated(_) => {
                    progress.imported += 1;
                }
                TtxqImportOutcome::Skipped(_) => progress.skipped += 1,
                TtxqImportOutcome::Failed => progress.failed += 1,
            }
        }
        Ok(())
    })();
    // Always restore and reload the review workspace, including after a
    // partially persisted batch fails before reaching the final game.
    finish_ttxq_import_attempt(
        &mut model,
        active_game_id,
        active_qipu_id.as_deref(),
        import_result,
    )?;
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
    // A self-recorded Tencent game may be a custom endgame. Falling back to
    // the standard opening here silently replaces its pieces, so the bridge
    // must provide a validated starting position before importing anything.
    let starting_fen = record.starting_fen.trim();
    if starting_fen.is_empty() {
        return Err(format!(
            "棋谱 {} 未取得可校验的初始局面，拒绝导入以避免棋子丢失",
            record.qipu_id
        ));
    }
    Board::from_fen(starting_fen).map_err(|error| {
        format!(
            "棋谱 {} 的初始局面格式无效，拒绝导入以避免棋子丢失：{error}",
            record.qipu_id
        )
    })?;
    let starting_fen = starting_fen.to_owned();
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
    apply_annotations_to_document(&mut document, &parents, &record)?;
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
    use serde::Deserialize;
    use std::io::Write;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RealBranchFailureFixtures {
        starting_fen: String,
        games: Vec<RealBranchFailureGame>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RealBranchFailureGame {
        qipu_id: String,
        mainline_raw: String,
        branches: Vec<(String, String)>,
    }

    fn real_branch_failure_fixtures() -> RealBranchFailureFixtures {
        serde_json::from_str(include_str!("../fixtures/ttxq/real_branch_failures.json"))
            .expect("real TTXQ branch fixture must be valid")
    }

    fn real_branch_record(
        fixture: &RealBranchFailureGame,
        starting_fen: &str,
    ) -> TtxqGameRecordDto {
        let mut record = ttxq_record(&fixture.qipu_id);
        record.starting_fen = starting_fen.to_owned();
        record.raw_moves = fixture.mainline_raw.clone();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.raw_move_length = record.raw_moves.len();
        record.branch_complete = false;
        record.branch_path = "NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey + msg".into();
        record.branch_data = serde_json::json!({
            "candidates": fixture.branches.iter().map(|(key, moves)| {
                serde_json::json!({
                    "path": format!("boardControl[0].getMoveBranchKey.{key}"),
                    "raw": moves,
                    "valueType": "string"
                })
            }).collect::<Vec<_>>()
        })
        .to_string();
        record
    }

    fn variation_route_count(variations: &[TtxqVariationDto]) -> usize {
        variations
            .iter()
            .map(|variation| 1 + variation_route_count(&variation.children))
            .sum()
    }

    #[test]
    fn dedupe_variations_orders_ttxq_routes_by_route_number() {
        let variation = |route_no, first_move: &str| TtxqVariationDto {
            after_ply: 11,
            moves: vec![first_move.into()],
            route_no: Some(route_no),
            source_route_id: Some(route_no),
            source_key: format!("0-12-{route_no}"),
            comment: String::new(),
            children: Vec::new(),
        };

        let ordered = dedupe_variations(vec![
            variation(3, "b2b6"),
            variation(2, "h6g6"),
            variation(1, "b0c2"),
        ]);

        assert_eq!(
            ordered
                .iter()
                .map(|variation| variation.route_no)
                .collect::<Vec<_>>(),
            vec![Some(1), Some(2), Some(3)]
        );
    }

    #[test]
    fn branch_route_numbers_keep_large_tencent_route_sets() {
        let routes = (1..=66).collect::<Vec<_>>();
        let payload = serde_json::json!({ "routeNumbers": routes }).to_string();
        let parsed = branch_route_numbers(&payload);
        assert_eq!(parsed.len(), 66);
        assert_eq!(parsed.last(), Some(&66));
    }

    fn assert_variation_topology(
        variations: &[TtxqVariationDto],
        expected_parent_route_id: usize,
        qipu_id: &str,
    ) {
        for variation in variations {
            let key = variation
                .source_key
                .rsplit_once("getMoveBranchKey.")
                .map(|(_, key)| key)
                .unwrap_or_else(|| panic!("{qipu_id} route must retain its source key"));
            let parts = key
                .split('-')
                .map(|part| part.parse::<usize>().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(parts.len(), 3, "{qipu_id} has an invalid route key");
            assert_eq!(
                parts[0], expected_parent_route_id,
                "{qipu_id} route {} must remain under its direct parent",
                parts[2]
            );
            assert_eq!(
                variation.after_ply,
                parts[1] - 1,
                "{qipu_id} route {} must use its one-based local start ply",
                parts[2]
            );
            assert_eq!(
                variation.source_route_id,
                Some(parts[2]),
                "{qipu_id} route {} must retain Tencent's source route id",
                parts[2]
            );
            assert_eq!(
                variation.route_no,
                Some(parts[2] + 1),
                "{qipu_id} route {} must reserve display route 1 for the mainline",
                parts[2]
            );
            assert_variation_topology(&variation.children, parts[2], qipu_id);
        }
    }

    fn collector_source_between(start_marker: &str, end_marker: &str) -> String {
        let source = include_str!("ttxq_bridge.rs");
        let start_marker =
            if start_marker == "      const branchPayload = (preferredControl = null) => {" {
                "      const isPrivateBridgeField = (key) =>"
            } else {
                start_marker
            };
        let start = source
            .find(start_marker)
            .expect("collector marker must exist");
        let end = source[start..]
            .find(end_marker)
            .expect("collector end marker must exist")
            + start;
        source[start..end].replace("__TTXQ_BRIDGE_VERSION__", &BRIDGE_VERSION.to_string())
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
            starting_fen: STARTING_FEN.into(),
            moves: Vec::new(),
            raw_moves: String::new(),
            raw_move_path: String::new(),
            raw_move_type: String::new(),
            raw_move_length: 0,
            variations: Vec::new(),
            annotations: Vec::new(),
            annotations_complete: true,
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

    #[test]
    fn bridge_batches_reject_missing_starting_fen_instead_of_using_standard_board() {
        let mut game = ttxq_record("custom-endgame-without-fen");
        game.starting_fen.clear();
        game.moves = vec!["h2e2".into()];
        let payload = TtxqBridgePayloadDto {
            version: BRIDGE_VERSION,
            require_starting_fen: true,
            games: vec![game],
        };
        let error = validate_payload(&payload).unwrap_err();
        assert!(error.contains("未取得可校验的初始局面"), "{error}");
    }

    #[test]
    fn batch_deduplication_prefers_a_stable_duplicate_over_bridge_snapshot() {
        let mut unstable = ttxq_record("same-qipu");
        unstable.starting_fen.clear();
        unstable.moves.clear();
        unstable.raw_move_path = "bridge-snapshot".into();
        let mut stable = ttxq_record("same-qipu");
        stable.moves = vec!["h2e2".into()];
        let batch = [unstable, stable];
        let selected = deduplicate_ttxq_batch(&batch);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].raw_move_path, "");
        assert_eq!(selected[0].moves, ["h2e2"]);
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
    fn ttxq_annotations_import_to_positions_and_reimport_preserves_local_notes() {
        let mut model = test_app_model();
        let mut record = ttxq_record("annotation-game");
        record.title = "带注解棋谱".into();
        record.moves = vec!["h2e2".into()];
        record.note = "本地整谱备注".into();
        record.annotations = vec![
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 0,
                text: "整谱说明".into(),
                author: "作者甲".into(),
                created_at: "2026-08-31 10:00".into(),
                source_key: "root-1".into(),
                key_format: "root-alias".into(),
            },
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 1,
                text: "进边兵制马".into(),
                author: "作者乙".into(),
                created_at: "2026-08-31 10:01".into(),
                source_key: "0-1".into(),
                key_format: "dhtml-comment".into(),
            },
        ];
        let game_id = import_game(
            &mut model,
            &record,
            "sha256:annotations-1",
            "2026-08-31T10:00:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let game = model.store.load_game(game_id).unwrap().unwrap();
        assert!(game.note.contains("整谱说明"));
        assert!(game.note.contains("本地整谱备注"));
        let node = model.store.load_move_nodes(game_id).unwrap().remove(0);
        assert!(node.comment.contains("进边兵制马"));

        let local_comment = merge_ttxq_local_comment(&node.comment, "我的本地备注");
        let operation = next_operation_for_game(
            &mut model,
            game_id,
            OperationKind::UpdateComment,
            serde_json::to_value(UpdateCommentPayload {
                node_id: node.id,
                comment: local_comment.clone(),
            })
            .unwrap(),
        );
        model
            .store
            .update_comment_with_operation(node.id, &local_comment, &operation)
            .unwrap();
        record.annotations[1].text = "更新后的腾讯注解".into();
        update_existing_ttxq_annotations(&mut model, &game, &record).unwrap();
        let updated = model.store.load_move_nodes(game_id).unwrap().remove(0);
        assert!(updated.comment.contains("更新后的腾讯注解"));
        assert!(updated.comment.contains("我的本地备注"));
        assert!(!updated.comment.contains("进边兵制马"));

        record.annotations.clear();
        assert_eq!(
            update_existing_ttxq_annotations(&mut model, &game, &record).unwrap(),
            0
        );
        let cleared_game = model.store.load_game(game_id).unwrap().unwrap();
        assert!(cleared_game.note.contains(TTXQ_ANNOTATION_BEGIN));
        assert!(cleared_game.note.contains("本地整谱备注"));
        let cleared = model.store.load_move_nodes(game_id).unwrap().remove(0);
        assert!(cleared.comment.contains(TTXQ_ANNOTATION_BEGIN));
        assert!(cleared.comment.contains("我的本地备注"));
    }

    #[test]
    fn imports_real_get_qipu_ubb_with_mainline_branch_and_comment_v2_annotations() {
        let starting_fen = "2bak4/4a4/9/4pNpNp/6b2/9/4P4/3p5/crR1K3C/2nr5 w - - 0 1";
        let mut record = ttxq_record("borrow-cannon-use-horse-2");
        record.title = "借炮使马（2）".into();
        record.starting_fen = starting_fen.into();
        record.raw_moves = "736140508858415253655241655741525776524176554152554352414355415255345241345341525332524161534152536552416557415257765241765541525563524163514152513052413051415251725241725341525365524165574152573852412820".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-41-1",
                "raw": "517052417062",
                "valueType": "string"
            }]
        })
        .to_string();
        record.annotations = vec![
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 0,
                text: "借炮使马二".into(),
                author: String::new(),
                created_at: String::new(),
                source_key: "commentV2.0[0]".into(),
                key_format: "mainline-ply".into(),
            },
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 21,
                text: "换岗".into(),
                author: String::new(),
                created_at: String::new(),
                source_key: "commentV2.21[0]".into(),
                key_format: "mainline-ply".into(),
            },
            TtxqAnnotationDto {
                source_route_id: 1,
                absolute_after_ply: 43,
                text: "红可简胜".into(),
                author: String::new(),
                created_at: String::new(),
                source_key: "commentV2.1-44[0]".into(),
                key_format: "ttxq-comment-v2-route-ply".into(),
            },
        ];

        let prepared = prepare_import_record(&record, starting_fen).unwrap();
        assert_eq!(prepared.moves.len(), 51);
        assert_eq!(prepared.variations.len(), 1);
        assert_eq!(prepared.variations[0].after_ply, 40);
        assert_eq!(prepared.variations[0].moves.len(), 3);

        let mut model = test_app_model();
        let game_id = import_game(
            &mut model,
            &prepared,
            "sha256:borrow-cannon-use-horse-2",
            "2026-09-09T00:00:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let game = model.store.load_game(game_id).unwrap().unwrap();
        assert!(game.note.contains("借炮使马二"));
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        assert!(nodes.iter().any(|node| node.comment.contains("换岗")));
        assert!(nodes.iter().any(|node| node.comment.contains("红可简胜")));
    }

    #[test]
    fn annotations_at_different_absolute_plies_are_stored_on_different_nodes() {
        let mut model = test_app_model();
        let mut record = ttxq_record("annotation-position-separation");
        record.moves = vec!["h2e2".into(), "h9g7".into(), "g3g4".into()];
        record.annotations = [(1, "第一半回合"), (2, "第二半回合"), (3, "第三半回合")]
            .into_iter()
            .map(|(absolute_after_ply, text)| TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply,
                text: text.into(),
                author: "作者".into(),
                created_at: format!("15:0{absolute_after_ply}"),
                source_key: format!("comment0_{absolute_after_ply}"),
                key_format: "dhtml-comment".into(),
            })
            .collect();
        let game_id = import_game(
            &mut model,
            &record,
            "sha256:annotation-position-separation",
            "2026-08-31T12:00:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        for (iccs, text) in [
            ("h2e2", "第一半回合"),
            ("h9g7", "第二半回合"),
            ("g3g4", "第三半回合"),
        ] {
            let node = nodes.iter().find(|node| node.mv.to_iccs() == iccs).unwrap();
            assert!(
                node.comment.contains(text),
                "{iccs} must retain its own annotation"
            );
            assert!(
                nodes
                    .iter()
                    .filter(|other| other.id != node.id)
                    .all(|other| !other.comment.contains(text))
            );
        }
    }

    #[test]
    fn reimported_annotations_clear_previous_wrong_node_bindings() {
        let mut model = test_app_model();
        let mut record = ttxq_record("annotation-rebind");
        record.moves = vec!["h2e2".into(), "h9g7".into()];
        let game_id = import_game(
            &mut model,
            &record,
            "sha256:annotation-rebind",
            "2026-08-31T12:10:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let game = model.store.load_game(game_id).unwrap().unwrap();
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        let first = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "h2e2")
            .unwrap();
        let second = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "h9g7")
            .unwrap();
        let old_wrong_comment = format!(
            "{TTXQ_ANNOTATION_BEGIN}\n{TTXQ_ANNOTATION_ITEM_BEGIN}\n曹振华 · 23-08-17 16:55\n不属于第一步的旧聚合注解\n{TTXQ_ANNOTATION_ITEM_END}\n{TTXQ_ANNOTATION_END}"
        );
        let operation = next_operation_for_game(
            &mut model,
            game_id,
            OperationKind::UpdateComment,
            serde_json::to_value(UpdateCommentPayload {
                node_id: first.id,
                comment: old_wrong_comment.clone(),
            })
            .unwrap(),
        );
        model
            .store
            .update_comment_with_operation(first.id, &old_wrong_comment, &operation)
            .unwrap();

        record.annotations = vec![
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 0,
                text: "根局面说明".into(),
                author: "曹振华".into(),
                created_at: "23-08-17 15:20".into(),
                source_key: "comment0_0".into(),
                key_format: "dhtml-comment".into(),
            },
            TtxqAnnotationDto {
                source_route_id: 0,
                absolute_after_ply: 2,
                text: "第二步唯一注解".into(),
                author: "曹振华".into(),
                created_at: "23-08-17 15:22".into(),
                source_key: "comment0_2".into(),
                key_format: "dhtml-comment".into(),
            },
        ];
        let changed = update_existing_ttxq_annotations(&mut model, &game, &record).unwrap();
        assert!(changed >= 2);
        let updated_nodes = model.store.load_move_nodes(game_id).unwrap();
        let updated_first = updated_nodes
            .iter()
            .find(|node| node.id == first.id)
            .unwrap();
        let updated_second = updated_nodes
            .iter()
            .find(|node| node.id == second.id)
            .unwrap();
        assert!(!updated_first.comment.contains(TTXQ_ANNOTATION_BEGIN));
        assert!(!updated_first.comment.contains("旧聚合注解"));
        assert!(updated_second.comment.contains("第二步唯一注解"));
        assert_eq!(updated_second.comment.matches("第二步唯一注解").count(), 1);
        assert!(!updated_second.comment.contains("旧聚合注解"));
    }

    #[test]
    fn nested_route_annotations_use_absolute_ply_indexes() {
        let mut model = test_app_model();
        let mut record = ttxq_record("nested-annotation-game");
        record.title = "嵌套注解棋谱".into();
        record.moves = vec!["h2e2".into(), "h9g7".into()];
        record.variations = vec![TtxqVariationDto {
            after_ply: 1,
            moves: vec!["b9c7".into()],
            route_no: Some(3),
            source_route_id: Some(2),
            source_key: "0-2-2".into(),
            comment: String::new(),
            children: vec![TtxqVariationDto {
                after_ply: 1,
                moves: vec!["h0g2".into()],
                route_no: Some(4),
                source_route_id: Some(3),
                source_key: "2-2-3".into(),
                comment: String::new(),
                children: vec![],
            }],
        }];
        record.annotations = vec![TtxqAnnotationDto {
            source_route_id: 3,
            absolute_after_ply: 3,
            text: "嵌套路线首着注解".into(),
            author: "作者乙".into(),
            created_at: "2026-08-31 11:00".into(),
            source_key: "0-3".into(),
            key_format: "dhtml-comment".into(),
        }];

        let game_id = import_game(
            &mut model,
            &record,
            "sha256:nested-annotations",
            "2026-08-31T11:00:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        let annotated = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "h0g2")
            .expect("nested route move");
        assert!(annotated.comment.contains("嵌套路线首着注解"));
        assert!(
            !nodes
                .iter()
                .find(|node| node.mv.to_iccs() == "b9c7")
                .expect("parent route move")
                .comment
                .contains("嵌套路线首着注解")
        );
    }

    #[test]
    fn source_route_zero_and_first_branch_annotations_do_not_collide() {
        let mut model = test_app_model();
        let branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-2-1",
                "raw": "1022",
                "valueType": "string"
            }]
        })
        .to_string();
        let bridge_record: TtxqGameRecordDto = serde_json::from_value(serde_json::json!({
            "qipuId": "source-route-one-annotation-game",
            "moves": ["h2e2", "h9g7"],
            "branchData": branch_data,
            "branchPath": "NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey + msg",
            "branchComplete": false,
            "annotations": [
                {
                    "sourceRouteId": 0,
                    "absoluteAfterPly": 1,
                    "text": "主线第一着注解",
                    "sourceKey": "comment0_1",
                    "keyFormat": "dhtml-comment"
                },
                {
                    "sourceRouteId": 1,
                    "absoluteAfterPly": 2,
                    "text": "第一分支首着注解",
                    "sourceKey": "comment1_2",
                    "keyFormat": "dhtml-comment"
                }
            ],
            "annotationsComplete": true
        }))
        .unwrap();
        let record = prepare_import_record(&bridge_record, STARTING_FEN).unwrap();
        assert_eq!(record.variations[0].source_route_id, Some(1));
        assert_eq!(record.variations[0].route_no, Some(2));

        let game_id = import_game(
            &mut model,
            &record,
            "sha256:source-route-one-annotations",
            "2026-08-31T11:30:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        let mainline = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "h2e2")
            .unwrap();
        let branch = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "b9c7")
            .unwrap();
        assert!(mainline.comment.contains("主线第一着注解"));
        assert!(!mainline.comment.contains("第一分支首着注解"));
        assert!(branch.comment.contains("第一分支首着注解"));
        assert!(!branch.comment.contains("主线第一着注解"));
    }

    #[test]
    fn prepare_import_record_retains_the_validated_starting_fen() {
        let mut record = ttxq_record("prepared-fen");
        record.starting_fen.clear();
        record.moves = vec!["h2e2".into(), "h9g7".into()];
        let prepared = prepare_import_record(&record, STARTING_FEN).unwrap();
        assert_eq!(prepared.starting_fen, STARTING_FEN);
    }

    #[test]
    fn tencent_route_ply_annotation_imports_to_its_source_branch_node() {
        let mut model = test_app_model();
        let branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-2-11",
                "raw": "1022",
                "valueType": "string"
            }]
        })
        .to_string();
        let bridge_record: TtxqGameRecordDto = serde_json::from_value(serde_json::json!({
            "qipuId": "ttxq-route-ply-annotation",
            "moves": ["h2e2", "h9g7"],
            "branchData": branch_data,
            "branchPath": "NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey",
            "branchComplete": false,
            "annotations": [{
                "sourceRouteId": 11,
                "absoluteAfterPly": 2,
                "text": "路线 11 的第 2 半回合注解",
                "sourceKey": "boardControl[0].comments.msgContainer.11-2[0]",
                "keyFormat": "ttxq-route-ply"
            }],
            "annotationsComplete": true
        }))
        .unwrap();
        let record = prepare_import_record(&bridge_record, STARTING_FEN).unwrap();
        assert_eq!(record.variations[0].source_route_id, Some(11));

        let game_id = import_game(
            &mut model,
            &record,
            "sha256:ttxq-route-ply-annotation",
            "2026-08-31T15:00:00Z",
            0,
            TTXQ_BACKUP_FOLDER,
        )
        .unwrap();
        let nodes = model.store.load_move_nodes(game_id).unwrap();
        let branch = nodes
            .iter()
            .find(|node| node.mv.to_iccs() == "b9c7")
            .expect("source route 11 branch node");
        assert!(branch.comment.contains("路线 11 的第 2 半回合注解"));
        assert!(
            !nodes
                .iter()
                .find(|node| node.mv.to_iccs() == "h9g7")
                .expect("mainline reply")
                .comment
                .contains("路线 11 的第 2 半回合注解")
        );
    }

    #[test]
    fn legacy_annotation_route_numbers_migrate_to_source_route_ids() {
        let mainline: TtxqAnnotationDto = serde_json::from_value(serde_json::json!({
            "routeNo": 1,
            "afterPly": 0,
            "text": "旧主线注解",
            "sourceKey": "root-1"
        }))
        .unwrap();
        let first_branch: TtxqAnnotationDto = serde_json::from_value(serde_json::json!({
            "routeNo": 2,
            "afterPly": 3,
            "text": "旧第一分支注解",
            "sourceKey": "2-2"
        }))
        .unwrap();

        assert_eq!(mainline.source_route_id, 0);
        assert_eq!(mainline.absolute_after_ply, 0);
        assert_eq!(first_branch.source_route_id, 1);
        assert_eq!(first_branch.absolute_after_ply, 3);

        let missing_position = serde_json::from_value::<TtxqAnnotationDto>(serde_json::json!({
            "text": "缺少位置的注解",
            "sourceKey": "unknown"
        }));
        let null_position = serde_json::from_value::<TtxqAnnotationDto>(serde_json::json!({
            "sourceRouteId": null,
            "absoluteAfterPly": null,
            "text": "空位置注解",
            "sourceKey": "unknown-null"
        }));
        assert!(missing_position.is_err());
        assert!(null_position.is_err());
        let zero_route = serde_json::from_value::<TtxqAnnotationDto>(serde_json::json!({
            "routeNo": 0,
            "afterPly": 0,
            "text": "非法旧路线",
            "sourceKey": "legacy-zero"
        }));
        assert!(zero_route.is_err());
    }

    #[test]
    fn annotation_diagnostic_keeps_keys_but_not_private_content() {
        let mut record = ttxq_record("annotation-diagnostic");
        record.annotations_complete = false;
        record.branch_data = serde_json::json!({
            "annotationKeySamples": [{
                "path": "boardControl[0].comments.msgContainer.comment-route-x",
                "key": "comment-route-x",
                "keyFormat": "unknown",
                "rows": 1,
                "hasMsg": true,
                "hasTime": true,
                "hasUname": true
            }]
        })
        .to_string();
        record.annotations = vec![TtxqAnnotationDto {
            source_route_id: 0,
            absolute_after_ply: 0,
            text: "不应写入诊断的完整注解正文".into(),
            author: "不应写入诊断的作者".into(),
            created_at: "23-08-17 15:20".into(),
            source_key: "comment-route-x[0]".into(),
            key_format: "unknown".into(),
        }];

        let error = ttxq_annotation_failure_message(&record);
        let sample = ttxq_annotation_diagnostic_sample(&record);

        assert!(error.contains("comment-route-x"));
        assert!(sample.contains("comment-route-x"));
        assert!(sample.contains("textLength"));
        assert!(!sample.contains("完整注解正文"));
        assert!(!sample.contains("诊断的作者"));
        assert!(!sample.contains("23-08-17"));
    }

    #[test]
    fn annotation_location_errors_report_available_routes_and_maximum_ply() {
        let mut missing_route = ttxq_record("annotation-missing-route");
        missing_route.moves = vec!["h2e2".into()];
        missing_route.annotations = vec![TtxqAnnotationDto {
            source_route_id: 11,
            absolute_after_ply: 2,
            text: "路线注解".into(),
            author: String::new(),
            created_at: String::new(),
            source_key: "11-2[0]".into(),
            key_format: "ttxq-route-ply".into(),
        }];
        let error = prepare_import_record(&missing_route, STARTING_FEN).unwrap_err();
        assert!(error.contains("路线 11 不存在"), "{error}");
        assert!(error.contains("已解析路线 0"), "{error}");

        let mut overflow = ttxq_record("annotation-overflow");
        overflow.moves = vec!["h2e2".into()];
        overflow.annotations = vec![TtxqAnnotationDto {
            source_route_id: 0,
            absolute_after_ply: 2,
            text: "越界注解".into(),
            author: String::new(),
            created_at: String::new(),
            source_key: "0-2[0]".into(),
            key_format: "ttxq-route-ply".into(),
        }];
        let error = prepare_import_record(&overflow, STARTING_FEN).unwrap_err();
        assert!(error.contains("最大绝对位置 1"), "{error}");
    }

    #[test]
    fn real_bridge_branch_payloads_decode_and_import_complete_sqlite_trees() {
        let fixtures = real_branch_failure_fixtures();
        let mut model = test_app_model();

        for (source_order, fixture) in fixtures.games.iter().enumerate() {
            let record = real_branch_record(fixture, &fixtures.starting_fen);
            let prepared = prepare_import_record(&record, &fixtures.starting_fen)
                .unwrap_or_else(|error| panic!("{} must decode: {error}", fixture.qipu_id));
            assert_eq!(
                variation_route_count(&prepared.variations),
                fixture.branches.len(),
                "{} must preserve every captured route",
                fixture.qipu_id
            );
            let mut expected_route_ids = fixture
                .branches
                .iter()
                .map(|(key, _)| key.rsplit('-').next().unwrap().parse::<usize>().unwrap())
                .collect::<Vec<_>>();
            expected_route_ids.sort_unstable();
            assert_eq!(
                expected_branch_routes(&record.branch_data),
                expected_route_ids,
                "{} must include every Dhtml route in completeness checks",
                fixture.qipu_id
            );
            assert_variation_topology(&prepared.variations, 0, &fixture.qipu_id);

            let preview = ttxq_game_preview(&record);
            assert!(preview.valid, "{} must be previewable", fixture.qipu_id);
            assert_eq!(
                preview.route_count,
                fixture.branches.len(),
                "{} preview must report every captured route",
                fixture.qipu_id
            );
            assert_eq!(
                preview.decoded_route_count,
                fixture.branches.len(),
                "{} preview must report every decoded route",
                fixture.qipu_id
            );

            let outcome = import_ttxq_record(
                &mut model,
                &record,
                source_order,
                TTXQ_BACKUP_FOLDER,
                "2026-08-30T00:00:00Z",
            )
            .unwrap_or_else(|error| panic!("{} must import: {error}", fixture.qipu_id));
            let TtxqImportOutcome::Imported(game_id) = outcome else {
                panic!(
                    "{} must be newly imported, got {outcome:?}",
                    fixture.qipu_id
                );
            };
            let nodes = model.store.load_move_nodes(game_id).unwrap();
            assert!(
                nodes.iter().any(|node| !node.deleted && !node.is_mainline),
                "{} must persist non-mainline nodes",
                fixture.qipu_id
            );
            assert!(
                model
                    .store
                    .pending_operations(10_000)
                    .unwrap()
                    .iter()
                    .any(|operation| {
                        operation.game_id == game_id && operation.kind == OperationKind::AddMove
                    })
            );
        }
    }

    #[test]
    fn reimporting_a_real_branch_payload_does_not_duplicate_the_game_or_tree() {
        let fixtures = real_branch_failure_fixtures();
        let fixture = fixtures
            .games
            .iter()
            .find(|fixture| fixture.qipu_id == "77610281933")
            .unwrap();
        let record = real_branch_record(fixture, &fixtures.starting_fen);
        let mut model = test_app_model();

        let first = import_ttxq_record(
            &mut model,
            &record,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:00:00Z",
        )
        .unwrap();
        let TtxqImportOutcome::Imported(game_id) = first else {
            panic!("first import must create a game, got {first:?}");
        };
        let initial_nodes = model.store.load_move_nodes(game_id).unwrap();
        let initial_operation_count = model.store.pending_operations(10_000).unwrap().len();

        let second = import_ttxq_record(
            &mut model,
            &record,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:01:00Z",
        )
        .unwrap();

        assert_eq!(second, TtxqImportOutcome::Skipped(game_id));
        assert_eq!(model.store.load_games().unwrap().len(), 1);
        assert_eq!(model.store.load_move_nodes(game_id).unwrap(), initial_nodes);
        assert_eq!(
            model.store.pending_operations(10_000).unwrap().len(),
            initial_operation_count
        );
    }

    #[test]
    fn reimporting_a_transiently_different_mainline_does_not_create_a_revision_copy() {
        let mut model = test_app_model();
        let mut first = ttxq_record("same-qipu-transient-mainline");
        first.title = "同一天天象棋棋谱".into();
        first.moves = vec!["h2e2".into()];
        let first_id = match import_ttxq_record(
            &mut model,
            &first,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:00:00Z",
        )
        .unwrap()
        {
            TtxqImportOutcome::Imported(id) => id,
            outcome => panic!("first import must create a game, got {outcome:?}"),
        };
        let mut settled = first.clone();
        settled.moves = vec!["h2e2".into(), "h9g7".into()];
        let outcome = import_ttxq_record(
            &mut model,
            &settled,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:01:00Z",
        )
        .unwrap();

        assert_eq!(outcome, TtxqImportOutcome::Skipped(first_id));
        assert_eq!(model.store.load_games().unwrap().len(), 1);
        assert_eq!(
            model
                .store
                .external_game_import("ttxq", "same-qipu-transient-mainline")
                .unwrap()
                .unwrap()
                .game_id,
            first_id
        );
    }

    #[test]
    fn reimport_repairs_legacy_ttxq_route_order_once_without_recreating_nodes() {
        let fixtures = real_branch_failure_fixtures();
        let fixture = fixtures
            .games
            .iter()
            .find(|fixture| fixture.qipu_id == "77610272440")
            .unwrap();
        let record = real_branch_record(fixture, &fixtures.starting_fen);
        let mut model = test_app_model();
        let first = import_ttxq_record(
            &mut model,
            &record,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:00:00Z",
        )
        .unwrap();
        let TtxqImportOutcome::Imported(game_id) = first else {
            panic!("first import must create the fixture game, got {first:?}");
        };
        let game = model.store.load_game(game_id).unwrap().unwrap();
        let initial_nodes = model.store.load_move_nodes(game_id).unwrap();
        let mut tree = xiangqi_manual::ManualTree::with_root(game.root_id);
        tree.restore_nodes(initial_nodes.clone()).unwrap();
        let branch_parent = initial_nodes
            .iter()
            .map(|node| node.parent_id)
            .find(|parent_id| {
                let branches = tree.branches(*parent_id).unwrap();
                [2, 3, 4].iter().all(|route_no| {
                    branches
                        .iter()
                        .any(|node| node.comment.contains(&format!("天天象棋路线 {route_no}")))
                })
            })
            .expect("fixture must contain the four-way root branch");
        let branches = tree.branches(branch_parent).unwrap();
        let mainline = branches.iter().find(|node| node.is_mainline).unwrap().id;
        let route_id = |route_no| {
            branches
                .iter()
                .find(|node| node.comment.contains(&format!("天天象棋路线 {route_no}")))
                .unwrap()
                .id
        };
        assert_eq!(
            branches
                .iter()
                .map(|node| node.mv.to_iccs())
                .collect::<Vec<_>>(),
            vec!["e4e5", "b0c2", "h6g6", "b2b6"]
        );

        let legacy_order = vec![mainline, route_id(4), route_id(3), route_id(2)];
        let legacy_operation = next_operation_for_game(
            &mut model,
            game_id,
            OperationKind::ReorderBranches,
            serde_json::to_value(ReorderBranchesPayload {
                parent_id: branch_parent,
                node_ids: legacy_order.clone(),
            })
            .unwrap(),
        );
        model
            .store
            .reorder_branches_with_operation(
                game_id,
                branch_parent,
                &legacy_order,
                &legacy_operation,
            )
            .unwrap();
        let operations_before_repair = model.store.pending_operations(10_000).unwrap().len();

        let repaired = import_ttxq_record(
            &mut model,
            &record,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:01:00Z",
        )
        .unwrap();
        assert_eq!(repaired, TtxqImportOutcome::Updated(game_id));
        let repaired_nodes = model.store.load_move_nodes(game_id).unwrap();
        let mut repaired_tree = xiangqi_manual::ManualTree::with_root(game.root_id);
        repaired_tree.restore_nodes(repaired_nodes.clone()).unwrap();
        assert_eq!(
            repaired_tree
                .branches(branch_parent)
                .unwrap()
                .iter()
                .map(|node| node.mv.to_iccs())
                .collect::<Vec<_>>(),
            vec!["e4e5", "b0c2", "h6g6", "b2b6"]
        );
        assert_eq!(repaired_nodes.len(), initial_nodes.len());
        assert_eq!(
            model.store.pending_operations(10_000).unwrap().len(),
            operations_before_repair + 1
        );

        let operations_after_repair = model.store.pending_operations(10_000).unwrap().len();
        let repeated = import_ttxq_record(
            &mut model,
            &record,
            0,
            TTXQ_BACKUP_FOLDER,
            "2026-08-30T00:02:00Z",
        )
        .unwrap();
        assert_eq!(repeated, TtxqImportOutcome::Skipped(game_id));
        assert_eq!(
            model.store.pending_operations(10_000).unwrap().len(),
            operations_after_repair
        );
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
        assert_eq!(prepared.variations[0].source_route_id, Some(1));
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
    fn preview_rejects_a_self_recorded_game_without_starting_fen() {
        let mut record = ttxq_record("self-recorded-missing-fen");
        record.starting_fen.clear();
        record.moves = vec!["c3c4".into()];
        record.raw_moves = "c3c4".into();
        let preview = ttxq_game_preview(&record);
        assert!(!preview.valid);
        assert_eq!(preview.move_count, 0);
        assert!(
            preview
                .error
                .as_deref()
                .is_some_and(|error| error.contains("初始局面"))
        );
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
                    "path": "boardControl[0].getMoveBranchKey.1-2-22",
                    "raw": "7082",
                    "valueType": "string",
                    "afterPly": 22
                }
            ]
        })
        .to_string();

        let prepared = prepare_import_record(&record, STARTING_FEN).unwrap();

        assert_eq!(prepared.variations.len(), 1);
        let root_branch = &prepared.variations[0];
        assert_eq!(root_branch.after_ply, 0);
        assert_eq!(root_branch.moves, ["b0c2", "b9c7"]);
        assert_eq!(root_branch.children.len(), 1);
        assert_eq!(root_branch.children[0].after_ply, 1);
        assert_eq!(root_branch.children[0].moves, ["h9i7"]);
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
                "path": "boardControl[0].getMoveBranchKey.0-2-1",
                "raw": "2625",
                "valueType": "string",
                "afterPly": 1
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("第 1 半回合后首着 c3c4非法"), "{error}");
        assert!(error.contains("DhtmlXQ 左上角坐标"), "{error}");
    }

    #[test]
    fn real_dhtml_branch_keys_preserve_parent_local_anchors() {
        assert!(dhtml_branch_key("msg.variation.0-11-1").is_none());
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-11-1"),
            Some(DhtmlBranchKey {
                parent_route_id: 0,
                local_start_ply_1_based: 11,
                route_id: 1,
            })
        );
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-13-4"),
            Some(DhtmlBranchKey {
                parent_route_id: 0,
                local_start_ply_1_based: 13,
                route_id: 4,
            })
        );
        assert_eq!(
            dhtml_branch_key("boardControl[0].getMoveBranchKey.0-19-5"),
            Some(DhtmlBranchKey {
                parent_route_id: 0,
                local_start_ply_1_based: 19,
                route_id: 5,
            })
        );
        let nested = dhtml_branch_key("boardControl[0].getMoveBranchKey.3-8-6").unwrap();
        let keys = HashMap::from([
            (
                3,
                DhtmlBranchKey {
                    parent_route_id: 0,
                    local_start_ply_1_based: 10,
                    route_id: 3,
                },
            ),
            (6, nested),
        ]);
        assert_eq!(
            dhtml_branch_absolute_anchor(nested, &keys, &mut HashSet::new()),
            Some(16)
        );
    }

    #[test]
    fn dhtml_branch_key_rejects_zero_start_ply_without_generic_anchor_search() {
        let mut record = ttxq_record("zero-start-ply");
        record.moves = vec!["c3c4".into()];
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-0-1",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("分支键"), "{error}");
        assert!(error.contains("1基首着序号"), "{error}");
    }

    #[test]
    fn dhtml_branch_field_without_a_route_key_never_uses_generic_anchor_search() {
        let mut record = ttxq_record("missing-route-key");
        record.moves = vec!["c3c4".into()];
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("分支键"), "{error}");
    }

    #[test]
    fn dhtml_branch_field_never_falls_back_to_plain_iccs() {
        let mut record = ttxq_record("dhtml-iccs-fallback");
        record.moves = vec!["c3c4".into()];
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-1-1",
                "raw": "h2h4",
                "valueType": "string"
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("DhtmlXQ 左上角坐标"), "{error}");
    }

    #[test]
    fn dhtml_branch_tree_rejects_a_missing_parent_route() {
        let mut record = ttxq_record("missing-parent-route");
        record.moves = vec!["c3c4".into()];
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.9-1-10",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, STARTING_FEN).unwrap_err();

        assert!(error.contains("父路线缺失或形成循环"), "{error}");
    }

    #[test]
    fn dhtml_branch_tree_rejects_an_invalid_starting_fen() {
        let mut record = ttxq_record("invalid-starting-fen");
        record.moves = vec!["c3c4".into()];
        record.branch_complete = false;
        record.branch_data = serde_json::json!({
            "candidates": [{
                "path": "boardControl[0].getMoveBranchKey.0-1-1",
                "raw": "1927",
                "valueType": "string"
            }]
        })
        .to_string();

        let error = prepare_import_record(&record, "invalid-fen").unwrap_err();

        assert!(error.contains("缺少可用的起始 FEN"), "{error}");
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
        assert_eq!(sample["branches"][0]["coordinateMode"], "dhtmlxq-top-left");
        assert_eq!(sample["branches"][0]["decodedFirstMove"], "b0c2");
        assert_eq!(sample["branches"][0]["localStartPly1Based"], 1);
        assert_eq!(sample["branches"][0]["localAfterPly"], 0);
        assert_eq!(sample["branches"][0]["anchorSide"], "red");
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
    fn annotation_only_payload_does_not_trigger_branch_failure() {
        let payload = serde_json::json!({
            "annotations": [{
                "sourceRouteId": 0,
                "absoluteAfterPly": 0,
                "text": "起始局面说明"
            }],
            "annotationKeySamples": [{
                "key": "comment0_0",
                "keyFormat": "dhtml-comment"
            }],
            "annotationsComplete": false,
            "candidates": []
        })
        .to_string();
        assert!(!branch_data_has_real_signal(&payload));

        let mut record = ttxq_record("annotation-only-incomplete");
        record.branch_data = payload;
        record.branch_complete = false;
        record.annotations_complete = true;
        assert!(ttxq_branch_decode_failure(&record, STARTING_FEN, Some(&record.moves)).is_none());
    }

    #[test]
    fn unknown_coordinate_branch_marker_requires_complete_decode() {
        let payload = serde_json::json!({
            "unknownBranchKeySeen": true,
            "candidates": [],
        })
        .to_string();
        assert!(branch_data_has_real_signal(&payload));

        let mut record = ttxq_record("unknown-coordinate-branch");
        record.raw_moves = "26252042".into();
        record.raw_move_path = "NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep".into();
        record.raw_move_type = "array<number>".into();
        record.branch_data = payload;
        record.branch_complete = false;
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
            source_route_id: None,
            source_key: String::new(),
            comment: "绿色分支 1".into(),
            children: vec![TtxqVariationDto {
                after_ply: 1,
                moves: vec!["h2h4".into()],
                route_no: None,
                source_route_id: None,
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
        assert!(
            branches
                .iter()
                .any(|node| node.is_mainline && node.mv.to_iccs() == "c9e7")
        );
        let branch_root = branches
            .iter()
            .find(|node| !node.is_mainline && node.mv.to_iccs() == "b9c7")
            .unwrap();
        assert_eq!(branch_root.comment, "绿色分支 1");
        let nested = document.tree.branches(branch_root.id).unwrap();
        assert!(nested.iter().any(|node| node.mv.to_iccs() == "b0c2"));
        assert!(
            nested
                .iter()
                .any(|node| node.mv.to_iccs() == "h2h4" && node.comment == "嵌套分支")
        );
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
        assert!(
            nodes
                .iter()
                .any(|node| !node.deleted && !node.is_mainline && node.mv.to_iccs() == "h9g7")
        );
        assert!(
            model
                .store
                .pending_operations(50)
                .unwrap()
                .iter()
                .any(|operation| {
                    operation.kind == OperationKind::AddMove && operation.game_id == game_id
                })
        );
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

        reload_active_game_after_ttxq_import(&mut model, game_id, None).unwrap();

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
            None,
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
  getMoveBranchKey: {{ '0-2-1': '1022' }},
}};
const model = {{}};
const boardControls = () => [firstControl, secondControl];
{branch_source}
const branch = branchPayload();
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1) {{
  throw new Error(`expected one branch candidate from the second board control, got ${{branch.data}}`);
}}
if (payload.candidates[0].raw !== '1022') {{
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
  getMoveBranchKey: {{
    '0-1-1': '7062',
    accessToken: 'diagnostic-secret-token',
    userUin: 48477741,
    innerHTML: '<div>private-page-html</div>',
    htmlContent: '<main>private-html-content</main>',
  }},
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
if (branch.data.includes('diagnostic-secret-token') || branch.data.includes('48477741')
  || branch.data.includes('private-page-html') || branch.data.includes('private-html-content')) {{
  throw new Error(`private fields leaked into branch diagnostics: ${{branch.data}}`);
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
    fn collector_does_not_scan_unrelated_detail_graphs_for_branches() {
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
if (!branch.complete || branch.data) throw new Error(`unrelated detail graph declared a branch: ${{JSON.stringify(branch)}}`);
if (propertyReads > 200) throw new Error(`branch collector traversed unrelated detail state: ${{propertyReads}}`);
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
            "collector traversed unrelated detail state for branches: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_move_like_values_beside_reference_msg_rows() {
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
  getMoveBranchKey: {{ cache: {{}}, ready: true }},
  holder: {{ branchContainer }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload();
const payload = branch.data ? JSON.parse(branch.data) : {{}};
if (payload.candidates && payload.candidates.length) throw new Error(`msg container sibling polluted branch candidates: ${{branch.data}}`);
if (!branch.complete) throw new Error(`msg container sibling incorrectly declared a branch: ${{branch.data}}`);
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
            "collector treated a msg container sibling as branch data: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_obfuscated_move_fields_inside_reference_msg_container() {
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
  getMoveBranchKey: {{ cache: {{}}, ready: true }},
  holder: {{ referenceContainer }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = branch.data ? JSON.parse(branch.data) : {{}};
if (payload.candidates && payload.candidates.length) throw new Error(`obfuscated msg field polluted branch candidates: ${{branch.data}}`);
if (!branch.complete) throw new Error(`obfuscated msg field incorrectly declared a branch: ${{branch.data}}`);
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
            "collector treated an obfuscated msg field as branch data: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_maps_tencent_route_ply_annotations_without_creating_branches() {
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
    '11-2': [
      {{
        msg: '软件推荐：炮二平五 马8进7',
        content: {{ text: '车一进一' }},
        time: '24-09-05 13:24',
        uUin: 48477741,
        uname: 'Zero',
      }},
    ],
    '11-13': [{{ msg: '路线 11 第 13 半回合' }}],
    '18-6': [{{ msg: '路线 18 第 6 半回合' }}],
    social: [{{ msg: '普通棋谱评论，不应成为注解或失败信号' }}],
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload();
const payload = JSON.parse(branch.data);
if (payload.candidates.length) throw new Error(`nested comment text was treated as a branch move: ${{branch.data}}`);
if (!payload.annotations || payload.annotations.length !== 3) throw new Error(`comment annotations were not collected: ${{branch.data}}`);
const positions = payload.annotations
  .map(annotation => `${{annotation.sourceRouteId}}:${{annotation.absoluteAfterPly}}:${{annotation.keyFormat}}`)
  .sort();
if (positions.join(',') !== '11:13:ttxq-route-ply,11:2:ttxq-route-ply,18:6:ttxq-route-ply') {{
  throw new Error(`Tencent route-ply annotations were mapped incorrectly: ${{JSON.stringify(payload.annotations)}}`);
}}
const annotation = payload.annotations.find(item => item.sourceRouteId === 11 && item.absoluteAfterPly === 2);
if (!annotation || annotation.author !== 'Zero' || annotation.createdAt !== '24-09-05 13:24') throw new Error(`annotation metadata was not retained: ${{JSON.stringify(annotation)}}`);
if (JSON.stringify(annotation).includes('48477741') || Object.prototype.hasOwnProperty.call(annotation, 'uUin')) throw new Error('private account fields leaked into annotation payload');
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
            "collector misclassified Tencent route-ply annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_uses_active_board_control_when_move_field_owner_is_different() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const activeControl = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: {{ 'comment0_0': [{{ msg: '起始局面说明', time: '24-05-11 13:28', uname: '曹振华' }}] }} }} }},
}};
const moveFieldOwner = {{ getQipuMoveStep: [2, 6, 2, 5] }};
const model = {{}};
const boardControls = () => [activeControl];
{branch_source}
const branch = branchPayload(moveFieldOwner);
const payload = branch.data ? JSON.parse(branch.data) : {{}};
if (!payload.annotations || payload.annotations.length !== 1 || payload.annotations[0].text !== '起始局面说明') {{
  throw new Error(`active board annotation was skipped when move owner differed: ${{branch.data}}`);
}}
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise board-control annotation ownership");
        assert!(
            output.status.success(),
            "collector skipped annotations on the active board control: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_only_classifies_a_new_visible_unavailable_dialog() {
        let source = include_str!("ttxq_bridge.rs");
        let start = source
            .find("      const isVisible = (element) => {")
            .expect("unavailable dialog visibility helper must exist");
        let end = source[start..]
            .find("      await invoke('report_ttxq_read_progress'")
            .expect("unavailable dialog helper must end before progress reporting")
            + start;
        let helper = &source[start..end];
        let harness = format!(
            r#"(() => {{
const makeElement = (text, {{ visible = true, parent = null, confirm = null }} = {{}}) => {{
  const element = {{
    textContent: text,
    parentElement: parent,
    getBoundingClientRect: () => ({{ width: visible ? 120 : 0, height: visible ? 40 : 0 }}),
    querySelectorAll: (selector) => selector.includes('button') && confirm ? [confirm] : [],
  }};
  return element;
}};
const button = {{ textContent: '确定', clicked: 0, click() {{ this.clicked += 1; }}, getBoundingClientRect: () => ({{ width: 80, height: 30 }}), parentElement: null }};
const visibleDialog = makeElement('棋谱不存在', {{ confirm: button }});
const hiddenDialog = makeElement('棋谱不存在', {{ visible: false }});
const allElements = [];
globalThis.window = {{ getComputedStyle: () => ({{ display: 'block', visibility: 'visible', opacity: '1' }}) }};
globalThis.document = {{ querySelectorAll: (selector) => {{
  if (selector.startsWith('button')) return [button];
  if (selector.includes('[role="dialog"]')) return [];
  return [];
}} }};
// Page/detail text alone must never be treated as an unavailable-record modal.
allElements.push({{ textContent: '棋谱不存在', getBoundingClientRect: () => ({{ width: 100, height: 20 }}), querySelectorAll: () => [] }});
{helper}
if (dismissUnavailableDialog() !== '') throw new Error('body/detail text produced a false unavailable error');
allElements.length = 0;
allElements.push(hiddenDialog);
if (dismissUnavailableDialog() !== '') throw new Error('hidden unavailable dialog produced an error');
allElements.length = 0;
allElements.push(visibleDialog);
button.parentElement = visibleDialog;
const baseline = unavailableDialogBaseline();
if (!dismissUnavailableDialog(baseline)) throw new Error('blocking dialog was not dismissed');
const replacement = makeElement('棋谱不存在', {{ confirm: button }});
button.parentElement = replacement;
allElements[0] = replacement;
if (!dismissUnavailableDialog(baseline) || button.clicked !== 2) throw new Error('new visible unavailable dialog was not classified and dismissed');
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise unavailable dialog classification");
        assert!(
            output.status.success(),
            "collector misclassified an unavailable dialog: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_only_clicks_the_exact_canvas_dialog_confirm_control() {
        let source = include_str!("ttxq_bridge.rs");
        let start = source
            .find("      const isVisible = (element) => {")
            .expect("unavailable dialog visibility helper must exist");
        let end = source[start..]
            .find("      await invoke('report_ttxq_read_progress'")
            .expect("unavailable dialog helper must end before progress reporting")
            + start;
        let helper = &source[start..end];
        let harness = format!(
            r#"(() => {{
let unsafeClicks = 0;
const message = {{ text: '删除失败', click() {{ unsafeClicks += 1; }} }};
const confirm = {{ text: '确定', clicked: 0, click() {{ this.clicked += 1; }} }};
const dialog = {{ message, confirm }};
globalThis.window = {{
  fdk: {{ activeDialog: dialog }},
  getComputedStyle: () => ({{ display: 'block', visibility: 'visible', opacity: '1' }}),
}};
globalThis.document = {{ querySelectorAll: () => [] }};
{helper}
if (!dismissUnavailableDialog()) throw new Error('canvas dialog was not classified');
if (confirm.clicked !== 1) throw new Error(`exact canvas confirm was not clicked: ${{confirm.clicked}}`);
if (unsafeClicks !== 0) throw new Error('collector clicked the message/dialog surface instead of the exact confirm');
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise canvas dialog dismissal");
        assert!(
            output.status.success(),
            "collector clicked an unsafe canvas dialog target: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_keeps_each_msg_container_position_on_its_own_node() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const shared = {{
  '0-1': [{{ msg: '第一步注解', time: '15:01', uname: '作者' }}],
  '0-2': [{{ msg: '第二步注解', time: '15:02', uname: '作者' }}],
  '0-3': [{{ msg: '第三步注解', time: '15:03', uname: '作者' }}],
}};
const control = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: shared }} }},
  mirror: {{ msgContainer: {{
    '0-1': [{{ msg: '第一步注解', time: '15:01', uname: '作者' }}],
    '0-2': [{{ msg: '第二步注解', time: '15:02', uname: '作者' }}],
    '0-3': [{{ msg: '第三步注解', time: '15:03', uname: '作者' }}],
  }} }}
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.annotationsComplete !== true) throw new Error(`annotations incomplete: ${{branch.data}}`);
const positions = payload.annotations.map(item => `${{item.sourceRouteId}}:${{item.absoluteAfterPly}}`).sort();
if (positions.join(',') !== '0:1,0:2,0:3') throw new Error(`positions collapsed or missing: ${{JSON.stringify(payload.annotations)}}`);
if (payload.annotations.length !== 3) throw new Error(`duplicate msg containers were not deduplicated: ${{JSON.stringify(payload.annotations)}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise msgContainer positions");
        assert!(
            output.status.success(),
            "collector collapsed msgContainer positions: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_prefers_each_msg_row_position_over_its_group_key() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
// Tencent can group a page of rows below the first mounted comment key while
// retaining the authoritative route/ply key on every individual row.
const control = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: {{
    comment0_0: [{{ msg: '根局面注解', key: 'comment0_0', time: '15:20', uname: '曹振华' }}],
    comment0_1: [
      {{ msg: '不应落到第一着的第二半回合注解', key: 'comment0_2', time: '15:22', uname: '曹振华' }},
      {{ msg: '同一容器的第四半回合注解', key: 'comment0_4', time: '15:24', uname: '曹振华' }},
    ],
  }} }} }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
const positions = payload.annotations
  .map(item => `${{item.absoluteAfterPly}}:${{item.text}}`)
  .sort()
  .join('|');
const expected = '0:根局面注解|2:不应落到第一着的第二半回合注解|4:同一容器的第四半回合注解';
if (positions !== expected) throw new Error(`rows inherited the group key: ${{JSON.stringify(payload.annotations)}}`);
if (payload.annotations.some(item => item.absoluteAfterPly === 1)) throw new Error('an annotation was incorrectly bound to the empty first ply');
}})();"#,
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise row-level annotation positions");
        assert!(
            output.status.success(),
            "collector ignored row-level Tencent annotation keys: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_does_not_treat_numeric_message_ids_as_annotation_positions() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: {{
    messages: [
      {{ msg: '只有数据库消息 id，不能定位到第一半回合', id: 1, time: '15:21', uname: '曹振华' }},
      {{ msg: '带显式 key 的第二半回合注解', id: 2, key: 'comment0_2', time: '15:22', uname: '曹振华' }},
    ],
  }} }} }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (!payload.annotations || payload.annotations.length !== 1) throw new Error(`numeric ids became annotations: ${{branch.data}}`);
const annotation = payload.annotations[0];
if (annotation.absoluteAfterPly !== 2 || annotation.text !== '带显式 key 的第二半回合注解') {{
  throw new Error(`explicit row key was not used: ${{JSON.stringify(payload.annotations)}}`);
}}
if (payload.annotations.some(item => item.absoluteAfterPly === 1)) throw new Error('numeric id was treated as the first ply');
}})();"#,
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise numeric annotation ids");
        assert!(
            output.status.success(),
            "collector treated numeric message ids as annotation positions: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_direct_msg_annotation_container_without_branch_signal() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{}},
  msg: {{
    'comment0_0': [{{ msg: '起始局面注解', time: '15:00', uname: '作者' }}],
    'comment0_2': [{{ msg: '第二半回合注解', time: '15:01', uname: '作者' }}],
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.candidates && payload.candidates.length) throw new Error('direct msg annotations became branch candidates');
if (!payload.annotations || payload.annotations.length !== 2) throw new Error(`direct msg container was not collected: ${{branch.data}}`);
const positions = payload.annotations.map(item => `${{item.sourceRouteId}}:${{item.absoluteAfterPly}}`).sort();
if (positions.join(',') !== '0:0,0:2') throw new Error(`direct msg positions were mapped incorrectly: ${{branch.data}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise direct msg annotation containers");
        assert!(
            output.status.success(),
            "collector skipped direct msg annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_msg_container_lazily_mounted_on_route_control() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const routeControl = {{ text: '2', click() {{ this.msgContainer = {{ 'comment0_2': [{{ msg: '路线切换后注解', time: '15:02', uname: '作者' }}] }}; }} }};
const control = {{ getMoveBranchKey: {{}}, Eb: {{ wn: {{ msgContainer: {{ 'comment0_0': [{{ msg: '根注解' }}] }} }} }} }};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const first = branchPayload(control);
if (!first.data || !JSON.parse(first.data).annotations.some(item => item.text === '根注解')) throw new Error('root annotation was not collected');
branchPayload.routeControls = {{ numbers: [1, 2], buttons: [{{ routeNo: 2, control: routeControl }}] }};
routeControl.click();
const second = branchPayload(control);
const payload = second.data ? JSON.parse(second.data) : {{}};
if (!payload.annotations || !payload.annotations.some(item => item.text === '路线切换后注解' && item.absoluteAfterPly === 2)) throw new Error(`lazy route msgContainer was not collected: ${{second.data}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise lazy route annotation collection");
        assert!(
            output.status.success(),
            "collector skipped a route-control msgContainer: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_primitive_and_wrapped_msg_container_rows() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: {{
    'comment0_0': ['根注解'],
    '11-2': [{{ text: '包装注解', time: '15:02', uname: '作者' }}],
    '18-6': {{ content: '对象注解' }},
  }} }} }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.candidates && payload.candidates.length) throw new Error('msg rows became branch candidates');
if (!payload.annotations || payload.annotations.length !== 3) throw new Error(`primitive/wrapped rows were lost: ${{branch.data}}`);
const positions = payload.annotations.map(item => `${{item.sourceRouteId}}:${{item.absoluteAfterPly}}:${{item.text}}`).sort();
if (positions.join('|') !== '0:0:根注解|11:2:包装注解|18:6:对象注解') throw new Error(`annotation rows were mapped incorrectly: ${{JSON.stringify(payload.annotations)}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise primitive msg rows");
        assert!(
            output.status.success(),
            "collector skipped primitive/wrapped annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_merges_msg_time_and_uname_maps_without_duplicate_rows() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{}},
  Eb: {{ wn: {{ msgContainer: {{
    msg: {{ '11-2': '正文' }},
    time: {{ '11-2': '15:02' }},
    uname: {{ '11-2': '作者' }},
  }} }} }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (!payload.annotations || payload.annotations.length !== 1) throw new Error(`metadata maps created duplicate rows: ${{branch.data}}`);
const annotation = payload.annotations[0];
if (annotation.sourceRouteId !== 11 || annotation.absoluteAfterPly !== 2 || annotation.text !== '正文' || annotation.author !== '作者' || annotation.createdAt !== '15:02') throw new Error(`metadata maps were not merged: ${{JSON.stringify(annotation)}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise companion annotation maps");
        assert!(
            output.status.success(),
            "collector mishandled msg/time/uname maps: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_keeps_annotation_and_branch_budgets_independent_and_accepts_explicit_wrappers() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        assert!(include_str!("ttxq_bridge.rs").contains("Date.now() + 6000"));
        assert!(branch_source.contains("Date.now() + 2500"));
        assert!(branch_source.contains("annotationScanExpired()"));
        assert!(
            branch_source.contains("for (const key of ['moves', 'move', 'raw', 'line', 'data'])")
        );

        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{ getMoveBranchKey: {{ '0-2-1': {{ moves: ['1022'] }} }} }};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.candidates.length !== 1 || payload.candidates[0].raw !== '1022') throw new Error(`explicit branch wrapper was rejected: ${{branch.data}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise explicit branch wrappers");
        assert!(
            output.status.success(),
            "collector rejected explicit branch wrapper: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_maps_dhtml_annotation_keys_to_absolute_positions() {
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
  getMoveBranchKey: {{ cache: {{}}, routeState: {{ selected: 1, ready: true }} }},
  comments: {{
    DhtmlXQ_comment0_0: [{{ msg: '整谱说明', time: '23-08-17 15:20', uname: '曹振华', uUin: 48477741 }}],
    DhtmlXQ_comment0_2: [{{ msg: '第 2 半回合说明', time: '23-08-17 15:22', uname: '曹振华' }}],
    comment2_5: [{{ msg: '简写路线注解' }}],
    '1_3': [{{ msg: '紧凑路线注解' }}],
    '4': [{{ msg: '主线纯步号注解' }}],
    root: [{{ msg: '起始局面别名注解' }}],
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (branch.complete !== true || (payload.candidates && payload.candidates.length)) throw new Error(`branch metadata wrapper blocked a mainline-only game: ${{branch.data}}`);
if (payload.annotationsComplete !== true) throw new Error(`Dhtml annotations were marked incomplete: ${{branch.data}}`);
if (!payload.annotations || payload.annotations.length !== 6) throw new Error(`Dhtml annotations were not collected: ${{branch.data}}`);
const positions = payload.annotations.map(annotation => `${{annotation.sourceRouteId}}:${{annotation.absoluteAfterPly}}`).sort();
if (positions.join(',') !== '0:0,0:0,0:2,0:4,1:3,2:5') throw new Error(`Dhtml annotations were mapped incorrectly: ${{JSON.stringify(payload.annotations)}}`);
const formats = new Set(payload.annotations.map(annotation => annotation.keyFormat));
for (const format of ['dhtml-comment', 'dhtml-compact', 'mainline-ply', 'root-alias']) if (!formats.has(format)) throw new Error(`annotation key format ${{format}} was not retained`);
if (JSON.stringify(payload.annotations).includes('48477741')) throw new Error('private account fields leaked into annotation payload');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise Dhtml annotation keys");
        child
            .stdin
            .as_mut()
            .expect("Dhtml annotation checker stdin")
            .write_all(harness.as_bytes())
            .expect("write Dhtml annotation harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run Dhtml annotation harness");
        assert!(
            output.status.success(),
            "collector did not map Dhtml annotation positions: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_get_qipu_comment_v2_rows() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{ '0-41-1': '517052417062' }},
}};
const model = {{
  currentQipu: {{ qipuId: 'borrow-cannon-use-horse-2', data: {{ commentV2: {{
    '0': [{{ msg: '借炮使马二', uname: '', time: '', uUin: 0 }}],
    '21': [{{ msg: '换岗', uname: '', time: '', uUin: 0 }}],
    '1-44': [{{ msg: '红可简胜', uname: '', time: '', uUin: 0 }}],
  }} }} }},
  _qipuData: {{ qipuId: 'previous-game', commentV2: {{
    '0': [{{ msg: '上一盘注释，不得串入' }}],
  }} }},
}};
const boardControls = () => [control];
{branch_source}
branchPayload.expectedQipuId = 'borrow-cannon-use-horse-2';
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.annotationsComplete !== true) throw new Error(`commentV2 was marked incomplete: ${{branch.data}}`);
if (!payload.annotations || payload.annotations.length !== 3) throw new Error(`commentV2 rows were not collected: ${{branch.data}}`);
const positions = payload.annotations.map(annotation => `${{annotation.sourceRouteId}}:${{annotation.absoluteAfterPly}}:${{annotation.text}}:${{annotation.keyFormat}}`).sort();
if (positions.join('|') !== '0:0:借炮使马二:mainline-ply|0:21:换岗:mainline-ply|1:43:红可简胜:ttxq-comment-v2-route-ply') throw new Error(`commentV2 positions were mapped incorrectly: ${{JSON.stringify(payload.annotations)}}`);
if (JSON.stringify(payload.annotations).includes('uUin')) throw new Error('private account fields leaked into commentV2 annotations');
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise commentV2 annotations");
        assert!(
            output.status.success(),
            "collector skipped get-qipu commentV2 annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_reads_target_comment_v2_without_walking_the_detail_graph() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(() => {{
let targetDetailRoot = null;
const propertyNames = value => {{
  if (value === targetDetailRoot) throw new Error('target detail graph was traversed');
  return Object.getOwnPropertyNames(value);
}};
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{ getMoveBranchKey: {{}} }};
targetDetailRoot = {{
  qipuId: 'target-game',
  data: {{ commentV2: {{
    '0': [{{ msg: '整谱说明' }}],
    '12': [{{ msg: '第十二回合说明' }}],
  }} }},
}};
const model = {{ currentQipu: targetDetailRoot }};
const boardControls = () => [control];
{branch_source}
branchPayload.expectedQipuId = 'target-game';
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (!payload.annotations || payload.annotations.length !== 2) throw new Error(`direct commentV2 was not collected: ${{branch.data}}`);
}})();"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise bounded commentV2 collection");
        assert!(
            output.status.success(),
            "collector walked the target detail object graph: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_captures_comment_v2_from_get_qipu_fetch_response() {
        let capture_source = collector_source_between(
            "      const getQipuCapture = (() => {",
            "      const bridgeRoots = () => [",
        );
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const responsePayload = {{
  ret: 0,
  data: {{
    qipuId: '71003870534',
    commentV2: {{
      '0': [{{ msg: '整谱说明', uname: '曹振华', time: '23-08-17 15:20', uUin: 48477741 }}],
      '2': [{{ msg: '马8进7屏风马是最常见的。', uname: '曹振华', time: '23-08-17 15:22', uUin: 48477741 }}],
    }},
  }},
}};
const window = {{
  fetch: async () => new Response(JSON.stringify(responsePayload), {{ headers: {{ 'content-type': 'application/json' }} }}),
}};
{capture_source}
await window.fetch('https://h5.qqchess.qq.com/api/get-qipu', {{
  method: 'POST',
  body: JSON.stringify({{ qipuId: '71003870534' }}),
}});
await new Promise(resolve => setTimeout(resolve, 0));
const captured = getQipuCapture.commentV2For('71003870534');
if (!captured || captured['0'][0].msg !== '整谱说明' || captured['2'][0].msg !== '马8进7屏风马是最常见的。') throw new Error(`get-qipu commentV2 was not captured: ${{JSON.stringify(captured)}}`);
if (JSON.stringify(captured).includes('48477741') || JSON.stringify(captured).includes('uUin')) throw new Error('private account fields leaked into the captured annotation response');
const propertyNames = value => Object.getOwnPropertyNames(value);
const stringifyMoveValue = value => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{ getMoveBranchKey: {{}} }};
const model = {{}};
const boardControls = () => [control];
{branch_source}
branchPayload.expectedQipuId = '71003870534';
const branch = branchPayload(control);
const envelope = JSON.parse(branch.data);
const positions = envelope.annotations.map(annotation => `${{annotation.sourceRouteId}}:${{annotation.absoluteAfterPly}}:${{annotation.text}}`).sort();
if (positions.join('|') !== '0:0:整谱说明|0:2:马8进7屏风马是最常见的。') throw new Error(`captured annotations did not reach branch payload: ${{JSON.stringify(envelope.annotations)}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise get-qipu response capture");
        assert!(
            output.status.success(),
            "collector missed get-qipu response annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_captures_comment_v2_from_get_qipu_xhr_response() {
        let capture_source = collector_source_between(
            "      const getQipuCapture = (() => {",
            "      const bridgeRoots = () => [",
        );
        let harness = format!(
            r#"(async () => {{
const responsePayload = {{ data: {{ commentV2: {{
  '3': [{{ msg: '第三局面说明', uname: '曹振华', time: '23-08-17 13:50', uUin: 48477741 }}],
}} }} }};
class FakeXMLHttpRequest {{
  constructor() {{ this.listeners = new Map(); this.responseType = ''; this.responseText = ''; }}
  addEventListener(type, listener) {{ this.listeners.set(type, listener); }}
  open() {{}}
  send() {{
    this.responseText = JSON.stringify(responsePayload);
    queueMicrotask(() => this.listeners.get('load')?.call(this));
  }}
}}
const window = {{ XMLHttpRequest: FakeXMLHttpRequest }};
{capture_source}
const xhr = new window.XMLHttpRequest();
xhr.open('POST', 'https://h5.qqchess.qq.com/api/get-qipu');
xhr.send(JSON.stringify({{ qipuId: '43156805249' }}));
await new Promise(resolve => setTimeout(resolve, 0));
const captured = getQipuCapture.commentV2For('43156805249');
if (!captured || captured['3'][0].msg !== '第三局面说明') throw new Error(`XHR commentV2 was not captured: ${{JSON.stringify(captured)}}`);
if (JSON.stringify(captured).includes('48477741') || JSON.stringify(captured).includes('uUin')) throw new Error('private account fields leaked into the captured XHR response');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise get-qipu XHR capture");
        assert!(
            output.status.success(),
            "collector missed get-qipu XHR annotations: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_marks_truncated_annotation_payloads_incomplete_and_keeps_valid_json() {
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
    '6-1': Array.from({{ length: 33 }}, (_, index) => ({{ msg: `注解${{index}}-${{'长'.repeat(1500)}}`, uname: '作者' }})),
  }},
}};
const model = {{}};
const boardControls = () => [control];
{branch_source}
const branch = branchPayload(control);
const payload = JSON.parse(branch.data);
if (payload.annotationsComplete !== false) throw new Error(`truncated annotations were marked complete: ${{branch.data}}`);
if (payload.payloadTruncated !== true) throw new Error(`oversized branch JSON was not replaced by a valid bounded envelope: ${{branch.data}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise annotation payload bounds");
        child
            .stdin
            .as_mut()
            .expect("annotation bounds checker stdin")
            .write_all(harness.as_bytes())
            .expect("write annotation bounds harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run annotation bounds harness");
        assert!(
            output.status.success(),
            "collector silently truncated annotation data: {}",
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
  get getMoveBranchKey() {{ return branchPolls >= 2 ? {{ '0-2-1': '1022' }} : {{}}; }},
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
if (!payload.candidates || payload.candidates.length !== 1 || payload.candidates[0].raw !== '1022') {{
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
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
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
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const delay = async () => undefined;
const reusedControl = {{}};
const emptyBranch = {{ data: '', path: 'current-board', complete: true, owner: reusedControl, branchSignature: '', annotationSignature: '' }};
const branchPayload = () => emptyBranch;
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const liveLoadedId = () => 'current-game';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const staleData = JSON.stringify({{ candidates: [{{ raw: '26257062', afterPly: 1 }}] }});
const stale = {{ data: staleData, path: 'reused-board', complete: false, owner: reusedControl, branchSignature: 'stale-branch-signature', annotationSignature: '' }};
const branch = await readBranchRoutes(
  'current-game',
  {{ text: '26252042', owner: reusedControl }},
  stale,
  'stale-branch-signature',
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
    fn collector_accepts_an_identical_branch_signature_after_target_id_is_confirmed() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const delay = async () => undefined;
const reusedControl = {{}};
const branchData = JSON.stringify({{ candidates: [{{ raw: '1022', afterPly: 1 }}] }});
const targetSnapshot = {{
  data: branchData,
  path: 'current-board',
  complete: false,
  owner: reusedControl,
  branchSignature: 'shared-branch-signature',
  annotationSignature: '',
}};
const branchPayload = () => targetSnapshot;
const boundedBranchJson = value => JSON.stringify(value);
const liveLoadedId = () => 'current-game';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const branch = await readBranchRoutes(
  'current-game',
  {{ text: '26252042', owner: reusedControl }},
  targetSnapshot,
  'shared-branch-signature',
);
if (branch.complete || branch.path === 'previous-game-branch-signature') {{
  throw new Error(`confirmed target branch with an identical signature was rejected: ${{JSON.stringify(branch)}}`);
}}
const payload = JSON.parse(branch.data);
if (!payload.candidates || payload.candidates.length !== 1 || payload.candidates[0].raw !== '1022') {{
  throw new Error(`confirmed target branch candidates were lost: ${{branch.data}}`);
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
            .expect("Node.js is required to exercise identical target branch signatures");
        child
            .stdin
            .as_mut()
            .expect("identical target branch signature checker stdin")
            .write_all(harness.as_bytes())
            .expect("write identical target branch signature harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run identical target branch signature harness");
        assert!(
            output.status.success(),
            "collector rejected a confirmed target branch with an identical signature: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_keeps_target_annotations_while_clearing_a_previous_branch_signature() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const delay = async () => undefined;
const reusedControl = {{}};
const targetEnvelope = {{
  signals: [],
  candidates: [],
  annotations: [{{
    sourceRouteId: 11,
    absoluteAfterPly: 2,
    keyFormat: 'ttxq-route-ply',
    text: '目标盘注解',
    author: '',
    createdAt: '',
    sourceKey: 'boardControl[0].comments.msgContainer.11-2[0]',
  }}],
  annotationKeySamples: [],
  annotationsComplete: true,
}};
const targetSnapshot = {{
  data: JSON.stringify(targetEnvelope),
  branchSignature: '',
  annotationSignature: 'target-annotation-signature',
  path: 'NOTIFY_QIPU_DATA._boardControl.msg',
  complete: true,
  owner: reusedControl,
}};
const branchPayload = () => targetSnapshot;
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const boundedBranchJson = value => JSON.stringify(value);
const liveLoadedId = () => '51865923010';
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const branch = await readBranchRoutes(
  '51865923010',
  {{ text: '26252042', owner: reusedControl }},
  targetSnapshot,
  targetSnapshot.data,
);
if (!branch.complete || branch.path === 'previous-game-branch-signature') {{
  throw new Error(`annotation-only target retained a stale branch: ${{JSON.stringify(branch)}}`);
}}
const payload = JSON.parse(branch.data);
if (!payload.annotations || payload.annotations.length !== 1
  || payload.annotations[0].sourceRouteId !== 11
  || payload.annotations[0].absoluteAfterPly !== 2) {{
  throw new Error(`target annotations were lost while clearing stale branches: ${{branch.data}}`);
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
            .expect("Node.js is required to exercise split branch and annotation signatures");
        child
            .stdin
            .as_mut()
            .expect("split signature checker stdin")
            .write_all(harness.as_bytes())
            .expect("write split signature harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run split branch and annotation signature harness");
        assert!(
            output.status.success(),
            "collector mixed annotation and branch signatures: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_preserves_a_target_owned_branch_snapshot_during_empty_reads() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const control = {{}};
const delay = async () => undefined;
const branchPayload = () => ({{ data: '', path: 'current-board', complete: true, owner: control, branchSignature: '', annotationSignature: '' }});
branchPayload.routeControls = {{ numbers: [], buttons: [] }};
const boundedBranchJson = value => JSON.stringify(value);
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
  branchSignature: 'target-branch-signature',
  annotationSignature: '',
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
    fn collector_does_not_treat_a_move_number_grid_as_route_controls() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => Object.getOwnPropertyNames(value);
const stringifyMoveValue = (value) => {{
  if (typeof value === 'string' && value) return {{ status: 'ok', text: value, length: value.length }};
  return {{ status: 'empty', text: '', length: 0 }};
}};
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = (root, property) => Object.prototype.hasOwnProperty.call(root, property) ? root : null;
const control = {{
  getMoveBranchKey: {{ '0-2-1': '2625' }},
  Eb: {{ wn: {{ msgContainer: {{ comment0_0: [{{ msg: '根注解' }}] }} }} }},
}};
const moveGrid = {{ boardControl: control }};
for (let moveNo = 1; moveNo <= 20; moveNo += 1) {{
  moveGrid[`move${{moveNo}}`] = {{
    text: String(moveNo),
    click() {{ throw new Error(`move number ${{moveNo}} must never be activated as a route`); }},
  }};
}}
const model = {{}};
const boardControls = () => [control];
const detailDisplayRoots = () => [moveGrid];
{branch_source}
const branch = branchPayload(control);
if (!branch.data || !JSON.parse(branch.data).candidates.length) throw new Error('branch fixture was not recognized');
if (branchPayload.routeControls && branchPayload.routeControls.numbers.length) {{
  throw new Error(`move number grid was classified as route controls: ${{branchPayload.routeControls.numbers.join(',')}}`);
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
            .expect("Node.js is required to exercise unrelated move-number controls");
        child
            .stdin
            .as_mut()
            .expect("move-number route checker stdin")
            .write_all(harness.as_bytes())
            .expect("write move-number route harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run move-number route harness");
        assert!(
            output.status.success(),
            "collector misclassified a move-number grid as route controls: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_empty_dhtml_branch_wrappers() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => Object.getOwnPropertyNames(value);
const stringifyMoveValue = () => ({{ status: 'empty', text: '', length: 0 }});
const findObjectWithOwnProperty = () => null;
const emptyWrapper = {{ '0-4-1': {{ label: 'route metadata only' }} }};
const control = {{ getMoveBranchKey: emptyWrapper }};
const boardControls = () => [control];
const detailDisplayRoots = () => [];
const model = {{}};
{branch_source}
const branch = branchPayload(control);
if (!branch.complete || branch.data || branch.branchKeySeen) {{
  throw new Error(`empty DhtmlXQ wrappers must be ignored: ${{JSON.stringify(branch)}}`);
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
            .expect("Node.js is required to exercise empty DhtmlXQ branch wrappers");
        child
            .stdin
            .as_mut()
            .expect("empty DhtmlXQ wrapper checker stdin")
            .write_all(harness.as_bytes())
            .expect("write empty DhtmlXQ wrapper harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run empty DhtmlXQ wrapper harness");
        assert!(
            output.status.success(),
            "collector treated an empty DhtmlXQ wrapper as a real branch: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_fails_closed_for_unknown_coordinate_branch_keys() {
        let branch_source = collector_source_between(
            "      const branchPayload = (preferredControl = null) => {",
            "      const liveLoadedId = () => {",
        );
        let harness = format!(
            r#"(async () => {{
const propertyNames = (value) => Object.getOwnPropertyNames(value);
const stringifyMoveValue = () => ({{ status: 'empty', text: '', length: 0 }});
const safeMoveText = /^[0-9,\s\[\]]+$/;
const findObjectWithOwnProperty = () => null;
const control = {{ getMoveBranchKey: {{ 'future-route': {{ moves: '26252042' }} }} }};
const boardControls = () => [control];
const detailDisplayRoots = () => [];
const model = {{}};
{branch_source}
const branch = branchPayload(control);
if (branch.complete || !branch.unknownBranchKeySeen) {{
  throw new Error(`unknown coordinate branch key was not rejected: ${{JSON.stringify(branch)}}`);
}}
const payload = JSON.parse(branch.data);
if (payload.unknownBranchKeySeen !== true) throw new Error('unknown branch marker was not serialized');
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise unknown branch keys");
        child
            .stdin
            .as_mut()
            .expect("unknown branch key checker stdin")
            .write_all(harness.as_bytes())
            .expect("write unknown branch key harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run unknown branch key harness");
        assert!(
            output.status.success(),
            "collector accepted an unknown coordinate branch key: {}",
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
    fn collector_reads_lazy_route_annotations_from_the_active_board_control() {
        let read_branch_source = collector_source_between(
            "      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {",
            "      let current = 0;",
        );
        let harness = format!(
            r#"(async () => {{
const qipuId = '51865923010';
const control = {{}};
let activeRoute = 1;
let activeRouteReads = 0;
const annotation = {{
  sourceRouteId: 2,
  absoluteAfterPly: 2,
  keyFormat: 'dhtml-comment',
  text: '第二路线当前局面注解',
  author: '作者',
  createdAt: '15:02',
  sourceKey: 'boardControl[0].Eb.wn.msgContainer.comment2_2[0]',
}};
const directCandidate = {{
  path: 'boardControl[0].getMoveBranchKey.0-2-2',
  raw: '2625',
  valueType: 'string',
}};
const snapshot = (annotations = []) => ({{
  data: JSON.stringify({{ candidates: [directCandidate], annotations, annotationsComplete: true }}),
  path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey',
  complete: false,
  owner: control,
  branchSignature: 'target-branch',
  annotationSignature: annotations.length ? `route-${{activeRoute}}-annotation` : '',
  branchKeySeen: true,
  annotationContainerSeen: true,
}});
const routeButton = (routeNo) => ({{
  text: String(routeNo),
  dispatchEvent(type) {{
    if (type !== 'click') return false;
    activeRoute = routeNo;
    return true;
  }},
}});
const mainRoute = routeButton(1);
const secondRoute = routeButton(2);
const branchPayload = (preferred) => {{
  // Tencent mounts the selected route's msgContainer on the active board
  // controller, not on the numeric route button that was clicked.
  if (preferred === secondRoute) return snapshot([]);
  if (activeRoute === 2) activeRouteReads += 1;
  return snapshot(activeRoute === 2 ? [annotation] : []);
}};
branchPayload.routeControlOwner = control;
branchPayload.routeControls = {{
  numbers: [1, 2],
  buttons: [{{ routeNo: 1, control: mainRoute }}, {{ routeNo: 2, control: secondRoute }}],
}};
const delay = async () => undefined;
const invokeDisplayClick = (button) => button.dispatchEvent('click');
const boundedBranchJson = value => JSON.stringify(value);
const liveLoadedId = () => qipuId;
const directNotifyMove = () => null;
const directModelMove = () => null;
const readRawMoves = () => null;
{read_branch_source}
const passive = snapshot([]);
const result = await readBranchRoutes(qipuId, {{ text: '26252042', owner: control }}, passive);
const payload = JSON.parse(result.data);
if (!payload.annotations || !payload.annotations.some(item => item.text === annotation.text)) {{
  throw new Error(`active board route annotation was not collected: ${{result.data}}`);
}}
if (payload.routeFailures && payload.routeFailures.length) {{
  throw new Error(`decoded direct branches were incorrectly marked incomplete: ${{result.data}}`);
}}
if (activeRouteReads > 1) {{
  throw new Error(`annotation-only route was polled ${{activeRouteReads}} times; large route sets will miss their deadline`);
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
            .expect("Node.js is required to exercise lazy board-control annotations");
        child
            .stdin
            .as_mut()
            .expect("lazy board-control annotation checker stdin")
            .write_all(harness.as_bytes())
            .expect("write lazy board-control annotation harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run lazy board-control annotation harness");
        assert!(
            output.status.success(),
            "collector skipped annotations mounted on the active board control: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_ignores_route_controls_backed_only_by_non_branch_metadata() {
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
if (!branch.complete || branch.data) throw new Error(`non-branch metadata blocked import: ${{JSON.stringify(branch)}}`);
if (activations.length) throw new Error(`unverified route controls were activated: ${{activations.join(',')}}`);
if (activeRoute !== 1) throw new Error(`unverified route controls changed the active route: ${{activeRoute}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise unverified QQ route controls");
        child
            .stdin
            .as_mut()
            .expect("route control checker stdin")
            .write_all(harness.as_bytes())
            .expect("write route control harness to Node.js");
        let output = child.wait_with_output().expect("run route control harness");
        assert!(
            output.status.success(),
            "collector treated route metadata as branch data: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_does_not_activate_route_controls_without_branch_keys() {
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
if (!branch.complete || branch.data) throw new Error(`route controls without branch keys blocked import: ${{JSON.stringify(branch)}}`);
if (activations.length) throw new Error(`route controls without branch keys were activated: ${{activations.join(',')}}`);
if (activeRoute !== 1) throw new Error(`route controls changed the active route: ${{activeRoute}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise route controls without branch keys");
        child
            .stdin
            .as_mut()
            .expect("unverified route control checker stdin")
            .write_all(harness.as_bytes())
            .expect("write unverified route control harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run unverified route control harness");
        assert!(
            output.status.success(),
            "collector treated route controls without branch keys as branches: {}",
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
        let source = include_str!("ttxq_bridge.rs");
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
        let source = include_str!("ttxq_bridge.rs");
        let traversal_start = source
            .find("      const qipuIdOf = (value) => {")
            .expect("recent-list traversal must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source = source[traversal_start..traversal_end]
            .replace("__TTXQ_ATTEMPT_ID__", "1")
            .replace("__TTXQ_BRIDGE_VERSION__", &BRIDGE_VERSION.to_string());
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
    fn collector_reads_only_the_current_visible_qipu_list_root() {
        let source = include_str!("ttxq_bridge.rs");
        let traversal_start = source
            .find("      const qipuIdOf = (value) => {")
            .expect("recent-list traversal must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source = source[traversal_start..traversal_end]
            .replace("__TTXQ_ATTEMPT_ID__", "1")
            .replace("__TTXQ_BRIDGE_VERSION__", &BRIDGE_VERSION.to_string());
        let harness = format!(
            r#"(async () => {{
	const model = {{
	  _qipuRecentView: {{ records: [{{ qipuId: '77000000011' }}] }},
	  _qipuWallDataList: {{ favourites: [{{ iQipuId: '77000000012', extDataBody: {{ sTitle: '收藏布局' }} }}] }},
	  _qipuCreateDataList: {{ created: [{{ lQipuId: '77000000013', extDataBody: {{ sTitle: '自录布局' }} }}] }},
}};
const document = {{ querySelectorAll: () => [{{ innerText: '我的收藏' }}] }};
const invoke = async () => undefined;
const delay = async () => undefined;
	{traversal_source}
	const ids = [...found.keys()];
	if (ids.join(',') !== '77000000012') throw new Error(`collector mixed hidden qipu roots: ${{ids.join(',')}}`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise visible qipu root selection");
        child
            .stdin
            .as_mut()
            .expect("visible qipu root checker stdin")
            .write_all(harness.as_bytes())
            .expect("write visible qipu root harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run visible qipu root harness");
        assert!(
            output.status.success(),
            "collector mixed a hidden qipu root into the visible list: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_uses_the_populated_shared_root_for_a_visible_self_recorded_list() {
        let source = include_str!("ttxq_bridge.rs");
        let traversal_start = source
            .find("      const qipuIdOf = (value) => {")
            .expect("qipu id classifier must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("qipu list traversal must terminate")
            + traversal_start;
        let traversal_source = source[traversal_start..traversal_end]
            .replace("__TTXQ_ATTEMPT_ID__", "1")
            .replace("__TTXQ_BRIDGE_VERSION__", &BRIDGE_VERSION.to_string());
        let harness = format!(
            r#"(async () => {{
const model = {{
  // Tencent can retain this typed root as an empty display wrapper.
  _qipuCreateDataList: {{ rows: [] }},
  // The visible 自建棋谱 cards are owned by the shared wall object.
  _qipuWallDataList: {{ rows: [{{ qipuId: '77000000021' }}, {{ qipuId: '77000000022' }}] }},
  _qipuRecentView: {{ records: [{{ qipuId: '77000000023' }}] }},
}};
const document = {{ querySelectorAll: () => [{{ innerText: '自建棋谱' }}] }};
const invoke = async () => undefined;
const delay = async () => undefined;
{traversal_source}
const ids = [...found.keys()].join(',');
if (ids !== '77000000021,77000000022') throw new Error(`collector selected ${{ids}} instead of the visible self-recorded list`);
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise self-recorded list selection");
        assert!(
            output.status.success(),
            "collector did not recover the populated visible self-recorded root: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_known_49_move_coordinate_arrays() {
        let source = include_str!("ttxq_bridge.rs");
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
    fn collector_accepts_array_like_qipu_move_streams() {
        let source = include_str!("ttxq_bridge.rs");
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
const wrapped = {{
  0: 2, 1: 6, 2: 2, 3: 5, 4: 2, 5: 0, 6: 4, 7: 2,
  length: 8,
}};
const candidate = moveCandidate(wrapped, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep');
if (!candidate || candidate.text !== '26252042') {{
  throw new Error(`array-like qipu move stream was discarded: ${{JSON.stringify(candidate)}}`);
}}
const typed = new Uint8Array([2, 6, 2, 5, 2, 0, 4, 2]);
const typedCandidate = moveCandidate(typed, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep');
if (!typedCandidate || typedCandidate.text !== '26252042') {{
  throw new Error(`typed qipu move stream was discarded: ${{JSON.stringify(typedCandidate)}}`);
}}
"#
        );
        let mut child = std::process::Command::new("node")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Node.js is required to exercise array-like move streams");
        child
            .stdin
            .as_mut()
            .expect("array-like move checker stdin")
            .write_all(harness.as_bytes())
            .expect("write array-like move harness to Node.js");
        let output = child
            .wait_with_output()
            .expect("run array-like move checker");
        assert!(
            output.status.success(),
            "collector rejected array-like move data: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_move_objects_with_coordinate_to_string() {
        let source = include_str!("ttxq_bridge.rs");
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
    fn collector_invokes_function_valued_qipu_move_step() {
        let source = include_str!("ttxq_bridge.rs");
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
const owner = {{ calls: 0 }};
const candidate = moveCandidate(function () {{ this.calls += 1; return ['2625', '2042']; }}, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', owner);
if (!candidate || candidate.text !== '26252042' || owner.calls !== 1) {{
  throw new Error(`function-valued getQipuMoveStep was not materialized: ${{JSON.stringify(candidate)}}`);
}}
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise function-valued move fields");
        assert!(
            output.status.success(),
            "collector rejected a function-valued move field: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn collector_accepts_wrapped_array_elements_with_coordinate_to_string() {
        let source = include_str!("ttxq_bridge.rs");
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
        let source = include_str!("ttxq_bridge.rs");
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
        let source = include_str!("ttxq_bridge.rs");
        let traversal_start = source
            .find("      const qipuIdOf = (value) => {")
            .expect("qipu-list root selection must exist");
        let traversal_end = source[traversal_start..]
            .find("      if (!found.size) {")
            .expect("recent-list traversal must terminate")
            + traversal_start;
        let traversal_source = source[traversal_start..traversal_end]
            .replace("__TTXQ_ATTEMPT_ID__", "1")
            .replace("__TTXQ_BRIDGE_VERSION__", &BRIDGE_VERSION.to_string());
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
    fn collector_waits_beyond_the_legacy_twelve_poll_window() {
        let wait_source = collector_source_between(
            "      const snapshotHasCoordinateCandidate = (snapshot) =>",
            "      const readBranchRoutes = async",
        );
        let harness = format!(
            r#"(async () => {{
let reads = 0;
const owner = {{}};
const directNotifyMove = () => {{
  reads += 1;
  return reads >= 16
    ? {{ text: '26252042', path: 'board.getQipuMoveStep', type: 'array<number>', owner }}
    : null;
}};
const directModelMove = () => null;
const readRawMoves = () => null;
const liveLoadedId = () => '';
const delay = async () => undefined;
{wait_source}
const candidate = await waitForTarget('target', '', owner, [], 40);
if (reads < 17 || candidate.text !== '26252042') {{
  throw new Error('delayed move stream was not accepted after ' + reads + ' polls');
}}
}})().catch(error => {{ console.error(error.message); process.exitCode = 1; }});
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise delayed move loading");
        assert!(
            output.status.success(),
            "collector stopped before a delayed move stream settled: {}",
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
    fn collector_does_not_reject_current_moves_for_a_stale_generic_model_qipu_id() {
        let source = collector_source_between(
            "      const liveLoadedId = () => {",
            "      const snapshotHasCoordinateCandidate = (snapshot) =>",
        );
        let accepts_source = collector_source_between(
            "      const acceptsTargetCandidate = (candidate, qipuId",
            "      const waitForTarget = async",
        );
        let harness = format!(
            r#"(() => {{
const currentControl = {{}};
const notificationOwner = () => ({{ NOTIFY_QIPU_DATA: [{{ thisObj: {{ _boardControl: currentControl }} }}] }});
const model = {{ currentQipu: {{ qipuId: 'previous-game' }} }};
const qipuSources = () => [{{ qipuId: 'previous-game' }}];
{source}
{accepts_source}
const candidate = {{ text: '26252042', path: 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', type: 'array<number>', owner: currentControl }};
const beforeSignature = 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep:array<number>:26252042';
if (liveLoadedId() !== '') throw new Error(`stale model identity leaked into current-board check: ${{liveLoadedId()}}`);
if (!acceptsTargetCandidate(candidate, 'target-game', beforeSignature, currentControl, {{ coordinateSnapshot: true }})) {{
  throw new Error('current coordinate moves were rejected because a stale model qipu id was present');
}}
}})();
"#
        );
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(harness)
            .output()
            .expect("Node.js is required to exercise current-board identity precedence");
        assert!(
            output.status.success(),
            "collector let stale model identity reject current moves: {}",
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
            require_starting_fen: false,
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
                annotations: vec![],
                annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
        assert!(
            serde_json::to_value(&game)
                .unwrap()
                .get("metadataProbe")
                .is_none()
        );
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
    fn source_note_does_not_strip_source_like_lines_from_ttxq_annotations() {
        let mut record = ttxq_record("annotation-source-line");
        record.note = "本地备注\n来源：旧的自动元数据".into();
        record.annotations = vec![TtxqAnnotationDto {
            source_route_id: 0,
            absolute_after_ply: 0,
            text: "来源：棋友整理\n重点观察中路变化".into(),
            author: "作者甲".into(),
            created_at: "2026-08-31 10:00".into(),
            source_key: "root-1".into(),
            key_format: "root-alias".into(),
        }];

        let note = source_note(&record);

        assert!(note.contains("来源：棋友整理\n重点观察中路变化"));
        assert!(note.contains("本地备注"));
        assert!(!note.contains("来源：旧的自动元数据"));
        assert!(note.contains("来源：天天象棋网页"));
    }

    #[test]
    fn source_note_replaces_all_duplicate_managed_blocks_on_reimport() {
        let mut record = ttxq_record("duplicate-note-blocks");
        record.note = "本地备注\n来源：旧的自动元数据\n【天天象棋注解】\n旧注解\n【天天象棋注解结束】\n【天天象棋注解】\n更旧注解\n【天天象棋注解结束】".into();
        record.annotations = vec![TtxqAnnotationDto {
            source_route_id: 0,
            absolute_after_ply: 0,
            text: "最新注解".into(),
            author: "作者".into(),
            created_at: "2026-08-31 10:00".into(),
            source_key: "comment0_0".into(),
            key_format: "dhtml-comment".into(),
        }];

        let note = source_note(&record);
        assert_eq!(note.matches(TTXQ_ANNOTATION_BEGIN).count(), 1);
        assert_eq!(note.matches("最新注解").count(), 1);
        assert!(!note.contains("旧注解"));
        assert!(!note.contains("更旧注解"));
        assert!(!note.contains("旧的自动元数据"));
        assert!(note.contains("本地备注"));
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
            annotations: vec![],
            annotations_complete: true,
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
        let source = include_str!("ttxq_bridge.rs");
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
            "const selectedListRoots = qipuListRoots()",
            "selectedList && selectedList.value",
            "return explicitlyVisible.length === 1 ? explicitlyVisible : []",
            "const findObjectWithOwnProperty",
            "const findObjectWithProperty",
            "findObjectWithOwnProperty(window.fdk, 'NOTIFY_QIPU_DATA', 100_000)",
            "limit = 100_000",
            "const directNotifyMove",
            "const moveSurfaceOwners",
            "const directModelMove",
            "const materializeMoveValue",
            "const perMoveField = /(?:getMainMoveList|getLessonNextMoveStep)$/i.test(path)",
            "const numericTokens = dhtmlField && arrayLike ? arrayItems.map(numericToken) : []",
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
            "const polls = 40",
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
        let source = include_str!("ttxq_bridge.rs");
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
        assert_eq!(
            qipu_id_from_ordered_source_path(Some(&path)),
            Some("77048935338")
        );
        assert_eq!(
            qipu_id_from_ordered_source_path(Some("ttxq-order:000012:")),
            None
        );
        assert_eq!(source_order_from_path(Some("ttxq:77048935338")), None);
        assert_eq!(
            qipu_id_from_ordered_source_path(Some("ttxq:77048935338")),
            Some("77048935338")
        );
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
