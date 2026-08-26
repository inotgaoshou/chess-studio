use super::*;
use crate::{desktop_types::load_game_into_model, engine_service::validate_server_url};

pub(crate) fn sync_account_dto(state: &DesktopState) -> Result<SyncAccountDto, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let preferences = model
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?;
    let binding = model
        .store
        .sync_account_binding()
        .map_err(|error| error.to_string())?;
    let expired = model
        .store
        .sync_token_expired()
        .map_err(|error| error.to_string())?;
    let last_sync_result = model
        .store
        .last_sync_result()
        .map_err(|error| error.to_string())?;
    drop(model);
    let has_token = active_sync_token(state)?.is_some();
    let status = match (&binding, expired, has_token) {
        (None, _, _) => "unbound",
        (Some(_), true, _) => "expired",
        (Some(_), false, true) => "signedIn",
        (Some(_), false, false) => "signedOut",
    };
    Ok(SyncAccountDto {
        server_url: preferences.server_url,
        user_id: binding.as_ref().map(|account| account.user_id),
        email: binding.map(|account| account.email),
        status,
        last_sync_result,
    })
}

pub(crate) fn active_sync_token(state: &DesktopState) -> Result<Option<String>, String> {
    if let Some(token) = state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())?
        .clone()
    {
        return Ok(Some(token));
    }
    let token = state.credentials.get(TOKEN_KEY)?;
    if let Some(token) = &token {
        *state
            .session_token
            .lock()
            .map_err(|_| "session token lock poisoned".to_owned())? = Some(token.clone());
    }
    Ok(token)
}

pub(crate) fn clear_sync_token(state: &DesktopState) -> Result<(), String> {
    state.credentials.delete(TOKEN_KEY)?;
    *state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_sync_account(state: State<'_, DesktopState>) -> Result<SyncAccountDto, String> {
    sync_account_dto(&state)
}

pub(crate) async fn subscription_request(
    state: &DesktopState,
    endpoint: &str,
    code: Option<&str>,
) -> Result<SubscriptionDto, String> {
    let server_url = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?
        .server_url;
    validate_server_url(&server_url)?;
    let token = active_sync_token(state)?.ok_or("请先登录同步账号")?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/subscription{endpoint}",
        server_url.trim_end_matches('/')
    );
    let request = if let Some(code) = code {
        client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "code": code }))
    } else {
        client.get(url).bearer_auth(token)
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("订阅服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| format!("订阅服务返回错误 {status}"));
        return Err(message);
    }
    response
        .json()
        .await
        .map_err(|_| "订阅服务返回了无效数据".into())
}

pub(crate) async fn master_library_get<T>(
    state: &DesktopState,
    path: &str,
    query: &[(&str, String)],
) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let server_url = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?
        .server_url;
    validate_server_url(&server_url)?;
    let mut url = reqwest::Url::parse(&format!("{}{}", server_url.trim_end_matches('/'), path))
        .map_err(|_| "大师棋谱服务地址格式不正确".to_owned())?;
    {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in query {
            if !value.trim().is_empty() {
                pairs.append_pair(name, value);
            }
        }
    }
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("大师棋谱服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| format!("大师棋谱服务返回错误 {status}"));
        return Err(message);
    }
    response
        .json()
        .await
        .map_err(|_| "大师棋谱服务返回了无效数据".into())
}

pub(crate) async fn master_library_post<T, P>(
    state: &DesktopState,
    path: &str,
    payload: &P,
) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    P: Serialize,
{
    let server_url = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())?
        .server_url;
    validate_server_url(&server_url)?;
    let response = reqwest::Client::new()
        .post(format!("{}{}", server_url.trim_end_matches('/'), path))
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("大师棋谱服务不可用：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("大师棋谱服务返回错误 {}", response.status()));
    }
    response
        .json()
        .await
        .map_err(|_| "大师棋谱服务返回了无效数据".into())
}

#[tauri::command]
pub(crate) async fn list_master_players(
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterPlayerDto>, String> {
    let mut params = vec![
        ("limit", limit.unwrap_or(50).clamp(1, 100).to_string()),
        ("offset", offset.unwrap_or(0).min(10_000).to_string()),
    ];
    if let Some(query) = query {
        params.push(("query", query));
    }
    master_library_get(&state, "/api/v1/master/players", &params).await
}

#[tauri::command]
pub(crate) async fn get_master_library_stats(
    query: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<MasterLibraryStatsDto, String> {
    let mut params = Vec::new();
    if let Some(query) = query {
        params.push(("query", query));
    }
    master_library_get(&state, "/api/v1/master/stats", &params).await
}

#[tauri::command]
pub(crate) async fn get_master_opening_profile(
    player_id: String,
    state: State<'_, DesktopState>,
) -> Result<MasterOpeningProfileDto, String> {
    let player_id = player_id.trim();
    if player_id.is_empty() {
        return Err("请选择大师".into());
    }
    master_library_get(
        &state,
        &format!("/api/v1/master/players/{player_id}/opening-profile"),
        &[],
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_master_games(
    player_id: String,
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    side: Option<String>,
    opening: Option<String>,
    year: Option<u16>,
    state: State<'_, DesktopState>,
) -> Result<Vec<MasterGameSummaryDto>, String> {
    let player_id = player_id.trim();
    if player_id.is_empty() {
        return Err("请选择大师".into());
    }
    let mut params = vec![
        ("limit", limit.unwrap_or(20).clamp(1, 100).to_string()),
        ("offset", offset.unwrap_or(0).min(10_000).to_string()),
    ];
    if let Some(query) = query {
        params.push(("query", query));
    }
    if let Some(side) = side.filter(|value| matches!(value.as_str(), "red" | "black")) {
        params.push(("side", side));
    }
    if let Some(opening) = opening.filter(|value| {
        matches!(
            value.as_str(),
            "middle-cannon" | "third-pawn" | "middle-cannon-third-pawn"
        )
    }) {
        params.push(("opening", opening));
    }
    if let Some(year) = year.filter(|value| (1900..=2100).contains(value)) {
        params.push(("year", year.to_string()));
    }
    master_library_get(
        &state,
        &format!("/api/v1/master/players/{player_id}/games"),
        &params,
    )
    .await
}

#[tauri::command]
pub(crate) async fn open_master_game(
    game_id: String,
    state: State<'_, DesktopState>,
) -> Result<BoardDto, String> {
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return Err("请选择棋谱".into());
    }
    let detail: MasterGameDetailDto =
        master_library_get(&state, &format!("/api/v1/master/games/{game_id}"), &[]).await?;
    let mut document = import_document(detail.pgn.as_bytes(), Some(ManualFormat::Pgn))
        .map_err(|error| format!("大师棋谱解析失败：{error}"))?;
    document.metadata.title = detail.title.clone();
    document.metadata.event = detail
        .event_name
        .clone()
        .unwrap_or_else(|| "公开大师棋谱".into());
    document.metadata.date = detail.game_date.clone().unwrap_or_default();
    document.metadata.red = detail.red_player.clone();
    document.metadata.black = detail.black_player.clone();
    document.metadata.result = detail.result.clone();
    document.metadata.site = detail.source_url.clone();
    let mut note_lines = vec![
        format!("红方：{}", detail.red_player),
        format!("黑方：{}", detail.black_player),
        format!(
            "比赛：{}",
            detail
                .event_name
                .clone()
                .unwrap_or_else(|| "赛事未知".into())
        ),
        format!(
            "日期：{}",
            detail
                .game_date
                .clone()
                .unwrap_or_else(|| "日期未知".into())
        ),
        format!("结果：{}", detail.result),
        format!("手数：{}", detail.move_count),
        "用途：本地学习、拆棋和 Pikafish 分析。".into(),
    ];
    if !document.note.trim().is_empty() {
        note_lines.push(format!("原谱备注：{}", document.note.trim()));
    }
    document.note = note_lines.join("\n");
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    install_document(
        &mut model,
        document,
        Some(detail.source_url),
        Some("server-master-pgn".into()),
    )?;
    board_dto(&model)
}

#[tauri::command]
pub(crate) async fn find_related_master_games(
    topic_id: String,
    fens: Vec<String>,
    state: State<'_, DesktopState>,
) -> Result<Vec<RelatedMasterGameDto>, String> {
    let fens: Vec<_> = fens
        .into_iter()
        .filter(|fen| fen.len() <= 255)
        .take(12)
        .collect();
    if fens.is_empty() {
        return Err("至少需要一个专题局面检查点".into());
    }
    master_library_post(
        &state,
        "/api/v1/master/related-games",
        &serde_json::json!({ "topicId": topic_id, "fens": fens }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn get_subscription(
    state: State<'_, DesktopState>,
) -> Result<SubscriptionDto, String> {
    subscription_request(&state, "", None).await
}

#[tauri::command]
pub(crate) async fn redeem_subscription_code(
    code: String,
    state: State<'_, DesktopState>,
) -> Result<SubscriptionDto, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("请输入兑换码".into());
    }
    subscription_request(&state, "/redeem", Some(code)).await
}

pub(crate) async fn authenticate_sync_account(
    endpoint: &str,
    email: String,
    password: String,
    _require_unbound: bool,
    state: &DesktopState,
) -> Result<SyncAccountDto, String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return Err("请输入有效邮箱".into());
    }
    if password.len() < 8 {
        return Err("密码至少需要 8 个字符".into());
    }
    let (server_url, binding) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        let binding = model
            .store
            .sync_account_binding()
            .map_err(|error| error.to_string())?;
        (preferences.server_url, binding)
    };
    validate_server_url(&server_url)?;
    if let Some(existing) = &binding {
        if existing.email != email {
            return Err(format!(
                "本地棋谱库已绑定账号 {}，不能切换账号",
                existing.email
            ));
        }
    }
    let auth = request_auth(&server_url, endpoint, &email, &password).await?;
    let account = SyncAccountBinding {
        user_id: auth.user_id,
        email,
    };
    // Avoid persisting an account binding that cannot be logged into locally.
    state.credentials.set(TOKEN_KEY, &auth.token)?;
    *state
        .session_token
        .lock()
        .map_err(|_| "session token lock poisoned".to_owned())? = Some(auth.token.clone());
    let binding_result = (|| -> Result<(), String> {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        if endpoint == "register" {
            model
                .store
                .recover_sync_account_binding(&account)
                .map_err(|error| error.to_string())?;
        } else {
            model
                .store
                .bind_sync_account(&account)
                .map_err(|error| error.to_string())?;
        }
        model
            .store
            .set_sync_token_expired(false)
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = binding_result {
        let _ = clear_sync_token(state);
        return Err(error);
    }
    sync_account_dto(state)
}

pub(crate) async fn request_auth(
    server_url: &str,
    endpoint: &str,
    email: &str,
    password: &str,
) -> Result<AuthResponse, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/v1/auth/{endpoint}",
            server_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let error_message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            });
        let duplicate_email = status.as_u16() == 409
            || error_message.as_deref().is_some_and(|message| {
                message.contains("email already registered")
                    || message.contains("duplicate")
                    || message.contains("Duplicate entry")
            });
        return Err(match status.as_u16() {
            401 => "邮箱或密码不正确".into(),
            _ if duplicate_email => "该邮箱已经注册，请直接登录".into(),
            _ => format!("账号服务返回错误 {status}"),
        });
    }
    response
        .json()
        .await
        .map_err(|_| "账号服务返回了无效数据".into())
}

#[tauri::command]
pub(crate) async fn register_sync_account(
    email: String,
    password: String,
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    authenticate_sync_account("register", email, password, true, &state).await
}

#[tauri::command]
pub(crate) async fn login_sync_account(
    email: String,
    password: String,
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    authenticate_sync_account("login", email, password, false, &state).await
}

#[tauri::command]
pub(crate) fn logout_sync_account(
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    clear_sync_token(&state)?;
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .set_sync_token_expired(false)
        .map_err(|error| error.to_string())?;
    sync_account_dto(&state)
}

#[tauri::command]
pub(crate) fn unbind_sync_account(
    state: State<'_, DesktopState>,
) -> Result<SyncAccountDto, String> {
    clear_sync_token(&state)?;
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .reset_sync_library()
            .map_err(|error| error.to_string())?;
        model.lamport = 0;
        let document = ManualDocument::new(STARTING_FEN).map_err(|error| error.to_string())?;
        install_document(&mut model, document, None, None)?;
    }
    sync_account_dto(&state)
}

#[tauri::command]
pub(crate) async fn sync_now(state: State<'_, DesktopState>) -> Result<SyncResult, String> {
    let (pending, server_url) = {
        let model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        let pending = model
            .store
            .pending_operations(500)
            .map_err(|error| error.to_string())?;
        let preferences = model
            .store
            .desktop_preferences()
            .map_err(|error| error.to_string())?;
        if model
            .store
            .sync_account_binding()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err("请先注册或登录同步账号".into());
        }
        (pending, preferences.server_url)
    };
    let token = active_sync_token(&state)?.ok_or("登录已退出，请重新登录")?;
    let client = reqwest::Client::new();
    let base = server_url.trim_end_matches('/');
    let push_response = client
        .post(format!("{base}/api/v1/sync/push"))
        .bearer_auth(&token)
        .json(&sync_protocol::PushRequest {
            operations: pending.clone(),
        })
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    if push_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_sync_token(&state)?;
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .set_sync_token_expired(true)
            .map_err(|error| error.to_string())?;
        return Err("登录已过期，请重新登录".into());
    }
    let push: sync_protocol::PushResponse = push_response
        .error_for_status()
        .map_err(|error| format!("同步上传失败：{error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let cursor = {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        model
            .store
            .mark_uploaded(&push.accepted)
            .map_err(|error| error.to_string())?;
        model
            .store
            .remote_cursor()
            .map_err(|error| error.to_string())?
    };
    let pull_response = client
        .get(format!("{base}/api/v1/sync/pull?cursor={cursor}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("同步服务不可用：{error}"))?;
    if pull_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_sync_token(&state)?;
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .set_sync_token_expired(true)
            .map_err(|error| error.to_string())?;
        return Err("登录已过期，请重新登录".into());
    }
    let pull: sync_protocol::PullResponse = pull_response
        .error_for_status()
        .map_err(|error| format!("同步下载失败：{error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    {
        let mut model = state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?;
        for item in &pull.operations {
            model.lamport = model.lamport.max(item.operation.lamport);
            model
                .store
                .apply_remote_operation(&item.operation, item.sequence)
                .map_err(|error| error.to_string())?;
        }
        if pull
            .operations
            .iter()
            .any(|item| item.operation.game_id == model.game_id)
        {
            let game = model
                .store
                .load_game(model.game_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "synchronized game is unavailable".to_owned())?;
            load_game_into_model(&mut model, game)?;
        }
    }
    let result = SyncResult {
        uploaded: pending.len(),
        downloaded: pull.operations.len(),
        cursor: pull.cursor,
    };
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .set_last_sync_result(&format!(
            "上传 {}，下载 {}",
            result.uploaded, result.downloaded
        ))
        .map_err(|error| error.to_string())?;
    Ok(result)
}
