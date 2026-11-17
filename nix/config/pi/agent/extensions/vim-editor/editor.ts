// VimEditor: pi's prompt editor with vim modes. The engine (engine.ts) does
// the vim work; this class turns terminal input into engine keys, applies the
// engine's buffer to the editor, syncs the clipboard, and draws the mode badge
// and the visual selection.
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
  CURSOR_MARKER,
  decodeKittyPrintable,
  type EditorTheme,
  getNativeClipboard,
  matchesKey,
  renderFakeCursor,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { vimState } from "./config.ts";
import {
  type Buf,
  clampNormal,
  clipboardText,
  InsertRemap,
  type Mode,
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
  // Render state, for the visual selection.
  scrollOffset?: number;
  renderedVisibleLineCount?: number;
  lastWidth?: number;
  paddingX?: number;
  buildVisualLineMap?(width: number): { logicalLine: number; startCol: number; length: number }[];
};

type BadgeColor = "success" | "accent" | "warning";

const CLIPBOARD_TIMEOUT_MS = 200;
const BADGE: Record<Mode, { letter: string; color: BadgeColor }> = {
  insert: { letter: "I", color: "success" },
  normal: { letter: "N", color: "accent" },
  visual: { letter: "V", color: "warning" },
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

  get mode(): Mode {
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
  badge(): { text: string; color: BadgeColor } | undefined {
    if (!vimState().enabled) return undefined;
    const { letter, color } = BADGE[this.vim.mode];
    const pending = this.vim.pendingKeys;
    return { text: ` ${letter}${pending ? ` ${pending}` : ""} `, color };
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (vimState().enabled && this.vim.mode === "visual") this.drawSelection(lines);
    return lines;
  }

  /**
   * Redraw the editor rows that hold the visual selection. Uses pi's own wrap
   * map, so wrapped lines line up. Draws nothing if pi-tui's internals changed
   * (the V badge still shows the mode).
   */
  private drawSelection(rows: string[]): void {
    const self = this as unknown as Internals;
    const sel = this.vim.selection(this.buf());
    const scroll = self.scrollOffset;
    const count = self.renderedVisibleLineCount;
    const layoutWidth = self.lastWidth;
    if (
      !sel ||
      scroll === undefined ||
      count === undefined ||
      !layoutWidth ||
      !self.buildVisualLineMap
    )
      return;
    const map = self.buildVisualLineMap(layoutWidth);
    const lines = this.getLines();
    const cursor = this.getCursor();
    const width = visibleWidth(rows[0] ?? "");
    const pad = " ".repeat(Math.min(self.paddingX ?? 0, Math.max(0, Math.floor((width - 1) / 2))));
    const theme = this.getTheme?.();
    const on = theme ? theme.getBgAnsi("selectedBg") : "\x1b[7m";
    const off = theme ? "\x1b[49m" : "\x1b[27m";
    const marker = this.focused ? CURSOR_MARKER : "";
    for (let i = 0; i < count; i++) {
      const vl = map[scroll + i];
      const row = i + 1;
      if (!vl || row >= rows.length - 1) continue;
      const l = vl.logicalLine;
      if (l < sel.start.line || l > sel.end.line) continue;
      const line = lines[l] ?? "";
      const a = vl.startCol;
      const b = vl.startCol + vl.length;
      // Selected columns on this logical line: [s, e).
      let s = l === sel.start.line ? sel.start.col : 0;
      let e = line.length;
      if (sel.kind === "char" && l === sel.end.line) e = Math.min(line.length, sel.end.col + 1);
      if (sel.kind === "char" && l === sel.end.line && sel.end.col < line.length) {
        const c = line.charCodeAt(sel.end.col);
        if (c >= 0xd800 && c <= 0xdbff) e = Math.min(line.length, sel.end.col + 2);
      }
      if (sel.kind === "line") s = 0;
      s = Math.max(s, a);
      e = Math.min(e, b);
      const isLastChunk = b >= line.length;
      // An empty line, or a char selection that runs on to the next line, shows one selected cell.
      const tail =
        isLastChunk &&
        (line.length === 0 || (sel.kind === "char" && l < sel.end.line && e >= line.length));
      const hasCursor = l === cursor.line && cursor.col >= a && (cursor.col < b || isLastChunk);
      let out = "";
      const cell = (text: string, col: number, selected: boolean) => {
        if (!text) return;
        if (hasCursor && col <= cursor.col && cursor.col < col + text.length) {
          const k = cursor.col - col;
          const g = [...text.slice(k)][0] ?? "";
          cell(text.slice(0, k), col, selected);
          out += marker + (selected ? on : "") + renderFakeCursor(g) + (selected ? off : "");
          cell(text.slice(k + g.length), cursor.col + g.length, selected);
          return;
        }
        out += selected ? on + text + off : text;
      };
      cell(line.slice(a, Math.max(a, s)), a, false);
      if (e > s) cell(line.slice(s, e), s, true);
      cell(line.slice(Math.max(a, e, s), b), Math.max(a, e, s), false);
      if (hasCursor && cursor.col >= b) out += marker + renderFakeCursor(" ");
      else if (tail) out += `${on} ${off}`;
      const body = pad + out;
      const used = visibleWidth(body);
      rows[row] =
        used >= width ? truncateToWidth(body, width, "") : body + " ".repeat(width - used);
    }
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
