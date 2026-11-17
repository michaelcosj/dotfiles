// VimEditor: pi's prompt editor with vim modes. The engine (engine.ts) does
// the vim work; this class turns terminal input into engine keys, applies the
// engine's buffer to the editor, syncs the clipboard and draws the mode badge.
//
// Extend this class (not CustomEditor) to customise the editor and keep vim,
// as agent-bridge's child editor does.

import { execFile } from "node:child_process";
import {
  CustomEditor,
  type CustomEditorOptions,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  type EditorTheme,
  getNativeClipboard,
  matchesKey,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { vimState } from "./config.ts";
import {
  type Buf,
  clampNormal,
  clipboardText,
  InsertRemap,
  type Register,
  type Result,
  VimEngine,
} from "./engine.ts";

export type Clipboard = { read(): Promise<string | undefined>; write(text: string): Promise<void> };
export type VimEditorOptions = CustomEditorOptions & {
  /** pi's current theme, for the badge colors (ctx.ui.theme). */
  getTheme?: () => Theme;
  /** For tests. Default: pi-tui's native clipboard, then pbcopy/pbpaste. */
  clipboard?: Clipboard;
  /** For tests. */
  now?: () => number;
};

/** Private Editor fields that vim needs (pi-tui has no public cursor setter). */
type Internals = {
  state?: { lines: string[]; cursorLine: number; cursorCol: number };
  setCursorCol?(col: number): void;
  exitHistoryBrowsing?(): void;
  cancelAutocomplete?(): void;
  navigateHistory?(direction: -1 | 1): void;
  isInPaste?: boolean;
  lastAction?: unknown;
};

const CLIPBOARD_TIMEOUT_MS = 200;
const BADGE: Record<"insert" | "normal", { letter: string; color: "success" | "accent" }> = {
  insert: { letter: "I", color: "success" },
  normal: { letter: "N", color: "accent" },
};
const ARROWS = { up: "\x1b[A", down: "\x1b[B" } as const;

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[vim-editor] ${message}`);
}

function run(cmd: string, input?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(cmd, { timeout: 1000 }, (err, stdout) =>
      resolve(err ? undefined : stdout),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

export const systemClipboard: Clipboard = {
  async read() {
    try {
      const text = await getNativeClipboard()?.getText();
      if (typeof text === "string") return text;
    } catch {}
    return process.platform === "darwin" ? run("pbpaste") : undefined;
  },
  async write(text) {
    const native = getNativeClipboard();
    if (native?.setText) {
      try {
        await native.setText(text);
        return;
      } catch {}
    }
    if (process.platform === "darwin") await run("pbcopy", text);
  },
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);
}

export class VimEditor extends CustomEditor {
  readonly vim: VimEngine;
  private remap: InsertRemap;
  private remapKey = "";
  private wasEnabled: boolean;
  private waiting = false;
  private queue: string[] = [];
  private readonly getTheme?: () => Theme;
  private readonly clipboard: Clipboard;
  private readonly now: () => number;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    options: VimEditorOptions = {},
  ) {
    super(tui, theme, keybindings, options);
    this.getTheme = options.getTheme;
    this.clipboard = options.clipboard ?? systemClipboard;
    this.now = options.now ?? Date.now;
    this.vim = new VimEngine(this.buf());
    this.remap = new InsertRemap([]);
    this.wasEnabled = vimState().enabled;
  }

  get mode(): "insert" | "normal" {
    return this.vim.mode;
  }

  setText(text: string): void {
    super.setText(text);
    this.vim?.rebase(this.buf());
  }

  handleInput(data: string): void {
    if (this.waiting) {
      this.queue.push(data);
      return;
    }
    this.handleKey(data, false);
  }

  private handleKey(data: string, clipboardSynced: boolean): void {
    const state = vimState();
    if (state.enabled !== this.wasEnabled) {
      this.wasEnabled = state.enabled;
      this.vim.reset(this.buf());
    }
    // Disabled, mid-paste, or the autocomplete menu is open: pi handles the key.
    const self = this as unknown as Internals;
    if (
      !state.enabled ||
      self.isInPaste ||
      data.includes("\x1b[200~") ||
      this.isShowingAutocomplete()
    ) {
      this.passToPi(data);
      return;
    }
    const isEsc = matchesKey(data, "escape") || matchesKey(data, "ctrl+[");
    if (this.vim.mode === "insert") {
      if (isEsc) {
        this.remap.reset();
        this.apply(this.vim.feed("<esc>", this.buf()), data);
        return;
      }
      const ch = this.printable(data);
      if (ch === undefined) {
        this.remap.reset();
        this.passToPi(data);
        return;
      }
      if (this.updateRemap(state.remaps).feed(ch, this.now()) === "escape") {
        this.escapeFromRemap(ch);
        return;
      }
      this.passToPi(data);
      return;
    }
    const key = isEsc ? "<esc>" : this.normalKey(data);
    if (key === undefined) {
      // Enter, Tab, Ctrl keys and app shortcuts keep their pi meaning.
      this.vim.cancelPending();
      this.passToPi(data);
      return;
    }
    if (!clipboardSynced && state.clipboard === "unnamedplus" && this.vim.wantsRegister(key)) {
      this.waiting = true;
      void withTimeout(this.clipboard.read(), CLIPBOARD_TIMEOUT_MS)
        .then((text) => this.vim.syncClipboard(text))
        .catch(() => {})
        .finally(() => {
          this.waiting = false;
          this.handleKey(data, true);
          while (!this.waiting && this.queue.length) this.handleKey(this.queue.shift()!, false);
          this.tui.requestRender();
        });
      return;
    }
    this.apply(this.vim.feed(key, this.buf()), data);
  }

  /** The buffer as the engine sees it. */
  protected buf(): Buf {
    return { lines: this.getLines(), cursor: this.getCursor() };
  }

  private passToPi(data: string): void {
    const before = this.getText();
    super.handleInput(data);
    // A submitted prompt starts the next one in INSERT mode.
    if (before !== "" && this.getText() === "" && (matchesKey(data, "enter") || data === "\r"))
      this.vim.reset(this.buf());
  }

  private printable(data: string): string | undefined {
    const k = decodeKittyPrintable(data);
    if (k !== undefined) return k;
    return [...data].length === 1 && data >= " " && data !== "\x7f" ? data : undefined;
  }

  private normalKey(data: string): string | undefined {
    for (const name of ["up", "down", "left", "right"] as const)
      if (matchesKey(data, name)) return `<${name}>`;
    if (matchesKey(data, "backspace")) return "<bs>";
    if (matchesKey(data, "ctrl+r")) return "<c-r>";
    return this.printable(data);
  }

  private updateRemap(maps: string[]): InsertRemap {
    const key = maps.join("\0");
    if (key !== this.remapKey) {
      this.remapKey = key;
      this.remap = new InsertRemap(maps);
    }
    return this.remap;
  }

  /** Second key of a remap such as "jj": drop the first key that pi already typed, then act as Esc. */
  private escapeFromRemap(second: string): void {
    const b = this.buf();
    const line = b.lines[b.cursor.line]!;
    const first = [...this.remapKey.split("\0").find((m) => m.endsWith(second))!][0]!;
    const start = b.cursor.col - first.length;
    if (start >= 0 && line.slice(start, b.cursor.col) === first) {
      const lines = [...b.lines];
      lines[b.cursor.line] = line.slice(0, start) + line.slice(b.cursor.col);
      this.place({ lines, cursor: { line: b.cursor.line, col: start } }, true);
    }
    this.apply(this.vim.feed("<esc>", this.buf()), "");
  }

  private apply(r: Result, data: string): void {
    if (r.pass) {
      this.passToPi(data);
      return;
    }
    if (r.history) {
      const self = this as unknown as Internals;
      if (self.navigateHistory) {
        self.cancelAutocomplete?.();
        self.navigateHistory(r.history);
      } else {
        super.handleInput(r.history < 0 ? ARROWS.up : ARROWS.down);
      }
      this.vim.rebase(this.buf());
      this.place(clampNormal(this.buf()), false);
    }
    if (r.buf) this.place(r.buf, !!r.changed);
    if (r.yanked) this.copy(r.yanked);
    this.tui.requestRender();
  }

  private copy(r: Register): void {
    if (vimState().clipboard !== "unnamedplus") return;
    this.clipboard.write(clipboardText(r)).catch(() => warnOnce("could not write the clipboard"));
  }

  /**
   * Put the engine's buffer into the editor. Writes the private state so
   * paste markers ("[paste #1 +30 lines]") keep their content; setText()
   * would drop them.
   */
  protected place(b: Buf, changed: boolean): void {
    const self = this as unknown as Internals;
    const s = self.state;
    if (!s || !Array.isArray(s.lines) || typeof self.setCursorCol !== "function") {
      warnOnce("pi-tui internals changed; the cursor goes to the end after vim edits");
      if (changed) super.setText(b.lines.join("\n"));
      return;
    }
    if (changed) {
      self.cancelAutocomplete?.();
      self.exitHistoryBrowsing?.();
      self.lastAction = null;
      s.lines = [...b.lines];
    }
    s.cursorLine = Math.max(0, Math.min(b.cursor.line, s.lines.length - 1));
    self.setCursorCol(Math.max(0, Math.min(b.cursor.col, s.lines[s.cursorLine]!.length)));
    if (changed) this.onChange?.(this.getText());
  }

  /** Badge text and color for the current mode, or undefined when vim is off. */
  badge(): { text: string; color: "success" | "accent" } | undefined {
    if (!vimState().enabled) return undefined;
    const { letter, color } = BADGE[this.vim.mode];
    const pending = this.vim.pendingKeys;
    return { text: ` ${letter}${pending ? ` ${pending}` : ""} `, color };
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    const b = this.badge();
    if (!b) return super.renderBottomBorder(width, hiddenLineCount);
    const theme = this.getTheme?.();
    const label = theme ? theme.inverse(theme.fg(b.color, b.text)) : `\x1b[7m${b.text}\x1b[27m`;
    const tail = 2;
    const avail = width - visibleWidth(b.text) - tail;
    if (avail < 6) return super.renderBottomBorder(width, hiddenLineCount);
    let left = "─".repeat(avail);
    if (hiddenLineCount > 0) {
      const more = ` ↓ ${hiddenLineCount} more `;
      const w = visibleWidth(more);
      if (w + 2 <= avail) {
        const l = Math.floor((avail - w) / 2);
        left = "─".repeat(l) + more + "─".repeat(avail - l - w);
      }
    }
    return this.borderColor(left) + label + this.borderColor("─".repeat(tail));
  }
}
