#!/usr/bin/env bash
# Run after installing the family app and provisioning the first layout lesson
# in a simulator. Does not clear the app container or touch ordinary app data.
set -euo pipefail
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
simulator_id="${1:?Usage: $0 SIMULATOR_ID}"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/qixi-video-ui-tests.XXXXXX")"
mkdir -p "$test_root/Acceptance.xcodeproj"
cp "$root_dir/scripts/tests/video-ios/Acceptance.swift" "$test_root/Acceptance.swift"
cp "$root_dir/scripts/tests/video-ios/project.pbxproj" "$test_root/Acceptance.xcodeproj/project.pbxproj"
xcodebuild -project "$test_root/Acceptance.xcodeproj" -scheme Acceptance \
  -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath "$test_root/build" \
  -resultBundlePath "$test_root/result.xcresult" CODE_SIGNING_ALLOWED=NO test
printf 'Native iOS acceptance results: %s/result.xcresult\n' "$test_root"
