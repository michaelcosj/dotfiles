# Desktop tools shared by macOS and Linux; never imported by headless devboxes.
{
  pkgs,
  config,
  herdr,
  ...
}:
{
  imports = [ ./ssh-devbox.nix ];
  home.packages = with pkgs; [
    mpv
    yt-dlp
    herdr.packages.${pkgs.stdenv.hostPlatform.system}.default
  ];
  fonts.fontconfig.enable = true;

  # Herdr config (https://herdr.dev/docs/configuration/)
  home.file.".config/herdr".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/herdr";
}
