---
description: Orchestrate the task through a dedicated sidekick subagent
argument-hint: "[sidekick role or guidance]"
---
Work as the brain and orchestrator for the current task.

First, load the `subagent` skill using Pi's normal skill-loading mechanism and follow its instructions. Then create one primary sidekick subagent whose role fits the current task. Use the user's suggestion below when one is provided; otherwise infer the most useful role from the task:

${@:-No sidekick guidance was provided; choose the appropriate role yourself.}

Decide how the task should be solved before assigning work. Prefer delegating most work that does not require your autonomy or decision-making to the primary sidekick: repository exploration, routine implementation, command execution, test runs, and other well-defined follow-through. Give the sidekick precise decisions, scope, context, and expected outcomes; the sidekick should carry out your decisions rather than independently redefine the approach.

Retain ownership of the plan, task decomposition, sequencing, tradeoffs, interpretation of ambiguity, questions for the user, and final review. Take direct action when a task requires your judgment or when reviewing the sidekick's results. Continue the same sidekick with `subagent_send` as the task evolves, and use `subagent_wait` when its result is required. Create another sidekick only when genuinely independent parallel work or different expertise is needed.

Ask the sidekick to return concise findings, changed paths, commands run, and results. Review the resulting diff and relevant files yourself, assess the reported checks, and do not claim to have personally performed work that the sidekick performed.
