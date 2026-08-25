#!/usr/bin/env bash
set -euo pipefail

FAIRY_STOCKFISH_TAG="${FAIRY_STOCKFISH_TAG:-fairy_sf_14_0_1_xq}"
FAIRY_STOCKFISH_RELEASE_DIR="${FAIRY_STOCKFISH_RELEASE_DIR:-}"
FAIRY_XIANGQI_NNUE_NAME="xiangqi-c07e94a5c7cb.nnue"
FAIRY_XIANGQI_NNUE_URL="${FAIRY_XIANGQI_NNUE_URL:-https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish-NNUE/master/${FAIRY_XIANGQI_NNUE_NAME}}"
FAIRY_XIANGQI_NNUE_SHA256="c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11"
ARGUMENT="${1:-}"
if [[ -n "$ARGUMENT" && -d "$ARGUMENT" ]]; then
  FAIRY_STOCKFISH_RELEASE_DIR="${FAIRY_STOCKFISH_RELEASE_DIR:-$ARGUMENT}"
  TARGET_PLATFORM="${TARGET_PLATFORM:-local}"
else
  TARGET_PLATFORM="${ARGUMENT:-${TARGET_PLATFORM:-local}}"
fi
FAIRY_STOCKFISH_MACOS_URL="${FAIRY_STOCKFISH_MACOS_URL:-}"
BUILD_FAIRY_STOCKFISH_FROM_SOURCE="${BUILD_FAIRY_STOCKFISH_FROM_SOURCE:-0}"
RESOURCE_DIR="apps/desktop/src-tauri/resources/fairy-stockfish"
TEMP_ROOT="${RUNNER_TEMP:-/tmp}"
if command -v cygpath >/dev/null 2>&1; then
  TEMP_ROOT="$(cygpath --unix "$TEMP_ROOT")"
fi
WORK_DIR="$TEMP_ROOT/fairy-stockfish-${FAIRY_STOCKFISH_TAG}-${TARGET_PLATFORM}"

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

prepare_resource_dir() {
  rm -rf "$RESOURCE_DIR"
  mkdir -p "$RESOURCE_DIR"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "A SHA-256 utility (shasum or sha256sum) is required to verify Fairy NNUE." >&2
    exit 1
  fi
}

download_official_xiangqi_nnue() {
  local destination="$WORK_DIR/$FAIRY_XIANGQI_NNUE_NAME"
  mkdir -p "$WORK_DIR"
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download the official Fairy-Stockfish Xiangqi NNUE." >&2
    exit 1
  fi
  if ! curl -L --fail --silent --show-error "$FAIRY_XIANGQI_NNUE_URL" -o "$destination"; then
    echo "Failed to download Fairy Xiangqi NNUE from $FAIRY_XIANGQI_NNUE_URL" >&2
    exit 1
  fi
  if [[ ! -f "$destination" ]]; then
    echo "Fairy Xiangqi NNUE download did not create $destination" >&2
    exit 1
  fi
  local actual_sha256
  actual_sha256="$(sha256_file "$destination")"
  if [[ "$actual_sha256" != "$FAIRY_XIANGQI_NNUE_SHA256" ]]; then
    echo "Fairy Xiangqi NNUE checksum mismatch: expected $FAIRY_XIANGQI_NNUE_SHA256, got $actual_sha256" >&2
    exit 1
  fi
  printf '%s\n' "$destination"
}

copy_fairy_nnue() {
  local nnue_source="${FAIRY_NNUE_SOURCE:-}"
  if [[ -z "$nnue_source" && -n "$FAIRY_STOCKFISH_RELEASE_DIR" ]]; then
    nnue_source="$(find "$FAIRY_STOCKFISH_RELEASE_DIR" -type f -name "$FAIRY_XIANGQI_NNUE_NAME" -print -quit 2>/dev/null || true)"
  fi
  if [[ -n "$nnue_source" && ! -f "$nnue_source" ]]; then
    echo "Fairy-Stockfish NNUE file does not exist: $nnue_source" >&2
    exit 1
  fi
  if [[ -z "$nnue_source" ]]; then
    nnue_source="$(download_official_xiangqi_nnue)"
  fi

  local nnue_basename
  nnue_basename="$(basename "$nnue_source")"
  if [[ "$(lowercase "$nnue_basename")" == *pikafish* ]]; then
    echo "Refusing to bundle Pikafish NNUE as Fairy-Stockfish network: $nnue_basename" >&2
    echo "Use Fairy-Stockfish's own Xiangqi NNUE, or omit FAIRY_NNUE_SOURCE for Fairy XQ binaries with built-in NNUE." >&2
    exit 1
  fi
  cp "$nnue_source" "$RESOURCE_DIR/$nnue_basename"

  if [[ "$nnue_basename" == "$FAIRY_XIANGQI_NNUE_NAME" ]]; then
    local actual_sha256
    actual_sha256="$(sha256_file "$RESOURCE_DIR/$nnue_basename")"
    if [[ "$actual_sha256" != "$FAIRY_XIANGQI_NNUE_SHA256" ]]; then
      echo "Bundled Fairy Xiangqi NNUE checksum mismatch: $actual_sha256" >&2
      exit 1
    fi
  fi
}

copy_optional_notices() {
  if [[ -z "$FAIRY_STOCKFISH_RELEASE_DIR" ]]; then
    return 0
  fi
  for notice in Copying.txt COPYING LICENSE README.md; do
    if [[ -f "$FAIRY_STOCKFISH_RELEASE_DIR/$notice" ]]; then
      cp "$FAIRY_STOCKFISH_RELEASE_DIR/$notice" "$RESOURCE_DIR/Fairy-Stockfish-$notice"
    fi
  done
}

copy_project_notices() {
  cp "LICENSE" "$RESOURCE_DIR/LICENSE-GPL-3.0.txt"
  cp "THIRD_PARTY_NOTICES.md" "$RESOURCE_DIR/THIRD_PARTY_NOTICES.md"
}

find_engine_in_release_dir() {
  local pattern="$1"
  if [[ -z "$FAIRY_STOCKFISH_RELEASE_DIR" ]]; then
    return 0
  fi
  find "$FAIRY_STOCKFISH_RELEASE_DIR" -type f -name "$pattern" -print -quit 2>/dev/null || true
}

download_github_asset() {
  local pattern="$1"
  local output_name="$2"
  local archive_dir="$WORK_DIR/assets"
  rm -rf "$archive_dir"
  mkdir -p "$archive_dir"

  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI 'gh' is required to download Fairy-Stockfish release assets." >&2
    exit 1
  fi

  gh release download "$FAIRY_STOCKFISH_TAG" \
    --repo fairy-stockfish/Fairy-Stockfish \
    --pattern "$pattern" \
    --dir "$archive_dir" \
    --clobber

  local downloaded
  downloaded="$(find "$archive_dir" -type f -name "$pattern" -print -quit)"
  if [[ -z "$downloaded" ]]; then
    echo "No Fairy-Stockfish release asset found for pattern $pattern in $FAIRY_STOCKFISH_TAG." >&2
    exit 1
  fi
  cp "$downloaded" "$RESOURCE_DIR/$output_name"
}

download_macos_binary_from_url() {
  local output_name="$1"
  if [[ -z "$FAIRY_STOCKFISH_MACOS_URL" ]]; then
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download FAIRY_STOCKFISH_MACOS_URL." >&2
    exit 1
  fi
  curl -L "$FAIRY_STOCKFISH_MACOS_URL" -o "$RESOURCE_DIR/$output_name"
}

build_macos_from_source() {
  local output_name="$1"
  local arch="$2"
  if [[ "$BUILD_FAIRY_STOCKFISH_FROM_SOURCE" != "1" ]]; then
    return 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required to build Fairy-Stockfish from source." >&2
    exit 1
  fi
  if ! command -v make >/dev/null 2>&1; then
    echo "make is required to build Fairy-Stockfish from source." >&2
    exit 1
  fi

  local source_dir="$WORK_DIR/source"
  rm -rf "$source_dir"
  git clone --depth 1 --branch "$FAIRY_STOCKFISH_TAG" https://github.com/fairy-stockfish/Fairy-Stockfish.git "$source_dir"
  if command -v gh >/dev/null 2>&1; then
    gh release download "$FAIRY_STOCKFISH_TAG" \
      --repo fairy-stockfish/Fairy-Stockfish \
      --pattern 'xiangqi-*.nnue' \
      --dir "$source_dir/src" \
      --clobber || true
  fi
  # Fairy 14 predates current Apple Clang, which no longer accepts this
  # legacy pass-manager opt-in flag.
  sed -i '' '/-fexperimental-new-pass-manager/d' "$source_dir/src/Makefile"
  make -C "$source_dir/src" -j"$(sysctl -n hw.logicalcpu 2>/dev/null || echo 2)" build COMP=clang ARCH="$arch" largeboards=yes EXE=fairy-stockfish
  cp "$source_dir/src/fairy-stockfish" "$RESOURCE_DIR/$output_name"
}

if [[ "$TARGET_PLATFORM" == "linux-x64" ]]; then
  echo "Skipping embedded Fairy-Stockfish for Linux; users can configure an external engine in app settings."
  mkdir -p "$RESOURCE_DIR"
  find "$RESOURCE_DIR" -maxdepth 1 -type f ! -name 'README.md' -delete
  find "$RESOURCE_DIR" -maxdepth 1 -type f -print
  exit 0
fi

prepare_resource_dir

case "$TARGET_PLATFORM" in
  windows-x64)
    engine_source="${FAIRY_ENGINE_SOURCE:-}"
    if [[ -z "$engine_source" ]]; then
      engine_source="$(find_engine_in_release_dir 'fairy-stockfish-largeboard_x86-64.exe')"
    fi
    if [[ -n "$engine_source" ]]; then
      cp "$engine_source" "$RESOURCE_DIR/fairy-stockfish.exe"
    else
      download_github_asset 'fairy-stockfish-largeboard_x86-64.exe' 'fairy-stockfish.exe'
    fi
    copy_fairy_nnue
    ;;
  macos-arm64)
    engine_source="${FAIRY_ENGINE_SOURCE:-}"
    if [[ -z "$engine_source" ]]; then
      engine_source="$(find_engine_in_release_dir 'fairy-stockfish')"
    fi
    if [[ -n "$engine_source" ]]; then
      cp "$engine_source" "$RESOURCE_DIR/fairy-stockfish"
    elif ! download_macos_binary_from_url 'fairy-stockfish'; then
      build_macos_from_source 'fairy-stockfish' 'apple-silicon' || {
        echo "Missing macOS Apple Silicon Fairy-Stockfish binary." >&2
        echo "Set FAIRY_ENGINE_SOURCE, FAIRY_STOCKFISH_MACOS_URL, or BUILD_FAIRY_STOCKFISH_FROM_SOURCE=1." >&2
        exit 1
      }
    fi
    copy_fairy_nnue
    ;;
  macos-x64)
    engine_source="${FAIRY_ENGINE_SOURCE:-}"
    if [[ -z "$engine_source" ]]; then
      engine_source="$(find_engine_in_release_dir 'fairy-stockfish')"
    fi
    if [[ -n "$engine_source" ]]; then
      cp "$engine_source" "$RESOURCE_DIR/fairy-stockfish"
    elif ! download_macos_binary_from_url 'fairy-stockfish'; then
      build_macos_from_source 'fairy-stockfish' 'x86-64' || {
        echo "Missing macOS Intel Fairy-Stockfish binary." >&2
        echo "Set FAIRY_ENGINE_SOURCE, FAIRY_STOCKFISH_MACOS_URL, or BUILD_FAIRY_STOCKFISH_FROM_SOURCE=1." >&2
        exit 1
      }
    fi
    copy_fairy_nnue
    ;;
  local)
    if [[ -z "$FAIRY_STOCKFISH_RELEASE_DIR" && -z "${FAIRY_ENGINE_SOURCE:-}" ]]; then
      echo "Usage: FAIRY_STOCKFISH_RELEASE_DIR=/path/to/fairy-stockfish ./scripts/prepare-fairy-stockfish-resource.sh" >&2
      echo "   or: FAIRY_ENGINE_SOURCE=/absolute/path/to/fairy-stockfish ./scripts/prepare-fairy-stockfish-resource.sh" >&2
      echo "   or: ./scripts/prepare-fairy-stockfish-resource.sh <macos-arm64|macos-x64|windows-x64|linux-x64>" >&2
      exit 1
    fi
    engine_source="${FAIRY_ENGINE_SOURCE:-}"
    if [[ -z "$engine_source" ]]; then
      engine_source="$(find_engine_in_release_dir 'fairy-stockfish')"
    fi
    if [[ -z "$engine_source" ]]; then
      engine_source="$(find_engine_in_release_dir 'fairy-stockfish.exe')"
    fi
    if [[ -z "$engine_source" || ! -f "$engine_source" ]]; then
      echo "Missing Fairy-Stockfish executable." >&2
      echo "Set FAIRY_ENGINE_SOURCE=/absolute/path/to/fairy-stockfish if the file has a custom name." >&2
      exit 1
    fi
    if [[ "$(lowercase "$engine_source")" == *.exe ]]; then
      cp "$engine_source" "$RESOURCE_DIR/fairy-stockfish.exe"
    else
      cp "$engine_source" "$RESOURCE_DIR/fairy-stockfish"
    fi
    copy_fairy_nnue
    ;;
  *)
    echo "Unknown target platform: $TARGET_PLATFORM" >&2
    exit 1
    ;;
esac

copy_optional_notices
copy_project_notices
chmod +x "$RESOURCE_DIR/fairy-stockfish" 2>/dev/null || true
xattr -dr com.apple.quarantine "$RESOURCE_DIR" 2>/dev/null || true

find "$RESOURCE_DIR" -maxdepth 1 -type f -print
