#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root_dir/apps/endgame-training"

for required in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing $required. Signed APK builds require all Android signing variables." >&2
    exit 1
  fi
done

if [[ -z "${JAVA_HOME:-}" && "$(uname)" == "Darwin" ]]; then
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
export ANDROID_VERSION_NAME="${ANDROID_VERSION_NAME:-1.0.1}"
export ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-10001}"

cd "$app_dir/android"
./gradlew :app:assembleRelease

apk_path="$app_dir/android/app/build/outputs/apk/release/app-release.apk"
test -f "$apk_path"
echo "Signed training APK: $apk_path"
