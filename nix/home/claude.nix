# Claude Code. ~/.claude stays a real directory for runtime state: credentials,
# sessions, projects, plugins, and caches. Hand-written config is linked from
# the repo; Claude Code writes settings.json through its link, so settings
# changed in Claude Code show up in git. herdr adds its own hook to
# settings.json and generates hooks/herdr-agent-state.sh; neither is tracked.
{ config, ... }:
let
  repo = "${config.home.homeDirectory}/.dotfiles/nix/config/claude";
in
{
  home.file = {
    ".claude/CLAUDE.md".source = config.lib.file.mkOutOfStoreSymlink "${repo}/CLAUDE.md";
    ".claude/settings.json".source = config.lib.file.mkOutOfStoreSymlink "${repo}/settings.json";
    ".claude/statusline.sh".source = config.lib.file.mkOutOfStoreSymlink "${repo}/statusline.sh";
  };
}
