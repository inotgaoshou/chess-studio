#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NVM_DIR:-$HOME/.nvm}/versions/node/v24.14.0/bin"
COREPACK="$NODE_BIN/corepack"

[[ -x "$NODE_BIN/node" ]] || { echo "未找到 Node v24.14.0：$NODE_BIN/node" >&2; exit 1; }
[[ -x "$COREPACK" ]] || { echo "未找到 Corepack：$COREPACK" >&2; exit 1; }

cd "$ROOT"
exec env PATH="$NODE_BIN:$HOME/.local/bin:$PATH" "$COREPACK" pnpm --dir apps/desktop tauri dev
