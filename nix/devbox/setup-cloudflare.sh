#!/bin/bash
# Optional public HTTPS ingress. Credentials must never enter the Nix store.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
if [[ $EUID != 0 || $# != 2 ]]; then
  echo 'Usage: sudo setup-doop-cloudflare TUNNEL_UUID /private/path/credentials.json' >&2
  exit 1
fi
uuid=$1
credentials=$2
self='@self@'
host='@publicHost@'
python3 - "$uuid" "$credentials" <<'PY'
import json, re, sys
assert re.fullmatch(r'[a-f0-9-]{36}', sys.argv[1]), 'Invalid tunnel UUID'
with open(sys.argv[2]) as f:
    credentials = json.load(f)
assert credentials['TunnelID'] == sys.argv[1], 'Credentials belong to another tunnel'
PY
[[ -e /etc/doop/environment ]] || { echo 'Deploy devbox-services first.' >&2; exit 1; }
if ! id doop-tunnel >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin doop-tunnel
fi
[[ $(id -Gn doop-tunnel) == doop-tunnel ]] || { echo 'Unexpected groups on tunnel account' >&2; exit 1; }
install -d -m 0755 /etc/cloudflared-doop
if [[ $(realpath "$credentials") != /etc/cloudflared-doop/credentials.json ]]; then
  install -m 0600 "$credentials" /etc/cloudflared-doop/credentials.json
fi
chown root:root /etc/cloudflared-doop/credentials.json
chmod 0600 /etc/cloudflared-doop/credentials.json
cat > /etc/cloudflared-doop/config.yml <<EOF
tunnel: $uuid
credentials-file: /run/credentials/doop-cloudflared.service/tunnel.json
metrics: 127.0.0.1:20241
ingress:
  # Block new public accounts. Private tailnet signup remains available.
  - hostname: $host
    path: ^/api/auth/sign-up(/.*)?$
    service: http_status:404
  - hostname: $host
    service: http://127.0.0.1:4400
  - service: http_status:404
EOF
ln -sfn "$self" /nix/var/nix/gcroots/devbox-services
install -m 0644 "$self/config/doop-cloudflared.service" /etc/systemd/system/doop-cloudflared.service
python3 - "$host" <<'PY'
from pathlib import Path
import sys
p = Path('/etc/doop/environment')
values = dict(line.split('=', 1) for line in p.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
public = 'https://' + sys.argv[1]
origins = set(filter(None, values.get('TRUSTED_ORIGINS', '').split(',')))
origins.update([values['BETTER_AUTH_URL'], public])
values.update(BETTER_AUTH_URL=public, DOOP_PUBLIC_ORIGIN=public, TRUSTED_ORIGINS=','.join(sorted(origins)))
p.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
p.chmod(0o600)
PY
systemctl daemon-reload
systemctl restart doop.service
systemctl enable doop-cloudflared.service
systemctl restart doop-cloudflared.service
printf '\nPublic Doop: https://%s\nCloud MCP: https://%s/mcp\n' "$host" "$host"
printf 'The DNS route must point to this tunnel. Keep Cloudflare Access/challenges off MCP and OAuth paths.\n'
