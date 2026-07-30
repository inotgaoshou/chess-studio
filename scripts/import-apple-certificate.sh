#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Apple certificate import is only supported on macOS runners." >&2
  exit 1
fi

: "${APPLE_CERTIFICATE:?Set APPLE_CERTIFICATE to a base64-encoded Developer ID .p12 certificate.}"
: "${APPLE_CERTIFICATE_PASSWORD:?Set APPLE_CERTIFICATE_PASSWORD to the .p12 password.}"

KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(uuidgen)}"
KEYCHAIN_PATH="${KEYCHAIN_PATH:-${RUNNER_TEMP:-/tmp}/xiangqi-studio-signing.keychain-db}"
CERTIFICATE_PATH="${CERTIFICATE_PATH:-${RUNNER_TEMP:-/tmp}/xiangqi-studio-developer-id.p12}"

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$CERTIFICATE_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERTIFICATE_PATH" \
  -P "$APPLE_CERTIFICATE_PASSWORD" \
  -A \
  -t cert \
  -f pkcs12 \
  -k "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" "$(security list-keychains -d user | sed 's/[ "]//g')"
security default-keychain -s "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

rm -f "$CERTIFICATE_PATH"

echo "Developer ID certificate imported into temporary keychain: $KEYCHAIN_PATH"
