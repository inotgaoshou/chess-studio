#!/usr/bin/env bash
set -euo pipefail

TARGET_PLATFORM="${1:?Usage: prepare-pikafish-resource.sh <macos-arm64|macos-x64|linux-x64|windows-x64>}"
PIKAFISH_VERSION="${PIKAFISH_VERSION:-2026-01-02}"
PIKAFISH_TAG="${PIKAFISH_TAG:-Pikafish-${PIKAFISH_VERSION}}"
RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
TEMP_ROOT="${RUNNER_TEMP:-/tmp}"
if command -v cygpath >/dev/null 2>&1; then
  TEMP_ROOT="$(cygpath --unix "$TEMP_ROOT")"
fi
WORK_DIR="$TEMP_ROOT/pikafish-${PIKAFISH_VERSION}-${TARGET_PLATFORM}"
ARCHIVE_DIR="$WORK_DIR/archive"
EXTRACT_DIR="$WORK_DIR/extract"

rm -rf "$WORK_DIR"
mkdir -p "$ARCHIVE_DIR" "$EXTRACT_DIR" "$RESOURCE_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required to download Pikafish release assets." >&2
  exit 1
fi
if ! command -v 7z >/dev/null 2>&1; then
  echo "7z is required to extract Pikafish release assets." >&2
  exit 1
fi

gh release download "$PIKAFISH_TAG" \
  --repo official-pikafish/Pikafish \
  --pattern '*.7z' \
  --dir "$ARCHIVE_DIR" \
  --clobber

ARCHIVE_PATH="$(find "$ARCHIVE_DIR" -name '*.7z' -type f | head -n 1)"
if [[ -z "$ARCHIVE_PATH" ]]; then
  echo "No Pikafish .7z asset found for ${PIKAFISH_TAG}." >&2
  exit 1
fi

SEVEN_ZIP_EXTRACT_DIR="$EXTRACT_DIR"
if command -v cygpath >/dev/null 2>&1; then
  SEVEN_ZIP_EXTRACT_DIR="$(cygpath --windows "$EXTRACT_DIR")"
fi
7z x "$ARCHIVE_PATH" -o"$SEVEN_ZIP_EXTRACT_DIR" -y >/dev/null

NNUE_PATH="$(find "$EXTRACT_DIR" -type f -name 'pikafish.nnue' -print -quit)"
if [[ -z "$NNUE_PATH" ]]; then
  echo "Cannot find pikafish.nnue after extraction in $EXTRACT_DIR." >&2
  exit 1
fi
SOURCE_ROOT="$(dirname "$NNUE_PATH")"

rm -rf "$RESOURCE_DIR"
mkdir -p "$RESOURCE_DIR"

case "$TARGET_PLATFORM" in
  macos-arm64)
    ENGINE_SOURCE="$SOURCE_ROOT/MacOS/pikafish-apple-silicon"
    ENGINE_TARGET="$RESOURCE_DIR/pikafish"
    ;;
  macos-x64)
    echo "Pikafish ${PIKAFISH_VERSION} release does not include a generic Intel macOS engine; packaging app without embedded engine." >&2
    ENGINE_SOURCE=""
    ENGINE_TARGET=""
    ;;
  linux-x64)
    ENGINE_SOURCE="$SOURCE_ROOT/Linux/pikafish-sse41-popcnt"
    ENGINE_TARGET="$RESOURCE_DIR/pikafish"
    ;;
  windows-x64)
    ENGINE_SOURCE="$SOURCE_ROOT/Windows/pikafish-sse41-popcnt.exe"
    ENGINE_TARGET="$RESOURCE_DIR/pikafish.exe"
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

if [[ -n "$ENGINE_SOURCE" ]]; then
  if [[ ! -f "$ENGINE_SOURCE" ]]; then
    echo "Missing engine executable: $ENGINE_SOURCE" >&2
    exit 1
  fi
  cp "$ENGINE_SOURCE" "$ENGINE_TARGET"
  chmod +x "$ENGINE_TARGET" 2>/dev/null || true

  if [[ "$TARGET_PLATFORM" == macos-* && -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "Signing embedded Pikafish engine: $ENGINE_TARGET"
    codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$ENGINE_TARGET"
    codesign --verify --strict --verbose=2 "$ENGINE_TARGET"
  fi
fi

cp "$NNUE_PATH" "$RESOURCE_DIR/pikafish.nnue"

cp "$SOURCE_ROOT/Copying.txt" "$RESOURCE_DIR/Copying.txt"
cp "$SOURCE_ROOT/NNUE-License.md" "$RESOURCE_DIR/NNUE-License.md"
cp "$SOURCE_ROOT/README.md" "$RESOURCE_DIR/Pikafish-README.md"

find "$RESOURCE_DIR" -maxdepth 1 -type f -print
