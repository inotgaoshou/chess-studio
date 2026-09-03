//! Main-line and DhtmlXQ variation decoding.
//!
//! The decoder is intentionally independent from page collection so malformed
//! branch payloads cannot affect bridge state or annotation ownership.

use super::*;

pub(crate) fn resolved_moves(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> Result<Vec<String>, String> {
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

pub(crate) fn extract_dhtml_moves(record: &TtxqGameRecordDto) -> Vec<String> {
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

pub(crate) fn bridge_snapshot_mentions_move_field(record: &TtxqGameRecordDto) -> bool {
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

pub(crate) fn extract_iccs_moves(text: &str) -> Vec<String> {
    text.char_indices()
        .filter_map(|(index, _)| text.get(index..).and_then(|remaining| remaining.get(..4)))
        .filter(|value| is_iccs(value))
        .map(str::to_ascii_lowercase)
        .collect()
}

#[derive(Debug, Clone)]
pub(crate) struct TtxqBranchCandidate {
    pub(crate) source_key: String,
    pub(crate) raw: String,
    pub(crate) after_ply: Option<usize>,
    pub(crate) route_no: Option<usize>,
    pub(crate) comment: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DhtmlBranchKey {
    pub(crate) parent_route_id: usize,
    pub(crate) local_start_ply_1_based: usize,
    pub(crate) route_id: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct DecodedDhtmlBranch {
    pub(crate) key: DhtmlBranchKey,
    pub(crate) prefix_before_moves: Vec<String>,
    pub(crate) variation: TtxqVariationDto,
}

pub(crate) fn prepare_import_record(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> Result<TtxqGameRecordDto, String> {
    let mut prepared = record.clone();
    // The caller has already selected and validated the live position. Keep
    // it on the prepared DTO so the importer and later re-import paths cannot
    // accidentally treat a valid custom/endgame position as missing.
    prepared.starting_fen = starting_fen.trim().to_owned();
    prepared.moves = resolved_moves(&prepared, starting_fen)?;
    let decoded = decode_ttxq_branch_variations(&prepared, starting_fen)?;
    let expected_display_routes = branch_route_numbers(&prepared.branch_data)
        .into_iter()
        .filter(|route_no| *route_no >= 2)
        .collect::<Vec<_>>();
    let expected_source_routes = dhtml_branch_route_numbers(&prepared.branch_data);
    let decoded_display_routes = decoded_branch_routes(&decoded);
    let decoded_source_routes = decoded_source_branch_routes(&decoded);
    if decoded.is_empty()
        && branch_data_has_real_signal(&prepared.branch_data)
        && !prepared.branch_complete
    {
        return Err(ttxq_branch_failure_message(&prepared));
    }
    let mut missing_routes = expected_display_routes
        .iter()
        .copied()
        .filter(|route_no| !decoded_display_routes.contains(route_no))
        .collect::<Vec<_>>();
    missing_routes.extend(
        expected_source_routes
            .iter()
            .copied()
            .filter(|route_id| !decoded_source_routes.contains(route_id)),
    );
    missing_routes.sort_unstable();
    missing_routes.dedup();
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
    if !prepared.annotations_complete {
        return Err(ttxq_annotation_failure_message(&prepared));
    }
    let mut route_lengths = HashMap::from([(0usize, prepared.moves.len())]);
    fn collect_route_lengths(
        variations: &[TtxqVariationDto],
        parent_route_start: usize,
        lengths: &mut HashMap<usize, usize>,
    ) {
        for variation in variations {
            let Some(absolute_anchor) = parent_route_start.checked_add(variation.after_ply) else {
                continue;
            };
            if let Some(source_route_id) = variation.source_route_id {
                lengths.insert(source_route_id, absolute_anchor + variation.moves.len());
            }
            collect_route_lengths(&variation.children, absolute_anchor, lengths);
        }
    }
    collect_route_lengths(&prepared.variations, 0, &mut route_lengths);
    let mut seen = HashSet::new();
    prepared.annotations.retain(|annotation| {
        seen.insert((
            annotation.source_route_id,
            annotation.absolute_after_ply,
            annotation.source_key.clone(),
            annotation.author.clone(),
            annotation.created_at.clone(),
            annotation.text.clone(),
        ))
    });
    let mut available_routes = route_lengths.keys().copied().collect::<Vec<_>>();
    available_routes.sort_unstable();
    let available_routes = available_routes
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("/");
    for annotation in &prepared.annotations {
        if annotation.source_route_id > 512
            || annotation.text.trim().is_empty()
            || annotation.text.len() > 8 * 1024
        {
            return Err("天天象棋注解格式无效；本盘未导入".into());
        }
        let Some(route_length) = route_lengths.get(&annotation.source_route_id) else {
            return Err(format!(
                "天天象棋注解 {} 的来源路线 {} 不存在（已解析路线 {}）；本盘未导入",
                annotation.source_key, annotation.source_route_id, available_routes
            ));
        };
        if annotation.absolute_after_ply > *route_length {
            return Err(format!(
                "天天象棋注解 {} 的绝对位置 {} 超出来源路线 {}（最大绝对位置 {}）；本盘未导入",
                annotation.source_key,
                annotation.absolute_after_ply,
                annotation.source_route_id,
                route_length,
            ));
        }
    }
    Ok(prepared)
}

pub(crate) fn branch_route_numbers(payload: &str) -> Vec<usize> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    fn collect(value: &serde_json::Value, result: &mut Vec<usize>, depth: usize) {
        if depth > 8 || result.len() >= 512 {
            return;
        }
        match value {
            serde_json::Value::Array(values) => {
                for value in values.iter().take(512) {
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
                            .filter(|route_no| (1..=512).contains(route_no)),
                    );
                }
                let numeric_keys = values
                    .keys()
                    .filter_map(|key| key.parse::<usize>().ok())
                    .filter(|route_no| (1..=512).contains(route_no))
                    .collect::<Vec<_>>();
                if numeric_keys.len() >= 2 {
                    result.extend(numeric_keys);
                }
                for value in values.values().take(512) {
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

/// Return true only when the bridge payload contains evidence of an actual
/// Tencent variation graph. Annotation-only envelopes may be non-empty (and
/// may be incomplete after their independent scan budget expires), but they
/// must not be reported as missing branch moves.
pub(crate) fn branch_data_has_real_signal(payload: &str) -> bool {
    if payload.trim().is_empty() {
        return false;
    }
    if !serde_json::from_str::<serde_json::Value>(payload).is_ok() {
        return !branch_candidates_from_payload(payload).is_empty();
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return false;
    };
    if !branch_candidates_from_payload(payload).is_empty() {
        return true;
    }
    let object = value.as_object();
    let has_routes = object
        .and_then(|map| map.get("routeNumbers"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|routes| routes.len() > 1);
    let has_attempts = object
        .and_then(|map| map.get("routesAttempted"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|routes| !routes.is_empty());
    let has_failures = object
        .and_then(|map| map.get("routeFailures"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|failures| !failures.is_empty());
    let has_branch_signal = object
        .and_then(|map| map.get("signals"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|signals| {
            signals.iter().any(|signal| {
                signal
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|path| path.contains("getMoveBranchKey"))
            })
        });
    // The bridge fails closed for newer/obfuscated route keys when their
    // value contains a coordinate-like payload. Such a payload is real
    // branch evidence even though it cannot yet be decoded safely.
    let has_unknown_coordinate_key = object
        .and_then(|map| map.get("unknownBranchKeySeen"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    has_routes || has_attempts || has_failures || has_branch_signal || has_unknown_coordinate_key
}

pub(crate) fn expected_branch_routes(payload: &str) -> Vec<usize> {
    let mut routes = branch_route_numbers(payload)
        .into_iter()
        .filter(|route_no| *route_no >= 2)
        .collect::<Vec<_>>();
    routes.extend(dhtml_branch_route_numbers(payload));
    routes.sort_unstable();
    routes.dedup();
    routes
}

pub(crate) fn dhtml_branch_route_numbers(payload: &str) -> Vec<usize> {
    let mut routes = branch_candidates_from_payload(payload)
        .iter()
        .filter_map(|candidate| dhtml_branch_key(&candidate.source_key))
        .map(|key| key.route_id)
        .collect::<Vec<_>>();
    routes.sort_unstable();
    routes.dedup();
    routes
}

pub(crate) fn decoded_branch_routes(variations: &[TtxqVariationDto]) -> HashSet<usize> {
    let mut routes = HashSet::new();
    for variation in variations {
        if let Some(route_no) = variation.route_no {
            routes.insert(route_no);
        } else if let Some(source_route_id) = variation.source_route_id {
            routes.insert(source_route_id + 1);
        }
        routes.extend(decoded_branch_routes(&variation.children));
    }
    routes
}

pub(crate) fn decoded_source_branch_routes(variations: &[TtxqVariationDto]) -> HashSet<usize> {
    let mut routes = HashSet::new();
    for variation in variations {
        if let Some(source_route_id) = variation.source_route_id {
            routes.insert(source_route_id);
        }
        routes.extend(decoded_source_branch_routes(&variation.children));
    }
    routes
}

pub(crate) fn recursive_variation_count(variations: &[TtxqVariationDto]) -> usize {
    variations
        .iter()
        .map(|variation| 1 + recursive_variation_count(&variation.children))
        .sum()
}

pub(crate) fn recursive_variation_node_count(variations: &[TtxqVariationDto]) -> usize {
    variations
        .iter()
        .map(|variation| {
            variation.moves.len() + recursive_variation_node_count(&variation.children)
        })
        .sum()
}

pub(crate) fn variation_has_too_many_moves(variation: &TtxqVariationDto) -> bool {
    variation.moves.len() > MAX_MOVES_PER_GAME
        || variation.children.iter().any(variation_has_too_many_moves)
}

pub(crate) fn variation_has_invalid_iccs(variation: &TtxqVariationDto) -> bool {
    variation.moves.iter().any(|mv| !is_iccs(mv))
        || variation.children.iter().any(variation_has_invalid_iccs)
}

pub(crate) fn merge_variations(
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

pub(crate) fn decode_ttxq_branch_variations(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> Result<Vec<TtxqVariationDto>, String> {
    if record.branch_data.trim().is_empty() {
        return Ok(Vec::new());
    }
    let candidates = branch_candidates_from_payload(&record.branch_data);
    if let Some(candidate) = candidates.iter().find(|candidate| {
        candidate.source_key.contains("getMoveBranchKey")
            && dhtml_branch_key(&candidate.source_key).is_none()
    }) {
        return Err(format!(
            "天天象棋分支键 {} 无效，应为父路线-1基首着序号-当前路线；本盘未导入",
            candidate.source_key
        ));
    }
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
                source_route_id: candidate.route_no.and_then(|route| route.checked_sub(1)),
                source_key: candidate.source_key,
                comment: candidate.comment,
                children: Vec::new(),
            });
        }
    }
    Ok(dedupe_variations(variations))
}

pub(crate) fn decode_dhtml_branch_tree(
    mainline: &[String],
    mut candidates: Vec<TtxqBranchCandidate>,
    starting_fen: &str,
) -> Result<Vec<TtxqVariationDto>, String> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    candidates.sort_by_key(|candidate| {
        dhtml_branch_key(&candidate.source_key)
            .map(|key| key.route_id)
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
            if decoded.contains_key(&key.route_id) {
                continue;
            }
            let (parent_line, parent_prefix_len, parent_local_len) = if key.parent_route_id == 0 {
                (mainline.to_vec(), 0, mainline.len())
            } else if let Some(parent) = decoded.get(&key.parent_route_id) {
                let mut line = parent.prefix_before_moves.clone();
                let prefix_len = line.len();
                let local_len = parent.variation.moves.len();
                line.extend(parent.variation.moves.iter().cloned());
                (line, prefix_len, local_len)
            } else {
                next.push(candidate);
                continue;
            };
            let local_after_ply = key.local_start_ply_1_based - 1;
            if local_after_ply > parent_local_len {
                return Err(format!(
                    "天天象棋分支 {} 的锚点超出父路线 {}：从第 {} 着开始，父路线仅 {} 半回合；本盘未导入",
                    candidate.source_key,
                    key.parent_route_id,
                    key.local_start_ply_1_based,
                    parent_local_len
                ));
            }
            let candidate_moves = dhtml_branch_candidate_moves(&candidate.raw);
            if candidate_moves.is_empty() {
                return Err(format!(
                    "天天象棋分支 {} 的走法格式无法按 DhtmlXQ 左上角坐标解析；本盘未导入",
                    candidate.source_key
                ));
            }
            let Some(absolute_after_ply) = parent_prefix_len.checked_add(local_after_ply) else {
                return Err(format!(
                    "天天象棋分支 {} 的锚点数值溢出；本盘未导入",
                    candidate.source_key
                ));
            };
            if !branch_tail_differs(&parent_line, absolute_after_ply, &candidate_moves) {
                return Err(format!(
                    "天天象棋分支 {} 在父线路第 {} 半回合后与原路线相同；本盘未导入",
                    candidate.source_key, local_after_ply
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
                key.route_id,
                DecodedDhtmlBranch {
                    key,
                    prefix_before_moves,
                    variation: TtxqVariationDto {
                        after_ply: local_after_ply,
                        moves: candidate_moves,
                        route_no: Some(key.route_id + 1),
                        source_route_id: Some(key.route_id),
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
                .map(|key| key.route_id.to_string())
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
            .entry(branch.key.parent_route_id)
            .or_default()
            .push(branch.key.route_id);
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

pub(crate) fn branch_candidates_from_payload(payload: &str) -> Vec<TtxqBranchCandidate> {
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
                    .map(|key| key.local_start_ply_1_based - 1)
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

pub(crate) fn collect_branch_candidates(
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

pub(crate) fn branch_route_no_hint(value: &serde_json::Value, path: &str) -> Option<usize> {
    if let serde_json::Value::Object(map) = value {
        for key in ["routeNo", "route", "branchNo", "lineNo", "variationNo"] {
            if let Some(route_no) = map.get(key).and_then(json_usize) {
                if (1..=512).contains(&route_no) {
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

pub(crate) fn route_no_from_source_path(path: &str) -> Option<usize> {
    let marker = "route[";
    let start = path.find(marker)? + marker.len();
    let end = path[start..].find(']')? + start;
    path[start..end]
        .parse::<usize>()
        .ok()
        .filter(|route_no| (1..=512).contains(route_no))
}

pub(crate) fn branch_after_ply_hint(value: &serde_json::Value, path: &str) -> Option<usize> {
    if let Some(key) = dhtml_branch_key(path) {
        return Some(key.local_start_ply_1_based - 1);
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

pub(crate) fn dhtml_branch_key(path: &str) -> Option<DhtmlBranchKey> {
    let (_, key) = path.rsplit_once("getMoveBranchKey.")?;
    let key = key.trim();
    if key.contains('.') {
        return None;
    }
    let mut parts = key.split('-');
    let parent_route_id = parts.next()?.parse().ok()?;
    let local_start_ply_1_based = parts.next()?.parse().ok()?;
    let route_id = parts.next()?.parse().ok()?;
    if parts.next().is_some()
        || local_start_ply_1_based == 0
        || local_start_ply_1_based > MAX_MOVES_PER_GAME
        || route_id == 0
        || route_id > 512
        || parent_route_id > 512
    {
        return None;
    }
    Some(DhtmlBranchKey {
        parent_route_id,
        local_start_ply_1_based,
        route_id,
    })
}

pub(crate) fn branch_comment_hint(value: &serde_json::Value) -> Option<String> {
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

pub(crate) fn json_usize(value: &serde_json::Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|number| usize::try_from(number).ok())
        .or_else(|| value.as_str()?.trim().parse::<usize>().ok())
}

pub(crate) fn json_text(value: &serde_json::Value) -> Option<&str> {
    match value {
        serde_json::Value::String(text) => Some(text),
        _ => None,
    }
}

pub(crate) fn branch_raw_text(value: &serde_json::Value, path: &str) -> Option<String> {
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

pub(crate) fn looks_like_move_payload(text: &str) -> bool {
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

pub(crate) fn contains_dhtml_move_tag(text: &str) -> bool {
    text.contains("[DhtmlXQ_move_") || text.contains("[DhtmlXQ_movelist]")
}

pub(crate) fn branch_candidate_moves(
    raw: &str,
    starting_fen: &str,
    after_ply: Option<usize>,
) -> Vec<String> {
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

pub(crate) fn dhtml_branch_candidate_moves(raw: &str) -> Vec<String> {
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
    Vec::new()
}

pub(crate) fn validate_dhtml_branch_at_exact_anchor(
    starting_fen: &str,
    parent_line: &[String],
    after_ply: usize,
    tail: &[String],
    source_key: &str,
    key: DhtmlBranchKey,
) -> Result<(), String> {
    let mut board = Board::from_fen(starting_fen).map_err(|_| {
        format!(
            "天天象棋分支 {source_key} 缺少可用的起始 FEN，无法校验 DhtmlXQ 左上角坐标；本盘未导入"
        )
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
                "天天象棋分支 {source_key}（DhtmlXQ 左上角坐标，父路线 {}，从第 {} 着开始）在第 {after_ply} 半回合后第 {} 着 {raw_move} 格式无效（锚点由{anchor_side}行棋）；本盘未导入",
                key.parent_route_id,
                key.local_start_ply_1_based,
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
                "天天象棋分支 {source_key}（DhtmlXQ 左上角坐标，父路线 {}，从第 {} 着开始）在第 {after_ply} 半回合后{move_label}非法（锚点由{anchor_side}行棋）；本盘未导入",
                key.parent_route_id, key.local_start_ply_1_based
            )
        })?;
    }
    Ok(())
}

pub(crate) fn dhtml_tagged_move_segments(raw: &str) -> Vec<(Option<usize>, String)> {
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

pub(crate) fn locate_branch_tail(
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
    // A route without a deterministic anchor must not be attached by scanning
    // every legal position: the same tail can be legal in more than one place,
    // which silently corrupts the variation tree. DhtmlXQ A-B-C routes are
    // handled above; legacy candidates must carry an explicit afterPly hint.
    let _ = (starting_fen, mainline, candidate_moves);
    None
}

pub(crate) fn branch_tail_differs(mainline: &[String], after_ply: usize, tail: &[String]) -> bool {
    !tail.is_empty()
        && match mainline.get(after_ply) {
            Some(mainline_move) => mainline_move != &tail[0],
            None => true,
        }
}

pub(crate) fn variation_is_legal(
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

pub(crate) fn dedupe_variations(mut variations: Vec<TtxqVariationDto>) -> Vec<TtxqVariationDto> {
    for variation in &mut variations {
        variation.children = dedupe_variations(std::mem::take(&mut variation.children));
    }
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
            .then_with(|| left.route_no.is_none().cmp(&right.route_no.is_none()))
            .then_with(|| left.route_no.cmp(&right.route_no))
            .then_with(|| left.moves.len().cmp(&right.moves.len()))
            .then_with(|| left.moves.cmp(&right.moves))
    });
    variations
}
