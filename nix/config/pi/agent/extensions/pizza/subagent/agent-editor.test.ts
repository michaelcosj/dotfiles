import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SubagentSnapshot } from "./src/domain.ts";
import type { SubagentReadModel } from "./src/manager.ts";
import { installSubagentEditorNavigation } from "./src/ui/agent-editor.ts";

function snapshot(
  id: string,
  title: string,
  launchOrder: number,
): SubagentSnapshot {
  return {
    id,
    title,
    launchOrder,
    origin: "model",
    backend: "pi",
    prompt: "go",
    cwd: "/tmp",
    status: "running",
    createdAt: 1_000 + launchOrder,
    meta: { backend: "pi", sessionFilePath: `/tmp/${id}.jsonl` },
    usage: {},
    transcript: [],
    liveTools: [],
    queued: [],
    finalText: "",
    turns: 0,
    toolUseCount: 0,
    compactionCount: 0,
  };
}

function harness(snapshots: SubagentSnapshot[], rows = 24) {
  let current = [...snapshots];
  const listeners = new Set<() => void>();
  const view: SubagentReadModel = {
    list: () => [...current],
    get: (id) => current.find((item) => item.id === id),
    size: () => current.length,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeTo: () => () => {},
    requestSend: async () => {},
    requestAbort: async () => {},
  };
  let editorFactory: any;
  const widgets = new Map<string, any>();
  const base: EditorComponent & {
    focused: boolean;
    history: string[];
    inputs: string[];
  } = {
    focused: false,
    history: [],
    inputs: [],
    onSubmit: undefined,
    onChange: undefined,
    getText: () => text,
    setText: (value) => {
      text = value;
    },
    addToHistory(value) {
      this.history.push(value);
    },
    handleInput(data) {
      this.inputs.push(data);
    },
    render: () => ["editor"],
    invalidate() {},
  };
  let text = "";
  const previousFactory = () => base;
  editorFactory = previousFactory;
  const ui: any = {
    getEditorComponent: () => editorFactory,
    setEditorComponent: (factory: unknown) => {
      editorFactory = factory;
    },
    setWidget: (key: string, factory: unknown) => {
      if (factory === undefined) widgets.delete(key);
      else widgets.set(key, factory);
    },
  };
  const theme: any = {
    fg: (_color: string, value: string) => value,
  };
  const tui = {
    terminal: { rows },
    requestRender() {},
  } as unknown as TUI;
  const keybindings: any = {
    matches(data: string, binding: string) {
      return (
        (binding === "tui.select.up" && data === "\x1b[A") ||
        (binding === "tui.select.down" && data === "\x1b[B") ||
        (binding === "tui.select.confirm" && data === "\r") ||
        (binding === "tui.select.cancel" && data === "\x1b")
      );
    },
  };
  const opened: string[] = [];
  const installed = installSubagentEditorNavigation(
    { mode: "tui", ui } as ExtensionContext,
    view,
    {
      onOpen: (item) => {
        opened.push(item.id);
      },
      maxVisibleRows: 3,
    },
  );
  const editor = editorFactory(tui, {} as EditorTheme, keybindings);
  const widgetFactory = widgets.get("subagent-editor-list");
  const widget = widgetFactory(tui, theme);
  return {
    base,
    editor,
    widget,
    opened,
    installed,
    setText(value: string) {
      text = value;
    },
    setSnapshots(value: SubagentSnapshot[]) {
      current = [...value];
      for (const listener of listeners) listener();
    },
  };
}

test("composes the existing editor and only enters rows from an empty prompt", () => {
  const h = harness([
    snapshot("second", "Second", 2),
    snapshot("first", "First", 1),
  ]);
  h.setText("typed prompt");
  h.editor.handleInput("\x1b[B");
  assert.deepEqual(h.base.inputs, ["\x1b[B"]);
  assert.equal(h.editor.getText(), "typed prompt");

  h.setText("");
  h.editor.handleInput("\x1b[D");
  assert.match(h.widget.render(80)[3], /⏺ First/);
  h.editor.handleInput("\x1b[B");
  assert.match(h.widget.render(80)[4], /⏺ Second/);
  h.editor.handleInput("\r");
  assert.deepEqual(h.opened, ["second"]);
  assert.match(h.widget.render(80)[2], /⏺ main/);
  assert.match(h.widget.render(80)[3], /◯ First/);
});

test("completed agents disappear from the editor list", () => {
  const running = snapshot("one", "One", 1);
  const h = harness([running]);
  assert.match(h.widget.render(80).join("\n"), /One/);
  h.setSnapshots([{ ...running, status: "done", settledAt: Date.now() }]);
  assert.deepEqual(h.widget.render(80), []);
});

test("up above the first row and escape restore the editor without replacing it", () => {
  const h = harness([snapshot("one", "One", 1)]);
  h.editor.focused = true;
  assert.equal(h.base.focused, true);

  h.editor.handleInput("\x1b[B");
  h.editor.handleInput("\x1b[A");
  h.editor.handleInput("x");
  assert.deepEqual(h.base.inputs, ["x"]);

  h.editor.handleInput("\x1b[B");
  h.editor.handleInput("\x1b");
  h.editor.addToHistory?.("kept history");
  assert.deepEqual(h.base.history, ["kept history"]);
});

test("orders by launch order, truncates to width, and reports hidden rows", () => {
  const h = harness([
    snapshot("three", "A very long third title", 3),
    snapshot("one", "First", 1),
    snapshot("two", "Second", 2),
    snapshot("four", "Fourth", 4),
  ]);
  const lines = h.widget.render(16);
  assert.equal(lines.length, 7);
  assert.equal(lines[0], "");
  assert.equal(lines.at(-1), "");
  assert.match(lines[2], /⏺ main/);
  assert.match(lines[3], /First/);
  assert.match(lines[4], /Second/);
  assert.equal(lines[5], "  ↓ 2 more");
  assert.ok(lines.every((line: string) => visibleWidth(line) <= 16));

  h.editor.handleInput("\x1b[B");
  h.editor.handleInput("\x1b[B");
  h.editor.handleInput("\x1b[B");
  const scrolled = h.widget.render(80);
  assert.match(scrolled[4], /⏺ A very long third title/);
  assert.equal(scrolled[5], "  ↓ 1 more");
});
