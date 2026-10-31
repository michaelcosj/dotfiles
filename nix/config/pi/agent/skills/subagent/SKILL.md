---
name: subagent
description: Use when the user asks to use subagents or when you need to delegate work to non-interactive pi child processes that run in the background
---
# Subagents

A subagent is a non-interactive Pi child run in print mode. Start it with the `background` tool so it doesn't block you:

```js
background({ action: "start", name: "scout-auth", command: 'pi -p --mode json --model opencode-go/deepseek-v4-flash --thinking low "<prompt>"' })
```

- Use `--mode json` for live logs and keep sessions enabled. The first JSON record contains the session `id`; save it for follow-ups.
- If you need the result before continuing, use `background({ action: "wait", name, timeout: 600, lines: 100 })`. Otherwise, start with `notify: true` and read the result with `status` + `lines` when notified. Never poll or `sleep`. Read the full log if truncated; the answer is in assistant `message_end` events.
- For long prompts, write the prompt to a file and pass it as `"$(cat /path/to/prompt.md)"` to avoid quoting problems.
- Run independent children in parallel with separate names. Keep it to four or fewer at once.
- `background({ action: "stop", name })` cancels a child that's no longer needed. Children stop with this session.
- Put everything children need in the prompt anyway. If a child truly needs a decision, it can call the `questionnaire` tool: the question waits in a mailbox, and the user sees a notice plus a footer count and answers with `/bg_questions` when they choose. You never see or answer these questions. While any child has a pending question, `wait` returns early. Don't keep re-waiting; tell the user a child is waiting on `/bg_questions`, or go on with other work. Only direct, non-persistent children can ask. Questions time out after 30 minutes (`PI_BG_ASK_TIMEOUT_MS`), and the child gets an error, not a guessed answer.
- To continue a child after it exits, use `--session-id <id>` from the same working directory.

# Delegation Guidelines

## Recommended Picks:

Opus: claude-code/claude-opus-5-5
Sol: openai/gpt-6.1-sol
Luna: openai/gpt-6-luna

- For code related task, use the Opus in low or medium reasoning
- For reviews use Sol at medium or high reasoning
- For cheaper mechanincal tasks that don't require agent autonomy use Luna

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
- Reuse an existing subagent when a follow-up aligns with its previous work.
- When a follow-up builds on a child's earlier work, continue its session with `--session-id` instead of starting from scratch.
