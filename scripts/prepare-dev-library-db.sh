#!/usr/bin/env bash
set -euo pipefail

if lsof -nP -iTCP:1421 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "开发版正在运行。请先退出 scripts/dev-desktop.sh 启动的开发版后再复制棋谱库。" >&2
  exit 1
fi

DATA_ROOT="$HOME/Library/Application Support"
PRODUCTION_DB="$DATA_ROOT/cn.xiangqi.studio/xiangqi.sqlite3"
DEVELOPMENT_DB="$DATA_ROOT/cn.xiangqi.studio.dev/xiangqi.sqlite3"

[[ -f "$PRODUCTION_DB" ]] || {
  echo "未找到正式棋谱库：$PRODUCTION_DB" >&2
  exit 1
}

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DATA_ROOT/cn.xiangqi.studio.dev/backups"
mkdir -p "$BACKUP_DIR"

# SQLite's backup command includes committed WAL contents and never changes the
# source database. Preserve both the production source and the prior dev copy.
sqlite3 "$PRODUCTION_DB" ".backup '$BACKUP_DIR/production-$STAMP.sqlite3'"
if [[ -f "$DEVELOPMENT_DB" ]]; then
  sqlite3 "$DEVELOPMENT_DB" ".backup '$BACKUP_DIR/development-$STAMP.sqlite3'"
fi
mkdir -p "$(dirname "$DEVELOPMENT_DB")"
rm -f "$DEVELOPMENT_DB-wal" "$DEVELOPMENT_DB-shm"
sqlite3 "$PRODUCTION_DB" ".backup '$DEVELOPMENT_DB'"

echo "已复制正式棋谱库到开发库。"
echo "正式库备份：$BACKUP_DIR/production-$STAMP.sqlite3"
echo "开发库：$DEVELOPMENT_DB"
