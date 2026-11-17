// Pure text helpers for the vim engine: character classes, word motions,
// character search, bracket matching and text objects. No pi imports.
//
// Positions are JS string indices. Multi-line motions work on the flat text
// (lines joined with "\n") and an offset into it.

export type Pos = { line: number; col: number };

const WORD = /[\p{L}\p{N}_]/u;

/** 0 = blank (space, tab, newline), 1 = word, 2 = punctuation. With `big`, all non-blanks are 1. */
export function cls(ch: string | undefined, big = false): 0 | 1 | 2 {
  if (ch === undefined || ch === " " || ch === "\t" || ch === "\n") return 0;
  if (big) return 1;
  return WORD.test(ch) ? 1 : 2;
}

export function isBlank(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

/** Index after the character at `i` (steps over surrogate pairs). */
export function nextIdx(s: string, i: number): number {
  const code = s.codePointAt(i);
  return i + (code !== undefined && code > 0xffff ? 2 : 1);
}

/** Index of the character before `i`. */
export function prevIdx(s: string, i: number): number {
  if (i <= 0) return 0;
  const c = s.charCodeAt(i - 1);
  return c >= 0xdc00 && c <= 0xdfff && i >= 2 ? i - 2 : i - 1;
}

/** Index of the last character, or 0 for an empty string. */
export function lastCharIdx(s: string): number {
  return s.length ? prevIdx(s, s.length) : 0;
}

export function firstNonBlank(s: string): number {
  let i = 0;
  while (i < s.length && isBlank(s[i])) i++;
  return i < s.length ? i : lastCharIdx(s);
}

export function toOff(lines: string[], p: Pos): number {
  let o = 0;
  for (let i = 0; i < p.line; i++) o += lines[i]!.length + 1;
  return o + p.col;
}

export function fromOff(lines: string[], off: number): Pos {
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i]!.length;
    if (off <= len) return { line: i, col: Math.max(0, off) };
    off -= len + 1;
  }
  const last = lines.length - 1;
  return { line: last, col: lines[last]!.length };
}

/** `w`/`W`: start of the next word. Stops on empty lines. Returns text.length at the end. */
export function wordForward(text: string, off: number, big: boolean): number {
  const L = text.length;
  let p = off;
  if (p >= L) return L;
  const c = cls(text[p], big);
  if (c !== 0) while (p < L && cls(text[p], big) === c) p++;
  while (p < L && cls(text[p], big) === 0) {
    p++;
    if (text[p - 1] === "\n" && (p === L || text[p] === "\n")) break;
  }
  return p;
}

/** `e`/`E`: end of the current or next word (inclusive). */
export function wordEnd(text: string, off: number, big: boolean): number {
  const L = text.length;
  if (L === 0) return 0;
  let p = off + 1;
  while (p < L && cls(text[p], big) === 0) p++;
  if (p >= L) return L - 1;
  const c = cls(text[p], big);
  while (p + 1 < L && cls(text[p + 1], big) === c) p++;
  return p;
}

/** `b`/`B`: start of the current or previous word. Stops on empty lines. */
export function wordBackward(text: string, off: number, big: boolean): number {
  let p = off - 1;
  if (p < 0) return 0;
  while (p >= 0 && cls(text[p], big) === 0) {
    if (text[p] === "\n" && (p === 0 || text[p - 1] === "\n")) return p;
    p--;
  }
  if (p < 0) return 0;
  const c = cls(text[p], big);
  while (p > 0 && cls(text[p - 1], big) === c) p--;
  return p;
}

/** End of the run of same-class characters that holds `off` (for `cw`). */
export function runEnd(text: string, off: number, big: boolean): number {
  const c = cls(text[off], big);
  let p = off;
  while (p + 1 < text.length && text[p + 1] !== "\n" && cls(text[p + 1], big) === c) p++;
  return p;
}

export type FindKind = "f" | "F" | "t" | "T";

/** f/F/t/T on one line. Returns the target column or null. `repeat` skips an adjacent match for t/T. */
export function findChar(
  line: string,
  col: number,
  kind: FindKind,
  ch: string,
  count: number,
  repeat = false,
): number | null {
  let p = col;
  if (kind === "f" || kind === "t") {
    if (kind === "t" && repeat) p++;
    for (let i = 0; i < count; i++) {
      p = line.indexOf(ch, p + 1);
      if (p < 0) return null;
    }
    return kind === "f" ? p : p - 1;
  }
  if (kind === "T" && repeat) p--;
  for (let i = 0; i < count; i++) {
    if (p - 1 < 0) return null;
    p = line.lastIndexOf(ch, p - 1);
    if (p < 0) return null;
  }
  return kind === "F" ? p : p + 1;
}

export function reverseFind(kind: FindKind): FindKind {
  return ({ f: "F", F: "f", t: "T", T: "t" } as const)[kind];
}

const PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"],
  ")": ["(", ")"],
  b: ["(", ")"],
  "[": ["[", "]"],
  "]": ["[", "]"],
  "{": ["{", "}"],
  "}": ["{", "}"],
  B: ["{", "}"],
  "<": ["<", ">"],
  ">": ["<", ">"],
};
const QUOTES = new Set(['"', "'", "`"]);
export const TEXT_OBJECTS = new Set(["w", "W", ...QUOTES, ...Object.keys(PAIRS)]);

function findOpen(text: string, off: number, open: string, close: string): number {
  if (text[off] === open) return off;
  let depth = 0;
  for (let p = off - 1; p >= 0; p--) {
    if (text[p] === close) depth++;
    else if (text[p] === open) {
      if (depth === 0) return p;
      depth--;
    }
  }
  return -1;
}

function findClose(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let p = from; p < text.length; p++) {
    if (text[p] === open) depth++;
    else if (text[p] === close) {
      if (depth === 0) return p;
      depth--;
    }
  }
  return -1;
}

/** `%`: offset of the bracket that matches the first bracket at or after the cursor on its line. */
export function matchPair(text: string, off: number): number | null {
  let p = off;
  while (p < text.length && text[p] !== "\n" && !"()[]{}".includes(text[p]!)) p++;
  const ch = text[p];
  if (ch === undefined || !"()[]{}".includes(ch)) return null;
  const [open, close] = PAIRS[ch]!;
  if (ch === open) {
    const e = findClose(text, p + 1, open, close);
    return e < 0 ? null : e;
  }
  const s = findOpen(text, p, open, close);
  return s < 0 ? null : s;
}

function extendBlanks(line: string, s: number, e: number): [number, number] {
  let e2 = e;
  while (e2 < line.length && isBlank(line[e2])) e2++;
  if (e2 > e) return [s, e2];
  let s2 = s;
  while (s2 > 0 && isBlank(line[s2 - 1])) s2--;
  return [s2, e];
}

function wordObject(
  line: string,
  col: number,
  inner: boolean,
  big: boolean,
): [number, number] | null {
  if (line.length === 0) return null;
  const c = Math.min(col, line.length - 1);
  const k = cls(line[c], big);
  let s = c;
  let e = c + 1;
  while (s > 0 && cls(line[s - 1], big) === k) s--;
  while (e < line.length && cls(line[e], big) === k) e++;
  if (inner) return [s, e];
  if (k === 0) {
    if (e >= line.length) return [s, e];
    const k2 = cls(line[e], big);
    while (e < line.length && cls(line[e], big) === k2) e++;
    return [s, e];
  }
  return extendBlanks(line, s, e);
}

function quoteObject(
  line: string,
  col: number,
  q: string,
  inner: boolean,
): [number, number] | null {
  const pos: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === q && line[i - 1] !== "\\") pos.push(i);
  if (pos.length < 2) return null;
  let open: number | undefined;
  let close: number | undefined;
  const at = pos.indexOf(col);
  if (at >= 0) {
    if (at % 2 === 0) [open, close] = [pos[at], pos[at + 1]];
    else [open, close] = [pos[at - 1], pos[at]];
  } else {
    const left = pos.filter((p) => p < col).pop();
    const right = pos.find((p) => p > col);
    if (left !== undefined && right !== undefined) [open, close] = [left, right];
    else if (left === undefined) [open, close] = pos.filter((p) => p > col);
  }
  if (open === undefined || close === undefined) return null;
  if (inner) return [open + 1, close];
  return extendBlanks(line, open, close + 1);
}

function bracketObject(
  text: string,
  off: number,
  ch: string,
  inner: boolean,
): [number, number] | null {
  const [open, close] = PAIRS[ch]!;
  const s = findOpen(text, off, open, close);
  if (s < 0) return null;
  const e = findClose(text, s + 1, open, close);
  if (e < 0) return null;
  if (!inner) return [s, e + 1];
  let is = s + 1;
  let ie = e;
  // Multi-line block: keep the brackets on their own lines.
  if (text[is] === "\n") is++;
  const nl = text.lastIndexOf("\n", ie - 1);
  if (nl >= is && text.slice(nl + 1, ie).trim() === "") ie = nl;
  return is <= ie ? [is, ie] : [s + 1, e];
}

/** Text object range [start, end) as flat offsets, or null. */
export function textObject(
  lines: string[],
  cur: Pos,
  ch: string,
  inner: boolean,
): [number, number] | null {
  const line = lines[cur.line]!;
  const base = toOff(lines, { line: cur.line, col: 0 });
  const local = (r: [number, number] | null): [number, number] | null =>
    r ? [r[0] + base, r[1] + base] : null;
  if (ch === "w" || ch === "W") return local(wordObject(line, cur.col, inner, ch === "W"));
  if (QUOTES.has(ch)) return local(quoteObject(line, cur.col, ch, inner));
  if (PAIRS[ch]) return bracketObject(lines.join("\n"), toOff(lines, cur), ch, inner);
  return null;
}
