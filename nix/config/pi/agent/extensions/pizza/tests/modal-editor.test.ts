import { describe, expect, it } from "bun:test";
import { ModalEditor } from "../src/features/pizza-ui/modal-editor.ts";

function createEditor() {
  let renders = 0;
  let hardwareCursor = false;
  const writes: string[] = [];
  const tui = {
    requestRender() {
      renders++;
    },
    getShowHardwareCursor: () => hardwareCursor,
    setShowHardwareCursor(value: boolean) {
      hardwareCursor = value;
    },
    terminal: {
      rows: 24,
      write(value: string) {
        writes.push(value);
      },
    },
  };
  const theme = {
    borderColor: (text: string) => text,
    selectList: {},
  };
  const keybindings = {
    matches(data: string, action: string) {
      return (
        (action === "app.interrupt" && data === "\x1b") ||
        (action === "app.clear" && data === "\x03")
      );
    },
  };
  const editor = new ModalEditor(tui as any, theme as any, keybindings as any);
  return {
    editor,
    getRenders: () => renders,
    getHardwareCursor: () => hardwareCursor,
    writes,
  };
}

describe("modal editor", () => {
  it("keeps Pi's block cursor in both modes", () => {
    const { editor } = createEditor();
    editor.focused = true;
    editor.setText("abc");

    expect(editor.render(40).join("\n")).toContain("\x1b[7m \x1b[0m");
    editor.handleInput("\x1b");
    expect(editor.render(40).join("\n")).toContain("\x1b[7m \x1b[0m");
  });

  it("starts in insert mode and suppresses printable input in normal mode", () => {
    const { editor, getRenders } = createEditor();
    editor.handleInput("hello");
    expect(editor.getText()).toBe("hello");
    expect(editor.getMode()).toBe("insert");

    editor.handleInput("\x1b");
    editor.handleInput("q");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("hello");
    expect(getRenders()).toBeGreaterThan(0);
  });

  it("supports normal-mode movement, deletion, insertion, and undo", () => {
    const { editor } = createEditor();
    editor.setText("abc def");
    editor.handleInput("\x1b");
    editor.handleInput("0");
    editor.handleInput("w");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });

    editor.handleInput("x");
    expect(editor.getText()).toBe("abc ef");
    editor.handleInput("u");
    expect(editor.getText()).toBe("abc def");

    editor.handleInput("I");
    editor.handleInput("> ");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("> abc def");
  });

  it("opens lines above and below", () => {
    const below = createEditor().editor;
    below.setText("abc");
    below.handleInput("\x1b");
    below.handleInput("o");
    below.handleInput("next");
    expect(below.getText()).toBe("abc\nnext");

    const above = createEditor().editor;
    above.setText("abc");
    above.handleInput("\x1b");
    above.handleInput("O");
    above.handleInput("prev");
    expect(above.getText()).toBe("prev\nabc");
  });

  it("preserves Pi application shortcuts and second-Escape interrupt", () => {
    const { editor } = createEditor();
    let interrupted = 0;
    let cleared = 0;
    editor.onEscape = () => interrupted++;
    editor.onAction("app.clear", () => cleared++);

    editor.handleInput("\x1b");
    editor.handleInput("\x03");
    editor.handleInput("\x1b");
    expect(cleared).toBe(1);
    expect(interrupted).toBe(1);
  });

  it("discards bracketed paste in normal mode before interpreting mappings", () => {
    const { editor } = createEditor();
    editor.setText("kept");
    editor.handleInput("\x1b");
    editor.handleInput("\x1b[200~i-am-not-a-mapping\x1b[201~");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("kept");
  });

  it("discards markers split at supported start/end boundaries", () => {
    const start = "\x1b[200~";
    const end = "\x1b[201~";
    const startSplits = [0, ...Array.from({ length: start.length - 1 }, (_, index) => index + 2)];
    const endSplits = Array.from({ length: end.length + 1 }, (_, index) => index);

    for (const startSplit of startSplits) {
      for (const endSplit of endSplits) {
        const { editor } = createEditor();
        let interrupted = 0;
        editor.onEscape = () => interrupted++;
        editor.setText("kept");
        editor.handleInput("\x1b");
        editor.handleInput(start.slice(0, startSplit));
        editor.handleInput(start.slice(startSplit));
        editor.handleInput("i");
        editor.handleInput("a");
        editor.handleInput("x");
        editor.handleInput(end.slice(0, endSplit));
        editor.handleInput(end.slice(endSplit));

        expect(editor.getMode()).toBe("normal");
        expect(editor.getText()).toBe("kept");
        expect(interrupted).toBe(0);
      }
    }
  });

  it("dispatches ordinary commands before and after a discarded paste separately", () => {
    const { editor } = createEditor();
    editor.setText("abc");
    editor.handleInput("\x1b");
    editor.handleInput("0");
    editor.handleInput("x\x1b[200~i-a-x\x1b[201~i");
    editor.handleInput("!");

    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("!bc");
  });

  it("preserves bracketed paste in insert mode", () => {
    const { editor } = createEditor();
    editor.handleInput("\x1b[200~inserted\x1b[201~");
    expect(editor.getText()).toBe("inserted");
  });
});
