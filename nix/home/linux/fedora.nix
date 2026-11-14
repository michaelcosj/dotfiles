# Fedora GNOME desktop. Ubuntu and other desktops can compose their own modules.
{ pkgs, lib, rex-rune, ... }:
let
  # Rex Linux client. Vulkan comes from the host driver (genericLinux.gpu, desktop.nix).
  # Skip its check phase: that is upstream's CI gate, and here it fails for
  # reasons outside the app (0.7.4: newer clippy lints with -D warnings, and
  # self-update installer tests that need desktop-file-install). It also
  # costs about 12 min of test builds per update.
  # Local patch: a Charcoal Atelier chrome palette with its paired terminal
  # theme (from Rex Beta), and `interface.active_pane_outline_width` in
  # workspace.json (default 2 pt). Drop parts once upstream ships them; if it
  # stops applying after a version bump, rebase it on the new source.
  rexRunePatched = rex-rune.packages.${pkgs.stdenv.hostPlatform.system}.default.overrideAttrs (old: {
    doCheck = false;
    patches = (old.patches or [ ]) ++ [ ../../patches/rex-rune-local.patch ];
  });
  # Run it on XWayland: winit 0.30 reports no file drops on Wayland, so dragging
  # a file onto a pane does nothing there. Wrapped outside the build, so this
  # toggles without a rebuild. Drop it once upstream's winit takes Wayland drops.
  desktopFile = "share/applications/dev.shuv.rex-rune.desktop";
  rexRune = pkgs.symlinkJoin {
    name = "rex-rune-x11-${rexRunePatched.version}";
    paths = [ rexRunePatched ];
    nativeBuildInputs = [ pkgs.makeWrapper ];
    postBuild = ''
      wrapProgram $out/bin/rex-rune --set WAYLAND_DISPLAY "" --unset WAYLAND_SOCKET
      # The launcher entry names the unwrapped binary by store path.
      test -f ${rexRunePatched}/${desktopFile} \
        || { echo "rex-rune: ${desktopFile} is gone; update fedora.nix" >&2; exit 1; }
      rm $out/${desktopFile}
      sed "s|${rexRunePatched}/bin/rex-rune|$out/bin/rex-rune|g" \
        ${rexRunePatched}/${desktopFile} > $out/${desktopFile}
      grep -q "^Exec=$out/bin/rex-rune" $out/${desktopFile} \
        || { echo "rex-rune: Exec= was not rewritten" >&2; exit 1; }
    '';
  };
in
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
    rexRune
  ];
  dconf.settings."org/gnome/shell".enabled-extensions = lib.mkBefore [
    "background-logo@fedorahosted.org"
  ];
}
