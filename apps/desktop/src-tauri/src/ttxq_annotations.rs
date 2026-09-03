//! Tencent annotation parsing at import time and managed/local note merging.

use super::*;

pub(crate) fn source_note(record: &TtxqGameRecordDto) -> String {
    source_note_with_existing(&record.note, record)
}

pub(crate) fn split_ttxq_annotation_block(value: &str) -> (String, String) {
    let Some(start) = value.find(TTXQ_ANNOTATION_BEGIN) else {
        return (String::new(), value.trim().to_owned());
    };
    let content_start = start + TTXQ_ANNOTATION_BEGIN.len();
    let Some(relative_end) = value[content_start..].find(TTXQ_ANNOTATION_END) else {
        return (String::new(), value.trim().to_owned());
    };
    let end = content_start + relative_end;
    let source = value[content_start..end].trim().to_owned();
    let local = format!(
        "{}\n{}",
        &value[..start],
        &value[end + TTXQ_ANNOTATION_END.len()..]
    )
    .trim()
    .to_owned();
    (source, local)
}

pub(crate) fn local_ttxq_comment(value: &str) -> String {
    split_ttxq_annotation_block(value).1
}

fn strip_all_ttxq_annotation_blocks(value: &str) -> String {
    let mut remaining = value;
    let mut local = String::new();
    loop {
        let Some(start) = remaining.find(TTXQ_ANNOTATION_BEGIN) else {
            local.push_str(remaining);
            break;
        };
        local.push_str(&remaining[..start]);
        let content_start = start + TTXQ_ANNOTATION_BEGIN.len();
        let Some(relative_end) = remaining[content_start..].find(TTXQ_ANNOTATION_END) else {
            // Preserve malformed trailing text rather than silently deleting
            // a user's note when an older import was interrupted mid-write.
            local.push_str(&remaining[start..]);
            break;
        };
        remaining = &remaining[content_start + relative_end + TTXQ_ANNOTATION_END.len()..];
    }
    local.trim().to_owned()
}

pub(crate) fn merge_ttxq_local_comment(existing: &str, local: &str) -> String {
    let (source, _) = split_ttxq_annotation_block(existing);
    let source_block = (!source.is_empty())
        .then(|| format!("{TTXQ_ANNOTATION_BEGIN}\n{source}\n{TTXQ_ANNOTATION_END}"));
    [source_block.as_deref(), Some(local.trim())]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn annotation_managed_text(annotations: &[&TtxqAnnotationDto]) -> String {
    let body = annotations
        .iter()
        .map(|annotation| {
            let byline = [annotation.author.trim(), annotation.created_at.trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            let item = [
                (!byline.is_empty()).then_some(byline.as_str()),
                Some(annotation.text.trim()),
            ]
            .into_iter()
            .flatten()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
            if item.is_empty() {
                String::new()
            } else {
                format!("{TTXQ_ANNOTATION_ITEM_BEGIN}\n{item}\n{TTXQ_ANNOTATION_ITEM_END}")
            }
        })
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if body.is_empty() {
        String::new()
    } else {
        format!("{TTXQ_ANNOTATION_BEGIN}\n{body}\n{TTXQ_ANNOTATION_END}")
    }
}

fn replace_ttxq_annotations(existing: &str, annotations: &[&TtxqAnnotationDto]) -> String {
    let local = strip_all_ttxq_annotation_blocks(existing);
    [annotation_managed_text(annotations), local]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn source_note_with_existing(existing_note: &str, record: &TtxqGameRecordDto) -> String {
    let source_labels = [
        "来源",
        "棋谱手数",
        "回合",
        "对局时间",
        "对局用时",
        "用时规则",
        "网页分支",
    ];
    let root_annotations = record
        .annotations
        .iter()
        .filter(|annotation| annotation.source_route_id == 0 && annotation.absolute_after_ply == 0)
        .collect::<Vec<_>>();
    let local_note = strip_all_ttxq_annotation_blocks(existing_note);
    let mut local_lines: Vec<String> = local_note
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
    // Older imports could append the same source metadata on every retry.
    // Normalize the local portion before rebuilding the managed block so a
    // re-read is idempotent and does not make the note grow on each attempt.
    let mut seen_local_lines = HashSet::new();
    local_lines.retain(|line| seen_local_lines.insert(line.clone()));
    // A transient Tencent snapshot can contain valid moves but no mounted
    // msgContainer yet. An empty annotation list is therefore not an
    // instruction to erase annotations already imported from this qipu.
    let managed_annotations = if root_annotations.is_empty() {
        let existing_source = split_ttxq_annotation_block(existing_note).0;
        if existing_source.trim().is_empty() {
            String::new()
        } else {
            format!(
                "{TTXQ_ANNOTATION_BEGIN}\n{}\n{TTXQ_ANNOTATION_END}",
                existing_source.trim()
            )
        }
    } else {
        annotation_managed_text(&root_annotations)
    };
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
            if !local_lines.contains(&line) {
                local_lines.push(line);
            }
        }
    }
    [
        (!managed_annotations.is_empty()).then_some(managed_annotations),
        (!local_lines.is_empty()).then(|| local_lines.join("\n")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

pub(crate) fn ttxq_route_node_paths(
    tree: &xiangqi_manual::ManualTree,
    mainline_path: &[Uuid],
    variations: &[TtxqVariationDto],
) -> Result<HashMap<usize, Vec<Uuid>>, String> {
    fn collect(
        tree: &xiangqi_manual::ManualTree,
        parent_path: &[Uuid],
        parent_route_start: usize,
        variations: &[TtxqVariationDto],
        paths: &mut HashMap<usize, Vec<Uuid>>,
    ) -> Result<(), String> {
        for variation in variations {
            let anchor_index = parent_route_start
                .checked_add(variation.after_ply)
                .filter(|index| *index < parent_path.len())
                .ok_or("天天象棋注解的分支锚点超出路线")?;
            let anchor = *parent_path
                .get(anchor_index)
                .ok_or("天天象棋注解的分支锚点超出路线")?;
            let mut route_path = parent_path[..=anchor_index].to_vec();
            let mut parent = anchor;
            for (move_index, raw_move) in variation.moves.iter().enumerate() {
                let mv = Move::from_iccs(raw_move).map_err(|error| error.to_string())?;
                let branches = tree.branches(parent).map_err(|error| error.to_string())?;
                // Multiple Tencent routes can share the same first move at an
                // anchor. The importer stores the stable display route label
                // on that first node, so prefer it when rebuilding a source
                // route path; otherwise an ICCS-only lookup can bind every
                // annotation to whichever sibling happens to be enumerated
                // first. Subsequent nodes remain unambiguous by move.
                let route_label = variation
                    .route_no
                    .map(|route_no| format!("天天象棋路线 {route_no}"));
                let node = branches
                    .iter()
                    .find(|node| {
                        node.mv == mv
                            && move_index == 0
                            && route_label
                                .as_deref()
                                .is_some_and(|label| node.comment.contains(label))
                    })
                    .or_else(|| branches.iter().find(|node| node.mv == mv))
                    .ok_or("天天象棋注解无法匹配已导入的分支节点")?;
                parent = node.id;
                route_path.push(parent);
            }
            if let Some(source_route_id) = variation.source_route_id {
                paths.insert(source_route_id, route_path.clone());
            }
            collect(tree, &route_path, anchor_index, &variation.children, paths)?;
        }
        Ok(())
    }

    let mut paths = HashMap::from([(0usize, mainline_path.to_vec())]);
    collect(tree, mainline_path, 0, variations, &mut paths)?;
    Ok(paths)
}

pub(crate) fn apply_annotations_to_document(
    document: &mut ManualDocument,
    mainline_path: &[Uuid],
    record: &TtxqGameRecordDto,
) -> Result<(), String> {
    if record.annotations.is_empty() {
        return Ok(());
    }
    let paths = ttxq_route_node_paths(&document.tree, mainline_path, &record.variations)?;
    let mut by_node: HashMap<Uuid, Vec<&TtxqAnnotationDto>> = HashMap::new();
    for annotation in &record.annotations {
        let node_id = *paths
            .get(&annotation.source_route_id)
            .and_then(|path| path.get(annotation.absolute_after_ply))
            .ok_or_else(|| format!("天天象棋注解 {} 无法定位到棋谱节点", annotation.source_key))?;
        by_node.entry(node_id).or_default().push(annotation);
    }
    for (node_id, annotations) in by_node {
        if node_id == document.tree.root_id() {
            document.note = replace_ttxq_annotations(&document.note, &annotations);
        } else {
            let existing = document
                .tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .comment
                .clone();
            document
                .tree
                .update_comment(node_id, replace_ttxq_annotations(&existing, &annotations))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn update_existing_ttxq_annotations(
    model: &mut AppModel,
    game: &local_store::LocalGame,
    record: &TtxqGameRecordDto,
) -> Result<usize, String> {
    // Do not clear a previously imported managed block when a route read wins
    // a race before Tencent mounts its annotation container. A later complete
    // snapshot can still replace the block; an empty snapshot cannot prove
    // that the remote annotations were deleted.
    if record.annotations.is_empty() {
        return Ok(0);
    }
    let nodes = model
        .store
        .load_move_nodes(game.id)
        .map_err(|error| error.to_string())?;
    let existing_managed_nodes = nodes
        .iter()
        .filter(|node| !node.deleted && !split_ttxq_annotation_block(&node.comment).0.is_empty())
        .map(|node| node.id)
        .collect::<HashSet<_>>();
    let mut tree = xiangqi_manual::ManualTree::with_root(game.root_id);
    tree.restore_nodes(nodes)
        .map_err(|error| error.to_string())?;
    let mut mainline_path = vec![game.root_id];
    let mut parent = game.root_id;
    for raw_move in &record.moves {
        let next = tree
            .branches(parent)
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|node| node.is_mainline && node.mv.to_iccs() == raw_move.as_str())
            .ok_or("现有棋谱主线与天天象棋注解路线不一致")?;
        parent = next.id;
        mainline_path.push(parent);
    }
    let paths = ttxq_route_node_paths(&tree, &mainline_path, &record.variations)?;
    let mut by_node: HashMap<Uuid, Vec<&TtxqAnnotationDto>> = HashMap::new();
    for annotation in record.annotations.iter().filter(|annotation| {
        !(annotation.source_route_id == 0 && annotation.absolute_after_ply == 0)
    }) {
        let node_id = *paths
            .get(&annotation.source_route_id)
            .and_then(|path| path.get(annotation.absolute_after_ply))
            .ok_or_else(|| format!("天天象棋注解 {} 无法定位到棋谱节点", annotation.source_key))?;
        by_node.entry(node_id).or_default().push(annotation);
    }
    let mut changed = 0;
    let root_annotations = record
        .annotations
        .iter()
        .filter(|annotation| annotation.source_route_id == 0 && annotation.absolute_after_ply == 0)
        .collect::<Vec<_>>();
    let root_note = replace_ttxq_annotations(&game.note, &root_annotations);
    if root_note != game.note {
        let metadata =
            serde_json::from_str::<ManualMetadata>(&game.metadata_json).unwrap_or_default();
        let operation = super::next_operation_for_game(
            model,
            game.id,
            OperationKind::UpdateGameMetadata,
            serde_json::to_value(metadata_payload(&metadata, &root_note))
                .map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_game_metadata_with_operation(
                game.id,
                &game.title,
                &root_note,
                &game.metadata_json,
                &operation,
            )
            .map_err(|error| error.to_string())?;
        changed += 1;
    }
    let mut target_nodes = existing_managed_nodes;
    target_nodes.extend(by_node.keys().copied());
    for node_id in target_nodes {
        let annotations = by_node.remove(&node_id).unwrap_or_default();
        let existing = tree
            .node(node_id)
            .map_err(|error| error.to_string())?
            .comment
            .clone();
        let comment = replace_ttxq_annotations(&existing, &annotations);
        if comment == existing {
            continue;
        }
        let operation = super::next_operation_for_game(
            model,
            game.id,
            OperationKind::UpdateComment,
            serde_json::to_value(UpdateCommentPayload {
                node_id,
                comment: comment.clone(),
            })
            .map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_comment_with_operation(node_id, &comment, &operation)
            .map_err(|error| error.to_string())?;
        tree.update_comment(node_id, comment)
            .map_err(|error| error.to_string())?;
        changed += 1;
    }
    Ok(changed)
}
