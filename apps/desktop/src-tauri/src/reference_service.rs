use crate::app_state::DesktopState;
use reference_library::{
    OpeningCategory, OpeningMatch, PositionExplorerRequest, PositionMoveStat,
    ReferenceGameDocument, ReferenceGameFilters, ReferenceGameSummary, ReferenceImportBatch,
    ReferenceReviewIssue, ReferenceSource,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    fs::File,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::State;
use url::Url;
use uuid::Uuid;

const REFERENCE_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const OFFLINE_PACKAGE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_OFFLINE_PACKAGE_COMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_OFFLINE_PACKAGE_DECOMPRESSED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const OFFLINE_MASTER_FILTER_UNAVAILABLE: &str =
    "大师身份筛选需要连接服务端；当前离线资料包不含认证大师身份映射";
const SERVER_FINGERPRINT_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
type ServerFingerprintCache = Option<(String, Instant, Arc<[String]>)>;
static SERVER_FINGERPRINT_CACHE: OnceLock<Mutex<ServerFingerprintCache>> = OnceLock::new();

async fn server_fingerprints(server_url: &str) -> Result<Arc<[String]>, String> {
    let base = server_url.trim_end_matches('/');
    let cache = SERVER_FINGERPRINT_CACHE.get_or_init(|| Mutex::new(None));
    if let Some((_, _, fingerprints)) = cache
        .lock()
        .map_err(|_| "服务端指纹缓存锁已损坏".to_owned())?
        .as_ref()
        .filter(|(cached_url, cached_at, _)| {
            cached_url == base && cached_at.elapsed() < SERVER_FINGERPRINT_CACHE_TTL
        })
    {
        return Ok(Arc::clone(fingerprints));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("创建服务端指纹请求失败：{error}"))?
        .get(format!("{base}/api/v1/reference/fingerprints"))
        .send()
        .await
        .map_err(|error| format!("读取服务端棋局指纹失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取服务端棋局指纹失败：HTTP {}",
            response.status()
        ));
    }
    let fingerprints: Arc<[String]> = response
        .json::<Vec<String>>()
        .await
        .map_err(|error| format!("服务端棋局指纹响应无效：{error}"))?
        .into();
    *cache
        .lock()
        .map_err(|_| "服务端指纹缓存锁已损坏".to_owned())? =
        Some((base.to_owned(), Instant::now(), Arc::clone(&fingerprints)));
    Ok(fingerprints)
}

fn invalidate_server_fingerprints() {
    if let Some(cache) = SERVER_FINGERPRINT_CACHE.get()
        && let Ok(mut cache) = cache.lock()
    {
        cache.take();
    }
}

fn reference_server_url(state: State<'_, DesktopState>) -> Result<String, String> {
    state
        .model
        .lock()
        .map_err(|_| "应用状态锁已损坏".to_owned())?
        .store
        .desktop_preferences()
        .map_err(|error| error.to_string())
        .map(|preferences| preferences.server_url)
}

fn with_library<T>(
    state: State<'_, DesktopState>,
    action: impl FnOnce(&mut reference_library::ReferenceLibrary) -> reference_library::Result<T>,
) -> Result<T, String> {
    let mut library = state
        .reference_library
        .lock()
        .map_err(|_| "参考实战库锁已损坏".to_owned())?;
    action(&mut library).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn register_reference_source(
    path: String,
    display_name: String,
    auto_scan: bool,
    license_status: String,
    state: State<'_, DesktopState>,
) -> Result<ReferenceSource, String> {
    with_library(state, |library| {
        library.register_source(path, &display_name, auto_scan, &license_status)
    })
}

#[tauri::command]
pub(crate) fn list_reference_sources(
    state: State<'_, DesktopState>,
) -> Result<Vec<ReferenceSource>, String> {
    with_library(state, |library| library.sources())
}

#[tauri::command]
pub(crate) fn scan_reference_source(
    source_id: String,
    state: State<'_, DesktopState>,
) -> Result<ReferenceImportBatch, String> {
    with_library(state, |library| library.scan_source(&source_id))
}

#[tauri::command]
pub(crate) fn list_reference_import_batches(
    source_id: Option<String>,
    limit: Option<usize>,
    state: State<'_, DesktopState>,
) -> Result<Vec<ReferenceImportBatch>, String> {
    with_library(state, |library| {
        library.batches(source_id.as_deref(), limit.unwrap_or(50))
    })
}

#[tauri::command]
pub(crate) fn review_reference_batch(
    batch_id: String,
    approved: bool,
    note: String,
    state: State<'_, DesktopState>,
) -> Result<ReferenceImportBatch, String> {
    with_library(state, |library| {
        library.review_batch(&batch_id, approved, &note)
    })
}

#[tauri::command]
pub(crate) fn classify_reference_batch(
    batch_id: String,
    state: State<'_, DesktopState>,
) -> Result<Vec<OpeningMatch>, String> {
    with_library(state, |library| library.classify_batch(&batch_id))
}

#[tauri::command]
pub(crate) fn list_reference_batch_issues(
    batch_id: String,
    state: State<'_, DesktopState>,
) -> Result<Vec<ReferenceReviewIssue>, String> {
    with_library(state, |library| library.batch_review_issues(&batch_id))
}

#[tauri::command]
pub(crate) fn update_reference_game_identity(
    game_id: String,
    red_player: String,
    black_player: String,
    game_date: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    with_library(state, |library| {
        library.update_game_identity(&game_id, &red_player, &black_player, &game_date)
    })
}

#[tauri::command]
pub(crate) fn override_reference_game_opening(
    game_id: String,
    category_code: String,
    reviewed_alias: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    with_library(state, |library| {
        library.override_game_opening(&game_id, &category_code, reviewed_alias.as_deref())
    })
}

#[tauri::command]
pub(crate) fn resolve_reference_duplicate(
    issue_id: String,
    merge: bool,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    with_library(state, |library| {
        library.resolve_duplicate_candidate(&issue_id, merge)
    })
}

#[tauri::command]
pub(crate) async fn query_reference_position(
    request: PositionExplorerRequest,
    state: State<'_, DesktopState>,
) -> Result<Vec<PositionMoveStat>, String> {
    let (working, working_count) = {
        let library = state
            .reference_library
            .lock()
            .map_err(|_| "参考实战库锁已损坏".to_owned())?;
        (
            library
                .query_position_filtered(&request)
                .map_err(|error| error.to_string())?,
            library.game_count().map_err(|error| error.to_string())?,
        )
    };
    let (offline, offline_count) = {
        let library = state
            .offline_reference_library
            .lock()
            .map_err(|_| "离线参考实战库锁已损坏".to_owned())?;
        match library.as_ref() {
            Some(library) => {
                let working_fingerprints = state
                    .reference_library
                    .lock()
                    .map_err(|_| "参考实战库锁已损坏".to_owned())?
                    .canonical_fingerprints()
                    .map_err(|error| error.to_string())?;
                (
                    library
                        .query_position_filtered_excluding(&request, &working_fingerprints)
                        .map_err(|error| error.to_string())?,
                    library.game_count().map_err(|error| error.to_string())?,
                )
            }
            None => (Vec::new(), 0),
        }
    };
    let local = merge_position_stats(working, offline);
    let has_local_games = working_count + offline_count > 0;
    let master_only = request.master_only.unwrap_or(false);
    if has_local_games && !master_only {
        return Ok(local);
    }
    let server_url = reference_server_url(state.clone())?;
    if let Err(error) = crate::engine_service::validate_server_url(&server_url) {
        return if master_only {
            Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into())
        } else if has_local_games {
            Ok(local)
        } else {
            Err(error)
        };
    }
    let response = reqwest::Client::builder()
        .timeout(REFERENCE_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("创建实战库请求失败：{error}"))?
        .post(format!(
            "{}/api/v1/reference/position-query",
            server_url.trim_end_matches('/')
        ))
        .json(&request)
        .send()
        .await;
    match response {
        Ok(response) if response.status().is_success() => {
            let server = response
                .json::<Vec<PositionMoveStat>>()
                .await
                .map_err(|error| format!("服务端实战库响应无效：{error}"))?;
            if master_only {
                return Ok(server);
            }
            let known = server_fingerprints(&server_url).await?;
            let unpublished = with_library(state, |library| {
                library.query_position_filtered_excluding(&request, &known)
            })?;
            Ok(merge_position_stats(server, unpublished))
        }
        Ok(_response) if master_only => Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into()),
        Ok(response) if has_local_games => {
            let _ = response;
            Ok(local)
        }
        Ok(response) => Err(format!(
            "当前设备没有本地参考库，服务端查询失败：HTTP {}",
            response.status()
        )),
        Err(_) if master_only => Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into()),
        Err(_) if has_local_games => Ok(local),
        Err(error) => Err(format!("当前设备没有本地参考库，且无法连接服务端：{error}")),
    }
}

#[tauri::command]
pub(crate) async fn browse_reference_openings(
    parent_code: Option<String>,
    state: State<'_, DesktopState>,
) -> Result<Vec<OpeningCategory>, String> {
    let (working, working_count) = {
        let library = state
            .reference_library
            .lock()
            .map_err(|_| "参考实战库锁已损坏".to_owned())?;
        (
            library
                .browse_openings(parent_code.as_deref())
                .map_err(|error| error.to_string())?,
            library.game_count().map_err(|error| error.to_string())?,
        )
    };
    let (offline, offline_count) = {
        let library = state
            .offline_reference_library
            .lock()
            .map_err(|_| "离线参考实战库锁已损坏".to_owned())?;
        match library.as_ref() {
            Some(library) => {
                let working_fingerprints = state
                    .reference_library
                    .lock()
                    .map_err(|_| "参考实战库锁已损坏".to_owned())?
                    .canonical_fingerprints()
                    .map_err(|error| error.to_string())?;
                (
                    library
                        .browse_openings_excluding(parent_code.as_deref(), &working_fingerprints)
                        .map_err(|error| error.to_string())?,
                    library.game_count().map_err(|error| error.to_string())?,
                )
            }
            None => (Vec::new(), 0),
        }
    };
    let local = merge_openings(working, offline);
    let has_local_games = working_count + offline_count > 0;
    if has_local_games {
        return Ok(local);
    }
    let server_url = reference_server_url(state.clone())?;
    if let Err(error) = crate::engine_service::validate_server_url(&server_url) {
        return if has_local_games {
            Ok(local)
        } else {
            Err(error)
        };
    }
    let mut url = Url::parse(&format!(
        "{}/api/v1/openings",
        server_url.trim_end_matches('/')
    ))
    .map_err(|_| "同步服务地址无效".to_owned())?;
    if let Some(parent_code) = parent_code.as_deref() {
        url.query_pairs_mut().append_pair("parentCode", parent_code);
    }
    let response = reqwest::Client::builder()
        .timeout(REFERENCE_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("创建布局查询失败：{error}"))?
        .get(url)
        .send()
        .await;
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(_response) if has_local_games => return Ok(local),
        Ok(response) => {
            return Err(format!(
                "当前设备没有离线参考库，服务端布局查询失败：HTTP {}",
                response.status()
            ));
        }
        Err(_) if has_local_games => return Ok(local),
        Err(error) => {
            return Err(format!("当前设备没有离线参考库，且无法连接服务端：{error}"));
        }
    };
    let server = response
        .json::<Vec<OpeningCategory>>()
        .await
        .map_err(|error| format!("服务端布局响应无效：{error}"))?;
    let known = server_fingerprints(&server_url).await?;
    let unpublished = with_library(state, |library| {
        library.browse_openings_excluding(parent_code.as_deref(), &known)
    })?;
    Ok(merge_openings(server, unpublished))
}

#[tauri::command]
pub(crate) async fn list_reference_games(
    opening_code: Option<String>,
    query: Option<String>,
    player: Option<String>,
    event: Option<String>,
    year_from: Option<i32>,
    year_to: Option<i32>,
    side: Option<String>,
    master_only: Option<bool>,
    classification_status: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    state: State<'_, DesktopState>,
) -> Result<Vec<ReferenceGameSummary>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let offset = offset.unwrap_or(0);
    let fetch_limit = limit.saturating_add(offset);
    let filters = ReferenceGameFilters {
        player,
        event,
        year_from,
        year_to,
        side,
        master_only,
        classification_status,
    };
    let (working, working_count) = {
        let library = state
            .reference_library
            .lock()
            .map_err(|_| "参考实战库锁已损坏".to_owned())?;
        (
            library
                .list_games_filtered(
                    opening_code.as_deref(),
                    query.as_deref(),
                    &filters,
                    fetch_limit,
                    0,
                )
                .map_err(|error| error.to_string())?,
            library.game_count().map_err(|error| error.to_string())?,
        )
    };
    let (offline, offline_count) = {
        let library = state
            .offline_reference_library
            .lock()
            .map_err(|_| "离线参考实战库锁已损坏".to_owned())?;
        match library.as_ref() {
            Some(library) => {
                let working_fingerprints = state
                    .reference_library
                    .lock()
                    .map_err(|_| "参考实战库锁已损坏".to_owned())?
                    .canonical_fingerprints()
                    .map_err(|error| error.to_string())?;
                (
                    library
                        .list_games_filtered_excluding(
                            opening_code.as_deref(),
                            query.as_deref(),
                            &filters,
                            fetch_limit,
                            0,
                            &working_fingerprints,
                        )
                        .map_err(|error| error.to_string())?,
                    library.game_count().map_err(|error| error.to_string())?,
                )
            }
            None => (Vec::new(), 0),
        }
    };
    let local = merge_games(working, offline, limit, offset);
    let has_local_games = working_count + offline_count > 0;
    let master_only = filters.master_only.unwrap_or(false);
    if has_local_games && !master_only {
        return Ok(local);
    }
    let server_url = reference_server_url(state.clone())?;
    if let Err(error) = crate::engine_service::validate_server_url(&server_url) {
        return if master_only {
            Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into())
        } else if has_local_games {
            Ok(local)
        } else {
            Err(error)
        };
    }
    let mut url = Url::parse(&format!(
        "{}/api/v1/reference/games",
        server_url.trim_end_matches('/')
    ))
    .map_err(|_| "同步服务地址无效".to_owned())?;
    {
        let mut pairs = url.query_pairs_mut();
        if let Some(opening_code) = opening_code.as_deref() {
            pairs.append_pair("openingCode", opening_code);
        }
        if let Some(query) = query.as_deref() {
            pairs.append_pair("query", query);
        }
        if let Some(player) = filters
            .player
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            pairs.append_pair("player", player);
        }
        if let Some(event) = filters
            .event
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            pairs.append_pair("event", event);
        }
        if let Some(year) = filters.year_from {
            pairs.append_pair("yearFrom", &year.to_string());
        }
        if let Some(year) = filters.year_to {
            pairs.append_pair("yearTo", &year.to_string());
        }
        if let Some(side) = filters.side.as_deref() {
            pairs.append_pair("side", side);
        }
        if filters.master_only.unwrap_or(false) {
            pairs.append_pair("masterOnly", "true");
        }
    }
    let client = reqwest::Client::builder()
        .timeout(REFERENCE_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("创建棋谱查询失败：{error}"))?;
    let mut server = Vec::new();
    while server.len() < fetch_limit {
        let page_limit = (fetch_limit - server.len()).min(200);
        let mut page_url = url.clone();
        page_url
            .query_pairs_mut()
            .append_pair("limit", &page_limit.to_string())
            .append_pair("offset", &server.len().to_string());
        let response = client.get(page_url).send().await;
        let response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(_response) if master_only => {
                return Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into());
            }
            Ok(_response) if has_local_games => return Ok(local),
            Ok(response) => {
                return Err(format!(
                    "当前设备没有离线参考库，服务端棋谱查询失败：HTTP {}",
                    response.status()
                ));
            }
            Err(_) if master_only => return Err(OFFLINE_MASTER_FILTER_UNAVAILABLE.into()),
            Err(_) if has_local_games => return Ok(local),
            Err(error) => {
                return Err(format!("当前设备没有离线参考库，且无法连接服务端：{error}"));
            }
        };
        let page = response
            .json::<Vec<ServerReferenceGameSummary>>()
            .await
            .map_err(|error| format!("服务端棋谱响应无效：{error}"))?;
        let page_len = page.len();
        server.extend(page.into_iter().map(Into::into));
        if page_len < page_limit {
            break;
        }
    }
    if master_only {
        return Ok(server.into_iter().skip(offset).take(limit).collect());
    }
    let known = server_fingerprints(&server_url).await?;
    let unpublished = with_library(state, |library| {
        library.list_games_filtered_excluding(
            opening_code.as_deref(),
            query.as_deref(),
            &filters,
            fetch_limit,
            0,
            &known,
        )
    })?;
    Ok(merge_games(server, unpublished, limit, offset))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerReferenceGameSummary {
    id: String,
    canonical_fingerprint: String,
    title: String,
    red_player: String,
    black_player: String,
    result: String,
    event_name: String,
    round_name: String,
    game_date: Option<String>,
    opening: String,
    opening_code: Option<String>,
    move_count: u32,
}

impl From<ServerReferenceGameSummary> for ReferenceGameSummary {
    fn from(value: ServerReferenceGameSummary) -> Self {
        Self {
            id: value.id,
            canonical_fingerprint: value.canonical_fingerprint,
            title: value.title,
            red_player: value.red_player,
            black_player: value.black_player,
            result: value.result,
            event_name: value.event_name,
            round_name: value.round_name,
            game_date: value.game_date.unwrap_or_default(),
            opening: value.opening,
            opening_code: value.opening_code,
            move_count: value.move_count,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceOfflinePackageResult {
    sha256: String,
    compressed_bytes: u64,
    game_count: u64,
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceOfflinePackageManifest {
    version: String,
    package_url: String,
    sha256: String,
    game_count: u64,
    published_at: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_reference_offline_package_manifest(
    server_url: String,
) -> Result<ReferenceOfflinePackageManifest, String> {
    crate::engine_service::validate_server_url(&server_url)?;
    let base = Url::parse(server_url.trim()).map_err(|_| "同步服务地址无效".to_owned())?;
    let endpoint = base
        .join("/api/v1/reference/offline-package")
        .map_err(|_| "同步服务地址无效".to_owned())?;
    let response = reqwest::Client::builder()
        .timeout(REFERENCE_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("创建离线包清单请求失败：{error}"))?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("获取离线包清单失败：{error}"))?;
    if !response.status().is_success() {
        return Err(if response.status() == reqwest::StatusCode::NOT_FOUND {
            "服务端尚未发布离线参考库".into()
        } else {
            format!("获取离线包清单失败：HTTP {}", response.status())
        });
    }
    response
        .json()
        .await
        .map_err(|error| format!("离线包清单响应无效：{error}"))
}

#[tauri::command]
pub(crate) async fn install_reference_offline_package(
    package_url: String,
    sha256: String,
    state: State<'_, DesktopState>,
) -> Result<ReferenceOfflinePackageResult, String> {
    let expected_sha = sha256.trim().to_ascii_lowercase();
    if expected_sha.len() != 64 || !expected_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("离线包 SHA-256 必须是 64 位十六进制".into());
    }
    let url = Url::parse(package_url.trim()).map_err(|_| "离线包地址无效".to_owned())?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err("非本机离线包地址必须使用 HTTPS".into());
    }
    let target = state.offline_reference_library_path.clone();
    let parent = target.parent().ok_or_else(|| "参考库路径无效".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建参考库目录失败：{error}"))?;
    let token = Uuid::new_v4();
    let compressed_path = parent.join(format!(".reference-library-{token}.sqlite.zst"));
    let incoming_path = parent.join(format!(".reference-library-{token}.sqlite"));
    let result = async {
        let mut response = reqwest::Client::builder()
            .timeout(OFFLINE_PACKAGE_DOWNLOAD_TIMEOUT)
            .build()
            .map_err(|error| format!("创建离线包下载请求失败：{error}"))?
            .get(url)
            .send()
            .await
            .map_err(|error| format!("下载离线参考库失败：{error}"))?;
        if !response.status().is_success() {
            return Err(format!("下载离线参考库失败：HTTP {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_OFFLINE_PACKAGE_COMPRESSED_BYTES)
        {
            return Err("离线包超过 2 GiB 压缩大小上限".into());
        }
        let mut compressed = File::create(&compressed_path)
            .map_err(|error| format!("创建离线包临时文件失败：{error}"))?;
        let mut digest = Sha256::new();
        let mut compressed_bytes = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("读取离线参考库失败：{error}"))?
        {
            compressed_bytes += chunk.len() as u64;
            if compressed_bytes > MAX_OFFLINE_PACKAGE_COMPRESSED_BYTES {
                return Err("离线包超过 2 GiB 压缩大小上限".into());
            }
            compressed
                .write_all(&chunk)
                .map_err(|error| format!("写入离线包临时文件失败：{error}"))?;
            digest.update(&chunk);
        }
        compressed
            .sync_all()
            .map_err(|error| format!("保存离线包临时文件失败：{error}"))?;
        drop(compressed);
        let actual_sha = format!("{:x}", digest.finalize());
        if actual_sha != expected_sha {
            return Err(format!(
                "离线包 SHA-256 不匹配：期望 {expected_sha}，实际 {actual_sha}"
            ));
        }
        let compressed_path_for_decode = compressed_path.clone();
        let incoming_path_for_decode = incoming_path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let source = File::open(&compressed_path_for_decode)
                .map_err(|error| format!("打开离线包失败：{error}"))?;
            let mut destination = File::create(&incoming_path_for_decode)
                .map_err(|error| format!("创建离线数据库失败：{error}"))?;
            decode_zstd_limited(
                source,
                &mut destination,
                MAX_OFFLINE_PACKAGE_DECOMPRESSED_BYTES,
            )?;
            destination
                .sync_all()
                .map_err(|error| format!("保存离线数据库失败：{error}"))
        })
        .await
        .map_err(|error| format!("解压离线参考库任务失败：{error}"))??;
        let game_count =
            reference_library::ReferenceLibrary::validate_offline_package(&incoming_path)
                .map_err(|error| error.to_string())?;
        replace_reference_database(&state, &incoming_path, &target)?;
        Ok(ReferenceOfflinePackageResult {
            sha256: actual_sha,
            compressed_bytes,
            game_count,
        })
    }
    .await;
    let _ = fs::remove_file(&compressed_path);
    let _ = fs::remove_file(&incoming_path);
    result
}

fn decode_zstd_limited(
    source: impl Read,
    destination: impl Write,
    max_bytes: u64,
) -> Result<u64, String> {
    let decoder = zstd::stream::read::Decoder::new(source)
        .map_err(|error| format!("打开离线参考库压缩流失败：{error}"))?;
    let mut limited = decoder.take(max_bytes.saturating_add(1));
    let mut destination = destination;
    let decompressed_bytes = std::io::copy(&mut limited, &mut destination)
        .map_err(|error| format!("解压离线参考库失败：{error}"))?;
    if decompressed_bytes > max_bytes {
        return Err(format!("离线参考库超过 {max_bytes} 字节解压大小上限"));
    }
    Ok(decompressed_bytes)
}

fn replace_reference_database(
    state: &DesktopState,
    incoming_path: &Path,
    target: &Path,
) -> Result<(), String> {
    let mut library = state
        .offline_reference_library
        .lock()
        .map_err(|_| "参考实战库锁已损坏".to_owned())?;
    let previous = library.take();
    drop(previous);
    remove_sqlite_sidecars(target);
    let backup = target.with_extension(format!("sqlite.backup-{}", Uuid::new_v4()));
    let had_previous = target.exists();
    if had_previous {
        if let Err(error) = fs::rename(target, &backup) {
            *library = reopen_existing_offline_database(target).map_err(|restore| {
                format!("备份现有参考库失败：{error}；恢复连接失败：{restore}")
            })?;
            return Err(format!("备份现有参考库失败：{error}"));
        }
    }
    if let Err(error) = fs::rename(incoming_path, target) {
        if had_previous {
            fs::rename(&backup, target)
                .map_err(|restore| format!("替换参考库失败：{error}；恢复失败：{restore}"))?;
        }
        *library = reopen_existing_offline_database(target)
            .map_err(|restore| format!("替换参考库失败：{error}；恢复失败：{restore}"))?;
        return Err(format!("替换参考库失败：{error}"));
    }
    match reference_library::ReferenceLibrary::open(target) {
        Ok(replacement) => {
            *library = Some(replacement);
            if had_previous {
                let _ = fs::remove_file(backup);
            }
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(target);
            if had_previous {
                fs::rename(&backup, target)
                    .map_err(|restore| format!("打开新参考库失败：{error}；恢复失败：{restore}"))?;
            }
            *library = reopen_existing_offline_database(target)
                .map_err(|restore| format!("打开新参考库失败：{error}；恢复失败：{restore}"))?;
            Err(format!("打开新参考库失败：{error}"))
        }
    }
}

fn reopen_existing_offline_database(
    target: &Path,
) -> Result<Option<reference_library::ReferenceLibrary>, String> {
    if !target.is_file() {
        return Ok(None);
    }
    reference_library::ReferenceLibrary::validate_offline_package(target)
        .map_err(|error| error.to_string())?;
    reference_library::ReferenceLibrary::open(target)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn remove_sqlite_sidecars(path: &Path) {
    for suffix in ["-wal", "-shm"] {
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            let _ = fs::remove_file(path.with_file_name(format!("{name}{suffix}")));
        }
    }
}

#[tauri::command]
pub(crate) fn get_reference_game_document(
    game_id: String,
    state: State<'_, DesktopState>,
) -> Result<Option<ReferenceGameDocument>, String> {
    let working = with_library(state.clone(), |library| library.game_document(&game_id))?;
    if working.is_some() {
        return Ok(working);
    }
    let library = state
        .offline_reference_library
        .lock()
        .map_err(|_| "离线参考实战库锁已损坏".to_owned())?;
    library
        .as_ref()
        .map(|library| library.game_document(&game_id))
        .transpose()
        .map_err(|error| error.to_string())
        .map(Option::flatten)
}

fn merge_position_stats(
    working: Vec<PositionMoveStat>,
    offline: Vec<PositionMoveStat>,
) -> Vec<PositionMoveStat> {
    let mut merged = BTreeMap::<String, PositionMoveStat>::new();
    for item in working.into_iter().chain(offline) {
        match merged.get_mut(&item.iccs) {
            Some(current) => {
                current.samples += item.samples;
                current.red_wins += item.red_wins;
                current.draws += item.draws;
                current.black_wins += item.black_wins;
                current.first_year = match (current.first_year, item.first_year) {
                    (Some(left), Some(right)) => Some(left.min(right)),
                    (left, right) => left.or(right),
                };
                current.last_year = match (current.last_year, item.last_year) {
                    (Some(left), Some(right)) => Some(left.max(right)),
                    (left, right) => left.or(right),
                };
                if current.opening_code.is_none() {
                    current.opening_code = item.opening_code;
                    current.opening_name = item.opening_name;
                    current.opening_confidence = item.opening_confidence;
                }
                if current.representative_game_id.is_none() {
                    current.representative_game_id = item.representative_game_id;
                    current.representative_game_title = item.representative_game_title;
                }
            }
            None => {
                merged.insert(item.iccs.clone(), item);
            }
        }
    }
    let mut result = merged.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| {
        right
            .samples
            .cmp(&left.samples)
            .then_with(|| left.iccs.cmp(&right.iccs))
    });
    result
}

fn merge_openings(
    working: Vec<OpeningCategory>,
    offline: Vec<OpeningCategory>,
) -> Vec<OpeningCategory> {
    let mut merged = BTreeMap::<String, OpeningCategory>::new();
    for item in working.into_iter().chain(offline) {
        match merged.get_mut(&item.code) {
            Some(current) => {
                current.game_count += item.game_count;
                current.red_wins += item.red_wins;
                current.draws += item.draws;
                current.black_wins += item.black_wins;
                current.aliases.extend(item.aliases);
                current.aliases.sort();
                current.aliases.dedup();
            }
            None => {
                merged.insert(item.code.clone(), item);
            }
        }
    }
    let mut result = merged.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.code.cmp(&right.code))
    });
    result
}

fn merge_games(
    working: Vec<ReferenceGameSummary>,
    offline: Vec<ReferenceGameSummary>,
    limit: usize,
    offset: usize,
) -> Vec<ReferenceGameSummary> {
    let mut identities = BTreeSet::new();
    let mut games = working
        .into_iter()
        .chain(offline)
        .filter(|game| identities.insert(game.canonical_fingerprint.clone()))
        .collect::<Vec<_>>();
    games.sort_by(|left, right| {
        right
            .game_date
            .cmp(&left.game_date)
            .then_with(|| right.id.cmp(&left.id))
    });
    games.into_iter().skip(offset).take(limit).collect()
}

#[tauri::command]
pub(crate) async fn publish_reference_batch(
    batch_id: String,
    server_source_id: String,
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<serde_json::Value, String> {
    let base = Url::parse(server_url.trim()).map_err(|_| "同步服务地址无效".to_owned())?;
    let local = matches!(base.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if base.scheme() != "https" && !(local && base.scheme() == "http") {
        return Err("非本机参考库服务必须使用 HTTPS".into());
    }
    let token = state
        .session_token
        .lock()
        .map_err(|_| "登录状态锁已损坏".to_owned())?
        .clone()
        .ok_or_else(|| "请先使用管理员账号登录".to_owned())?;
    let client = reqwest::Client::new();
    let mut offset = 0usize;
    let mut inserted = 0u64;
    let mut duplicates = 0u64;
    let mut removed = 0u64;
    loop {
        let payload = {
            let library = state
                .reference_library
                .lock()
                .map_err(|_| "参考实战库锁已损坏".to_owned())?;
            library
                .publish_batch_payload_chunk(&batch_id, &server_source_id, 250, offset)
                .map_err(|error| error.to_string())?
        };
        if payload.games.is_empty() && payload.removed_records.is_empty() {
            break;
        }
        let chunk_size = payload.games.len().max(payload.removed_records.len());
        let response = client
            .post(
                base.join("/api/v1/reference/publish/chunks")
                    .map_err(|_| "同步服务地址无效".to_owned())?,
            )
            .bearer_auth(&token)
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("发布参考棋谱失败：{error}"))?;
        if !response.status().is_success() {
            return Err(format!("发布参考棋谱失败：HTTP {}", response.status()));
        }
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("发布响应无效：{error}"))?;
        inserted += value
            .get("inserted")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        duplicates += value
            .get("duplicates")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        removed += value
            .get("removed")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        offset += chunk_size;
    }
    let response = client
        .post(
            base.join("/api/v1/reference/publish/confirm")
                .map_err(|_| "同步服务地址无效".to_owned())?,
        )
        .bearer_auth(&token)
        .json(&serde_json::json!({"sourceId":server_source_id,"clientBatchId":&batch_id}))
        .send()
        .await
        .map_err(|error| format!("确认发布批次失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("确认发布批次失败：HTTP {}", response.status()));
    }
    with_library(state, |library| library.mark_batch_published(&batch_id))?;
    invalidate_server_fingerprints();
    Ok(
        serde_json::json!({"status":"completed","inserted":inserted,"duplicates":duplicates,"removed":removed}),
    )
}

#[tauri::command]
pub(crate) async fn create_server_reference_source(
    display_name: String,
    license_status: String,
    license_note: String,
    public_locator: Option<String>,
    server_url: String,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    if matches!(license_status.trim(), "" | "local-only" | "unreviewed") {
        return Err("只有已获授权的来源才能登记到共享服务".into());
    }
    if license_note.trim().is_empty() {
        return Err("请填写来源许可说明".into());
    }
    let base = Url::parse(server_url.trim()).map_err(|_| "同步服务地址无效".to_owned())?;
    let local = matches!(base.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if base.scheme() != "https" && !(local && base.scheme() == "http") {
        return Err("非本机参考库服务必须使用 HTTPS".into());
    }
    let token = state
        .session_token
        .lock()
        .map_err(|_| "登录状态锁已损坏".to_owned())?
        .clone()
        .ok_or_else(|| "请先使用管理员账号登录".to_owned())?;
    let response = reqwest::Client::new()
        .post(
            base.join("/api/v1/reference/sources")
                .map_err(|_| "同步服务地址无效".to_owned())?,
        )
        .bearer_auth(token)
        .json(&serde_json::json!({
            "displayName": display_name.trim(),
            "sourceType": "cbl",
            "publicLocator": public_locator.as_deref().map(str::trim).filter(|value| !value.is_empty()),
            "licenseStatus": license_status.trim(),
            "licenseNote": license_note.trim(),
        }))
        .send()
        .await
        .map_err(|error| format!("登记服务端来源失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("登记服务端来源失败：HTTP {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("服务端来源响应无效：{error}"))?;
    value
        .get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "服务端未返回来源 ID".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{decode_zstd_limited, merge_games, reopen_existing_offline_database};
    use reference_library::ReferenceGameSummary;

    fn game(index: usize) -> ReferenceGameSummary {
        ReferenceGameSummary {
            id: format!("game-{index:03}"),
            canonical_fingerprint: format!("fingerprint-{index:03}"),
            title: format!("棋局 {index}"),
            red_player: "红方".into(),
            black_player: "黑方".into(),
            result: "1-0".into(),
            event_name: "测试赛".into(),
            round_name: index.to_string(),
            game_date: format!("2026-{:02}-{:02}", index / 28 + 1, index % 28 + 1),
            opening: String::new(),
            opening_code: None,
            move_count: 1,
        }
    }

    #[test]
    fn offline_package_decode_enforces_uncompressed_limit() {
        let compressed = zstd::stream::encode_all(&b"12345"[..], 0).unwrap();
        let mut output = Vec::new();

        let error = decode_zstd_limited(&compressed[..], &mut output, 4).unwrap_err();

        assert!(error.contains("超过 4 字节"));
    }

    #[test]
    fn offline_package_decode_accepts_payload_at_limit() {
        let compressed = zstd::stream::encode_all(&b"12345"[..], 0).unwrap();
        let mut output = Vec::new();

        let written = decode_zstd_limited(&compressed[..], &mut output, 5).unwrap();

        assert_eq!(written, 5);
        assert_eq!(output, b"12345");
    }

    #[test]
    fn reopening_a_missing_offline_database_does_not_create_an_empty_file() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("missing.sqlite");

        assert!(reopen_existing_offline_database(&target).unwrap().is_none());
        assert!(!target.exists());
    }

    #[test]
    fn merged_game_pagination_supports_offsets_beyond_two_hundred() {
        let working = (0..130).map(game).collect::<Vec<_>>();
        let mut offline = (130..260).map(game).collect::<Vec<_>>();
        offline.push(game(0));

        let page = merge_games(working, offline, 25, 200);

        assert_eq!(page.len(), 25);
        assert_eq!(page[0].id, "game-059");
        assert_eq!(page[24].id, "game-035");
    }
}
