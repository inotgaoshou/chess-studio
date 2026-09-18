#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
source_root="${PIKAFISH_IOS_ROOT:-$script_dir/../../../../../pikafish-ios}"
tag="${PIKAFISH_TAG:?Missing PIKAFISH_TAG}"
platform="${PLATFORM_NAME:?Missing PLATFORM_NAME}"

if [[ ! -x "$source_root/scripts/xcode-build-engine.sh" ]]; then
  printf 'Pikafish iOS source is unavailable at %s. Set PIKAFISH_IOS_ROOT to the checked-out pikafish-ios repository.\n' "$source_root" >&2
  exit 1
fi

exec "$source_root/scripts/xcode-build-engine.sh" "$tag" "$platform" arm64
