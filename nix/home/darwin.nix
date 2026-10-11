# macOS-only home-manager config. GUI apps come from Homebrew casks in ../darwin.nix.
{ pkgs, config, ... }:
{
  home.packages = with pkgs; [
    docker
    docker-compose
    pngpaste
  ];

  # Wezterm config (Wezterm itself is a Homebrew cask)
  home.file.".config/wezterm".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/wezterm";

  programs.fish.shellAliases.nix-rebuild = "darwin-rebuild switch --flake ~/.dotfiles/nix#macbook";
}
