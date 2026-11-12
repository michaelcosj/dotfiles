# Instructions and skills shared by all coding agents, linked from the repo so
# edits apply without a rebuild. ~/.agents stays a real directory: skill
# installers keep runtime state there (.skill-lock.json).
#
# Pi and Codex link their AGENTS.md to the shared file; Claude Code uses
# an @ import; OpenCode's own file points to it. Pi, OpenCode, and Codex
# discover ~/.agents/skills themselves.
{ config, ... }:
let
  repo = "${config.home.homeDirectory}/.dotfiles/nix/config";
  link = path: config.lib.file.mkOutOfStoreSymlink "${repo}/${path}";
in
{
  home.file = {
    ".agents/AGENTS.md".source = link "agents/AGENTS.md";
    ".agents/skills".source = link "agents/skills";
  };
}
