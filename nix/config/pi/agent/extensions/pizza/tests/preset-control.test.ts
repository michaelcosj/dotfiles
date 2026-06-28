import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { registerPresetControlExtension } from "../preset-control.ts";

function makeFakePi() {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const appended: Array<{ customType: string; data: any }> = [];
  const sentMessages: any[] = [];
  const eventHandlers: Map<string, Function> = new Map();

  const fakePi: any = {
    registerFlag() {},
    registerShortcut() {},
    on(event: string, handler: Function) {
      eventHandlers.set(event, handler);
    },
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerTool(def: any) {
      tools.push(def);
    },
    appendEntry(customType: string, data: any) {
      appended.push({ customType, data });
    },
    sendUserMessage() {},
    sendMessage(msg: any) {
      sentMessages.push(msg);
    },
    getFlag() {
      return undefined;
    },
    getAllTools() {
      return [];
    },
    getThinkingLevel() {
      return "medium";
    },
    getActiveTools() {
      return ["read", "bash", "edit", "write"];
    },
    setActiveTools() {},
    setThinkingLevel() {},
    async setModel() {
      return true;
    },
  };

  return { fakePi, tools, commands, appended, sentMessages, eventHandlers };
}

const TEST_PROJECT_CWD = join(import.meta.dir, "fixtures", "preset-project");

const fakeCtx = (extra: any = {}) => {
  const { ui, ...rest } = extra;
  return {
    hasUI: false,
    cwd: TEST_PROJECT_CWD,
    modelRegistry: { find: () => undefined },
    sessionManager: { getEntries: () => [], getSessionFile: () => null },
    ui: {
      notify: () => {},
      setWidget: () => {},
      theme: {
        fg: (_name: string, text: string) => text,
      },
      ...ui,
    },
    ...rest,
  };
};

describe("switch_preset decoupled from compaction", () => {
  function setup() {
    const { fakePi, tools, commands, appended, sentMessages, eventHandlers } = makeFakePi();
    registerPresetControlExtension(fakePi);

    const sessionStartHandler = eventHandlers.get("session_start");
    if (sessionStartHandler) {
      sessionStartHandler({}, fakeCtx({ cwd: TEST_PROJECT_CWD }));
    }

    return { fakePi, tools, commands, appended, sentMessages, eventHandlers };
  }

  it("switch_preset applies immediately and does not trigger compact", async () => {
    const { tools } = setup();
    const switchTool = tools.find((t) => t.name === "switch_preset");
    expect(switchTool).toBeTruthy();

    const compactCalls: any[] = [];
    const res = await switchTool.execute(
      "tc1",
      { preset: "implement", reason: "need coding mode" },
      undefined,
      undefined,
      fakeCtx({
        getContextUsage: () => ({ tokens: 500_000 }),
        compact: (options: any) => compactCalls.push(options),
      }),
    );

    expect(res.isError).not.toBe(true);
    expect(res.content[0].text).toContain('Preset switched to "implement".');
    expect(compactCalls).toHaveLength(0);
  });

  it("does not register compaction-resume command or session_compact handler", () => {
    const { commands, eventHandlers } = setup();

    expect(commands.has("switch-preset-resume")).toBe(false);
    expect(eventHandlers.has("session_compact")).toBe(false);
  });

  it("returns unknown preset error for invalid target", async () => {
    const { tools } = setup();
    const switchTool = tools.find((t) => t.name === "switch_preset");

    const res = await switchTool.execute(
      "tc2",
      { preset: "does-not-exist", reason: "x" },
      undefined,
      undefined,
      fakeCtx({
        getContextUsage: () => ({ tokens: 10 }),
      }),
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("unknown preset");
  });
});

describe("permission ask flow Always overrides", () => {
  function setup() {
    const { fakePi, eventHandlers } = makeFakePi();
    registerPresetControlExtension(fakePi);

    const sessionStartHandler = eventHandlers.get("session_start");
    if (sessionStartHandler) {
      sessionStartHandler({}, fakeCtx({ cwd: TEST_PROJECT_CWD }));
    }

    const toolCallHandler = eventHandlers.get("tool_call");
    expect(toolCallHandler).toBeTruthy();
    return { toolCallHandler };
  }

  it("bash Always stores command pattern and auto-allows later matching commands", async () => {
    const { toolCallHandler } = setup();

    const notices: string[] = [];
    let confirmCount = 0;
    const firstResult = await toolCallHandler(
      {
        toolName: "bash",
        toolCallId: "tc-bash-1",
        input: { command: "grep foo src/file.ts" },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => "Always",
          confirm: async () => {
            confirmCount++;
            return true;
          },
          input: async () => undefined,
          notify: (msg: string) => notices.push(msg),
        },
      }),
    );

    expect(firstResult).toBeUndefined();
    expect(confirmCount).toBe(1);
    expect(notices.some((m) => m.includes("bash(grep *)"))).toBe(true);

    const secondResult = await toolCallHandler(
      {
        toolName: "bash",
        toolCallId: "tc-bash-2",
        input: { command: "grep -R bar src" },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => {
            throw new Error("prompt should not open after bash Always override");
          },
          confirm: async () => false,
          input: async () => undefined,
          notify: () => {},
        },
      }),
    );

    expect(secondResult).toBeUndefined();
  });

  it("write Always applies edit override for later edit calls", async () => {
    const { toolCallHandler } = setup();

    const firstResult = await toolCallHandler(
      {
        toolName: "write",
        toolCallId: "tc-write-1",
        input: { path: "foo.ts", content: "x" },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => "Always",
          confirm: async () => true,
          input: async () => undefined,
          notify: () => {},
        },
      }),
    );
    expect(firstResult).toBeUndefined();

    const secondResult = await toolCallHandler(
      {
        toolName: "edit",
        toolCallId: "tc-edit-2",
        input: { path: "bar.ts", edits: [] },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => {
            throw new Error("prompt should not open after write/edit Always override");
          },
          confirm: async () => false,
          input: async () => undefined,
          notify: () => {},
        },
      }),
    );

    expect(secondResult).toBeUndefined();
  });

  it("Always asks confirmation before saving override", async () => {
    const { toolCallHandler } = setup();

    let selectCount = 0;
    const firstResult = await toolCallHandler(
      {
        toolName: "grep",
        toolCallId: "tc-grep-1",
        input: { path: "src" },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => {
            selectCount++;
            return "Always";
          },
          confirm: async () => false,
          input: async () => "no override",
          notify: () => {},
        },
      }),
    );

    expect(firstResult?.block).toBe(true);

    const secondResult = await toolCallHandler(
      {
        toolName: "grep",
        toolCallId: "tc-grep-2",
        input: { path: "src" },
      },
      fakeCtx({
        hasUI: true,
        ui: {
          select: async () => {
            selectCount++;
            return "Accept";
          },
          confirm: async () => false,
          input: async () => undefined,
          notify: () => {},
        },
      }),
    );

    expect(secondResult).toBeUndefined();
    expect(selectCount).toBe(2);
  });
});
