// Pure vim state machine for pi's prompt editor. No pi imports.
//
// The editor gives the engine one key and the current buffer; the engine
// returns the new buffer (or asks the editor to pass the key to pi). INSERT
// mode typing stays in pi's editor (autocomplete, paste, kill ring); the
// engine only sees the Esc that ends it, and diffs the buffer to record the
// typed text for `.` and undo.
//
// Keys: one printable character ("w", "$", "é"), or a name in angle
// brackets: <esc> <up> <down> <left> <right> <bs> <c-r>.

import * as M from "./motions.ts";

export type Pos = M.Pos;
export type Mode = "insert" | "normal";
export type Buf = { lines: string[]; cursor: Pos };
export type Register = { text: string; linewise: boolean };
export type Result = {
  /** New buffer to apply. */
  buf?: Buf;
  /** The text changed (not only the cursor). */
  changed?: boolean;
  /** Give the original key to pi unchanged. */
  pass?: boolean;
  /** Let pi browse prompt history: -1 older, 1 newer. */
  history?: -1 | 1;
  /** The register was written; copy it to the clipboard. */
  yanked?: Register;
};

type Op = "d" | "c" | "y" | ">" | "<";
type Cmd = {
  count: number;
  countGiven: boolean;
  op?: Op;
  /** Motion name, "line" (dd/cc/yy), "obj" (text object) or a command. */
  name: string;
  arg?: string;
  inner?: boolean;
};
type Parsed = { status: "more" } | { status: "bad" } | { status: "ok"; cmd: Cmd };
type Motion = {
  pos: Pos;
  linewise?: boolean;
  inclusive?: boolean;
  vertical?: boolean;
  wantEnd?: boolean;
};
type Exec = {
  buf: Buf;
  changed?: boolean;
  insert?: boolean;
  yanked?: Register;
  history?: -1 | 1;
  vertical?: boolean;
  wantEnd?: boolean;
};
type InsertSession = { before: Buf; start: Buf; keys: string[] };

const OPS = new Set(["d", "c", "y", ">", "<"]);
const MOTIONS = new Set([
  "h",
  "j",
  "k",
  "l",
  " ",
  "<bs>",
  "<left>",
  "<right>",
  "<up>",
  "<down>",
  "w",
  "W",
  "e",
  "E",
  "b",
  "B",
  "0",
  "^",
  "$",
  "G",
  ";",
  ",",
  "%",
]);
const COMMANDS = new Set([
  "x",
  "X",
  "s",
  "S",
  "C",
  "D",
  "Y",
  "~",
  "J",
  "p",
  "P",
  "u",
  "<c-r>",
  ".",
  "i",
  "I",
  "a",
  "A",
  "o",
  "O",
]);
/** Commands that are an operator plus a motion. */
const ALIASES: Record<string, [Op, string]> = {
  x: ["d", "l"],
  X: ["d", "h"],
  s: ["c", "l"],
  S: ["c", "line"],
  C: ["c", "$"],
  D: ["d", "$"],
  Y: ["y", "line"],
};
const INDENT = "  ";
const UNDO_LIMIT = 200;
const MAX_COUNT = 10_000;

const isDigit = (k: string | undefined) =>
  k !== undefined && k.length === 1 && k >= "0" && k <= "9";
const isChar = (k: string | undefined) => k !== undefined && !(k.startsWith("<") && k.length > 1);
const flat = (b: Buf) => b.lines.join("\n");
const fromText = (text: string, cursor: Pos): Buf => ({ lines: text.split("\n"), cursor });
const copy = (b: Buf): Buf => ({ lines: [...b.lines], cursor: { ...b.cursor } });

export function parse(keys: string[]): Parsed {
  let i = 0;
  const count = (): number | undefined => {
    let s = "";
    while (isDigit(keys[i]) && !(s === "" && keys[i] === "0")) s += keys[i++];
    return s ? Math.min(Number(s), MAX_COUNT) : undefined;
  };
  const more = { status: "more" } as const;
  const bad = { status: "bad" } as const;
  const c1 = count();
  if (i >= keys.length) return more;
  let k = keys[i++]!;
  let op: Op | undefined;
  let c2: number | undefined;
  if (OPS.has(k)) {
    op = k as Op;
    c2 = count();
    if (i >= keys.length) return more;
    k = keys[i++]!;
  }
  const n = c1 !== undefined && c2 !== undefined ? c1 * c2 : (c1 ?? c2);
  const base = { count: n ?? 1, countGiven: n !== undefined, op };
  const ok = (name: string, extra: Partial<Cmd> = {}): Parsed => ({
    status: "ok",
    cmd: { ...base, name, ...extra },
  });

  if (op) {
    if (k === op) return ok("line");
    if (k === "i" || k === "a") {
      if (i >= keys.length) return more;
      const ch = keys[i++]!;
      return M.TEXT_OBJECTS.has(ch) ? ok("obj", { arg: ch, inner: k === "i" }) : bad;
    }
  }
  if (k === "g") {
    if (i >= keys.length) return more;
    return keys[i++] === "g" ? ok("gg") : bad;
  }
  if ("fFtT".includes(k) && k.length === 1) {
    if (i >= keys.length) return more;
    const ch = keys[i++]!;
    return isChar(ch) ? ok(k, { arg: ch }) : bad;
  }
  if (MOTIONS.has(k)) return ok(k);
  if (op) return bad;
  if (k === "r") {
    if (i >= keys.length) return more;
    const ch = keys[i++]!;
    return isChar(ch) ? ok("r", { arg: ch }) : bad;
  }
  return COMMANDS.has(k) ? ok(k) : bad;
}

/** The register as the clipboard holds it: linewise text ends with a newline. */
export function clipboardText(r: Register): string {
  return r.linewise ? `${r.text}\n` : r.text;
}

/** Text typed in INSERT mode: what `after` adds to `before` (common prefix and suffix removed). */
export function insertedText(before: string, after: string): string {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++;
  return after.slice(p, after.length - s);
}

/** Cursor rules for NORMAL mode: on a character, never past the last one. */
export function clampNormal(b: Buf): Buf {
  const line = Math.max(0, Math.min(b.cursor.line, b.lines.length - 1));
  const text = b.lines[line] ?? "";
  let col = Math.max(0, Math.min(b.cursor.col, M.lastCharIdx(text)));
  const c = text.charCodeAt(col);
  if (c >= 0xdc00 && c <= 0xdfff && col > 0) col--;
  return { lines: b.lines, cursor: { line, col } };
}

/** Two-key INSERT remaps such as "jj" -> Esc, with Claude Code's one-second rule. */
export class InsertRemap {
  private pending: { ch: string; at: number } | undefined;
  constructor(
    private readonly maps: string[],
    private readonly windowMs = 1000,
  ) {}

  /** "escape": delete the pending first key, then act as Esc. "insert": type the key. */
  feed(ch: string, now: number): "insert" | "escape" {
    const p = this.pending;
    this.pending = undefined;
    if (p && now - p.at <= this.windowMs && this.maps.includes(p.ch + ch)) return "escape";
    if (this.maps.some((m) => m[0] === ch)) this.pending = { ch, at: now };
    return "insert";
  }

  /** Any other key (cursor move, Enter, paste) breaks the sequence. */
  reset(): void {
    this.pending = undefined;
  }
}

export class VimEngine {
  mode: Mode = "insert";
  register: Register | undefined;
  private pending: string[] = [];
  private undoStack: Buf[] = [];
  private redoStack: Buf[] = [];
  private lastFind: { kind: M.FindKind; ch: string } | undefined;
  private lastChange: { keys: string[]; insert?: string } | undefined;
  private session: InsertSession | undefined;
  private wantCol = 0;

  constructor(buf: Buf = { lines: [""], cursor: { line: 0, col: 0 } }) {
    this.reset(buf);
  }

  /** Start fresh in INSERT mode (new editor, or the prompt was submitted). */
  reset(buf: Buf): void {
    this.mode = "insert";
    this.pending = [];
    this.undoStack = [];
    this.redoStack = [];
    this.session = { before: copy(buf), start: copy(buf), keys: ["i"] };
  }

  /** The text was replaced from outside (history, an extension). Keep mode and undo. */
  rebase(buf: Buf): void {
    this.pending = [];
    if (this.session) this.session = { ...this.session, before: copy(buf), start: copy(buf) };
  }

  /** Keys of a half-typed command, for the mode badge. */
  get pendingKeys(): string {
    return this.pending.filter(isChar).join("");
  }

  /** Drop a half-typed command. */
  cancelPending(): void {
    this.pending = [];
  }

  /** The next key would paste, so the editor should read the clipboard first. */
  wantsRegister(key: string): boolean {
    if (this.mode !== "normal" || (key !== "p" && key !== "P")) return false;
    return this.pending.every(isDigit);
  }

  /** Take text from the system clipboard as the register, unless it is what we wrote. */
  syncClipboard(text: string | undefined | null): void {
    if (text === undefined || text === null || text === "") return;
    if (this.register && clipboardText(this.register) === text) return;
    const linewise = text.endsWith("\n");
    this.register = { text: linewise ? text.slice(0, -1) : text, linewise };
  }

  feed(key: string, buf: Buf): Result {
    if (this.mode === "insert") {
      if (key === "<esc>") return this.finishInsert(buf);
      return { pass: true };
    }
    if (key === "<esc>") {
      if (this.pending.length === 0) return { pass: true };
      this.pending = [];
      return {};
    }
    this.pending.push(key);
    const keys = this.pending;
    const parsed = parse(keys);
    if (parsed.status === "more") return {};
    this.pending = [];
    if (parsed.status === "bad") return {};
    return this.run(parsed.cmd, keys, buf);
  }

  private run(cmd: Cmd, keys: string[], buf: Buf): Result {
    if (cmd.name === "u") return this.undo(cmd.count, buf);
    if (cmd.name === "<c-r>") return this.redo(cmd.count, buf);
    if (cmd.name === ".") return this.repeat(cmd, buf);
    const r = this.exec(cmd, buf);
    if (!r) return {};
    if (r.insert) {
      this.mode = "insert";
      this.session = { before: copy(buf), start: copy(r.buf), keys };
      return { buf: r.buf, changed: r.changed, yanked: r.yanked };
    }
    if (r.changed) {
      this.pushUndo(buf);
      this.lastChange = { keys };
    }
    const out = clampNormal(r.buf);
    if (!r.vertical) this.wantCol = r.wantEnd ? Number.POSITIVE_INFINITY : out.cursor.col;
    return { buf: out, changed: r.changed, yanked: r.yanked, history: r.history };
  }

  private finishInsert(buf: Buf): Result {
    const s = this.session;
    this.mode = "normal";
    this.session = undefined;
    this.pending = [];
    if (s && flat(buf) !== flat(s.before)) {
      this.pushUndo(s.before);
      this.lastChange = { keys: s.keys, insert: insertedText(flat(s.start), flat(buf)) };
    }
    const { line, col } = buf.cursor;
    const out = clampNormal({
      lines: buf.lines,
      cursor: { line, col: M.prevIdx(buf.lines[line] ?? "", col) },
    });
    this.wantCol = out.cursor.col;
    return { buf: out };
  }

  private pushUndo(b: Buf): void {
    this.undoStack.push(copy(b));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(count: number, buf: Buf): Result {
    let cur = buf;
    for (let i = 0; i < count; i++) {
      const prev = this.undoStack.pop();
      if (!prev) break;
      this.redoStack.push(copy(cur));
      cur = prev;
    }
    if (cur === buf) return {};
    return { buf: clampNormal(cur), changed: true };
  }

  private redo(count: number, buf: Buf): Result {
    let cur = buf;
    for (let i = 0; i < count; i++) {
      const next = this.redoStack.pop();
      if (!next) break;
      this.undoStack.push(copy(cur));
      cur = next;
    }
    if (cur === buf) return {};
    return { buf: clampNormal(cur), changed: true };
  }

  private repeat(cmd: Cmd, buf: Buf): Result {
    const lc = this.lastChange;
    if (!lc) return {};
    let keys = lc.keys;
    if (cmd.countGiven) {
      let i = 0;
      while (isDigit(keys[i]) && !(i === 0 && keys[i] === "0")) i++;
      keys = [...String(cmd.count), ...keys.slice(i)];
    }
    const parsed = parse(keys);
    if (parsed.status !== "ok") return {};
    const r = this.exec(parsed.cmd, buf);
    if (!r) return {};
    let out = r.buf;
    if (r.insert) {
      const text = flat(out);
      const off = M.toOff(out.lines, out.cursor);
      const ins = lc.insert ?? "";
      const next = fromText(text.slice(0, off) + ins + text.slice(off), { line: 0, col: 0 });
      const end = M.fromOff(next.lines, off + ins.length);
      out = {
        lines: next.lines,
        cursor: { line: end.line, col: M.prevIdx(next.lines[end.line]!, end.col) },
      };
    }
    const changed = flat(out) !== flat(buf);
    if (changed) this.pushUndo(buf);
    out = clampNormal(out);
    this.wantCol = out.cursor.col;
    return { buf: out, changed, yanked: r.yanked };
  }

  // ---- motions ----

  private motion(cmd: Cmd, buf: Buf): Motion | { history: -1 | 1 } | null {
    const { lines, cursor } = buf;
    const line = lines[cursor.line]!;
    const n = cmd.count;
    const forOp = cmd.op !== undefined;
    const at = (col: number, l = cursor.line): Pos => ({ line: l, col });
    const flatMotion = (fn: (text: string, off: number) => number, inclusive = false): Motion => {
      const text = lines.join("\n");
      let off = M.toOff(lines, cursor);
      for (let i = 0; i < n; i++) off = fn(text, off);
      return { pos: M.fromOff(lines, off), inclusive };
    };
    switch (cmd.name) {
      case "h":
      case "<left>":
      case "<bs>": {
        let col = cursor.col;
        for (let i = 0; i < n && col > 0; i++) col = M.prevIdx(line, col);
        return { pos: at(col) };
      }
      case "l":
      case "<right>":
      case " ": {
        const max = forOp ? line.length : M.lastCharIdx(line);
        let col = cursor.col;
        for (let i = 0; i < n && col < max; i++) col = M.nextIdx(line, col);
        return { pos: at(Math.min(col, max)) };
      }
      case "0":
        return { pos: at(0) };
      case "^":
        return { pos: at(M.firstNonBlank(line)) };
      case "$": {
        const l = Math.min(cursor.line + n - 1, lines.length - 1);
        return { pos: at(M.lastCharIdx(lines[l]!), l), inclusive: true, wantEnd: true };
      }
      case "j":
      case "<down>":
      case "k":
      case "<up>": {
        const dir = cmd.name === "j" || cmd.name === "<down>" ? 1 : -1;
        const target = Math.max(0, Math.min(lines.length - 1, cursor.line + dir * n));
        if (target === cursor.line) return forOp ? null : { history: dir as -1 | 1 };
        const tl = lines[target]!;
        return {
          pos: at(Math.min(this.wantCol, M.lastCharIdx(tl)), target),
          linewise: true,
          vertical: true,
        };
      }
      case "gg":
      case "G": {
        const l = cmd.countGiven
          ? Math.min(n, lines.length) - 1
          : cmd.name === "gg"
            ? 0
            : lines.length - 1;
        return { pos: at(M.firstNonBlank(lines[l]!), l), linewise: true };
      }
      case "w":
      case "W": {
        const big = cmd.name === "W";
        const text = lines.join("\n");
        const start = M.toOff(lines, cursor);
        // `cw` on a word changes to its end, like `ce`, without the blanks after it.
        if (cmd.op === "c" && M.cls(text[start]) !== 0) {
          let off = M.runEnd(text, start, big);
          for (let i = 1; i < n; i++) off = M.wordEnd(text, off, big);
          return { pos: M.fromOff(lines, off), inclusive: true };
        }
        let off = start;
        for (let i = 0; i < n; i++) off = M.wordForward(text, off, big);
        // An operator stops at the end of the line that holds the last word.
        if (forOp && text.slice(start, off).includes("\n")) {
          let q = off;
          while (q > start && M.cls(text[q - 1]) === 0) q--;
          const eol = text.indexOf("\n", q);
          if (eol >= 0 && eol < off) off = eol;
        }
        return { pos: M.fromOff(lines, off) };
      }
      case "e":
      case "E":
        return flatMotion((t, o) => M.wordEnd(t, o, cmd.name === "E"), true);
      case "b":
      case "B":
        return flatMotion((t, o) => M.wordBackward(t, o, cmd.name === "B"));
      case "f":
      case "F":
      case "t":
      case "T":
      case ";":
      case ",": {
        let kind: M.FindKind;
        let ch: string;
        let repeat = false;
        if (cmd.arg !== undefined) {
          kind = cmd.name as M.FindKind;
          ch = cmd.arg;
          this.lastFind = { kind, ch };
        } else {
          if (!this.lastFind) return null;
          kind = cmd.name === ";" ? this.lastFind.kind : M.reverseFind(this.lastFind.kind);
          ch = this.lastFind.ch;
          repeat = true;
        }
        const col = M.findChar(line, cursor.col, kind, ch, n, repeat);
        if (col === null) return null;
        return { pos: at(col), inclusive: kind === "f" || kind === "t" };
      }
      case "%": {
        const text = lines.join("\n");
        const off = M.matchPair(text, M.toOff(lines, cursor));
        return off === null ? null : { pos: M.fromOff(lines, off), inclusive: true };
      }
    }
    return null;
  }

  // ---- commands ----

  private exec(cmd: Cmd, buf: Buf): Exec | null {
    const alias = ALIASES[cmd.name];
    if (alias) {
      if (cmd.name === "Y") return this.operate({ ...cmd, op: "y", name: "line" }, buf);
      return this.exec({ ...cmd, op: alias[0], name: alias[1] }, buf);
    }
    if (cmd.op) return this.operate(cmd, buf);
    const { lines, cursor } = buf;
    const line = lines[cursor.line]!;
    const n = cmd.count;
    const setLine = (text: string, col: number): Buf => {
      const next = [...lines];
      next[cursor.line] = text;
      return { lines: next, cursor: { line: cursor.line, col } };
    };
    switch (cmd.name) {
      case "i":
        return { buf, insert: true };
      case "a":
        return { buf: setLine(line, line.length ? M.nextIdx(line, cursor.col) : 0), insert: true };
      case "I":
        return {
          buf: setLine(
            line,
            M.firstNonBlank(line) === M.lastCharIdx(line) && M.isBlank(line[M.lastCharIdx(line)])
              ? line.length
              : M.firstNonBlank(line),
          ),
          insert: true,
        };
      case "A":
        return { buf: setLine(line, line.length), insert: true };
      case "o":
      case "O": {
        const at = cmd.name === "o" ? cursor.line + 1 : cursor.line;
        const next = [...lines];
        next.splice(at, 0, "");
        return { buf: { lines: next, cursor: { line: at, col: 0 } }, changed: true, insert: true };
      }
      case "r": {
        let end = cursor.col;
        for (let i = 0; i < n; i++) {
          if (end >= line.length) return null;
          end = M.nextIdx(line, end);
        }
        const rep = cmd.arg!.repeat(n);
        return {
          buf: setLine(
            line.slice(0, cursor.col) + rep + line.slice(end),
            cursor.col + rep.length - cmd.arg!.length,
          ),
          changed: true,
        };
      }
      case "~": {
        if (!line.length) return null;
        let end = cursor.col;
        for (let i = 0; i < n && end < line.length; i++) end = M.nextIdx(line, end);
        const seg = [...line.slice(cursor.col, end)]
          .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
          .join("");
        return {
          buf: setLine(line.slice(0, cursor.col) + seg + line.slice(end), end),
          changed: true,
        };
      }
      case "J": {
        const joins = Math.max(1, n - 1);
        if (cursor.line + 1 >= lines.length) return null;
        let text = line;
        let col = 0;
        let i = 1;
        for (; i <= joins && cursor.line + i < lines.length; i++) {
          const next = lines[cursor.line + i]!.replace(/^[ \t]+/, "");
          const sep =
            text === "" || next === "" || /[ \t]$/.test(text) || next.startsWith(")") ? "" : " ";
          col = text.length;
          text = text + sep + next;
        }
        const out = [...lines];
        out.splice(cursor.line, i, text);
        return { buf: { lines: out, cursor: { line: cursor.line, col } }, changed: true };
      }
      case "p":
      case "P":
        return this.put(cmd.name === "p", n, buf);
    }
    const m = this.motion(cmd, buf);
    if (!m) return null;
    if ("history" in m) return { buf, history: m.history };
    return { buf: { lines, cursor: m.pos }, vertical: m.vertical, wantEnd: m.wantEnd };
  }

  private put(after: boolean, n: number, buf: Buf): Exec | null {
    const r = this.register;
    if (!r) return null;
    const { lines, cursor } = buf;
    if (r.linewise) {
      const block = Array.from({ length: n }, () => r.text.split("\n")).flat();
      const at = after ? cursor.line + 1 : cursor.line;
      const next = [...lines];
      next.splice(at, 0, ...block);
      return {
        buf: { lines: next, cursor: { line: at, col: M.firstNonBlank(block[0]!) } },
        changed: true,
      };
    }
    const text = lines.join("\n");
    const line = lines[cursor.line]!;
    const col = after && line.length ? M.nextIdx(line, cursor.col) : cursor.col;
    const off = M.toOff(lines, { line: cursor.line, col });
    const ins = r.text.repeat(n);
    const next = fromText(text.slice(0, off) + ins + text.slice(off), { line: 0, col: 0 });
    // The cursor goes to the last pasted character (a multi-line paste: its start).
    const end = ins.includes("\n") ? off : off + ins.length - 1;
    return {
      buf: { lines: next.lines, cursor: M.fromOff(next.lines, Math.max(off, end)) },
      changed: true,
    };
  }

  private operate(cmd: Cmd, buf: Buf): Exec | null {
    const { lines, cursor } = buf;
    const op = cmd.op!;
    if (cmd.name === "line") {
      const l2 = Math.min(cursor.line + cmd.count - 1, lines.length - 1);
      return this.lineOp(op, cursor.line, l2, buf);
    }
    const text = lines.join("\n");
    const off = M.toOff(lines, cursor);
    let s: number;
    let e: number;
    if (cmd.name === "obj") {
      const r = M.textObject(lines, cursor, cmd.arg!, cmd.inner!);
      if (!r) return null;
      [s, e] = r;
    } else {
      const m = this.motion(cmd, buf);
      if (!m || "history" in m) return null;
      if (m.linewise)
        return this.lineOp(
          op,
          Math.min(cursor.line, m.pos.line),
          Math.max(cursor.line, m.pos.line),
          buf,
        );
      const t = M.toOff(lines, m.pos);
      s = Math.min(off, t);
      e = Math.max(off, t);
      if (m.inclusive) {
        const p = M.fromOff(lines, e);
        const l = lines[p.line]!;
        e = M.toOff(lines, { line: p.line, col: Math.min(M.nextIdx(l, p.col), l.length) });
      }
    }
    if (op === ">" || op === "<")
      return this.lineOp(
        op,
        M.fromOff(lines, s).line,
        M.fromOff(lines, Math.max(s, e - 1)).line,
        buf,
      );
    const removed = text.slice(s, e);
    const reg: Register = { text: removed, linewise: false };
    if (op === "y") {
      if (removed) this.register = reg;
      return { buf: { lines, cursor: M.fromOff(lines, s) }, yanked: removed ? reg : undefined };
    }
    if (s === e && op === "d") return null;
    if (removed) this.register = reg;
    // `di{` on a block deletes its whole inner lines; the cursor goes to the closing line.
    let cut = s;
    let land = s;
    if (op === "d" && cmd.name === "obj" && text[s - 1] === "\n" && text[e] === "\n") {
      cut = s - 1;
      land = s;
    }
    const next = fromText(text.slice(0, cut) + text.slice(e), { line: 0, col: 0 });
    return {
      buf: { lines: next.lines, cursor: M.fromOff(next.lines, land) },
      changed: s !== e,
      insert: op === "c",
      yanked: removed ? reg : undefined,
    };
  }

  private lineOp(op: Op, l1: number, l2: number, buf: Buf): Exec {
    const { lines, cursor } = buf;
    const reg: Register = { text: lines.slice(l1, l2 + 1).join("\n"), linewise: true };
    switch (op) {
      case "y":
        this.register = reg;
        return {
          buf: {
            lines,
            cursor: l1 === cursor.line ? cursor : { line: l1, col: M.firstNonBlank(lines[l1]!) },
          },
          yanked: reg,
        };
      case "d": {
        this.register = reg;
        const next = [...lines];
        next.splice(l1, l2 - l1 + 1);
        if (!next.length) next.push("");
        const l = Math.min(l1, next.length - 1);
        return {
          buf: { lines: next, cursor: { line: l, col: M.firstNonBlank(next[l]!) } },
          changed: true,
          yanked: reg,
        };
      }
      case "c": {
        this.register = reg;
        const next = [...lines];
        next.splice(l1, l2 - l1 + 1, "");
        return {
          buf: { lines: next, cursor: { line: l1, col: 0 } },
          changed: true,
          insert: true,
          yanked: reg,
        };
      }
      case ">":
      case "<": {
        const next = lines.map((l, i) => {
          if (i < l1 || i > l2) return l;
          if (op === ">") return l.length ? INDENT + l : l;
          return l.startsWith("\t")
            ? l.slice(1)
            : l.replace(new RegExp(`^ {1,${INDENT.length}}`), "");
        });
        const changed = next.some((l, i) => l !== lines[i]);
        return {
          buf: { lines: next, cursor: { line: l1, col: M.firstNonBlank(next[l1]!) } },
          changed,
        };
      }
    }
  }
}
