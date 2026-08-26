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
  set -a
  source "$ROOT/.env"
  set +a
  [[ -n "${DATABASE_URL:-}" ]] || { echo ".env 缺少 DATABASE_URL" >&2; exit 1; }
  [[ -n "${JWT_SECRET:-}" ]] || { echo ".env 缺少 JWT_SECRET" >&2; exit 1; }
  local bind_addr="${BIND_ADDR:-127.0.0.1:8080}"
  [[ "$bind_addr" == "127.0.0.1:"* ]] || { echo "本机开发服务只能绑定 127.0.0.1，当前为 $bind_addr" >&2; exit 1; }
  local port="${bind_addr##*:}"
  if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $port 已被占用；请先确认已有服务或修改本机端口配置" >&2
    exit 1
  fi
  (
    cd "$ROOT"
    cargo build -p xiangqi-server
  )
  (
    cd "$ROOT"
    nohup "$ROOT/target/debug/xiangqi-server" >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  for _ in {1..20}; do
    if curl --silent --fail "http://$bind_addr/health" >/dev/null 2>&1; then
      echo "服务端已启动，PID $(<"$PID_FILE")"
      echo "健康检查：http://$bind_addr/health"
      return
    fi
    sleep 0.25
  done
  local pid
  pid="$(<"$PID_FILE")"
  kill -TERM "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "服务端未通过健康检查。请确认 MySQL 已启动、DATABASE_URL 可用，并查看日志：$LOG_FILE" >&2
  exit 1
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
