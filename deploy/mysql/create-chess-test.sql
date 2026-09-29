-- Run this as a MySQL administrator before the test API starts:
--   mysql -u root -p -h 127.0.0.1 -P 3456 < deploy/mysql/create-chess-test.sql
--
-- This tracked file intentionally creates no database users or passwords.
-- Provision the dedicated xiangqi_studio_test@127.0.0.1 account from an
-- interactive terminal using a newly generated secret as documented in
-- deploy/README.md. Never reuse the production account or database here.

CREATE DATABASE IF NOT EXISTS chess_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = 'chess_test';
