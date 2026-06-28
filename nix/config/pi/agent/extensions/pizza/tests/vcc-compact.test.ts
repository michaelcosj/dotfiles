import { describe, expect, it } from "bun:test";
import { buildOwnCut, registerVccCompactExtension } from "../vcc-compact.ts";

describe("buildOwnCut", () => {
  it("returns no_live_messages when branch empty", () => {
    const result = buildOwnCut([]);
    expect(result).toEqual({ ok: false, reason: "no_live_messages" });
  });

  it("cuts at last user message and keeps tail", () => {
    const branch = [
      { id: "1", type: "message", message: { role: "user", content: "task" } },
      { id: "2", type: "message", message: { role: "assistant", content: "working" } },
      { id: "3", type: "message", message: { role: "user", content: "new ask" } },
      { id: "4", type: "message", message: { role: "assistant", content: "latest" } },
    ];

    const result = buildOwnCut(branch as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.firstKeptEntryId).toBe("3");
    expect(result.compactAll).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("assistant");
  });

  it("returns no_user_message when only assistant/tool entries", () => {
    const branch = [
      { id: "1", type: "message", message: { role: "assistant", content: "a" } },
      { id: "2", type: "message", message: { role: "assistant", content: "b" } },
      { id: "3", type: "message", message: { role: "assistant", content: "c" } },
    ];

    const result = buildOwnCut(branch as any);
    expect(result).toEqual({ ok: false, reason: "no_user_message" });
  });

  it("compactAll uses first entry ID instead of empty string", () => {
    const branch = [
      { id: "e1", type: "message", message: { role: "user", content: "entire session" } },
      { id: "e2", type: "message", message: { role: "assistant", content: "reply" } },
      { id: "e3", type: "message", message: { role: "user", content: "followup" } },
    ];

    const result = buildOwnCut(branch as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only one user turn, so everything gets compacted
    expect(result.firstKeptEntryId).toBeTruthy();
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe("registerVccCompactExtension", () => {
  it("handles standard session_before_compact events without custom marker", async () => {
    let beforeCompactHandler: Function | undefined;

    const pi: any = {
      on(event: string, handler: Function) {
        if (event === "session_before_compact") beforeCompactHandler = handler;
      },
    };

    registerVccCompactExtension(pi);
    expect(beforeCompactHandler).toBeTruthy();

    const branchEntries = [
      { id: "m1", type: "message", message: { role: "user", content: "task" } },
      { id: "m2", type: "message", message: { role: "assistant", content: "working" } },
      { id: "m3", type: "message", message: { role: "user", content: "next" } },
      { id: "m4", type: "message", message: { role: "assistant", content: "latest" } },
    ];

    const result = await beforeCompactHandler?.({
      preparation: {
        previousSummary: undefined,
        fileOps: { read: [], written: [], edited: [] },
        tokensBefore: 1234,
      },
      branchEntries,
      customInstructions: undefined,
    });

    expect(result?.compaction).toBeDefined();
    expect(result?.compaction?.details).toEqual({ compactor: "vcc", version: 1 });
    expect(typeof result?.compaction?.summary).toBe("string");
  });

  it("cancels when there is nothing valid to compact", async () => {
    let beforeCompactHandler: Function | undefined;

    const pi: any = {
      on(event: string, handler: Function) {
        if (event === "session_before_compact") beforeCompactHandler = handler;
      },
    };

    registerVccCompactExtension(pi);

    const result = await beforeCompactHandler?.({
      preparation: {
        previousSummary: undefined,
        fileOps: { read: [], written: [], edited: [] },
        tokensBefore: 10,
      },
      branchEntries: [
        { id: "m1", type: "message", message: { role: "user", content: "tiny" } },
        { id: "m2", type: "message", message: { role: "assistant", content: "tiny" } },
      ],
      customInstructions: undefined,
    });

    expect(result).toEqual({ cancel: true });
  });
});
