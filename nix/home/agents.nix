# Instructions and skills shared by all coding agents, linked from the repo so
# edits apply without a rebuild. ~/.agents stays a real directory: skill
# installers keep runtime state there (.skill-lock.json).
#
# Each agent's own instruction file is one line that points to
# ~/.agents/AGENTS.md (Claude Code uses its native @ import). Pi, OpenCode,
# and Codex discover ~/.agents/skills themselves.
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
