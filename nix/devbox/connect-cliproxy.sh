#!/bin/bash
# Publish CLIProxyAPI's model API on the tailnet, not the management UI or API.
set -euo pipefail
export PATH='@runtime@/bin:/usr/sbin:/usr/bin:/sbin:/bin'
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
tailscale serve --bg --yes --https=8318 --set-path=/v1 http://127.0.0.1:8317/v1
