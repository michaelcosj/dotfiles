# Fedora GNOME desktop. Ubuntu and other desktops can compose their own modules.
{ pkgs, lib, ... }:
{
  imports = [
    ./desktop.nix
    ./gnome.nix
  ];

  # Rex joins the tailnet as its own device, `rex`, reachable only by its enrolling owner.
  services.rex.tailscale.enable = true;

  # GearLever launches host AppImages. Fedora lacks libfuse.so.2.
  systemd.user.sessionVariables.LD_LIBRARY_PATH = "${lib.getLib pkgs.fuse}/lib";
  home.packages = [ pkgs.gnome-power-manager ];
  dconf.settings."org/gnome/shell".enabled-extensions = lib.mkBefore [
    "background-logo@fedorahosted.org"
  ];
}
