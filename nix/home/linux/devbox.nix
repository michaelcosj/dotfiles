# Headless remote development profile. Ubuntu owns accounts, SSH, and the firewall.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  piDir = "${config.home.homeDirectory}/.dotfiles/nix/config/pi/agent";
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

  # The desktop .pi symlink includes machine-local packages and Paper MCP.
  # Keep remote runtime state outside the repo and share only portable config.
  home.file = {
    ".pi".enable = lib.mkForce false;
    ".pi/agent/mcp.json".text = builtins.toJSON { mcpServers = { }; };
  }
  // builtins.listToAttrs (
    map
      (name: {
        name = ".pi/agent/${name}";
        value.source = config.lib.file.mkOutOfStoreSymlink "${piDir}/${name}";
      })
      [
        "AGENTS.md"
        "extensions"
        "keybindings.json"
        "prompts"
        "skills"
      ]
  );

  # Pi changes its settings at runtime. Seed a private writable file once,
  # rather than linking a read-only Nix store file or overwriting user choices.
  home.activation.seedPiSettings = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    if [ ! -e "$HOME/.pi/agent/settings.json" ]; then
      run install -Dm600 ${piSettings} "$HOME/.pi/agent/settings.json"
    fi
  '';
}
