#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.local/dev"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

start() {
  if running_pid; then
    echo "服务端已经运行，PID $(<"$PID_FILE")"
    return
  fi
  [[ -f "$ROOT/.env" ]] || { echo "缺少 $ROOT/.env" >&2; exit 1; }
  mkdir -p "$STATE_DIR"
  rm -f "$PID_FILE"
  (
    cd "$ROOT"
    cargo build -p xiangqi-server
  )
  (
    cd "$ROOT"
    nohup "$ROOT/target/debug/xiangqi-server" >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  echo "服务端启动中，PID $(<"$PID_FILE")"
  echo "日志：$LOG_FILE"
}

stop() {
  if ! running_pid; then
    rm -f "$PID_FILE"
    echo "服务端未运行"
    return
  fi
  local pid
  pid="$(<"$PID_FILE")"
  kill -TERM "$pid"
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "服务端未能在 5 秒内退出，PID $pid" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
  echo "服务端已停止"
}

status() {
  if running_pid; then
    echo "服务端运行中，PID $(<"$PID_FILE")"
  else
    rm -f "$PID_FILE"
    echo "服务端未运行"
    return 1
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) mkdir -p "$STATE_DIR"; touch "$LOG_FILE"; tail -f "$LOG_FILE" ;;
  *) echo "用法：$0 {start|stop|restart|status|logs}" >&2; exit 2 ;;
esac
