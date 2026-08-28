#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_CANDIDATES=(
  "${NVM_DIR:-$HOME/.nvm}/versions/node/v24.14.0/bin"
  "/opt/homebrew/bin"
  "/usr/local/bin"
)

NODE_BIN=""
for candidate in "${NODE_CANDIDATES[@]}"; do
  [[ -x "$candidate/node" ]] || continue
  major="$($candidate/node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -ge 22 ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

[[ -n "$NODE_BIN" ]] || {
  echo "未找到 Node 22+。请安装 Node 22+ 后再运行 scripts/dev-desktop.sh。" >&2
  exit 1
}

cd "$ROOT"
export PATH="$NODE_BIN:$HOME/.local/bin:$PATH"
if [[ -x "$NODE_BIN/corepack" ]]; then
  exec "$NODE_BIN/corepack" pnpm --dir apps/desktop tauri dev
fi
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --dir apps/desktop tauri dev
fi

echo "未找到 pnpm/Corepack。请安装 pnpm 后再运行 scripts/dev-desktop.sh。" >&2
exit 1
