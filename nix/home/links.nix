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

  # btca config (https://docs.btca.dev/guides/configuration)
  home.file.".config/btca".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/btca";

  # pi config (https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
  home.file.".pi".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/pi";
}
