# Pizza

A single package for my Pi extensions.

## Features

### UI

- Framed editor with working-directory and mode indicators
- Vim-style insert and normal modes
- Compact renderers for `read`, `bash`, `edit`, and `write`
- Codex usage in the header
- Custom spinner and working messages

### Background terminals

- `bg_start` — start a background command
- `bg_status` — inspect a terminal
- `bg_wait` — wait for a terminal to exit
- `bg_list` — list terminals
- `bg_kill` — stop terminals
- `/ps` — open the process viewer

### Subagents

- `subagent_spawn` — start a subagent
- `subagent_send` — continue a subagent
- `subagent_wait` — wait for subagents
- `subagent_cancel` — interrupt subagents
- `subagent_check` — inspect a subagent
- `subagent_list` — list subagents
- `/subagents` — open the subagent viewer
- `/btw` — start a side task
- Transcript, status, result, and takeover views

### Other

- `questionnaire` — ask structured, tabbed questions
- `/copy-all` — copy the current conversation branch
- `/fusion` — orchestrate work through a primary sidekick
- Codex usage tracking
- Token throughput and elapsed-time metrics

## Development

```sh
npm run check
```
