#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_BIN="${PNPM_BIN:-pnpm}"
EMBED_PIKAFISH="${EMBED_PIKAFISH:-1}"
EMBED_FAIRY_STOCKFISH="${EMBED_FAIRY_STOCKFISH:-1}"
BUILD_FAIRY_STOCKFISH_FROM_SOURCE="${BUILD_FAIRY_STOCKFISH_FROM_SOURCE:-1}"
SIGN_AND_NOTARIZE="${SIGN_AND_NOTARIZE:-1}"
PIKAFISH_RELEASE_DIR="${PIKAFISH_RELEASE_DIR:-$ROOT_DIR/../Pikafish.2026-01-02}"
PIKAFISH_ENGINE_SOURCE="${PIKAFISH_ENGINE_SOURCE:-}"
PIKAFISH_NNUE_SOURCE="${PIKAFISH_NNUE_SOURCE:-}"
PIKAFISH_METADATA_DIR="${PIKAFISH_METADATA_DIR:-}"
FAIRY_STOCKFISH_RELEASE_DIR="${FAIRY_STOCKFISH_RELEASE_DIR:-$ROOT_DIR/apps/desktop/src-tauri/resources/fairy-stockfish}"
PIKAFISH_RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
FAIRY_STOCKFISH_RESOURCE_DIR="$ROOT_DIR/apps/desktop/src-tauri/resources/fairy-stockfish"
FAIRY_XIANGQI_NNUE_NAME="xiangqi-c07e94a5c7cb.nnue"
TAURI_RESOURCE_CONFIG='{"bundle":{"resources":["resources/fonts/OFL.txt","resources/pikafish","resources/fairy-stockfish"]}}'

if [[ "$EMBED_PIKAFISH" == "1" ]]; then
  PIKAFISH_RESOURCE_ENGINE="$PIKAFISH_RESOURCE_DIR/pikafish"
  PIKAFISH_RESOURCE_NNUE="$PIKAFISH_RESOURCE_DIR/pikafish.nnue"

  if [[ -z "$PIKAFISH_ENGINE_SOURCE" && -z "$PIKAFISH_NNUE_SOURCE" && -f "$PIKAFISH_RESOURCE_ENGINE" && -f "$PIKAFISH_RESOURCE_NNUE" ]]; then
    echo "Using committed Pikafish resources from $PIKAFISH_RESOURCE_DIR"
  else
    if [[ -z "$PIKAFISH_ENGINE_SOURCE" ]]; then
      PIKAFISH_ENGINE_SOURCE="$PIKAFISH_RELEASE_DIR/MacOS/pikafish-apple-silicon"
    fi
    if [[ -z "$PIKAFISH_NNUE_SOURCE" ]]; then
      PIKAFISH_NNUE_SOURCE="$PIKAFISH_RELEASE_DIR/pikafish.nnue"
    fi
    if [[ -z "$PIKAFISH_METADATA_DIR" ]]; then
      PIKAFISH_METADATA_DIR="$PIKAFISH_RELEASE_DIR"
    fi

    if [[ ! -f "$PIKAFISH_ENGINE_SOURCE" ]]; then
      echo "Missing Pikafish executable: $PIKAFISH_ENGINE_SOURCE" >&2
      exit 1
    fi
    if [[ ! -f "$PIKAFISH_NNUE_SOURCE" ]]; then
      echo "Missing Pikafish NNUE: $PIKAFISH_NNUE_SOURCE" >&2
      exit 1
    fi

    mkdir -p "$PIKAFISH_RESOURCE_DIR"
    cp "$PIKAFISH_ENGINE_SOURCE" "$PIKAFISH_RESOURCE_ENGINE"
    cp "$PIKAFISH_NNUE_SOURCE" "$PIKAFISH_RESOURCE_NNUE"
    if [[ -f "$PIKAFISH_METADATA_DIR/Copying.txt" ]]; then
      cp "$PIKAFISH_METADATA_DIR/Copying.txt" "$PIKAFISH_RESOURCE_DIR/Copying.txt"
    fi
    if [[ -f "$PIKAFISH_METADATA_DIR/NNUE-License.md" ]]; then
      cp "$PIKAFISH_METADATA_DIR/NNUE-License.md" "$PIKAFISH_RESOURCE_DIR/NNUE-License.md"
    fi
    if [[ -f "$PIKAFISH_METADATA_DIR/README.md" ]]; then
      cp "$PIKAFISH_METADATA_DIR/README.md" "$PIKAFISH_RESOURCE_DIR/Pikafish-README.md"
    fi
  fi

  chmod +x "$PIKAFISH_RESOURCE_ENGINE"
  xattr -dr com.apple.quarantine "$PIKAFISH_RESOURCE_DIR" 2>/dev/null || true
fi

if [[ "$EMBED_FAIRY_STOCKFISH" == "1" ]]; then
  mkdir -p "$FAIRY_STOCKFISH_RESOURCE_DIR"
  if [[ ! -x "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish" || ! -f "$FAIRY_STOCKFISH_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME" ]]; then
    PREPARE_RELEASE_DIR="$FAIRY_STOCKFISH_RELEASE_DIR"
    if [[ "$PREPARE_RELEASE_DIR" == "$FAIRY_STOCKFISH_RESOURCE_DIR" ]]; then
      PREPARE_RELEASE_DIR=""
    fi
    FAIRY_STOCKFISH_RELEASE_DIR="$PREPARE_RELEASE_DIR" \
      BUILD_FAIRY_STOCKFISH_FROM_SOURCE="$BUILD_FAIRY_STOCKFISH_FROM_SOURCE" \
      ./scripts/prepare-fairy-stockfish-resource.sh macos-arm64
  fi
  FAIRY_NNUE_SOURCE="$FAIRY_STOCKFISH_RELEASE_DIR/$FAIRY_XIANGQI_NNUE_NAME"
  if [[ "$FAIRY_STOCKFISH_RELEASE_DIR" == "$FAIRY_STOCKFISH_RESOURCE_DIR" ]]; then
    FAIRY_NNUE_SOURCE="$FAIRY_STOCKFISH_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME"
  fi
  if [[ ! -f "$FAIRY_NNUE_SOURCE" ]]; then
    echo "Missing Fairy Xiangqi NNUE: $FAIRY_NNUE_SOURCE" >&2
    echo "Run ./scripts/prepare-fairy-stockfish-resource.sh macos-arm64 first." >&2
    exit 1
  fi
  FAIRY_SOURCE=""
  for candidate in \
    "$FAIRY_STOCKFISH_RELEASE_DIR/fairy-stockfish" \
    "$FAIRY_STOCKFISH_RELEASE_DIR/fairy-stockfish.exe" \
    "${FAIRY_STOCKFISH_PATH:-}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      FAIRY_SOURCE="$candidate"
      break
    fi
  done
  if [[ -n "$FAIRY_SOURCE" ]]; then
    if [[ "$FAIRY_SOURCE" != "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish" ]]; then
      cp "$FAIRY_SOURCE" "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish"
    fi
    if [[ "$FAIRY_NNUE_SOURCE" != "$FAIRY_STOCKFISH_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME" ]]; then
      cp "$FAIRY_NNUE_SOURCE" "$FAIRY_STOCKFISH_RESOURCE_DIR/$FAIRY_XIANGQI_NNUE_NAME"
    fi
    chmod +x "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish"
    xattr -dr com.apple.quarantine "$FAIRY_STOCKFISH_RESOURCE_DIR" 2>/dev/null || true
  else
    echo "Missing Fairy-Stockfish executable; set FAIRY_STOCKFISH_RELEASE_DIR or FAIRY_STOCKFISH_PATH to embed it." >&2
    exit 1
  fi
fi

if [[ "$EMBED_PIKAFISH" == "1" && "$EMBED_FAIRY_STOCKFISH" == "1" ]]; then
  ./scripts/verify-embedded-engine-resources.sh macos-arm64
fi

if [[ "$SIGN_AND_NOTARIZE" == "1" ]]; then
  : "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to your Developer ID Application identity.}"
  if [[ -z "${APPLE_API_ISSUER:-}" || -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_KEY_PATH:-}" ]]; then
    if [[ -z "${APPLE_ID:-}" || -z "${APPLE_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
      echo "Set either APPLE_API_ISSUER/APPLE_API_KEY/APPLE_API_KEY_PATH or APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID for notarization." >&2
      exit 1
    fi
  fi

  security find-identity -v -p codesigning | grep -F "$APPLE_SIGNING_IDENTITY" >/dev/null || {
    echo "Signing identity not found in Keychain: $APPLE_SIGNING_IDENTITY" >&2
    security find-identity -v -p codesigning >&2
    exit 1
  }

  if [[ -x "$PIKAFISH_RESOURCE_DIR/pikafish" ]]; then
    echo "Signing embedded Pikafish engine: $PIKAFISH_RESOURCE_DIR/pikafish"
    codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$PIKAFISH_RESOURCE_DIR/pikafish"
    codesign --verify --strict --verbose=2 "$PIKAFISH_RESOURCE_DIR/pikafish"
  fi
  if [[ -x "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish" ]]; then
    echo "Signing embedded Fairy-Stockfish engine: $FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish"
    codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish"
    codesign --verify --strict --verbose=2 "$FAIRY_STOCKFISH_RESOURCE_DIR/fairy-stockfish"
  fi
fi

if [[ "$PNPM_BIN" == *.cjs ]]; then
  PNPM_COMMAND=(node "$PNPM_BIN")
else
  PNPM_COMMAND=("$PNPM_BIN")
fi

CI=true "${PNPM_COMMAND[@]}" --filter xiangqi-desktop-ui tauri build --config "$TAURI_RESOURCE_CONFIG"

if [[ "$SIGN_AND_NOTARIZE" == "1" ]]; then
  ./scripts/notarize-macos-release.sh
  ./scripts/verify-macos-release.sh
else
  REQUIRE_GATEKEEPER=0 ./scripts/verify-macos-release.sh
fi

echo "Done:"
echo "  target/release/bundle/macos/Xiangqi Studio.app"
find target/release/bundle/dmg -maxdepth 1 -name 'Xiangqi Studio_*.dmg' -print 2>/dev/null || true
