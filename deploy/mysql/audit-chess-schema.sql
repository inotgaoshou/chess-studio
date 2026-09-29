-- Read-only preflight for the existing production `chess` schema.
-- Run before the first xiangqi-server production start, then inspect every
-- reported table with SHOW CREATE TABLE. `CREATE TABLE IF NOT EXISTS` is not a
-- safe compatibility check for unrelated existing tables of the same name.

SELECT
  expected.table_name,
  CASE WHEN actual.table_name IS NULL THEN 'missing (will be created)' ELSE 'exists (inspect)' END AS status,
  actual.table_comment
FROM (
  SELECT 'users' AS table_name UNION ALL SELECT 'games' UNION ALL SELECT 'operations'
  UNION ALL SELECT 'device_cursors' UNION ALL SELECT 'subscription_entitlements'
  UNION ALL SELECT 'redemption_codes' UNION ALL SELECT 'code_redemptions'
  UNION ALL SELECT 'product_events' UNION ALL SELECT 'analysis_rate_limits'
  UNION ALL SELECT 'master_players' UNION ALL SELECT 'master_games'
  UNION ALL SELECT 'master_game_sources' UNION ALL SELECT 'master_game_player_refs'
  UNION ALL SELECT 'master_game_moves' UNION ALL SELECT 'master_position_samples'
  UNION ALL SELECT 'master_position_analysis' UNION ALL SELECT 'user_master_game_favorites'
  UNION ALL SELECT 'user_master_training_refs' UNION ALL SELECT 'master_game_opening_tags'
  UNION ALL SELECT 'external_game_sources' UNION ALL SELECT 'master_player_source_refs'
  UNION ALL SELECT 'reference_sources' UNION ALL SELECT 'reference_import_batches'
  UNION ALL SELECT 'reference_import_files' UNION ALL SELECT 'reference_import_records'
  UNION ALL SELECT 'opening_series' UNION ALL SELECT 'opening_categories'
  UNION ALL SELECT 'opening_aliases' UNION ALL SELECT 'opening_category_stats'
  UNION ALL SELECT 'opening_classifier_versions' UNION ALL SELECT 'opening_patterns'
  UNION ALL SELECT 'game_opening_classifications' UNION ALL SELECT 'reference_position_move_stats'
  UNION ALL SELECT 'reference_migration_cursors' UNION ALL SELECT 'personal_manual_records'
  UNION ALL SELECT 'personal_manual_sync_status' UNION ALL SELECT 'organizations'
  UNION ALL SELECT 'user_organization_memberships' UNION ALL SELECT 'organization_join_requests'
  UNION ALL SELECT 'classes' UNION ALL SELECT 'class_students' UNION ALL SELECT 'class_coaches'
  UNION ALL SELECT 'teaching_assignments' UNION ALL SELECT 'teaching_assignment_problems'
  UNION ALL SELECT 'teaching_assignment_targets' UNION ALL SELECT 'teaching_attempts'
) AS expected
LEFT JOIN information_schema.TABLES AS actual
  ON actual.TABLE_SCHEMA = 'chess' AND actual.TABLE_NAME = expected.table_name
ORDER BY expected.table_name;

SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'chess'
ORDER BY TABLE_NAME;

-- The teaching and reference migrations also alter existing core tables. Any
-- missing item below blocks the production start until the previous schema is
-- understood and a migration plan is agreed.
SELECT
  expected.table_name,
  expected.column_name,
  CASE WHEN actual.column_name IS NULL THEN 'missing (startup will alter)' ELSE 'exists (inspect)' END AS status,
  actual.column_type
FROM (
  SELECT 'users' AS table_name, 'id' AS column_name UNION ALL SELECT 'users', 'email'
  UNION ALL SELECT 'users', 'password_hash' UNION ALL SELECT 'users', 'login_name'
  UNION ALL SELECT 'users', 'display_name' UNION ALL SELECT 'users', 'role'
  UNION ALL SELECT 'users', 'org_id' UNION ALL SELECT 'users', 'is_platform_admin'
  UNION ALL SELECT 'users', 'auth_version' UNION ALL SELECT 'users', 'vip_enabled'
  UNION ALL SELECT 'users', 'vip_expires_at' UNION ALL SELECT 'master_games', 'starting_fen'
  UNION ALL SELECT 'master_games', 'canonical_fingerprint' UNION ALL SELECT 'master_games', 'moves_hash'
  UNION ALL SELECT 'master_games', 'validation_status' UNION ALL SELECT 'master_games', 'ingestion_version'
  UNION ALL SELECT 'master_game_moves', 'position_key' UNION ALL SELECT 'master_game_moves', 'position_hash'
  UNION ALL SELECT 'master_game_sources', 'record_hash' UNION ALL SELECT 'teaching_assignments', 'org_id'
  UNION ALL SELECT 'teaching_assignment_problems', 'access_tier'
) AS expected
LEFT JOIN information_schema.COLUMNS AS actual
  ON actual.TABLE_SCHEMA = 'chess'
  AND actual.TABLE_NAME = expected.table_name
  AND actual.COLUMN_NAME = expected.column_name
ORDER BY expected.table_name, expected.column_name;
