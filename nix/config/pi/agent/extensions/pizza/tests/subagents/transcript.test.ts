import assert from "node:assert/strict";
import { test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildTranscriptLines, sanitizeText } from "../../src/features/subagents/ui/transcript.ts";
test("transcript text strips ANSI/control characters and expands tabs", () => {
  const text = sanitizeText("\u001b[31mred\u001b[0m\tvalue\u0000");
  assert.equal(text, "red  value");
});

test("transcript lines obey narrow renderer widths, including more-lines markers", () => {
  const snapshot: any = {
    transcript: [
      {
        kind: "toolResult",
        outputPreview: Array.from(
          { length: 12 },
          (_, index) => `long output line ${index}`,
        ).join("\n"),
        isError: false,
      },
    ],
    liveTools: [],
    queued: [],
  };
  const theme: any = {
    fg: (_color: string, text: string) => text,
    italic: (text: string) => text,
  };

  for (const width of [0, 1, 2, 5, 10]) {
    const lines = buildTranscriptLines(snapshot, width, theme);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
});
