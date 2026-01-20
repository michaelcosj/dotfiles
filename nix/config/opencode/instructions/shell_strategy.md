## Shell Strategy (CI-safe)

Assume headless CI. Avoid anything that can hang, prompt, or explode output.

### Core Rules

1. **No editors/pagers**: never use `vim`, `nano`, `less`, `more`, `man`.
2. **No interactive modes**: avoid `-i`, `-p`, or commands that open editors.
3. **Always choose non-interactive flags**: prefer `--yes`, `-y`, `--force`, `--no-edit`.

### Key Environment Expectations

- `CI=true`, `DEBIAN_FRONTEND=noninteractive`
- `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `PAGER=cat`
- `npm_config_yes=true`, `PIP_NO_INPUT=1`

### Git (non-interactive)

```bash
git status
git log -n 10
git --no-pager diff
git commit -m "message"
git merge --no-edit branch
```

### Package Manager Detection

- If project uses Bun (has `bun.lockb`), use `bun` instead of `npm`
- For global command execution, prefer `bunx` over `npx` (fallback to `npx` on persistent errors)

```bash
# Bun project
bun install
bun test
bun run build
bunx <package>
```
