#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?Usage: build-pikafish-from-source.sh <macos-universal|windows-x64>}"
PIKAFISH_REPOSITORY="https://github.com/official-pikafish/Pikafish.git"
PIKAFISH_SOURCE_REVISION="4c17cee11f888ae1d48a9494f2e2239f019f0a1f"
RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
SOURCE_DIR="${PIKAFISH_SOURCE_DIR:-third_party/pikafish}"
TEMP_SOURCE_DIR=""

cleanup() {
  if [[ -n "$TEMP_SOURCE_DIR" ]]; then
    rm -rf "$TEMP_SOURCE_DIR"
  fi
}
trap cleanup EXIT

if [[ ! -e "$SOURCE_DIR/.git" ]]; then
  TEMP_SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pikafish-source.XXXXXX")"
  SOURCE_DIR="$TEMP_SOURCE_DIR"
  git clone "$PIKAFISH_REPOSITORY" "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --quiet origin "$PIKAFISH_SOURCE_REVISION"
git -C "$SOURCE_DIR" checkout --detach --quiet "$PIKAFISH_SOURCE_REVISION"

SOURCE_ROOT="$(cd "$SOURCE_DIR" && pwd)"
SOURCE_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
if [[ "$SOURCE_SHA" != "$PIKAFISH_SOURCE_REVISION" ]]; then
  echo "Pikafish source revision mismatch: $SOURCE_SHA" >&2
  exit 1
fi

mkdir -p "$RESOURCE_DIR"
cp "$RESOURCE_DIR/pikafish.nnue" "$SOURCE_ROOT/src/pikafish.nnue"

case "$TARGET" in
  macos-universal)
    (
      cd "$SOURCE_ROOT/src"
      make -j3 macos-lipo COMP=clang EXE=pikafish
      make strip COMP=clang EXE=pikafish
      cp pikafish "$OLDPWD/$RESOURCE_DIR/pikafish"
    )
    ;;
  windows-x64)
    (
      cd "$SOURCE_ROOT/src"
      make -j4 build ARCH=x86-64-universal COMP=clang EXE=pikafish.exe
      make strip COMP=clang EXE=pikafish.exe
      cp pikafish.exe "$OLDPWD/$RESOURCE_DIR/pikafish.exe"
    )
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    exit 1
    ;;
esac

printf 'Built Pikafish %s from %s\n' "$TARGET" "$SOURCE_SHA"
