import { describe, expect, test } from "bun:test";
import { deliverNote, deliverReview } from "./notes.ts";

describe("deliverNote", () => {
  test("starts a turn or queues a follow-up, hidden from the transcript", () => {
    const calls: any[] = [];
    const pi = { sendMessage: (...args: any[]) => calls.push(args) };
    deliverNote(pi, "The user rejected your changes to a.ts.");
    expect(calls).toEqual([
      [
        { customType: "editor-context", content: "The user rejected your changes to a.ts.", display: false },
        { triggerTurn: true, deliverAs: "followUp" },
      ],
    ]);
  });

  test("does not throw when the session rejects the message", () => {
    const pi = {
      sendMessage: () => {
        throw new Error("shutting down");
      },
    };
    expect(() => deliverNote(pi, "note")).not.toThrow();
  });
});

describe("deliverReview", () => {
  test("a visible user message, steered into a running turn", () => {
    const calls: any[] = [];
    const pi = { sendUserMessage: (...args: any[]) => calls.push(args) };
    deliverReview(pi, "Review comments", true);
    deliverReview(pi, "More comments", false);
    expect(calls).toEqual([["Review comments"], ["More comments", { deliverAs: "steer" }]]);
  });
});
