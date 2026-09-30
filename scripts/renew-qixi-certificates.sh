#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
[[ -x /root/.acme.sh/acme.sh ]] || { echo "acme.sh is not installed" >&2; exit 1; }
exec /root/.acme.sh/acme.sh --cron --home /root/.acme.sh
