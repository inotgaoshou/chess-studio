#!/usr/bin/env bash
# Compatibility name. Daily installs target the unified official identity.
set -euo pipefail
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${QIXI_LEGACY_MIGRATION_BUILD:-0}" == 1 ]]; then
  exec bash "$root_dir/scripts/build-video-family-legacy.sh" "$@"
fi
platform="${1:?Usage: build-video-family.sh android|ios [device]}"
args=(--platform "$platform" --action update)
if [[ -n "${2:-}" ]]; then args+=(--device "$2"); else args+=(--build-only); fi
exec python3 "$root_dir/scripts/install-qixi.py" "${args[@]}"
