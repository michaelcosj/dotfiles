# Shared Linux user environment, for desktops and headless devboxes.
{
  pkgs,
  lib,
  rex,
  homeConfiguration,
  ...
}:
{
  imports = [ rex.homeManagerModules.default ];

  targets.genericLinux.enable = true;
  # genericLinux enables GPU integration by default; headless machines must not.
  targets.genericLinux.gpu.enable = lib.mkDefault false;

  home.packages = with pkgs; [
    claude-code
    # Use the official prebuilt release instead of compiling the Rust workspace.
    (callPackage ../../pkgs/codex-bin.nix { })
    gcc
    # Pi installs extension packages with npm, even outside a project Node environment.
    nodejs
    pi-coding-agent
    svelte-language-server
    unar
  ];

  # Nix owns the installed Claude Code version.
  home.sessionVariables.DISABLE_AUTOUPDATER = "1";

  programs.rex.enable = true;
  services.rex.enable = true;
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
  };

  nix = {
    package = pkgs.nix;
    gc.automatic = true;
    settings.experimental-features = "nix-command flakes";
  };

  programs.fish.functions.nix-rebuild.body = ''
    home-manager switch --flake "$HOME/.dotfiles/nix#${homeConfiguration}" $argv; or return
  '';
}
