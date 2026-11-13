# Fish shell, prompt, aliases, and the shell tools it integrates (fzf, direnv, Vite+).
{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Shell hooks generated at build time, so a new shell sources a file instead
  # of running fzf and direnv.
  fzfFish = pkgs.runCommand "fzf-init.fish" { } ''
    ${lib.getExe config.programs.fzf.package} --fish > $out
  '';
  direnvFish = pkgs.runCommand "direnv-hook.fish" { } ''
    ${lib.getExe config.programs.direnv.package} hook fish > $out
  '';
  vitePlus = pkgs.callPackage ../../pkgs/vite-plus.nix { };
in
{
  imports = [
    {
      programs.fish.interactiveShellInit = lib.mkMerge [
        # Early, like Home Manager's own fzf integration.
        (lib.mkOrder 200 "source ${fzfFish}")
        (lib.mkAfter "source ${direnvFish}")
      ];
    }
  ];

  programs.fzf = {
    enable = true;
    # fzfFish, sourced above.
    enableFishIntegration = false;
    defaultOptions = [
      "--height 80%"
      "--layout"
      "reverse"
      "--border"
    ];
  };

  # nix-direnv caches `use flake` shells.
  programs.direnv = {
    enable = true;
    # direnvFish, sourced above.
    enableFishIntegration = false;
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

        # One git call for the branch, commit and dirty state. -uno skips the
        # untracked-file scan, the slow part in big repos.
        set -l git_status (command git status --porcelain=v2 --branch -uno 2>/dev/null)
        set -l git_branch (string replace -rf '^# branch\.head (.*)$' '$1' -- $git_status)
        if test "$git_branch" = '(detached)'
          set git_branch (string replace -rf '^# branch\.oid (.{7}).*$' '$1' -- $git_status)
        end
        if test -n "$git_branch"
          set -l dirty
          if string match -qv '#*' -- $git_status
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

      # -g: keep these out of the universal fish_user_paths.
      fish_add_path -g "$HOME/.dotfiles/nix/scripts"
      fish_add_path -g "$HOME/.config/composer/vendor/bin"

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

  # Vite+ (pkgs/vite-plus.nix): node/npm/pnpm/bun shims that pick the version
  # per project. Replaces the hook vp's setup writes to this path (it sources
  # ~/.vite-plus/env.fish), with the same PATH: the shims first, the
  # system-first ones (fallback-bin) last. force: take over vp's file.
  xdg.configFile."fish/conf.d/vite-plus.fish".force = true;
  xdg.configFile."fish/conf.d/vite-plus.fish".text = ''
    set -gx VP_HOME "$HOME/.vite-plus"
    for dir in "$VP_HOME/bin" "$VP_HOME/fallback-bin"
      while set -l i (contains -i -- $dir $PATH)
        set -e PATH[$i]
      end
    end
    set -gx PATH "$VP_HOME/bin" $PATH "$VP_HOME/fallback-bin"

    # Always run the Nix vp, so a new version sets itself up on first use.
    # `vp env use` prints commands that set VP_NODE_VERSION; eval them here.
    function vp
      set -l vp ${lib.getExe vitePlus}
      set -l i 1
      if test "$argv[1]" = -C
        set i 3
      else if string match -qr '^-C.+' -- "$argv[1]"
        set i 2
      end
      if test "$argv[$i]" = env; and test "$argv[(math $i + 1)]" = use
        and not contains -- -h $argv; and not contains -- --help $argv
        set -l out (VP_ENV_USE_EVAL_ENABLE=1 VP_SHELL=fish $vp $argv); or return
        for line in $out
          eval $line; or return
        end
      else
        $vp $argv
      end
    end
  '';

  # What `VP_COMPLETE=fish vp` prints; vp computes the completions when asked.
  # Running vp at build time would start its first-run setup, so it's copied.
  programs.fish.completions.vp = ''
    complete --keep-order --exclusive --command vp --arguments "(VP_COMPLETE=fish command vp -- (commandline --current-process --tokenize --cut-at-cursor) (commandline --current-token))"
  '';
  # vpr is `vp run`.
  programs.fish.completions.vpr = ''
    complete --keep-order --exclusive --command vpr --arguments "(VP_COMPLETE=fish command vp -- vp run (commandline --current-process --tokenize --cut-at-cursor)[2..] (commandline --current-token))"
  '';
}
