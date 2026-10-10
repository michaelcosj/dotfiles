import { describe, expect, test } from "bun:test";
import plugin from "./empty-enter.js";

function fixture() {
  const calls = [];
  const editor = {
    focused: true,
    isDestroyed: false,
    traits: { owner: "opencode", role: "prompt", capture: ["tab"] },
    plainText: "",
    insertText(text) {
      this.plainText += text;
      calls.push(["insert", text]);
    },
  };
  let command;
  const ctx = {
    renderer: { currentFocusedEditor: editor },
    ui: { router: { current: () => ({ type: "session", sessionID: "existing" }) } },
    data: {
      session: {
        status: () => "idle",
        message: { list: () => [{ id: "message" }] },
      },
    },
    keymap: {
      layer: (layer) => { command = layer().commands[0]; },
      dispatch: (id) => { calls.push(["dispatch", id]); },
    },
  };
  plugin.setup(ctx);
  return { ctx, editor, calls, command };
}

describe("empty Enter", () => {
  test("inserts Continue before native submission, consuming Enter only once", () => {
    const f = fixture();
    expect(f.command.run()).toBeUndefined();
    expect(f.calls).toEqual([["insert", "Continue"], ["dispatch", "prompt.submit"]]);
    expect(f.command.run()).toBe(false);
    expect(f.calls).toHaveLength(2);
  });

  for (const messages of [[], undefined]) {
    test(`does not continue an empty or unloaded session (${messages})`, () => {
      const f = fixture();
      f.ctx.data.session.message.list = () => messages;
      expect(f.command.run()).toBe(false);
      expect(f.calls).toEqual([]);
    });
  }

  for (const text of ["A real prompt", " ", "\n"]) {
    test(`leaves existing input untouched (${JSON.stringify(text)})`, () => {
      const f = fixture();
      f.editor.plainText = text;
      expect(f.command.run()).toBe(false);
      expect(f.editor.plainText).toBe(text);
      expect(f.calls).toEqual([]);
    });
  }

  for (const traits of [
    undefined,
    { owner: "other", role: "prompt" },
    { owner: "opencode", role: "dialog" },
    { owner: "opencode", role: "prompt", status: "SHELL" },
    { owner: "opencode", role: "prompt", capture: ["submit"] },
    { owner: "opencode", role: "prompt", suspend: true },
  ]) {
    test(`falls through outside normal composer input (${JSON.stringify(traits)})`, () => {
      const f = fixture();
      f.editor.traits = traits;
      expect(f.command.run()).toBe(false);
      expect(f.calls).toEqual([]);
    });
  }

  test("does not run on home or while the session is running", () => {
    const f = fixture();
    f.ctx.data.session.status = () => "running";
    expect(f.command.run()).toBe(false);
    f.ctx.ui.router.current = () => ({ type: "home" });
    expect(f.command.run()).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("does not mutate missing, blurred, or destroyed editors", () => {
    const f = fixture();
    f.editor.focused = false;
    expect(f.command.run()).toBe(false);
    f.editor.focused = true;
    f.editor.isDestroyed = true;
    expect(f.command.run()).toBe(false);
    f.ctx.renderer.currentFocusedEditor = null;
    expect(f.command.run()).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
