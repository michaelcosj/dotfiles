# GNOME desktop preferences. Host-specific additions belong in the distro module.
{
  pkgs,
  lib,
  config,
  ...
}:
{
  home.packages = with pkgs; [
    gnomeExtensions.copyous
    gnomeExtensions.hot-edge
  ];

  dconf.settings = {
    "org/gnome/settings-daemon/plugins/power" = {
      idle-dim = true;
      sleep-inactive-ac-type = "nothing";
      sleep-inactive-battery-type = "nothing";
    };
    "org/gnome/desktop/session".idle-delay = lib.hm.gvariant.mkUint32 1800;
    "org/gnome/desktop/screensaver" = {
      idle-activation-enabled = true;
      lock-enabled = true;
      lock-delay = lib.hm.gvariant.mkUint32 0;
    };
    "org/gnome/shell".enabled-extensions = [
      "auto-move-windows@gnome-shell-extensions.gcampax.github.com"
      "appindicatorsupport@rgcjonas.gmail.com"
      "blur-my-shell@aunetx"
      "copyous@boerdereinar.dev"
      "caffeine@patapon.info"
      "gsconnect@andyholmes.github.io"
      "hotedge@jonathan.jdoda.ca"
      "agent-bar@local"
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

}
