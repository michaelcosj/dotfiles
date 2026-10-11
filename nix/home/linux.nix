# Linux-only (non-NixOS, e.g. Fedora) home-manager config.
#
# First-time setup:
#   1. Install Nix: curl -sSfL https://install.determinate.systems/nix | sh -s -- install
#   2. nix run home-manager -- switch --flake ~/.dotfiles/nix#m@fedora -b backup
#   3. sudo dnf install fish && chsh -s /usr/bin/fish
#   4. Run the `sudo .../non-nixos-gpu-setup` command printed by the switch (GPU drivers
#      for nix GUI apps). After this, `nix-rebuild` re-runs it automatically when needed.
#   5. Container runtime from dnf (docker or podman), since it needs a system service.
#   6. GNOME extensions (enabled in dconf.settings below):
#        sudo dnf install gnome-shell-extension-{auto-move-windows,appindicator,gpaste,caffeine,gsconnect}
#   7. kanata access to keyboards, then reboot:
#        sudo groupadd --system uinput
#        sudo usermod -aG input,uinput m
#        echo 'KERNEL=="uinput", MODE="0660", GROUP="uinput", OPTIONS+="static_node=uinput"' \
#          | sudo tee /etc/udev/rules.d/99-uinput.rules
{ pkgs, lib, config, ... }:
{
  # XDG dirs, desktop entries, fonts and GPU driver integration for nix apps.
  targets.genericLinux.enable = true;

  home.packages = with pkgs; [
    gcc
    gnomeExtensions.hot-edge # not in Fedora's repos; nixpkgs build supports GNOME 50
    nerd-fonts.zed-mono
    kanata
    unar
    wl-clipboard
    zed-editor
  ];

  # Installs Ghostty plus its systemd user unit, which GNOME needs to launch it
  # from the app menu (D-Bus activation). Config stays in config/ghostty, since
  # no `settings` are set here.
  programs.ghostty.enable = true;

  # Proprietary/Electron apps from Flathub, the Linux counterpart to the Homebrew casks.
  services.flatpak = {
    enable = true;
    packages = [
      "com.discordapp.Discord"
      "com.spotify.Client"
      "com.stremio.Stremio"
      "com.transmissionbt.Transmission"
      "md.obsidian.Obsidian"
      "org.localsend.localsend_app"
    ];
    update.auto = {
      enable = true;
      onCalendar = "weekly";
    };
  };

  # GNOME settings. Extensions come from dnf (step 6) so they match the system
  # gnome-shell version; enabling them here overrides toggles in the Extensions app.
  dconf.settings = {
    "org/gnome/shell".enabled-extensions = [
      "background-logo@fedorahosted.org"
      "auto-move-windows@gnome-shell-extensions.gcampax.github.com"
      "appindicatorsupport@rgcjonas.gmail.com"
      "GPaste@gnome-shell-extensions.gnome.org"
      "caffeine@patapon.info"
      "gsconnect@andyholmes.github.io"
      "hotedge@jonathan.jdoda.ca"
    ];
    # Push against the bottom-centre of the screen to open Activities.
    "org/gnome/shell/extensions/hotedge" = {
      edge-size = lib.hm.gvariant.mkUint32 30; # % of width, centred
      pressure-threshold = lib.hm.gvariant.mkUint32 60; # px of push to trigger (default 150)
    };
    # "<desktop file>:<workspace number>", numbered from 1.
    "org/gnome/shell/extensions/auto-move-windows".application-list = [
      "com.mitchellh.ghostty.desktop:1"
      "helium.desktop:2"
    ];
    # Fixed workspaces so the workspaces above always exist.
    "org/gnome/mutter".dynamic-workspaces = false;
    "org/gnome/desktop/wm/preferences".num-workspaces = 6;
  };

  # Caps Lock: Esc on tap, Ctrl on hold (Karabiner replacement). Needs step 7 above.
  systemd.user.services.kanata = {
    Unit.Description = "kanata keyboard remapper";
    Service = {
      ExecStart = "${pkgs.kanata}/bin/kanata --cfg ${config.home.homeDirectory}/.dotfiles/nix/config/kanata/kanata.kbd";
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install.WantedBy = [ "default.target" ];
  };

  nix = {
    package = pkgs.nix;
    gc.automatic = true;
    settings.experimental-features = "nix-command flakes";
  };

  # Switch, then (re)install the GPU driver link via sudo only when the new
  # generation's drivers differ from what /run/opengl-driver points at. Paths are
  # resolved from the profile at runtime so they reflect the generation just built.
  programs.fish.functions.nix-rebuild = ''
    home-manager switch --flake ~/.dotfiles/nix#m@fedora $argv; or return

    set -l setup (command -v non-nixos-gpu-setup); or return 0
    set setup (path resolve $setup)
    set -l conf (path dirname (path dirname $setup))/lib/tmpfiles.d/non-nixos-gpu.conf
    set -l wanted (string match -rg '^L\+ /run/opengl-driver\s.*\s(\S+)$' < $conf)
    set -l current (readlink /run/opengl-driver)

    if test "$current" != "$wanted"
      echo "GPU drivers changed, running $setup with sudo"
      sudo $setup
    end
  '';
}
