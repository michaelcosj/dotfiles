---
name: subagent
description: Use when the user asks to use subagents or when you need to delegate work to child pi agents
---
# Subagents

## In Rex: the `agent` tool

When the `agent` tool is available, use it. Each child is an interactive pi in its own Rex pane. The user sees every agent in the list below the prompt, can switch to any of them, and can type to them or answer their questions.

```js
agent({ action: "start", name: "scout-auth", title: "Map the auth flow", model: "claude-code/claude-opus-5-5", thinking: "low", task: "<full prompt>" })
```

- `start` returns at once. Each time a child settles, its final reply arrives as a message (`notify`, default true), so carry on with other work.
- Use `agent wait` only when you cannot continue without a result. It returns the first unreported result, or returns early when a child is blocked on a question in its own pane (the user is talking to it directly). Then tell the user that the child needs an answer (they switch to it with ↓ on an empty prompt). Never answer those for them.
- A child that needs an answer from you ends its turn with numbered questions under "Questions". Answer facts and decisions the user already made yourself, with `agent send`, and tell the user your answer in one line. Ask the user about new choices, destructive or hard-to-undo steps, scope changes and matters of taste, then send their answer on. Do not tell children to use `questionnaire`.
- Children stay alive after they settle. `agent send` gives a settled child follow-up work, or queues a follow-up for a busy one.
- `agent stop` closes a child. Stop children you no longer need.
- Children close when this pi exits, but their conversations are saved in this session. After a restart, `agent status` lists them and `agent resume` reopens one, optionally with a first message in `text`.
- You see only each child's final reply, not its transcript. Ask for what you need in that reply.
- Children cannot start agents. Their file edits show up in the user's Neovim change review under their name.
- Run independent children in parallel. Keep it to four or fewer at once.

### In its own worktree: `worktree`

`agent start` with `worktree: true` runs the child in a fresh git worktree on branch `agent/<name>`, under `~/.local/share/worktrees/<repo>/` (a string names the worktree instead). The child is told to commit there.

- Use it to compare approaches (two children on the same task, one worktree each), or when children edit the same files at the same time. Otherwise let children share your directory: their edits show in the user's editor as they happen.
- The editor does not see a worktree child's edits until you merge them. Compare with `git diff HEAD...agent/<name>`, or `agent-worktree ls` for an overview.
- Take a result with `git merge agent/<name>` (`--no-commit` to let the user review it in the editor as uncommitted changes), or cherry-pick.
- Then remove every worktree you made, including the ones you didn't use: `agent-worktree rm <name>` (it refuses unmerged work; `--force` discards it). Stopping a child keeps its worktree.

### On another machine: `remote_agent`

Use `remote_agent` when the user names a Rex host ("run it on the devbox") or the work belongs there: more power, another OS, or a project that lives there. `remote_agent hosts` lists the hosts and whether each one answers. Pass the full label.

```js
remote_agent({ action: "start", host: "devbox-work", name: "build-check", title: "Run the full build", cwd: "~/code/app", task: "<full prompt>" })
```

- After `start`, manage it with the `agent` tool (`send`, `wait`, `status`, `stop`, `resume`), as for a local child. It shows in the same list as `name@host`. Selecting it switches the Rex app to the host's `pi-agents` session.
- Its files, paths, programs and models are the host's. `cwd` is a path on the host, where `~` is the host's home. It defaults to this cwd under `~`. Name a model the host has; leave it out to use the host's default.
- Its edits are not in the user's Neovim change review. Ask for a summary of its changes, such as a diff or commit, in its reply.
- It stops when this pi exits, and exits on its own if it can't reach this pi for five minutes.

## Outside Rex: `pi -p` in the background

Without the `agent` tool, run a non-interactive child with the `background` tool:

```js
background({ action: "start", name: "scout-auth", notify: true, command: 'pi -p --mode json --model claude-code/claude-opus-5-5 --thinking low "$(cat /tmp/scout-auth.md)"' })
```

- Write the prompt to a file and pass it as `"$(cat file)"` to avoid quoting problems.
- `--mode json` gives live logs. The first JSON record has the session `id`; continue the child later with `--session-id <id>` from the same working directory.
- End your turn after starting; the notification wakes you. Then read the result with `background status` and `lines`. Use `background wait` only when you cannot do anything else without the result, since it blocks the user's follow-ups. The answer is in assistant `message_end` events.
- A child may ask the user through `questionnaire`; the user answers with `/bg_questions`. While a question is pending, `wait` returns early. Tell the user and go on.

# Delegation Guidelines

## Recommended Picks

Opus: claude-code/claude-opus-5-5
Sol: openai-codex/gpt-6.1-sol
Luna: openai-codex/gpt-6-luna

- For code-related tasks, use Opus at low or medium thinking.
- For reviews, use Sol at medium or high thinking.
- For cheaper mechanical tasks that don't need agent autonomy, use Luna.

## Write Precise Prompts

Give each subagent enough context to complete its task without unnecessary discovery.

- State the objective, scope, constraints, and expected output explicitly.
- Avoid vague instructions that require the subagent to make assumptions.
- Include relevant context already gathered by the main agent or other subagents.
- Omit unrelated information that consumes context without helping the task.
- For implementation and verification tasks, identify relevant files, requirements, and commands when known.

## Delegate Deliberately

- Parallelize only independent work that benefits from concurrent execution.
- Do not spawn more subagents than the task requires.
- Reuse an existing subagent when a follow-up builds on its earlier work: `agent send` in Rex, `--session-id` otherwise.
