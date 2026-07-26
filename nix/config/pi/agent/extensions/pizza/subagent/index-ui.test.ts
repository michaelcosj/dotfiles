import assert from "node:assert/strict";
import test from "node:test";
import subagentExtension from "./index.ts";

function harness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, any>();
  const widgets = new Map<string, unknown>();
  const editor = (kind: string) => ({
    getText: () => kind,
    setText() {},
    handleInput() {},
    render: () => [kind],
    invalidate() {},
  });
  const defaultFactory = () => editor("default");
  const pizzaFactory = () => editor("pizza");
  let editorFactory: unknown = defaultFactory;
  const ui = {
    setStatus() {},
    notify() {},
    getEditorComponent: () => editorFactory,
    setEditorComponent(factory: unknown) {
      editorFactory = factory;
    },
    setWidget(key: string, factory: unknown) {
      if (factory === undefined) widgets.delete(key);
      else widgets.set(key, factory);
    },
  };
  const ctx: any = {
    mode: "tui",
    hasUI: true,
    ui,
    cwd: "/tmp",
    isIdle: () => true,
  };
  const pi: any = {
    on(event: string, handler: (...args: any[]) => any) {
      handlers.set(event, handler);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerEntryRenderer() {},
    registerMessageRenderer() {},
    registerCommand() {},
  };
  subagentExtension(pi);
  return {
    ctx,
    handlers,
    tools,
    widgets,
    pizzaFactory,
    getEditorFactory: () => editorFactory,
    setPizzaEditor: () => {
      editorFactory = pizzaFactory;
    },
  };
}

for (const order of ["subagent-first", "pizza-first"] as const) {
  test(`startup wraps Pizza when ${order}`, () => {
    const h = harness();
    if (order === "pizza-first") h.setPizzaEditor();
    h.handlers.get("session_start")?.({}, h.ctx);
    if (order === "subagent-first") h.setPizzaEditor();

    assert.equal(h.getEditorFactory(), h.pizzaFactory);
    h.handlers.get("resources_discover")?.({}, h.ctx);
    const installedFactory = h.getEditorFactory() as Function;
    assert.notEqual(installedFactory, h.pizzaFactory);
    const installedEditor = installedFactory(
      { requestRender() {} },
      {},
      { matches: () => false },
    );
    assert.equal(installedEditor.getText(), "pizza");
    assert.ok(h.widgets.has("subagent-editor-list"));
  });
}

test("subagent_spawn uses a compact background-task renderer", () => {
  const h = harness();
  const tool = h.tools.get("subagent_spawn");
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  assert.equal(
    tool.renderCall({ name: "Explore", prompt: "Explore docs directory" }, theme).render(200)[0].trimEnd(),
    "● subagent_spawn(Explore)  Explore docs directory",
  );
  assert.equal(
    tool.renderResult({ details: { id: "sub-1", status: "running" } }, {}, theme).render(200)[0].trimEnd(),
    "└─ Running in background (ID: sub-1)",
  );
});

test("registers a model-facing tool for continuing settled subagents", () => {
  const h = harness();
  const tool = h.tools.get("subagent_send");
  assert.equal(tool?.name, "subagent_send");
  assert.match(
    tool?.description,
    /settled subagent resumes its persisted session/,
  );
});

test("subagent_wait owns its live conversation renderer, not an await widget", () => {
  const h = harness();
  const tool = h.tools.get("subagent_wait");
  assert.equal(typeof tool?.renderCall, "function");
  assert.equal(typeof tool?.renderResult, "function");
  assert.equal(
    [...h.widgets].some(([key]) => key.startsWith("subagent-wait:")),
    false,
  );
});

test("shutdown cancels a pending editor installation", async () => {
  const h = harness();
  h.handlers.get("session_start")?.({}, h.ctx);
  h.setPizzaEditor();
  await h.handlers.get("session_shutdown")?.({}, h.ctx);

  h.handlers.get("resources_discover")?.({}, h.ctx);
  assert.equal(h.getEditorFactory(), h.pizzaFactory);
  assert.equal(h.widgets.size, 0);
});
