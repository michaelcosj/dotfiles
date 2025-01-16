{
  description = "Michael's nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    nix-homebrew.url = "github:zhaofengli-wip/nix-homebrew";

    # Optional: Declarative tap management
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
          # List packages installed in system profile. To search by name, run:
          # $ nix-env -qaP | grep wget
          environment.systemPackages = [
            pkgs.neovim
            pkgs.nixd
            pkgs.nixfmt-rfc-style
            pkgs.git
            pkgs.fnm
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
            ];
            brews = [
              "mas"
            ];
            masApps = {
              # "Yoink" = 457622435;
            };
          };

          # Necessary for using flakes on this system.
          nix.settings.experimental-features = "nix-command flakes";

          # Enable alternative shell support in nix-darwin.
          # programs.fish.enable = true;

          # Set Git commit hash for darwin-version.
          system.configurationRevision = self.rev or self.dirtyRev or null;

          # Used for backwards compatibility, please read the changelog before changing.
          # $ darwin-rebuild changelog
          system.stateVersion = 5;

          # The platform the configuration will be used on.
          nixpkgs.hostPlatform = "x86_64-darwin";

          # use touch id for sudo permissions
          security.pam.enableSudoTouchIdAuth = true;

          # system settings configuration
          system.defaults = {
            screencapture.location = "~/Pictures/Screenshots";

            NSGlobalDomain = {
              # Dark mode
              AppleInterfaceStyle = "Dark";

              # Show all file extensions
              AppleShowAllExtensions = true;
            };

            dock = {
              # autohide dock
              autohide = true;

              # move dock to the left of the screen
              orientation = "bottom";

              # dont show recents in dock
              show-recents = false;

              # reduce animation time for showing/hiding the dock
              autohide-time-modifier = 0.8;

              # dont rearrange spaces based on most recent used
              mru-spaces = false;

              # make hidden apps translucent
              showhidden = true;

              # apps to show on the dock
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
              # show all extensions on finder
              AppleShowAllExtensions = true;

              # dont show icons on desktop
              CreateDesktop = false;

              # don't show external drives on desktop
              ShowExternalHardDrivesOnDesktop = false;

              # show path bar on finder
              ShowPathbar = true;

              # show status bar
              ShowStatusBar = true;
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
              # Install Homebrew under the default prefix
              enable = true;

              # Apple Silicon Only: Also install Homebrew under the default Intel prefix for Rosetta 2
              # enableRosetta = true;

              # User owning the Homebrew prefix
              user = "synth";

              # Automatically migrate existing Homebrew installations
              autoMigrate = true;
            };
          }
        ];
      };
    };
}
