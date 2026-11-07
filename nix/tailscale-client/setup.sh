#!/bin/bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ $EUID == 0 ]] || { echo 'Run this installer with sudo or pkexec.' >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
case "$ID" in
  fedora|ubuntu) ;;
  *) echo 'Only Fedora and Ubuntu are supported.' >&2; exit 1 ;;
esac
# Do not overwrite a distribution-managed or other deployment's daemon.
existing=$(systemctl show tailscaled.service -p FragmentPath --value)
if [[ -n "$existing" ]] && ! grep -q '^# Managed by nix/tailscale-client\.$' "$existing"; then
  echo "Refusing to replace an existing Tailscale service: $existing" >&2
  exit 1
fi
selinux=false
if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
  selinux=true
  for cmd in semanage restorecon; do
    command -v "$cmd" >/dev/null || { echo "Required SELinux tool missing: $cmd" >&2; exit 1; }
  done
fi
# Stop the old daemon (including its restart loop) before replacing its binary.
if [[ -n "$existing" ]]; then systemctl stop tailscaled.service; fi
ln -sfn '@self@' /nix/var/nix/gcroots/tailscale-client
install -d -m 0755 /usr/local/bin /usr/local/libexec
ln -sfn '@tailscale@/bin/tailscale' /usr/local/bin/tailscale
# Copy, rather than symlink, so the label belongs only to this host executable.
# The bytes still come from the pinned, GC-rooted Nix package.
install -o root -g root -m 0755 '@self@/libexec/tailscaled' /usr/local/libexec/nix-tailscaled
if "$selinux"; then
  if semanage fcontext -l -C | awk '$1 == "/usr/local/libexec/nix-tailscaled" { found=1 } END { exit !found }'; then
    semanage fcontext -m -t bin_t /usr/local/libexec/nix-tailscaled
  else
    semanage fcontext -a -t bin_t /usr/local/libexec/nix-tailscaled
  fi
  restorecon -v /usr/local/libexec/nix-tailscaled
fi
cat > /etc/systemd/system/tailscaled.service <<'EOF'
# Managed by nix/tailscale-client.
[Unit]
Description=Tailscale client (Nix-managed binary)
Wants=network-online.target
After=network-online.target

[Service]
Type=notify
StateDirectory=tailscale
StateDirectoryMode=0700
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
Environment=PATH=/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/local/libexec/nix-tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl reset-failed tailscaled.service
systemctl enable --now tailscaled.service
printf '\nTailscale is installed. Sign in to the devbox tailnet:\n'
printf '  sudo tailscale up --accept-dns=true --accept-routes=false\n'
printf 'This installer does not enable SSH, Serve, Funnel, or an exit node.\n'
