import assert from "node:assert/strict";
import { test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  startCallText,
  startResultText,
  terminalResultText,
  waitCallText,
  waitResultText,
  type WaitToolDetails,
} from "../../src/features/background-terminals/ui/tool-renderers.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const running = {
  id: "bt-1",
  title: "dev server",
  status: "running" as const,
  pid: 123,
  elapsedMs: 12_000,
  stdoutBytes: 512,
  stderrBytes: 0,
  summary: "listening on :3000",
};

function waitDetails(
  overrides: Partial<WaitToolDetails> = {},
): WaitToolDetails {
  return {
    terminal: running,
    completed: false,
    timeoutMs: 30_000,
    timeoutRemainingMs: 18_000,
    ...overrides,
  };
}

test("bg_start matches the compact background-task renderer", () => {
  assert.equal(
    startCallText({ title: "dev server", command: "npm run dev" }, theme),
    "● bg_start(dev server)  npm run dev",
  );
  assert.equal(
    startResultText({ details: { id: "bt-1", status: "running" } }, theme),
    "└─ Running in background (ID: bt-1)",
  );
});

test("bg_wait call and live result show the configured timeout", () => {
  assert.equal(
    waitCallText("bt-1", 30_000, theme),
    "bg_wait 1 terminal · timeout 30s (bt-1)",
  );
  const partial = waitResultText(
    { details: waitDetails() },
    { expanded: false, isPartial: true },
    theme,
  );
  assert.match(partial, /^Terminals\n└─ ● dev server/);
  assert.match(partial, /timeout in 18s/);
});

test("bg_wait completion removes the timeout countdown", () => {
  const completed = waitResultText(
    {
      content: [{ type: "text", text: "full output" }],
      details: waitDetails({
        terminal: {
          ...running,
          status: "done",
          exit: "exit 0",
          elapsedMs: 18_000,
        },
        completed: true,
        timeoutRemainingMs: undefined,
      }),
    },
    { expanded: false, isPartial: false },
    theme,
  );
  assert.match(completed, /└─ ✓ dev server · done · exit 0 · 18s/);
  assert.doesNotMatch(completed, /timeout in|Timed out/);
  assert.match(completed, /ctrl\+o to expand outputs/);
});

test("bg_wait timeout says the terminal is still running", () => {
  const timedOut = waitResultText(
    {
      content: [{ type: "text", text: "full output" }],
      details: waitDetails({ timeoutRemainingMs: 0 }),
    },
    { expanded: false, isPartial: false },
    theme,
  );
  assert.match(timedOut, /Timed out after 30s; terminal still running/);

  const expanded = waitResultText(
    {
      content: [{ type: "text", text: "full output" }],
      details: waitDetails({ timeoutRemainingMs: 0 }),
    },
    { expanded: true, isPartial: false },
    theme,
  );
  assert.match(expanded, /Outputs\nfull output$/);
});

test("status/list-style results stay compact until expanded", () => {
  const result = {
    content: [{ type: "text" as const, text: "raw stdout and stderr" }],
    details: { terminal: running },
  };
  const collapsed = terminalResultText(
    result,
    { expanded: false },
    theme,
    "terminal",
  );
  assert.match(collapsed, /listening on :3000/);
  assert.doesNotMatch(collapsed, /raw stdout/);

  const expanded = terminalResultText(
    result,
    { expanded: true },
    theme,
    "terminal",
  );
  assert.match(expanded, /Outputs\nraw stdout and stderr$/);
});
