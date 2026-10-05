#!/usr/bin/env bash
set -euo pipefail

# Run as root on the CVM after /etc/xiangqi-acme/tencent.env is installed.
# It installs the five certificates and Nginx gateway without modifying the
# legacy 127.0.0.1:8090 service.
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
credentials=/etc/xiangqi-acme/tencent.env
[[ -r "$credentials" ]] || { echo "Missing $credentials" >&2; exit 1; }
[[ -x /usr/sbin/nginx || -x /usr/bin/nginx ]] || { echo "nginx is required" >&2; exit 1; }

# shellcheck source=/dev/null
source "$credentials"
: "${Tencent_Secret_Id:?Tencent_Secret_Id is required}"
: "${Tencent_Secret_Key:?Tencent_Secret_Key is required}"
: "${ACME_CONTACT_EMAIL:?ACME_CONTACT_EMAIL is required}"

if [[ ! -x /root/.acme.sh/acme.sh ]]; then
  curl --fail --silent --show-error https://get.acme.sh | sh -s email="$ACME_CONTACT_EMAIL"
fi

install -d -m 0700 \
  /etc/nginx/certs/qixiapp.cn \
  /etc/nginx/certs/admin.qixiapp.cn \
  /etc/nginx/certs/admin-test.qixiapp.cn \
  /etc/nginx/certs/api.qixiapp.cn \
  /etc/nginx/certs/api-test.qixiapp.cn
install -m 0750 "$root/scripts/issue-qixi-certificates.sh" /usr/local/sbin/issue-qixi-certificates
install -m 0750 "$root/scripts/renew-qixi-certificates.sh" /usr/local/sbin/renew-qixi-certificates
install -m 0750 "$root/scripts/check-qixi-certificate-expiry.sh" /usr/local/sbin/check-qixi-certificate-expiry
install -m 0644 "$root/deploy/systemd/qixi-acme-renew.service" /etc/systemd/system/qixi-acme-renew.service
install -m 0644 "$root/deploy/systemd/qixi-acme-renew.timer" /etc/systemd/system/qixi-acme-renew.timer
install -m 0644 "$root/deploy/systemd/qixi-certificate-expiry.service" /etc/systemd/system/qixi-certificate-expiry.service
install -m 0644 "$root/deploy/systemd/qixi-certificate-expiry.timer" /etc/systemd/system/qixi-certificate-expiry.timer

# DNS validation does not require the new vhost to be active. Cert install
# reloads the existing valid Nginx configuration after each issuance.
/usr/local/sbin/issue-qixi-certificates

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f /etc/nginx/conf.d/xiangqi-admin.conf ]]; then
  cp -a /etc/nginx/conf.d/xiangqi-admin.conf "/etc/nginx/conf.d/xiangqi-admin.conf.$timestamp.bak"
fi
install -m 0644 "$root/deploy/nginx/qixi-ip-redirect.conf" /etc/nginx/conf.d/xiangqi-admin.conf
install -m 0644 "$root/deploy/nginx/qixiapp.conf" /etc/nginx/conf.d/qixiapp.conf
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now qixi-acme-renew.timer
systemctl enable --now qixi-certificate-expiry.timer
systemctl start qixi-certificate-expiry.service
echo "Installed Qixi HTTPS gateway and daily certificate renewal."
