#!/bin/bash
# Run only after testing a second SSH connection with public-key auth.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
if [[ $EUID != 0 || ${1:-} != --ssh-key-access-confirmed ]]; then
  echo 'Usage: sudo setup-devbox-services --ssh-key-access-confirmed' >&2
  exit 1
fi
runtime='@runtime@'
source='@source@'
self='@self@'
# shellcheck source=/dev/null
[[ -f /etc/os-release ]] && . /etc/os-release
[[ ${ID:-} == ubuntu ]] || { echo 'This deployment supports Ubuntu only.' >&2; exit 1; }
for cmd in ufw python3 runuser curl sshd; do command -v "$cmd" >/dev/null; done

# Root-owned GC root: an account's Nix GC must not remove live service tools.
ln -sfn "$self" /nix/var/nix/gcroots/devbox-services
install -d -m 0755 /opt
ln -sfn "$runtime" /opt/devbox-runtime
ln -sfn "$runtime/bin/tailscale" /usr/local/bin/tailscale

# SSH's first matching value wins. This file precedes cloud-init's defaults.
install -d -m 0700 /var/backups/devbox-hardening
if [[ ! -e /var/backups/devbox-hardening/sshd_config ]]; then
  cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.d /var/backups/devbox-hardening/
fi
install -m 0644 "$self/config/00-devbox-hardening.conf" /etc/ssh/sshd_config.d/00-devbox-hardening.conf
if ! sshd -t; then
  rm /etc/ssh/sshd_config.d/00-devbox-hardening.conf
  echo 'Invalid SSH config; new file removed. SSH was not reloaded.' >&2
  exit 1
fi
systemctl reload ssh
# Keep public key-based SSH for recovery until tailnet access is verified.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'Key-only SSH recovery'
ufw allow 41641/udp comment 'Tailscale direct connections'
ufw allow in on tailscale0 to any port 443 proto tcp comment 'Private Doop HTTPS'
ufw --force enable
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# A system account with no login shell, SSH keys, sudo or personal credentials.
if ! id doop >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/doop --shell /usr/sbin/nologin doop
fi
[[ $(id -Gn doop) == doop ]] || { echo 'Unexpected groups on doop account' >&2; exit 1; }
install -d -m 0750 -o root -g doop /var/lib/doop /var/lib/doop/releases
install -d -m 0700 -o doop -g doop /var/lib/doop/data /var/lib/doop/cache
install -d -m 0700 /etc/doop /var/backups/doop

# Frozen upstream bun.lock and Nix-pinned source/runtime. Dependency download and
# client compilation run here, NOT in a hermetic Nix derivation (see README).
release="/var/lib/doop/releases/@revision@-$(basename "$runtime")"
if [[ ! -f "$release/.ready" ]]; then
  install -d -m 0750 -o doop -g doop "$release"
  cp -rT "$source" "$release"
  chmod -R u+w "$release"
  chown -R doop:doop "$release"
  python3 - "$release/server/index.ts" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
old = 'server.listen(PORT, () => {'
assert s.count(old) == 1, 'Upstream listener changed; review before deployment'
p.write_text(s.replace(old, "server.listen(PORT, '127.0.0.1', () => {"))
PY
  # $1 is expanded by the child shell, not the installer.
  # shellcheck disable=SC2016
  runuser -u doop -- env HOME=/var/lib/doop XDG_CACHE_HOME=/var/lib/doop/cache PATH="$runtime/bin:/usr/bin:/bin" \
    bash -e -c 'cd "$1"; bun install --frozen-lockfile; bun run build' -- "$release"
  touch "$release/.ready"
  chown -R root:doop "$release"
  chmod -R go-w "$release"
fi

# Stop the original personal service before making a consistent data copy.
if id m >/dev/null 2>&1; then
  runuser -u m -- env XDG_RUNTIME_DIR="/run/user/$(id -u m)" \
    systemctl --user disable --now doop.service || true
fi
systemctl stop doop.service 2>/dev/null || true
if [[ ! -e /var/lib/doop/data/.migrated ]]; then
  if [[ -d /home/m/.local/share/doop/app/data/pg && ! -d /var/lib/doop/data/pg ]]; then
    cp -a /home/m/.local/share/doop/app/data/. /var/lib/doop/data/
  fi
  touch /var/lib/doop/data/.migrated
  chown -R doop:doop /var/lib/doop/data
fi
ln -sfn /var/lib/doop/data "$release/data"
ln -sfn "$release" /var/lib/doop/app

python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('/etc/doop/environment')
old = Path('/home/m/.config/doop/environment')
s = p.read_text() if p.exists() else (old.read_text() if old.exists() else '')
values = dict(line.split('=', 1) for line in s.splitlines() if line and not line.startswith('#') and '=' in line)
values.setdefault('BETTER_AUTH_SECRET', secrets.token_hex(32))
values.setdefault('BETTER_AUTH_URL', 'http://localhost:4400')
values.update(NODE_ENV='production', PORT='4400',
    CHROME_PATH='/opt/devbox-runtime/bin/chromium', CHROME_NO_SANDBOX='1',
    FONTCONFIG_FILE='/etc/doop/fonts.conf', XDG_CACHE_HOME='/var/lib/doop/cache',
    XDG_CONFIG_HOME='/var/lib/doop/cache/config',
    PATH='/opt/devbox-runtime/bin:/usr/bin:/bin')
p.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
p.chmod(0o600)
PY
cat > /etc/doop/fonts.conf <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>$runtime/share/fonts</dir>
  <cachedir>/var/lib/doop/cache/fontconfig</cachedir>
  <alias><family>sans-serif</family><prefer><family>Liberation Sans</family><family>DejaVu Sans</family></prefer></alias>
  <alias><family>serif</family><prefer><family>Liberation Serif</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>Liberation Mono</family></prefer></alias>
</fontconfig>
EOF
chmod 0644 /etc/doop/fonts.conf
# The directory is private; allow the service account to read only fonts.conf.
chown root:doop /etc/doop
chmod 0750 /etc/doop
install -m 0750 "$self/config/doop-backup" /usr/local/sbin/doop-backup
install -m 0755 "$self/bin/connect-doop-tailnet" /usr/local/sbin/connect-doop-tailnet
install -m 0755 "$self/bin/connect-opencode-tailnet" /usr/local/sbin/connect-opencode-tailnet
for unit in doop.service tailscaled.service doop-backup.service doop-backup.timer; do
  install -m 0644 "$self/config/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now tailscaled.service doop.service doop-backup.timer
printf '\nInstalled. Authenticate Tailscale, then run: sudo connect-doop-tailnet\n'
printf '  sudo tailscale up --hostname=devbox --accept-routes=false --accept-dns=false\n'
printf 'Do not enable Funnel. Review tailnet access rules before sharing.\n'
