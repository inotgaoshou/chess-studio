#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release verification requires macOS." >&2
  exit 1
fi

APP_PATH="${APP_PATH:-target/release/bundle/macos/Xiangqi Studio.app}"
DMG_DIR="${DMG_DIR:-target/release/bundle/dmg}"
REQUIRE_GATEKEEPER="${REQUIRE_GATEKEEPER:-1}"

if [[ ! -d "$APP_PATH" && "$REQUIRE_GATEKEEPER" == "1" ]]; then
  echo "Missing app bundle: $APP_PATH" >&2
  exit 1
fi

if [[ "$REQUIRE_GATEKEEPER" == "1" ]]; then
  echo "Verifying app code signature: $APP_PATH"
  codesign --verify --deep --strict --verbose=4 "$APP_PATH"

  echo "Inspecting app signing identity:"
  codesign -dv --verbose=4 "$APP_PATH" 2>&1 | sed -n '/Authority=/p;/TeamIdentifier=/p;/Runtime Version=/p'

  echo "Checking app with Gatekeeper:"
  spctl -a -vvv -t exec "$APP_PATH"
else
  echo "Skipping code-signature and Gatekeeper checks for unsigned local build."
  if [[ ! -d "$APP_PATH" ]]; then
    echo "App bundle not present after bundling; continuing with DMG verification only."
  fi
fi

DMG_FILES=()
while IFS= read -r dmg; do
  DMG_FILES+=("$dmg")
done < <(find "$DMG_DIR" -maxdepth 1 -type f -name '*.dmg' | sort)
if [[ "${#DMG_FILES[@]}" -eq 0 ]]; then
  echo "No DMG files found in $DMG_DIR." >&2
  exit 1
fi

for dmg in "${DMG_FILES[@]}"; do
  echo "Verifying DMG checksum: $dmg"
  hdiutil verify "$dmg"

  echo "Inspecting DMG signing identity:"
  codesign -dv --verbose=4 "$dmg" 2>&1 | sed -n '/Authority=/p;/TeamIdentifier=/p' || true

  if [[ "$REQUIRE_GATEKEEPER" == "1" ]]; then
    echo "Validating stapled notarization ticket: $dmg"
    xcrun stapler validate "$dmg"

    echo "Checking DMG with Gatekeeper:"
    spctl -a -vvv -t open "$dmg"
  fi
done

echo "macOS release verification complete."
