import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  CHILD_EXCLUDED_TOOLS,
  isChildToolExcluded,
  isSuccessfulCompaction,
  resolvePiModel,
  updateToolActivity,
} from "../../src/features/subagents/child-session.ts";
const models = [
  { provider: "a", id: "shared" },
  { provider: "b", id: "shared" },
  { provider: "a", id: "only" },
] as any[];
const registry = {
  find: (p: string, id: string) =>
    models.find((m) => m.provider === p && m.id === id),
  getAll: () => models,
} as any;
test("model resolution inherits, qualifies, prefers inherited provider, and rejects ambiguity", () => {
  assert.equal(
    resolvePiModel(registry, undefined, { provider: "a", id: "only" })?.id,
    "only",
  );
  assert.equal(resolvePiModel(registry, "b/shared", undefined)?.provider, "b");
  assert.equal(
    resolvePiModel(registry, "shared", { provider: "a", id: "only" })?.provider,
    "a",
  );
  assert.throws(
    () => resolvePiModel(registry, "shared", undefined),
    /ambiguous/,
  );
  assert.throws(
    () => resolvePiModel(registry, "missing", undefined),
    /Unknown model/,
  );
});
test("child tool denylist blocks delegation and interactive questions", () => {
  for (const name of [
    "subagent_spawn",
    "subagent_wait",
    "subagent",
    "workflow",
    "questionnaire",
    "ask_user",
  ])
    assert.ok(CHILD_EXCLUDED_TOOLS.includes(name));
  for (const name of ["delegate_task", "other-subagent-run", "ask-question"])
    assert.ok(isChildToolExcluded(name));
  assert.equal(isChildToolExcluded("read"), false);
});

test("only successful final compaction events count", () => {
  const event = {
    type: "compaction_end",
    reason: "threshold",
    result: { summary: "ok" },
    aborted: false,
    willRetry: false,
  } as any;
  assert.equal(isSuccessfulCompaction(event), true);
  assert.equal(isSuccessfulCompaction({ ...event, result: undefined }), false);
  assert.equal(isSuccessfulCompaction({ ...event, aborted: true }), false);
  assert.equal(isSuccessfulCompaction({ ...event, willRetry: true }), true);
});

test("parallel tool completion keeps the remaining tool activity", () => {
  const active = new Map<string, string>();
  assert.equal(
    updateToolActivity(active, {
      type: "start",
      toolId: "read-1",
      toolName: "read",
    }),
    "Using read",
  );
  assert.equal(
    updateToolActivity(active, {
      type: "start",
      toolId: "bash-1",
      toolName: "bash",
    }),
    "Using bash",
  );
  assert.equal(
    updateToolActivity(active, { type: "end", toolId: "bash-1" }),
    "Using read",
  );
  assert.equal(
    updateToolActivity(active, { type: "end", toolId: "read-1" }),
    "Working",
  );
});
