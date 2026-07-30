#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_BIN="${PNPM_BIN:-pnpm}"
EMBED_PIKAFISH="${EMBED_PIKAFISH:-1}"
SIGN_AND_NOTARIZE="${SIGN_AND_NOTARIZE:-1}"
PIKAFISH_RELEASE_DIR="${PIKAFISH_RELEASE_DIR:-$ROOT_DIR/../Pikafish.2026-01-02}"
PIKAFISH_RESOURCE_DIR="apps/desktop/src-tauri/resources/pikafish"
TAURI_RESOURCE_CONFIG='{"bundle":{"resources":["resources/fonts/OFL.txt","resources/pikafish"]}}'

if [[ "$EMBED_PIKAFISH" == "1" ]]; then
  if [[ ! -x "$PIKAFISH_RELEASE_DIR/MacOS/pikafish-apple-silicon" ]]; then
    echo "Missing Pikafish executable: $PIKAFISH_RELEASE_DIR/MacOS/pikafish-apple-silicon" >&2
    exit 1
  fi
  if [[ ! -f "$PIKAFISH_RELEASE_DIR/pikafish.nnue" ]]; then
    echo "Missing Pikafish NNUE: $PIKAFISH_RELEASE_DIR/pikafish.nnue" >&2
    exit 1
  fi

  mkdir -p "$PIKAFISH_RESOURCE_DIR"
  cp "$PIKAFISH_RELEASE_DIR/MacOS/pikafish-apple-silicon" "$PIKAFISH_RESOURCE_DIR/pikafish"
  cp "$PIKAFISH_RELEASE_DIR/pikafish.nnue" "$PIKAFISH_RESOURCE_DIR/pikafish.nnue"
  cp "$PIKAFISH_RELEASE_DIR/Copying.txt" "$PIKAFISH_RESOURCE_DIR/Copying.txt"
  cp "$PIKAFISH_RELEASE_DIR/NNUE-License.md" "$PIKAFISH_RESOURCE_DIR/NNUE-License.md"
  cp "$PIKAFISH_RELEASE_DIR/README.md" "$PIKAFISH_RESOURCE_DIR/Pikafish-README.md"
  chmod +x "$PIKAFISH_RESOURCE_DIR/pikafish"
  xattr -dr com.apple.quarantine "$PIKAFISH_RESOURCE_DIR" 2>/dev/null || true
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
echo "  target/release/bundle/dmg/Xiangqi Studio_0.1.0_aarch64.dmg"
