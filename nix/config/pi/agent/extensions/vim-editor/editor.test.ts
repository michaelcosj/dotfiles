// Run: bun test nix/config/pi/agent/extensions/vim-editor
// Uses the installed pi's packages (PI_NODE_MODULES, or found from `pi` on PATH).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function piModules(): string {
  if (process.env.PI_NODE_MODULES) return process.env.PI_NODE_MODULES;
  // .../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js -> .../node_modules
  const cli = fs.realpathSync(execFileSync("which", ["pi"]).toString().trim());
  let dir = path.dirname(cli);
  while (path.basename(dir) !== "node_modules" && dir !== "/") dir = path.dirname(dir);
  return dir;
}
const MODULES = piModules();
for (const id of ["@earendil-works/pi-tui", "@earendil-works/pi-coding-agent"]) {
  const mod = await import(path.join(MODULES, id, "dist/index.js"));
  mock.module(id, () => mod);
}

const { initTheme } = await import("@earendil-works/pi-coding-agent");
const { KeybindingsManager } = await import(
  path.join(MODULES, "@earendil-works/pi-coding-agent/dist/core/keybindings.js")
);
const tuiPkg = await import("@earendil-works/pi-tui");
const { VimEditor } = await import("./editor.ts");
const { vimState } = await import("./config.ts");
const { parseConfig } = await import("./config.ts");

initTheme("dark");
const kb = new KeybindingsManager({});
tuiPkg.setKeybindings(kb);
const theme = { borderColor: (s: string) => s, selectList: {} as any };
const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as any;

const ESC = "\x1b";
const ENTER = "\r";

function make(opts: { clip?: string; now?: () => number } = {}) {
  const written: string[] = [];
  let clip = opts.clip ?? "";
  const clipboard = {
    async read() {
      return clip;
    },
    async write(t: string) {
      written.push(t);
      clip = t;
    },
  };
  const ed = new VimEditor(tui, theme, kb, { clipboard, now: opts.now });
  const submitted: string[] = [];
  ed.onSubmit = (t: string) => submitted.push(t);
  let interrupts = 0;
  ed.onEscape = () => interrupts++;
  const type = (...keys: string[]) => {
    for (const k of keys)
      for (const ch of k.startsWith("\x1b") || k === ENTER ? [k] : [...k]) ed.handleInput(ch);
  };
  const show = () => {
    const { line, col } = ed.getCursor();
    return ed
      .getLines()
      .map((l: string, i: number) => (i === line ? `${l.slice(0, col)}|${l.slice(col)}` : l))
      .join("\n");
  };
  return {
    ed,
    type,
    show,
    submitted,
    written,
    interrupts: () => interrupts,
    setClip: (t: string) => (clip = t),
  };
}

beforeEach(() => {
  Object.assign(vimState(), { enabled: true, remaps: ["jj"], clipboard: "unnamedplus" });
});

describe("VimEditor", () => {
  test("types in INSERT, edits in NORMAL", () => {
    const { ed, type, show } = make();
    type("hello world", ESC);
    expect(ed.mode).toBe("normal");
    expect(show()).toBe("hello worl|d");
    type("bdw");
    expect(show()).toBe("hello| ");
    type("u");
    expect(show()).toBe("hello |world");
  });

  test("Esc in NORMAL reaches pi's interrupt", () => {
    const h = make();
    h.type("x", ESC);
    expect(h.interrupts()).toBe(0);
    h.type(ESC);
    expect(h.interrupts()).toBe(1);
  });

  test("Enter submits from NORMAL and the next prompt starts in INSERT", () => {
    const h = make();
    h.type("fix it", ESC, ENTER);
    expect(h.submitted).toEqual(["fix it"]);
    expect(h.ed.mode).toBe("insert");
    expect(h.ed.getText()).toBe("");
  });

  test("printable keys in NORMAL do not insert text", () => {
    const h = make();
    h.type("ab", ESC, "QZ");
    expect(h.ed.getText()).toBe("ab");
  });

  test("jj leaves INSERT without typing j", () => {
    let t = 0;
    const h = make({ now: () => (t += 100) });
    h.type("abjj");
    expect(h.ed.mode).toBe("normal");
    expect(h.show()).toBe("a|b");
  });

  test("a slow jj stays text", () => {
    let t = 0;
    const h = make({ now: () => (t += 1500) });
    h.type("jj");
    expect(h.ed.mode).toBe("insert");
    expect(h.ed.getText()).toBe("jj");
  });

  test("bracketed paste in NORMAL inserts text", () => {
    const h = make();
    h.type("ab", ESC);
    h.ed.handleInput("\x1b[200~xyz\x1b[201~");
    expect(h.ed.getText()).toContain("xyz");
  });

  test("yank writes the clipboard; linewise ends with a newline", () => {
    const h = make();
    h.type("one", ESC, "yy");
    expect(h.written).toEqual(["one\n"]);
    h.type("yiw");
    expect(h.written.at(-1)).toBe("one");
  });

  test("clipboard 'unnamed' does not write", () => {
    vimState().clipboard = "unnamed";
    const h = make();
    h.type("one", ESC, "yy");
    expect(h.written).toEqual([]);
  });

  test("p pastes text copied in another app", async () => {
    const h = make({ clip: "XY" });
    h.type("ab", ESC, "0p");
    await Bun.sleep(10);
    expect(h.show()).toBe("aX|Yb");
  });

  test("p keeps the register type when the clipboard holds our own yank", async () => {
    const h = make();
    h.type("one", ESC, "yyp");
    await Bun.sleep(10);
    expect(h.show()).toBe("one\n|one");
  });

  test("keys typed while the clipboard is read run after it", async () => {
    const h = make({ clip: "Z" });
    h.type("ab", ESC, "0px");
    await Bun.sleep(10);
    expect(h.ed.getText()).toBe("ab");
  });

  test("k on the first line browses history", () => {
    const h = make();
    h.ed.addToHistory("older prompt");
    h.type("x", ESC, "k");
    expect(h.ed.getText()).toBe("older prompt");
    expect(h.ed.mode).toBe("normal");
  });

  test("disabled: plain pi editor", () => {
    vimState().enabled = false;
    const h = make();
    h.type("ab", ESC, "x");
    expect(h.ed.getText()).toBe("abx");
    expect(h.ed.badge()).toBeUndefined();
  });

  test("badge shows the mode and a pending operator", () => {
    const h = make();
    expect(h.ed.badge()).toEqual({ text: " I ", color: "success" });
    h.type("a", ESC, "2d");
    expect(h.ed.badge()).toEqual({ text: " N 2d ", color: "accent" });
    const lines = h.ed.render(40);
    expect(lines.at(-1)).toContain(" N 2d ");
    expect(tuiPkg.visibleWidth(lines.at(-1)!)).toBe(40);
  });
});

describe("config", () => {
  test("parseConfig keeps only two-character Esc remaps", () => {
    const c = parseConfig({
      insertRemaps: { jj: "<Esc>", jk: "<esc>", abc: "<Esc>", kj: "x" },
      clipboard: "nope",
    });
    expect(Object.keys(c.insertRemaps)).toEqual(["jj", "jk"]);
    expect(c.clipboard).toBe("unnamedplus");
    expect(c.enabled).toBe(true);
  });
});
