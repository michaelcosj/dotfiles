import assert from "node:assert/strict";
import { test } from "bun:test";
import subagentExtension from "../../src/features/subagents/register.ts";

function harness(options: { manager?: any; sendMessage?: (message: any) => void } = {}) {
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
    model: { provider: "openai", id: "gpt-5" },
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
    getThinkingLevel: () => "high",
    sendMessage: options.sendMessage ?? (() => {}),
  };
  subagentExtension(pi, {
    createManager: options.manager ? () => options.manager : undefined,
  });
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

  assert.deepEqual(
    tool
      .renderCall({ name: "Explore", prompt: "Explore docs directory", model: "openai/gpt-5" }, theme)
      .render(200)
      .map((line: string) => line.trimEnd()),
    [
      "● subagent_spawn(Explore)  openai/gpt-5 · high",
      "│ Explore docs directory",
    ],
  );
  assert.equal(
    tool.renderResult({ details: { id: "sub-1", status: "running", modelLabel: "openai/gpt-5", reasoningEffort: "high" } }, {}, theme).render(200)[0].trimEnd(),
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

function snapshot(finalText: string, turns: number, id = "sa-1") {
  return {
    id,
    origin: "model",
    title: "worker",
    prompt: "work",
    status: "done",
    backend: "pi",
    createdAt: 1,
    settledAt: turns,
    finalText,
    turns,
    toolUseCount: 0,
    compactionCount: 0,
    transcript: [],
    liveTools: [],
    queued: [],
    usage: {},
    meta: {},
  } as any;
}

function continuationHarness(
  send: (settle: (result: any) => void) => Promise<void>,
) {
  let current = snapshot("old", 1);
  let onSettled = (_result: any) => {};
  const manager: any = {
    get: () => current,
    list: () => [current],
    view: { subscribe: () => () => {} },
    setOnSettled(fn: (result: any) => void) {
      onSettled = fn;
    },
    async send() {
      await send((result) => {
        current = result;
        onSettled(result);
      });
    },
  };
  const delivered: string[] = [];
  const h = harness({
    manager,
    sendMessage(message) {
      delivered.push(message.details.summary);
    },
  });
  h.ctx.isIdle = () => false;
  h.handlers.get("session_start")?.({}, h.ctx);
  // Initialize the manager, then seed the completion which predates send.
  h.tools.get("subagent_check").execute("check", { id: "sa-1" });
  onSettled(current);
  return { h, delivered };
}

test("subagent_send restores its claimed result when continuation is rejected", async () => {
  const { h, delivered } = continuationHarness(async () => {
    throw new Error("At most 4 subagents may run concurrently");
  });

  await assert.rejects(
    h.tools.get("subagent_send").execute("send", {
      id: "sa-1",
      message: "again",
    }),
    /At most 4/,
  );
  h.handlers.get("agent_settled")?.();
  assert.deepEqual(delivered, ["old"]);
});

for (const succeeds of [false, true]) {
  test(`subagent_send preserves a newly settled result when continuation ${succeeds ? "succeeds" : "fails"}`, async () => {
    const newer = snapshot("new", 2);
    const { h, delivered } = continuationHarness(async (settle) => {
      settle(newer);
      if (!succeeds) throw new Error("child failed");
    });
    const action = h.tools.get("subagent_send").execute("send", {
      id: "sa-1",
      message: "again",
    });
    if (succeeds) await action;
    else await assert.rejects(action, /child failed/);

    h.handlers.get("agent_settled")?.();
    h.handlers.get("agent_settled")?.();
    assert.deepEqual(delivered, ["new"]);
  });
}
