{
  description = "Michael's nix-darwin and home-manager flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
    # Linux tracks unstable for fresher tools; Fedora still owns the OS itself.
    nixpkgs-linux.url = "github:NixOS/nixpkgs/nixos-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/nix-darwin-26.05";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager/release-26.05";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    # home-manager master matches nixpkgs unstable (release branches only support their release).
    home-manager-linux.url = "github:nix-community/home-manager";
    home-manager-linux.inputs.nixpkgs.follows = "nixpkgs-linux";

    # Prebuilt Rex snapshot, pinned by flake.lock. Update with: nix flake update rex
    rex.url = "https://pkgs.superlogical.com/rex/nix/snapshot.tar.gz";
    rex.inputs.nixpkgs.follows = "nixpkgs-linux";

    # Herdr, built from source. Bump the tag to update. [https://herdr.dev/docs/install/#install-with-nix]
    herdr.url = "github:herdrdev/herdr/v0.9.3";

    # Declarative Flatpaks on Linux [https://github.com/gmodena/nix-flatpak]
    nix-flatpak.url = "github:gmodena/nix-flatpak/?ref=v0.8.0";

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
    {
      nixpkgs-linux,
      nix-darwin,
      nix-homebrew,
      nix-flatpak,
      home-manager,
      home-manager-linux,
      herdr,
      rex,
      ...
    }:
    let
      configuration =
        { ... }:
        {
          nixpkgs.config.allowUnfree = true;
          # virtualisation.docker.enable = true;
        };
      mkLinuxHome =
        {
          username,
          host,
          modules,
        }:
        home-manager-linux.lib.homeManagerConfiguration {
          pkgs = import nixpkgs-linux {
            system = "x86_64-linux";
            config.allowUnfree = true;
          };
          extraSpecialArgs = {
            inherit herdr rex nix-flatpak;
            homeConfiguration = "${username}@${host}";
          };
          modules = [
            ./home/common.nix
            ./home/linux/common.nix
            {
              home.username = username;
              home.homeDirectory = "/home/${username}";
              home.stateVersion = "26.05";
            }
          ]
          ++ modules;
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
          home-manager.darwinModules.home-manager
          { home-manager.extraSpecialArgs = { inherit herdr; }; }
          ./darwin.nix
        ];
      };

      # Standalone Home Manager; the host distribution still owns the OS.
      homeConfigurations = {
        "m@fedora" = mkLinuxHome {
          username = "m";
          host = "fedora";
          modules = [
            ./home/linux/fedora.nix
            ./home/personal.nix
          ];
        };
        "m@devbox" = mkLinuxHome {
          username = "m";
          host = "devbox";
          modules = [
            ./home/linux/devbox.nix
            ./home/personal.nix
          ];
        };
        "work@devbox" = mkLinuxHome {
          username = "work";
          host = "devbox";
          modules = [
            ./home/linux/devbox.nix
            {
              programs.git.settings.user = {
                name = "michael";
                email = "michael@synthally.com";
                useConfigOnly = true;
              };
            }
          ];
        };
      };
    };
}
