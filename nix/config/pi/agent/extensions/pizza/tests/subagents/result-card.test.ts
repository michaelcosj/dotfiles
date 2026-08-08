import assert from "node:assert/strict";
import { test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  formatAgentMetrics,
  oneLineSummary,
  resultCardText,
} from "../../src/features/subagents/ui/result-card.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

test("summary and telemetry helpers sanitize and tolerate changing data", () => {
  assert.equal(
    oneLineSummary("\u001b[31mfirst\u001b[0m\n second"),
    "first second",
  );
  assert.equal(
    formatAgentMetrics({
      modelLabel: "claude",
      turns: Number.NaN,
      tokens: 12_500,
      contextWindow: undefined,
      elapsed: "4s",
    }),
    "claude · 13k tokens · 4s",
  );
});

test("result card is summarized when collapsed and shows bounded content when expanded", () => {
  const content =
    "Subagent sub-1 done.\nSession: /tmp/child.jsonl\n\nline one\nline two";
  const details = {
    id: "sub-1",
    title: "research",
    status: "done",
    summary: "line one",
    modelLabel: "claude",
    turns: 2,
    tokens: 1_250,
    elapsed: "3s",
  };
  const collapsed = resultCardText(details, content, false, theme);
  assert.match(collapsed, /^✓ subagent sub-1 · research/m);
  assert.match(collapsed, /done · claude · ↻2 · 1\.3k tokens · 3s/);
  assert.match(collapsed, /line one/);
  assert.doesNotMatch(collapsed, /line two/);
  assert.match(collapsed, /ctrl\+o to expand/);

  const expanded = resultCardText(details, content, true, theme);
  assert.match(expanded, /Subagent sub-1 done\./);
  assert.match(expanded, /line one\nline two$/);
});
