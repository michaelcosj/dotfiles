# Linux desktop tools; no distro package manager assumptions.
{
  pkgs,
  lib,
  config,
  nix-flatpak,
  ...
}:
{
  imports = [
    ../desktop.nix
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
