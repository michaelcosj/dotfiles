---
name: subagent
description: Delegate independent work to lightweight persisted Pi child sessions.
---

# Lightweight Subagents

- Use `subagent_spawn` for independent tasks that can run concurrently.
- Use `subagent_wait` when results are required before continuing; never poll or run sleep.
- Use `subagent_check` only for a one-shot status/output preview.
- Use `subagent_send` to steer a running child or continue a completed child in its persisted session instead of spawning a replacement.
- Use `subagent_cancel` to interrupt work that is no longer needed.
- Use `subagent_list` to inventory model-spawned children.
- Children are persisted, session-scoped, limited to four running agents, and cannot recursively delegate or ask the user.
- `/subagents` opens the dashboard and takeover UI; `/btw question` opens a side-question child whose answer stays out of model context.

# Delegation Guidelines

## Choose the Right Model and Effort

Match the model and reasoning effort to the task's complexity, required capability, token efficiency, and cost.

- Do not assign simple tasks to expensive frontier models.
- Do not assign complex tasks to models that lack the required capability.
- Use the lowest reasoning effort that can reliably complete the task.
- Prefer cheaper models for exploration and context gathering.
- Choose implementation models based on the complexity and clarity of the requirements.

The recommended models to use are 

`openai-codex/gpt-5.6-luna`: lightweight cheap and fast for exploration and simple tasks
`openai-codex/gpt-5.6-terra`: middle child for more complex tasks that require some more autonomy but not much capability
`openai-codex/gpt-5.6-sol`: most capable frontier model for more complex tasks that require the most autonomy and capability

### Recommended Picks:


| Model | Effort | Best for |
| --- | --- | --- |
| `openai-codex/gpt-5.6-terra` | `low` | Very simple implementation tasks that require a small model |
| `openai-codex/gpt-5.6-sol` | `low` | Implementation with complete requirements and precise instructions |
| `openai-codex/gpt-5.6-luna` | `high` | Exploration and context gathering |
| `openai-codex/gpt-5.6-sol` | `medium` | Complex implementation and implementation verification |
| `openai-codex/gpt-5.6-sol` | `high` | Code review |


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
- When in fusion mode always prefer `subagent_send` over spawning a replacement, even when the existing subagent has completed, so its persisted context can be reused.
