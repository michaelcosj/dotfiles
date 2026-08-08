# Pizza

Pizza bundles the following Pi extensions behind one entry point.

## UI

### Pizza UI

Installs a compact themed interface with a framed editor, footer, randomized working spinner, and header status. The header displays OpenAI Codex usage windows when OAuth credentials are available.

The input uses a small Vim-like modal editing layer and starts in insert mode. `Esc` enters normal mode; a second `Esc` retains Pi's interrupt behavior. Normal mode supports `i/a/I/A/o/O`, `h/j/k/l`, `w/b`, `0/$`, `x/X`, and `u`. Enter and Pi's control-key shortcuts continue to work normally. This is intentionally not a complete Vim implementation: operators, visual mode, registers, and repeat are not supported.

### Claude-style tool renderers

Pizza provides compact call, progress, result, diff, and expanded-output rendering for Pi's built-in `read`, `bash`, `edit`, and `write` tools. Registration is deferred until `session_start`, when Pi's tool-inspection APIs are available. It replaces only definitions whose current source is still `builtin`; SDK `customTools` and tools owned by other extensions are left untouched, and registration preserves the active tool names.

Execution delegates to Pi's SDK definitions on every call using the current `ctx.cwd`. Bash shell path and command-prefix settings, plus read image auto-resize settings, are loaded through `SettingsManager` with the current project-trust state. Read continues to return normal image blocks, which Pi handles through its standard terminal image pipeline.

Tool expansion is global in Pi 0.83. Pizza follows that shared state and uses the configured `app.tools.expand` keybinding in its hints rather than assuming `ctrl+o`.

Transient in-memory settings, including settings supplied through a custom session `SettingsManager`, and execution overrides that are neither persisted nor exposed as SDK tools cannot be recovered through the extension API.

## Tools and commands

### Background terminals

Runs long-lived commands without blocking the agent. Output is captured and delivered when a process exits.

| Tool / Command | Purpose |
|---|---|
| `bg_start` | Start a background command |
| `bg_status` | Inspect one terminal |
| `bg_wait` | Wait for a terminal to exit |
| `bg_list` | List terminals |
| `bg_kill` | Stop terminals |
| `/ps` | Open the terminal process viewer |

### Subagents

Runs independent, persisted Pi child sessions with status, result, transcript, takeover, and messaging UI.

| Tool / Command | Purpose |
|---|---|
| `subagent_spawn` | Start a subagent |
| `subagent_send` | Send or continue work |
| `subagent_wait` | Wait for subagents |
| `subagent_cancel` | Interrupt subagents |
| `subagent_check` | Inspect one subagent |
| `subagent_list` | List subagents |
| `/subagents` | Open the subagent viewer |
| `/btw` | Run a side task from a prompt |

### Orchestration prompt

The global `/fusion` prompt template instructs the main agent to load the `subagent` skill, create one task-appropriate primary sidekick, and delegate routine execution while retaining planning, decisions, ambiguity resolution, and final review. An optional argument can suggest the sidekick's role or focus. This is workflow guidance rather than an enforced tool restriction.

### Questionnaire

Registers `questionnaire`, an interactive tool for one or more structured questions with tabs, selectable options, and optional free-text answers.

### Copy all

`/copy-all` copies all user and assistant messages in the current conversation branch to the clipboard.

## Metrics

### Codex usage

Fetches and displays the current OpenAI Codex usage windows when Codex OAuth credentials are configured. Refreshes usage after agent runs.

### TPS

Displays assistant token throughput and elapsed-time statistics after each agent run.

## Architecture

Pizza is one Pi package with one `package.json`, lockfile, and strict TypeScript project. The root `index.ts` is the sole composition root; each bounded feature owns its registration, runtime state, tools, commands, presenters, and TUI modules. Subagents and background terminals remain separate features, while generation-aware deferred delivery is the only shared runtime primitive. The orchestration workflow is a standalone prompt template, not an extension feature.

## Development

Run the complete validation from this directory:

```sh
npm run check
```

The same commands are available separately:

```sh
npm test
npm run typecheck
```
