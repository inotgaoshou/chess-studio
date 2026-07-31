-- Run once as a MySQL administrator before starting xiangqi-server.
-- Replace the password below before execution; this file is not run by the application.
CREATE DATABASE IF NOT EXISTS xiangqi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'xiangqi'@'127.0.0.1'
  IDENTIFIED BY 'CHANGE_THIS_LOCAL_DEVELOPMENT_PASSWORD';

-- The server currently executes CREATE TABLE IF NOT EXISTS on startup, so it
-- needs these schema-scoped DDL privileges in addition to read/write access.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON xiangqi.* TO 'xiangqi'@'127.0.0.1';
FLUSH PRIVILEGES;
