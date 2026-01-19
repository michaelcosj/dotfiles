{
  users.users.synth.home = /Users/synth;
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;
  home-manager.backupFileExtension = "backup";

  home-manager.users.synth =
    { pkgs, config, ... }:
    {
      home.stateVersion = "24.11";

      home.username = "synth";
      home.homeDirectory = /Users/synth;

      home.packages = with pkgs; [
        bat
        biome
        cowsay
        # docker
        eza
        fd
        fortune
        fnm
        gh
        htop
        intelephense
        jetbrains-mono
        jq
        lazygit
        lua-language-server
        neovim
        nixd
        nixfmt-rfc-style
        ngrok
        oxlint
        prettierd
        ripgrep
        stylua
        tree
        uv
        vtsls
        yt-dlp
      ];

      home.sessionVariables = {
        EDITOR = "nvim";
        VISUAL = "nvim";
      };

      # Nvim config
      xdg.configFile.nvim.enable = false;
      home.file.".config/nvim".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/nvim";

      # Wezterm config
      home.file.".config/wezterm".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/wezterm";

      # Opencode config
      home.file.".config/opencode".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/opencode";

      fonts.fontconfig.enable = true;

      programs = {
        home-manager.enable = true;

        fzf = {
          enable = true;
          # enableZshIntegration = true;
          enableFishIntegration = true;
          defaultOptions = [
            "--height 80%"
            "--layout"
            "reverse"
            "--border"
          ];
        };

        ghostty = {
          enable = true;
          # enableZshIntegration = true;
          enableFishIntegration = true;
          package = null;
          settings = {
            # theme = "Gruvbox Dark";
            theme = "Kanagawa Dragon";
            font-family = "JetBrains Mono";
            maximize = true;
            macos-option-as-alt = true;
            custom-shader = "/Users/synth/.dotfiles/nix/config/ghostty/shaders/cursor_smear.glsl";
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

        fish = {
          enable = true;
          plugins = [
            {
              name = "pure-fish";
              src = pkgs.fetchFromGitHub {
                owner = "pure-fish";
                repo = "pure";
                rev = "b8ae744d8489b66a387ce13ae17005d510333546";
                sha256 = "2UEIvlm8D11cMkz1GvaSBpaauZALwYZR1Q4Xd7/I4FQ=";
              };
            }
          ];
          shellAliases = {
            rm = "rm -i";
            cp = "cp -i";
            mv = "mv -i";
            cat = "bat";
            ls = "eza --hyperlink";
            grep = "rg";
            nix-rebuild = "darwin-rebuild switch --flake ~/.dotfiles/nix#macbook";
            nv = "nvim";
            reload-env = "load_env";
          };
          interactiveShellInit = ''
            # vi keybindings
            set -g fish_key_bindings fish_vi_key_bindings

            # binds
            bind -M insert ctrl-space 'accept-autosuggestion'

            # Theme-agnostic color scheme
            set -g fish_color_autosuggestion brblack
            set -g fish_color_command normal
            set -g fish_color_comment brblack
            set -g fish_color_cwd green
            set -g fish_color_cwd_root red
            set -g fish_color_end brblack
            set -g fish_color_error red
            set -g fish_color_escape cyan
            set -g fish_color_history_current brblack
            set -g fish_color_host green
            set -g fish_color_host_remote green
            set -g fish_color_match --background=brblack yellow
            set -g fish_color_normal normal
            set -g fish_color_operator green
            set -g fish_color_param normal
            set -g fish_color_quote blue
            set -g fish_color_redirection green
            set -g fish_color_search_match --background=brblack yellow
            set -g fish_color_selection --background=brblack yellow
            set -g fish_color_user green
            set -g fish_color_valid_path green
            set -g fish_pager_color_completion normal
            set -g fish_pager_color_description brblack
            set -g fish_pager_color_prefix green
            set -g fish_pager_color_progress green
            set -g fish_pager_color_selected_background --background=brblack yellow
            set -g fish_pager_color_selected_completion yellow
            set -g fish_pager_color_selected_description yellow

            # fnm node version manager
            set -gx PATH \
              "$HOME/.local/state/fnm_multishells/26685_1737249628581/bin" \
              "$HOME/.dotfiles/nix/scripts" \
              $PATH

            set -gx FNM_MULTISHELL_PATH "$HOME/.local/state/fnm_multishells/26685_1737249628581"
            set -gx FNM_VERSION_FILE_STRATEGY local
            set -gx FNM_DIR "$HOME/.local/share/fnm"
            set -gx FNM_NODE_DIST_MIRROR https://nodejs.org/dist
            set -gx FNM_LOGLEVEL info
            set -gx FNM_COREPACK_ENABLED false
            set -gx FNM_RESOLVE_ENGINES true
            set -gx FNM_ARCH x64

            # laravel valet
            set -gx PATH "$HOME/.config/composer/vendor/bin" $PATH

            # add bun to path
            set -gx BUN_INSTALL "$HOME/.bun"
            set -gx PATH "$BUN_INSTALL/bin" $PATH

            # pure-fish configuration
            set -g pure_reverse_prompt_symbol_in_vimode true

            # load .env file if it exists
            function load_env
              set env_file "$HOME/.dotfiles/.env"
              if test -f "$env_file"
                while read -l line
                  # Skip comments and empty lines
                  if not string match -q '#*' "$line"; and test -n "$line"
                    # Split line into key and value
                    set key (string split -m 1 '=' "$line")[1]
                    set value (string split -m 1 '=' "$line")[2]
                    
                    # Remove surrounding quotes from value if present
                    if string match -q '"*"' "$value"
                      set value (string sub -s 2 -e -1 "$value")
                    else if string match -q "'*'" "$value"
                      set value (string sub -s 2 -e -1 "$value")
                    end
                    
                    # Set the environment variable
                    if test -n "$key" -a -n "$value"
                      set -gx "$key" "$value"
                    end
                  end
                end < "$env_file"
              end
            end

            source "$HOME/.cargo/env.fish"  # For fish

            # Load .env file on shell startup
            load_env
          '';
        };

        lazygit = {
          enable = true;
          settings = {
            os.editPreset = "nvim";
          };
        };

        starship = {
          enable = false;
          # enableZshIntegration = true;
          enableFishIntegration = true;
          settings = {
            format = "$directory$git_branch$git_metrics$git_status$line_break$character";
            git_commit.tag_symbol = "  ";
            git_branch.symbol = " ";
          };
        };

        tmux = {
          enable = true;
          customPaneNavigationAndResize = true;
          escapeTime = 0;
          keyMode = "vi";
          mouse = true;
          plugins = [
            pkgs.tmuxPlugins.fzf-tmux-url
            # pkgs.tmuxPlugins.kanagawa
          ];
          prefix = "C-a";
          shortcut = "a";
          terminal = "screen-256color";
          extraConfig = ''
            set -g renumber-windows on
            bind r source-file ~/.config/tmux/tmux.conf \; display "config reloaded!"

            bind-key c  new-window -c "#{pane_current_path}"
            bind-key "|" split-window -h -c "#{pane_current_path}"
            bind-key "\\" split-window -fh -c "#{pane_current_path}"

            bind-key "-" split-window -v -c "#{pane_current_path}"
            bind-key "_" split-window -fv -c "#{pane_current_path}"

            bind -r "<" swap-window -d -t -1
            bind -r ">" swap-window -d -t +1

            bind Space last-window
            bind-key C-Space switch-client -l

            bind C-p previous-window
            bind C-n next-window

            setw -g status-style 'fg=colour7 bg=terminal bold'
            set -g status-position top

            set -g status-right-style 'fg=colour7 bold'
            set -g status-right " #S "

            set -g status-right-style 'fg=colour7 bold'
            set -g status-left " #W "

            setw -g window-status-current-style 'fg=colour60'
            setw -g window-status-style 'fg=colour60'
            setw -g window-status-format "  "
            setw -g window-status-current-format "  "
          '';
        };

        zsh = {
          enable = false;
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
            nv = "nvim";
          };

          initContent = ''
            # fnm node version manager
            export PATH="$HOME/.local/state/fnm_multishells/26685_1737249628581/bin":"$HOME/.dotfiles/nix/scripts/":$PATH
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

            # gemini ai api key
            export GEMINI_API_KEY=$(cat ~/.dotfiles/.api_key.gemini)

            # codestal ai api key
            export CODESTRAL_API_KEY=$(cat ~/.dotfiles/.api_key.codestral)

            # context7 ai api key
            export CONTEXT7_API_KEY=$(cat ~/.dotfiles/.api_key.context7)

            run_tsm() {
                $HOME/.dotfiles/nix/scripts/tsm
                zle reset-prompt  # Refresh the prompt after execution
            }

            # Create a zle widget
            zle -N run_tsm

            # Bind it to a key combination
            bindkey '^S' run_tsm

            # add bun to path
            export BUN_INSTALL="$HOME/.bun"
            export PATH="$BUN_INSTALL/bin:$PATH"
          '';
        };

      };
    };
}
