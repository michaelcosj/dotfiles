# Shared headless-safe Home Manager config. Desktop and platform modules
# add their own tools; the flake sets the account and machine identity.
{ pkgs, ... }:
{
  imports = [
    ./agents.nix
    ./claude.nix
    ./codex.nix
    ./links.nix
    ./pi.nix
    ./programs/fish.nix
    ./programs/git.nix
    ./programs/tmux.nix
  ];

  home.packages = with pkgs; [
    ast-grep
    bat
    biome
    caddy
    cloudflared
    eza
    fd
    gh
    gws
    htop
    imagemagick
    jq
    lua-language-server
    mongodb-tools
    neovim
    nixd
    nixfmt
    oxlint
    prettierd
    ripgrep
    stylua
    tree
    tree-sitter
    typescript
    uv
    vscode-langservers-extracted # CSS, HTML, and JSON language servers
    (callPackage ../pkgs/opencode.nix { })
    (callPackage ../pkgs/vite-plus.nix { })
    # lazygit's edit command (programs.lazygit below)
    (writeShellScriptBin "lazygit-nvim-edit" (builtins.readFile ../pkgs/lazygit-nvim-edit.sh))
  ];

  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    # opencode is pinned by Nix (pkgs/opencode.nix); don't let it replace itself.
    OPENCODE_DISABLE_AUTOUPDATE = "1";
  };

  programs.home-manager.enable = true;
}
