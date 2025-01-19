# Run darwin-help for documentation of all the configuration options
{ ... }:

{
  environment.variables.HOMEBREW_NO_ANALYTICS = "1";
  nixpkgs.hostPlatform = "x86_64-darwin";
  security.pam.enableSudoTouchIdAuth = true;

  homebrew = {
    enable = true;
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;

    taps = [
      # "karimbenbourenane/cask-fonts"
    ];

    casks = [
      "ghostty"
      "zed"
      "zen-browser"
      "aldente"
      "obsidian"
      "raycast"
      "karabiner-elements"
      "localsend"
      "stremio"
      "font-zed-mono-nerd-font"
      "discord"
      "dataflare"
      # "slack"
    ];

    brews = [
      "mas"
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
          "/Applications/Zen Browser.app"
          "/Applications/Slack.app"
          "/Applications/Obsidian.app"
          "/Applications/Ghostty.app"
          "/Applications/Zed.app"
          "/Applications/Postman.app"
          "/Applications/Localsend.app"
          "/System/Applications/Clock.app"
          "/System/Applications/Calendar.app"
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
      };
    };
  };
}
