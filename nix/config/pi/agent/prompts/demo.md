---
description: Hands-free live tour of the dotfiles' agent and Rex features
argument-hint: "[focus, e.g. \"rex pi\"]"
---
Give a live, hands-free tour of the features in my dotfiles (`~/.dotfiles`). Run every step yourself and show it working on screen. I only watch: never wait for me, never ask me anything, and never ask me to press a key.

## Rules

- **No user input.** Do not use `questionnaire`, `submit_plan`, or anything else that blocks until I answer or approve. Do not ask for confirmation between stages; go straight on.
- **Safe and reversible.** Put demo files in a new folder under `/tmp/dotfiles-demo/`. Do not edit the repo, commit, push, rebuild, or change `~/.pi`, `~/.codex`, Rex settings or my workspace. Close every pane, tab, job and agent that you start.
- **Check before you show.** Read the file a feature lives in and give its path. If a feature is not available here (not in Rex, no Neovim connected, no browse MCP), say so in one line and skip it.
- **Narrate briefly.** Before each step, say in one line what you will show. After it, say in one line what happened. Leave each visible result on screen for a few seconds (`sleep 3`) before you go on or clean it up.
- If I gave a focus, run only those stages: $@

## Start

Find the platform: `uname`, `$REX_SESSION`, `$REX_BLOCK`, `rex whoami --json`, whether the agent bridge has an editor (Neovim) connected, and whether the `browse` MCP tools exist. Say which stages will run.

## Stages

1. **Rex workspace** (`nix/config/rex/`): only inside Rex. Read the rex skill first.
   - Show the Ctrl+A key map from `init.lua` as a short table (do not press keys).
   - Live layout with the `rex` CLI, in this window: split a pane to the right that runs a small command (for example `rex run --split right --label demo -- sh -c 'eza --tree --level 2 ~/.dotfiles/nix/config/rex; sleep 15'`), then float it (`rex do pane_float_block block_id=…`), then close it. Show `rex capture` of that pane.
   - Projects (`projects.lua`): run `rex do project_list` and show the projects it finds. Do not open one.
   - Session restore (`restore.lua`, `bin/rex-watch.lua`, the pi extension `rex-session.ts`): show the state file this pi wrote under `$XDG_STATE_HOME/rex/agents/`, and explain in two lines how pi resumes after a server restart.
   - Fedora only: Rex Rune (`home/linux/fedora.nix`, `nix/patches/rex-rune-local.patch`): the Charcoal Atelier theme, `interface.active_pane_outline_width`, and the XWayland wrapper for file drag and drop. Show the wrapper with `cat "$(command -v rex-rune)"`.

2. **Neovim and pi** (`nix/config/nvim/lua/config/agent-bridge/`, `pi/agent/extensions/agent-bridge/editor.ts`): only if an editor is connected.
   - `open_in_editor`: show `nix/config/rex/init.lua` at the Ctrl+A prefix, then the `editorFocused` function in `pi/agent/extensions/agent-bridge/agents/ui.ts`.
   - Edit review: write a small file in `/tmp/dotfiles-demo/`, change it, and open it in the editor to show the change. Mention `:AgentChanges` and the plan review with CriticMarkup in one line each; do not start a review.

3. **pi extensions** (`nix/config/pi/agent/extensions/`)
   - `background`: start `for i in 1 2 3; do echo tick $i; sleep 2; done` with notify, show its log while it runs, and report its exit.
   - Subagents (`agent-bridge`): read the subagent skill, then start one child on a cheap model with a small task, for example "Count the .lua files under ~/.dotfiles/nix/config/nvim and reply with only the number." Its pane and the agent list below the editor show while it works. Report its reply, then stop it.
   - Footer: `compact-footer.ts`, `tps.ts`, and `subscription-usage`. Read `~/.pi/agent/state/subscription-usage.json` and show the Claude and ChatGPT limits as a small table.
   - `questionnaire`: describe it in two lines (options, "Type something", and the phone fix that keeps the selection and the answer box in view). Do not open one.
   - `generate-title`, `references` (`/refs`), the `/demo` prompt, and the pi skills in `nix/config/pi/agent/skills/` (`subagent`, `orchestrator`): one line each.

4. **Skills and shared instructions** (`nix/config/agents/`)
   - `AGENTS.md` is shared by pi, Claude Code and Codex (`home/agents.nix`, `claude.nix`, `codex.nix`). List the skills, one line each, grouped.
   - Live skill: inside Rex, read the `visualise` skill and show a diagram of how this repo links config into each tool (Nix → `~/.pi`, `~/.claude`, `~/.codex`, `~/.config/nvim`, `~/.config/rex`). Otherwise skip.

5. **Browser for agents** (`nix/config/pi/agent/mcp.json`, `nix/README.md`): only if the `browse` MCP tools exist. Open `https://example.com` in a new Helium tab, take a screenshot and show it, then close the tab.

## End

1. Clean up without asking: close demo panes, stop jobs and agents you started, and delete `/tmp/dotfiles-demo/`.
2. Give a summary table: stage, what you showed, the file to read for more.
3. List what you skipped and why.
