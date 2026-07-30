#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS notarization requires macOS and Xcode command line tools." >&2
  exit 1
fi

: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to your Developer ID Application identity.}"

has_api_key=0
if [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  has_api_key=1
fi

if [[ "$has_api_key" != "1" ]]; then
  : "${APPLE_ID:?Set APPLE_ID or APPLE_API_ISSUER/APPLE_API_KEY/APPLE_API_KEY_PATH for notarization.}"
  : "${APPLE_PASSWORD:?Set APPLE_PASSWORD to an app-specific password for notarization.}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID for notarization.}"
fi

mapfile -t DMG_FILES < <(find target/release/bundle/dmg -maxdepth 1 -type f -name '*.dmg' | sort)
if [[ "${#DMG_FILES[@]}" -eq 0 ]]; then
  echo "No DMG files found in target/release/bundle/dmg." >&2
  exit 1
fi

submit_with_notarytool() {
  local dmg_path="$1"
  if [[ "$has_api_key" == "1" ]]; then
    xcrun notarytool submit "$dmg_path" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait
  else
    xcrun notarytool submit "$dmg_path" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
  fi
}

for dmg in "${DMG_FILES[@]}"; do
  echo "Signing DMG: $dmg"
  codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"

  echo "Submitting DMG for Apple notarization: $dmg"
  submit_with_notarytool "$dmg"

  echo "Stapling notarization ticket: $dmg"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
done

echo "macOS notarization complete."
