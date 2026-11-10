# Fish shell, prompt, aliases, and the shell tools it integrates (fzf, direnv, starship).
{ ... }:
{
  programs.fzf = {
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

  # Fish integration is on by default; nix-direnv caches `use flake` shells.
  programs.direnv = {
    enable = true;
    nix-direnv.enable = true;
    # Hide the "loading" lines and env diff; errors still print.
    silent = true;
  };

  programs.fish = {
    enable = true;
    functions = {
      fish_prompt = ''
        set -l last_status $status

        # Reset first so prompt colors never inherit bold styling.
        set_color normal
        set_color brblack
        printf '╭─'
        set -l directory_icon_color blue
        if set -q dotfiles_directory_icon_color[1]
          set directory_icon_color $dotfiles_directory_icon_color[1]
        end
        set_color $directory_icon_color
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
      # Restart this shell with the current config, e.g. after nix-rebuild in a pane
      # that's still running the old one. Clearing the marker makes the new shell
      # reload home-manager's session variables instead of trusting the inherited ones.
      reload-shell = ''
        set -e __HM_SESS_VARS_SOURCED
        # Leftover from the old fnm setup, still inherited by long-running sessions.
        set -gx PATH (string match -v '*fnm_multishells*' $PATH)
        exec fish
      '';
    };
    shellAliases = {
      nv = "nvim";
      op = "opencode";
      rm = "rm -i";
      cp = "cp -i";
      mv = "mv -i";
      cat = "bat";
      ls = "eza --hyperlink";
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
      fish_add_path "$HOME/.local/bin"

      # Node tooling via Vite+ (`vp env`): node/npm/pnpm/bun shims that pick the
      # version per project (.node-version, package.json, .nvmrc). vp writes this
      # file the first time it runs.
      if test -f "$HOME/.config/vite-plus/env.fish"
        source "$HOME/.config/vite-plus/env.fish"
      end
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

  # Home Manager writes this to the right place on each OS (macOS:

  programs.starship = {
    enable = false;
    # enableZshIntegration = true;
    enableFishIntegration = true;
    settings = {
      format = "$directory$git_branch$git_metrics$git_status$line_break$character";
      git_commit.tag_symbol = "  ";
      git_branch.symbol = " ";
    };
  };
}
