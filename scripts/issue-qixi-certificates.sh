#!/usr/bin/env bash
set -euo pipefail

acme_home="/root/.acme.sh"
acme="$acme_home/acme.sh"
credentials="/etc/xiangqi-acme/tencent.env"

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
[[ -x "$acme" ]] || { echo "acme.sh is not installed at $acme" >&2; exit 1; }
[[ -r "$credentials" ]] || { echo "Missing $credentials" >&2; exit 1; }

# shellcheck source=/dev/null
source "$credentials"
: "${Tencent_Secret_Id:?Tencent_Secret_Id is required}"
: "${Tencent_Secret_Key:?Tencent_Secret_Key is required}"
: "${ACME_CONTACT_EMAIL:?ACME_CONTACT_EMAIL is required}"
# acme.sh's dns_tencent provider uses this spelling. Keep the deployment file
# names stable and translate them only for the child acme.sh process.
export Tencent_SecretId="$Tencent_Secret_Id"
export Tencent_SecretKey="$Tencent_Secret_Key"

install_certificate() {
  local primary="$1"
  "$acme" --install-cert -d "$primary" \
    --key-file "/etc/nginx/certs/$primary/privkey.pem" \
    --fullchain-file "/etc/nginx/certs/$primary/fullchain.pem" \
    --reloadcmd 'nginx -t && systemctl reload nginx'
  chmod 0600 "/etc/nginx/certs/$primary/privkey.pem"
  chmod 0644 "/etc/nginx/certs/$primary/fullchain.pem"
}

issue_certificate() {
  local primary="$1"
  shift
  # acme.sh returns a non-zero status when an already-valid certificate is
  # skipped. Avoid that path entirely so adding a new hostname is idempotent.
  if [[ ! -f "$acme_home/${primary}_ecc/fullchain.cer" ]]; then
    "$acme" --issue --server letsencrypt --dns dns_tencent "$@"
  fi
  install_certificate "$primary"
}

"$acme" --register-account -m "$ACME_CONTACT_EMAIL" --server letsencrypt
issue_certificate qixiapp.cn -d qixiapp.cn -d www.qixiapp.cn
issue_certificate admin.qixiapp.cn -d admin.qixiapp.cn
issue_certificate admin-test.qixiapp.cn -d admin-test.qixiapp.cn
issue_certificate api.qixiapp.cn -d api.qixiapp.cn
issue_certificate api-test.qixiapp.cn -d api-test.qixiapp.cn
