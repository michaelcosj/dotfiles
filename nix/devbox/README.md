# Ubuntu devbox services and hardening

This is an explicit root deployment for an Ubuntu VPS with multi-user Nix.
It does not convert Ubuntu to NixOS. Ubuntu still owns the kernel, SSH,
firewall, systemd, and base-system security updates. Home Manager still owns
personal development tools and Rex. Do not install a second Tailscale daemon
through apt or Home Manager.

## Rebuild on another VPS

1. Run `nix/scripts/setup-ubuntu-devbox` with your public key. Keep the provider's
   recovery console available. Copy a separate dotfiles checkout to each account.
2. Apply Home Manager as described in `nix/README.md`.
3. Test a **second** SSH session with keys only, including the recovery account:

   ```sh
   ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no devbox
   ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no devbox-admin
   ```

4. As `m` on the VPS, build the locked service configuration:

   ```sh
   nix build "$HOME/.dotfiles/nix#devbox-services" \
     --out-link "$HOME/.local/opt/devbox-services"
   sudo "$HOME/.local/opt/devbox-services/bin/setup-devbox-services" \
     --ssh-key-access-confirmed
   ```

   Use the Git-backed flake so untracked credentials and runtime files stay
   outside the Nix store. Deployment files must be tracked in Git. During
   development, `git add --intent-to-add nix/devbox` includes new source files
   without staging their contents. Do not use `path:` on this checkout: it can
   include ignored credentials.
5. Enroll the **host** in your intended tailnet (separate from Rex's devices):

   ```sh
   sudo tailscale up --hostname=devbox --accept-routes=false --accept-dns=false
   ```

   Open the login URL and approve the device. Enable MagicDNS and HTTPS
   certificates in the tailnet's DNS settings. Certificate hostnames enter
   public Certificate Transparency logs; the service remains private.
6. Enable private HTTPS and set Doop's canonical auth/MCP origin:

   ```sh
   sudo connect-doop-tailnet
   sudo tailscale serve status
   ```

   This uses **Serve**, not public **Funnel**. Review tailnet ACLs/grants: a
   tailnet's default policy can allow all members. Limit access to the intended
   people/devices; keep Doop's own account authentication enabled.
7. Install Ubuntu updates, then reboot in an agreed maintenance window:

   ```sh
   sudo apt-get update
   sudo apt-get upgrade
   sudo reboot
   ```

   Check key-based SSH and the Tailscale HTTPS URL again after reboot.

For Tailscale-only access, no Caddy, custom domain, public 80/443, subnet routes,
or exit-node configuration is needed. An optional [Cloudflare Tunnel](CLOUDFLARE.md)
provides public OAuth/MCP access for cloud agents outside the tailnet. Public TCP 22 remains open for key-only recovery. UDP 41641 permits
Tailscale direct connections. Do not remove SSH recovery until tailnet access
has been tested. Rex's embedded nodes keep their own identities; with inbound
filtering they might need relay connections. Check connectivity if latency changes.

## What is reproducible

- Nix package versions are pinned by `nix/flake.lock` (`nixpkgs-linux`).
- Doop source is pinned by commit and archive hash in `default.nix`.
- Dependencies use the upstream frozen `bun.lock`.
- SSH policy, firewall rules, system services, and backup policy are in this directory.
- Nix owns the runtime closure, including Tailscale, Node, Bun, Chromium and fonts.
  The installer registers a root-owned GC root so normal GC cannot remove it.

**Doop's dependency download and client build run at deployment time with Bun.**
They are not a sandboxed, hermetic Nix application derivation. The runtime and
source are Nix-managed, but dependency installation still requires the upstream
package registry. Ubuntu packages are updated for security, not pinned by Nix.

Do not put signing secrets, API keys, Tailscale state, or personal credentials
in Nix expressions or the Nix store.

## Isolation and storage

- `doop` is a non-login, non-sudo system account.
- The source/build is root-owned under `/var/lib/doop/releases`; `/var/lib/doop/app`
  selects the release. The Node server binds only `127.0.0.1:4400`.
- Writable database and assets: `/var/lib/doop/data` (PGlite and `assets/`).
- Cache: `/var/lib/doop/cache`.
- Private environment: `/etc/doop/environment`, root-only 0600, loaded by systemd.
- Systemd provides filesystem restrictions, private devices/tmp, no new privileges,
  no capabilities, and a 3 GiB memory limit. Chromium runs without its own sandbox,
  as required by this deployment; the system service restrictions are not a VM.
- Original personal-service data/config are retained after first migration for
  recovery, but that service is disabled. Do not restart the old user service.

Signup remains available to people permitted to access the service. To share
beyond a trusted personal tailnet, configure verified email/SSO and review signup
policy. Do not treat an unverified email-domain allowlist as an identity check.

## Backups and migration

`doop-backup.timer` runs daily near 04:30 UTC and keeps seven local archives.
It briefly stops Doop to copy PGlite consistently. Archives include the database,
uploaded assets, `/etc/doop` (including the signing secret and any model keys),
and `/etc/cloudflared-doop` when the optional public tunnel is configured.
They are root-only under `/var/backups/doop`. Run and inspect a backup with:

```sh
sudo systemctl start doop-backup.service
sudo systemctl status doop-backup.service
sudo tar -tzf /var/backups/doop/doop-<timestamp>.tar.gz
```

**Local backups do not protect against VPS loss.** Copy them to encrypted offsite
storage. Offsite credentials/destination are not configured by this deployment.
A restore test is still required before relying on backups.

On a replacement VPS, deploy the configuration, stop Doop, then restore
`var/lib/doop/data` and `etc/doop` from an archive as root. Set the data owner to
`doop:doop`, rerun the installer to refresh machine-specific font/runtime paths,
then start Doop. Enroll a new Tailscale host and run `connect-doop-tailnet` to set
its correct URL. Keep the signing secret to preserve encrypted/signed account data.
Tailscale device identity is separate at `/var/lib/tailscale`; normally enroll a
new node rather than run two hosts with the same restored identity.

## Operations and updates

```sh
sudo systemctl status doop tailscaled doop-backup.timer
sudo journalctl -u doop -n 100 --no-pager
sudo tailscale status
sudo tailscale serve status
sudo ufw status verbose
sudo sshd -T
curl -fsS http://127.0.0.1:4400/healthz
```

Update `nix/flake.lock` deliberately for runtime security updates. Update Doop's
commit/hash together in `default.nix`, then rebuild and
rerun the installer. Back up before updates. The installer validates its loopback
listener patch against upstream and fails if it no longer matches.

The installer does not revoke existing SSH keys, remove administrative access
from `m`, reset existing firewall rules, or audit third-party tunnels. Such changes
need a separate review. Password and root SSH login are disabled; forwarding is
kept for development tunnels. SSH config before the first hardening is retained
under `/var/backups/devbox-hardening`.
