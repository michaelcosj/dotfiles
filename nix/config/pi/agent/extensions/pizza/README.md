# Extensions

## pizza

Bundled extensions under one entry point.

### pizza-ui

Minimal TUI: borderless padded editor, compact footer styled with the active theme's semantic colors, and default spinner. When Pi has OpenAI Codex OAuth configured, the footer also shows the current Codex usage windows.

### questionnaire

Interactive multi-question tool for structured user input.

### copy-all

Registers `/copy-all`, which copies all user and assistant messages in the current branch to the clipboard.

### file-search

Registers the `fd` and `rg` tools. It prefers system executables and can install verified release binaries into the agent `bin/` directory when needed. The implementation uses native Node.js promises, processes, streams, `fetch`, and cryptography; it has no Effect dependency.

### preset-control

Preset + permission system now lives in pizza.

Config sources:
- `~/.pi/agent/presets.json`
- `.pi/presets.json`

Root config fields:
- `defaultPreset`: preset name to auto-apply when available
- `defaultMode`: fallback permission mode (`allow` | `ask` | `deny`) when no preset is active

Per-preset permission block:
- `permission.defaultMode`
- `permission.allow`
- `permission.deny`
- `permission.ask`

Permission model:
- **`edit` controls both `edit` and `write` tools** — there is no separate `write` permission rule. Internally, `write` is canonicalized to `edit` for rule matching and session overrides.
- **Bash redirection** (`>>`, `>`) upgrades bash mode to `ask` unless `edit` is `allow`. Rationale: redirection mutates files, so it should follow file-modification policy.
- **`Always` option** — permission prompts offer Accept / Always / Reject. Choosing Always:
  - For **bash**: extracts command pattern (e.g. `grep foo file` → `grep *`), confirms with user, stores as session-level bash allow override.
  - For **other tools** (including `edit`/`write`): confirms with user, stores as session-level tool override (`edit → allow`).
  - All session overrides clear on session start / shutdown.

Command + shortcut:

| Command / Shortcut | Action |
|--------------------|--------|
| `/preset` | Open searchable preset selector (type prefix to filter) |
| `/preset <name>` | Switch to preset |
| `Ctrl+Shift+U` | Cycle presets |
| `/permission-toggle-auto-accept` | Toggle per-tool session auto-accept overrides |
| `/permission-mode` | Set session permission mode for one tool |
| `/permission-settings` | Show resolved active permission state |

Tools:

| Tool | Description |
|------|-------------|
| `switch_preset` | Switch to target preset with required reason. Supports permission guards like `switch_preset(plan)` |
| `questionnaire` | Ask one or more structured questions with tab UI |

### caveman

Enforces terse, article-free responses. Appends caveman-mode system prompt each turn. Persists on/off state.

| Command | Action |
|---------|--------|
| `/caveman` | Toggle |
| `/caveman on` | Enable |
| `/caveman off` | Disable |
| `/caveman status` | Show state |

State file: `~/.pi/agents/caveman.json`

### ddgs

DuckDuckGo integration via `ddgs` CLI.

| Tool | Description |
|------|-------------|
| `search_text` | DuckDuckGo text search |
| `extract_content` | Extract markdown text from URL |

Requires `ddgs` installed (`pip install duckduckgo-search`).

### rtk

Rewrites bash commands via `rtk rewrite` when available. Shows token-savings status from `rtk gain`.

### todo

Session-persisted todo list. State lives in tool-result `details` for branch-correct history.

| Tool | Description |
|------|-------------|
| `todo` | `add`, `list`, `toggle`, `clear` |

| Command | Action |
|---------|--------|
| `/todos` | Show todo list UI |

### fusion mode

User-controlled orchestrator mode. Bare `/fusion` toggles the mode. `/fusion on` removes the main agent's direct project tools and requires it to gather context, plan, implement, and verify through subagents. Active tools: `subagent_spawn`, `subagent_send`, `subagent_wait`, `subagent_check`, `subagent_list`, `subagent_cancel`, and `questionnaire`. While active, each agent run also receives the canonical `skills/subagent/SKILL.md` guidance in Pi's skill-block format. `/fusion off` restores its previous tools; `/fusion status` reports the current state. A bright-red `FUSION` badge appears beside Codex usage while active. If the skill cannot be read, fusion continues with its core prompt, warns once, and retries on later runs.

### tps

Shows assistant token throughput summary at end of each agent run.

## Development

```sh
bun test tests
```
