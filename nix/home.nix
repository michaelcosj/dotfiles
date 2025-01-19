{
  users.users.synth.home = /Users/synth;
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;

  home-manager.users.synth =
    { pkgs, ... }:
    {
      home.username = "synth";
      home.homeDirectory = /Users/synth;

      home.packages = with pkgs; [
        neovim
        nixd
        nixfmt-rfc-style
        fnm
        imagemagickBig
        jetbrains-mono
        htop
        pkgs.php84
        pkgs.php84Packages.composer
      ];

      fonts.fontconfig.enable = true;

      programs = {
        zsh = {
          enable = true;
          enableCompletion = true;
          autosuggestion.enable = true;
          syntaxHighlighting.enable = true;
          autocd = true;

          shellAliases = {
            rm = "rm -i";
            cp = "cp -i";
            mv = "mv -i";
            ls = "ls --color=auto -h";
            grep = "grep --color=auto -i";
            nix-rebuild = "darwin-rebuild switch --flake ~/.dotfiles/nix#macbook";
          };

          initExtra = "
# fnm node version manager
export PATH=\"/Users/synth/.local/state/fnm_multishells/26685_1737249628581/bin\":$PATH
export FNM_MULTISHELL_PATH=\"/Users/synth/.local/state/fnm_multishells/26685_1737249628581\"
export FNM_VERSION_FILE_STRATEGY=\"local\"
export FNM_DIR=\"/Users/synth/.local/share/fnm\"
export FNM_LOGLEVEL=\"info\"
export FNM_NODE_DIST_MIRROR=\"https://nodejs.org/dist\"
export FNM_COREPACK_ENABLED=\"false\"
export FNM_RESOLVE_ENGINES=\"true\"
export FNM_ARCH=\"x64\"
rehash

# laravel valet
export PATH=\"$HOME/.composer/vendor/bin\":$PATH
          ";
        };

        oh-my-posh = {
          enable = true;
          enableZshIntegration = true;
          useTheme = "gruvbox";
        };

        fzf = {
          enable = true;
          enableZshIntegration = true;
          defaultOptions = [
            "--height 80%"
            "--layout"
            "reverse"
            "--border"
          ];
        };

        git = {
          enable = true;
          userName = "Michael";
          userEmail = "michaelcosj@proton.me";
        };
      };

      home.sessionVariables = {
        EDITOR = "zed";
        VISUAL = "zed";
      };

      home.stateVersion = "24.11";
      programs.home-manager.enable = true;
    };
}
