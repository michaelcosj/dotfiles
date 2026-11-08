#!/bin/bash
# Publish each account's loopback OpenCode server (home/linux/devbox.nix) on the
# tailnet. Serve only; never Funnel. Run once; tailscaled keeps the config.
# Serve allows HTTPS on 443, 8443 and 10000 only; Doop already uses 443.
set -euo pipefail
export PATH='@runtime@/bin:/usr/sbin:/usr/bin:/sbin:/bin'
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
tailscale serve --bg --yes --https=8443 http://127.0.0.1:4096
tailscale serve --bg --yes --https=10000 http://127.0.0.1:4097
host=$(tailscale status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
printf '\nOpenCode (work): https://%s:8443\nOpenCode (m):    https://%s:10000\n' "$host" "$host"
printf 'Log in as user "opencode" with the password in that account'"'"'s ~/.config/opencode/service.json.\n'
