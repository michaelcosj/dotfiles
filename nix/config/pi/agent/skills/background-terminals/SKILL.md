---
name: background-terminals
description: Run long-lived shell commands in the background with the bg.sh helper. Use for dev servers, watchers, long builds and test runs, and anything that should keep running while you continue working.
---

# Background Terminals

Use regular `bash` for quick commands. For anything long-running, use `bg.sh` in this skill's directory:

```sh
bg=~/.pi/agent/skills/background-terminals/bg.sh
```

Every bash call is a fresh shell, so always go through `bg.sh`. Don't use a bare `&` or `nohup`: the job outlives the call, and only `bg.sh` keeps a pid, log and exit code you can find later.

## Start

```sh
$bg start <name> <command...>
```

- `name`: a short label (letters, digits, `.`, `_`, `-`), for example `web`, `tests` or `tsc-watch`.
- Wrap the command in quotes if it uses `&&`, pipes or redirects: `$bg start web 'cd app && npm run dev'`.
- Jobs get no stdin. Never use them for interactive prompts.
- `start` refuses a name that is already running. Run `$bg list` before starting servers or watchers so you don't start duplicates.

After starting, keep doing useful work. Check the job only when you need its result.

## Inspect and wait

- `$bg status <name> [lines]`: state (`running`, `exited <code>`, `stopped`) plus the tail of the log.
- `$bg wait <name> [timeout]`: block until the job exits (default 600s). Use this instead of `sleep` loops.
- `$bg until <name> <regex> [timeout]`: block until the log matches, for example `$bg until web 'ready|listening' 60` for a server. It fails early if the job exits first.
- `$bg list`: every job and its state.
- The full log is at the path `status` prints. Search it with `rg`/`tail` rather than dumping it.

## Stop

- `$bg kill <name>`: stops the job's whole process group (TERM, then KILL after 5s).
- `$bg kill --all`: stops every job.
- `$bg clean`: forgets jobs that are no longer running.

Jobs are not tied to the Pi session. Kill servers and watchers you started once they're no longer needed, and mention any you leave running to the user.
