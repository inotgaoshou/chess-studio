#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root_dir/apps/endgame-training"
signing_dir="${ENDGAME_SIGNING_DIR:-$HOME/.config/xiangqi-endgame-training}"
keychain_service="${ENDGAME_SIGNING_KEYCHAIN_SERVICE:-Xiangqi Endgame Training Release}"

keychain_password() {
  /usr/bin/security find-generic-password -s "$keychain_service" -a "$1" -w 2>/dev/null || true
}

# A local release key is kept outside the repository. CI can continue to pass
# the standard ANDROID_KEYSTORE_* variables instead of using this fallback.
if [[ -z "${ANDROID_KEYSTORE_PATH:-}" && -f "$signing_dir/release.jks" ]]; then
  export ANDROID_KEYSTORE_PATH="$signing_dir/release.jks"
fi
if [[ -z "${ANDROID_KEY_ALIAS:-}" && -n "$(keychain_password key-alias)" ]]; then
  export ANDROID_KEY_ALIAS="$(keychain_password key-alias)"
fi
if [[ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]]; then
  export ANDROID_KEYSTORE_PASSWORD="$(keychain_password store-password)"
fi
if [[ -z "${ANDROID_KEY_PASSWORD:-}" ]]; then
  export ANDROID_KEY_PASSWORD="$(keychain_password key-password)"
fi

for required in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing $required. Signed APK builds require all Android signing variables." >&2
    exit 1
  fi
done

java_version=""
if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
  java_version="$($JAVA_HOME/bin/java -version 2>&1 | awk -F '[\".]' '/version/ { print $2; exit }')"
fi
if [[ ( -z "$java_version" || "$java_version" -lt 21 ) && "$(uname)" == "Darwin" ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
fi
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21.}"
java_version="$($JAVA_HOME/bin/java -version 2>&1 | awk -F '[\".]' '/version/ { print $2; exit }')"
if [[ -z "$java_version" || "$java_version" -lt 21 ]]; then
  echo "JDK 21 or newer is required; JAVA_HOME currently resolves to $JAVA_HOME." >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f "$app_dir/android/local.properties" ]]; then
  echo "Android SDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT), or set sdk.dir in apps/endgame-training/android/local.properties." >&2
  exit 1
fi
engine_path="$app_dir/android/app/src/main/jniLibs/arm64-v8a/libpikafish.so"
nnue_path="$app_dir/android/app/src/main/assets/pikafish/pikafish.nnue"
resource_dir="$app_dir/android/app/src/main/assets/pikafish"
expected_engine_sha256="6c06b8752e10c1ed605fa836d2c9bbf885e9c402b216023040ddf4586f4320b1"
expected_nnue_sha256="7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e"
expected_source_revision="4c17cee11f888ae1d48a9494f2e2239f019f0a1f"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_file() {
  local path="$1"
  local description="$2"
  if [[ ! -f "$path" ]]; then
    echo "Missing $description: $path" >&2
    exit 1
  fi
}

require_text() {
  local path="$1"
  local expected="$2"
  local description="$3"
  if ! grep -Fq "$expected" "$path"; then
    echo "$description does not mention expected text." >&2
    echo "  file: $path" >&2
    echo "  expected text: $expected" >&2
    exit 1
  fi
}

reject_forbidden_resource() {
  local path="$1"
  local description="$2"
  if [[ -n "$path" ]]; then
    echo "Refusing forbidden Android engine resource in $description: $path" >&2
    exit 1
  fi
}

for resource in "$engine_path" "$nnue_path"; do
  if [[ ! -f "$resource" ]]; then
    echo "Missing Android Pikafish resource: $resource" >&2
    exit 1
  fi
done
require_file "$resource_dir/Copying.txt" "Android bundled Pikafish GPLv3 license"
require_file "$resource_dir/NNUE-License.md" "Android bundled Pikafish NNUE license"
require_file "$resource_dir/RESOURCE-MANIFEST.txt" "Android bundled Pikafish resource manifest"
require_file "$root_dir/THIRD_PARTY_NOTICES.md" "third-party notices"
require_file "$app_dir/README.md" "endgame training release notes"
require_text "$resource_dir/Copying.txt" "GNU GENERAL PUBLIC LICENSE" "Android bundled Pikafish GPLv3 license"
require_text "$resource_dir/NNUE-License.md" "Pikafish weights" "Android bundled Pikafish NNUE license"
require_text "$resource_dir/RESOURCE-MANIFEST.txt" "$expected_source_revision" "Android bundled Pikafish resource manifest"
require_text "$resource_dir/RESOURCE-MANIFEST.txt" "$expected_engine_sha256" "Android bundled Pikafish resource manifest"
require_text "$resource_dir/RESOURCE-MANIFEST.txt" "$expected_nnue_sha256" "Android bundled Pikafish resource manifest"
require_text "$root_dir/THIRD_PARTY_NOTICES.md" "$expected_source_revision" "third-party notices"
require_text "$root_dir/THIRD_PARTY_NOTICES.md" "$expected_engine_sha256" "third-party notices"
require_text "$root_dir/THIRD_PARTY_NOTICES.md" "$expected_nnue_sha256" "third-party notices"
require_text "$app_dir/README.md" "GPLv3" "endgame training release notes"
if [[ "$(sha256_file "$engine_path")" != "$expected_engine_sha256" ]]; then
  echo "Android Pikafish executable SHA-256 mismatch." >&2
  exit 1
fi
if [[ "$(sha256_file "$nnue_path")" != "$expected_nnue_sha256" ]]; then
  echo "Android Pikafish NNUE SHA-256 mismatch." >&2
  exit 1
fi
reject_forbidden_resource "$(find "$resource_dir" -maxdepth 1 -type f \( -iname '*fairy*' -o -iname '*stockfish*' -o -iname '*.nnue' ! -name 'pikafish.nnue' \) -print -quit 2>/dev/null || true)" "$resource_dir"
reject_forbidden_resource "$(find "$app_dir/android/app/src/main/jniLibs" -type f \( -iname '*fairy*' -o -iname '*stockfish*' \) -print -quit 2>/dev/null || true)" "jniLibs"

export ANDROID_VERSION_NAME="${ANDROID_VERSION_NAME:-1.0.1}"
export ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-10015}"

cd "$app_dir/android"
./gradlew :app:assembleRelease

apk_path="$app_dir/android/app/build/outputs/apk/release/app-release.apk"
test -f "$apk_path"
versioned_apk_path="$app_dir/android/app/build/outputs/apk/release/app-release-${ANDROID_VERSION_NAME}.apk"
cp "$apk_path" "$versioned_apk_path"
echo "Signed training APK: $apk_path"
echo "Versioned training APK: $versioned_apk_path"
