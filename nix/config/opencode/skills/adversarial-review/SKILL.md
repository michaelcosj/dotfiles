---
name: Adversarial Review
description: Use an evidence-grounded reviewer–critic loop for complex, uncertain, high-risk, or explicitly requested coding work; skip it for trivial low-risk edits
---

# Adversarial review

Use this workflow for complex, uncertain, high-risk, or explicitly requested
coding work, covering implementation decisions and final code review. The
approach-review phase replaces a separate advisor consultation for the same
decision. The primary agent owns investigation, edits, tests, and the authoritative
workflow state. The reviewer and critic are read-only advisers.

Do not use this workflow for trivial, reversible, low-risk edits unless the user
explicitly requests it. Keep it proportionate: normally one approach review and
one final-diff review, with at most two reviewer–critic rounds in each phase.

## Invariants

- Freeze the code while the reviewer and critic deliberate. Do not edit files
  between the first reviewer call and convergence.
- Give both agents the exact task and scope boundaries.
- Preserve review text verbatim when passing it between agents.
- Resume the same reviewer and critic child sessions within a phase by using
  their session IDs. Start fresh sessions for the final-diff phase.
- Treat subagent output as advice. The primary agent remains responsible for the
  result.
- Reject speculative expansion. A valid concern outside the requested behavior
  is not an implementation requirement.

## Phase 1: approach review

1. Investigate the repository and write a concrete proposed approach. Do not
   implement it yet.
2. Launch `ar-reviewer` in the foreground. Supply the task, explicit scope,
   relevant repository context, and proposed approach. Ask for an
   evidence-grounded approach review.
3. Launch `ar-critic` in the foreground. Supply the same task and scope plus the
   reviewer's complete output. Ask it to audit every finding using the required
   verdict protocol.
4. If the critic returns `REVISE`, resume the reviewer session with the critic's
   complete output. Ask for a complete revised review that resolves every
   challenge with evidence.
5. Resume the critic session with the revised review. If material disagreement
   remains, repeat once. After two rounds, the primary agent must adjudicate the
   unresolved items explicitly rather than continuing an open-ended debate.
6. When converged or adjudicated, implement only the accepted, in-scope work.

## Phase 2: final-diff review

1. Finish the implementation and run appropriate targeted checks.
2. Freeze the code and launch a fresh `ar-reviewer` session. Supply the task,
   scope, approach decision, changed-file list, and instructions to inspect the
   current diff and relevant files.
3. Launch a fresh `ar-critic` session with the reviewer's complete output and
   repeat the same evidence, concern, and scope protocol from Phase 1.
4. After convergence or explicit adjudication, make accepted corrections.
5. Run the appropriate checks again. If corrections materially changed behavior,
   perform one focused final review; otherwise stop.

## Primary-agent adjudication

Record each surviving item as `accept`, `reject-evidence`, `reject-scope`, or
`defer`, with a short reason. Never implement a finding merely because both
subagents agreed: confirm that it is supported by repository evidence and falls
within the user's request.
