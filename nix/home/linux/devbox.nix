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
        packages = builtins.filter (lib.hasPrefix "npm:") desktopSettings.packages;
      }
    )
  );
in
{
  # Never install GUI apps, GNOME/Flatpak configuration, GPU integration or Kanata here.
  # Rex keeps its private Unix socket and joins the tailnet as a separate device
  # for each account. No anonymous TCP listener or host Tailscale daemon is needed.
  services.rex.tailscale = {
    enable = true;
    hostname = "devbox-${config.home.username}";
    allowTailnetMembers = false;
  };

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
