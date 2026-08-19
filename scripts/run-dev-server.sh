#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a
source "$ROOT/.env"
set +a

exec "$ROOT/target/debug/xiangqi-server"
