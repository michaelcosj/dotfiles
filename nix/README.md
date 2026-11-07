# Nix environments

Ubuntu, Fedora, and macOS still own their system accounts and host services.
Home Manager manages user packages, dotfiles, and user services.

## Modules

- `home/common.nix`: shared headless-safe tools, shell, Git, editor, and CLI configuration.
- `home/personal.nix`: personal Git identity; not used by the work account.
- `home/desktop.nix`: shared desktop packages, Ghostty config, and devbox SSH aliases.
- `home/darwin.nix`: macOS additions.
- `home/linux/common.nix`: shared Linux packages, Nix settings, and Rex.
- `home/linux/desktop.nix`: Linux GUI apps, Flatpak, GPU integration, and Kanata.
- `home/linux/gnome.nix`: GNOME packages and preferences.
- `home/linux/fedora.nix`: Fedora-specific integration for the current desktop.
- `home/linux/devbox.nix`: headless development environment and portable Pi configuration.

A new Linux desktop can compose `linux/common.nix` and `linux/desktop.nix`,
with a separate distro module where needed. Fedora also imports `linux/gnome.nix`;
other desktops can choose GNOME or add their own desktop-environment module.

## Apply a configuration

Run as the account being configured, not as root:

```sh
home-manager switch --flake ~/.dotfiles/nix#m@fedora -b backup
home-manager switch --flake ~/.dotfiles/nix#m@devbox -b backup
home-manager switch --flake ~/.dotfiles/nix#work@devbox -b backup
```

After the first switch, Fish provides a host-specific `nix-rebuild` function.
It applies the current lock file; it does not update inputs. On desktops it
also refreshes the non-NixOS GPU driver link through sudo when needed.

To update packages:

```sh
cd ~/.dotfiles/nix
nix flake update
nix-rebuild
```

Prefer updating the lock file on the desktop, committing and pushing it, then
pulling and rebuilding on each account so all machines use the same pins.
Claude Code is installed through Nix on Linux, with its self-updater disabled.
The work account has the executable but no personal credentials.

Update only Rex with `nix flake update rex`, then rebuild. The snapshot input
is pinned to an immutable release URL in `flake.lock`.

## Ubuntu devbox bootstrap

The current devbox is `104.204.68.172`, x86_64 Ubuntu 26.04.
The original provisioning account is `devbox-root`; retain it for recovery.

Run the bootstrap script on the server as root, passing an SSH **public** key:

```sh
sudo bash setup-ubuntu-devbox /path/to/id_ed25519.pub
```

The script installs host prerequisites and multi-user Nix. It creates:

- `m`: administrator with passwordless sudo, matching the provisioning account.
- `work`: no administrative group membership.

Both use Fish and the supplied public key. Their home directories are private
from each other. Lingering is enabled for both accounts so user services can
run from boot and survive logout. The bootstrap script does not change SSH daemon settings
or firewall rules, and does not remove the provisioning account.

For Nix-pinned host Tailscale, private Doop, SSH hardening, firewall policy,
and backups, apply the separate [devbox services deployment](devbox/README.md).
It runs Doop as a non-sudo system account and leaves public web ports closed.
Ubuntu still manages its kernel and base-system security updates.

Each account needs its **own** writable checkout at `~/.dotfiles`. Do not share
one writable checkout across accounts. The upstream repository is
`https://github.com/michaelcosj/dotfiles.git`, with branch `main`.

After bootstrapping a fresh account:

```sh
git clone https://github.com/michaelcosj/dotfiles.git ~/.dotfiles
```

To deploy committed changes, run as each account:

```sh
cd ~/.dotfiles
git pull --ff-only
nix-rebuild
```

Initial source snapshots are retained as `~/.dotfiles.before-git-*` when replaced
by clones. Never copy `.env`, private keys, Pi auth, or session state as part of
source deployment. Import credentials separately only for the intended account.

For a first Home Manager switch before the command is installed:

```sh
nix build ~/.dotfiles/nix#homeConfigurations.m@devbox.activationPackage \
  --out-link /tmp/home-manager-m
/tmp/home-manager-m/activate
```

Use `work@devbox` and a different output link when logged in as `work`.

The work account uses `michael <michael@synthally.com>` as its Git identity.
Git's `user.useConfigOnly` remains enabled so it never guesses an identity.
Override the name or email per project when necessary:

```sh
git config user.name 'Other Work Name'
git config user.email 'you@company.example'
```

Pi settings are seeded once into a private writable file, without desktop-local
package paths, device identity, or Paper MCP. Portable npm and Git packages are
included. The personal Claude Code and cached-compaction forks are pinned to
commits in `config/pi/agent/settings.json`.

Existing accounts keep their runtime settings during rebuilds. To add or change
a package there, run `pi install <source>` with its pinned source from the shared
settings. Auth and sessions remain separate per account; sign in to providers as
needed. Shared extensions, skills, and prompts come from each account's own checkout.

## SSH and Rex

Desktop aliases:

```sh
ssh devbox         # m
ssh devbox-work    # work
ssh devbox-admin   # original provisioning account
```

Rex runs as a separate systemd user service for each Linux account. Each keeps
its private Unix socket, with no anonymous TCP listener. Devbox servers also
have built-in Tailscale enabled, as described below.

```sh
systemctl --user status rex
journalctl --user -u rex
rex server status
```

Rex's module keeps the running server across Home Manager updates to avoid
ending sessions. When ready to use a newly installed version, restart it:

```sh
systemctl --user restart rex
```

Restarting the server ends its sessions. If `rex server stop` was used, start
it again with `systemctl --user start rex`.

For terminal programs launched through sudo, install the terminfo entry system-wide:

```sh
sudo "$(command -v rex)" terminfo setup --system
```

This has already been done on the devbox. It installs terminal data and an
outgoing SSH guard, not an SSH server or a new network listener.

## Rex remote access through Tailscale

The devbox Home Manager profile enables Rex's built-in Tailscale integration:

```nix
services.rex.tailscale = {
  enable = true;
  hostname = "devbox-${config.home.username}";
  allowTailnetMembers = false;
};
```

This creates separate Tailscale devices for `m` and `work`: `devbox-m` and
`devbox-work`. Rex does not need a host-level Tailscale daemon.
The separate `nix/devbox` deployment uses a host daemon for private Doop HTTPS;
it creates another device, `devbox`, without changing Rex's identities.
Each device must be enrolled once. Login state stays private to that account;
no auth key belongs in this repository or the Nix store.

### Create a tailnet and enroll Rex

1. Sign up at <https://login.tailscale.com/start> and create a tailnet. Choose
   personal use only if appropriate; use your organization's tailnet for work
   when its policy requires that.
2. Rebuild the MacBook to install the native Tailscale app through the
   nix-darwin Homebrew configuration:

   ```sh
   cd ~/.dotfiles
   git pull --ff-only
   sudo darwin-rebuild switch --flake ./nix#macbook
   open -a Tailscale
   ```

   Approve its VPN/network-extension permissions and sign in to the same
   tailnet. This uses the `tailscale-app` cask, not the CLI-only Nix package.
3. Open <https://login.tailscale.com/admin/dns>. Enable MagicDNS and HTTPS
   certificates. Certificate names are published in public certificate
   transparency logs, but the services remain private to the tailnet.
4. Sign in to each devbox Rex device using the enrollment link from:

   ```sh
   ssh devbox 'rex server status'
   ssh devbox-work 'rex server status'
   ```

   If a link is not shown there, inspect that account's service log:

   ```sh
   journalctl --user -u rex -n 100 --no-pager
   ```

5. Open Rex for Mac, choose **Add Remote Host...**, and add each device's exact
   HTTPS address shown by Rex/Tailscale. They have this form:

   ```text
   https://devbox-m.<tailnet>.ts.net
   https://devbox-work.<tailnet>.ts.net
   ```

Both Rex devices accept only their enrolling Tailscale owner by default, subject
to tailnet access rules. A connection has full control of that server account;
`m` includes passwordless sudo. Do not enable `allowTailnetMembers` without
reviewing access rules. SSH aliases and existing SSH access remain unchanged.

Applying Home Manager changes does not restart an existing Rex server, to protect
sessions. Enabling this integration on an already-running server therefore needs
one `systemctl --user restart rex` per account. Check `rex ls` first: restarting
ends its sessions. Once enrolled, later restarts reuse its saved Tailscale identity.

Documentation: <https://www.superlogical.com/rex/docs/linux/remote-access> and
<https://tailscale.com/docs/how-to/quickstart>.

## Tailscale on a Linux desktop

Use the [Nix-managed Tailscale client](tailscale-client/README.md) to join the
same tailnet as `devbox`. It installs a boot-persistent host daemon without
publishing local services. This is separate from Rex's embedded Tailscale.

## Fedora host prerequisites

These remain host-level steps; Home Manager does not install RPMs or udev rules.

1. Install multi-user Nix.
2. Install Fish from Fedora and make it the login shell:
   `sudo dnf install fish`, then `chsh -s /usr/bin/fish`.
3. Install a container runtime through Fedora if needed.
4. Install matching GNOME extensions:
   `sudo dnf install gnome-shell-extension-{auto-move-windows,appindicator,blur-my-shell,caffeine,gsconnect}`.
5. Grant Kanata device access, then log out and back in (or reboot):

   ```sh
   getent group uinput || sudo groupadd --system uinput
   sudo usermod -aG input,uinput "$USER"
   echo 'KERNEL=="uinput", MODE="0660", GROUP="uinput", OPTIONS+="static_node=uinput"' \
     | sudo tee /etc/udev/rules.d/99-uinput.rules
   ```

6. Run the `sudo .../non-nixos-gpu-setup` command printed by the first switch.
7. For the current laptop's power setup:
   `sudo bash ~/.dotfiles/nix/scripts/setup-power-management`.
