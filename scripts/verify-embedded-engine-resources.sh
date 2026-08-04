#!/usr/bin/env bash
set -euo pipefail

TARGET_PLATFORM="${1:?Usage: verify-embedded-engine-resources.sh <macos-arm64|macos-x64|windows-x64|linux-x64>}"
PIKAFISH_RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
FAIRY_RESOURCE_DIR="apps/desktop/src-tauri/resources/fairy-stockfish"
FAIRY_XIANGQI_NNUE_NAME="xiangqi-c07e94a5c7cb.nnue"
EXPECTED_PIKAFISH_RELEASE_LABEL="Pikafish-20260726"
EXPECTED_PIKAFISH_VERSION_MARKER="Pikafish dev-20260726-b2180562"
EXPECTED_PIKAFISH_MACOS_SHA256="8bc6653c922681789f271c6f89990befe859e541d609a9899ea29b1e8cc336d2"
EXPECTED_PIKAFISH_WINDOWS_SHA256="9ae4dc1201ad1fc0eb5ba0405c8e663b135f56223a1e721104d38562c9b51b20"
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
  if [[ "$output" != *"$EXPECTED_PIKAFISH_VERSION_MARKER"* ]]; then
    echo "Pikafish runtime version mismatch for $TARGET_PLATFORM." >&2
    echo "Expected marker: $EXPECTED_PIKAFISH_VERSION_MARKER ($EXPECTED_PIKAFISH_RELEASE_LABEL)" >&2
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
    require_executable "$FAIRY_RESOURCE_DIR/fairy-stockfish" "Fairy-Stockfish executable for $TARGET_PLATFORM"
    if [[ "$TARGET_PLATFORM" == macos-* ]]; then
      require_sha256 "$PIKAFISH_EXECUTABLE" "$EXPECTED_PIKAFISH_MACOS_SHA256" "Pikafish $EXPECTED_PIKAFISH_RELEASE_LABEL macOS executable"
    fi
    ;;
  windows-x64)
    PIKAFISH_EXECUTABLE="$PIKAFISH_RESOURCE_DIR/pikafish.exe"
    require_file "$PIKAFISH_EXECUTABLE" "Pikafish executable for Windows x64"
    require_sha256 "$PIKAFISH_EXECUTABLE" "$EXPECTED_PIKAFISH_WINDOWS_SHA256" "Pikafish $EXPECTED_PIKAFISH_RELEASE_LABEL Windows executable"
    require_file "$FAIRY_RESOURCE_DIR/fairy-stockfish.exe" "Fairy-Stockfish executable for Windows x64"
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

require_file "$PIKAFISH_RESOURCE_DIR/pikafish.nnue" "Pikafish NNUE"
require_sha256 "$PIKAFISH_RESOURCE_DIR/pikafish.nnue" "$EXPECTED_PIKAFISH_NNUE_SHA256" "Pikafish NNUE $EXPECTED_PIKAFISH_NNUE_LABEL"
require_pikafish_runtime_metadata "$PIKAFISH_EXECUTABLE"
require_file "$FAIRY_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME" "Fairy-Stockfish Xiangqi NNUE"
reject_mixed_nnue "$PIKAFISH_RESOURCE_DIR" 'xiangqi-*.nnue' "Pikafish"
reject_mixed_nnue "$FAIRY_RESOURCE_DIR" 'pikafish*.nnue' "Fairy-Stockfish"

echo "Verified embedded engines and NNUE resources for $TARGET_PLATFORM:"
echo "  Pikafish release: $EXPECTED_PIKAFISH_RELEASE_LABEL"
echo "  Pikafish runtime: $EXPECTED_PIKAFISH_VERSION_MARKER"
echo "  Pikafish NNUE: $EXPECTED_PIKAFISH_NNUE_LABEL ($EXPECTED_PIKAFISH_NNUE_SHA256)"
find "$PIKAFISH_RESOURCE_DIR" "$FAIRY_RESOURCE_DIR" -maxdepth 1 -type f -print
