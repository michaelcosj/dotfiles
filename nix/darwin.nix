# Run darwin-help for documentation of all the configuration options
{ lib, pkgs, ... }:

{
  environment.variables = {
    HOMEBREW_NO_ANALYTICS = "1";
    # What `brew shellenv` sets on Intel, set once here instead of running brew
    # in every shell (nix-homebrew's shell integrations are off in flake.nix).
    HOMEBREW_PREFIX = "/usr/local";
    HOMEBREW_CELLAR = "/usr/local/Cellar";
    HOMEBREW_REPOSITORY = "/usr/local/Homebrew/Library/.homebrew-is-managed-by-nix";
  };
  # /usr/local/bin is already on the default PATH, after the Nix profiles.
  environment.systemPath = lib.mkAfter [ "/usr/local/sbin" ];
  nixpkgs.hostPlatform = "x86_64-darwin";
  security.pam.services.sudo_local.touchIdAuth = true;

  programs.fish.enable = true;
  # Translate the shell environment to fish at build time, instead of running
  # bash through foreign-env in every new shell.
  programs.fish.useBabelfish = true;
  users.users.synth = {
    home = "/Users/synth";
    shell = pkgs.fish;
  };

  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    backupFileExtension = "backup";
    users.synth = {
      imports = [
        ./home/common.nix
        ./home/darwin.nix
      ];
      home.username = "synth";
      home.homeDirectory = "/Users/synth";
      home.stateVersion = "24.11";
    };
  };

  homebrew = {
    enable = true;
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;

    taps = [
      # "karimbenbourenane/cask-fonts"
    ];

    casks = [
      "aldente"
      "dataflare"
      "dbngin"
      "devtoys"
      "discord"
      "gcloud-cli"
      # "claude-code"
      "karabiner-elements"
      "linearmouse"
      "localsend"
      "obsidian"
      "opencode-desktop"
      "raycast"
      "spotify"
      "stremio"
      "tailscale-app" # Native VPN client; approve permissions and sign in once.
      "homebrew/cask/transmission"
      "zed"
      "font-zed-mono-nerd-font"
      # "slack"
      # "codexbar"
      "blackhole-2ch"
    ];

    brews = [
      "mas"
      "pam-reattach"
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
          "/Applications/Rex Beta.app"
          "/Applications/Helium.app"
          "/Users/synth/Applications/Chromium Apps.localized/Slack Activity.app"
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
