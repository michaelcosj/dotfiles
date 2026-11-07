# Tailscale client on Fedora or Ubuntu

The client and daemon are pinned by `nix/flake.lock`. The host remains Fedora
or Ubuntu; Nix does not replace its kernel, firewall, or DNS services.

Build as your normal account, then install the root service:

```sh
nix build "$HOME/.dotfiles/nix#tailscale-client" \
  --out-link "$HOME/.local/opt/tailscale-client"
sudo "$HOME/.local/opt/tailscale-client/bin/setup-tailscale-client"
sudo tailscale up --accept-dns=true --accept-routes=false
```

Use the Git-backed flake, with deployment files tracked in Git, to exclude
untracked credentials/runtime state from the Nix store. Do not use `path:` on
this checkout. For new source files during development, use
`git add --intent-to-add nix/tailscale-client` before building.

Open the login URL and choose the same tailnet as `devbox`. This creates a
normal host client; Rex's embedded Tailscale identities are separate.

The installer retains a root-owned Nix GC root, installs the CLI at
`/usr/local/bin/tailscale`, and enables `tailscaled.service` at boot. It refuses
to replace a daemon managed by a distribution package or another deployment.
Rerun it after rebuilding to apply a changed Nix binary.

For SELinux compatibility, it copies the pinned static daemon (not its Nix
shell wrapper) to `/usr/local/libexec/nix-tailscaled`. On SELinux hosts, it adds
an exact-path persistent `bin_t` file-context rule and runs `restorecon` on
that file only. It does not relabel the Nix store, disable SELinux, or install
a broad allow policy. The daemon uses host network helper tools (`ip` and
`iptables`); the Nix build fails if the pinned daemon gains a dynamic loader.
`semanage` and `restorecon` must be available when SELinux is enabled.

It does not publish applications, enable Tailscale SSH, enable Serve/Funnel,
choose an exit node, advertise routes, or change host firewall rules. It keeps
the current tailnet's access policy; review ACLs/grants before sharing services.
Login/device state lives at `/var/lib/tailscale`, not in the Nix store or Git.

Check access:

```sh
tailscale status
tailscale ping devbox
curl -fsS https://devbox.danio-wezen.ts.net/healthz
```

MagicDNS must be enabled in the tailnet. If Tailscale reports DNS trouble on
Fedora, check NetworkManager/systemd-resolved integration before editing DNS
configuration. If direct connections fail, check the host firewall and NAT;
relay access can still work but has higher latency.
