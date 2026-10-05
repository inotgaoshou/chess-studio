#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 production" >&2
  exit 64
}

[[ "${1:-}" == "production" ]] || usage
service="xiangqi-studio-production.service"
release_root="/opt/xiangqi-studio"
health_url="http://127.0.0.1:8080/health"

if [[ ! -f apps/server/Cargo.toml ]]; then
  echo "Run this script from the chess-studio repository root." >&2
  exit 1
fi

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
command -v cargo >/dev/null || { echo "cargo is required" >&2; exit 1; }

# The server receives a verified source snapshot and may intentionally not
# contain .git. Preserve a revision when one is available, without requiring it.
commit="$(git rev-parse HEAD 2>/dev/null || printf 'source-snapshot')"
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

# This deliberately requests a password before compiling or changing a release.
# It also prevents an unattended job from accidentally changing production.
sudo -v

cargo build --locked --release -p xiangqi-server
binary="target/release/xiangqi-server"
[[ -x "$binary" ]] || { echo "build did not produce $binary" >&2; exit 1; }
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"

binary_sha256="$(sha256sum "$binary" | awk '{print $1}')"
printf 'commit=%s\nsha256=%s\n' "$commit" "$binary_sha256" > "$manifest"
release_dir="$release_root/releases/$release_id"

sudo install -d -o deploy -g deploy -m 0755 "$release_dir"
sudo install -d -o deploy -g deploy -m 0750 /var/log/xiangqi-studio
sudo install -o deploy -g deploy -m 0755 "$binary" "$release_dir/xiangqi-server"
sudo install -o deploy -g deploy -m 0644 "$manifest" "$release_dir/manifest"
sudo ln -sTfn "$release_dir" "$release_root/current.next"
sudo mv -Tf "$release_root/current.next" "$release_root/current"
sudo systemctl restart "$service"

for attempt in {1..15}; do
  if curl --fail --silent --show-error "$health_url"; then
    echo
    echo "production API deployed: $release_dir"
    exit 0
  fi
  sleep 1
done

sudo systemctl --no-pager --full status "$service" || true
exit 1
