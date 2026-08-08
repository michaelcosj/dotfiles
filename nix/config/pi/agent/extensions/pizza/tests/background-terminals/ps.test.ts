import assert from "node:assert/strict";
import { test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  reconcileDashboardSelection,
  terminalDetailActionHints,
  terminalDetailViewportRows,
  terminalPanelBorder,
  terminalStatusColor,
  wrapTerminalCommand,
  type DashboardSelection,
} from "../../src/features/background-terminals/ui/ps.ts";
import {
  buildOutputLines,
  createOutputLineCache,
  sanitizeText,
} from "../../src/features/background-terminals/ui/output-view.ts";

const theme = {
  fg: (_color: string, text: string) => text,
} as Theme;

test("terminal detail header color follows process status", () => {
  assert.equal(terminalStatusColor("running"), "warning");
  assert.equal(terminalStatusColor("done"), "success");
  assert.equal(terminalStatusColor("failed"), "error");
  assert.equal(terminalStatusColor("killed"), "muted");
});

test("terminal detail splits navigation and dynamic actions across its panel", () => {
  const rows = 40;
  // Header/output chrome plus a one-row command fills the terminal.
  assert.equal(5 + terminalDetailViewportRows(rows) + 1, rows);
  assert.equal(5 + terminalDetailViewportRows(rows, 4) + 4, rows);

  const command = wrapTerminalCommand(
    "status=0; prettier --check .; tsc --noEmit; node --test",
    24,
  );
  assert.ok(command.length > 1);
  assert.match(command[0], /^\$ /);
  assert.ok(command.slice(1).every((line) => line.startsWith("  ")));
  assert.ok(command.every((line) => visibleWidth(line) <= 22));

  const top = terminalPanelBorder(
    100,
    "[stdout 0 B] · stderr 0 B",
    "up/down/jk scroll · pageUp/pageDown page · g/G ends",
    "top",
    theme,
  );
  assert.equal(visibleWidth(top), 100);
  assert.match(top, /^╭─ \[stdout 0 B\]/);
  assert.match(top, /g\/G ends ─╮$/);

  const running = terminalDetailActionHints("running");
  assert.deepEqual(running, {
    left: "esc back",
    right: "t switch stream · x kill",
  });
  assert.equal(terminalDetailActionHints("done").right, "t switch stream");

  const bottom = terminalPanelBorder(
    80,
    running.left,
    running.right,
    "bottom",
    theme,
  );
  assert.equal(visibleWidth(bottom), 80);
  assert.match(bottom, /^╰─ esc back/);
  assert.match(bottom, /t switch stream · x kill ─╯$/);
});

test("dashboard selection follows its terminal id and falls back by row", () => {
  const selection: DashboardSelection = { id: "bt-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "bt-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `bt-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "bt-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `bt-${index + 1}` })),
    { id: "bt-8" },
    { id: "bt-9" },
  ]);
  assert.deepEqual(selection, { id: "bt-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "bt-1" }, { id: "bt-2" }]);
  assert.deepEqual(selection, { id: "bt-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});

test("sanitizeText strips ANSI, tabs, and control characters", () => {
  assert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
  assert.equal(sanitizeText("\u001b[12345Cshifted"), "shifted");
  assert.equal(sanitizeText("\u001b]0;window title\u0007output"), "output");
  assert.equal(
    sanitizeText("\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\"),
    "link",
  );
  assert.equal(sanitizeText("\u001b]0;title\u009coutput"), "output");
  assert.equal(sanitizeText("\u009d0;title\u0007output"), "output");
  assert.equal(sanitizeText("a\u0085b"), "ab");
  assert.equal(sanitizeText("a\tb"), "a  b");
  assert.equal(sanitizeText("a\u0007b\u0000c"), "abc");
});

test("output line cache reuses a version/width key and invalidates either dimension", () => {
  const cache = createOutputLineCache();
  const first = cache.get("first", 1, 80);
  const sameKey = cache.get("different text is intentionally ignored", 1, 80);
  assert.equal(sameKey, first);
  assert.deepEqual(sameKey, ["first"]);

  const newVersion = cache.get("second", 2, 80);
  assert.notEqual(newVersion, first);
  assert.deepEqual(newVersion, ["second"]);

  const newWidth = cache.get("x".repeat(25), 2, 10);
  assert.notEqual(newWidth, newVersion);
  assert.ok(newWidth.length > 1);
});

test("buildOutputLines wraps long lines and keeps only the final CR segment", () => {
  const lines = buildOutputLines("progress 1\rprogress 2\rdone\nnext", 80);
  assert.deepEqual(lines, ["done", "next"]);
  assert.deepEqual(buildOutputLines("progress 1\rprogress 2\r", 80), [
    "progress 2",
  ]);

  const wrapped = buildOutputLines("x".repeat(25), 10);
  assert.ok(wrapped.length > 1);
  assert.equal(wrapped.join(""), "x".repeat(25));
});

test("buildOutputLines drops one trailing empty line from a trailing newline", () => {
  assert.deepEqual(buildOutputLines("a\nb\n", 80), ["a", "b"]);
  assert.deepEqual(buildOutputLines("a\n\n", 80), ["a", ""]);
});
