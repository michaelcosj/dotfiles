import { describe, expect, it } from "bun:test";
import { askQuestionnaire } from "../src/features/questionnaire/register.ts";

const question = {
  id: "q",
  prompt: "A question whose text wraps differently as the terminal width changes?",
  options: [{ value: "a", label: "A sufficiently descriptive answer" }],
};
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

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

  it("returns cancellation without opening when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let customCalls = 0;
    const result = await askQuestionnaire({
      mode: "tui",
      ui: { custom() { customCalls++; } },
    } as any, [question], controller.signal);

    expect(customCalls).toBe(0);
    expect(result.ok && result.result.cancelled).toBe(true);
  });

  it("closes exactly once on abort and cleans up on dispose", async () => {
    const controller = new AbortController();
    let component: any;
    let doneCalls = 0;
    const ctx = {
      mode: "tui",
      ui: {
        custom(factory: Function) {
          return new Promise((resolve) => {
            component = factory({ requestRender() {} }, theme, {}, (value: unknown) => {
              doneCalls++;
              resolve(value);
            });
          });
        },
      },
    } as any;
    const promise = askQuestionnaire(ctx, [question], controller.signal);
    controller.abort();
    controller.abort();
    const result = await promise;
    component.dispose();

    expect(doneCalls).toBe(1);
    expect(result.ok && result.result.cancelled).toBe(true);
  });

  it("recomputes rendered lines when width changes", () => {
    let component: any;
    const ctx = {
      mode: "tui",
      ui: {
        custom(factory: Function) {
          component = factory({ requestRender() {} }, theme, {}, () => {});
          return new Promise(() => {});
        },
      },
    } as any;
    void askQuestionnaire(ctx, [question]);

    const wide = component.render(60);
    const narrow = component.render(20);
    expect(wide).not.toBe(narrow);
    expect(Math.max(...narrow.map((line: string) => line.length))).toBeLessThanOrEqual(20);
    component.dispose();
  });
});
