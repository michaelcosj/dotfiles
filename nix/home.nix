{
  users.users.synth.home = /Users/synth;
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;

  home-manager.users.synth =
    { pkgs, config, ... }:
    {
      home.stateVersion = "24.11";

      home.username = "synth";
      home.homeDirectory = /Users/synth;

      home.packages = with pkgs; [
        bat
        biome
        fd
        fnm
        htop
        jetbrains-mono
        jq
        lazygit
        lua-language-server
        neovim
        nixd
        nixfmt-rfc-style
        nodePackages.vscode-json-languageserver
        prettierd
        ripgrep
        stylua
        typescript-language-server
        uv
      ];

      home.sessionVariables = {
        EDITOR = "nvim";
        VISUAL = "nvim";
      };

      xdg.configFile.nvim.enable = false;
      home.file.".config/nvim".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/nvim";

      fonts.fontconfig.enable = true;

      programs = {
        home-manager.enable = true;

        zsh = {
          enable = true;
          enableCompletion = true;
          autosuggestion.enable = true;
          syntaxHighlighting.enable = true;
          autocd = true;
          defaultKeymap = "viins";

          shellAliases = {
            rm = "rm -i";
            cp = "cp -i";
            mv = "mv -i";
            ls = "ls --color=auto -h";
            grep = "grep --color=auto -i";
            nix-rebuild = "darwin-rebuild switch --flake ~/.dotfiles/nix#macbook";
          };

          initExtra = ''
            # fnm node version manager
            export PATH="/Users/synth/.local/state/fnm_multishells/26685_1737249628581/bin":$PATH
            export FNM_MULTISHELL_PATH="/Users/synth/.local/state/fnm_multishells/26685_1737249628581"
            export FNM_VERSION_FILE_STRATEGY="local"
            export FNM_DIR="/Users/synth/.local/share/fnm"
            export FNM_LOGLEVEL="info"
            export FNM_NODE_DIST_MIRROR="https://nodejs.org/dist"
            export FNM_COREPACK_ENABLED="false"
            export FNM_RESOLVE_ENGINES="true"
            export FNM_ARCH="x64"
            rehash

            # laravel valet
            export PATH="$HOME/.config/composer/vendor/bin":$PATH

            # autosuggestion keybind
            bindkey '^ ' autosuggest-accept
          '';
        };

        starship = {
          enable = true;
          enableZshIntegration = true;
          settings = {
            format = "$directory$git_branch$git_metrics$git_status$line_break$character";
            git_commit.tag_symbol = "  ";
            git_branch.symbol = " ";
          };
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

        ghostty = {
          enable = true;
          enableZshIntegration = true;
          package = null;
          settings = {
            theme = "Kanagawa Wave";
            font-family = "JetBrains Mono";
            maximize = true;
          };
        };

        git = {
          enable = true;
          userName = "Michael";
          userEmail = "michaelcosj@proton.me";
          aliases = {
            sw = "switch";
            ci = "commit";
            st = "status";
            br = "branch";
            df = "diff";
            lg = "log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit";
          };
          extraConfig = {
            core.editor = "nvim";
            color.ui = true;
            pull.ff = "only";
            init.defaultBranch = "main";
          };
          ignores = [
            ".DS_Store"
            "node_modules"
            "*.pyc"
          ];
          delta = {
            enable = true;
            options = {
              navigate = true;
              line-numbers = true;
            };
          };
        };

        lazygit = {
          enable = true;
          settings = {
            os.editPreset = "nvim";
          };
        };
      };
    };
}
