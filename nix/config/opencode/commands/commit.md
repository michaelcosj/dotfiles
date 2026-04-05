---
description: Create well-formatted commits with conventional commit messages
agent: general
model: fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo
subtask: false
---

# Commit Command

Create well-formatted git commits using conventional commit format. Always ask for confirmation before committing.

## Workflow

1. **Analyze**: Review conversation context, use @general agent to always run `git status --porcelain` and `git diff` and read relevant files to get full context of all changes.
2. **Plan**: Group related changes into logical commits. Draft message(s) using `<type>(scope): <description>` format (scope is optional).
3. **Confirm**: Present your plan (files + messages) in a well formatted summary, then **MUST use the question tool** to ask for confirmation. **Never ask for confirmation in chat text - only use the question tool.** The question should:
   - Offer "Approve commit" as an option
   - Apply any refinements given by the user to the commit message before proceeding
4. **Execute** (only after explicit approval): Stage specific files (never `git add -A` or `.`), commit, then show `git log --oneline -n <N>`.

## Commit Format

**Format:** `<type>(scope): <description>` (imperative mood, under 72 chars, scope is optional but recommended)

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
- `chore(api/inventory): run format on file`
- `refactor: simplify error handling in parser`
