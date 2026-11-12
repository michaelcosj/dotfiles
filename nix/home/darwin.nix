# macOS-only home-manager config. GUI apps come from Homebrew casks in ../darwin.nix.
{ pkgs, config, ... }:
{
  imports = [
    ./desktop.nix
    ./personal.nix
  ];

  home.packages = with pkgs; [
    docker
    docker-compose
    pngpaste
  ];

  # Rex session restore: saves what each pane runs and resumes it after the
  # server restarts (nix/config/rex/bin/rex-watch.lua). It exits when the
  # server stops; launchd starts it again, and it waits for the server.
  launchd.agents.rex-watch = {
    enable = true;
    config = {
      ProgramArguments = [
        "${config.home.homeDirectory}/.local/bin/rex"
        "--autostart=false"
        "do"
        "${config.home.homeDirectory}/.config/rex/bin/rex-watch.lua"
        "--all"
      ];
      EnvironmentVariables.PATH = "${config.home.homeDirectory}/.local/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/current-system/sw/bin:/usr/bin:/bin";
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 15;
      StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/rex-watch.log";
    };
  };

  # nix-darwin activates as root.
  programs.fish.functions.nix-rebuild.body = ''
    sudo darwin-rebuild switch --flake "$HOME/.dotfiles/nix#macbook" $argv
  '';
}
