# Fedora GNOME desktop. Ubuntu and other desktops can compose their own modules.
{ pkgs, lib, rex-rune, ... }:
{
  imports = [
    ./desktop.nix
    ./gnome.nix
  ];

  # Rex joins the tailnet as its own device, `rex`, reachable only by its enrolling owner.
  services.rex.tailscale.enable = true;

  # GearLever launches host AppImages. Fedora lacks libfuse.so.2.
  systemd.user.sessionVariables.LD_LIBRARY_PATH = "${lib.getLib pkgs.fuse}/lib";
  home.packages = [
    pkgs.gnome-power-manager
    # Rex Linux client. Vulkan comes from the host driver (genericLinux.gpu, desktop.nix).
    # Skip its check phase: that is upstream's CI gate, and here it fails for
    # reasons outside the app (0.7.4: newer clippy lints with -D warnings, and
    # self-update installer tests that need desktop-file-install). It also
    # costs about 12 min of test builds per update.
    (rex-rune.packages.${pkgs.stdenv.hostPlatform.system}.default.overrideAttrs { doCheck = false; })
  ];
  dconf.settings."org/gnome/shell".enabled-extensions = lib.mkBefore [
    "background-logo@fedorahosted.org"
  ];
}
