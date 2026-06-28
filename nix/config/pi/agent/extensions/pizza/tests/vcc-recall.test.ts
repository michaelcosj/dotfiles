import { describe, expect, it } from "bun:test";
import { searchEntries, type RenderedEntry } from "../vcc-recall.ts";

describe("searchEntries", () => {
  it("ranks semantic multi-term hits higher", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "assistant", summary: "fixed auth bug and added retry" },
      { index: 1, role: "assistant", summary: "fixed auth" },
      { index: 2, role: "user", summary: "ui polish" },
    ];

    const messages = entries.map((e) => ({ role: e.role, content: e.summary })) as any;
    const hits = searchEntries(entries, messages, "auth bug");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].index).toBe(0);
  });

  it("supports regex query", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "tool_result", summary: "build passed" },
      { index: 1, role: "tool_result", summary: "build failed at test step" },
    ];

    const messages = entries.map((e) => ({ role: "assistant", content: e.summary })) as any;
    const hits = searchEntries(entries, messages, "fail.*test");

    expect(hits).toHaveLength(1);
    expect(hits[0].index).toBe(1);
  });
});
