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

install_certificate() {
  local primary="$1"
  "$acme" --install-cert -d "$primary" \
    --key-file "/etc/nginx/certs/$primary/privkey.pem" \
    --fullchain-file "/etc/nginx/certs/$primary/fullchain.pem" \
    --reloadcmd 'nginx -t && systemctl reload nginx'
  chmod 0600 "/etc/nginx/certs/$primary/privkey.pem"
  chmod 0644 "/etc/nginx/certs/$primary/fullchain.pem"
}

"$acme" --register-account -m "$ACME_CONTACT_EMAIL" --server letsencrypt
"$acme" --issue --server letsencrypt --dns dns_tencent -d qixiapp.cn -d www.qixiapp.cn
install_certificate qixiapp.cn
"$acme" --issue --server letsencrypt --dns dns_tencent -d admin.qixiapp.cn
install_certificate admin.qixiapp.cn
"$acme" --issue --server letsencrypt --dns dns_tencent -d api.qixiapp.cn
install_certificate api.qixiapp.cn
"$acme" --issue --server letsencrypt --dns dns_tencent -d api-test.qixiapp.cn
install_certificate api-test.qixiapp.cn
