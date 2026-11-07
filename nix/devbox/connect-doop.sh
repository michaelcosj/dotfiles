#!/bin/bash
# Complete once after enrolling the host in the intended tailnet.
set -euo pipefail
export PATH='@runtime@/bin:/usr/sbin:/usr/bin:/sbin:/bin'
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
status=$(tailscale status --json)
host=$(python3 -c '
import json, re, sys
s = json.load(sys.stdin)
assert s.get("BackendState") == "Running", "Authenticate with tailscale up first"
host = s["Self"]["DNSName"].rstrip(".")
assert re.fullmatch(r"[a-z0-9.-]+\.ts\.net", host), "Expected a Tailscale DNS name"
print(host)
' <<< "$status")
# Serve is tailnet-only. This does not enable public Tailscale Funnel.
tailscale serve --bg --yes --https=443 http://127.0.0.1:4400
python3 - "$host" <<'PY'
from pathlib import Path
import sys
p = Path('/etc/doop/environment')
values = dict(line.split('=', 1) for line in p.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
private = 'https://' + sys.argv[1]
origin = values.get('DOOP_PUBLIC_ORIGIN', private)
origins = set(filter(None, values.get('TRUSTED_ORIGINS', '').split(',')))
origins.update([private, origin])
values.update(BETTER_AUTH_URL=origin, TRUSTED_ORIGINS=','.join(sorted(origins)))
p.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
p.chmod(0o600)
PY
systemctl restart doop.service
printf '\nDoop: https://%s\nMCP: https://%s/mcp\n' "$host" "$host"
printf 'Access follows your tailnet ACLs/grants; review them in the admin console.\n'
