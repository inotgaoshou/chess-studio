#!/usr/bin/env bash
# Personal development installs only. Course files are NEVER build inputs.
set -euo pipefail
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root_dir/apps/endgame-training"
platform="${1:-}"
case "$platform" in android|ios) ;; *) echo "Usage: $0 android|ios [device-id]" >&2; exit 2;; esac
pnpm_bin="${PNPM_BIN:-pnpm}"
export VITE_APP_ENV="${VITE_APP_ENV:-production}"
"$pnpm_bin" --dir "$app_dir" mobile:build
"$pnpm_bin" --dir "$app_dir" exec cap sync "$platform"
if [[ "$platform" == android ]]; then
  export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
  (cd "$app_dir/android" && ANDROID_VERSION_NAME=1.1.1 ./gradlew :app:assembleFamily)
  artifact="$app_dir/android/app/build/outputs/apk/family/app-family.apk"
  if [[ -n "${2:-}" ]]; then
    adb_bin="${ADB_BIN:-$HOME/Library/Android/sdk/platform-tools/adb}"
    "$adb_bin" -s "$2" install -r "$artifact"
    "$adb_bin" -s "$2" shell am start -n cn.xiangqi.endgame.training.family/cn.xiangqi.endgame.training.MainActivity
  fi
else
  derived="$app_dir/build/DerivedData-family-device"
  xcodebuild -project "$app_dir/ios/App/App.xcodeproj" -scheme App -configuration Debug \
    -derivedDataPath "$derived" -destination 'generic/platform=iOS' -allowProvisioningUpdates \
    PRODUCT_BUNDLE_IDENTIFIER=cn.xiangqi.endgame.training.family 'QIXI_DISPLAY_NAME=棋析·家庭学习' \
    MARKETING_VERSION=1.1.1 CURRENT_PROJECT_VERSION=10143 \
    PIKAFISH_IOS_ROOT="${PIKAFISH_IOS_ROOT:-$root_dir/../pikafish-ios}" build
  artifact="$derived/Build/Products/Debug-iphoneos/App.app"
  if [[ -n "${2:-}" ]]; then
    xcrun devicectl device install app --device "$2" "$artifact"
    xcrun devicectl device process launch --device "$2" cn.xiangqi.endgame.training.family
  fi
fi
printf '家庭学习版：%s\n' "$artifact"
printf '预置课程：python3 %s/scripts/provision-video-library.py --platform %s --device DEVICE_ID\n' "$root_dir" "$platform"
