# Headless remote development profile. Ubuntu owns accounts, SSH, and the firewall.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  desktopSettings = builtins.fromJSON (builtins.readFile ../../config/pi/agent/settings.json);
  piSettings = pkgs.writeText "pi-devbox-settings.json" (
    builtins.toJSON (
      (builtins.removeAttrs desktopSettings [ "deviceId" ])
      // {
        # Keep portable registry/Git packages; never copy desktop-local paths.
        packages = builtins.filter (
          source: lib.hasPrefix "npm:" source || lib.hasPrefix "git:" source
        ) desktopSettings.packages;
      }
    )
  );
in
{
  # Never install GUI apps, GNOME/Flatpak configuration, GPU integration or Kanata here.
  # Rex keeps its private Unix socket and joins the tailnet as a separate device
  # for each account. Rex needs no anonymous TCP listener or host daemon.
  # nix/devbox separately manages host Tailscale for private Doop access.
  services.rex.tailscale = {
    enable = true;
    hostname = "devbox-${config.home.username}";
    allowTailnetMembers = false;
  };

  # Git uses gh's browser-login OAuth token over HTTPS; no SSH key lives here.
  # Home Manager owns the Git config, so `gh auth setup-git` cannot write it.
  programs.git.settings.credential =
    lib.genAttrs [ "https://github.com" "https://gist.github.com" ]
      (_: {
        helper = [
          ""
          "!${lib.getExe pkgs.gh} auth git-credential"
        ];
      });

  # Identify remote accounts without changing the shared prompt or exporting
  # the color into nested SSH sessions. Local shells keep the blue default.
  programs.fish.interactiveShellInit = lib.mkAfter ''
    set -gu dotfiles_directory_icon_color ${
      if config.home.username == "work" then "magenta" else "white"
    }
  '';

  # home/pi.nix links Pi's config from the repo. The desktop settings name
  # machine-local packages, so seed a portable copy here instead.
  home.file.".pi/agent/settings.json".enable = false;

  # Pi changes its settings at runtime. Seed a private writable file once,
  # rather than linking a read-only Nix store file or overwriting user choices.
  home.activation.seedPiSettings = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    if [ ! -e "$HOME/.pi/agent/settings.json" ]; then
      run install -Dm600 ${piSettings} "$HOME/.pi/agent/settings.json"
    fi
  '';
}
