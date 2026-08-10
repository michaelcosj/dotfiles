import { describe, expect, it } from "bun:test";
import { Type } from "typebox";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PizzaToolComponent, registerClaudeStyleToolRenderers } from "../src/features/tool-renderers/register.js";

const names = ["read", "bash", "edit", "write"] as const;
type ToolName = (typeof names)[number];

initTheme(undefined, false);

function makeTheme(tag = "old") {
  const color = tag === "new" ? 2 : 1;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => `\x1b[48;5;${color}m${text}\x1b[0m`,
    bold: (text: string) => text,
  } as any;
}

function renderContext(args: any, overrides: Record<string, unknown> = {}) {
  return {
    args,
    toolCallId: "render-id",
    invalidate() {},
    lastComponent: undefined,
    state: {},
    cwd: "/workspace",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    ...overrides,
  } as any;
}

function visible(component: Component, width = 120): string {
  return component
    .render(width)
    .join("\n")
    .replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function makeHarness(
  options: {
    sources?: Partial<Record<ToolName, string>>;
    active?: string[];
    activateOnRegister?: boolean;
    throwFor?: ToolName;
    imageFallback?: Component;
    shellPath?: string;
    commandPrefix?: string;
    autoResize?: boolean;
    autoStart?: boolean;
    keyHint?: (key: string, description: string) => string;
  } = {},
) {
  const sources = Object.fromEntries(names.map((name) => [name, options.sources?.[name] ?? "builtin"]));
  const registered: any[] = [];
  const factoryCalls: Array<{ name: ToolName; cwd: string; options: any }> = [];
  const executions: Array<{ name: ToolName; cwd: string; args: unknown[] }> = [];
  const settingsCalls: Array<{ cwd: string; agentDir: unknown; options: any }> = [];
  let active = [...(options.active ?? ["read", "edit"])];
  const setActiveCalls: string[][] = [];
  const metadata = { marker: Symbol("sdk-metadata") };

  const makeFactory = (name: ToolName) => (cwd: string, factoryOptions?: any) => {
    factoryCalls.push({ name, cwd, options: factoryOptions });
    return {
      name,
      label: `sdk-${name}`,
      description: `sdk description ${name}`,
      promptSnippet: `sdk snippet ${name}`,
      promptGuidelines: [`sdk guideline ${name}`],
      parameters: Type.Object({}),
      prepareArguments: (value: unknown) => value,
      executionMode: "parallel",
      constrainedSampling: false,
      metadata,
      async execute(...args: unknown[]) {
        executions.push({ name, cwd, args });
        if (options.throwFor === name) throw new Error(`${name} exploded`);
        return {
          content: [{ type: "text", text: `${name}:${cwd}` }],
          details: { name, cwd },
        };
      },
      renderResult: name === "read" && options.imageFallback ? () => options.imageFallback as Component : undefined,
    } as any;
  };

  let sessionStart: (() => void) | undefined;
  const api = {
    on: (event: string, handler: () => void) => {
      if (event === "session_start") sessionStart = handler;
    },
    getAllTools: () =>
      names.map((name) => ({
        name,
        description: name,
        parameters: {},
        sourceInfo: {
          source: sources[name],
          path: `<${sources[name]}:${name}>`,
          scope: "temporary",
          origin: "top-level",
        },
      })),
    getActiveTools: () => [...active],
    setActiveTools: (next: string[]) => {
      setActiveCalls.push([...next]);
      active = [...next];
    },
    registerTool: (definition: any) => {
      registered.push(definition);
      if (options.activateOnRegister && !active.includes(definition.name)) active.push(definition.name);
    },
  } as unknown as ExtensionAPI;

  const createSettingsManager = ((cwd: string, agentDir?: string, createOptions?: any) => {
    settingsCalls.push({ cwd, agentDir, options: createOptions });
    return {
      getShellPath: () => options.shellPath,
      getShellCommandPrefix: () => options.commandPrefix,
      getImageAutoResize: () => options.autoResize ?? true,
    };
  }) as any;

  registerClaudeStyleToolRenderers(api, {
    createReadDefinition: makeFactory("read") as any,
    createBashDefinition: makeFactory("bash") as any,
    createEditDefinition: makeFactory("edit") as any,
    createWriteDefinition: makeFactory("write") as any,
    createSettingsManager,
    keyHint: options.keyHint,
  });

  const startSession = () => sessionStart?.();
  if (options.autoStart !== false) startSession();

  return { registered, factoryCalls, executions, settingsCalls, setActiveCalls, metadata, startSession };
}

function executionContext(cwd: string, trusted = true) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
  } as any;
}

describe("Claude-style tool renderer registration", () => {
  it("defers action APIs until session_start and registers only once", () => {
    const harness = makeHarness({ autoStart: false });
    expect(harness.registered).toHaveLength(0);
    expect(harness.factoryCalls).toHaveLength(0);
    harness.startSession();
    harness.startSession();
    expect(harness.registered).toHaveLength(4);
  });

  it("overrides built-ins independently and skips SDK/extension-owned tools", () => {
    const harness = makeHarness({ sources: { bash: "sdk", write: "other-extension" } });
    expect(harness.registered.map((tool) => tool.name)).toEqual(["read", "edit"]);
  });

  it("preserves every SDK field except execution and rendering", () => {
    const { registered, metadata } = makeHarness();
    for (const tool of registered) {
      expect(tool.label).toBe(`sdk-${tool.name}`);
      expect(tool.description).toContain("sdk description");
      expect(tool.promptSnippet).toContain("sdk snippet");
      expect(tool.promptGuidelines).toEqual([`sdk guideline ${tool.name}`]);
      expect(tool.executionMode).toBe("parallel");
      expect(tool.constrainedSampling).toBe(false);
      expect(tool.prepareArguments).toBeFunction();
      expect(tool.metadata).toBe(metadata);
      expect(tool.renderShell).toBe("self");
    }
  });

  it("creates registration templates with process.cwd() and restores the active names", () => {
    const harness = makeHarness({ active: ["read"], activateOnRegister: true });
    expect(harness.factoryCalls.slice(0, 4).map((call) => call.cwd)).toEqual(Array(4).fill(process.cwd()));
    expect(harness.setActiveCalls).toEqual([["read"]]);
  });

  it("does not call setActiveTools when registration preserves active names", () => {
    expect(makeHarness().setActiveCalls).toEqual([]);
  });
});

describe("SDK execution delegation", () => {
  it("forwards all execution arguments and preserves returned content/details", async () => {
    const harness = makeHarness({ shellPath: "/bin/zsh", commandPrefix: "source env", autoResize: false });
    const signal = new AbortController().signal;
    const update = () => {};
    const context = executionContext("/session/project", false);

    for (const tool of harness.registered) {
      const params =
        tool.name === "read"
          ? { path: "a.txt", offset: 2 }
          : tool.name === "bash"
            ? { command: "pwd", timeout: 3 }
            : tool.name === "edit"
              ? { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] }
              : { path: "a.txt", content: "hello" };
      const result = await tool.execute("call-7", params, signal, update, context);
      expect(result.content[0].text).toBe(`${tool.name}:/session/project`);
      expect(result.details).toEqual({ name: tool.name, cwd: "/session/project" });
      const delegated = harness.executions.at(-1)!;
      expect(delegated.args).toEqual(["call-7", params, signal, update, context]);
    }
  });

  it("creates delegates with each current ctx.cwd and effective settings", async () => {
    const harness = makeHarness({ shellPath: "/bin/fish", commandPrefix: "mise activate", autoResize: false });
    const read = harness.registered.find((tool) => tool.name === "read");
    const bash = harness.registered.find((tool) => tool.name === "bash");
    await read.execute("r", { path: "a" }, undefined, undefined, executionContext("/one", true));
    await bash.execute("b", { command: "pwd" }, undefined, undefined, executionContext("/two", false));

    expect(harness.factoryCalls.findLast((call) => call.name === "read")).toEqual({
      name: "read",
      cwd: "/one",
      options: { autoResizeImages: false },
    });
    expect(harness.factoryCalls.findLast((call) => call.name === "bash")).toEqual({
      name: "bash",
      cwd: "/two",
      options: { shellPath: "/bin/fish", commandPrefix: "mise activate" },
    });
    expect(harness.settingsCalls).toEqual([
      { cwd: "/one", agentDir: undefined, options: { projectTrusted: true } },
      { cwd: "/two", agentDir: undefined, options: { projectTrusted: false } },
    ]);
  });

  it("passes missing shell settings as undefined and reflects both image-resize values", async () => {
    const defaults = makeHarness({ autoResize: true });
    await defaults.registered
      .find((tool) => tool.name === "bash")
      .execute("b", {}, undefined, undefined, executionContext("/x"));
    await defaults.registered
      .find((tool) => tool.name === "read")
      .execute("r", {}, undefined, undefined, executionContext("/x"));
    expect(defaults.factoryCalls.findLast((call) => call.name === "bash")!.options).toEqual({
      shellPath: undefined,
      commandPrefix: undefined,
    });
    expect(defaults.factoryCalls.findLast((call) => call.name === "read")!.options.autoResizeImages).toBe(true);
  });

  it("does not turn delegate errors into successful results", async () => {
    const harness = makeHarness({ throwFor: "edit" });
    const edit = harness.registered.find((tool) => tool.name === "edit");
    await expect(edit.execute("e", {}, undefined, undefined, executionContext("/x"))).rejects.toThrow("edit exploded");
  });
});

describe("compact rendering", () => {
  it("colors the call circle by running, failed, and successful status", () => {
    const write = makeHarness().registered.find((tool) => tool.name === "write");
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as any;
    const args = { path: "demo.txt", content: "done" };

    const running = write.renderCall(args, theme, renderContext(args, { isPartial: true }));
    const failed = write.renderCall(args, theme, renderContext(args, { isError: true }));
    const succeeded = write.renderCall(args, theme, renderContext(args));

    expect(running.render(120).join("\n")).toContain("<warning>● </warning>");
    expect(failed.render(120).join("\n")).toContain("<error>● </error>");
    expect(succeeded.render(120).join("\n")).toContain("<success>● </success>");
  });

  it("keeps a not-started call pending", () => {
    const write = makeHarness().registered.find((tool) => tool.name === "write");
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as any;
    const args = { path: "demo.txt", content: "done" };
    const pending = write.renderCall(
      args,
      theme,
      renderContext(args, { executionStarted: false }),
    );

    expect(pending.render(120).join("\\n")).toContain("<warning>● </warning>");
  });

  it("renders calls, partial states, UTF-8 byte sizes, and relative paths", () => {
    const { registered } = makeHarness();
    const theme = makeTheme();
    const read = registered.find((tool) => tool.name === "read");
    const bash = registered.find((tool) => tool.name === "bash");
    const edit = registered.find((tool) => tool.name === "edit");
    const write = registered.find((tool) => tool.name === "write");

    expect(
      visible(read.renderCall({ path: "/workspace/src/a.ts", offset: 50, limit: 100 }, theme, renderContext({}))),
    ).toContain("● Read(src/a.ts · offset 50 · limit 100)");
    const renderedBashCall = visible(
      bash.renderCall({ command: "\n npm test\necho done", timeout: 5 }, theme, renderContext({ command: "" })),
    );
    expect(renderedBashCall).toContain("npm test");
    expect(renderedBashCall).toContain("echo done · timeout 5s");
    expect(visible(edit.renderCall({ path: "src/a.ts", edits: [{}, {}] }, theme, renderContext({})))).toContain(
      "2 replacements",
    );
    expect(visible(write.renderCall({ path: "new.txt", content: "é\n🙂" }, theme, renderContext({})))).toContain(
      "2 lines · 7B",
    );

    const partial = { expanded: false, isPartial: true };
    expect(
      visible(
        read.renderResult(
          { content: [], details: undefined },
          partial,
          theme,
          renderContext({ path: "a" }, { isPartial: true }),
        ),
      ),
    ).toContain("Reading…");
    expect(
      visible(
        edit.renderResult(
          { content: [], details: undefined },
          partial,
          theme,
          renderContext({ path: "a", edits: [] }, { isPartial: true }),
        ),
      ),
    ).toContain("Editing…");
    expect(
      visible(
        write.renderResult(
          { content: [], details: undefined },
          partial,
          theme,
          renderContext({ path: "a", content: "" }, { isPartial: true }),
        ),
      ),
    ).toContain("Writing…");
  });

  it("renders bounded bash tails, collapsed summaries, expanded output, errors, and truncation paths", () => {
    const bash = makeHarness().registered.find((tool) => tool.name === "bash");
    const theme = makeTheme();
    const output = "one\ntwo\nthree\nfour\nfive";
    const liveOutput = Array.from({ length: 12 }, (_, index) => `live ${index + 1}`).join("\n");
    const partialText = visible(
      bash.renderResult(
        { content: [{ type: "text", text: liveOutput }], details: undefined },
        { expanded: false, isPartial: true },
        theme,
        renderContext({ command: "x" }, { isPartial: true }),
      ),
    );
    expect(partialText).not.toContain("live 1\n");
    expect(partialText).not.toContain("live 2\n");
    expect(partialText).toContain("live 3");
    expect(partialText).toContain("live 12");

    const details = { truncation: { truncated: true }, fullOutputPath: "/tmp/full.log" };
    const collapsed = visible(
      bash.renderResult(
        { content: [{ type: "text", text: output }], details },
        { expanded: false, isPartial: false },
        theme,
        renderContext({ command: "x" }),
      ),
    );
    expect(collapsed).toContain("Completed · 5 lines · truncated");
    expect(collapsed).toContain("to expand");
    expect(collapsed).toContain("> │ one");
    expect(collapsed).toContain("> │ five");

    const expanded = visible(
      bash.renderResult(
        { content: [{ type: "text", text: output }], details },
        { expanded: true, isPartial: false },
        theme,
        renderContext({ command: "x" }, { expanded: true }),
      ),
    );
    expect(expanded).toContain("one");
    expect(expanded).toContain("Full output: /tmp/full.log");

    const errorResult = { content: [{ type: "text", text: "exit diagnostic" }], details: undefined };
    const error = visible(
      bash.renderResult(
        errorResult,
        { expanded: true, isPartial: false },
        theme,
        renderContext({ command: "x" }, { expanded: true, isError: true }),
      ),
    );
    expect(error).toContain("Failed");
    expect(error).toContain("exit diagnostic");
    expect(
      visible(
        bash.renderResult(
          errorResult,
          { expanded: false, isPartial: false },
          theme,
          renderContext({ command: "x" }, { isError: true }),
        ),
      ),
    ).toContain("exit diagnostic");
  });

  it("renders read summaries, continuation/truncation, expanded persisted text, and image fallback", () => {
    const fallback = { render: () => ["SDK IMAGE"], invalidate() {} };
    const read = makeHarness({ imageFallback: fallback }).registered.find((tool) => tool.name === "read");
    const theme = makeTheme();
    const result = {
      content: [{ type: "text", text: "a\nb\n\n[Showing lines 1-2 of 5. Use offset=3 to continue.]" }],
      details: { truncation: { truncated: true } },
    };
    const collapsed = visible(
      read.renderResult(result, { expanded: false, isPartial: false }, theme, renderContext({ path: "a.txt" })),
    );
    expect(collapsed).toContain("Read 4 lines · truncated · more available");
    expect(collapsed).toContain("to expand");
    expect(collapsed).toContain("1 │ a");
    expect(collapsed).toContain("2 │ b");
    expect(collapsed).not.toContain("Showing lines");
    const expanded = visible(
      read.renderResult(
        result,
        { expanded: true, isPartial: false },
        theme,
        renderContext({ path: "a.txt" }, { expanded: true }),
      ),
    );
    expect(expanded).toContain("Use offset=3 to continue");

    const image = read.renderResult(
      {
        content: [
          { type: "text", text: "image" },
          { type: "image", data: "x", mimeType: "image/png" },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      renderContext({ path: "a.png" }),
    );
    expect(image).not.toBe(fallback);
    expect(visible(image)).toContain("SDK IMAGE");
    expect(image.render(20).join("\n")).toContain("\x1b[48;5;1m");
  });

  it("uses SDK diffs for edit counts/expanded display and context.isError for failures", () => {
    const edit = makeHarness().registered.find((tool) => tool.name === "edit");
    const theme = makeTheme();
    const diff = "--- old\n+++ new\n context\n-added\n+first\n+second";
    const result = { content: [{ type: "text", text: "ok" }], details: { diff, patch: "ignored" } };
    const collapsed = visible(edit.renderResult(result, { expanded: false, isPartial: false }, theme, renderContext({})));
    expect(collapsed).toContain("Applied · +2 -1");
    expect(collapsed).toContain("+first");
    expect(collapsed).toContain("-added");
    const expanded = visible(
      edit.renderResult(result, { expanded: true, isPartial: false }, theme, renderContext({}, { expanded: true })),
    );
    expect(expanded).toContain("+first");
    expect(expanded).toContain("-added");
    expect(
      visible(
        edit.renderResult(
          { content: [{ type: "text", text: "exact match failed" }], details: undefined },
          { expanded: false, isPartial: false },
          theme,
          renderContext({}, { isError: true }),
        ),
      ),
    ).toContain("exact match failed");
  });

  it("tolerates incomplete streamed arguments and strips terminal controls", () => {
    const registered = makeHarness().registered;
    const theme = makeTheme();
    const partialContext = renderContext({}, { argsComplete: false, executionStarted: false, isPartial: true });

    for (const name of names) {
      const tool = registered.find((candidate) => candidate.name === name);
      expect(() => tool.renderCall({}, theme, partialContext).render(20)).not.toThrow();
    }

    const bash = registered.find((tool) => tool.name === "bash");
    const hostile = "safe\x1b[2J\x1b]0;owned\x07\ttext\x00\x9b31mbad";
    const call = bash.renderCall(
      { command: hostile, timeout: hostile },
      theme,
      renderContext({ command: hostile, timeout: hostile }),
    );
    const read = registered.find((tool) => tool.name === "read");
    const numericCall = read.renderCall(
      { path: "safe", offset: hostile, limit: hostile },
      theme,
      renderContext({ path: "safe", offset: hostile, limit: hostile }),
    );
    const result = bash.renderResult(
      { content: [{ type: "text", text: hostile }], details: undefined },
      { expanded: true, isPartial: false },
      theme,
      renderContext({ command: hostile }, { expanded: true }),
    );
    const rendered = `${call.render(80).join("\n")}\n${numericCall.render(80).join("\n")}\n${result.render(80).join("\n")}`;
    expect(rendered).not.toContain("\x1b[2J");
    expect(rendered).not.toContain("\x1b]0;");
    expect(rendered).not.toContain("\x07");
    expect(rendered).not.toContain("\x00");
    expect(visible(result, 80)).toContain("safe   textbad");
  });

  it("bounds collapsed bash previews", () => {
    const bash = makeHarness().registered.find((tool) => tool.name === "bash");
    const output = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
    const collapsed = visible(
      bash.renderResult(
        { content: [{ type: "text", text: output }], details: undefined },
        { expanded: false, isPartial: false },
        makeTheme(),
        renderContext({ command: "x" }),
      ),
    );

    expect(collapsed).toContain("> │ line 1");
    expect(collapsed).toContain("> │ line 10");
    expect(collapsed).not.toContain("> │ line 11");
    expect(collapsed).toContain("2 more lines");
  });

  it("shows write content as a bounded added-file diff", () => {
    const write = makeHarness().registered.find((tool) => tool.name === "write");
    const theme = makeTheme();
    const content = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n");
    const result = { content: [{ type: "text", text: "Successfully wrote file" }], details: undefined };

    const collapsed = visible(
      write.renderResult(
        result,
        { expanded: false, isPartial: false },
        theme,
        renderContext({ path: "new.txt", content }),
      ),
    );
    expect(collapsed).toContain("Written · +14 -0");
    expect(collapsed).toContain("+line 1");
    expect(collapsed).not.toContain("+line 13");
    expect(collapsed).toContain("2 more diff lines");

    const expanded = visible(
      write.renderResult(
        result,
        { expanded: true, isPartial: false },
        theme,
        renderContext({ path: "new.txt", content }, { expanded: true }),
      ),
    );
    expect(expanded).toContain("+line 13");
    expect(expanded).not.toContain("more diff lines");
  });

  it("uses the configured expansion binding", () => {
    const definitions = {
      ...TUI_KEYBINDINGS,
      "app.tools.expand": { defaultKeys: "ctrl+o" as const, description: "Toggle" },
    };
    setKeybindings(new KeybindingsManager(definitions, { "app.tools.expand": "alt+e" }));
    const read = makeHarness({
      keyHint: (_key, description) => `alt+e ${description}`,
    }).registered.find((tool) => tool.name === "read");
    const text = visible(
      read.renderResult(
        { content: [{ type: "text", text: "x" }], details: undefined },
        { expanded: false, isPartial: false },
        makeTheme(),
        renderContext({ path: "a" }),
      ),
    );
    expect(text).toMatch(/(?:alt|option)\+e to expand/);
  });

  it("reuses lastComponent, invalidates theme caches, and never exceeds narrow widths", () => {
    const write = makeHarness().registered.find((tool) => tool.name === "write");
    const first = write.renderCall(
      { path: "a-very-long-path-that-must-wrap.txt", content: "hello" },
      makeTheme("old"),
      renderContext({}),
    );
    const second = write.renderCall(
      { path: "a-very-long-path-that-must-wrap.txt", content: "hello" },
      makeTheme("new"),
      renderContext({}, { lastComponent: first }),
    );
    expect(first).toBe(second);
    expect(second).toBeInstanceOf(PizzaToolComponent);
    second.invalidate();
    expect(second.render(12).join("\n")).toContain("\x1b[48;5;2m");
    for (const width of [1, 2, 8, 20]) {
      for (const line of second.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
