use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use std::collections::HashSet;
use uuid::Uuid;

use crate::auth::is_vip_active;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Clone)]
struct CurrentUser {
    id: Uuid,
    role: String,
    org_id: Uuid,
    is_platform_admin: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PageQuery {
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishAssignmentQuery {
    allow_duplicate: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeachingStudentDto {
    id: Uuid,
    login_name: String,
    email: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeachingClassDto {
    id: Uuid,
    name: String,
    student_count: u32,
    students: Vec<TeachingStudentDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationDto {
    id: Uuid,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationJoinRequestDto {
    id: Uuid,
    org_id: Uuid,
    org_name: String,
    applicant_id: Uuid,
    applicant_role: String,
    applicant_login_name: String,
    applicant_display_name: String,
    status: String,
    note: Option<String>,
    review_note: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListOrganizationsQuery {
    q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateOrganizationJoinRequest {
    org_id: Uuid,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewOrganizationJoinRequest {
    status: String,
    review_note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeachingAssignmentDto {
    id: Uuid,
    title: String,
    status: String,
    due_at: Option<DateTime<Utc>>,
    item_count: u32,
    target_count: u32,
    completed_count: u32,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignmentProblemDto {
    assignment_id: Uuid,
    problem_id: Uuid,
    title: String,
    category: String,
    starting_fen: String,
    note: String,
    access_tier: String,
    solution: serde_json::Value,
    completed: bool,
    attempt_count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAssignmentRequest {
    title: String,
    due_at: Option<DateTime<Utc>>,
    problems: Vec<CreateAssignmentProblem>,
    target_student_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAssignmentProblem {
    title: String,
    category: String,
    starting_fen: String,
    note: String,
    solution: serde_json::Value,
    access_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmitAttemptRequest {
    client_attempt_id: Uuid,
    assignment_id: Uuid,
    problem_id: Uuid,
    elapsed_ms: u32,
    hints_used: u32,
    mistakes: u32,
    moves: Vec<String>,
    outcome: String,
    completed_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmitAttemptResponse {
    accepted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignmentResultsDto {
    assignment: TeachingAssignmentDto,
    students: Vec<TeachingStudentDto>,
    problems: Vec<AssignmentProblemSummaryDto>,
    results: Vec<AssignmentResultDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminAssignmentResultDto {
    student_id: Uuid,
    login_name: String,
    display_name: String,
    total_count: u32,
    completed_count: u32,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignmentProblemSummaryDto {
    id: Uuid,
    title: String,
    category: String,
    order: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignmentResultDto {
    student_id: Uuid,
    problem_id: Uuid,
    attempt_count: u32,
    completed: bool,
    elapsed_ms: Option<u32>,
    hints_used: Option<u32>,
    mistakes: Option<u32>,
    outcome: Option<String>,
    submitted_at: Option<DateTime<Utc>>,
}

pub(crate) async fn migrate_teaching_schema(pool: &MySqlPool) -> Result<(), sqlx::Error> {
    add_column(
        pool,
        "users",
        "login_name",
        "ALTER TABLE users ADD COLUMN login_name VARCHAR(320) NULL COMMENT '教学登录名/学号'",
    )
    .await?;
    add_column(
        pool,
        "users",
        "display_name",
        "ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL COMMENT '教学显示名'",
    )
    .await?;
    add_column(
        pool,
        "users",
        "role",
        "ALTER TABLE users ADD COLUMN role VARCHAR(24) NOT NULL DEFAULT 'user' COMMENT 'user/student/coach/admin'",
    )
    .await?;
    add_column(
        pool,
        "users",
        "org_id",
        "ALTER TABLE users ADD COLUMN org_id CHAR(36) NULL COMMENT '当前教学机构'",
    )
    .await?;
    add_column(
        pool,
        "users",
        "is_platform_admin",
        "ALTER TABLE users ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0",
    )
    .await?;
    add_column(
        pool,
        "users",
        "auth_version",
        "ALTER TABLE users ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 1",
    )
    .await?;
    add_column(
        pool,
        "users",
        "vip_enabled",
        "ALTER TABLE users ADD COLUMN vip_enabled TINYINT(1) NOT NULL DEFAULT 0",
    )
    .await?;
    add_column(
        pool,
        "users",
        "vip_expires_at",
        "ALTER TABLE users ADD COLUMN vip_expires_at DATETIME(6) NULL",
    )
    .await?;
    sqlx::query("UPDATE users SET login_name = email WHERE login_name IS NULL OR login_name = ''")
        .execute(pool)
        .await?;
    sqlx::query(
        "UPDATE users SET display_name = SUBSTRING_INDEX(email, '@', 1) WHERE display_name IS NULL OR display_name = ''",
    )
    .execute(pool)
    .await?;
    add_index(
        pool,
        "users",
        "uk_users_login_name",
        "CREATE UNIQUE INDEX uk_users_login_name ON users(login_name)",
    )
    .await?;
    sqlx::raw_sql(
        r#"
CREATE TABLE IF NOT EXISTS organizations (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端教学机构';

CREATE TABLE IF NOT EXISTS user_organization_memberships (
  user_id CHAR(36) NOT NULL,
  org_id CHAR(36) NOT NULL,
  role VARCHAR(24) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, org_id),
  KEY idx_mobile_membership_org_role (org_id, role, user_id),
  CONSTRAINT fk_mobile_membership_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_mobile_membership_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端教学机构成员';

CREATE TABLE IF NOT EXISTS organization_join_requests (
  id CHAR(36) PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  applicant_id CHAR(36) NOT NULL,
  applicant_role VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  note VARCHAR(500) NULL,
  review_note VARCHAR(500) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_mobile_join_requests_applicant (applicant_id, created_at),
  KEY idx_mobile_join_requests_org_status (org_id, status, created_at),
  CONSTRAINT fk_mobile_join_requests_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_mobile_join_requests_applicant FOREIGN KEY (applicant_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端教学机构加入申请';

CREATE TABLE IF NOT EXISTS classes (
  id CHAR(36) PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_mobile_class_org_name (org_id, name),
  KEY idx_mobile_class_org (org_id, created_at),
  CONSTRAINT fk_mobile_class_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端教学班级';

CREATE TABLE IF NOT EXISTS class_students (
  class_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  PRIMARY KEY (class_id, student_id),
  KEY idx_mobile_class_students_student (student_id, class_id),
  CONSTRAINT fk_mobile_class_students_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_mobile_class_students_user FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端班级学生';

CREATE TABLE IF NOT EXISTS class_coaches (
  class_id CHAR(36) NOT NULL,
  coach_id CHAR(36) NOT NULL,
  PRIMARY KEY (class_id, coach_id),
  KEY idx_mobile_class_coaches_coach (coach_id, class_id),
  CONSTRAINT fk_mobile_class_coaches_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_mobile_class_coaches_user FOREIGN KEY (coach_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='移动端班级老师';

INSERT IGNORE INTO organizations (id, name)
VALUES (UUID(), '象棋工作室');
UPDATE users
SET org_id=(SELECT id FROM organizations ORDER BY created_at LIMIT 1)
WHERE org_id IS NULL AND (role IN ('student','coach','admin') OR is_platform_admin=1);
INSERT IGNORE INTO user_organization_memberships (user_id, org_id, role, is_default)
SELECT id, org_id, CASE WHEN is_platform_admin=1 THEN 'admin' ELSE role END, 1
FROM users
WHERE org_id IS NOT NULL AND deleted_at IS NULL
  AND (role IN ('student','coach','admin') OR is_platform_admin=1);
UPDATE user_organization_memberships membership
JOIN users user ON user.id=membership.user_id
SET membership.role='admin', membership.is_default=1
WHERE user.is_platform_admin=1 AND user.deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS teaching_assignments (
  id CHAR(36) PRIMARY KEY,
  teacher_id CHAR(36) NOT NULL,
  org_id CHAR(36) NULL,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'published',
  due_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  closed_at TIMESTAMP(6) NULL,
  KEY idx_teaching_assignments_teacher (teacher_id, created_at),
  KEY idx_teaching_assignments_org (org_id, created_at),
  CONSTRAINT fk_teaching_assignments_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教学作业';

CREATE TABLE IF NOT EXISTS teaching_assignment_problems (
  id CHAR(36) PRIMARY KEY,
  assignment_id CHAR(36) NOT NULL,
  problem_order INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  starting_fen VARCHAR(255) NOT NULL,
  note TEXT NOT NULL,
  access_tier VARCHAR(16) NOT NULL DEFAULT 'public',
  solution_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_teaching_problem_order (assignment_id, problem_order),
  KEY idx_teaching_problems_assignment (assignment_id),
  CONSTRAINT fk_teaching_problems_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教学作业题目快照';

CREATE TABLE IF NOT EXISTS teaching_assignment_targets (
  assignment_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  assigned_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (assignment_id, student_id),
  KEY idx_teaching_targets_student (student_id, assigned_at),
  CONSTRAINT fk_teaching_targets_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id),
  CONSTRAINT fk_teaching_targets_student FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教学作业学生目标';

CREATE TABLE IF NOT EXISTS teaching_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_attempt_id CHAR(36) NOT NULL UNIQUE,
  assignment_id CHAR(36) NOT NULL,
  problem_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  elapsed_ms INT UNSIGNED NOT NULL,
  hints_used INT UNSIGNED NOT NULL,
  mistakes INT UNSIGNED NOT NULL,
  moves_json JSON NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  completed_at TIMESTAMP(6) NOT NULL,
  received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_teaching_attempts_assignment (assignment_id, received_at),
  KEY idx_teaching_attempts_student (student_id, received_at),
  KEY idx_teaching_attempts_problem (problem_id, student_id),
  CONSTRAINT fk_teaching_attempts_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id),
  CONSTRAINT fk_teaching_attempts_problem FOREIGN KEY (problem_id) REFERENCES teaching_assignment_problems(id),
  CONSTRAINT fk_teaching_attempts_student FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教学作业提交';
"#,
    )
    .execute(pool)
    .await?;
    add_column(
        pool,
        "teaching_assignments",
        "org_id",
        "ALTER TABLE teaching_assignments ADD COLUMN org_id CHAR(36) NULL AFTER teacher_id",
    )
    .await?;
    add_column(
        pool,
        "teaching_assignment_problems",
        "access_tier",
        "ALTER TABLE teaching_assignment_problems ADD COLUMN access_tier VARCHAR(16) NOT NULL DEFAULT 'public' AFTER note",
    )
    .await?;
    sqlx::query(
        "UPDATE teaching_assignments assignment
         JOIN users teacher ON teacher.id=assignment.teacher_id
         SET assignment.org_id=teacher.org_id
         WHERE assignment.org_id IS NULL",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn list_student_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<Page<TeachingAssignmentDto>>, ApiError> {
    let user = current_user(&state, &headers).await?;
    let vip_active = student_vip_active(&state.pool, user.id).await?;
    let (offset, limit) = page_window(&query);
    type Row = (
        String,
        String,
        String,
        Option<DateTime<Utc>>,
        u64,
        u64,
        u64,
        DateTime<Utc>,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT a.id, a.title, a.status, a.due_at,
          COUNT(DISTINCT p.id) AS item_count,
          COUNT(DISTINCT t.student_id) AS target_count,
          COUNT(DISTINCT CASE WHEN ta.outcome='completed' THEN ta.problem_id END) AS completed_count,
          a.created_at
         FROM teaching_assignments a
         JOIN teaching_assignment_targets t ON t.assignment_id=a.id AND t.student_id=?
         LEFT JOIN teaching_assignment_problems p ON p.assignment_id=a.id
         LEFT JOIN teaching_attempts ta ON ta.assignment_id=a.id AND ta.student_id=?
         WHERE a.status='published' AND a.org_id=?
           AND (? OR NOT EXISTS (
             SELECT 1 FROM teaching_assignment_problems vip_problem
             WHERE vip_problem.assignment_id=a.id AND vip_problem.access_tier='vip'
           ))
         GROUP BY a.id
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?",
    )
    .bind(user.id.to_string())
    .bind(user.id.to_string())
    .bind(user.org_id.to_string())
    .bind(vip_active)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(page_from_rows(
        rows,
        offset,
        limit,
        assignment_from_row,
    )))
}

pub(crate) async fn list_organizations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListOrganizationsQuery>,
) -> Result<Json<Vec<OrganizationDto>>, ApiError> {
    let _user_id = crate::auth::authenticated_user(&headers, &state.jwt_secret)?;
    let pattern = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));
    let rows: Vec<(String, String)> = if let Some(pattern) = pattern {
        sqlx::query_as("SELECT id,name FROM organizations WHERE name LIKE ? ORDER BY name,id")
            .bind(pattern)
            .fetch_all(&state.pool)
            .await?
    } else {
        sqlx::query_as("SELECT id,name FROM organizations ORDER BY name,id")
            .fetch_all(&state.pool)
            .await?
    };
    rows.into_iter()
        .map(|(id, name)| {
            Ok(OrganizationDto {
                id: parse_uuid(&id),
                name,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()
        .map(Json)
}

pub(crate) async fn list_organization_join_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<OrganizationJoinRequestDto>>, ApiError> {
    let user_id = crate::auth::authenticated_user(&headers, &state.jwt_secret)?;
    let account: Option<(i8, Option<String>)> = sqlx::query_as(
        "SELECT is_platform_admin,org_id FROM users WHERE id=? AND deleted_at IS NULL",
    )
    .bind(user_id.to_string())
    .fetch_optional(&state.pool)
    .await?;
    let Some((is_platform_admin, org_id)) = account else {
        return Err(ApiError::Unauthorized);
    };
    let org_id = org_id.map(|value| parse_uuid(&value));
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
    )> = if is_platform_admin != 0 {
        sqlx::query_as(
            "SELECT request.id,request.org_id,org.name,request.applicant_id,
                    request.applicant_role,user.login_name,user.display_name,
                    request.status,request.note,request.review_note,request.created_at
             FROM organization_join_requests request
             JOIN organizations org ON org.id=request.org_id
             JOIN users user ON user.id=request.applicant_id
             ORDER BY request.created_at DESC,request.id DESC",
        )
        .fetch_all(&state.pool)
        .await?
    } else if let Some(org_id) = org_id {
        let admin_scope: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM user_organization_memberships
             WHERE user_id=? AND org_id=? AND role='admin'",
        )
        .bind(user_id.to_string())
        .bind(org_id.to_string())
        .fetch_optional(&state.pool)
        .await?;
        if admin_scope.is_some() {
            sqlx::query_as(
                "SELECT request.id,request.org_id,org.name,request.applicant_id,
                    request.applicant_role,user.login_name,user.display_name,
                    request.status,request.note,request.review_note,request.created_at
                 FROM organization_join_requests request
                 JOIN organizations org ON org.id=request.org_id
                 JOIN users user ON user.id=request.applicant_id
                 WHERE request.org_id=?
                 ORDER BY request.created_at DESC,request.id DESC",
            )
            .bind(org_id.to_string())
            .fetch_all(&state.pool)
            .await?
        } else {
            sqlx::query_as(
                "SELECT request.id,request.org_id,org.name,request.applicant_id,
                request.applicant_role,user.login_name,user.display_name,
                request.status,request.note,request.review_note,request.created_at
                 FROM organization_join_requests request
                 JOIN organizations org ON org.id=request.org_id
                 JOIN users user ON user.id=request.applicant_id
                 WHERE request.applicant_id=?
                 ORDER BY request.created_at DESC,request.id DESC",
            )
            .bind(user_id.to_string())
            .fetch_all(&state.pool)
            .await?
        }
    } else {
        sqlx::query_as(
            "SELECT request.id,request.org_id,org.name,request.applicant_id,
                    request.applicant_role,user.login_name,user.display_name,
                    request.status,request.note,request.review_note,request.created_at
             FROM organization_join_requests request
             JOIN organizations org ON org.id=request.org_id
             JOIN users user ON user.id=request.applicant_id
             WHERE request.applicant_id=?
             ORDER BY request.created_at DESC,request.id DESC",
        )
        .bind(user_id.to_string())
        .fetch_all(&state.pool)
        .await?
    };
    rows.into_iter()
        .map(join_request_from_row)
        .collect::<Result<Vec<_>, ApiError>>()
        .map(Json)
}

pub(crate) async fn create_organization_join_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateOrganizationJoinRequest>,
) -> Result<Json<OrganizationJoinRequestDto>, ApiError> {
    let user_id = crate::auth::authenticated_user(&headers, &state.jwt_secret)?;
    let applicant: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT role,org_id FROM users WHERE id=? AND deleted_at IS NULL")
            .bind(user_id.to_string())
            .fetch_optional(&state.pool)
            .await?;
    let Some((role, org_id)) = applicant else {
        return Err(ApiError::Unauthorized);
    };
    if !matches!(role.as_str(), "coach" | "student") || org_id.is_some() {
        return Err(ApiError::Forbidden);
    }
    let organization_exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM organizations WHERE id=?")
            .bind(request.org_id.to_string())
            .fetch_optional(&state.pool)
            .await?;
    if organization_exists.is_none() {
        return Err(ApiError::Invalid("学校/机构不存在".into()));
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if note
        .as_deref()
        .is_some_and(|value| value.chars().count() > 500)
    {
        return Err(ApiError::Invalid("申请说明不能超过 500 个字符".into()));
    }
    let pending: Option<String> = sqlx::query_scalar(
        "SELECT id FROM organization_join_requests
         WHERE applicant_id=? AND org_id=? AND status='pending'
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id.to_string())
    .bind(request.org_id.to_string())
    .fetch_optional(&state.pool)
    .await?;
    let (id, already_pending) = match pending {
        Some(value) => (parse_uuid(&value), true),
        None => (Uuid::new_v4(), false),
    };
    if !already_pending {
        sqlx::query(
            "INSERT INTO organization_join_requests
             (id,org_id,applicant_id,applicant_role,note)
             VALUES (?,?,?,?,?)",
        )
        .bind(id.to_string())
        .bind(request.org_id.to_string())
        .bind(user_id.to_string())
        .bind(&role)
        .bind(note)
        .execute(&state.pool)
        .await?;
    }
    let row = load_join_request(&state.pool, id).await?;
    Ok(Json(row))
}

pub(crate) async fn review_organization_join_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<Uuid>,
    Json(request): Json<ReviewOrganizationJoinRequest>,
) -> Result<Json<OrganizationJoinRequestDto>, ApiError> {
    let reviewer = current_user(&state, &headers).await?;
    if reviewer.role != "admin" {
        return Err(ApiError::Forbidden);
    }
    let status = request.status.trim();
    if !matches!(status, "approved" | "rejected") {
        return Err(ApiError::Invalid(
            "status must be approved or rejected".into(),
        ));
    }
    let review_note = request
        .review_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if review_note
        .as_deref()
        .is_some_and(|value| value.chars().count() > 500)
    {
        return Err(ApiError::Invalid("审批说明不能超过 500 个字符".into()));
    }
    let join_request: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT org_id,applicant_id,applicant_role,status
         FROM organization_join_requests
         WHERE id=?",
    )
    .bind(request_id.to_string())
    .fetch_optional(&state.pool)
    .await?;
    let Some((org_id, applicant_id, applicant_role, current_status)) = join_request else {
        return Err(ApiError::NotFound);
    };
    let org_id = parse_uuid(&org_id);
    if !reviewer.is_platform_admin && reviewer.org_id != org_id {
        return Err(ApiError::Forbidden);
    }
    if current_status != "pending" {
        return Err(ApiError::Invalid("申请已经处理过".into()));
    }
    let applicant_id = parse_uuid(&applicant_id);
    if !matches!(applicant_role.as_str(), "student" | "coach") {
        return Err(ApiError::Invalid("申请角色无效".into()));
    }
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "UPDATE organization_join_requests
         SET status=?,review_note=?,reviewed_by=?,reviewed_at=NOW(6)
         WHERE id=? AND status='pending'",
    )
    .bind(status)
    .bind(review_note)
    .bind(reviewer.id.to_string())
    .bind(request_id.to_string())
    .execute(&mut *transaction)
    .await?;
    if status == "approved" {
        sqlx::query("UPDATE user_organization_memberships SET is_default=0 WHERE user_id=?")
            .bind(applicant_id.to_string())
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO user_organization_memberships (user_id,org_id,role,is_default)
             VALUES (?,?,?,1)
             ON DUPLICATE KEY UPDATE role=VALUES(role), is_default=1",
        )
        .bind(applicant_id.to_string())
        .bind(org_id.to_string())
        .bind(&applicant_role)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE users
             SET org_id=?, role=CASE WHEN role='user' THEN ? ELSE role END, auth_version=auth_version+1
             WHERE id=? AND deleted_at IS NULL",
        )
        .bind(org_id.to_string())
        .bind(&applicant_role)
        .bind(applicant_id.to_string())
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(Json(load_join_request(&state.pool, request_id).await?))
}

pub(crate) async fn list_student_assignment_problems(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
    Query(query): Query<PageQuery>,
) -> Result<Json<Page<AssignmentProblemDto>>, ApiError> {
    let user = current_user(&state, &headers).await?;
    ensure_student_target(&state.pool, assignment_id, user.id, user.org_id).await?;
    ensure_assignment_vip_access(&state.pool, assignment_id, user.id).await?;
    let (offset, limit) = page_window(&query);
    type Row = (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        u64,
        u64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT p.assignment_id, p.id, p.title, p.category, p.starting_fen, p.note, p.access_tier, p.solution_json,
          COUNT(ta.id) AS attempt_count,
          COUNT(CASE WHEN ta.outcome='completed' THEN 1 END) AS completed_count
         FROM teaching_assignment_problems p
         LEFT JOIN teaching_attempts ta ON ta.problem_id=p.id AND ta.student_id=?
         WHERE p.assignment_id=?
         GROUP BY p.id
         ORDER BY p.problem_order
         LIMIT ? OFFSET ?",
    )
    .bind(user.id.to_string())
    .bind(assignment_id.to_string())
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(page_from_rows(rows, offset, limit, |row| {
        let (
            assignment_id,
            problem_id,
            title,
            category,
            starting_fen,
            note,
            access_tier,
            solution,
            attempt_count,
            completed_count,
        ) = row;
        AssignmentProblemDto {
            assignment_id: parse_uuid(&assignment_id),
            problem_id: parse_uuid(&problem_id),
            title,
            category,
            starting_fen,
            note,
            access_tier,
            solution,
            completed: completed_count > 0,
            attempt_count: attempt_count as u32,
        }
    })))
}

pub(crate) async fn submit_student_attempt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SubmitAttemptRequest>,
) -> Result<Json<SubmitAttemptResponse>, ApiError> {
    let user = current_user(&state, &headers).await?;
    validate_attempt(&request)?;
    ensure_student_target(&state.pool, request.assignment_id, user.id, user.org_id).await?;
    ensure_assignment_vip_access(&state.pool, request.assignment_id, user.id).await?;
    let assignment_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM teaching_assignments WHERE id=? AND org_id=?")
            .bind(request.assignment_id.to_string())
            .bind(user.org_id.to_string())
            .fetch_optional(&state.pool)
            .await?;
    if assignment_status.as_deref() != Some("published") {
        return Err(ApiError::Invalid("assignment is closed".into()));
    }
    let belongs: u64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM teaching_assignment_problems WHERE id=? AND assignment_id=?",
    )
    .bind(request.problem_id.to_string())
    .bind(request.assignment_id.to_string())
    .fetch_one(&state.pool)
    .await?;
    if belongs == 0 {
        return Err(ApiError::NotFound);
    }
    sqlx::query(
        "INSERT IGNORE INTO teaching_attempts
         (client_attempt_id, assignment_id, problem_id, student_id, elapsed_ms, hints_used, mistakes, moves_json, outcome, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request.client_attempt_id.to_string())
    .bind(request.assignment_id.to_string())
    .bind(request.problem_id.to_string())
    .bind(user.id.to_string())
    .bind(request.elapsed_ms)
    .bind(request.hints_used)
    .bind(request.mistakes)
    .bind(serde_json::json!(request.moves))
    .bind(request.outcome)
    .bind(request.completed_at)
    .execute(&state.pool)
    .await?;
    Ok(Json(SubmitAttemptResponse { accepted: true }))
}

pub(crate) async fn list_teacher_students(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<Page<TeachingStudentDto>>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let (offset, limit) = page_window(&query);
    type Row = (String, String, String, String);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT DISTINCT student.id, COALESCE(student.login_name,student.email), student.email,
                COALESCE(student.display_name, student.login_name, student.email)
         FROM users student
         JOIN user_organization_memberships membership
           ON membership.user_id=student.id AND membership.org_id=? AND membership.role='student'
         WHERE student.role='student' AND student.deleted_at IS NULL
           AND (?='admin' OR EXISTS (
             SELECT 1 FROM class_students class_member
             JOIN class_coaches class_scope ON class_scope.class_id=class_member.class_id
             JOIN classes class_row ON class_row.id=class_member.class_id AND class_row.org_id=?
             WHERE class_member.student_id=student.id AND class_scope.coach_id=?
           ))
         ORDER BY display_name, login_name LIMIT ? OFFSET ?",
    )
    .bind(user.org_id.to_string())
    .bind(&user.role)
    .bind(user.org_id.to_string())
    .bind(user.id.to_string())
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(page_from_rows(rows, offset, limit, student_from_row)))
}

pub(crate) async fn list_teacher_classes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TeachingClassDto>>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT class_row.id,class_row.name
         FROM classes class_row
         WHERE class_row.org_id=? AND (
           ?='admin' OR EXISTS (
             SELECT 1 FROM class_coaches scope
             WHERE scope.class_id=class_row.id AND scope.coach_id=?
           )
         )
         ORDER BY class_row.created_at DESC,class_row.id DESC",
    )
    .bind(user.org_id.to_string())
    .bind(&user.role)
    .bind(user.id.to_string())
    .fetch_all(&state.pool)
    .await?;
    let mut result = Vec::with_capacity(rows.len());
    for (id, name) in rows {
        let class_id = parse_uuid(&id);
        let students: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT student.id,COALESCE(student.login_name,student.email),student.email,
                    COALESCE(student.display_name,student.login_name,student.email)
             FROM class_students member
             JOIN users student ON student.id=member.student_id AND student.deleted_at IS NULL
             JOIN user_organization_memberships membership
               ON membership.user_id=student.id AND membership.org_id=? AND membership.role='student'
             WHERE member.class_id=?
             ORDER BY student.display_name,student.login_name",
        )
        .bind(user.org_id.to_string())
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
        result.push(TeachingClassDto {
            id: class_id,
            name,
            student_count: students.len() as u32,
            students: students.into_iter().map(student_from_row).collect(),
        });
    }
    Ok(Json(result))
}

pub(crate) async fn list_teacher_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<Page<TeachingAssignmentDto>>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let (offset, limit) = page_window(&query);
    let rows = teacher_assignments(&state.pool, &user, limit, offset).await?;
    Ok(Json(page_from_rows(
        rows,
        offset,
        limit,
        assignment_from_row,
    )))
}

pub(crate) async fn admin_list_teacher_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<Vec<TeachingAssignmentDto>>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let (offset, limit) = page_window(&query);
    let rows = teacher_assignments(&state.pool, &user, limit, offset).await?;
    Ok(Json(rows.into_iter().map(assignment_from_row).collect()))
}

pub(crate) async fn create_teacher_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateAssignmentRequest>,
) -> Result<Json<TeachingAssignmentDto>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    Ok(Json(
        create_assignment_from_snapshot(&state.pool, &user, request).await?,
    ))
}

pub(crate) async fn create_admin_teacher_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<TeachingAssignmentDto>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    if let Ok(request) = serde_json::from_value::<CreateAssignmentRequest>(body.clone()) {
        return Ok(Json(
            create_assignment_from_snapshot(&state.pool, &user, request).await?,
        ));
    }
    let has_problem_ids = body
        .get("problemIds")
        .and_then(|value| value.as_array())
        .is_some_and(|items| !items.is_empty());
    let has_library_ids = body
        .get("libraryIds")
        .and_then(|value| value.as_array())
        .is_some_and(|items| !items.is_empty());
    if has_problem_ids || has_library_ids {
        return Err(ApiError::Invalid(
            "当前同步服务尚未接入管理后台题库 ID 发布，请更新管理后台服务或上传题目快照后再发布。"
                .into(),
        ));
    }
    Err(ApiError::Invalid("作业发布参数缺少题目和目标学生".into()))
}

async fn create_assignment_from_snapshot(
    pool: &MySqlPool,
    user: &CurrentUser,
    request: CreateAssignmentRequest,
) -> Result<TeachingAssignmentDto, ApiError> {
    validate_create_assignment(&request)?;
    ensure_target_students(pool, user, &request.target_student_ids).await?;
    ensure_vip_assignment_targets(pool, &request.problems, &request.target_student_ids).await?;
    let assignment_id = Uuid::new_v4();
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "INSERT INTO teaching_assignments (id, teacher_id, org_id, title, status, due_at) VALUES (?, ?, ?, ?, 'published', ?)",
    )
    .bind(assignment_id.to_string())
    .bind(user.id.to_string())
    .bind(user.org_id.to_string())
    .bind(request.title.trim())
    .bind(request.due_at)
    .execute(&mut *transaction)
    .await?;
    for (index, problem) in request.problems.iter().enumerate() {
        sqlx::query(
            "INSERT INTO teaching_assignment_problems
             (id, assignment_id, problem_order, title, category, starting_fen, note, access_tier, solution_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(assignment_id.to_string())
        .bind(index as u32)
        .bind(problem.title.trim())
        .bind(problem.category.trim())
        .bind(problem.starting_fen.trim())
        .bind(problem.note.trim())
        .bind(problem.access_tier.as_deref().unwrap_or("public"))
        .bind(&problem.solution)
        .execute(&mut *transaction)
        .await?;
    }
    for student_id in &request.target_student_ids {
        sqlx::query(
            "INSERT INTO teaching_assignment_targets (assignment_id, student_id) VALUES (?, ?)",
        )
        .bind(assignment_id.to_string())
        .bind(student_id.to_string())
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    load_teacher_assignment(pool, user, assignment_id).await
}

pub(crate) async fn teacher_assignment_results(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
) -> Result<Json<AssignmentResultsDto>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let assignment = load_teacher_assignment(&state.pool, &user, assignment_id).await?;
    let students = assignment_students(&state.pool, assignment_id, user.org_id).await?;
    let problems = assignment_problem_summaries(&state.pool, assignment_id).await?;
    let mut results = Vec::new();
    for student in &students {
        for problem in &problems {
            results.push(assignment_result(&state.pool, student.id, problem.id).await?);
        }
    }
    Ok(Json(AssignmentResultsDto {
        assignment,
        students,
        problems,
        results,
    }))
}

pub(crate) async fn admin_assignment_results(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
) -> Result<Json<Vec<AdminAssignmentResultDto>>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let assignment = load_teacher_assignment(&state.pool, &user, assignment_id).await?;
    let students = assignment_students(&state.pool, assignment_id, user.org_id).await?;
    let mut results = Vec::with_capacity(students.len());
    for student in students {
        type Row = (u64, Option<DateTime<Utc>>);
        let (completed_count, completed_at): Row = sqlx::query_as(
            "SELECT COUNT(DISTINCT CASE WHEN attempt.outcome='completed' THEN attempt.problem_id END),
                    MAX(CASE WHEN attempt.outcome='completed' THEN attempt.received_at END)
             FROM teaching_assignment_problems problem
             LEFT JOIN teaching_attempts attempt
               ON attempt.problem_id=problem.id AND attempt.assignment_id=problem.assignment_id AND attempt.student_id=?
             WHERE problem.assignment_id=?",
        )
        .bind(student.id.to_string())
        .bind(assignment_id.to_string())
        .fetch_one(&state.pool)
        .await?;
        results.push(AdminAssignmentResultDto {
            student_id: student.id,
            login_name: student.login_name,
            display_name: student.display_name,
            total_count: assignment.item_count,
            completed_count: completed_count as u32,
            completed_at,
        });
    }
    Ok(Json(results))
}

pub(crate) async fn publish_teacher_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
    Query(query): Query<PublishAssignmentQuery>,
) -> Result<Json<TeachingAssignmentDto>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let assignment = load_teacher_assignment(&state.pool, &user, assignment_id).await?;
    if assignment.status == "published" {
        return Ok(Json(assignment));
    }
    if assignment.status == "closed" {
        return Err(ApiError::Invalid("已关闭的作业不能重新发布".into()));
    }
    if assignment.item_count == 0 {
        return Err(ApiError::Invalid("发布前请至少选择一道题目".into()));
    }
    if assignment.target_count == 0 {
        return Err(ApiError::Invalid("发布前请至少选择一名学生或班级".into()));
    }
    let _allow_duplicate = query.allow_duplicate.unwrap_or(false);
    let affected = if user.role == "admin" {
        sqlx::query(
            "UPDATE teaching_assignments
             SET status='published', updated_at=NOW(6)
             WHERE id=? AND org_id=? AND status='draft'",
        )
        .bind(assignment_id.to_string())
        .bind(user.org_id.to_string())
        .execute(&state.pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE teaching_assignments
             SET status='published', updated_at=NOW(6)
             WHERE id=? AND teacher_id=? AND org_id=? AND status='draft'",
        )
        .bind(assignment_id.to_string())
        .bind(user.id.to_string())
        .bind(user.org_id.to_string())
        .execute(&state.pool)
        .await?
        .rows_affected()
    };
    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(Json(
        load_teacher_assignment(&state.pool, &user, assignment_id).await?,
    ))
}

pub(crate) async fn close_teacher_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
) -> Result<Json<TeachingAssignmentDto>, ApiError> {
    let user = require_teacher(&state, &headers).await?;
    let affected = if user.role == "admin" {
        sqlx::query(
            "UPDATE teaching_assignments SET status='closed', closed_at=COALESCE(closed_at, NOW(6)) WHERE id=? AND org_id=?",
        )
        .bind(assignment_id.to_string())
        .bind(user.org_id.to_string())
        .execute(&state.pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE teaching_assignments SET status='closed', closed_at=COALESCE(closed_at, NOW(6)) WHERE id=? AND teacher_id=? AND org_id=?",
        )
        .bind(assignment_id.to_string())
        .bind(user.id.to_string())
        .bind(user.org_id.to_string())
        .execute(&state.pool)
        .await?
        .rows_affected()
    };
    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(Json(
        load_teacher_assignment(&state.pool, &user, assignment_id).await?,
    ))
}

async fn current_user(state: &AppState, headers: &HeaderMap) -> Result<CurrentUser, ApiError> {
    let claims = crate::auth::decode_claims(headers, &state.jwt_secret)?;
    if claims.claims.token_type.as_deref() != Some("user") {
        return Err(ApiError::Unauthorized);
    }
    let id = parse_uuid(&claims.claims.sub);
    let org_id = claims.claims.org_id.as_deref().map(parse_uuid);
    let row: Option<(String, String, i8, u32, String)> = if let Some(org_id) = org_id {
        sqlx::query_as(
            "SELECT membership.role,user.role,user.is_platform_admin,user.auth_version,membership.org_id
             FROM users user JOIN user_organization_memberships membership
               ON membership.user_id=user.id AND membership.org_id=?
             WHERE user.id=? AND user.deleted_at IS NULL",
        )
        .bind(org_id.to_string())
        .bind(id.to_string())
        .fetch_optional(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT membership.role,user.role,user.is_platform_admin,user.auth_version,membership.org_id
             FROM users user JOIN user_organization_memberships membership
               ON membership.user_id=user.id AND membership.is_default=1
             WHERE user.id=? AND user.deleted_at IS NULL",
        )
        .bind(id.to_string())
        .fetch_optional(&state.pool)
        .await?
    };
    let Some((role, _legacy_role, is_platform_admin, auth_version, membership_org_id)) = row else {
        return Err(ApiError::Unauthorized);
    };
    if claims.claims.auth_version != 0 && claims.claims.auth_version != auth_version {
        return Err(ApiError::Unauthorized);
    }
    if claims
        .claims
        .role
        .as_deref()
        .is_some_and(|value| value != role)
    {
        return Err(ApiError::Unauthorized);
    }
    let org_id = org_id.unwrap_or_else(|| parse_uuid(&membership_org_id));
    Ok(CurrentUser {
        id,
        role,
        org_id,
        is_platform_admin: is_platform_admin != 0,
    })
}

async fn require_teacher(state: &AppState, headers: &HeaderMap) -> Result<CurrentUser, ApiError> {
    let user = current_user(state, headers).await?;
    if matches!(user.role.as_str(), "coach" | "admin") {
        Ok(user)
    } else {
        Err(ApiError::Forbidden)
    }
}

async fn ensure_student_target(
    pool: &MySqlPool,
    assignment_id: Uuid,
    student_id: Uuid,
    org_id: Uuid,
) -> Result<(), ApiError> {
    let count: u64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM teaching_assignment_targets target
         JOIN teaching_assignments assignment ON assignment.id=target.assignment_id
         JOIN user_organization_memberships membership ON membership.user_id=target.student_id
           AND membership.org_id=? AND membership.role='student'
         WHERE target.assignment_id=? AND target.student_id=? AND assignment.org_id=?",
    )
    .bind(org_id.to_string())
    .bind(assignment_id.to_string())
    .bind(student_id.to_string())
    .bind(org_id.to_string())
    .fetch_one(pool)
    .await?;
    if count == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(())
}

async fn student_vip_active(pool: &MySqlPool, student_id: Uuid) -> Result<bool, ApiError> {
    let row: Option<(i8, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT vip_enabled,vip_expires_at FROM users WHERE id=? AND role='student' AND deleted_at IS NULL")
            .bind(student_id.to_string())
            .fetch_optional(pool)
            .await?;
    Ok(row
        .map(|(enabled, expires_at)| is_vip_active(enabled, expires_at))
        .unwrap_or(false))
}

async fn ensure_assignment_vip_access(
    pool: &MySqlPool,
    assignment_id: Uuid,
    student_id: Uuid,
) -> Result<(), ApiError> {
    let requires_vip: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM teaching_assignment_problems
         WHERE assignment_id=? AND access_tier='vip' LIMIT 1",
    )
    .bind(assignment_id.to_string())
    .fetch_optional(pool)
    .await?;
    if requires_vip.is_some() && !student_vip_active(pool, student_id).await? {
        return Err(ApiError::Invalid(
            "作业权益已过期或未开通，请联系老师或管理员续期。".into(),
        ));
    }
    Ok(())
}

fn page_window(query: &PageQuery) -> (i64, i64) {
    let offset = query
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let limit = i64::from(query.limit.unwrap_or(100).clamp(1, 200));
    (offset, limit)
}

fn page_from_rows<R, T, F>(rows: Vec<R>, offset: i64, limit: i64, convert: F) -> Page<T>
where
    F: Fn(R) -> T,
{
    let has_more = rows.len() as i64 == limit;
    let item_count = rows.len() as i64;
    Page {
        items: rows.into_iter().map(convert).collect(),
        next_cursor: has_more.then(|| (offset + item_count).to_string()),
    }
}

fn assignment_from_row(
    row: (
        String,
        String,
        String,
        Option<DateTime<Utc>>,
        u64,
        u64,
        u64,
        DateTime<Utc>,
    ),
) -> TeachingAssignmentDto {
    let (id, title, status, due_at, item_count, target_count, completed_count, created_at) = row;
    TeachingAssignmentDto {
        id: parse_uuid(&id),
        title,
        status,
        due_at,
        item_count: item_count as u32,
        target_count: target_count as u32,
        completed_count: completed_count as u32,
        created_at,
    }
}

fn student_from_row(row: (String, String, String, String)) -> TeachingStudentDto {
    let (id, login_name, email, display_name) = row;
    TeachingStudentDto {
        id: parse_uuid(&id),
        login_name,
        email,
        display_name,
    }
}

async fn teacher_assignments(
    pool: &MySqlPool,
    user: &CurrentUser,
    limit: i64,
    offset: i64,
) -> Result<
    Vec<(
        String,
        String,
        String,
        Option<DateTime<Utc>>,
        u64,
        u64,
        u64,
        DateTime<Utc>,
    )>,
    ApiError,
> {
    let sql = if user.role == "admin" {
        "SELECT a.id, a.title, a.status, a.due_at,
          COUNT(DISTINCT p.id), COUNT(DISTINCT t.student_id),
          COUNT(DISTINCT CASE WHEN ta.outcome='completed' THEN ta.student_id END),
          a.created_at
         FROM teaching_assignments a
         LEFT JOIN teaching_assignment_problems p ON p.assignment_id=a.id
         LEFT JOIN teaching_assignment_targets t ON t.assignment_id=a.id
         LEFT JOIN teaching_attempts ta ON ta.assignment_id=a.id
         WHERE a.org_id=?
         GROUP BY a.id
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?"
    } else {
        "SELECT a.id, a.title, a.status, a.due_at,
          COUNT(DISTINCT p.id), COUNT(DISTINCT t.student_id),
          COUNT(DISTINCT CASE WHEN ta.outcome='completed' THEN ta.student_id END),
          a.created_at
         FROM teaching_assignments a
         LEFT JOIN teaching_assignment_problems p ON p.assignment_id=a.id
         LEFT JOIN teaching_assignment_targets t ON t.assignment_id=a.id
         LEFT JOIN teaching_attempts ta ON ta.assignment_id=a.id
         WHERE a.teacher_id=? AND a.org_id=?
         GROUP BY a.id
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?"
    };
    let mut query = sqlx::query_as(sql);
    if user.role == "admin" {
        query = query.bind(user.org_id.to_string());
    } else {
        query = query.bind(user.id.to_string());
        query = query.bind(user.org_id.to_string());
    }
    Ok(query.bind(limit).bind(offset).fetch_all(pool).await?)
}

async fn ensure_target_students(
    pool: &MySqlPool,
    user: &CurrentUser,
    ids: &[Uuid],
) -> Result<(), ApiError> {
    let unique: HashSet<Uuid> = ids.iter().copied().collect();
    if unique.len() != ids.len() {
        return Err(ApiError::Invalid("target students must be unique".into()));
    }
    for student_id in ids {
        let role: Option<String> = sqlx::query_scalar(
            "SELECT membership.role FROM user_organization_memberships membership
                 JOIN users user ON user.id=membership.user_id AND user.deleted_at IS NULL
                 WHERE membership.user_id=? AND membership.org_id=? AND membership.role='student'",
        )
        .bind(student_id.to_string())
        .bind(user.org_id.to_string())
        .fetch_optional(pool)
        .await?;
        if role.as_deref() != Some("student") {
            return Err(ApiError::Invalid(
                "目标学生不在当前学校/机构或不是学生账号".into(),
            ));
        }
        if user.role == "coach" {
            let allowed: u64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM class_students member
                 JOIN classes class_row ON class_row.id=member.class_id AND class_row.org_id=?
                 JOIN class_coaches scope ON scope.class_id=member.class_id AND scope.coach_id=?
                 WHERE member.student_id=?",
            )
            .bind(user.org_id.to_string())
            .bind(user.id.to_string())
            .bind(student_id.to_string())
            .fetch_one(pool)
            .await?;
            if allowed == 0 {
                return Err(ApiError::Forbidden);
            }
        }
    }
    Ok(())
}

async fn ensure_vip_assignment_targets(
    pool: &MySqlPool,
    problems: &[CreateAssignmentProblem],
    student_ids: &[Uuid],
) -> Result<(), ApiError> {
    let contains_vip_problem = problems
        .iter()
        .any(|problem| problem.access_tier.as_deref() == Some("vip"));
    if !contains_vip_problem {
        return Ok(());
    }
    let mut inactive_count = 0u32;
    for student_id in student_ids {
        if !student_vip_active(pool, *student_id).await? {
            inactive_count += 1;
        }
    }
    if inactive_count > 0 {
        return Err(ApiError::Invalid(format!(
            "本作业包含 VIP 题目，{inactive_count} 名目标学生未开通或权益已过期，不能发布。"
        )));
    }
    Ok(())
}

async fn load_teacher_assignment(
    pool: &MySqlPool,
    user: &CurrentUser,
    assignment_id: Uuid,
) -> Result<TeachingAssignmentDto, ApiError> {
    let rows = if user.role == "admin" {
        sqlx::query_as(
            "SELECT a.id, a.title, a.status, a.due_at,
              COUNT(DISTINCT p.id), COUNT(DISTINCT t.student_id),
              COUNT(DISTINCT CASE WHEN ta.outcome='completed' THEN ta.student_id END),
              a.created_at
             FROM teaching_assignments a
             LEFT JOIN teaching_assignment_problems p ON p.assignment_id=a.id
             LEFT JOIN teaching_assignment_targets t ON t.assignment_id=a.id
             LEFT JOIN teaching_attempts ta ON ta.assignment_id=a.id
             WHERE a.id=? AND a.org_id=?
             GROUP BY a.id",
        )
        .bind(assignment_id.to_string())
        .bind(user.org_id.to_string())
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT a.id, a.title, a.status, a.due_at,
              COUNT(DISTINCT p.id), COUNT(DISTINCT t.student_id),
              COUNT(DISTINCT CASE WHEN ta.outcome='completed' THEN ta.student_id END),
              a.created_at
             FROM teaching_assignments a
             LEFT JOIN teaching_assignment_problems p ON p.assignment_id=a.id
             LEFT JOIN teaching_assignment_targets t ON t.assignment_id=a.id
             LEFT JOIN teaching_attempts ta ON ta.assignment_id=a.id
             WHERE a.id=? AND a.teacher_id=? AND a.org_id=?
             GROUP BY a.id",
        )
        .bind(assignment_id.to_string())
        .bind(user.id.to_string())
        .bind(user.org_id.to_string())
        .fetch_optional(pool)
        .await?
    };
    rows.map(assignment_from_row).ok_or(ApiError::NotFound)
}

async fn assignment_students(
    pool: &MySqlPool,
    assignment_id: Uuid,
    org_id: Uuid,
) -> Result<Vec<TeachingStudentDto>, ApiError> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT u.id, COALESCE(u.login_name,u.email), u.email, COALESCE(u.display_name,u.login_name,u.email)
         FROM teaching_assignment_targets t
         JOIN users u ON u.id=t.student_id
         JOIN user_organization_memberships membership
           ON membership.user_id=u.id AND membership.org_id=? AND membership.role='student'
         JOIN teaching_assignments assignment ON assignment.id=t.assignment_id AND assignment.org_id=?
         WHERE t.assignment_id=?
         ORDER BY u.display_name, u.login_name",
    )
    .bind(org_id.to_string())
    .bind(org_id.to_string())
    .bind(assignment_id.to_string())
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(student_from_row).collect())
}

async fn assignment_problem_summaries(
    pool: &MySqlPool,
    assignment_id: Uuid,
) -> Result<Vec<AssignmentProblemSummaryDto>, ApiError> {
    let rows: Vec<(String, String, String, u32)> = sqlx::query_as(
        "SELECT id, title, category, problem_order FROM teaching_assignment_problems
         WHERE assignment_id=? ORDER BY problem_order",
    )
    .bind(assignment_id.to_string())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, category, order)| AssignmentProblemSummaryDto {
            id: parse_uuid(&id),
            title,
            category,
            order,
        })
        .collect())
}

async fn assignment_result(
    pool: &MySqlPool,
    student_id: Uuid,
    problem_id: Uuid,
) -> Result<AssignmentResultDto, ApiError> {
    type Row = (u32, u32, u32, String, DateTime<Utc>);
    let attempts: Vec<Row> = sqlx::query_as(
        "SELECT elapsed_ms, hints_used, mistakes, outcome, received_at
         FROM teaching_attempts
         WHERE student_id=? AND problem_id=?
         ORDER BY received_at DESC",
    )
    .bind(student_id.to_string())
    .bind(problem_id.to_string())
    .fetch_all(pool)
    .await?;
    let latest = attempts.first();
    Ok(AssignmentResultDto {
        student_id,
        problem_id,
        attempt_count: attempts.len() as u32,
        completed: attempts
            .iter()
            .any(|(_, _, _, outcome, _)| outcome == "completed"),
        elapsed_ms: latest.map(|row| row.0),
        hints_used: latest.map(|row| row.1),
        mistakes: latest.map(|row| row.2),
        outcome: latest.map(|row| row.3.clone()),
        submitted_at: latest.map(|row| row.4),
    })
}

fn validate_create_assignment(request: &CreateAssignmentRequest) -> Result<(), ApiError> {
    if request.title.trim().is_empty() || request.title.chars().count() > 160 {
        return Err(ApiError::Invalid("assignment title is required".into()));
    }
    if request.problems.is_empty() || request.problems.len() > 200 {
        return Err(ApiError::Invalid("select 1 to 200 problems".into()));
    }
    if request.target_student_ids.is_empty() || request.target_student_ids.len() > 500 {
        return Err(ApiError::Invalid("select at least one student".into()));
    }
    for problem in &request.problems {
        if problem.title.trim().is_empty() || problem.starting_fen.trim().is_empty() {
            return Err(ApiError::Invalid(
                "problem title and FEN are required".into(),
            ));
        }
        if !problem.solution.is_array() {
            return Err(ApiError::Invalid(
                "problem solution must be an array".into(),
            ));
        }
        if !matches!(
            problem.access_tier.as_deref().unwrap_or("public"),
            "public" | "vip"
        ) {
            return Err(ApiError::Invalid("problem access tier is invalid".into()));
        }
    }
    Ok(())
}

fn validate_attempt(request: &SubmitAttemptRequest) -> Result<(), ApiError> {
    if !matches!(
        request.outcome.as_str(),
        "completed" | "revealed" | "abandoned"
    ) {
        return Err(ApiError::Invalid("invalid attempt outcome".into()));
    }
    if request.moves.len() > 400 {
        return Err(ApiError::Invalid("too many moves in attempt".into()));
    }
    Ok(())
}

fn parse_uuid(value: &str) -> Uuid {
    Uuid::parse_str(value).unwrap_or_else(|_| Uuid::nil())
}

fn join_request_from_row(
    row: (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
    ),
) -> Result<OrganizationJoinRequestDto, ApiError> {
    let (
        id,
        org_id,
        org_name,
        applicant_id,
        applicant_role,
        applicant_login_name,
        applicant_display_name,
        status,
        note,
        review_note,
        created_at,
    ) = row;
    Ok(OrganizationJoinRequestDto {
        id: parse_uuid(&id),
        org_id: parse_uuid(&org_id),
        org_name,
        applicant_id: parse_uuid(&applicant_id),
        applicant_role,
        applicant_login_name,
        applicant_display_name,
        status,
        note,
        review_note,
        created_at,
    })
}

async fn load_join_request(
    pool: &MySqlPool,
    id: Uuid,
) -> Result<OrganizationJoinRequestDto, ApiError> {
    let row = sqlx::query_as(
        "SELECT request.id,request.org_id,org.name,request.applicant_id,
                request.applicant_role,user.login_name,user.display_name,
                request.status,request.note,request.review_note,request.created_at
         FROM organization_join_requests request
         JOIN organizations org ON org.id=request.org_id
         JOIN users user ON user.id=request.applicant_id
         WHERE request.id=?",
    )
    .bind(id.to_string())
    .fetch_optional(pool)
    .await?
    .ok_or(ApiError::NotFound)?;
    join_request_from_row(row)
}

async fn add_column(
    pool: &MySqlPool,
    table: &str,
    column: &str,
    statement: &str,
) -> Result<(), sqlx::Error> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    )
    .bind(table)
    .bind(column)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

async fn add_index(
    pool: &MySqlPool,
    table: &str,
    index: &str,
    statement: &str,
) -> Result<(), sqlx::Error> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    )
    .bind(table)
    .bind(index)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}
