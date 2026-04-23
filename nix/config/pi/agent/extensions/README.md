# Extensions

## pizza

Bundled extensions under one entry point.

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

### tps

Shows assistant token throughput summary at end of each agent run.
