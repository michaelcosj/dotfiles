# Configs linked straight from the repo, so edits apply without a rebuild.
{ config, ... }:
{
  # Nvim config
  xdg.configFile.nvim.enable = false;
  home.file.".config/nvim".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/nvim";

  # Opencode config
  home.file.".config/opencode".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/opencode";

  # Rex config. Every machine runs a Rex server, and init.lua runs in the
  # server, so each one gets the same keys, projects and session restore.
  home.file.".config/rex".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/rex";

  # rex-view: Markdown in a Rex pane (skill: config/agents/skills/visualise).
  # Chrome is only for rex-view snap. On PATH for interactive and agent shells.
  home.file.".local/bin/rex-view".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/rex/bin/rex-view";
}
