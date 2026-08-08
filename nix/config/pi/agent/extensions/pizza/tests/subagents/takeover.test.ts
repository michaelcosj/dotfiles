import assert from "node:assert/strict";
import { test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  inputHintBorder,
  inputNavigationBorder,
  reconcileDashboardSelection,
  subagentStatusColor,
  takeoverInputLine,
  takeoverTranscriptRows,
  type DashboardSelection,
} from "../../src/features/subagents/ui/takeover.ts";

const theme = {
  fg: (_color: string, text: string) => text,
} as Theme;

test("takeover header color follows subagent status", () => {
  assert.equal(subagentStatusColor("running"), "warning");
  assert.equal(subagentStatusColor("done"), "success");
  assert.equal(subagentStatusColor("error"), "error");
  assert.equal(subagentStatusColor("cancelled"), "muted");
});

test("takeover input reserves a spacer and embeds controls in its border", () => {
  const terminalRows = 40;
  const inputRows = 1;
  const transcriptRows = takeoverTranscriptRows(terminalRows, inputRows);
  // 3 header + transcript + 1 spacer + 2 input chrome + input rows.
  assert.equal(3 + transcriptRows + 1 + 2 + inputRows, terminalRows);

  const top = inputNavigationBorder(
    64,
    "up/down scroll · pageUp/pageDown page",
    theme,
  );
  assert.equal(visibleWidth(top), 64);
  assert.match(top, /^╭─+/);
  assert.match(top, /up\/down scroll · pageUp\/pageDown page ─╮$/);

  const bottom = inputHintBorder(32, "enter send · escape back", theme);
  assert.equal(visibleWidth(bottom), 32);
  assert.match(bottom, /^╰─ enter send · escape back/);
  assert.match(bottom, /╯$/);

  const input = takeoverInputLine(16, "> hello       ", theme);
  assert.equal(visibleWidth(input), 16);
  assert.match(input, /^│ hello/);
  assert.doesNotMatch(input, />/);
  assert.match(input, / │$/);
});

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});
