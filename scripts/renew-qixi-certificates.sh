#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
[[ -x /root/.acme.sh/acme.sh ]] || { echo "acme.sh is not installed" >&2; exit 1; }
credentials=/etc/xiangqi-acme/tencent.env
[[ -r "$credentials" ]] || { echo "Missing $credentials" >&2; exit 1; }

# shellcheck source=/dev/null
source "$credentials"
: "${Tencent_Secret_Id:?Tencent_Secret_Id is required}"
: "${Tencent_Secret_Key:?Tencent_Secret_Key is required}"
export Tencent_SecretId="$Tencent_Secret_Id"
export Tencent_SecretKey="$Tencent_Secret_Key"
exec /root/.acme.sh/acme.sh --cron --home /root/.acme.sh
