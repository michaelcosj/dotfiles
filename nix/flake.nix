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
      ...
    }:
    let
      configuration =
        { ... }:
        {
          nixpkgs.config.allowUnfree = true;
          # virtualisation.docker.enable = true;
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

      # Standalone home-manager on a non-NixOS distro (Fedora). Apply with:
      # $ home-manager switch --flake .#m@fedora
      homeConfigurations."m@fedora" = home-manager-linux.lib.homeManagerConfiguration {
        pkgs = import nixpkgs-linux {
          system = "x86_64-linux";
          config.allowUnfree = true;
        };
        extraSpecialArgs = { inherit herdr; };
        modules = [
          nix-flatpak.homeManagerModules.nix-flatpak
          ./home/common.nix
          ./home/linux.nix
          {
            home.username = "m";
            home.homeDirectory = "/home/m";
            home.stateVersion = "26.05";
          }
        ];
      };
    };
}
