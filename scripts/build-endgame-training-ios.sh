#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root_dir/apps/endgame-training"
pnpm_bin="${PNPM_BIN:-pnpm}"
action="${1:-open}"
project="$app_dir/ios/App/App.xcodeproj"
scheme="App"
pikafish_ios_root="${PIKAFISH_IOS_ROOT:-$root_dir/../pikafish-ios}"
expected_pikafish_tag="${PIKAFISH_TAG:-Pikafish-2026-09-06}"
expected_pikafish_source_revision="4c17cee11f888ae1d48a9494f2e2239f019f0a1f"
expected_pikafish_nnue_sha256="7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e"

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

require_file() {
  local path="$1"
  local description="$2"
  if [[ ! -f "$path" ]]; then
    echo "Missing $description: $path" >&2
    exit 1
  fi
}

require_executable() {
  local path="$1"
  local description="$2"
  require_file "$path" "$description"
  if [[ ! -x "$path" ]]; then
    echo "$description is not executable: $path" >&2
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

require_json_value() {
  local path="$1"
  local key="$2"
  local expected="$3"
  local description="$4"
  require_file "$path" "$description"
  local actual
  actual="$(jq -r "$key" "$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$description does not contain the expected value." >&2
    echo "  file: $path" >&2
    echo "  expected: $expected" >&2
    echo "  actual: $actual" >&2
    exit 1
  fi
}

require_pikafish_ios_distribution_materials() {
  require_executable "$pikafish_ios_root/scripts/xcode-build-engine.sh" "Pikafish iOS engine build script"
  require_executable "$pikafish_ios_root/scripts/xcode-embed-resources.sh" "Pikafish iOS resource embed script"
  require_file "$root_dir/THIRD_PARTY_NOTICES.md" "third-party notices"
  require_file "$app_dir/README.md" "endgame training release notes"
  require_json_value "$pikafish_ios_root/.build/releases/$expected_pikafish_tag/manifest.json" '.sourceCommit' "$expected_pikafish_source_revision" "Pikafish cached release manifest"
  require_text "$pikafish_ios_root/scripts/xcode-embed-resources.sh" "Copying.txt" "Pikafish iOS resource embed script"
  require_text "$pikafish_ios_root/scripts/xcode-embed-resources.sh" "NNUE-License" "Pikafish iOS resource embed script"
  require_text "$pikafish_ios_root/scripts/xcode-embed-resources.sh" "PikafishBuildInfo.plist" "Pikafish iOS resource embed script"
  require_text "$root_dir/THIRD_PARTY_NOTICES.md" "$expected_pikafish_source_revision" "third-party notices"
  require_text "$root_dir/THIRD_PARTY_NOTICES.md" "$expected_pikafish_nnue_sha256" "third-party notices"
  require_text "$app_dir/README.md" "GPLv3" "endgame training release notes"
  export PIKAFISH_TAG="$expected_pikafish_tag"
  export PIKAFISH_IOS_ROOT="$pikafish_ios_root"
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
case "$action" in
  signed-build|archive|ipa)
    require_pikafish_ios_distribution_materials
    ;;
esac
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
