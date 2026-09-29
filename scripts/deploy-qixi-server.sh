#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 production|test" >&2
  exit 64
}

environment="${1:-}"
case "$environment" in
  production)
    service="xiangqi-studio-production.service"
    release_root="/opt/xiangqi-studio"
    health_url="http://127.0.0.1:8080/health"
    ;;
  test)
    service="xiangqi-studio-test.service"
    release_root="/opt/xiangqi-studio-test"
    health_url="http://127.0.0.1:8081/health"
    ;;
  *) usage ;;
esac

if [[ ! -f apps/server/Cargo.toml ]]; then
  echo "Run this script from the chess-studio repository root." >&2
  exit 1
fi

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Refusing to deploy from a dirty worktree. Commit or remove local changes first." >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

# This deliberately requests a password before compiling or changing a release.
# It also prevents an unattended job from accidentally changing production.
sudo -v

if [[ "$environment" == "test" ]]; then
  command -v cargo >/dev/null || { echo "cargo is required for test deployment" >&2; exit 1; }
  cargo build --locked --release -p xiangqi-server
  binary="target/release/xiangqi-server"
  [[ -x "$binary" ]] || { echo "build did not produce $binary" >&2; exit 1; }
  release_id="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
else
  tested_release="/opt/xiangqi-studio-test/current"
  tested_manifest="$tested_release/manifest"
  binary="$tested_release/xiangqi-server"
  [[ -r "$tested_manifest" && -x "$binary" ]] || {
    echo "No tested release is available at $tested_release. Deploy and accept test first." >&2
    exit 1
  }
  tested_commit="$(sed -n 's/^commit=//p' "$tested_manifest")"
  tested_sha256="$(sed -n 's/^sha256=//p' "$tested_manifest")"
  [[ "$tested_commit" == "$commit" ]] || {
    echo "Tested commit $tested_commit does not match current commit $commit." >&2
    exit 1
  }
  [[ "$tested_sha256" == "$(sha256sum "$binary" | awk '{print $1}')" ]] || {
    echo "Tested release checksum does not match its manifest." >&2
    exit 1
  }
  release_id="$(basename "$(readlink -f "$tested_release")")"
fi

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
    echo "$environment API deployed: $release_dir"
    exit 0
  fi
  sleep 1
done

sudo systemctl --no-pager --full status "$service" || true
exit 1
