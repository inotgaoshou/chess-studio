use super::*;
use crate::{
    link_service::{
        active_screenshot_resolution, invalidate_screenshot_move_resolution,
        validate_screenshot_resolution_binding, validate_screenshot_resolution_move,
    },
    training_service::normalize_chinese_move_text,
};

#[tauri::command]
pub(crate) fn get_state(state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn list_games(state: State<'_, DesktopState>) -> Result<Vec<GameSummaryDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    Ok(model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|game| {
            let source_order = ttxq_sync::source_order_from_path(game.source_path.as_deref());
            let metadata = serde_json::from_str::<ManualMetadata>(&game.metadata_json).ok();
            let non_empty = |value: Option<String>| value.filter(|value| !value.trim().is_empty());
            let source_value = |name: &str| game.note.lines().find_map(|line| {
                line.strip_prefix(&format!("{name}："))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
            });
            let move_count = model.store.load_move_nodes(game.id)
                .map_err(|error| error.to_string())?
                .into_iter().filter(|node| !node.deleted).count();
            let mirror = model
                .store
                .game_mirror_status(game.id)
                .map_err(|error| error.to_string())?
                .map(Into::into);
            Ok(GameSummaryDto {
                id: game.id,
                title: game.title,
                fen: game.starting_fen,
                updated_at: game.updated_at,
                current: game.id == model.game_id,
                library_folder: game.library_folder,
                favorite: game.favorite,
                tags: game.tags,
                source_format: game.source_format,
                source_order,
                red: non_empty(metadata.as_ref().map(|metadata| metadata.red.clone())),
                black: non_empty(metadata.as_ref().map(|metadata| metadata.black.clone())),
                date: non_empty(metadata.as_ref().map(|metadata| metadata.date.clone())),
                result: non_empty(metadata.as_ref().map(|metadata| metadata.result.clone())),
                event: non_empty(metadata.as_ref().map(|metadata| metadata.event.clone())),
                round: source_value("回合").or_else(|| source_value("棋谱手数")),
                played_at: source_value("对局时间"),
                duration: source_value("对局用时"),
                time_control: source_value("用时规则"),
                move_count,
                mirror,
            })
        })
        .collect::<Result<Vec<_>, String>>()?)
}

#[tauri::command]
pub(crate) fn get_game_metadata(game_id: Uuid, state: State<'_, DesktopState>) -> Result<GameMetadataDto, String> {
    let model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let game = model.store.load_game(game_id).map_err(|error| error.to_string())?.ok_or("棋谱不存在")?;
    let metadata = serde_json::from_str::<ManualMetadata>(&game.metadata_json).unwrap_or_default();
    Ok(GameMetadataDto { title: game.title, event: metadata.event, site: metadata.site, date: metadata.date, red: metadata.red, black: metadata.black, result: metadata.result, note: game.note })
}

#[tauri::command]
pub(crate) fn update_game_metadata_for_game(game_id: Uuid, metadata: GameMetadataDto, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    let title = metadata.title.trim();
    if title.is_empty() { return Err("棋谱标题不能为空".into()); }
    if model.store.load_game(game_id).map_err(|error| error.to_string())?.is_none() { return Err("棋谱不存在".into()); }
    let document_metadata = ManualMetadata { title: title.to_owned(), event: metadata.event.trim().to_owned(), site: metadata.site.trim().to_owned(), date: metadata.date.trim().to_owned(), red: metadata.red.trim().to_owned(), black: metadata.black.trim().to_owned(), result: metadata.result.trim().to_owned(), };
    let payload = metadata_payload(&document_metadata, &metadata.note);
    let operation = next_operation_for_game(&mut model, game_id, OperationKind::UpdateGameMetadata, serde_json::to_value(payload).map_err(|error| error.to_string())?);
    let metadata_json = serde_json::to_string(&document_metadata).map_err(|error| error.to_string())?;
    model.store.update_game_metadata_with_operation(game_id, title, &metadata.note, &metadata_json, &operation).map_err(|error| error.to_string())?;
    if model.game_id == game_id {
        model.metadata = document_metadata;
        model.note = metadata.note;
        let _ = sync_current_game_mirror(&mut model);
    }
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn delete_games(game_ids: Vec<Uuid>, state: State<'_, DesktopState>) -> Result<(), String> {
    if game_ids.is_empty() { return Ok(()); }
    let mut model = state.model.lock().map_err(|_| "state lock poisoned".to_owned())?;
    if game_ids.iter().any(|game_id| *game_id == model.game_id) {
        return Err("请先打开另一盘棋，再删除当前复盘棋谱".into());
    }
    for game_id in game_ids {
        if model.store.load_game(game_id).map_err(|error| error.to_string())?.is_none() { continue; }
        model.store.delete_game_locally(game_id).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn default_game_mirror_root() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Documents")
        .join("棋研棋谱")
}

pub(crate) fn configured_game_mirror_root(preferences: &DesktopPreferences) -> PathBuf {
    let root = preferences.game_mirror_root.trim();
    if root.is_empty() {
        default_game_mirror_root()
    } else {
        PathBuf::from(root)
    }
}

pub(crate) fn sanitize_mirror_segment(value: &str, fallback: &str) -> String {
    let cleaned = value
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>();
    let cleaned =
        cleaned.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned.chars().take(80).collect()
    }
}

pub(crate) fn mirror_date(metadata: &ManualMetadata) -> String {
    let date = metadata.date.trim();
    if date.len() >= 4 && date.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        date.replace(['.', '/', ' '], "-")
    } else {
        "未标日期".into()
    }
}

pub(crate) fn mirror_year(metadata: &ManualMetadata) -> String {
    let date = metadata.date.trim();
    if date.len() >= 4 && date.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        date[..4].into()
    } else {
        "未标日期".into()
    }
}

pub(crate) fn mirror_opponent_and_side(metadata: &ManualMetadata) -> (String, String) {
    match (metadata.red.trim(), metadata.black.trim()) {
        ("", "") => ("未命名对手".into(), "未标执方".into()),
        (red, "") => (sanitize_mirror_segment(red, "未命名对手"), "红方".into()),
        ("", black) => (sanitize_mirror_segment(black, "未命名对手"), "黑方".into()),
        (red, black) => (
            sanitize_mirror_segment(&format!("{red}-vs-{black}"), "未命名对手"),
            "红黑".into(),
        ),
    }
}

pub(crate) fn game_mirror_target(root: &Path, game_id: Uuid, metadata: &ManualMetadata) -> PathBuf {
    let event = sanitize_mirror_segment(&metadata.event, "未命名赛事");
    let (opponent, side) = mirror_opponent_and_side(metadata);
    let base = format!("{}_{}_{}_{}", mirror_date(metadata), event, opponent, side);
    let _ = game_id;
    root.join(mirror_year(metadata))
        .join(&event)
        .join(format!("{base}.pgn"))
}

pub(crate) fn game_has_moves(tree: &ManualTree) -> bool {
    tree.branches(tree.root_id())
        .map(|nodes| !nodes.is_empty())
        .unwrap_or(false)
}

pub(crate) fn mirror_status(
    model: &mut AppModel,
    state: &str,
    path: Option<String>,
    error: Option<String>,
) -> Result<GameMirrorStatusDto, String> {
    let status = GameMirrorStatus {
        game_id: model.game_id,
        path,
        state: state.into(),
        updated_at: Some(Utc::now().to_rfc3339()),
        error,
    };
    model
        .store
        .save_game_mirror_status(&status)
        .map_err(|error| error.to_string())?;
    Ok(status.into())
}

pub(crate) fn save_game_mirror_status(
    store: &mut LocalStore,
    game_id: Uuid,
    state: &str,
    path: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    store
        .save_game_mirror_status(&GameMirrorStatus {
            game_id,
            path,
            state: state.into(),
            updated_at: Some(Utc::now().to_rfc3339()),
            error,
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn sync_current_game_mirror(
    model: &mut AppModel,
) -> Result<GameMirrorStatusDto, String> {
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences.game_mirror_enabled {
        return mirror_status(model, "disabled", None, None);
    }
    if !game_has_moves(&model.tree) {
        return mirror_status(model, "pending", None, None);
    }
    let current_game = model
        .store
        .load_game(model.game_id)
        .map_err(|error| error.to_string())?
        .ok_or("当前棋谱不存在")?;
    if current_game.library_folder.is_none() {
        if let Some(previous) = model
            .store
            .game_mirror_status(model.game_id)
            .map_err(|error| error.to_string())?
            .and_then(|status| status.path)
        {
            if Path::new(&previous).exists() {
                fs::remove_file(&previous).map_err(|error| format!("无法移除旧镜像：{error}"))?;
            }
        }
        return mirror_status(model, "pending", None, None);
    }
    let root = configured_game_mirror_root(&preferences);
    let mut target = game_mirror_target(&root, model.game_id, &model.metadata);
    let old = model
        .store
        .game_mirror_status(model.game_id)
        .map_err(|error| error.to_string())?;
    if target.exists()
        && old
            .as_ref()
            .and_then(|status| status.path.as_ref())
            .map(PathBuf::from)
            .as_ref()
            != Some(&target)
    {
        let suffix = model.game_id.simple().to_string();
        let stem = target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("棋谱");
        target.set_file_name(format!("{stem}_{}.pgn", &suffix[..8]));
    }
    let previous_path = old.as_ref().and_then(|status| status.path.clone());
    let result = (|| -> Result<(), std::io::Error> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, export_pgn(&document_from_model(model)))?;
        if let Some(previous) = previous_path.clone().map(PathBuf::from) {
            if previous != target && previous.exists() {
                fs::remove_file(previous)?;
            }
        }
        Ok(())
    })();
    match result {
        Ok(()) => mirror_status(
            model,
            "synced",
            Some(target.to_string_lossy().into_owned()),
            None,
        ),
        Err(error) => mirror_status(
            model,
            "failed",
            previous_path,
            Some(format!("外部镜像写入失败：{error}")),
        ),
    }
}

#[tauri::command]
pub(crate) fn get_game_mirror_status(
    game_id: Option<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<Option<GameMirrorStatusDto>, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model
        .store
        .game_mirror_status(game_id.unwrap_or(model.game_id))
        .map(|status| status.map(Into::into))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_game_mirror(
    state: State<'_, DesktopState>,
) -> Result<GameMirrorStatusDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    sync_current_game_mirror(&mut model)
}

#[tauri::command]
pub(crate) fn rebuild_game_mirrors(
    state: State<'_, DesktopState>,
) -> Result<Vec<GameMirrorStatusDto>, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let games = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?;
    let mut statuses = Vec::new();
    for game in games {
        if game.id == model.game_id {
            statuses.push(sync_current_game_mirror(&mut model)?);
            continue;
        }
        let previous = model
            .store
            .game_mirror_status(game.id)
            .map_err(|error| error.to_string())?;
        if !preferences.game_mirror_enabled {
            save_game_mirror_status(&mut model.store, game.id, "disabled", None, None)?;
        } else if game.library_folder.is_none() {
            if let Some(path) = previous.as_ref().and_then(|status| status.path.as_ref()) {
                if Path::new(path).exists() {
                    fs::remove_file(path).map_err(|error| format!("无法移除旧镜像：{error}"))?;
                }
            }
            save_game_mirror_status(&mut model.store, game.id, "pending", None, None)?;
        } else {
            let (_, tree) = restore_game(&model.store, &game)?;
            if !game_has_moves(&tree) {
                save_game_mirror_status(&mut model.store, game.id, "pending", None, None)?;
            } else {
                let metadata = serde_json::from_str::<ManualMetadata>(&game.metadata_json)
                    .unwrap_or(ManualMetadata {
                        title: game.title.clone(),
                        result: "*".into(),
                        ..ManualMetadata::default()
                    });
                let document = ManualDocument {
                    metadata: metadata.clone(),
                    starting_fen: game.starting_fen.clone(),
                    note: game.note.clone(),
                    tree,
                    warnings: Vec::new(),
                };
                let mut target = game_mirror_target(
                    &configured_game_mirror_root(&preferences),
                    game.id,
                    &metadata,
                );
                if target.exists()
                    && previous
                        .as_ref()
                        .and_then(|status| status.path.as_ref())
                        .map(PathBuf::from)
                        .as_ref()
                        != Some(&target)
                {
                    let suffix = game.id.simple().to_string();
                    let stem = target
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("棋谱");
                    target.set_file_name(format!("{stem}_{}.pgn", &suffix[..8]));
                }
                let previous_path = previous.as_ref().and_then(|status| status.path.clone());
                let result = (|| -> Result<(), std::io::Error> {
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::write(&target, export_pgn(&document))?;
                    if let Some(old_path) = previous_path.clone().map(PathBuf::from) {
                        if old_path != target && old_path.exists() {
                            fs::remove_file(old_path)?;
                        }
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => save_game_mirror_status(
                        &mut model.store,
                        game.id,
                        "synced",
                        Some(target.to_string_lossy().into_owned()),
                        None,
                    )?,
                    Err(error) => save_game_mirror_status(
                        &mut model.store,
                        game.id,
                        "failed",
                        previous_path,
                        Some(format!("外部镜像写入失败：{error}")),
                    )?,
                }
            }
        }
        if let Some(status) = model
            .store
            .game_mirror_status(game.id)
            .map_err(|error| error.to_string())?
        {
            statuses.push(status.into());
        }
    }
    Ok(statuses)
}

#[tauri::command]
pub(crate) fn reveal_game_mirror(state: State<'_, DesktopState>) -> Result<(), String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let status = model
        .store
        .game_mirror_status(model.game_id)
        .map_err(|error| error.to_string())?
        .ok_or("当前棋谱尚未创建 Finder 镜像")?;
    let path = status.path.ok_or("当前棋谱尚未创建 Finder 镜像")?;
    if !Path::new(&path).exists() {
        return Err("镜像文件已在 Finder 中被删除，请先立即更新镜像".into());
    }
    ProcessCommand::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| format!("无法在 Finder 中显示：{error}"))?;
    Ok(())
}

impl From<LibraryFolder> for LibraryFolderDto {
    fn from(folder: LibraryFolder) -> Self {
        Self {
            name: folder.name,
            system: folder.system,
            game_count: folder.game_count,
        }
    }
}

#[tauri::command]
pub(crate) fn list_library_folders(
    state: State<'_, DesktopState>,
) -> Result<Vec<LibraryFolderDto>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .library_folders()
        .map(|folders| folders.into_iter().map(Into::into).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_library_folder(
    name: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .create_library_folder(name)
        .map_err(|_| "无法创建文件夹".into())
}

#[tauri::command]
pub(crate) fn rename_library_folder(
    previous: String,
    next: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let next = next.trim();
    if next.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let affected = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some(previous.as_str()))
        .collect::<Vec<_>>();
    model
        .store
        .rename_library_folder(&previous, next)
        .map_err(|_| "系统文件夹不能重命名，或文件夹不存在".to_owned())?;
    for game in affected {
        let payload = library_metadata_payload(&game, Some(next.to_owned()));
        let operation = next_operation_for_game(
            &mut model,
            game.id,
            OperationKind::UpdateGameMetadata,
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_game_library_with_operation(
                game.id,
                Some(next),
                game.favorite,
                &game.tags,
                &operation,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_library_folder(
    name: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let affected = model
        .store
        .load_games()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|game| game.library_folder.as_deref() == Some(name.as_str()))
        .collect::<Vec<_>>();
    model
        .store
        .delete_library_folder(&name)
        .map_err(|_| "系统文件夹不能删除，或文件夹不存在".to_owned())?;
    for game in affected {
        let payload = library_metadata_payload(&game, None);
        let operation = next_operation_for_game(
            &mut model,
            game.id,
            OperationKind::UpdateGameMetadata,
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        );
        model
            .store
            .update_game_library_with_operation(
                game.id,
                None,
                game.favorite,
                &game.tags,
                &operation,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn update_game_library(
    folder: Option<String>,
    favorite: bool,
    tags: Vec<String>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let folder = folder
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned());
    let tags: Vec<String> = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .fold(Vec::new(), |mut tags, tag| {
            if !tags.contains(&tag) {
                tags.push(tag);
            }
            tags
        });
    let game_id = model.game_id;
    let payload = UpdateGameMetadataPayload {
        title: model.metadata.title.clone(),
        note: model.note.clone(),
        event: Some(model.metadata.event.clone()),
        site: Some(model.metadata.site.clone()),
        date: Some(model.metadata.date.clone()),
        red: Some(model.metadata.red.clone()),
        black: Some(model.metadata.black.clone()),
        result: Some(model.metadata.result.clone()),
        library_folder: Some(folder.clone().unwrap_or_default()),
        favorite: Some(favorite),
        tags: Some(tags.clone()),
    };
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_library_with_operation(game_id, folder.as_deref(), favorite, &tags, &operation)
        .map_err(|error| error.to_string())?;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn open_game(game_id: Uuid, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game = model
        .store
        .load_game(game_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "棋谱不存在".to_owned())?;
    load_game_into_model(&mut model, game)?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn play_move(iccs: String, state: State<'_, DesktopState>) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    commit_move(&mut model, &iccs)
}

#[tauri::command]
pub(crate) fn confirm_recognized_move(
    iccs: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    // Hold the resolution guard through validation and persistence. This makes
    // image replacement and successful confirmation mutually exclusive.
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    let binding = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        active_screenshot_resolution(&session)?
    };
    if binding.generation != state.link_capture_generation.load(Ordering::SeqCst) {
        return Err("图片识别结果已被新的截图替换，请重新核对上一着".into());
    }

    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    validate_screenshot_resolution_binding(&model, &binding)?;
    validate_screenshot_resolution_move(&binding, &iccs)?;
    validate_screenshot_move_confirmation(
        &model.board,
        mv,
        &binding.before_fen,
        binding.recognized_after_fen.as_deref(),
        binding.mode,
    )?;
    let board = commit_move(&mut model, &iccs)?;
    drop(model);

    // Consume the proposal only after the variation is stored. A second click
    // or a direct duplicate command must start a new image-recognition cycle.
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    invalidate_screenshot_move_resolution(&mut session);
    Ok(board)
}

#[tauri::command]
pub(crate) fn preview_line(
    fen: String,
    pv: Vec<String>,
) -> Result<Vec<PreviewLineStepDto>, String> {
    preview_line_steps(&fen, &pv)
}

#[tauri::command]
pub(crate) fn preview_recognized_move_from_current(
    iccs: String,
    state: State<'_, DesktopState>,
) -> Result<RecognizedLastMovePreviewDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let binding = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        active_screenshot_resolution(&session)?
    };
    if binding.mode != ScreenshotResolutionMode::ManualFallback
        || binding.generation != state.link_capture_generation.load(Ordering::SeqCst)
    {
        return Err("只有完整局面没有精确匹配时，才能手工点选上一着".into());
    }
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    validate_screenshot_resolution_binding(&model, &binding)
        .map_err(|_| "当前棋谱节点已变化，请重新选择图片后再手工点选".to_owned())?;
    if !model
        .board
        .legal_moves()
        .into_iter()
        .any(|candidate| candidate == mv)
    {
        return Err("这一步不符合当前棋谱局面的棋规，请重新点选起点和终点".into());
    }
    let preview = recognized_move_preview(&model.board, mv, "手工点选（当前棋谱合法着）", None)?;
    drop(model);
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    // Manual confirmation is restricted to the most recently previewed legal
    // endpoint pair. This still lets the child change their mind by selecting
    // a new pair, but never lets a client submit an unpreviewed ICCS string.
    session.screenshot_resolution_allowed_moves = vec![iccs];
    Ok(preview)
}

pub(crate) fn recognized_move_preview(
    before: &Board,
    mv: Move,
    recognition_source: &'static str,
    recognition_confidence: Option<u32>,
) -> Result<RecognizedLastMovePreviewDto, String> {
    let after = before.apply_move(mv).map_err(|error| error.to_string())?;
    let notation = before
        .chinese_move_notation(mv)
        .map_err(|error| error.to_string())?;
    Ok(RecognizedLastMovePreviewDto {
        step: PreviewLineStepDto {
            fen: after.to_fen(),
            notation,
            moved_by: side_label(before.side_to_move()),
            from: SquareDto {
                row: mv.from.row,
                col: mv.from.col,
            },
            to: SquareDto {
                row: mv.to.row,
                col: mv.to.col,
            },
            pieces: board_pieces(&after),
            status: game_status_label(after.status()),
        },
        before_fen: before.to_fen(),
        after_fen: after.to_fen(),
        side_to_move: side_label(after.side_to_move()),
        captured: before.would_capture(mv),
        marker_kind: Some("lastMove"),
        recognition_source: Some(recognition_source),
        recognition_confidence,
    })
}

pub(crate) fn position_placement_key(board: &Board) -> String {
    board
        .to_fen()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned()
}

/// Validates the final write at the same boundary that persists the variation.
/// Exact YOLO resolutions must reproduce the observed post-move placement;
/// manual fallback remains legal-only, but is still bound to the same current
/// tree node and image generation by the caller.
pub(crate) fn validate_screenshot_move_confirmation(
    before: &Board,
    mv: Move,
    expected_before_fen: &str,
    recognized_after_fen: Option<&str>,
    mode: ScreenshotResolutionMode,
) -> Result<(), String> {
    if before.to_fen() != expected_before_fen {
        return Err("截图对应的当前棋谱节点已变化。请先跳转到对应局面，或重新选择图片。".into());
    }
    let after = before.apply_move(mv).map_err(|error| error.to_string())?;
    if mode == ScreenshotResolutionMode::ExactPlacement {
        let recognized_after = recognized_after_fen
            .ok_or_else(|| "截图识别结果已失效，请重新选择图片".to_owned())
            .and_then(|value| Board::from_fen(value).map_err(|error| error.to_string()))?;
        if position_placement_key(&after) != position_placement_key(&recognized_after) {
            return Err(
                "该走法与本次截图识别出的完整局面不一致，已拒绝写入棋谱。请重新识别或手工点选。"
                    .into(),
            );
        }
    }
    Ok(())
}

/// Resolves a screenshot's previous move through one strict path:
///
/// 1. YOLO produces the complete *post-move* board placement.
/// 2. Every legal move from the current document is enumerated.
/// 3. Only moves whose resulting placement exactly equals the YOLO placement
///    survive. White source rings/destination halos may sort those survivors,
///    but can never introduce a candidate.
///
/// The result remains a proposal until the user explicitly writes it as a
/// variation. A no-match result intentionally falls back to manual endpoints.
#[tauri::command]
pub(crate) fn resolve_screenshot_move(
    state: State<'_, DesktopState>,
) -> Result<ScreenshotMoveResolutionDto, String> {
    let _resolution_guard = state
        .screenshot_resolution_guard
        .lock()
        .map_err(|_| "截图上一着解析锁已损坏".to_owned())?;
    // The only FEN permitted here is the one recorded by the image-recognition
    // session. The UI receives it for display, but cannot feed it back to
    // manufacture a candidate from a different post-move position.
    let (recognized_after_fen, marker, orientation, generation, source) = {
        let session = state
            .link_session
            .lock()
            .map_err(|_| "link session lock poisoned".to_owned())?;
        (
            session.latest_fen.clone(),
            session.screenshot_move_marker,
            session.board_orientation,
            session.capture_generation,
            session.source,
        )
    };
    if !matches!(
        source,
        CaptureSource::ImageImport | CaptureSource::CameraBoard
    ) {
        return Err("请先选择截图或照片进行识别".into());
    }
    if generation != state.link_capture_generation.load(Ordering::SeqCst) {
        return Err("图片识别结果已失效，请重新选择图片".into());
    }
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let before = model.board.clone();
    let resolution_game_id = model.game_id;
    let resolution_current_node = model.current_node;
    drop(model);

    let mut resolution = match recognized_after_fen {
        Some(fen) => match Board::from_fen(&fen) {
            Ok(recognized_after) => {
                resolve_screenshot_move_from_board(&before, &recognized_after, marker, orientation)?
            }
            Err(_) => manual_screenshot_move_resolution(
                &before,
                orientation,
                "图片完整局面已失效，无法自动匹配上一着；请手工点起点和终点。",
            ),
        },
        None => manual_screenshot_move_resolution(
            &before,
            orientation,
            "未能可靠识别完整棋盘局面；白色圈和底光不能单独推断走法，请手工点起点和终点。",
        ),
    };
    // The fallback must never accidentally retain candidates from a previous
    // image. Its board is always the current manual-tree position.
    resolution.current_pieces = board_pieces(&before);
    resolution.current_side_to_move = side_label(before.side_to_move());

    let mode = if resolution.status == "noExactMatch" {
        ScreenshotResolutionMode::ManualFallback
    } else {
        ScreenshotResolutionMode::ExactPlacement
    };
    let mut session = state
        .link_session
        .lock()
        .map_err(|_| "link session lock poisoned".to_owned())?;
    if session.capture_generation != generation
        || !matches!(
            session.source,
            CaptureSource::ImageImport | CaptureSource::CameraBoard
        )
    {
        return Err("图片识别结果已被新的截图替换，请重新选择图片".into());
    }
    session.screenshot_resolution_before_fen = Some(before.to_fen());
    session.screenshot_resolution_generation = Some(generation);
    session.screenshot_resolution_mode = Some(mode);
    session.screenshot_resolution_game_id = Some(resolution_game_id);
    session.screenshot_resolution_current_node = Some(resolution_current_node);
    session.screenshot_resolution_allowed_moves = resolution
        .candidates
        .iter()
        .map(|candidate| {
            Move {
                from: Square {
                    row: candidate.step.from.row,
                    col: candidate.step.from.col,
                },
                to: Square {
                    row: candidate.step.to.row,
                    col: candidate.step.to.col,
                },
            }
            .to_iccs()
        })
        .collect();
    Ok(resolution)
}

pub(crate) fn manual_screenshot_move_resolution(
    before: &Board,
    orientation: BoardOrientation,
    reason: impl Into<String>,
) -> ScreenshotMoveResolutionDto {
    ScreenshotMoveResolutionDto {
        status: "noExactMatch",
        candidates: Vec::new(),
        orientation,
        current_pieces: board_pieces(before),
        current_side_to_move: side_label(before.side_to_move()),
        reason: Some(reason.into()),
    }
}

pub(crate) fn resolve_screenshot_move_from_board(
    before: &Board,
    recognized_after: &Board,
    marker: Option<link_vision::ScreenshotMoveMarker>,
    orientation: BoardOrientation,
) -> Result<ScreenshotMoveResolutionDto, String> {
    let target = position_placement_key(recognized_after);
    let mut exact_candidates = before
        .legal_moves()
        .into_iter()
        .filter_map(|mv| {
            let after = before.apply_move(mv).ok()?;
            (position_placement_key(&after) == target).then_some((mv, after))
        })
        .map(|(mv, after)| {
            let marker_score = marker
                .as_ref()
                .map(|item| {
                    let from = item
                        .from
                        .map(|square| (square == mv.from) as u32 * item.from_confidence)
                        .unwrap_or_default();
                    let to = item
                        .to
                        .map(|square| (square == mv.to) as u32 * item.to_confidence)
                        .unwrap_or_default();
                    from.saturating_add(to)
                })
                .unwrap_or_default();
            (mv, after, marker_score)
        })
        .collect::<Vec<_>>();

    // Sorting is deliberately after exact placement filtering. Tie-breaking by
    // ICCS keeps an ambiguous result stable when the screenshot has no markers.
    exact_candidates.sort_by(|left, right| {
        right
            .2
            .cmp(&left.2)
            .then_with(|| left.0.to_iccs().cmp(&right.0.to_iccs()))
    });
    exact_candidates.truncate(3);

    let candidates = exact_candidates
        .into_iter()
        .map(|(mv, _after, marker_score)| {
            recognized_move_preview(
                before,
                mv,
                "YOLO完整局面与当前棋谱合法一步匹配",
                (marker_score > 0).then_some(marker_score),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let (status, reason) = match candidates.len() {
        0 => (
            "noExactMatch",
            Some(
                "识别到的完整局面与当前棋谱没有合法的一步衔接。白色圈和底光只作排序证据，不能单独推断走法；请手工点起点和终点。".into(),
            ),
        ),
        1 => ("unique", None),
        _ => (
            "ambiguous",
            Some("完整局面存在多个合法一步匹配，请选择后再确认写入变例。".into()),
        ),
    };
    Ok(ScreenshotMoveResolutionDto {
        status,
        candidates,
        orientation,
        current_pieces: board_pieces(before),
        current_side_to_move: side_label(before.side_to_move()),
        reason,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChineseLineParseDto {
    pub(crate) moves: Vec<String>,
    pub(crate) steps: Vec<PreviewLineStepDto>,
}

#[tauri::command]
pub(crate) fn parse_chinese_line(
    fen: String,
    notation: Vec<String>,
) -> Result<ChineseLineParseDto, String> {
    let mut board = Board::from_fen(&fen).map_err(|error| error.to_string())?;
    let mut moves = Vec::with_capacity(notation.len());
    for (index, input) in notation.iter().enumerate() {
        let expected = normalize_chinese_move_text(input);
        if expected.is_empty() {
            return Err(format!("第 {} 步中文着法为空", index + 1));
        }
        let matches = board
            .legal_moves()
            .into_iter()
            .filter(|mv| {
                board
                    .chinese_move_notation(*mv)
                    .map(|value| normalize_chinese_move_text(&value) == expected)
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        let mv = match matches.as_slice() {
            [mv] => *mv,
            [] => {
                return Err(format!(
                    "第 {} 步“{}”不是当前局面的合法中文着法",
                    index + 1,
                    input.trim()
                ));
            }
            _ => {
                return Err(format!(
                    "第 {} 步“{}”存在歧义，请在棋盘上走出该步",
                    index + 1,
                    input.trim()
                ));
            }
        };
        moves.push(mv.to_iccs());
        board = board
            .apply_move(mv)
            .map_err(|error| format!("第 {} 步非法：{error}", index + 1))?;
    }
    let steps = preview_line_steps(&fen, &moves)?;
    Ok(ChineseLineParseDto { moves, steps })
}

pub(crate) fn preview_line_steps(
    fen: &str,
    pv: &[String],
) -> Result<Vec<PreviewLineStepDto>, String> {
    let mut board = Board::from_fen(fen).map_err(|error| error.to_string())?;
    let mut steps = Vec::with_capacity(pv.len());
    for (index, iccs) in pv.iter().enumerate() {
        let mv = xiangqi_core::Move::from_iccs(iccs)
            .map_err(|error| format!("候选线路第 {} 步格式不正确：{}", index + 1, error))?;
        let piece = board
            .piece_at(mv.from)
            .ok_or_else(|| format!("候选线路第 {} 步非法：起点没有棋子", index + 1))?;
        let notation = board
            .chinese_move_notation(mv)
            .map_err(|error| format!("候选线路第 {} 步无法生成中文记谱：{}", index + 1, error))?;
        let next = board
            .apply_move(mv)
            .map_err(|error| format!("候选线路第 {} 步非法：{}", index + 1, error))?;
        steps.push(PreviewLineStepDto {
            fen: next.to_fen(),
            notation,
            moved_by: side_label(piece.color),
            from: SquareDto {
                row: mv.from.row,
                col: mv.from.col,
            },
            to: SquareDto {
                row: mv.to.row,
                col: mv.to.col,
            },
            pieces: board_pieces(&next),
            status: game_status_label(next.status()),
        });
        board = next;
    }
    Ok(steps)
}

pub(crate) fn commit_move(model: &mut AppModel, iccs: &str) -> Result<BoardDto, String> {
    if !model.playable {
        return Err("当前研究局面不可对弈，请先在局面编辑器中修正".into());
    };
    let mv = xiangqi_core::Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let next = model
        .board
        .apply_move(mv)
        .map_err(|error| error.to_string())?;
    let parent = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let mut next_tree = model.tree.clone();
    let node_id = next_tree
        .add_move(parent, mv, "")
        .map_err(|error| error.to_string())?;
    let operation = Operation {
        op_id: Uuid::new_v4(),
        device_id: model.device_id,
        entity_id: node_id,
        game_id: model.game_id,
        kind: OperationKind::AddMove,
        payload: serde_json::to_value(AddMovePayload {
            node_id,
            parent_id: parent,
            move_iccs: iccs.to_owned(),
            order_key: next_tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .order_key,
            is_mainline: next_tree
                .node(node_id)
                .map_err(|error| error.to_string())?
                .is_mainline,
        })
        .map_err(|error| error.to_string())?,
        lamport: model.lamport + 1,
        created_at: Utc::now(),
    };
    let node = next_tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .clone();
    let game_id = model.game_id;
    model
        .store
        .save_move_with_operation(
            node.id,
            game_id,
            Some(node.parent_id),
            &node.mv.to_iccs(),
            &node.comment,
            node.order_key,
            node.is_mainline,
            &operation,
        )
        .map_err(|error| error.to_string())?;
    model.lamport = operation.lamport;
    model.tree = next_tree;
    model.current_node = Some(node_id);
    model.board = next;
    let _ = sync_current_game_mirror(model);
    board_dto(model)
}

#[tauri::command]
pub(crate) fn new_game(
    fen: String,
    title: Option<String>,
    note: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut document = ManualDocument::new(fen).map_err(|error| error.to_string())?;
    document.metadata.title = title.unwrap_or_else(|| "新建棋谱".into());
    document.note = note.unwrap_or_default();
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, None)?;
    let game_id = model.game_id;
    let payload = UpdateGameMetadataPayload {
        title: model.metadata.title.clone(),
        note: model.note.clone(),
        event: Some(model.metadata.event.clone()),
        site: Some(model.metadata.site.clone()),
        date: Some(model.metadata.date.clone()),
        red: Some(model.metadata.red.clone()),
        black: Some(model.metadata.black.clone()),
        result: Some(model.metadata.result.clone()),
        library_folder: Some("比赛复盘".into()),
        favorite: Some(false),
        tags: Some(Vec::new()),
    };
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_library_with_operation(game_id, Some("比赛复盘"), false, &[], &operation)
        .map_err(|error| error.to_string())?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn open_document(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("读取棋谱失败：{error}"))?;
    let hint = format_hint_from_path(&path);
    let format = detect_format(&bytes, hint);
    let document = import_document(&bytes, Some(format)).map_err(|error| error.to_string())?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(path),
        Some(format_name(format).into()),
    )?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn import_xqb_opening_book(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let target = PathBuf::from(&path);
    xqb_opening_book::validate(&target)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences
        .xqb_book_paths
        .iter()
        .any(|existing| existing == &path)
    {
        preferences.xqb_book_paths.push(path);
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn import_eleeye_opening_book(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let target = PathBuf::from(&path);
    eleeye_opening_book::validate(&target)?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    if !preferences
        .eleeye_book_paths
        .iter()
        .any(|existing| existing == &path)
    {
        preferences.eleeye_book_paths.push(path);
        model
            .store
            .save_desktop_preferences(&preferences)
            .map_err(|error| error.to_string())?;
    }
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn import_text(
    text: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let document = if Board::from_fen(text.trim()).is_ok() {
        ManualDocument::new(text.trim()).map_err(|error| error.to_string())?
    } else {
        import_document(text.as_bytes(), Some(ManualFormat::Pgn))
            .map_err(|error| error.to_string())?
    };
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(&mut model, document, None, None)?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn export_text(
    mainline_only: bool,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let document = document_from_model(&model);
    if mainline_only {
        export_mainline_pgn(&document).map_err(|error| error.to_string())
    } else {
        Ok(export_pgn(&document))
    }
}

#[tauri::command]
pub(crate) fn export_document_text(
    format: ExportFormat,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    format.export(&document_from_model(&model))
}

#[tauri::command]
pub(crate) fn export_document_file(
    path: String,
    format: ExportFormat,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let contents = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        format.export(&document_from_model(&model))?
    };
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some(format.extension()) {
        return Err(format!("导出文件必须使用 .{} 扩展名", format.extension()));
    }
    std::fs::write(&target, contents).map_err(|error| format!("导出棋谱失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_replay_gif(
    path: String,
    scope: ReplayExportScope,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("gif") {
        return Err("动态图必须使用 .gif 扩展名".into());
    }
    let (document, current_node) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        (document_from_model(&model), model.current_node)
    };
    let scope = match scope {
        ReplayExportScope::CurrentSelection => gif_export::ReplayScope::CurrentSelection,
        ReplayExportScope::Mainline => gif_export::ReplayScope::Mainline,
    };
    gif_export::export_replay_gif(&target, &document, current_node, scope)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_mind_map_svg(path: String, svg: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("svg") {
        return Err("变招图必须使用 .svg 扩展名".into());
    }
    if !svg.trim_start().starts_with("<?xml") || !svg.contains("<svg") {
        return Err("变招图内容不是有效 SVG".into());
    }
    std::fs::write(&target, svg).map_err(|error| format!("导出变招图失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_text_file(path: String, contents: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    if !matches!(
        target.extension().and_then(|extension| extension.to_str()),
        Some("txt" | "pgn")
    ) {
        return Err("文本导出文件必须使用 .txt 或 .pgn 扩展名".into());
    }
    std::fs::write(&target, contents).map_err(|error| format!("导出文本失败：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_manual_pdf(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let target = PathBuf::from(path);
    if target.extension().and_then(|extension| extension.to_str()) != Some("pdf") {
        return Err("棋谱 PDF 必须使用 .pdf 扩展名".into());
    }
    let document = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        document_from_model(&model)
    };
    let saved = manual_pdf::write_manual_pdf(&target, &document)?;
    Ok(saved.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn save_document(
    path: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let target = match path {
        Some(path) => path,
        None if model.source_format.as_deref() == Some("pgn") => model
            .source_path
            .clone()
            .ok_or_else(|| "当前棋谱尚未关联文件，请使用另存为".to_owned())?,
        None => return Err("导入格式不可覆盖保存，请另存为 PGN".into()),
    };
    std::fs::write(&target, export_pgn(&document_from_model(&model)))
        .map_err(|error| format!("保存棋谱失败：{error}"))?;
    let game_id = model.game_id;
    model
        .store
        .set_game_source(game_id, Some(&target), Some("pgn"))
        .map_err(|error| error.to_string())?;
    model.source_path = Some(target.clone());
    model.source_format = Some("pgn".into());
    Ok(target)
}

#[tauri::command]
pub(crate) fn update_game_metadata(
    title: String,
    note: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let game_id = model.game_id;
    let mut metadata = model.metadata.clone();
    metadata.title = title.clone();
    let payload = metadata_payload(&metadata, &note);
    let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        game_id,
        OperationKind::UpdateGameMetadata,
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
    );
    model
        .store
        .update_game_metadata_with_operation(game_id, &title, &note, &metadata_json, &operation)
        .map_err(|error| error.to_string())?;
    model.metadata = metadata;
    model.note = note;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn reorder_branches(
    node_ids: Vec<Uuid>,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model.current_node.unwrap_or_else(|| model.tree.root_id());
    let mut reordered_tree = model.tree.clone();
    reordered_tree
        .reorder_branches(parent_id, &node_ids)
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        parent_id,
        OperationKind::ReorderBranches,
        serde_json::to_value(ReorderBranchesPayload {
            parent_id,
            node_ids: node_ids.clone(),
        })
        .map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .reorder_branches_with_operation(game_id, parent_id, &node_ids, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = reordered_tree;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn navigate_to(
    node_id: Option<Uuid>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    model.board = board_at(&model.starting_fen, &model.tree, node_id)?;
    model.current_node = node_id;
    let game_id = model.game_id;
    model
        .store
        .set_current_node(game_id, node_id)
        .map_err(|error| error.to_string())?;
    let board = board_dto(&model)?;
    let _ = app.emit("board-navigated", &board);
    Ok(board)
}

#[tauri::command]
pub(crate) fn update_comment(
    node_id: Uuid,
    comment: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let mut next_tree = model.tree.clone();
    next_tree
        .update_comment(node_id, comment.clone())
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::UpdateComment,
        serde_json::to_value(UpdateCommentPayload { node_id, comment })
            .map_err(|error| error.to_string())?,
    );
    let comment = next_tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .comment
        .clone();
    model
        .store
        .update_comment_with_operation(node_id, &comment, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = next_tree;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn set_mainline(
    node_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .parent_id;
    let mut next_tree = model.tree.clone();
    next_tree
        .set_mainline(parent_id, node_id)
        .map_err(|error| error.to_string())?;
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::SetMainline,
        serde_json::to_value(SetMainlinePayload { parent_id, node_id })
            .map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .set_mainline_with_operation(game_id, parent_id, node_id, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = next_tree;
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}

#[tauri::command]
pub(crate) fn delete_node(
    node_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let parent_id = model
        .tree
        .node(node_id)
        .map_err(|error| error.to_string())?
        .parent_id;
    let affects_current_line = model
        .current_node
        .and_then(|current| model.tree.active_line(current).ok())
        .is_some_and(|line| line.iter().any(|node| node.id == node_id));
    let mut next_tree = model.tree.clone();
    next_tree
        .remove(node_id)
        .map_err(|error| error.to_string())?;
    let next_current_node = if affects_current_line {
        (parent_id != next_tree.root_id()).then_some(parent_id)
    } else {
        model.current_node
    };
    let next_board = if affects_current_line {
        Some(board_at(
            &model.starting_fen,
            &next_tree,
            next_current_node,
        )?)
    } else {
        None
    };
    let operation = next_operation(
        &mut model,
        node_id,
        OperationKind::DeleteNode,
        serde_json::to_value(DeleteNodePayload { node_id }).map_err(|error| error.to_string())?,
    );
    let game_id = model.game_id;
    model
        .store
        .delete_node_with_operation(game_id, node_id, next_current_node, &operation)
        .map_err(|error| error.to_string())?;
    model.tree = next_tree;
    model.current_node = next_current_node;
    if let Some(board) = next_board {
        model.board = board;
    }
    let _ = sync_current_game_mirror(&mut model);
    board_dto(&model)
}
