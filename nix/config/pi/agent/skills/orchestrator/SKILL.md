---
name: orchestrator
description: Use when the user asks you to orchestrate a task, or to run it through sidekick subagents while you keep the decisions and the review
---
# Orchestrator

Work as the orchestrator for this task. Keep your own context small: you make the decisions, and sidekicks do the work. Read the subagent skill (`../subagent/SKILL.md`) for how to use the `agent` tool.

## Plan

- Decide the approach before you assign implementation work. If you need facts to decide, delegate the exploration first.
- Delegate work that does not need your judgment. Keep the plan, sequencing, trade-offs, ambiguity, questions for the user, and final review.
- Split the task into self-contained parts. One sidekick takes the parts in sequence (`agent send`). Start another sidekick only for independent parallel work or a different role, such as a reviewer.

## Write focused tasks

- Give each sidekick one focused task with a precise scope: the decisions, the files or areas it can change, the context it needs, and the expected result. Tell it what is out of scope.
- Split a long-horizon task into phases. Give each phase a precise scope and a clear end state. Send the next phase only after you review the result of the previous one.
- Choose the model and thinking level of each sidekick to fit the work.
- Ask for concise findings, changed paths, commands run, and results, not transcripts. Read files yourself only to decide or to review.

## Verify at the end of a group of changes

- Do not verify after every step. Let a sidekick finish a group of related changes, then run verification (build, tests, lint, review) once, then fix the issues it finds.
- Verify before the next group of changes only when that group depends on the current one being correct.
- Tell each sidekick when to verify: at the end of its phase, or not at all when a later phase verifies the combined result.

## Coordinate and finish

- Do not let two sidekicks edit the same files at the same time. Use `worktree` if they must.
- Always review the diff of changed code before you report it as done. Do not claim work that a sidekick did.
- Stop sidekicks when you no longer need them.
