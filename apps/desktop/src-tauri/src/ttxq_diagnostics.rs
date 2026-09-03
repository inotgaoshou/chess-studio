//! Bounded diagnostics and preview shaping for Tencent Xiangqi imports.

use super::*;

pub(crate) fn ttxq_branch_route_summary(record: &TtxqGameRecordDto) -> Option<String> {
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

pub(crate) fn ttxq_branch_failure_message(record: &TtxqGameRecordDto) -> String {
    if serde_json::from_str::<serde_json::Value>(&record.branch_data)
        .ok()
        .and_then(|value| value.get("unknownBranchKeySeen").cloned())
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return "检测到未知的天天象棋分支键且包含坐标数据，当前版本无法安全解析；为避免丢失变招，本盘未导入".into();
    }
    ttxq_branch_route_summary(record).unwrap_or_else(|| {
        "已发现天天象棋分支字段，但未识别到可校验的分支走法；为避免丢失变招，本盘暂不导入".into()
    })
}

pub(crate) fn ttxq_branch_decode_failure(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
    resolved_mainline: Option<&[String]>,
) -> Option<String> {
    if !branch_data_has_real_signal(&record.branch_data) || record.branch_complete {
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

pub(crate) fn dhtml_branch_absolute_anchor(
    key: DhtmlBranchKey,
    keys_by_id: &HashMap<usize, DhtmlBranchKey>,
    visiting: &mut HashSet<usize>,
) -> Option<usize> {
    let local_after_ply = key.local_start_ply_1_based.checked_sub(1)?;
    if key.parent_route_id == 0 {
        return Some(local_after_ply);
    }
    if !visiting.insert(key.route_id) {
        return None;
    }
    let parent = *keys_by_id.get(&key.parent_route_id)?;
    let absolute =
        dhtml_branch_absolute_anchor(parent, keys_by_id, visiting)?.checked_add(local_after_ply);
    visiting.remove(&key.route_id);
    absolute
}

pub(crate) fn ttxq_branch_diagnostic_sample(
    record: &TtxqGameRecordDto,
    starting_fen: &str,
) -> String {
    let candidates = branch_candidates_from_payload(&record.branch_data);
    let keys_by_id = candidates
        .iter()
        .filter_map(|candidate| dhtml_branch_key(&candidate.source_key))
        .map(|key| (key.route_id, key))
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
                        if side == Color::Red { "red" } else { "black" }
                    })
                });
                let decoded = dhtml_branch_candidate_moves(&candidate.raw);
                serde_json::json!({
                    "sourcePath": candidate.source_key,
                    "coordinateMode": "dhtmlxq-top-left",
                    "parentRouteId": key.parent_route_id,
                    "localStartPly1Based": key.local_start_ply_1_based,
                    "localAfterPly": key.local_start_ply_1_based - 1,
                    "absoluteAnchorPly": absolute_anchor,
                    "routeId": key.route_id,
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

pub(crate) fn ttxq_annotation_key_samples(record: &TtxqGameRecordDto) -> Vec<serde_json::Value> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&record.branch_data) else {
        return Vec::new();
    };
    value
        .get("annotationKeySamples")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .take(24)
        .filter_map(|sample| {
            let map = sample.as_object()?;
            Some(serde_json::json!({
                "path": map.get("path").and_then(json_text).unwrap_or("").chars().take(240).collect::<String>(),
                "key": map.get("key").and_then(json_text).unwrap_or("").chars().take(120).collect::<String>(),
                "keyFormat": map.get("keyFormat").and_then(json_text).unwrap_or("unknown").chars().take(80).collect::<String>(),
                "rows": map.get("rows").and_then(json_usize).unwrap_or_default().min(32),
                "hasMsg": map.get("hasMsg").and_then(serde_json::Value::as_bool).unwrap_or(false),
                "hasTime": map.get("hasTime").and_then(serde_json::Value::as_bool).unwrap_or(false),
                "hasUname": map.get("hasUname").and_then(serde_json::Value::as_bool).unwrap_or(false),
            }))
        })
        .collect()
}

pub(crate) fn ttxq_annotation_failure_message(record: &TtxqGameRecordDto) -> String {
    let key_samples = ttxq_annotation_key_samples(record);
    let unknown_keys = key_samples
        .iter()
        .filter(|sample| sample.get("keyFormat").and_then(json_text) == Some("unknown"))
        .filter_map(|sample| sample.get("key").and_then(json_text).map(ToOwned::to_owned))
        .take(3)
        .collect::<Vec<_>>();
    if unknown_keys.is_empty() {
        "天天象棋注解存在但无法确定对应路线或局面；本盘未导入".into()
    } else {
        format!(
            "天天象棋注解键 {} 格式无法识别；本盘未导入",
            unknown_keys.join("/")
        )
    }
}

pub(crate) fn ttxq_annotation_diagnostic_sample(record: &TtxqGameRecordDto) -> String {
    let annotations = record
        .annotations
        .iter()
        .take(64)
        .map(|annotation| {
            serde_json::json!({
                "sourceRouteId": annotation.source_route_id,
                "absoluteAfterPly": annotation.absolute_after_ply,
                "sourceKey": annotation.source_key.chars().take(240).collect::<String>(),
                "keyFormat": annotation.key_format.chars().take(80).collect::<String>(),
                "hasAuthor": !annotation.author.trim().is_empty(),
                "hasCreatedAt": !annotation.created_at.trim().is_empty(),
                "textLength": annotation.text.chars().count(),
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "annotationKeySamples": ttxq_annotation_key_samples(record),
        "annotations": annotations,
    })
    .to_string()
    .chars()
    .take(32 * 1024)
    .collect()
}

pub(crate) fn diagnostic_summary(record: &TtxqGameRecordDto) -> Option<String> {
    if !record.annotations_complete {
        return Some(ttxq_annotation_failure_message(record));
    }
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

pub(crate) fn ttxq_game_preview(game: &TtxqGameRecordDto) -> TtxqGamePreviewDto {
    if game.starting_fen.trim().is_empty() {
        return TtxqGamePreviewDto {
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
            move_count: 0,
            variation_count: 0,
            route_count: 1,
            decoded_route_count: 0,
            variation_node_count: 0,
            branch_complete: game.branch_complete,
            annotation_count: game.annotations.len(),
            annotations_complete: game.annotations_complete,
            valid: false,
            error: Some(
                "未取得可校验的初始局面，拒绝导入以避免棋子丢失；请在天天象棋打开该盘后重新读取"
                    .into(),
            ),
            diagnostic: diagnostic_summary(game),
        };
    }
    let starting_fen = if game.starting_fen.trim().is_empty() {
        STARTING_FEN
    } else {
        game.starting_fen.as_str()
    };
    let parsed_mainline = resolved_moves(game, starting_fen).unwrap_or_default();
    let parsed_mainline_count = parsed_mainline.len();
    match prepare_import_record(game, starting_fen) {
        Ok(prepared) => {
            let dhtml_route_numbers = dhtml_branch_route_numbers(&prepared.branch_data);
            let has_dhtml_routes = !dhtml_route_numbers.is_empty();
            let route_numbers = if has_dhtml_routes {
                dhtml_route_numbers
            } else {
                branch_route_numbers(&prepared.branch_data)
            };
            let decoded_routes = if has_dhtml_routes {
                decoded_source_branch_routes(&prepared.variations)
            } else {
                decoded_branch_routes(&prepared.variations)
            };
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
                decoded_route_count: if has_dhtml_routes {
                    route_numbers
                        .iter()
                        .filter(|route_no| decoded_routes.contains(route_no))
                        .count()
                } else if route_numbers.is_empty() {
                    1
                } else {
                    1 + decoded_routes
                        .iter()
                        .filter(|route_no| **route_no >= 2)
                        .count()
                },
                variation_node_count: recursive_variation_node_count(&prepared.variations),
                branch_complete: prepared.branch_complete,
                annotation_count: prepared.annotations.len(),
                annotations_complete: prepared.annotations_complete,
                valid: true,
                error: None,
                diagnostic: None,
            }
        }
        Err(error) => {
            let dhtml_route_numbers = dhtml_branch_route_numbers(&game.branch_data);
            let has_dhtml_routes = !dhtml_route_numbers.is_empty();
            let route_numbers = if has_dhtml_routes {
                dhtml_route_numbers
            } else {
                branch_route_numbers(&game.branch_data)
            };
            let mut diagnostic_record = game.clone();
            diagnostic_record.moves = parsed_mainline;
            let decoded_variations =
                decode_ttxq_branch_variations(&diagnostic_record, starting_fen).unwrap_or_default();
            let decoded_routes = if has_dhtml_routes {
                decoded_source_branch_routes(&decoded_variations)
            } else {
                decoded_branch_routes(&decoded_variations)
            };
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
                decoded_route_count: if has_dhtml_routes {
                    route_numbers
                        .iter()
                        .filter(|route_no| decoded_routes.contains(route_no))
                        .count()
                } else if route_numbers.is_empty() {
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
                annotation_count: game.annotations.len(),
                annotations_complete: game.annotations_complete,
                valid: false,
                error: Some(error),
                diagnostic: diagnostic_summary(game),
            }
        }
    }
}
