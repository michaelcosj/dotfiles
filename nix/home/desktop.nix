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
    jetbrains-mono
    mpv
    yt-dlp
    herdr.packages.${pkgs.stdenv.hostPlatform.system}.default
  ];
  fonts.fontconfig.enable = true;

  # Herdr config (https://herdr.dev/docs/configuration/)
  home.file.".config/herdr".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/herdr";

  # Rex config
  home.file.".config/rex".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/rex";

  # Ghostty config
  # Loads the shared file, then the per-OS one. Both are read straight from the
  # repo, so edits apply on reload without a rebuild.
  xdg.configFile."ghostty/config".text =
    let
      dir = "${config.home.homeDirectory}/.dotfiles/nix/config/ghostty";
    in
    ''
      config-file = ${dir}/common
      config-file = ${dir}/${if pkgs.stdenv.hostPlatform.isDarwin then "macos" else "linux"}
    '';

}
