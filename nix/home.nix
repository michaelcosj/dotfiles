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
        ast-grep
        bat
        biome
        cloudflared
        cowsay
        # docker
        eza
        fd
        fortune
        fnm
        gh
        gws
        htop
        imagemagick
        intelephense
        jetbrains-mono
        jq
        lazygit
        lua-language-server
        mongodb-tools
        neovim
        nixd
        nixfmt-rfc-style
        ngrok
        oxlint
        pngpaste
        prettierd
        python313Packages.ddgs
        ripgrep
        stylua
        tree
        tree-sitter
        ueberzugpp
        uv
        vi-mongo
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

      # Ghostty config
      home.file.".config/ghostty".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/ghostty";

      # Opencode config
      home.file.".config/opencode".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/opencode";

      # btca config (https://docs.btca.dev/guides/configuration)
      home.file.".config/btca".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/btca";

      # Herdr config (https://herdr.dev/docs/configuration/)
      home.file.".config/herdr".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/herdr";

      # pi config (https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
      home.file.".pi".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nix/config/pi";

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

        git = {
          enable = true;
          settings = {
            user.name = "Michael";
            user.email = "michaelcosj@proton.me";
            core.editor = "nvim";
            color.ui = true;
            pull.ff = "only";
            init.defaultBranch = "main";
            aliases = {
              sw = "switch";
              ci = "commit";
              st = "status";
              br = "branch";
              df = "diff";
              lg = "log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit";
            };
          };
          ignores = [
            ".DS_Store"
            "node_modules"
            "*.pyc"
          ];
        };

        delta = {
          enable = true;
          enableGitIntegration = true;
          options = {
            navigate = true;
            line-numbers = true;
          };
        };

        fish = {
          enable = true;
          functions = {
            fish_prompt = ''
              set -l last_status $status

              # Reset first so prompt colors never inherit bold styling.
              set_color normal
              set_color brblack
              printf '╭─'
              set_color blue
              printf '  '
              set_color cyan
              printf '%s' (string replace "$HOME" '~' "$PWD")

              set -l git_branch (command git branch --show-current 2>/dev/null)
              if test -z "$git_branch"
                set git_branch (command git rev-parse --short HEAD 2>/dev/null)
              end
              if test -n "$git_branch"
                set -l dirty
                set -l git_status (command git status --porcelain 2>/dev/null)
                if test -n "$git_status"
                  set dirty '*'
                end
                set_color normal
                set_color brblack
                printf ' %s%s' "$git_branch" "$dirty"
              end
              printf '\n'

              set_color normal
              set_color brblack
              printf '╰─'
              if test $last_status -eq 0
                set_color green
              else
                set_color red
              end
              printf '$ '
              set_color normal
            '';
            fish_right_prompt = ''
              set_color normal
              set_color yellow
              date '+%H:%M:%S'
              set_color normal
            '';
            # Keep vi mode without adding a separate mode indicator to the prompt.
            fish_mode_prompt = "";
          };
          shellAliases = {
            nv = "nvim";
            rm = "rm -i";
            cp = "cp -i";
            mv = "mv -i";
            cat = "bat";
            ls = "eza --hyperlink";
            nix-rebuild = "darwin-rebuild switch --flake ~/.dotfiles/nix#macbook";
            reload-env = "load_env";
            sg = "ast-grep";
          };
          interactiveShellInit = ''
            # Disable the default welcome message.
            set -g fish_greeting

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

            fish_add_path "$HOME/.dotfiles/nix/scripts"

            # Node tooling
            fnm env --use-on-cd --shell fish | source
            fish_add_path "$HOME/.config/composer/vendor/bin"
            set -gx BUN_INSTALL "$HOME/.bun"
            fish_add_path "$BUN_INSTALL/bin"

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

            if test -f "$HOME/.cargo/env.fish"
              source "$HOME/.cargo/env.fish"
            end

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

            bind-key S display-popup -E -w 80% -h 80% "tsm"
            bind-key W display-popup -E -w 80% -h 80% "tsm --worktree"

            bind C-p previous-window
            bind C-n next-window

            setw -g status-style 'fg=colour7 bg=terminal bold'
            set -g status-position top

            set -g status-right-style 'fg=colour7 bold'
            set -g status-right " #S "

            set -g status-right-style 'fg=colour7 bold'
            set -g status-left " #W "

            set -g pane-border-style fg=brightblack,bg=black
            set -g pane-active-border-style fg=blue,bg=black

            setw -g window-status-current-style 'fg=colour60'
            setw -g window-status-style 'fg=colour60'
            setw -g window-status-format "  "
            setw -g window-status-current-format "  "

            set-window-option -g window-active-style bg=terminal,fg=terminal
            # Kanagawa Wave sumiInk3 + fujiGray: subtly dim inactive windows.
            set-window-option -g window-style bg=#16161d,fg=#727169

            set -g extended-keys on
            set -g extended-keys-format csi-u
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
