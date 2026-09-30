#!/usr/bin/env bash
set -euo pipefail

# Upload and install the HTTPS gateway after the operator has created
# /etc/xiangqi-acme/tencent.env on the CVM. The credential file stays on the
# server and is never included in the archive.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server="${QIXI_DEPLOY_TARGET:-deploy@43.138.163.2}"
archive="$(mktemp "${TMPDIR:-/tmp}/qixi-gateway.XXXXXX.tar.gz")"
trap 'rm -f "$archive"' EXIT

COPYFILE_DISABLE=1 tar -C "$root" -czf "$archive" \
  deploy/nginx/qixiapp.conf \
  deploy/nginx/qixi-ip-redirect.conf \
  deploy/systemd/qixi-acme-renew.service \
  deploy/systemd/qixi-acme-renew.timer \
  scripts/issue-qixi-certificates.sh \
  scripts/renew-qixi-certificates.sh \
  scripts/install-qixi-gateway.sh

scp -q "$archive" "$server:/tmp/qixi-gateway.tar.gz"
ssh "$server" 'set -e
  sudo install -d -m 0755 /opt/qixi-gateway
  sudo tar -C /opt/qixi-gateway -xzf /tmp/qixi-gateway.tar.gz
  unlink /tmp/qixi-gateway.tar.gz
  sudo /opt/qixi-gateway/scripts/install-qixi-gateway.sh'
