import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Resolve Pi's packages from the installed Pi, since this repo has no node_modules.
const PI_MODULES =
  process.env.PI_NODE_MODULES ??
  path.join(path.dirname(fs.realpathSync(execFileSync("which", ["pi"]).toString().trim())), "../lib/node_modules/pi-monorepo/node_modules");
for (const id of ["typebox"]) {
  const mod = await import(Bun.resolveSync(id, path.dirname(PI_MODULES)));
  mock.module(id, () => mod);
}

const { clipSelection, contextText } = await import("./editor.ts");

describe("contextText", () => {
  test("names the open file, without cursor or scroll position", () => {
    const a = contextText({ file: "nix/README.md", line: 1, visible: [1, 74] });
    expect(a).toBe("The user has nix/README.md open in Neovim.\nThis may or may not be related to their request.");
    // moving the cursor or scrolling gives the same text, so it is not sent again
    expect(contextText({ file: "nix/README.md", line: 40, visible: [20, 90] })).toBe(a);
  });

  test("says when the buffer has unsaved changes", () => {
    expect(contextText({ file: "a.ts", modified: true })).toStartWith("The user has a.ts (unsaved changes) open in Neovim.");
  });

  test("includes a selection with its text", () => {
    expect(contextText({ file: "a.ts", filetype: "typescript", selection: { first: 3, last: 4, text: "x\ny" } })).toBe(
      "The user selected lines 3-4 of a.ts in Neovim:\n```typescript\nx\ny\n```\nThis may or may not be related to their request.",
    );
    expect(contextText({ file: "a.ts", selection: { first: 7, last: 7 } })).toStartWith("The user selected line 7 of a.ts in Neovim.\n");
  });

  test("nothing without a file", () => {
    expect(contextText({})).toBeUndefined();
  });
});

describe("clipSelection", () => {
  test("leaves short text alone", () => {
    expect(clipSelection("a\nb", 10)).toBe("a\nb");
  });

  test("cuts at a line break and says how much is left out", () => {
    expect(clipSelection("aaaa\nbbbb\ncccc\ndddd", 12)).toBe("aaaa\nbbbb\n… (2 more lines)");
    expect(clipSelection("aaaa\nbbbb\ncccc", 12)).toBe("aaaa\nbbbb\n… (1 more line)");
  });

  test("cuts a single long line where it must", () => {
    expect(clipSelection("x".repeat(20), 8)).toBe(`${"x".repeat(8)}\n… (1 more line)`);
  });
});
