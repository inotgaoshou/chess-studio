#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root_dir/apps/endgame-training"
pnpm_bin="${PNPM_BIN:-pnpm}"
action="${1:-open}"
project="$app_dir/ios/App/App.xcodeproj"
scheme="App"

case "$action" in
  open|check|signed-build|archive|ipa) ;;
  *)
    echo "Usage: $0 [open|check|signed-build|archive|ipa]" >&2
    exit 2
    ;;
esac

require_full_xcode() {
  local xcode_path
  if ! xcode_path="$(xcode-select -p 2>/dev/null)" || [[ "$xcode_path" != *"Xcode.app/Contents/Developer"* ]]; then
    echo "Full Xcode is required for the iPhone build. Install Xcode, open it once, then run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    exit 1
  fi

  if ! command -v xcodebuild >/dev/null; then
    echo "xcodebuild is unavailable. Finish Xcode installation and accept its license first." >&2
    exit 1
  fi
}

sync_web_assets() {
  "$pnpm_bin" --dir "$app_dir" mobile:build
  "$pnpm_bin" --dir "$app_dir" exec cap sync ios
}

archive_app() {
  local archive_path="$1"
  xcodebuild \
    -project "$project" \
    -scheme "$scheme" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -allowProvisioningUpdates \
    -archivePath "$archive_path" \
    archive
}

export_ipa() {
  local archive_path="$1"
  local export_method="$2"
  local output_dir="${IOS_IPA_OUTPUT_DIR:-$root_dir/artifacts/endgame-training-ios}"
  local temp_dir export_options export_dir ipa_source ipa_name

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/xiangqi-endgame-ipa.XXXXXX")"
  trap 'rm -rf "$temp_dir"' EXIT
  export_options="$temp_dir/ExportOptions.plist"
  export_dir="$temp_dir/export"

  plutil -create xml1 "$export_options"
  plutil -insert method -string "$export_method" "$export_options"
  plutil -insert signingStyle -string automatic "$export_options"
  plutil -insert destination -string export "$export_options"
  plutil -insert stripSwiftSymbols -bool true "$export_options"
  plutil -insert thinning -string '<none>' "$export_options"

  xcodebuild -exportArchive \
    -archivePath "$archive_path" \
    -exportOptionsPlist "$export_options" \
    -exportPath "$export_dir" \
    -allowProvisioningUpdates

  ipa_source="$(find "$export_dir" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
  if [[ -z "$ipa_source" ]]; then
    echo "IPA export completed without producing an IPA file." >&2
    exit 1
  fi

  mkdir -p "$output_dir"
  ipa_name="xiangqi-endgame-training-${export_method}-$(date '+%Y%m%d-%H%M%S').ipa"
  cp "$ipa_source" "$output_dir/$ipa_name"
  echo "IPA exported to $output_dir/$ipa_name"
}

require_full_xcode
sync_web_assets

case "$action" in
  open)
    open "$project"
    ;;
  check)
    xcodebuild -project "$project" -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
    ;;
  signed-build)
    xcodebuild -project "$project" -scheme "$scheme" -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates build
    ;;
  archive)
    archive_app "${IOS_ARCHIVE_PATH:-$app_dir/build/App.xcarchive}"
    ;;
  ipa)
    export_method="${IOS_EXPORT_METHOD:-ad-hoc}"
    case "$export_method" in
      ad-hoc|app-store|development|enterprise) ;;
      *)
        echo "IOS_EXPORT_METHOD must be ad-hoc, app-store, development, or enterprise." >&2
        exit 2
        ;;
    esac
    archive_path="${IOS_ARCHIVE_PATH:-$app_dir/build/App.xcarchive}"
    archive_app "$archive_path"
    export_ipa "$archive_path" "$export_method"
    ;;
esac
