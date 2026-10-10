use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{auth::authenticated_user, error::ApiError, state::AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRequest {
    pub records: Vec<SyncRecordRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRecordRequest {
    pub kind: String,
    pub id: String,
    pub base_revision: u64,
    pub deleted: bool,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncResponse {
    pub records: Vec<SyncRecordDto>,
    pub conflict_count: u32,
    pub status: PersonalManualSyncStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalManualSyncStatus {
    pub last_synced_at: Option<DateTime<Utc>>,
    pub game_count: u64,
    pub folder_count: u64,
    pub analysis_count: u64,
    pub conflict_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRecordDto {
    pub kind: String,
    pub id: String,
    pub revision: u64,
    pub deleted: bool,
    pub payload: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportsRequest {
    pub provider: String,
    pub records: Vec<ProviderImportRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportRequest {
    pub external_id: String,
    pub payload_hash: String,
    pub snapshot: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportsResponse {
    pub records: Vec<ProviderImportDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportPublishResponse {
    pub records: Vec<ProviderImportAckDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportAckDto {
    pub external_id: String,
    pub payload_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderImportDto {
    pub provider: String,
    pub external_id: String,
    pub payload_hash: String,
    pub revision: u64,
    pub snapshot: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, PartialEq, Eq)]
enum ProviderImportWrite {
    Insert,
    Unchanged,
    Update { revision: u64 },
}

fn provider_import_write(
    existing: Option<(&str, u64)>,
    incoming_payload_hash: &str,
) -> ProviderImportWrite {
    match existing {
        Some((payload_hash, _)) if payload_hash == incoming_payload_hash => {
            ProviderImportWrite::Unchanged
        }
        Some((_, revision)) => ProviderImportWrite::Update {
            revision: revision + 1,
        },
        None => ProviderImportWrite::Insert,
    }
}

fn provider_import_acknowledgements(request: &ProviderImportsRequest) -> Vec<ProviderImportAckDto> {
    request
        .records
        .iter()
        .map(|record| ProviderImportAckDto {
            external_id: record.external_id.clone(),
            payload_hash: record.payload_hash.clone(),
        })
        .collect()
}

pub(crate) async fn migrate(pool: &sqlx::MySqlPool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(include_str!("../migrations/0005_personal_manual_sync.sql"))
        .execute(pool)
        .await
        .map(|_| ())
}

pub(crate) async fn sync(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SyncRequest>,
) -> Result<Json<SyncResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    if request.records.len() > 2_000 {
        return Err(ApiError::Invalid("too many manual records".into()));
    }
    let mut transaction = state.pool.begin().await?;
    let mut conflicts = 0;
    for record in request.records {
        if !matches!(record.kind.as_str(), "game" | "folder" | "analysis")
            || record.id.trim().is_empty()
            || record.id.len() > 191
            || (!record.deleted && !valid_payload(&record))
        {
            return Err(ApiError::Invalid("invalid personal manual record".into()));
        }
        let existing: Option<(u64, Option<DateTime<Utc>>, Value)> = sqlx::query_as(
            "SELECT revision,deleted_at,payload_json FROM personal_manual_records WHERE user_id=? AND record_kind=? AND record_id=? FOR UPDATE",
        ).bind(user_id.to_string()).bind(&record.kind).bind(&record.id).fetch_optional(&mut *transaction).await?;
        if let Some((revision, deleted_at, payload)) = existing {
            let unchanged = deleted_at.is_some() == record.deleted && payload == record.payload;
            if unchanged {
                continue;
            }
            if revision != record.base_revision {
                if !record.deleted && record.kind == "game" {
                    let copy_id = Uuid::new_v4().to_string();
                    let mut copy = record.payload;
                    let title = copy
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("本地棋谱")
                        .to_owned();
                    copy["id"] = Value::String(copy_id.clone());
                    copy["title"] = Value::String(format!("{title}（冲突副本）"));
                    sqlx::query("INSERT INTO personal_manual_records (user_id,record_kind,record_id,revision,deleted_at,payload_json,updated_at) VALUES (?,?,?,1,NULL,?,UTC_TIMESTAMP(6))")
                        .bind(user_id.to_string()).bind(&record.kind).bind(copy_id).bind(copy).execute(&mut *transaction).await?;
                }
                conflicts += 1;
                continue;
            }
            sqlx::query("UPDATE personal_manual_records SET revision=?,deleted_at=IF(?,UTC_TIMESTAMP(6),NULL),payload_json=?,updated_at=UTC_TIMESTAMP(6) WHERE user_id=? AND record_kind=? AND record_id=?")
                .bind(revision + 1).bind(record.deleted).bind(record.payload).bind(user_id.to_string()).bind(&record.kind).bind(&record.id).execute(&mut *transaction).await?;
        } else {
            sqlx::query("INSERT INTO personal_manual_records (user_id,record_kind,record_id,revision,deleted_at,payload_json,updated_at) VALUES (?,?,?,1,IF(?,UTC_TIMESTAMP(6),NULL),?,UTC_TIMESTAMP(6))")
                .bind(user_id.to_string()).bind(&record.kind).bind(&record.id).bind(record.deleted).bind(record.payload).execute(&mut *transaction).await?;
        }
    }
    let rows: Vec<(String, String, u64, Option<DateTime<Utc>>, Value, DateTime<Utc>)> = sqlx::query_as(
        "SELECT record_kind,record_id,revision,deleted_at,payload_json,updated_at FROM personal_manual_records WHERE user_id=? ORDER BY updated_at,record_kind,record_id",
    ).bind(user_id.to_string()).fetch_all(&mut *transaction).await?;
    let game_count = rows
        .iter()
        .filter(|(kind, _, _, deleted_at, _, _)| kind == "game" && deleted_at.is_none())
        .count() as u64;
    let folder_count = rows
        .iter()
        .filter(|(kind, _, _, deleted_at, _, _)| kind == "folder" && deleted_at.is_none())
        .count() as u64;
    let analysis_count = rows
        .iter()
        .filter(|(kind, _, _, deleted_at, _, _)| kind == "analysis" && deleted_at.is_none())
        .count() as u64;
    sqlx::query("INSERT INTO personal_manual_sync_status (user_id,last_synced_at,game_count,folder_count,analysis_count,conflict_count) VALUES (?,UTC_TIMESTAMP(6),?,?,?,?,?) ON DUPLICATE KEY UPDATE last_synced_at=VALUES(last_synced_at),game_count=VALUES(game_count),folder_count=VALUES(folder_count),analysis_count=VALUES(analysis_count),conflict_count=VALUES(conflict_count)")
        .bind(user_id.to_string()).bind(game_count).bind(folder_count).bind(analysis_count).bind(conflicts as u64).execute(&mut *transaction).await?;
    let status = read_status(&mut *transaction, user_id).await?;
    transaction.commit().await?;
    Ok(Json(SyncResponse {
        conflict_count: conflicts,
        status,
        records: rows
            .into_iter()
            .map(
                |(kind, id, revision, deleted_at, payload, updated_at)| SyncRecordDto {
                    kind,
                    id,
                    revision,
                    deleted: deleted_at.is_some(),
                    payload,
                    updated_at,
                },
            )
            .collect(),
    }))
}

pub(crate) async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PersonalManualSyncStatus>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    Ok(Json(read_status(&state.pool, user_id).await?))
}

pub(crate) async fn publish_provider_imports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ProviderImportsRequest>,
) -> Result<Json<ProviderImportPublishResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    validate_provider_import_request(&request)?;
    let acknowledged = provider_import_acknowledgements(&request);
    let mut transaction = state.pool.begin().await?;
    for record in request.records {
        let existing: Option<(String, u64)> = sqlx::query_as(
            "SELECT payload_hash,revision FROM personal_provider_imports
             WHERE user_id=? AND provider=? AND external_id=? FOR UPDATE",
        )
        .bind(user_id.to_string())
        .bind(&request.provider)
        .bind(&record.external_id)
        .fetch_optional(&mut *transaction)
        .await?;
        match provider_import_write(
            existing
                .as_ref()
                .map(|(payload_hash, revision)| (payload_hash.as_str(), *revision)),
            &record.payload_hash,
        ) {
            ProviderImportWrite::Unchanged => {}
            ProviderImportWrite::Update { revision } => {
                sqlx::query(
                    "UPDATE personal_provider_imports
                     SET payload_hash=?,revision=?,snapshot_json=?,updated_at=UTC_TIMESTAMP(6)
                     WHERE user_id=? AND provider=? AND external_id=?",
                )
                .bind(&record.payload_hash)
                .bind(revision)
                .bind(record.snapshot)
                .bind(user_id.to_string())
                .bind(&request.provider)
                .bind(&record.external_id)
                .execute(&mut *transaction)
                .await?;
            }
            ProviderImportWrite::Insert => {
                sqlx::query(
                    "INSERT INTO personal_provider_imports
                     (user_id,provider,external_id,payload_hash,revision,snapshot_json,created_at,updated_at)
                     VALUES (?,?,?,?,1,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",
                )
                .bind(user_id.to_string())
                .bind(&request.provider)
                .bind(&record.external_id)
                .bind(&record.payload_hash)
                .bind(record.snapshot)
                .execute(&mut *transaction)
                .await?;
            }
        }
    }
    transaction.commit().await?;
    Ok(Json(ProviderImportPublishResponse {
        records: acknowledged,
    }))
}

pub(crate) async fn list_provider_imports(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ProviderImportsResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    Ok(Json(ProviderImportsResponse {
        records: read_provider_imports(&state.pool, user_id).await?,
    }))
}

async fn read_provider_imports<'e, E>(
    executor: E,
    user_id: Uuid,
) -> Result<Vec<ProviderImportDto>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::MySql>,
{
    let rows: Vec<(String, String, String, u64, Value, DateTime<Utc>)> = sqlx::query_as(
        "SELECT provider,external_id,payload_hash,revision,snapshot_json,updated_at
         FROM personal_provider_imports WHERE user_id=? ORDER BY updated_at,provider,external_id",
    )
    .bind(user_id.to_string())
    .fetch_all(executor)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(provider, external_id, payload_hash, revision, snapshot, updated_at)| {
                ProviderImportDto {
                    provider,
                    external_id,
                    payload_hash,
                    revision,
                    snapshot,
                    updated_at,
                }
            },
        )
        .collect())
}

fn validate_provider_import_request(request: &ProviderImportsRequest) -> Result<(), ApiError> {
    if request.provider != "ttxq" || request.records.len() > 50 {
        return Err(ApiError::Invalid("invalid provider import batch".into()));
    }
    for record in &request.records {
        let expected_id = format!("ttxq:{}", record.external_id);
        let origin = record.snapshot.get("origin");
        let valid = !record.external_id.trim().is_empty()
            && record.external_id.len() <= 191
            && !record.payload_hash.trim().is_empty()
            && record.payload_hash.len() <= 191
            && record.snapshot.is_object()
            && record.snapshot.get("id").and_then(Value::as_str) == Some(expected_id.as_str())
            && record.snapshot.get("readOnly").and_then(Value::as_bool) == Some(true)
            && origin
                .and_then(|value| value.get("kind"))
                .and_then(Value::as_str)
                == Some("providerMirror")
            && origin
                .and_then(|value| value.get("provider"))
                .and_then(Value::as_str)
                == Some("ttxq")
            && origin
                .and_then(|value| value.get("externalId"))
                .and_then(Value::as_str)
                == Some(record.external_id.as_str())
            && origin
                .and_then(|value| value.get("payloadHash"))
                .and_then(Value::as_str)
                == Some(record.payload_hash.as_str());
        if !valid {
            return Err(ApiError::Invalid("invalid provider import record".into()));
        }
    }
    Ok(())
}

async fn read_status<'e, E>(
    executor: E,
    user_id: Uuid,
) -> Result<PersonalManualSyncStatus, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::MySql>,
{
    let row: Option<(DateTime<Utc>, u64, u64, u64, u64)> = sqlx::query_as(
        "SELECT last_synced_at,game_count,folder_count,analysis_count,conflict_count FROM personal_manual_sync_status WHERE user_id=?",
    )
    .bind(user_id.to_string())
    .fetch_optional(executor)
    .await?;
    Ok(row
        .map(
            |(last_synced_at, game_count, folder_count, analysis_count, conflict_count)| {
                PersonalManualSyncStatus {
                    last_synced_at: Some(last_synced_at),
                    game_count,
                    folder_count,
                    analysis_count,
                    conflict_count,
                }
            },
        )
        .unwrap_or(PersonalManualSyncStatus {
            last_synced_at: None,
            game_count: 0,
            folder_count: 0,
            analysis_count: 0,
            conflict_count: 0,
        }))
}

fn valid_payload(record: &SyncRecordRequest) -> bool {
    let Some(payload) = record.payload.as_object() else {
        return false;
    };
    match record.kind.as_str() {
        "game" => payload.get("id").and_then(Value::as_str) == Some(record.id.as_str()),
        "folder" => payload.get("path").and_then(Value::as_str) == Some(record.id.as_str()),
        "analysis" => {
            let game_id = payload.get("gameId").and_then(Value::as_str);
            let node_id = payload.get("nodeId").and_then(Value::as_str);
            matches!((game_id, node_id), (Some(game_id), Some(node_id)) if format!("{game_id}:{node_id}") == record.id)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(provider: &str, count: usize) -> ProviderImportsRequest {
        ProviderImportsRequest {
            provider: provider.into(),
            records: (0..count)
                .map(|index| {
                    let external_id = format!("7788{index:02}");
                    let payload_hash = format!("sha256:{index}");
                    ProviderImportRequest {
                        snapshot: json!({
                            "id": format!("ttxq:{external_id}"),
                            "readOnly": true,
                            "origin": {
                                "kind": "providerMirror",
                                "provider": "ttxq",
                                "externalId": external_id,
                                "payloadHash": payload_hash,
                            }
                        }),
                        external_id,
                        payload_hash,
                    }
                })
                .collect(),
        }
    }

    #[test]
    fn provider_import_validation_accepts_bounded_read_only_ttxq_snapshots() {
        assert!(validate_provider_import_request(&request("ttxq", 50)).is_ok());
    }

    #[test]
    fn provider_import_validation_rejects_wrong_provider_size_and_editable_payloads() {
        assert!(validate_provider_import_request(&request("other", 1)).is_err());
        assert!(validate_provider_import_request(&request("ttxq", 51)).is_err());
        let mut editable = request("ttxq", 1);
        editable.records[0].snapshot["readOnly"] = Value::Bool(false);
        assert!(validate_provider_import_request(&editable).is_err());
    }

    #[test]
    fn provider_import_write_is_idempotent_and_only_revises_changed_payloads() {
        assert_eq!(
            provider_import_write(Some(("sha256:same", 4)), "sha256:same"),
            ProviderImportWrite::Unchanged
        );
        assert_eq!(
            provider_import_write(Some(("sha256:old", 4)), "sha256:new"),
            ProviderImportWrite::Update { revision: 5 }
        );
        assert_eq!(
            provider_import_write(None, "sha256:new"),
            ProviderImportWrite::Insert
        );
    }

    #[test]
    fn provider_import_storage_is_isolated_by_user_provider_and_external_id() {
        let migration = include_str!("../migrations/0005_personal_manual_sync.sql");
        assert!(migration.contains("PRIMARY KEY (user_id, provider, external_id)"));
    }

    #[test]
    fn provider_import_publish_acknowledges_only_the_current_batch_without_snapshots() {
        let request = request("ttxq", 2);
        let response = ProviderImportPublishResponse {
            records: provider_import_acknowledgements(&request),
        };
        let json = serde_json::to_value(response).unwrap();
        assert_eq!(json["records"].as_array().unwrap().len(), 2);
        assert_eq!(json["records"][0]["externalId"], "778800");
        assert!(json["records"][0].get("snapshot").is_none());
    }
}
