---
description: Create well-formatted commits with conventional commit messages
agent: smart
model: firmware/cerebras-gpt-oss-120b
subtask: true
---

# Commit Command

Create well-formatted git commits using conventional commit format. Always ask for confirmation before committing.

## Workflow

1. **Analyze**: Review conversation context, `git status --porcelain`, and **always run `git diff`** to get full context of all changes.
2. **Plan**: Group related changes into logical commits. Draft message(s) using `<type>(scope): <description>` format (scope is optional).
3. **Confirm**: Present your plan (files + messages) in a well formated summary using markdown syntax and ask the user to confirm.
4. **Execute**: Stage specific files (never `git add -A` or `.`), commit, then show `git log --oneline -n <N>`.

## Commit Format

**Format:** `<type>(scope): <description>` (imperative mood, under 72 chars, scopre is optional)

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code restructure (no behavior change)
- `chore` - Build/tooling changes
- `style` / `perf` / `test` - As named

**Examples:**
- `feat(auth): add user authentication flow`
- `fix(tui): resolve memory leak in renderer`
- `refactor: simplify error handling in parser`
