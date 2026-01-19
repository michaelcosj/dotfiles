## Shell Strategy (CI-safe)

Assume headless CI. Avoid anything that can hang, prompt, or explode output.

### Core Rules

1. **No editors/pagers**: never use `vim`, `nano`, `less`, `more`, `man`.
2. **No interactive modes**: avoid `-i`, `-p`, or commands that open editors.
3. **Always choose non-interactive flags**: prefer `--yes`, `-y`, `--force`, `--no-edit`.
4. **Prefer native tools for file ops/search** (Read/Write/Edit/Grep/Glob). Use shell mainly for `git`, tests, builds, and system commands.

### Key Environment Expectations

- `CI=true`, `DEBIAN_FRONTEND=noninteractive`
- `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `PAGER=cat`
- `npm_config_yes=true`, `PIP_NO_INPUT=1`

### Safe Defaults (examples)

**Git (non-interactive):**
```bash
git status
git log -n 10
git --no-pager diff
git commit -m "message"
git merge --no-edit branch
```

### Modern Tool Preferences

Use modern alternatives over legacy tools:

| Legacy | Modern | Why |
|--------|--------|-----|
| `grep` | `rg` (ripgrep) | Faster, respects .gitignore, better defaults |
| `find` | `fd` | Simpler syntax, faster, respects .gitignore |
| `ls` | `eza` | Better formatting, git-aware, tree view |
| `cat` | `bat` | Syntax highlighting (use `bat --plain` for plain output) |


**Package manager detection:**
- If project uses Bun (has `bun.lockb`), use `bun` instead of `npm`
- For global command execution, prefer `bunx` over `npx` (fallback to `npx` on persistent errors)

```bash
# Bun project
bun install
bun test
bun run build
bun <typscript/javascript script>
bunx <package>  # or npx if bunx fails
```


### Avoid Bloated Search Context

Exclude large folders unless the goal is to search them:
`node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.next/`, `target/`, `vendor/`, `.cache/`.

**Search content (ripgrep):**
```bash
rg "<pattern>" -g'!node_modules/' -g'!dist/' -g'!build/'
```

**Find files (fd):**
```bash
fd "pattern" --exclude node_modules --exclude dist --exclude build
```

**Fallback (find):**
```bash
find . -path './node_modules' -prune -o -path './dist' -prune -o -type f -print
```

**Only search dependencies when explicitly needed:**
```bash
rg "<pattern>" node_modules
```
