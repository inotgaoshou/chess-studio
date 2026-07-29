use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Operation {
    #[serde(alias = "opId")]
    pub op_id: Uuid,
    #[serde(alias = "deviceId")]
    pub device_id: Uuid,
    #[serde(alias = "entityId")]
    pub entity_id: Uuid,
    #[serde(alias = "gameId")]
    pub game_id: Uuid,
    pub kind: OperationKind,
    pub payload: Value,
    pub lamport: u64,
    #[serde(alias = "createdAt")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    CreateGame,
    AddMove,
    UpdateComment,
    UpdateGameMetadata,
    ReorderBranches,
    SetMainline,
    DeleteNode,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateGamePayload {
    pub title: String,
    pub fen: String,
    pub root_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddMovePayload {
    pub node_id: Uuid,
    pub parent_id: Uuid,
    #[serde(rename = "move")]
    pub move_iccs: String,
    #[serde(default)]
    pub order_key: u64,
    #[serde(default)]
    pub is_mainline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommentPayload {
    pub node_id: Uuid,
    pub comment: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGameMetadataPayload {
    pub title: String,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub red: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub black: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReorderBranchesPayload {
    pub parent_id: Uuid,
    pub node_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetMainlinePayload {
    pub parent_id: Uuid,
    pub node_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNodePayload {
    pub node_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRequest {
    pub operations: Vec<Operation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    pub accepted: Vec<Uuid>,
    pub cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencedOperation {
    pub sequence: u64,
    pub operation: Operation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    pub operations: Vec<SequencedOperation>,
    pub cursor: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_wire_format_remains_compatible_and_accepts_browser_fields() {
        let operation = Operation {
            op_id: Uuid::nil(),
            device_id: Uuid::nil(),
            entity_id: Uuid::nil(),
            game_id: Uuid::nil(),
            kind: OperationKind::CreateGame,
            payload: serde_json::json!({}),
            lamport: 1,
            created_at: Utc::now(),
        };
        let value = serde_json::to_value(&operation).unwrap();
        assert!(value.get("op_id").is_some());
        assert!(value.get("game_id").is_some());
        assert!(value.get("created_at").is_some());

        let browser_value = serde_json::json!({
            "opId": operation.op_id,
            "deviceId": operation.device_id,
            "entityId": operation.entity_id,
            "gameId": operation.game_id,
            "kind": "create_game",
            "payload": {},
            "lamport": 1,
            "createdAt": operation.created_at,
        });
        assert_eq!(
            serde_json::from_value::<Operation>(browser_value).unwrap(),
            operation
        );
    }

    #[test]
    fn branch_order_and_game_metadata_use_stable_camel_case_payloads() {
        let parent_id = Uuid::new_v4();
        let node_ids = vec![Uuid::new_v4(), Uuid::new_v4()];
        assert_eq!(
            serde_json::to_value(ReorderBranchesPayload {
                parent_id,
                node_ids: node_ids.clone()
            })
            .unwrap(),
            serde_json::json!({ "parentId": parent_id, "nodeIds": node_ids })
        );
        assert_eq!(
            serde_json::to_value(UpdateGameMetadataPayload {
                title: "残局".into(),
                note: "红先".into(),
                ..UpdateGameMetadataPayload::default()
            })
            .unwrap(),
            serde_json::json!({ "title": "残局", "note": "红先" })
        );
    }

    #[test]
    fn unknown_operation_kinds_can_be_skipped_by_newer_clients() {
        let value = serde_json::json!({
            "op_id": Uuid::new_v4(),
            "device_id": Uuid::new_v4(),
            "entity_id": Uuid::new_v4(),
            "game_id": Uuid::new_v4(),
            "kind": "future_operation",
            "payload": {},
            "lamport": 2,
            "created_at": Utc::now(),
        });
        assert_eq!(
            serde_json::from_value::<Operation>(value).unwrap().kind,
            OperationKind::Unknown
        );
    }
}
