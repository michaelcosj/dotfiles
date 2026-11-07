# Public Doop through Cloudflare Tunnel

Public web: https://doop.michaelosajeh.com
Public MCP: https://doop.michaelosajeh.com/mcp
Private web/MCP remain at https://devbox.danio-wezen.ts.net (and `/mcp`).

Named tunnel: `doop-devbox`
Tunnel UUID: `00b35969-0a35-4951-a003-aeb1c6ae3396`
Hostname is declared as `publicHost` in `default.nix`.

## Architecture and authentication

Cloudflare terminates public HTTPS and sends traffic over an outbound tunnel
from the VPS to Doop at `127.0.0.1:4400`. No public 80/443 firewall rule or Caddy
is needed. Cloudflare is a trusted TLS intermediary for this traffic.

The public address is now Doop's canonical OAuth origin. Tailscale remains a
private transport for Pi's MCP requests; OAuth discovery points to the public
origin. Both origins are allowed in `TRUSTED_ORIGINS`. The tailnet helper retains
the public canonical origin after this optional deployment has been enabled.

Doop protects MCP tool access with OAuth or a user-created agent key. The tunnel
blocks the public `/api/auth/sign-up/...` route; it does not block private signup.
Doop's normal sign-in page and OAuth registration/discovery endpoints remain
public. Do not put an interactive Cloudflare Access login or browser challenge
in front of MCP/OAuth: cloud clients cannot complete that extra login flow.
Do not cache MCP, auth, API or WebSocket traffic with a custom Cloudflare rule.

For a Claude custom connector, enter the public `/mcp` URL and connect using
Doop OAuth (automatic client registration). A Team/Enterprise owner might need
to add it first. For a headless cloud agent, create a Doop agent key in Settings,
store it as a cloud-environment secret, and send it as an Authorization bearer
header. Never commit the key to `.mcp.json` or Git. Do not copy Pi's OAuth tokens
into another client. An agent key inherits its owner's access; revoke it when
no longer needed.

## Rebuild or migrate

Nix pins `cloudflared` and supplies the service and root setup script. The
service uses a separate `doop-tunnel` account, filesystem restrictions and
systemd `LoadCredential`. Its account cannot read personal home directories.

1. Deploy the main devbox-services package as described in `README.md`.
2. Restore the tunnel credential JSON from a protected backup, or authenticate
   and create a new tunnel:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create --credentials-file "$HOME/.cloudflared/doop-devbox.json" doop-devbox
   cloudflared tunnel route dns <UUID> doop.michaelosajeh.com
   ```

   Do not blindly create a second tunnel with the same name. Existing tunnels
   can be listed with `cloudflared tunnel list`. If restoring this deployment,
   use its existing UUID and credential JSON; its DNS record can stay unchanged.
   Stop the old connector before starting a replacement VPS unless both serve
   the same shared data. Two connectors would otherwise split traffic.
3. Run the optional root installer:

   ```sh
   sudo "$HOME/.local/opt/devbox-services/bin/setup-doop-cloudflare" \
     00b35969-0a35-4951-a003-aeb1c6ae3396 /private/path/credentials.json
   ```

   It preserves the signing secret, updates the canonical/trusted origins and
   enables `doop-cloudflared.service` at boot. It briefly restarts Doop.
4. Verify public HTTPS, OAuth and the private endpoint again.

Cloudflare's browser authorization creates `~/.cloudflared/cert.pem`. This is
an operator credential with broader tunnel-management permissions. It is not
used by the running service and does not belong in Git or Nix. Runtime tunnel
credentials are root-only at `/etc/cloudflared-doop/credentials.json` and are
included in Doop's root-only local backups. Keep offsite copies encrypted.

## Checks

```sh
sudo systemctl status doop-cloudflared
sudo journalctl -u doop-cloudflared -n 50 --no-pager
curl -fsS https://doop.michaelosajeh.com/healthz
curl -fsS https://doop.michaelosajeh.com/.well-known/oauth-protected-resource/mcp
```

Unauthenticated MCP tool requests must return 401 and the OAuth discovery
challenge. Public signup POSTs must return 404. Private health checks must still
work. `pi mcp list` should show the private `doop` server as connected (40 tools
in the pinned release). Run `/reload` in existing Pi sessions after adding it.

To disable public access without deleting data or the DNS record:

```sh
sudo systemctl disable --now doop-cloudflared
```

If removing the public hostname permanently, reset Doop's canonical origin and
reconnect OAuth clients as needed. Existing public links/redirects otherwise
continue to reference that hostname.
