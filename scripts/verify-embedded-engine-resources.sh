#!/usr/bin/env bash
set -euo pipefail

TARGET_PLATFORM="${1:?Usage: verify-embedded-engine-resources.sh <macos-arm64|macos-x64|windows-x64|linux-x64>}"
PIKAFISH_RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
FAIRY_RESOURCE_DIR="apps/desktop/src-tauri/resources/fairy-stockfish"
FAIRY_XIANGQI_NNUE_NAME="xiangqi-c07e94a5c7cb.nnue"

require_file() {
  local path="$1"
  local description="$2"
  if [[ ! -f "$path" ]]; then
    echo "Missing $description: $path" >&2
    exit 1
  fi
}

require_executable() {
  local path="$1"
  local description="$2"
  require_file "$path" "$description"
  if [[ ! -x "$path" && "$TARGET_PLATFORM" != "windows-x64" ]]; then
    echo "$description is not executable: $path" >&2
    exit 1
  fi
}

reject_mixed_nnue() {
  local directory="$1"
  local forbidden_pattern="$2"
  local description="$3"
  local mixed
  mixed="$(find "$directory" -maxdepth 1 -type f -iname "$forbidden_pattern" -print -quit 2>/dev/null || true)"
  if [[ -n "$mixed" ]]; then
    echo "Refusing mixed NNUE resource in $description: $mixed" >&2
    exit 1
  fi
}

case "$TARGET_PLATFORM" in
  macos-arm64|macos-x64|linux-x64)
    require_executable "$PIKAFISH_RESOURCE_DIR/pikafish" "Pikafish executable for $TARGET_PLATFORM"
    require_executable "$FAIRY_RESOURCE_DIR/fairy-stockfish" "Fairy-Stockfish executable for $TARGET_PLATFORM"
    ;;
  windows-x64)
    require_file "$PIKAFISH_RESOURCE_DIR/pikafish.exe" "Pikafish executable for Windows x64"
    require_file "$FAIRY_RESOURCE_DIR/fairy-stockfish.exe" "Fairy-Stockfish executable for Windows x64"
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

require_file "$PIKAFISH_RESOURCE_DIR/pikafish.nnue" "Pikafish NNUE"
require_file "$FAIRY_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME" "Fairy-Stockfish Xiangqi NNUE"
reject_mixed_nnue "$PIKAFISH_RESOURCE_DIR" 'xiangqi-*.nnue' "Pikafish"
reject_mixed_nnue "$FAIRY_RESOURCE_DIR" 'pikafish*.nnue' "Fairy-Stockfish"

echo "Verified embedded engines and NNUE resources for $TARGET_PLATFORM:"
find "$PIKAFISH_RESOURCE_DIR" "$FAIRY_RESOURCE_DIR" -maxdepth 1 -type f -print
