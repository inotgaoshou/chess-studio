#!/usr/bin/env bash
set -euo pipefail

release_target="${1:-web}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$repo_root/apps/desktop"
pnpm_bin="${PNPM_BIN:-pnpm}"
report_json="$repo_root/mobile-package-size-report.json"
report_md="$repo_root/mobile-package-size-report.md"

ensure_android_project() {
  if [ ! -d "$app_dir/android" ]; then
    "$pnpm_bin" --dir "$app_dir" exec cap add android
  fi
}

ensure_ios_project() {
  if [ ! -d "$app_dir/ios" ]; then
    "$pnpm_bin" --dir "$app_dir" exec cap add ios
  fi
}

android_signing_configured() {
  [ -n "${ANDROID_KEYSTORE_PATH:-}" ] \
    && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] \
    && [ -n "${ANDROID_KEY_ALIAS:-}" ] \
    && [ -n "${ANDROID_KEY_PASSWORD:-}" ]
}

build_signed_android() {
  local release_type="$1"
  "$pnpm_bin" --dir "$app_dir" exec cap build android \
    --androidreleasetype "$release_type" \
    --signing-type apksigner \
    --keystorepath "$ANDROID_KEYSTORE_PATH" \
    --keystorepass "$ANDROID_KEYSTORE_PASSWORD" \
    --keystorealias "$ANDROID_KEY_ALIAS" \
    --keystorealiaspass "$ANDROID_KEY_PASSWORD"
}

run_android_gradle() {
  cd "$app_dir/android"
  ./gradlew "$@"
}

sync_android_project() {
  ensure_android_project
  "$pnpm_bin" --dir "$app_dir" exec cap sync android
}

build_android_apk() {
  run_android_gradle :app:assembleDebug
}

build_android_aab() {
  if android_signing_configured; then
    build_signed_android AAB
  else
    echo "Android signing env is not configured; building unsigned release AAB." >&2
    run_android_gradle :app:bundleRelease
  fi
}

"$pnpm_bin" --dir "$app_dir" mobile:build

case "$release_target" in
  web)
    ;;
  android-apk)
    sync_android_project
    build_android_apk
    ;;
  android-aab)
    sync_android_project
    build_android_aab
    ;;
  android-both)
    sync_android_project
    build_android_apk
    build_android_aab
    ;;
  ios-open)
    ensure_ios_project
    "$pnpm_bin" --dir "$app_dir" exec cap sync ios
    "$pnpm_bin" --dir "$app_dir" exec cap open ios
    ;;
  ios-app-store)
    ensure_ios_project
    "$pnpm_bin" --dir "$app_dir" exec cap sync ios
    "$pnpm_bin" --dir "$app_dir" exec cap build ios --xcode-export-method app-store-connect
    ;;
  *)
    echo "Unknown mobile release target: $release_target" >&2
    echo "Expected one of: web, android-apk, android-aab, android-both, ios-open, ios-app-store" >&2
    exit 2
    ;;
esac

node "$repo_root/tools/report-mobile-package-size.mjs" \
  --dist "$app_dir/dist" \
  --android "$app_dir/android" \
  --ios "$app_dir/ios" \
  --out-json "$report_json" \
  --out-md "$report_md"

echo "Mobile package size report: $report_json"
echo "Mobile package size summary: $report_md"
