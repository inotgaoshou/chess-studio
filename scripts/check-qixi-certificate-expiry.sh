#!/usr/bin/env bash
set -euo pipefail

warn_days="${WARN_DAYS:-21}"
case "$warn_days" in
  ''|*[!0-9]*) echo "WARN_DAYS must be an integer" >&2; exit 64 ;;
esac

cert_root="/etc/nginx/certs"
hosts=(qixiapp.cn admin.qixiapp.cn api.qixiapp.cn api-test.qixiapp.cn)
threshold_seconds=$((warn_days * 86400))
expired_or_near=false

for host in "${hosts[@]}"; do
  certificate="$cert_root/$host/fullchain.pem"
  if [[ ! -r "$certificate" ]]; then
    echo "MISSING certificate: $certificate" >&2
    expired_or_near=true
    continue
  fi

  expiry="$(openssl x509 -in "$certificate" -noout -enddate | cut -d= -f2-)"
  if openssl x509 -in "$certificate" -checkend "$threshold_seconds" -noout; then
    echo "OK $host expires $expiry"
  else
    echo "RENEW $host expires $expiry" >&2
    expired_or_near=true
  fi
done

if [[ "$expired_or_near" == true ]]; then
  exit 1
fi
