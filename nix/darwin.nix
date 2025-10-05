# Run darwin-help for documentation of all the configuration options
{ pkgs, ... }:

{
  environment.variables.HOMEBREW_NO_ANALYTICS = "1";
  nixpkgs.hostPlatform = "x86_64-darwin";
  security.pam.services.sudo_local.touchIdAuth = true;

  programs.fish.enable = true;
  users.users.synth = {
    shell = pkgs.fish;
  };

  homebrew = {
    enable = true;
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;

    taps = [
      # "karimbenbourenane/cask-fonts"
    ];

    casks = [
      # "ghostty"
      "zed"
      "aldente"
      "obsidian"
      "raycast"
      "karabiner-elements"
      "localsend"
      "stremio"
      "font-zed-mono-nerd-font"
      "discord"
      "dataflare"
      "dbngin"
      "devtoys"
      "linearmouse"
      "spotify"
      "transmission"
      # "slack"
    ];

    brews = [
      "mas"
      "php"
      "composer"
      "mailpit"
      "blueutil"
      "imagemagick"
      "docker"
      "docker-compose"
      "mpv"
      {
        name = "colima";
        start_service = true;
      }
    ];

    masApps = {
      # "Yoink" = 457622435;
    };
  };

  nix = {
    gc.automatic = true;
    optimise.automatic = true;
    settings = {
      experimental-features = "nix-command flakes";
    };
  };

  system = {
    primaryUser = "synth";
    stateVersion = 5;

    defaults = {
      screencapture.location = "~/Pictures/Screenshots";

      NSGlobalDomain = {
        AppleInterfaceStyle = "Dark";
        AppleShowAllExtensions = true;
      };

      dock = {
        autohide = true;
        show-recents = false;
        autohide-time-modifier = 0.8;
        mru-spaces = false;
        showhidden = true;
        persistent-apps = [
          "/Applications/Ghostty.app"
          "/Applications/Helium.app"
          "/Applications/Slack.app"
          "/System/Applications/Mail.app"
        ];
      };

      finder = {
        AppleShowAllExtensions = true;
        CreateDesktop = false;
        ShowExternalHardDrivesOnDesktop = false;
        ShowPathbar = true;
        ShowStatusBar = true;
        NewWindowTarget = "Home";
        QuitMenuItem = true;
      };
    };
  };
}
