#!/usr/bin/env bash
set -euo pipefail

TARGET_PLATFORM="${1:?Usage: verify-embedded-engine-resources.sh <macos-arm64|macos-x64|windows-x64|linux-x64>}"
PIKAFISH_RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
EXPECTED_PIKAFISH_SOURCE_REVISION="b97ef0f9eb15bd99899b272e0236bfebf86313b6"
EXPECTED_PIKAFISH_SOURCE_SHORT_REVISION="b97ef0f9"
EXPECTED_PIKAFISH_NNUE_LABEL="pikafish权重260720"
EXPECTED_PIKAFISH_NNUE_SHA256="3cd15292bf8c979884262f57fc723959fc0dea43b4d8d544f88db5ceb2479e24"
EXPECTED_PIKAFISH_NNUE_RUNTIME_MARKER="NNUE evaluation using pikafish.nnue"

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

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

require_sha256() {
  local path="$1"
  local expected="$2"
  local description="$3"
  local actual
  actual="$(sha256_file "$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$description SHA256 mismatch." >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

require_pikafish_runtime_metadata() {
  local engine_path="$1"
  local engine_name
  local output
  engine_name="$(basename "$engine_path")"
  output="$(
    cd "$PIKAFISH_RESOURCE_DIR"
    "./$engine_name" bench 1 2>/dev/null || true
  )"
  if [[ "$output" != *"Pikafish dev-"*"-$EXPECTED_PIKAFISH_SOURCE_SHORT_REVISION"* ]]; then
    echo "Pikafish runtime version mismatch for $TARGET_PLATFORM." >&2
    echo "Expected source revision: $EXPECTED_PIKAFISH_SOURCE_REVISION" >&2
    echo "First output lines:" >&2
    printf '%s\n' "$output" | sed -n '1,8p' >&2
    exit 1
  fi
  if [[ "$output" != *"$EXPECTED_PIKAFISH_NNUE_RUNTIME_MARKER"* ]]; then
    echo "Pikafish did not report the expected NNUE file for $TARGET_PLATFORM." >&2
    echo "Expected marker: $EXPECTED_PIKAFISH_NNUE_RUNTIME_MARKER ($EXPECTED_PIKAFISH_NNUE_LABEL)" >&2
    echo "First output lines:" >&2
    printf '%s\n' "$output" | sed -n '1,12p' >&2
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
    PIKAFISH_EXECUTABLE="$PIKAFISH_RESOURCE_DIR/pikafish"
    require_executable "$PIKAFISH_EXECUTABLE" "Pikafish executable for $TARGET_PLATFORM"
    ;;
  windows-x64)
    PIKAFISH_EXECUTABLE="$PIKAFISH_RESOURCE_DIR/pikafish.exe"
    require_file "$PIKAFISH_EXECUTABLE" "Pikafish executable for Windows x64"
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

require_file "$PIKAFISH_RESOURCE_DIR/pikafish.nnue" "Pikafish NNUE"
require_sha256 "$PIKAFISH_RESOURCE_DIR/pikafish.nnue" "$EXPECTED_PIKAFISH_NNUE_SHA256" "Pikafish NNUE $EXPECTED_PIKAFISH_NNUE_LABEL"
require_pikafish_runtime_metadata "$PIKAFISH_EXECUTABLE"
reject_mixed_nnue "$PIKAFISH_RESOURCE_DIR" 'xiangqi-*.nnue' "Pikafish"

FORBIDDEN_FAIRY_RESOURCE="$(find apps/desktop/src-tauri/resources -type f \( -iname '*fairy*stockfish*' -o -iname '*fairy*.nnue' \) -print -quit 2>/dev/null || true)"
if [[ -n "$FORBIDDEN_FAIRY_RESOURCE" ]]; then
  echo "Refusing removed Fairy-Stockfish resource: $FORBIDDEN_FAIRY_RESOURCE" >&2
  exit 1
fi
for forbidden in "$PIKAFISH_RESOURCE_DIR/fairy-stockfish" "$PIKAFISH_RESOURCE_DIR/fairy-stockfish.exe"; do
  if [[ -e "$forbidden" ]]; then
    echo "Refusing removed Fairy-Stockfish resource: $forbidden" >&2
    exit 1
  fi
done

if [[ "$TARGET_PLATFORM" == "windows-x64" ]]; then
  FORBIDDEN_UNIX_PIKAFISH="$(find "$PIKAFISH_RESOURCE_DIR" -maxdepth 1 -type f -name 'pikafish*' ! -name '*.*' -print -quit 2>/dev/null || true)"
  if [[ -n "$FORBIDDEN_UNIX_PIKAFISH" ]]; then
    echo "Refusing non-Windows Pikafish executable: $FORBIDDEN_UNIX_PIKAFISH" >&2
    exit 1
  fi
fi

echo "Verified embedded engines and NNUE resources for $TARGET_PLATFORM:"
echo "  Pikafish source revision: $EXPECTED_PIKAFISH_SOURCE_REVISION"
echo "  Pikafish NNUE: $EXPECTED_PIKAFISH_NNUE_LABEL ($EXPECTED_PIKAFISH_NNUE_SHA256)"
find "$PIKAFISH_RESOURCE_DIR" -maxdepth 1 -type f -print
