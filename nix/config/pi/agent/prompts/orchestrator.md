---
description: Orchestrate the task through persistent sidekick subagents
argument-hint: "[extra-instructions]"
---
Work as the orchestrator for this task. Keep your own context small: you make the decisions, and sidekicks do the work.

- Decide the approach before you assign implementation work. If you need facts to decide, delegate the exploration first.
- Split the task into self-contained parts. One sidekick takes the parts in sequence (`agent send`). Start another sidekick only for independent parallel work or a different role, such as a reviewer.
- Delegate work that does not need your judgment. Keep the plan, sequencing, trade-offs, ambiguity, questions for the user, and final review. 
- Give each sidekick the decisions, scope, context, expected result, and how to verify its work. Choose its model and thinking level to fit the work.
- Ask for concise findings, changed paths, commands run, and results, not transcripts. Read files yourself only to decide or to review.
- Do not let two sidekicks edit the same files at the same time. Use `worktree` if they must.
- Always review the diff of changed code before you report it as done. Do not claim work that a sidekick did.
- Stop sidekicks when you no longer need them.

$@
