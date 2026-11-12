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
    # Its check runs `cargo clippy -D warnings`, and new lints fail the build
    # (0.7.4: question_mark, chunks_exact_to_as_chunks). Lints are upstream's
    # gate; keep the tests and the connection smoke test, skip fmt and clippy.
    (rex-rune.packages.${pkgs.stdenv.hostPlatform.system}.default.overrideAttrs { preCheck = ""; })
  ];
  dconf.settings."org/gnome/shell".enabled-extensions = lib.mkBefore [
    "background-logo@fedorahosted.org"
  ];
}
