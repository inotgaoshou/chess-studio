#!/usr/bin/env bash
set -euo pipefail

packet_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$packet_dir/../.." && pwd)"
cbl="${1:-$packet_dir/qiyan-review-sample.cbl}"
video="${2:-$packet_dir/qiyan-review-10010.mov}"
archive="$repo_root/apps/endgame-training/build/Qiyan-1.0.0-10010.xcarchive"
archive_info="$archive/Info.plist"
app="$archive/Products/Applications/App.app"

require_file() {
  if [[ ! -s "$1" ]]; then
    echo "Missing or empty file: $1" >&2
    exit 1
  fi
}

require_file "$archive_info"
require_file "$app/Info.plist"
require_file "$cbl"
require_file "$video"

version="$(plutil -extract ApplicationProperties.CFBundleShortVersionString raw "$archive_info")"
build="$(plutil -extract ApplicationProperties.CFBundleVersion raw "$archive_info")"
bundle_id="$(plutil -extract ApplicationProperties.CFBundleIdentifier raw "$archive_info")"
if [[ "$version" != "1.0.0" || "$build" != "10010" || "$bundle_id" != "cn.xiangqi.endgame.training" ]]; then
  echo "Archive identity mismatch: $version ($build), $bundle_id" >&2
  exit 1
fi

case "${cbl##*.}" in
  cbl|CBL) ;;
  *)
    echo "Sample must use the .cbl extension: $cbl" >&2
    exit 1
    ;;
esac

report="$(cd "$repo_root" && cargo run --quiet -p manual-format --example cbl_review_check -- "$cbl")"
problem_count="$(jq -r '.problemCount' <<<"$report")"
if [[ "$problem_count" -lt 1 ]]; then
  echo "Sample has no importable endgame problems." >&2
  exit 1
fi

video_type="$(file -b "$video")"
if [[ "$video_type" != *"QuickTime"* && "$video_type" != *"ISO Media"* ]]; then
  echo "Video is not a recognized MOV/MP4 file: $video_type" >&2
  exit 1
fi

echo "Archive: Qiyan $version ($build), $bundle_id"
echo "CBL report:"
echo "$report"
echo "Video: $video_type"
if command -v ffprobe >/dev/null 2>&1; then
  ffprobe -v error \
    -show_entries format=duration,size \
    -show_entries stream=codec_name,width,height \
    -of default=noprint_wrappers=1 "$video"
fi

for url in \
  "https://inotgaoshou.github.io/chess-studio/" \
  "https://inotgaoshou.github.io/chess-studio/privacy.html"
do
  curl --fail --location --silent --show-error --output /dev/null "$url"
  echo "HTTP 200: $url"
done

echo "Attachment SHA-256:"
shasum -a 256 "$cbl" "$video"
