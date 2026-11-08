# Pi (https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).
# ~/.pi is a real directory that holds Pi's runtime state: auth, sessions,
# installed packages, and caches. Only the hand-written config below is
# linked from the repo, so edits apply without a rebuild and runtime files
# never land in the checkout. Pi writes settings.json through its link, so
# settings changed in Pi show up in git. linux/devbox.nix replaces settings
# and MCP with portable copies.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  repo = "${config.home.homeDirectory}/.dotfiles/nix/config/pi";
in
{
  home.file = builtins.listToAttrs (
    map
      (name: {
        name = ".pi/agent/${name}";
        value.source = config.lib.file.mkOutOfStoreSymlink "${repo}/agent/${name}";
      })
      [
        "AGENTS.md"
        "extensions"
        "keybindings.json"
        "mcp.json"
        "prompts"
        "settings.json"
        "skills"
      ]
  );

  # ~/.pi used to be one link to the repo. Before Home Manager checks its
  # links, turn it into a real directory and move the runtime state there.
  # Does nothing once that is done (see scripts/migrate-pi-state).
  home.activation.migratePiState = lib.hm.dag.entryBefore [ "checkLinkTargets" ] ''
    run ${pkgs.bash}/bin/bash ${../scripts/migrate-pi-state} ${lib.escapeShellArg repo}
  '';
}
