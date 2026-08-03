#!/usr/bin/env bash
set -euo pipefail

TARGET_PLATFORM="${1:?Usage: prepare-pikafish-resource.sh <macos-arm64|macos-x64|linux-x64|windows-x64>}"
PIKAFISH_VERSION="${PIKAFISH_VERSION:-latest}"
PIKAFISH_TAG="${PIKAFISH_TAG:-}"
PIKAFISH_ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
PIKAFISH_NNUE_SOURCE="${PIKAFISH_NNUE_SOURCE:-}"
PIKAFISH_NNUE_URL="${PIKAFISH_NNUE_URL:-}"
PIKAFISH_METADATA_DIR="${PIKAFISH_METADATA_DIR:-}"
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

find_by_name() {
  local root="$1"
  local name="$2"
  if [[ -z "$root" || ! -d "$root" ]]; then
    return 0
  fi
  find "$root" -type f -name "$name" -print -quit 2>/dev/null || true
}

first_existing() {
  local candidate
  for candidate in "$@"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

SOURCE_ROOT="$PIKAFISH_METADATA_DIR"
if [[ -z "$PIKAFISH_ENGINE_SOURCE" || -z "$PIKAFISH_NNUE_SOURCE" || -z "$SOURCE_ROOT" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI 'gh' is required to download Pikafish release assets." >&2
    exit 1
  fi
  if ! command -v 7z >/dev/null 2>&1; then
    echo "7z is required to extract Pikafish release assets." >&2
    exit 1
  fi

  if [[ -z "$PIKAFISH_TAG" ]]; then
    if [[ "$PIKAFISH_VERSION" == "latest" ]]; then
      PIKAFISH_TAG="$(gh release view --repo official-pikafish/Pikafish --json tagName --jq '.tagName')"
    else
      PIKAFISH_TAG="Pikafish-${PIKAFISH_VERSION}"
    fi
  fi
  echo "Using Pikafish release tag: $PIKAFISH_TAG"

  gh release download "$PIKAFISH_TAG" \
    --repo official-pikafish/Pikafish \
    --pattern '*.7z' \
    --pattern '*.zip' \
    --dir "$ARCHIVE_DIR" \
    --clobber

  ARCHIVE_PATH="$(find "$ARCHIVE_DIR" \( -name '*.7z' -o -name '*.zip' \) -type f | head -n 1)"
  if [[ -z "$ARCHIVE_PATH" ]]; then
    echo "No Pikafish archive asset found for ${PIKAFISH_TAG}." >&2
    exit 1
  fi

  SEVEN_ZIP_EXTRACT_DIR="$EXTRACT_DIR"
  if command -v cygpath >/dev/null 2>&1; then
    SEVEN_ZIP_EXTRACT_DIR="$(cygpath --windows "$EXTRACT_DIR")"
  fi
  7z x "$ARCHIVE_PATH" -o"$SEVEN_ZIP_EXTRACT_DIR" -y >/dev/null
  SOURCE_ROOT="${SOURCE_ROOT:-$EXTRACT_DIR}"
fi

if [[ -z "$PIKAFISH_NNUE_SOURCE" && -n "$PIKAFISH_NNUE_URL" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download PIKAFISH_NNUE_URL." >&2
    exit 1
  fi
  PIKAFISH_NNUE_SOURCE="$WORK_DIR/pikafish.nnue"
  curl -L --fail --silent --show-error "$PIKAFISH_NNUE_URL" -o "$PIKAFISH_NNUE_SOURCE"
fi

if [[ -z "$PIKAFISH_NNUE_SOURCE" ]]; then
  PIKAFISH_NNUE_SOURCE="$(find_by_name "$SOURCE_ROOT" 'pikafish.nnue')"
fi
if [[ -z "$PIKAFISH_NNUE_SOURCE" || ! -f "$PIKAFISH_NNUE_SOURCE" ]]; then
  echo "Cannot find pikafish.nnue. Set PIKAFISH_NNUE_SOURCE=/absolute/path/to/pikafish.nnue or PIKAFISH_NNUE_URL=https://..." >&2
  exit 1
fi

mkdir -p "$RESOURCE_DIR"

case "$TARGET_PLATFORM" in
  macos-arm64)
    ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
    if [[ -z "$ENGINE_SOURCE" ]]; then
      ENGINE_SOURCE="$(first_existing \
        "$(find_by_name "$SOURCE_ROOT" 'pikafish-apple-silicon')" \
        "$(find_by_name "$SOURCE_ROOT" 'Pikafish-MacOS-universal')" || true)"
    fi
    ENGINE_TARGET="$RESOURCE_DIR/pikafish"
    ;;
  macos-x64)
    ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
    if [[ -z "$ENGINE_SOURCE" ]]; then
      ENGINE_SOURCE="$(first_existing "$(find_by_name "$SOURCE_ROOT" 'Pikafish-MacOS-universal')" || true)"
    fi
    ENGINE_TARGET="$RESOURCE_DIR/pikafish"
    ;;
  linux-x64)
    ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
    if [[ -z "$ENGINE_SOURCE" ]]; then
      ENGINE_SOURCE="$(first_existing \
        "$(find_by_name "$SOURCE_ROOT" 'pikafish-sse41-popcnt')" \
        "$(find_by_name "$SOURCE_ROOT" 'Pikafish-Linux-x86-64-universal')" || true)"
    fi
    ENGINE_TARGET="$RESOURCE_DIR/pikafish"
    ;;
  windows-x64)
    ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
    if [[ -z "$ENGINE_SOURCE" ]]; then
      ENGINE_SOURCE="$(first_existing \
        "$(find_by_name "$SOURCE_ROOT" 'pikafish-sse41-popcnt.exe')" \
        "$(find_by_name "$SOURCE_ROOT" 'Pikafish-Windows-x86-64-universal.exe')" || true)"
    fi
    ENGINE_TARGET="$RESOURCE_DIR/pikafish.exe"
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENGINE_SOURCE" ]]; then
  echo "Missing Pikafish executable for $TARGET_PLATFORM: $ENGINE_SOURCE" >&2
  exit 1
fi
cp "$ENGINE_SOURCE" "$ENGINE_TARGET"
chmod +x "$ENGINE_TARGET" 2>/dev/null || true

if [[ "$TARGET_PLATFORM" == macos-* && -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Signing embedded Pikafish engine: $ENGINE_TARGET"
  codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$ENGINE_TARGET"
  codesign --verify --strict --verbose=2 "$ENGINE_TARGET"
fi

cp "$PIKAFISH_NNUE_SOURCE" "$RESOURCE_DIR/pikafish.nnue"

COPYING_SOURCE="$(first_existing "$(find_by_name "$SOURCE_ROOT" 'Copying.txt')" "$(find_by_name "$SOURCE_ROOT" 'COPYING')" "$(find_by_name "$SOURCE_ROOT" 'LICENSE')" || true)"
NNUE_LICENSE_SOURCE="$(find_by_name "$SOURCE_ROOT" 'NNUE-License.md')"
README_SOURCE="$(find_by_name "$SOURCE_ROOT" 'README.md')"

if [[ -n "$COPYING_SOURCE" ]]; then
  cp "$COPYING_SOURCE" "$RESOURCE_DIR/Copying.txt"
fi
if [[ -n "$NNUE_LICENSE_SOURCE" ]]; then
  cp "$NNUE_LICENSE_SOURCE" "$RESOURCE_DIR/NNUE-License.md"
fi
if [[ -n "$README_SOURCE" ]]; then
  cp "$README_SOURCE" "$RESOURCE_DIR/Pikafish-README.md"
fi

find "$RESOURCE_DIR" -maxdepth 1 -type f -print
