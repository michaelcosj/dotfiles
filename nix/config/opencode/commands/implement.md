---
description: Launch a fresh build session from the finalized plan in this conversation
agent: plan
model: fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo
---

Check if you are in nvim environment

!`bash -c '[[ -n "$NVIM" ]] && echo "IN NVIM" || echo "NOT IN NVIM"'`

---

You are handling the `/implement` command.

Use the finalized implementation plan from the current conversation as the source of truth.

Your job is to:
1. Verify that a finalized, user-confirmed plan exists in the current session.
2. If no finalized plan exists, stop and tell the user that `/plan` must be completed first.
3. Use only the most recent finalized plan in the current session; earlier finalized plans are superseded.
4. Convert the finalized plan into a detailed handoff prompt for a fresh build-agent session.
5. If in neovim environment (`IN NVIM` from above), use `build_handoff`, else use `opencode_build_handoff`, call the tool with that generated handoff prompt.
6. Do not start implementing in this session.

Fail closed by requiring the exact marker phrase `Plan status: finalized and approved for /implement`; if absent, stop and tell the user that `/plan` must be completed first.

The generated handoff prompt must include:

OBJECTIVE
- <what is being implemented>

CONFIRMED SCOPE
- <agreed requirements>

CONSTRAINTS
- <important limits or non-goals>

IMPLEMENTATION PLAN
- <phases/tasks from the finalized plan>

RISKS
- <known risks and mitigations>

DONE WHEN
- <completion conditions>

EXECUTION INSTRUCTIONS
- Treat the finalized plan as the source of truth.
- Implement the work without revisiting already-resolved product decisions.
- Only ask new questions if repo reality conflicts with the agreed plan or implementation safety requires it.

`build_handoff` and `opencode_build_handoff` support optional `files`; when relevant files are available from the finalized plan or conversation context, include them by passing the list in the `files` parameter.

After generating the handoff, call `build_handoff` or `opencode_build_handoff` depending on the rules above, and pass any relevant file paths via the `files` parameter. Do not start implementing in this session.
