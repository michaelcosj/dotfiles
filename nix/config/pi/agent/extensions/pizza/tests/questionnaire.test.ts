import { describe, expect, it } from "bun:test";
import { askQuestionnaire } from "../questionnaire.ts";

describe("questionnaire", () => {
  it("rejects RPC mode without opening a custom TUI", async () => {
    let customCalls = 0;
    const result = await askQuestionnaire(
      {
        mode: "rpc",
        hasUI: true,
        ui: {
          custom() {
            customCalls++;
            return undefined;
          },
        },
      } as any,
      [{ id: "confirm", prompt: "Continue?", options: [{ value: "yes", label: "Yes" }] }],
    );

    expect(result).toEqual({ ok: false, error: "Error: questionnaire requires interactive TUI mode" });
    expect(customCalls).toBe(0);
  });

  it("rejects duplicate question IDs", async () => {
    let customCalls = 0;
    const result = await askQuestionnaire(
      {
        mode: "tui",
        hasUI: true,
        ui: { custom() { customCalls++; } },
      } as any,
      [
        { id: "same", prompt: "First?", options: [{ value: "yes", label: "Yes" }] },
        { id: " same ", prompt: "Second?", options: [{ value: "no", label: "No" }] },
      ],
    );

    expect(result).toEqual({ ok: false, error: 'Error: Duplicate question id "same"' });
    expect(customCalls).toBe(0);
  });
});
