#!/usr/bin/env bash
set -euo pipefail

server_ip="${QIXI_SERVER_IP:?Set QIXI_SERVER_IP to the CVM public IP}"
hosts=(qixiapp.cn www.qixiapp.cn admin.qixiapp.cn admin-test.qixiapp.cn api.qixiapp.cn api-test.qixiapp.cn)

require_command() {
  command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in curl dig; do require_command "$command"; done

for host in "${hosts[@]}"; do
  addresses="$(dig +short A "$host")"
  if ! grep -Fxq "$server_ip" <<<"$addresses"; then
    echo "$host does not resolve to $server_ip (got: ${addresses:-none})" >&2
    exit 1
  fi

  redirect_headers="$(curl --silent --show-error --head --resolve "$host:80:$server_ip" "http://$host/")"
  grep -Eq '^HTTP/[0-9.]+ 301' <<<"$redirect_headers"
  redirect_host="$host"
  [[ "$host" == "www.qixiapp.cn" ]] && redirect_host="qixiapp.cn"
  grep -Fq "location: https://$redirect_host/" <<<"$(tr '[:upper:]' '[:lower:]' <<<"$redirect_headers")"

  # curl verifies both the public certificate chain and the hostname/SNI by
  # default. This is portable to macOS's LibreSSL, unlike newer s_client flags.
  tls_verify="$(curl --silent --show-error --output /dev/null --write-out '%{ssl_verify_result}' --resolve "$host:443:$server_ip" "https://$host/")"
  [[ "$tls_verify" == 0 ]]
  echo "OK DNS, redirect and certificate: $host"
done

support_headers="$(curl --silent --show-error --head --resolve "qixiapp.cn:443:$server_ip" "https://qixiapp.cn/")"
grep -Eq '^HTTP/[0-9.]+ 302' <<<"$support_headers"
grep -Fq 'location: https://inotgaoshou.github.io/chess-studio/' <<<"$(tr '[:upper:]' '[:lower:]' <<<"$support_headers")"
privacy_headers="$(curl --silent --show-error --head --resolve "qixiapp.cn:443:$server_ip" "https://qixiapp.cn/privacy.html")"
grep -Eq '^HTTP/[0-9.]+ 302' <<<"$privacy_headers"
grep -Fq 'location: https://inotgaoshou.github.io/chess-studio/privacy.html' <<<"$(tr '[:upper:]' '[:lower:]' <<<"$privacy_headers")"
www_headers="$(curl --silent --show-error --head --resolve "www.qixiapp.cn:443:$server_ip" "https://www.qixiapp.cn/")"
grep -Eq '^HTTP/[0-9.]+ 301' <<<"$www_headers"
grep -Fq 'location: https://qixiapp.cn/' <<<"$(tr '[:upper:]' '[:lower:]' <<<"$www_headers")"
curl --fail --silent --show-error --resolve "admin.qixiapp.cn:443:$server_ip" "https://admin.qixiapp.cn/health" >/dev/null
curl --fail --silent --show-error --resolve "admin-test.qixiapp.cn:443:$server_ip" "https://admin-test.qixiapp.cn/health" >/dev/null
for host in admin.qixiapp.cn admin-test.qixiapp.cn; do
  curl --fail --silent --show-error --resolve "$host:443:$server_ip" "https://$host/" | grep -Eqi '<!doctype html>|<html'
done
for host in api.qixiapp.cn api-test.qixiapp.cn; do
  curl --fail --silent --show-error --resolve "$host:443:$server_ip" "https://$host/health/live" | grep -Fq '"status":"live"'
  curl --fail --silent --show-error --resolve "$host:443:$server_ip" "https://$host/health/ready" | grep -Fq '"status":"ready"'
done
echo "OK production and test APIs are live and ready"
