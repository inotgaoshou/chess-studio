#!/usr/bin/env bash
# Old desktop shortcut forwards to the unified installer.
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/install-qixi.command" "$@"
