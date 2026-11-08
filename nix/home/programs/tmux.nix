# tmux, with the tsm session picker (scripts/tsm).
{ pkgs, ... }:
{
  programs.tmux = {
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
}
