use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Operation {
    pub op_id: Uuid,
    pub device_id: Uuid,
    pub entity_id: Uuid,
    pub game_id: Uuid,
    pub kind: OperationKind,
    pub payload: Value,
    pub lamport: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    CreateGame,
    AddMove,
    UpdateComment,
    SetMainline,
    DeleteNode,
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
