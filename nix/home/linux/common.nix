# Shared Linux user environment, for desktops and headless devboxes.
{
  config,
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

  # Rex session restore (nix/config/rex/bin/rex-watch.lua): resumes what panes
  # were running after the server restarts, then saves a snapshot every 15 s.
  # It starts and stops with the server; launchd runs it on macOS (darwin.nix).
  systemd.user.services.rex-watch = {
    Unit = {
      Description = "Rex session restore";
      After = [ "rex.service" ];
      BindsTo = [ "rex.service" ];
    };
    Service = {
      # The server's own rex, on its default socket (same XDG_RUNTIME_DIR).
      ExecStart = "${lib.getExe config.services.rex.package} --autostart=false do %h/.config/rex/bin/rex-watch.lua --all";
      Restart = "on-failure";
      RestartSec = 15;
    };
    Install.WantedBy = [ "rex.service" ];
  };
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
