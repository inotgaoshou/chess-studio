#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_CANDIDATES=(
  "${NVM_DIR:-$HOME/.nvm}/versions/node/v24.14.0/bin"
  "/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  "/opt/homebrew/bin"
  "/usr/local/bin"
)

# Prefer the user's local Node 24 installation. The workspace runtime remains
# a deterministic fallback for machines without that installation.
WORKSPACE_NODE_ROOT="/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node"
if [[ -d "$WORKSPACE_NODE_ROOT/bin" ]]; then
  NODE_CANDIDATES+=("$WORKSPACE_NODE_ROOT/bin")
fi

NODE_BIN=""
for candidate in "${NODE_CANDIDATES[@]}"; do
  [[ -x "$candidate/node" ]] || continue
  major="$($candidate/node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -ge 24 ]]; then
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
if [[ ! -x apps/desktop/src-tauri/resources/pikafish/pikafish ]]; then
  ./scripts/prepare-pikafish-resource.sh macos-arm64
fi
if [[ -x "$NODE_BIN/corepack" ]]; then
  # Invoke Corepack through the selected runtime explicitly. The shim's
  # `#!/usr/bin/env node` otherwise resolves to whatever Node is in the caller
  # environment, which can silently fall back to Node 20 and fail on node:sqlite.
  exec "$NODE_BIN/node" "$NODE_BIN/corepack" pnpm --dir apps/desktop tauri dev
fi
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --dir apps/desktop tauri dev
fi

echo "未找到 pnpm/Corepack。请安装 pnpm 后再运行 scripts/dev-desktop.sh。" >&2
exit 1
