import { describe, expect, it } from "bun:test";
import { RECALL_NOTE, compile } from "../vcc-core.ts";

describe("vcc compile", () => {
  it("produces deterministic summary with recall note", () => {
    const messages = [
      { role: "user", content: "Implement login endpoint and tests" },
      { role: "assistant", content: [{ type: "text", text: "I will update auth module" }] },
      { role: "user", content: "Prefer concise output and no emoji." },
    ] as any;

    const out = compile({ messages });

    expect(out).toContain("[Session Goal]");
    expect(out).toContain("[User Preferences]");
    expect(out).toContain(RECALL_NOTE);
  });

  it("merges previous files-and-changes with fresh summary", () => {
    const previous = [
      "[Files And Changes]",
      "- Modified: src/a.ts",
      "",
      "---",
      "",
      "[assistant]",
      "* Edit \"src/a.ts\"",
      "",
      "---",
      "",
      RECALL_NOTE,
    ].join("\n");

    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "Edit",
            arguments: { path: "src/b.ts" },
          },
        ],
      },
      { role: "user", content: "continue" },
    ] as any;

    const out = compile({ messages, previousSummary: previous });

    expect(out).toContain("src/a.ts");
    expect(out).toContain("src/b.ts");
    expect(out).toContain(RECALL_NOTE);
  });
});
