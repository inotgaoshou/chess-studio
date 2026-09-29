#!/usr/bin/env bash
set -euo pipefail

site_source="docs/qixi-site/"
site_root="/opt/qixi-site"

[[ -f "${site_source}index.html" && -f "${site_source}privacy.html" ]] || {
  echo "Run this script from the chess-studio repository root." >&2
  exit 1
}
command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }

# --delete is limited to this dedicated static-site directory.
sudo -v
sudo install -d -o root -g root -m 0755 "$site_root"
sudo rsync -a --delete --chown=root:root "$site_source" "$site_root/"
sudo find "$site_root" -type d -exec chmod 0755 {} +
sudo find "$site_root" -type f -exec chmod 0644 {} +
echo "Static support site deployed to $site_root"
