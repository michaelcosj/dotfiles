---
name: subagent
description: Delegate independent work to non-interactive Pi child processes (pi -p) run in the background.
---

# Subagents

A subagent is a non-interactive Pi child run in print mode. Run it through the background-terminals helper so it doesn't block you:

```sh
bg=~/.pi/agent/skills/background-terminals/bg.sh
$bg start scout-auth 'pi -p --no-session --model opencode-go/deepseek-v4-flash --thinking low "<prompt>"'
```

- The child's final answer is its output. Read it with `$bg wait <name>` when you need the result, or with `$bg status <name>` for a preview. Don't poll or `sleep`.
- For long prompts, write the prompt to a file and pass it as `"$(cat /path/to/prompt.md)"` to avoid quoting problems.
- Run independent children in parallel with separate names. Keep it to four or fewer at once.
- `$bg kill <name>` cancels a child that's no longer needed.
- Children can't ask the user questions. Put everything they need in the prompt.
- To continue a child's work, drop `--no-session` and pass `--session-id <id>` on both the first run and every follow-up.

# Delegation Guidelines

## Choose the Right Model and Effort

Match the model and reasoning effort to the task's complexity, required capability, token efficiency, and cost.

- Do not assign simple tasks to expensive frontier models.
- Do not assign complex tasks to models that lack the required capability.
- Use the lowest reasoning effort that can reliably complete the task.
- Prefer cheaper models for exploration and context gathering.
- Choose implementation models based on the complexity and clarity of the requirements.

The recommended models to use are 

### Cheap
`Luna - openai-codex/gpt-5.6-luna or opencode-go/gpt-5.6-luna`: lightweight fast and very cheap for exploration and simple tasks that don't require much autonomy.
`Deepseek Flash - opencode-go/deepseek-v4-flash`: faster and cheaper than luna, very good for exploration and simple tasks that need to be done quickly.


### Middle
`Deepseek Pro - opencode-go/deepseek-v4-pro`: capable for middle tasks that don't require as much autonomy or capability as the frontier


### Powerful
`Sol - openai-codex/gpt-5.6-sol`: most capable frontier model for more complex tasks that require autonomy and higher capability

### Recommended Picks:

- For code related task, sol with low reasoning is the optimal choise as it is fast and performant and not as expensive in low reasoning
- For review sol at medium reasoning should be sufficient, more complex tasks could require high reasoning although this should be rare. Never go above high reasoning with sol
- For cheap code tasks deepseek pro is also performant and can be used for code work that don't require as much autonomy
- Exploration and context gathering should be done with low cost, fast models like flash and luna.

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
