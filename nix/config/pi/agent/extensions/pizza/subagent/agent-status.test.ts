import assert from "node:assert/strict";
import test from "node:test";
import {
  contextColor,
  formatActivitySummary,
  formatAgentState,
  formatAgentStatusFacts,
  formatCompactions,
  formatElapsedTime,
  formatStateGlyph,
  formatStateLabel,
  formatTokenStatus,
  formatToolUses,
  formatTurns,
  type StatusTheme,
} from "./src/ui/agent-status.ts";

const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as StatusTheme;

test("formats turns, tools, compactions, and elapsed time", () => {
  assert.equal(formatTurns(1), "↻1");
  assert.equal(formatTurns(4, 10), "↻4 ≤10");
  assert.equal(formatToolUses(1), "1 tool use");
  assert.equal(formatToolUses(3), "3 tool uses");
  assert.equal(formatCompactions(0), "");
  assert.equal(formatCompactions(2), "⇊2");
  assert.equal(formatElapsedTime(999), "0s");
  assert.equal(formatElapsedTime(125_000), "2m05s");
  assert.equal(formatElapsedTime(3_720_000), "1h02m");
});

test("formats actual tokens and colors optional context percentage", () => {
  assert.equal(
    formatTokenStatus({ tokens: 12_345, contextWindow: 20_000 }),
    "12k tokens (62%)",
  );
  assert.equal(
    formatTokenStatus({ tokens: 7_000, contextWindow: 10_000 }, theme),
    "7.0k tokens (<warning>70%</warning>)",
  );
  assert.equal(
    formatTokenStatus({ tokens: 8_499, contextWindow: 10_000 }, theme),
    "8.5k tokens (<warning>85%</warning>)",
  );
  assert.equal(
    formatTokenStatus({ tokens: 8_500, contextWindow: 10_000 }, theme),
    "8.5k tokens (<error>85%</error>)",
  );
  assert.equal(
    formatTokenStatus({
      tokens: 500,
      contextWindow: 1_000,
      showPercent: false,
    }),
    "500 tokens",
  );
  assert.equal(contextColor(69), "dim");
  assert.equal(contextColor(70), "warning");
  assert.equal(contextColor(84), "warning");
  assert.equal(contextColor(85), "error");
});

test("renders state presentation independently of domain and UI classes", () => {
  assert.equal(formatStateGlyph("done"), "✓");
  assert.equal(formatStateLabel("error"), "failed");
  assert.equal(
    formatAgentState("running", theme),
    "<warning>●</warning> <warning>running</warning>",
  );
});

test("summarizes deterministic current and recent activity", () => {
  assert.equal(
    formatActivitySummary({
      status: "running",
      currentTool: "read",
      detail: "src/index.ts",
      currentToolStartedAt: 8_000,
      now: 10_500,
    }),
    "read(src/index.ts) | 2s",
  );
  assert.equal(
    formatActivitySummary({ lastActivityAt: 8_000, now: 10_500 }),
    "active 2s ago",
  );
  assert.equal(
    formatActivitySummary({ activityState: "needs_attention" }),
    "needs attention",
  );
  assert.equal(formatActivitySummary({ status: "running" }), "thinking…");
  assert.equal(formatActivitySummary({ status: "done" }), "");
});

test("joins status facts for snapshot renderers", () => {
  assert.equal(
    formatAgentStatusFacts({
      turns: 4,
      turnLimit: 10,
      toolUses: 3,
      tokens: 7_000,
      contextWindow: 10_000,
      compactions: 2,
      elapsedMs: 125_000,
    }),
    "↻4 ≤10 · 3 tool uses · 7.0k tokens (70%) · ⇊2 · 2m05s",
  );
});
