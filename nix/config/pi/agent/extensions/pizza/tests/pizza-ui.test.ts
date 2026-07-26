import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerPizzaUiExtension } from "../pizza-ui.ts";

function setup(
  extensionStatuses = new Map<string, string>(),
  ansiTheme = false,
) {
  const handlers = new Map<string, Function>();
  const ui: Record<string, any> = {};
  let entryReads = 0;
  const pi: any = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    getThinkingLevel() {
      return "medium";
    },
  };
  const theme = ansiTheme
    ? {
        fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
        bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[0m`,
        inverse: (text: string) => `\x1b[7m${text}\x1b[0m`,
        bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
        borderColor: (text: string) => text,
        selectList: {},
      }
    : {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
        bg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
        inverse: (text: string) => text,
        bold: (text: string) => `<b>${text}</b>`,
        borderColor: (text: string) => text,
        selectList: {},
      };
  const ctx: any = {
    mode: "tui",
    cwd: "/Users/test/project",
    model: { id: "test-model", reasoning: true, contextWindow: 200_000 },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getEntries() {
        entryReads++;
        return [
          {
            type: "message",
            message: { role: "assistant", usage: { cost: { total: 0.125 } } },
          },
        ];
      },
    },
    getContextUsage: () => ({
      tokens: 9_000,
      contextWindow: 200_000,
      percent: 4.5,
    }),
    ui: {
      theme,
      setTitle(value: string) {
        ui.title = value;
      },
      setWorkingIndicator(value?: unknown) {
        ui.workingIndicator = value;
      },
      setWorkingMessage(value?: string) {
        ui.workingMessage = value;
      },
      setEditorComponent(value: unknown) {
        ui.editor = value;
      },
      setHeader(value: unknown) {
        ui.header = value;
      },
      setWidget(key: string, value: unknown) {
        ui.widgets ??= new Map();
        ui.widgets.set(key, value);
      },
      setFooter(value: unknown) {
        ui.footer = value;
      },
    },
  };

  registerPizzaUiExtension(pi);
  handlers.get("session_start")({}, ctx);
  const tui = { requestRender() {}, terminal: { rows: 24 } };
  const footer = ui.footer(tui, theme, {
    getGitBranch: () => "main",
    getExtensionStatuses: () => extensionStatuses,
    onBranchChange: () => () => {},
  });
  const widgetFactory = ui.widgets.get("pizza-codex-usage");
  const widget = widgetFactory(tui, theme);
  return { footer, widget, handlers, ui, ctx, getEntryReads: () => entryReads };
}

describe("pizza ui", () => {
  it("uses a blue user background and transparent tool backgrounds", () => {
    const themePath = resolve(import.meta.dir, "../../../themes/pizza-ui.json");
    const theme = JSON.parse(readFileSync(themePath, "utf8"));
    expect(theme.colors.userMessageBg).toBe("userBg");
    expect(theme.vars.userBg).toBe("#202a3a");
    expect(theme.colors.toolPendingBg).toBe("default");
    expect(theme.colors.toolSuccessBg).toBe("default");
    expect(theme.colors.toolErrorBg).toBe("default");
  });

  it("installs the framed editor and Codex header widget", () => {
    const { ui } = setup();
    expect(ui.title).toBe("Pizza");
    expect(typeof ui.header).toBe("function");
    expect(ui.workingIndicator).toEqual({ frames: [] });
    expect(typeof ui.editor).toBe("function");
    expect(typeof ui.widgets.get("pizza-codex-usage")).toBe("function");
  });

  it("renders branch and working directory in the editor's bottom border", () => {
    const { footer, ui, ctx } = setup(new Map(), true);
    footer.render(100);
    const tui = { requestRender() {}, terminal: { rows: 24 } };
    const editor = ui.editor(tui, ctx.ui.theme, { matches: () => false });
    const line = editor.render(100).at(-1);
    expect(line).toContain("main");
    expect(line).toContain("/Users/test/project");
    expect(line).toContain("┗");
    expect(line).toContain("┛");
  });

  it("shows white Codex usage in the header widget only", () => {
    const statuses = new Map([["codex-usage", "82% 5h · 58% 7d"]]);
    const { footer, widget } = setup(statuses, true);
    const footerLines = footer.render(100);
    const [widgetLine] = widget.render(100);
    expect(footerLines.join("\n")).not.toContain("82% 5h");
    expect(widgetLine).toContain("codex");
    expect(widgetLine).toContain("82% 5h · 58% 7d");
  });

  it("shows a bright-red fusion badge beside Codex usage", () => {
    const statuses = new Map([
      ["codex-usage", "82% 5h · 58% 7d"],
      ["fusion-mode", "FUSION"],
    ]);
    const { footer, widget } = setup(statuses);
    footer.render(100);
    const [line] = widget.render(100);
    expect(line).toContain("codex");
    expect(line).toContain("\x1b[91m<b>FUSION</b>\x1b[39m");
    expect(line.indexOf("FUSION")).toBeGreaterThan(line.indexOf("82% 5h"));
  });

  it("uses a yellow spinner and one randomized working phrase", () => {
    const { handlers, ctx, ui } = setup();
    handlers.get("agent_start")({}, ctx);
    expect(ui.workingIndicator.frames).toHaveLength(6);
    expect(ui.workingIndicator.intervalMs).toBe(80);
    expect(ui.workingIndicator.frames[0]).toContain("<warning>✦</warning>");
    expect(ui.workingMessage).toMatch(/<warning>.+…<\/warning>/);
    expect(ui.workingMessage).not.toContain("Working… Working…");
  });

  it("caches initial session entries and stays within narrow terminal width", () => {
    const { footer, getEntryReads } = setup(new Map(), true);
    footer.render(10);
    footer.render(10);
    expect(getEntryReads()).toBe(1);
    expect(footer.render(10)).toEqual([]);
  });

  it("keeps the framed editor within tiny renderer widths", () => {
    const { ui, ctx } = setup(new Map(), true);
    const tui = { requestRender() {}, terminal: { rows: 24 } };
    const editor = ui.editor(tui, ctx.ui.theme, { matches: () => false });
    const header = ui.header(tui, ctx.ui.theme);

    for (const width of [0, 1, 2, 3, 4]) {
      for (const renderer of [editor, header]) {
        const lines = renderer.render(width);
        expect(lines.every((line: string) => visibleWidth(line) <= width)).toBe(
          true,
        );
      }
    }
  });
});
