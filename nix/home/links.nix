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

  # rex-web: HTML in a Rex pane (skill: config/agents/skills/rex-web). On the
  # PATH every shell gets, including the non-interactive ones agents run.
  home.file.".local/bin/rex-web".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/rex/bin/rex-web";
}
