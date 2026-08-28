use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use chrono::Utc;
use serde::Deserialize;
use sqlx::{MySql, Transaction};
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteGamePayload, DeleteNodePayload, Operation, OperationKind, PullResponse,
    PushRequest, PushResponse, ReorderBranchesPayload, SequencedOperation, SetMainlinePayload,
    UpdateCommentPayload, UpdateGameMetadataPayload,
};
use uuid::Uuid;

use crate::auth::{authenticated_user, parse_uuid};
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub(crate) struct PullQuery {
    cursor: Option<u64>,
    limit: Option<u32>,
}
pub(crate) async fn push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    if request.operations.len() > 500 {
        return Err(ApiError::Invalid("at most 500 operations per push".into()));
    }
    let mut transaction = state.pool.begin().await?;
    let mut accepted = Vec::with_capacity(request.operations.len());
    for operation in &request.operations {
        persist_operation(&mut transaction, user_id, operation).await?;
        accepted.push(operation.op_id);
    }
    let cursor: i64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(MAX(sequence_id), 0) AS SIGNED) FROM operations WHERE user_id = ?",
    )
    .bind(user_id.to_string())
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(PushResponse {
        accepted,
        cursor: cursor as u64,
    }))
}

pub(crate) async fn pull(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state.jwt_secret)?;
    let cursor = query.cursor.unwrap_or(0);
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    type OperationRow = (
        u64,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        u64,
        chrono::DateTime<Utc>,
    );
    let rows: Vec<OperationRow> = sqlx::query_as(
        "SELECT sequence_id, op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at
         FROM operations WHERE user_id = ? AND sequence_id > ? ORDER BY sequence_id LIMIT ?",
    ).bind(user_id.to_string()).bind(cursor as i64).bind(limit).fetch_all(&state.pool).await?;
    let mut operations = Vec::with_capacity(rows.len());
    for (sequence, op_id, device_id, entity_id, game_id, kind, payload, lamport, created_at) in rows
    {
        operations.push(SequencedOperation {
            sequence,
            operation: Operation {
                op_id: parse_uuid(op_id)?,
                device_id: parse_uuid(device_id)?,
                entity_id: parse_uuid(entity_id)?,
                game_id: parse_uuid(game_id)?,
                kind: serde_json::from_value(serde_json::Value::String(kind))
                    .map_err(|_| ApiError::Internal)?,
                payload,
                lamport,
                created_at,
            },
        });
    }
    let next_cursor = operations
        .last()
        .map(|item| item.sequence)
        .unwrap_or(cursor);
    Ok(Json(PullResponse {
        operations,
        cursor: next_cursor,
    }))
}

pub(crate) async fn persist_operation(
    transaction: &mut Transaction<'_, MySql>,
    user_id: Uuid,
    operation: &Operation,
) -> Result<(), ApiError> {
    validate_operation(operation)?;
    let kind = serde_json::to_value(operation.kind)
        .map_err(|_| ApiError::Internal)?
        .as_str()
        .ok_or(ApiError::Internal)?
        .to_owned();
    let external_source = if matches!(operation.kind, OperationKind::CreateGame) {
        let payload: CreateGamePayload = serde_json::from_value(operation.payload.clone())
            .map_err(|_| ApiError::Invalid("invalid create-game payload".into()))?;
        sqlx::query("INSERT IGNORE INTO games (id, owner_id, title) VALUES (?, ?, ?)")
            .bind(operation.game_id.to_string())
            .bind(user_id.to_string())
            .bind(payload.title)
            .execute(&mut **transaction)
            .await?;
        payload.external_source
    } else {
        None
    };
    let owns_game: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM games WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
    )
    .bind(operation.game_id.to_string())
    .bind(user_id.to_string())
    .fetch_one(&mut **transaction)
    .await?;
    if owns_game == 0 {
        return Err(ApiError::Invalid(
            "operation references an unavailable game".into(),
        ));
    }
    if let Some(source) = external_source {
        sqlx::query(
            "INSERT INTO external_game_sources
             (owner_id, provider, external_id, game_id, source_format, payload_hash, imported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                game_id=VALUES(game_id), source_format=VALUES(source_format),
                payload_hash=VALUES(payload_hash), imported_at=VALUES(imported_at)",
        )
        .bind(user_id.to_string())
        .bind(source.provider)
        .bind(source.external_id)
        .bind(operation.game_id.to_string())
        .bind(source.source_format)
        .bind(source.payload_hash)
        .bind(source.imported_at)
        .execute(&mut **transaction)
        .await?;
    }
    if matches!(operation.kind, OperationKind::DeleteGame) {
        sqlx::query("UPDATE games SET deleted_at = NOW() WHERE id = ? AND owner_id = ?")
            .bind(operation.game_id.to_string())
            .bind(user_id.to_string())
            .execute(&mut **transaction)
            .await?;
        sqlx::query("DELETE FROM external_game_sources WHERE owner_id = ? AND game_id = ?")
            .bind(user_id.to_string())
            .bind(operation.game_id.to_string())
            .execute(&mut **transaction)
            .await?;
    }
    sqlx::query(
        "INSERT IGNORE INTO operations (op_id, user_id, device_id, entity_id, game_id, kind, payload, lamport, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(operation.op_id.to_string()).bind(user_id.to_string()).bind(operation.device_id.to_string())
        .bind(operation.entity_id.to_string()).bind(operation.game_id.to_string()).bind(kind).bind(&operation.payload)
        .bind(operation.lamport as i64).bind(operation.created_at).execute(&mut **transaction).await?;
    Ok(())
}

pub(crate) fn validate_operation(operation: &Operation) -> Result<(), ApiError> {
    let entity_matches = match operation.kind {
        OperationKind::CreateGame => {
            let payload = serde_json::from_value::<CreateGamePayload>(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid create-game payload".into()))?;
            if let Some(source) = payload.external_source {
                let valid = !source.provider.trim().is_empty()
                    && source.provider.len() <= 64
                    && !source.external_id.trim().is_empty()
                    && source.external_id.len() <= 191
                    && !source.source_format.trim().is_empty()
                    && source.source_format.len() <= 64
                    && source.payload_hash.starts_with("sha256:")
                    && source.payload_hash.len() <= 80
                    && source.imported_at.len() <= 40;
                if !valid {
                    return Err(ApiError::Invalid("invalid external game source".into()));
                }
            }
            operation.entity_id == operation.game_id
        }
        OperationKind::AddMove => {
            let payload: AddMovePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid add-move payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::UpdateComment => {
            let payload: UpdateCommentPayload =
                serde_json::from_value(operation.payload.clone())
                    .map_err(|_| ApiError::Invalid("invalid update-comment payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::UpdateGameMetadata => {
            serde_json::from_value::<UpdateGameMetadataPayload>(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid game-metadata payload".into()))?;
            operation.entity_id == operation.game_id
        }
        OperationKind::ReorderBranches => {
            let payload: ReorderBranchesPayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid branch-order payload".into()))?;
            payload.parent_id == operation.entity_id
        }
        OperationKind::SetMainline => {
            let payload: SetMainlinePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid set-mainline payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::DeleteNode => {
            let payload: DeleteNodePayload = serde_json::from_value(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid delete-node payload".into()))?;
            payload.node_id == operation.entity_id
        }
        OperationKind::DeleteGame => {
            serde_json::from_value::<DeleteGamePayload>(operation.payload.clone())
                .map_err(|_| ApiError::Invalid("invalid delete-game payload".into()))?;
            operation.entity_id == operation.game_id
        }
        OperationKind::Unknown => {
            return Err(ApiError::Invalid("unknown operation kind".into()));
        }
    };
    if !entity_matches {
        return Err(ApiError::Invalid(
            "operation entity does not match its payload".into(),
        ));
    }
    Ok(())
}
