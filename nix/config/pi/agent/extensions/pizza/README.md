# Pizza

Pizza bundles the following Pi extensions behind one entry point.

## UI

### Pizza UI

Installs a compact themed interface with a framed editor, footer, randomized working spinner, and header status. The header displays OpenAI Codex usage windows when OAuth credentials are available and a bright-red `FUSION` badge while fusion mode is active.

### Claude-style tool renderers

Provides compact call and result rendering for Pi's built-in `bash`, `read`, `write`, and `edit` tools, including summarized output and edit diffs.

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

### Fusion mode

`/fusion` toggles an orchestrator mode that restricts the main agent to subagent, questionnaire, and Fusion resource-loading tools. The main agent must delegate context gathering, implementation, and verification. `/fusion on`, `/fusion off`, and `/fusion status` are also supported. Fusion injects the canonical subagent skill and restores the previous tool set when disabled.

| Tool | Purpose |
|---|---|
| `fusion_load_skill` | Load a Pi-discovered skill by exact name |
| `fusion_load_prompt` | Load a Pi-discovered prompt template by exact name |

These tools are active only in Fusion mode and can read only resources from Pi's discovered skill and prompt command registry; they do not accept arbitrary paths.

### Questionnaire

Registers `questionnaire`, an interactive tool for one or more structured questions with tabs, selectable options, and optional free-text answers.

### File search

Registers:

- `fd` for finding files and directories by name.
- `rg` for searching file contents.

The extension prefers system executables, then repository fallback binaries, and finally verified official release downloads. Search output uses Pi's standard truncation limits and preserves complete truncated output in temporary files. The implementation has no Effect dependency.

### Copy all

`/copy-all` copies all user and assistant messages in the current conversation branch to the clipboard.

## Metrics

### Codex usage

Fetches and displays the current OpenAI Codex usage windows when Codex OAuth credentials are configured. Refreshes usage after agent runs.

### TPS

Displays assistant token throughput and elapsed-time statistics after each agent run.

## Development

```sh
bun test tests file-search/index.spec.ts
npm run typecheck
```
