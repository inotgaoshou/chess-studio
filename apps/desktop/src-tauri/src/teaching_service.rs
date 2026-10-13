use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{
    app_state::DesktopState, credential_store::TEACHING_TOKEN_KEY,
    engine_service::validate_server_url,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeachingUser {
    id: String,
    login_name: String,
    display_name: String,
    role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    token: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    user: TeachingUser,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeachingPage {
    items: Vec<serde_json::Value>,
    next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeachingAccountDto {
    server_url: String,
    status: String,
    user_id: Option<String>,
    login_name: Option<String>,
    display_name: Option<String>,
    role: Option<String>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn normalized_server_url(server_url: &str) -> String {
    server_url.trim().trim_end_matches('/').to_owned()
}

fn token_key(server_url: &str) -> String {
    let digest = Sha256::digest(normalized_server_url(server_url).as_bytes());
    format!("{TEACHING_TOKEN_KEY}:{digest:x}")
}

fn offline_error(error: &str) -> bool {
    error.starts_with("教学服务不可用：")
}

fn profile_cache_key(server_url: &str) -> String {
    format!("teaching-profile:{}", normalized_server_url(server_url))
}

fn data_cache_key(server_url: &str, owner_id: &str, kind: &str, id: Option<&str>) -> String {
    format!(
        "teaching-data:{}:{owner_id}:{kind}:{}",
        normalized_server_url(server_url),
        id.unwrap_or("all")
    )
}

fn scoped_data_cache_key(
    state: &DesktopState,
    server_url: &str,
    owner_id: &str,
    kind: &str,
    id: Option<&str>,
) -> Result<String, String> {
    let epoch_key = format!(
        "teaching-epoch:{}:{owner_id}",
        normalized_server_url(server_url)
    );
    let epoch = read_cache(state, &epoch_key)?
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "legacy".into());
    Ok(format!(
        "{}:{epoch}",
        data_cache_key(server_url, owner_id, kind, id)
    ))
}

fn read_cache(state: &DesktopState, key: &str) -> Result<Option<serde_json::Value>, String> {
    let model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
    model
        .store
        .teaching_cache(key)
        .map_err(|error| error.to_string())?
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn write_cache(
    state: &DesktopState,
    key: &str,
    owner_id: &str,
    kind: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let mut model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
    model
        .store
        .put_teaching_cache(key, owner_id, kind, &value.to_string())
        .map_err(|error| error.to_string())
}

fn cached_account(
    state: &DesktopState,
    server_url: &str,
) -> Result<Option<TeachingAccountDto>, String> {
    read_cache(state, &profile_cache_key(server_url))?
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())
}

fn cache_account(state: &DesktopState, account: &TeachingAccountDto) -> Result<(), String> {
    let Some(owner_id) = account.user_id.as_deref() else {
        return Ok(());
    };
    write_cache(
        state,
        &profile_cache_key(&account.server_url),
        owner_id,
        "profile",
        &serde_json::to_value(account).map_err(|error| error.to_string())?,
    )
}

fn endpoint(server_url: &str, path: &str) -> Result<String, String> {
    validate_server_url(server_url)?;
    Ok(format!("{}{}", normalized_server_url(server_url), path))
}

async fn authenticated_error(
    state: &DesktopState,
    server_url: &str,
    response: reqwest::Response,
) -> Result<String, String> {
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        state.credentials.delete(&token_key(server_url))?;
    }
    Ok(error_message(response).await)
}

async fn error_message(response: reqwest::Response) -> String {
    let status = response.status();
    let message = response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|body| {
            body.get("error")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| format!("教学服务返回错误 {status}"));
    if status == reqwest::StatusCode::UNAUTHORIZED || message.eq_ignore_ascii_case("unauthorized") {
        "登录状态已过期或当前账号没有权限，请重新登录后再试。".into()
    } else if status == reqwest::StatusCode::FORBIDDEN || message.eq_ignore_ascii_case("forbidden")
    {
        "当前账号没有执行此操作的权限。".into()
    } else {
        message
    }
}

async fn authenticated_get<T: serde::de::DeserializeOwned>(
    state: &DesktopState,
    server_url: &str,
    path: &str,
) -> Result<T, String> {
    let token = state
        .credentials
        .get(&token_key(server_url))?
        .ok_or_else(|| "请先登录教学账号".to_owned())?;
    let response = reqwest::Client::new()
        .get(endpoint(server_url, path)?)
        .bearer_auth(token)
        .header("x-xiangqi-app-id", "xiangqi-studio")
        .send()
        .await
        .map_err(|error| format!("教学服务不可用：{error}"))?;
    if !response.status().is_success() {
        return Err(authenticated_error(state, server_url, response).await?);
    }
    response
        .json()
        .await
        .map_err(|_| "教学服务返回了无效数据".into())
}

async fn authenticated_get_pages(
    state: &DesktopState,
    server_url: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let mut items = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page_path = match cursor.as_deref() {
            Some(cursor) => format!("{path}?limit=100&cursor={cursor}"),
            None => format!("{path}?limit=100"),
        };
        let page: TeachingPage = authenticated_get(state, server_url, &page_path).await?;
        items.extend(page.items);
        let Some(next_cursor) = page.next_cursor else {
            return Ok(serde_json::Value::Array(items));
        };
        cursor = Some(next_cursor);
    }
}

async fn authenticated_post(
    state: &DesktopState,
    server_url: &str,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = state
        .credentials
        .get(&token_key(server_url))?
        .ok_or("请先登录教学账号")?;
    let response = reqwest::Client::new()
        .post(endpoint(server_url, path)?)
        .bearer_auth(token)
        .header("x-xiangqi-app-id", "xiangqi-studio")
        .json(body)
        .send()
        .await
        .map_err(|error| format!("教学服务不可用：{error}"))?;
    if !response.status().is_success() {
        return Err(authenticated_error(state, server_url, response).await?);
    }
    response
        .json()
        .await
        .map_err(|_| "教学服务返回了无效数据".into())
}

#[tauri::command]
pub(crate) async fn get_teaching_account(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<TeachingAccountDto, String> {
    validate_server_url(&server_url)?;
    if state.credentials.get(&token_key(&server_url))?.is_none() {
        return Ok(TeachingAccountDto {
            server_url,
            status: "signedOut".into(),
            user_id: None,
            login_name: None,
            display_name: None,
            role: None,
            expires_at: None,
        });
    }
    let cached = cached_account(&state, &server_url)?;
    match authenticated_get::<TeachingUser>(&state, &server_url, "/api/v1/auth/me").await {
        Ok(user) => {
            let capability: serde_json::Value =
                authenticated_get(&state, &server_url, "/api/v1/capabilities").await?;
            if let Some(epoch) = capability
                .get("contentEpoch")
                .and_then(serde_json::Value::as_str)
            {
                uuid::Uuid::parse_str(epoch).map_err(|_| "教学服务返回了无效版本")?;
                let mut model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
                model
                    .store
                    .observe_teaching_epoch(&user.id, &normalized_server_url(&server_url), epoch)
                    .map_err(|e| e.to_string())?;
            }
            let account = TeachingAccountDto {
                server_url: normalized_server_url(&server_url),
                status: "signedIn".into(),
                user_id: Some(user.id),
                login_name: Some(user.login_name),
                display_name: Some(user.display_name),
                role: Some(user.role),
                expires_at: cached.and_then(|item| item.expires_at),
            };
            cache_account(&state, &account)?;
            Ok(account)
        }
        Err(error) => {
            if offline_error(&error)
                && cached.as_ref().is_some_and(|item| {
                    item.expires_at
                        .is_some_and(|expiry| expiry > chrono::Utc::now())
                })
            {
                cached.ok_or(error)
            } else {
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn login_teaching_account(
    server_url: String,
    account: String,
    password: String,
    state: State<'_, DesktopState>,
) -> Result<TeachingAccountDto, String> {
    let response = reqwest::Client::new()
        .post(endpoint(&server_url, "/api/v1/auth/login")?)
        .header("x-xiangqi-app-id", "xiangqi-studio")
        .json(&serde_json::json!({ "account": account.trim(), "password": password }))
        .send()
        .await
        .map_err(|error| format!("教学服务不可用：{error}"))?;
    if !response.status().is_success() {
        return Err(error_message(response).await);
    }
    let auth: LoginResponse = response
        .json()
        .await
        .map_err(|_| "教学登录响应无效".to_owned())?;
    if !matches!(auth.user.role.as_str(), "student" | "coach" | "admin") {
        return Err("教学账号角色无效".into());
    }
    state
        .credentials
        .set(&token_key(&server_url), &auth.token)?;
    // An old unbound token cannot safely be attributed to this server.
    state.credentials.delete(TEACHING_TOKEN_KEY)?;
    let account = TeachingAccountDto {
        server_url: normalized_server_url(&server_url),
        status: "signedIn".into(),
        user_id: Some(auth.user.id),
        login_name: Some(auth.user.login_name),
        display_name: Some(auth.user.display_name),
        role: Some(auth.user.role),
        expires_at: Some(auth.expires_at),
    };
    cache_account(&state, &account)?;
    Ok(account)
}

#[tauri::command]
pub(crate) fn logout_teaching_account(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<TeachingAccountDto, String> {
    state.credentials.delete(&token_key(&server_url))?;
    Ok(TeachingAccountDto {
        server_url,
        status: "signedOut".into(),
        user_id: None,
        login_name: None,
        display_name: None,
        role: None,
        expires_at: None,
    })
}

#[tauri::command]
pub(crate) async fn list_teaching_assignments(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let account = get_teaching_account(server_url.clone(), state.clone()).await?;
    let owner_id = account.user_id.as_deref().ok_or("教学账号无效")?;
    let path = if account.role.as_deref() == Some("student") {
        "/api/v1/student/assignments"
    } else {
        "/api/v1/admin/assignments"
    };
    let key = scoped_data_cache_key(&state, &server_url, owner_id, "assignments", None)?;
    let remote = if account.role.as_deref() == Some("student") {
        authenticated_get_pages(&state, &server_url, path).await
    } else {
        authenticated_get::<serde_json::Value>(&state, &server_url, path).await
    };
    match remote {
        Ok(value) => {
            write_cache(&state, &key, owner_id, "assignments", &value)?;
            Ok(value)
        }
        Err(error) if offline_error(&error) => read_cache(&state, &key)?.ok_or(error),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn list_teaching_classes(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let account = get_teaching_account(server_url.clone(), state.clone()).await?;
    let owner_id = account.user_id.as_deref().ok_or("教学账号无效")?;
    let key = scoped_data_cache_key(&state, &server_url, owner_id, "classes", None)?;
    match authenticated_get::<serde_json::Value>(&state, &server_url, "/api/v1/admin/classes").await
    {
        Ok(value) => {
            write_cache(&state, &key, owner_id, "classes", &value)?;
            Ok(value)
        }
        Err(error) if offline_error(&error) => read_cache(&state, &key)?.ok_or(error),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn list_teaching_problem_libraries(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    authenticated_get(
        &state,
        &server_url,
        "/api/v1/admin/problem-libraries?scope=teaching",
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_teaching_assignment(
    server_url: String,
    request: serde_json::Value,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    authenticated_post(&state, &server_url, "/api/v1/admin/assignments", &request).await
}

#[tauri::command]
pub(crate) async fn get_teaching_assignment_results(
    server_url: String,
    assignment_id: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    authenticated_get(
        &state,
        &server_url,
        &format!("/api/v1/admin/assignments/{assignment_id}/results"),
    )
    .await
}

#[tauri::command]
pub(crate) async fn upload_teaching_cbl(
    server_url: String,
    file_path: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let token = state
        .credentials
        .get(&token_key(&server_url))?
        .ok_or("请先登录教学账号")?;
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("CBL 文件名无效")?
        .to_owned();
    if !file_name.to_ascii_lowercase().ends_with(".cbl") {
        return Err("请选择 .cbl 文件".into());
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("读取 CBL 失败：{error}"))?;
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(bytes).file_name(file_name),
    );
    let response = reqwest::Client::new()
        .post(endpoint(&server_url, "/api/v1/admin/content/assets/cbl")?)
        .bearer_auth(token)
        .header("x-xiangqi-app-id", "xiangqi-studio")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("教学服务不可用：{error}"))?;
    if !response.status().is_success() {
        return Err(authenticated_error(&state, &server_url, response).await?);
    }
    response
        .json()
        .await
        .map_err(|_| "教学服务返回了无效数据".into())
}

#[tauri::command]
pub(crate) async fn submit_teaching_asset_review(
    server_url: String,
    asset_id: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    authenticated_post(
        &state,
        &server_url,
        &format!("/api/v1/admin/content/assets/{asset_id}/submit-review"),
        &serde_json::json!({}),
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_teaching_assignment_problems(
    server_url: String,
    assignment_id: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let account = get_teaching_account(server_url.clone(), state.clone()).await?;
    let owner_id = account.user_id.as_deref().ok_or("教学账号无效")?;
    let key = scoped_data_cache_key(
        &state,
        &server_url,
        owner_id,
        "problems",
        Some(&assignment_id),
    )?;
    match authenticated_get_pages(
        &state,
        &server_url,
        &format!("/api/v1/student/assignments/{assignment_id}/problems"),
    )
    .await
    {
        Ok(value) => {
            write_cache(&state, &key, owner_id, "problems", &value)?;
            Ok(value)
        }
        Err(error) if offline_error(&error) => read_cache(&state, &key)?.ok_or(error),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn submit_teaching_attempt(
    server_url: String,
    attempt: serde_json::Value,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let account = get_teaching_account(server_url.clone(), state.clone()).await?;
    let owner_id = account.user_id.as_deref().ok_or("教学账号无效")?;
    let client_attempt_id = attempt
        .get("clientAttemptId")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or("提交记录缺少 clientAttemptId")?;
    {
        let mut model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
        model
            .store
            .enqueue_teaching_attempt(
                client_attempt_id,
                owner_id,
                &normalized_server_url(&server_url),
                &attempt.to_string(),
            )
            .map_err(|error| error.to_string())?;
    }
    let token = state
        .credentials
        .get(&token_key(&server_url))?
        .ok_or("请先登录教学账号")?;
    let response = reqwest::Client::new()
        .post(endpoint(&server_url, "/api/v1/student/attempts")?)
        .bearer_auth(token)
        .header("x-xiangqi-app-id", "xiangqi-studio")
        .json(&attempt)
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let message = format!("教学服务不可用：{error}");
            mark_attempt_failed(&state, client_attempt_id, &message)?;
            return Ok(serde_json::json!({ "queued": true, "clientAttemptId": client_attempt_id }));
        }
    };
    if !response.status().is_success() {
        let retryable = response.status().is_server_error()
            || response.status().as_u16() == 408
            || response.status().as_u16() == 429;
        let message = authenticated_error(&state, &server_url, response).await?;
        if retryable {
            mark_attempt_failed(&state, client_attempt_id, &message)?;
            return Ok(serde_json::json!({ "queued": true, "clientAttemptId": client_attempt_id }));
        }
        remove_attempt(&state, client_attempt_id)?;
        return Err(message);
    }
    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "教学服务返回了无效数据".to_owned())?;
    remove_attempt(&state, client_attempt_id)?;
    Ok(result)
}

fn mark_attempt_failed(
    state: &DesktopState,
    client_attempt_id: &str,
    error: &str,
) -> Result<(), String> {
    let mut model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
    model
        .store
        .mark_teaching_attempt_failed(client_attempt_id, error)
        .map_err(|error| error.to_string())
}

fn remove_attempt(state: &DesktopState, client_attempt_id: &str) -> Result<(), String> {
    let mut model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
    model
        .store
        .remove_teaching_attempt(client_attempt_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn flush_teaching_attempts(
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let account = get_teaching_account(server_url.clone(), state.clone()).await?;
    let owner_id = account.user_id.as_deref().ok_or("教学账号无效")?;
    let normalized = normalized_server_url(&server_url);
    let pending = {
        let model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
        model
            .store
            .pending_teaching_attempts(owner_id, &normalized)
            .map_err(|error| error.to_string())?
    };
    let mut submitted = 0usize;
    for entry in &pending {
        let attempt =
            serde_json::from_str(&entry.payload_json).map_err(|error| error.to_string())?;
        let result = submit_teaching_attempt(server_url.clone(), attempt, state.clone()).await?;
        if result.get("queued").and_then(serde_json::Value::as_bool) == Some(true) {
            break;
        }
        submitted += 1;
    }
    let remaining = {
        let model = state.model.lock().map_err(|_| "本地教学缓存锁已损坏")?;
        model
            .store
            .pending_teaching_attempts(owner_id, &normalized)
            .map_err(|error| error.to_string())?
            .len()
    };
    Ok(serde_json::json!({ "submitted": submitted, "remaining": remaining }))
}

#[cfg(test)]
mod credential_tests {
    use super::*;
    use crate::credential_store::{CredentialStore, MemoryCredentialStore};

    #[test]
    fn credentials_are_bound_to_the_logged_in_server() {
        let store = MemoryCredentialStore::new();
        let production = token_key("https://api.qixiapp.cn");
        store.set(&production, "test-token").unwrap();
        store
            .set(TEACHING_TOKEN_KEY, "legacy-unbound-token")
            .unwrap();
        assert_eq!(
            store
                .get(&token_key("https://api-test.qixiapp.cn"))
                .unwrap(),
            None
        );
        assert_eq!(
            store.get(&token_key("https://other.example")).unwrap(),
            None
        );
        assert_eq!(token_key(" https://api.qixiapp.cn/ "), production);
        store
            .delete(&token_key("https://api-test.qixiapp.cn"))
            .unwrap();
        assert!(store.get(&production).unwrap().is_some());
    }

    #[test]
    fn permission_errors_never_allow_an_offline_cache_fallback() {
        assert!(offline_error("教学服务不可用：connection refused"));
        assert!(!offline_error(
            "登录状态已过期或当前账号没有权限，请重新登录后再试。"
        ));
        assert!(!offline_error("当前账号没有执行此操作的权限。"));
        assert!(!offline_error("教学服务返回了无效数据"));
    }
}
