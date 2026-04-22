# Extensions

## m-agents

Unified agent-control extension. Owns presets, permissions, questionnaire, and subagents.

### Commands

| Command | Action |
|---------|--------|
| `/preset` | Open preset selector |
| `/preset <name>` | Switch to preset |
| `/permission-toggle-auto-accept` | Toggle per-tool auto-accept overrides |
| `/permission-mode` | Set session permission mode for one tool |
| `/permission-settings` | Show resolved permission state |
| `/subagents` | List subagent sessions |
| `/subagent-view <id-prefix>` | View specific subagent session |

### Shortcut

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+U` | Cycle presets |

### Tools

| Tool | Description |
|------|-------------|
| `questionnaire` | Ask one or more structured questions with tab UI |
| `subagent` | Delegate work in single / parallel / chain mode |

### Features

- Preset loading + switching (`~/.pi/agent/presets.json`, `.pi/presets.json`)
- Permission policy resolution (`allow` / `ask` / `deny`) + session overrides
- Parent→child permission inheritance for subagents
- Parent-side forwarding for subagent permission prompts + questionnaire UI
- Persistent subagent session files + viewers

---

## pizza

Bundled extensions under one entry point.

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

### tps

Shows assistant token throughput summary at end of each agent run.
