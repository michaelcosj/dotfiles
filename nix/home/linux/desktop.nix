# Linux desktop tools; no distro package manager assumptions.
{
  pkgs,
  lib,
  config,
  hex,
  nix-flatpak,
  ...
}:
let
  # 1.13.0-prerelease-1 for jtroo/kanata#2129: 1.12.0 never drains its inotify
  # queue, so after a Bluetooth keyboard reconnects (the K780 waking up) it can
  # miss the new /dev/input node and stop remapping it until a restart. Drop
  # this override once nixpkgs ships kanata >= 1.13.0.
  kanata = pkgs.kanata.overrideAttrs (
    final: old: {
      version = "1.13.0-prerelease-1";
      src = pkgs.fetchFromGitHub {
        owner = "jtroo";
        repo = "kanata";
        rev = "v${final.version}";
        hash = "sha256-EDmhgP8P4wZolP9QZDrO0VOODd5c0416ruPNIeftLys=";
      };
      cargoDeps = pkgs.rustPlatform.fetchCargoVendor {
        inherit (final) src;
        hash = "sha256-moRxx2X+mmJVtgopsTtN5s7jRyZ1Vz0F1qnFH/5SQZg=";
      };
      # 1.13 links libudev (gamepad input).
      nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.pkg-config ];
      buildInputs = (old.buildInputs or [ ]) ++ [ pkgs.udev ];
      # The tagged source reports itself as v1.13.0-prerelease-2, so versionCheckHook fails.
      doInstallCheck = false;
    }
  );
in
{
  imports = [
    ../desktop.nix
    hex.homeManagerModules.default
    nix-flatpak.homeManagerModules.nix-flatpak
  ];

  targets.genericLinux.gpu.enable = true;
  home.packages = with pkgs; [
    nerd-fonts.zed-mono
    kanata
    wl-clipboard
    zed-editor
  ];

  # Also supplies the systemd user unit used for D-Bus activation.
  programs.ghostty.enable = true;
  # Loads the shared file, then the Linux one. Both are read straight from the
  # repo, so edits apply on reload without a rebuild.
  xdg.configFile."ghostty/config".text =
    let
      dir = "${config.home.homeDirectory}/.dotfiles/nix/config/ghostty";
    in
    ''
      config-file = ${dir}/common
      config-file = ${dir}/linux
    '';
  # Custom theme files, linked from the repo so new themes need no rebuild.
  # Rex Rune also reads this directory for its terminal themes.
  xdg.configFile."ghostty/themes".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/ghostty/themes";

  # Local dictation. The module installs the desktop entry and runs the
  # single Hex process as a user service once the graphical session is up.
  programs.hex = {
    enable = true;
    autostart = true;
  };

  # Flatpak apps from Flathub and upstream repositories.
  services.flatpak = {
    enable = true;
    packages = [
      {
        appId = "co.hyprlab.Hylki";
        flatpakref = "https://hylki.hyprlab.co/flatpak/co.hyprlab.Hylki.flatpakref";
        sha256 = "0rgbr4hf27j1g7s1grdvbi94m7m9hbmyv6fb1ar1lf8sdd3bcas6";
      }
      "com.discordapp.Discord"
      "com.spotify.Client"
      "com.stremio.Stremio"
      "com.transmissionbt.Transmission"
      "it.mijorus.gearlever" # integrates AppImages into the app menu and tracks their updates
      "md.obsidian.Obsidian"
      "org.localsend.localsend_app"
    ];
    update.auto = {
      enable = true;
      onCalendar = "weekly";
    };
  };

  # Caps Lock: Esc on tap, Ctrl on hold (Karabiner replacement). Needs the
  # uinput access from README.md (Fedora host prerequisites, step 5).
  systemd.user.services.kanata = {
    Unit.Description = "kanata keyboard remapper";
    Service = {
      ExecStart = "${kanata}/bin/kanata --cfg ${config.home.homeDirectory}/.dotfiles/nix/config/kanata/kanata.kbd";
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install.WantedBy = [ "default.target" ];
  };

  # Apply host GPU integration after the normal Home Manager switch.
  programs.fish.functions.nix-rebuild.body = lib.mkAfter ''
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
