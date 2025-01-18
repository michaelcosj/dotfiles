{
  description = "Michael's nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    # Homebrew [https://github.com/zhaofengli/nix-homebrew]
    nix-homebrew.url = "github:zhaofengli-wip/nix-homebrew";

    homebrew-core = {
      url = "github:homebrew/homebrew-core";
      flake = false;
    };
    homebrew-cask = {
      url = "github:homebrew/homebrew-cask";
      flake = false;
    };
    homebrew-bundle = {
      url = "github:homebrew/homebrew-bundle";
      flake = false;
    };
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
      nix-homebrew,
      homebrew-core,
      homebrew-cask,
      homebrew-bundle,
    }:
    let
      configuration =
        { pkgs, ... }:
        {
          # Run darwin-help for documentation of all the configuration options

          environment.systemPackages = [
            pkgs.neovim
            pkgs.nixd
            pkgs.nixfmt-rfc-style
            pkgs.git
            pkgs.fnm
            pkgs.fzf
            pkgs.imagemagickBig
          ];

          fonts.packages = [
            pkgs.jetbrains-mono
          ];

          homebrew = {
            enable = true;
            onActivation.autoUpdate = true;
            onActivation.upgrade = true;
            casks = [
              "ghostty"
              "zed"
              "zen-browser"
              "aldente"
              "obsidian"
              # "slack"
              "raycast"
              "karabiner-elements"
              "localsend"
              "stremio"
            ];
            brews = [
              "mas"
            ];
            masApps = {
              # "Yoink" = 457622435;
            };
          };

          environment.variables.HOMEBREW_NO_ANALYTICS = "1";

          programs = {
            zsh = {
              enable = true;
              enableCompletion = true;
              enableSyntaxHighlighting = true;
              enableFzfCompletion = true;
              enableFzfHistory = true;
            };
          };

          nixpkgs.hostPlatform = "x86_64-darwin";
          security.pam.enableSudoTouchIdAuth = true;

          nix = {
            gc.automatic = true;
            settings = { experimental-features = "nix-command flakes"; }
          };


          system = {
            configurationRevision = self.rev or self.dirtyRev or null;
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
        };
    in
    {
      # Build darwin flake using:
      # $ darwin-rebuild build --flake .#macbook
      darwinConfigurations.macbook = nix-darwin.lib.darwinSystem {
        modules = [
          configuration
          nix-homebrew.darwinModules.nix-homebrew
          {
            nix-homebrew = {
              enable = true;
              user = "synth";
              autoMigrate = true;
            };
          }
        ];
      };
    };
}
