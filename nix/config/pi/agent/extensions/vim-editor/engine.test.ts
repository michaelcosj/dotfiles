// Run: bun test nix/config/pi/agent/extensions/vim-editor
import { describe, expect, test } from "bun:test";
import { type Buf, clipboardText, InsertRemap, insertedText, VimEngine } from "./engine.ts";

/** "foo b|ar" -> buffer with the cursor before "a". Lines split on "\n". */
function buf(s: string): Buf {
  const lines = s.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const col = lines[line]!.indexOf("|");
    if (col >= 0) {
      lines[line] = lines[line]!.slice(0, col) + lines[line]!.slice(col + 1);
      return { lines, cursor: { line, col } };
    }
  }
  return { lines, cursor: { line: 0, col: 0 } };
}

function show(b: Buf): string {
  return b.lines
    .map((l, i) =>
      i === b.cursor.line ? `${l.slice(0, b.cursor.col)}|${l.slice(b.cursor.col)}` : l,
    )
    .join("\n");
}

/** "d2w<esc>x" -> ["d", "2", "w", "<esc>", "x"] */
function keys(s: string): string[] {
  return s.match(/<[a-z-]+>|./gsu) ?? [];
}

/**
 * Runs keys in NORMAL mode. In INSERT mode, printable keys are typed at the
 * cursor (standing in for pi's editor) and named keys other than <esc> are ignored.
 */
function run(
  start: string,
  input: string,
  engine = normalEngine(start),
): { out: string; engine: VimEngine } {
  let b = buf(start);
  for (const k of keys(input)) {
    if (engine.mode === "insert" && k !== "<esc>") {
      if (k.length === 1 || !k.startsWith("<")) {
        const l = b.lines[b.cursor.line]!;
        if (k === "\n") {
          b.lines.splice(b.cursor.line, 1, l.slice(0, b.cursor.col), l.slice(b.cursor.col));
          b = { lines: b.lines, cursor: { line: b.cursor.line + 1, col: 0 } };
        } else {
          b.lines[b.cursor.line] = l.slice(0, b.cursor.col) + k + l.slice(b.cursor.col);
          b = { lines: b.lines, cursor: { line: b.cursor.line, col: b.cursor.col + k.length } };
        }
      }
      continue;
    }
    const r = engine.feed(k, b);
    if (r.buf) b = { lines: [...r.buf.lines], cursor: { ...r.buf.cursor } };
  }
  return { out: show(b), engine };
}

function normalEngine(start: string): VimEngine {
  const e = new VimEngine(buf(start));
  // Enter NORMAL mode without moving the cursor: <esc> moves one left, so start one right.
  const b = buf(start);
  const l = b.lines[b.cursor.line]!;
  e.feed("<esc>", {
    lines: b.lines,
    cursor: { line: b.cursor.line, col: Math.min(b.cursor.col + 1, l.length) },
  });
  return e;
}

const cases = (title: string, rows: [string, string, string][]) =>
  describe(title, () => {
    for (const [start, input, want] of rows) {
      test(`${JSON.stringify(start)} ${input} -> ${JSON.stringify(want)}`, () => {
        expect(run(start, input).out).toBe(want);
      });
    }
  });

cases("motions", [
  ["|foo bar baz", "w", "foo |bar baz"],
  ["|foo bar baz", "2w", "foo bar |baz"],
  ["|foo.bar baz", "w", "foo|.bar baz"],
  ["|foo.bar baz", "W", "foo.bar |baz"],
  ["foo |bar", "e", "foo ba|r"],
  ["f|oo bar", "e", "fo|o bar"],
  ["foo bar|", "b", "foo |bar"],
  ["foo ba|r", "b", "foo |bar"],
  ["foo.ba|r", "B", "|foo.bar"],
  ["  foo |bar", "^", "  |foo bar"],
  ["  foo |bar", "0", "|  foo bar"],
  ["|foo bar", "$", "foo ba|r"],
  ["|abc", "l", "a|bc"],
  ["ab|c", "l", "ab|c"],
  ["|abc", " ", "a|bc"],
  ["a|bc", "h", "|abc"],
  ["|one\ntwo", "j", "one\n|two"],
  ["one\nt|wo", "k", "o|ne\ntwo"],
  ["abc|def\nx\nabcdef", "jj", "abcdef\nx\nabc|def"],
  ["abc|def\nx", "$j", "abcdef\n|x"],
  ["ab|cdef\nxy\nabcdefgh", "$jj", "abcdef\nxy\nabcdefg|h"],
  ["a\nb\n|c", "gg", "|a\nb\nc"],
  ["|a\nb\n  c", "G", "a\nb\n  |c"],
  ["|a\nb\nc", "2G", "a\n|b\nc"],
  ["|a,b,c", "f,", "a|,b,c"],
  ["|a,b,c", "2f,", "a,b|,c"],
  ["|a,b,c", "f,;", "a,b|,c"],
  ["|a,b,c", "f,;,", "a|,b,c"],
  ["|a,b,c", "t,", "|a,b,c"],
  ["|ab,c,d", "t,", "a|b,c,d"],
  ["|ab,c,d", "t,;", "ab,|c,d"],
  ["a,b,|c", "F,", "a,b|,c"],
  ["a,b,|c", "T,", "a,b,|c"],
  ["a,bb,|c", "T,;", "a,|bb,c"],
  ["|f(a, (b))", "%", "f(a, (b)|)"],
  ["f(a, (b)|)", "%", "f|(a, (b))"],
  ["|x {\n  y\n}", "%", "x {\n  y\n|}"],
  ["|a b\n\nc", "w", "a |b\n\nc"],
  ["a |b\n\nc", "w", "a b\n|\nc"],
  ["a b\n|\nc", "w", "a b\n\n|c"],
  ["a b\n\n|c", "b", "a b\n|\nc"],
]);

cases("operators", [
  ["foo |bar baz", "dw", "foo |baz"],
  ["foo |bar baz", "d2w", "foo| "],
  ["foo |bar baz", "2dw", "foo| "],
  ["foo |bar\nbaz", "dw", "foo| \nbaz"],
  ["foo |bar baz", "de", "foo | baz"],
  ["foo |bar baz", "db", "|bar baz"],
  ["foo |bar baz", "d$", "foo| "],
  ["foo |bar baz", "D", "foo| "],
  ["foo |bar baz", "d0", "|bar baz"],
  ["|a,b,c", "df,", "|b,c"],
  ["|a,b,c", "dt,", "|,b,c"],
  ["one\n|two\nthree", "dd", "one\n|three"],
  ["one\n|two\nthree", "2dd", "|one"],
  ["one\ntwo\n|three", "dd", "one\n|two"],
  ["|only", "dd", "|"],
  ["one\n|two\nthree\nfour", "dj", "one\n|four"],
  ["one\ntwo\n|three", "dk", "|one"],
  ["one\n|two\nthree", "dG", "|one"],
  ["one\n|two\nthree", "dgg", "|three"],
  ["f(a, |b)", "d%", "f|)"],
  ["f|(a, b) x", "d%", "f| x"],
  ["|abc", "x", "|bc"],
  ["|abc", "2x", "|c"],
  ["ab|c", "x", "a|b"],
  ["ab|c", "X", "a|c"],
  ["|abc", "rx", "|xbc"],
  ["|abc", "3rx", "xx|x"],
  ["|abc", "4rx", "|abc"],
  ["|aBc", "~~~", "Ab|C"],
  ["one\n|two\nthree", "J", "one\ntwo| three"],
  ["|one\n  two", "J", "one| two"],
  ["|a\nb\nc", "3J", "a b| c"],
  ["|foo", ">>", "  |foo"],
  ["  |foo", "<<", "|foo"],
  ["|a\nb\nc", "2>>", "  |a\n  b\nc"],
  ["|a\nb", ">j", "  |a\n  b"],
]);

cases("change and insert", [
  ["foo |bar baz", "cwqux<esc>", "foo qu|x baz"],
  ["foo |bar baz", "cequx<esc>", "foo qu|x baz"],
  ["foo |bar baz", "Cend<esc>", "foo en|d"],
  ["foo\n  |bar\nbaz", "ccnew<esc>", "foo\nne|w\nbaz"],
  ["|abc", "sX<esc>", "|Xbc"],
  ["foo\n|bar", "Snew<esc>", "foo\nne|w"],
  ["a|bc", "iX<esc>", "a|Xbc"],
  ["a|bc", "aX<esc>", "ab|Xc"],
  ["  a|bc", "IX<esc>", "  |Xabc"],
  ["a|bc", "AX<esc>", "abc|X"],
  ["|one\ntwo", "onew<esc>", "one\nne|w\ntwo"],
  ["one\n|two", "Onew<esc>", "one\nne|w\ntwo"],
  ["ab|c", "i<esc>", "a|bc"],
  ["|abc", "i<esc>", "|abc"],
]);

cases("text objects", [
  ["foo b|ar baz", "diw", "foo | baz"],
  ["foo b|ar baz", "daw", "foo |baz"],
  ["foo b|ar", "daw", "fo|o"],
  ["a foo.b|ar b", "diW", "a | b"],
  ["a foo.b|ar b", "daW", "a |b"],
  ['say "h|i there" now', 'di"', 'say "|" now'],
  ['say "h|i there" now', 'da"', "say |now"],
  ['|say "hi"', 'ci"yo<esc>', 'say "y|o"'],
  ["say 'h|i'", "di'", "say '|'"],
  ["f(a, |b)", "di(", "f(|)"],
  ["f(a, |b)", "da(", "|f"],
  ["f(a, |b)", "dib", "f(|)"],
  ["f(a, (|b))", "di(", "f(a, (|))"],
  ["x[1, |2]", "di]", "x[|]"],
  ["x {\n  |y\n}", "di{", "x {\n|}"],
  ["x {\n  |y\n}", "da{", "x| "],
  ["x {\n  |y\n}", "ci{z<esc>", "x {\n|z\n}"],
  ["f(a, |b)", "yi(P", "f(a, |ba, b)"],
  ["no |parens", "di(", "no |parens"],
]);

cases("yank and put", [
  ["|foo bar", "ywP", "foo| foo bar"],
  ["|foo bar", "yw$p", "foo barfoo| "],
  ["|one\ntwo", "yyp", "one\n|one\ntwo"],
  ["|one\ntwo", "yyP", "|one\none\ntwo"],
  ["|one\ntwo", "Yjp", "one\ntwo\n|one"],
  ["|one\ntwo", "ddp", "two\n|one"],
  ["|ab", "xp", "b|a"],
  ["|ab", "x3p", "baa|a"],
  ["|one\ntwo", "yj$p", "one\n|one\ntwo\ntwo"],
  ["|a", "p", "|a"],
]);

cases("undo, redo, repeat", [
  ["|foo bar baz", "dwu", "|foo bar baz"],
  ["|foo bar baz", "dwdwuu", "|foo bar baz"],
  ["|foo bar baz", "dwdwuu<c-r>", "|bar baz"],
  ["|foo bar baz", "dwu<c-r><c-r>", "|bar baz"],
  ["|foo bar baz", "dw.", "|baz"],
  ["|a b c d e", "dw2.", "|d e"],
  ["|abc", "iXY<esc>u", "|abc"],
  ["|abc", "iXY<esc>lu", "|abc"],
  ["|foo bar", "cwqux<esc>w.", "qux qu|x"],
  ["|a\nb", "A;<esc>j.", "a;\nb|;"],
  ["|a\nb", "onew<esc>.", "a\nnew\nne|w\nb"],
  ["|abc", "x.", "|c"],
  ["|a\nb\nc", "dd.", "|c"],
  ["|abc", "rx.", "|xbc"],
  ["|abc", "rxl.", "x|xc"],
  ["|one two", "~.", "ON|e two"],
  ["|abc", "u", "|abc"],
]);

cases("visual mode", [
  ["|foo bar baz", "vlld", "| bar baz"],
  ["|foo bar baz", "vex", "| bar baz"],
  ["foo |bar baz", "vey$p", "foo bar bazba|r"],
  ["|foo bar", "vecqux<esc>", "qu|x bar"],
  ["|foo bar", "vesX<esc>", "|X bar"],
  ["foo b|ar baz", "viwd", "foo | baz"],
  ["foo b|ar baz", "vawd", "foo |baz"],
  ['say "h|i you" ok', 'vi"d', 'say "|" ok'],
  ["f(a, |b)", "vi(y0P", "a, |bf(a, b)"],
  ["|abc", "vlrx", "|xxc"],
  ["|abc", "vl~", "|ABc"],
  ["|ABC", "vlu", "|abC"],
  ["|abc", "vlU", "|ABc"],
  ["|abcd", "lvlohd", "|d"],
  ["one\n|two\nthree", "Vd", "one\n|three"],
  ["one\n|two\nthree", "Vjd", "|one"],
  ["|one\ntwo\nthree", "Vjy", "|one\ntwo\nthree"],
  ["|one\ntwo\nthree", "VjyGp", "one\ntwo\nthree\n|one\ntwo"],
  ["|one\ntwo", "Vcnew<esc>", "ne|w\ntwo"],
  ["|a\nb\nc", "Vj>", "  |a\n  b\nc"],
  ["|a\nb", "Vj2>", "    |a\n    b"],
  ["  |a\n  b", "Vj<", "|a\nb"],
  ["|a\nb\nc", "VjjJ", "a b| c"],
  ["|a\nb\nc", "vjJ", "a| b\nc"],
  ["|abc def", "vlx", "|c def"],
  ["|abc def", "vX", "|"],
  ["|one\ntwo", "vD", "|two"],
  ["ab|c\ndef", "vjd", "a|b"],
  ["|abc", "vl<esc>", "a|bc"],
  ["|abc", "vlv", "a|bc"],
  ["|ab\ncd", "vVd", "|cd"],
  ["|ab\ncd", "Vvd", "|b\ncd"],
  ["|foo bar", "yiwwviwp", "foo fo|o"],
  ["|foo bar", "yiwwviwp0viwp", "ba|r foo"],
  ["|foo bar", "yiwwviwP0viwP", "fo|o foo"],
  ["|ab\ncd", "yyjvp", "ab\n\n|ab\nd"],
  ["|ab\ncd", "yyjVp", "ab\n|ab"],
  ["|abcdef", "vld.", "|ef"],
  ["|a\nb\nc\nd", "Vjd.", "|"],
  ["|abcdef", "vlcX<esc>l.", "X|Xef"],
  ["|one two", "vlUw.", "ONe |TWo"],
  ["|abc", "vlduu", "|abc"],
]);

describe("modes and pass-through", () => {
  test("starts in INSERT and passes typed keys to pi", () => {
    const e = new VimEngine();
    expect(e.mode).toBe("insert");
    expect(e.feed("a", buf("|"))).toEqual({ pass: true });
  });

  test("Esc in INSERT goes to NORMAL; Esc in NORMAL passes to pi (abort)", () => {
    const e = new VimEngine();
    e.feed("<esc>", buf("ab|"));
    expect(e.mode).toBe("normal");
    expect(e.feed("<esc>", buf("a|b"))).toEqual({ pass: true });
  });

  test("Esc cancels a half-typed command and does not pass", () => {
    const e = normalEngine("|abc");
    expect(e.feed("d", buf("|abc"))).toEqual({});
    expect(e.pendingKeys).toBe("d");
    expect(e.feed("<esc>", buf("|abc"))).toEqual({});
    expect(e.pendingKeys).toBe("");
  });

  test("j/k at the first or last line ask for history", () => {
    const e = normalEngine("|one");
    expect(e.feed("k", buf("|one")).history).toBe(-1);
    expect(e.feed("j", buf("|one")).history).toBe(1);
    expect(e.feed("<up>", buf("|one")).history).toBe(-1);
  });

  test("unknown keys are ignored", () => {
    const e = normalEngine("|abc");
    expect(e.feed("Q", buf("|abc"))).toEqual({});
    expect(e.feed("d", buf("|abc"))).toEqual({});
    expect(e.feed("z", buf("|abc"))).toEqual({});
    expect(e.pendingKeys).toBe("");
  });

  test("selection reports the visual range in buffer order", () => {
    const { engine } = run("ab|cd", "vh");
    expect(engine.mode).toBe("visual");
    expect(engine.selection(buf("a|bcd"))).toEqual({
      kind: "char",
      start: { line: 0, col: 1 },
      end: { line: 0, col: 2 },
    });
    const v = run("|a\nbc", "Vj").engine;
    expect(v.selection(buf("a\n|bc"))).toEqual({
      kind: "line",
      start: { line: 0, col: 0 },
      end: { line: 1, col: 2 },
    });
    expect(normalEngine("|a").selection(buf("|a"))).toBeUndefined();
  });

  test("Esc in VISUAL goes to NORMAL, not to pi", () => {
    const { engine } = run("|abc", "v");
    expect(engine.feed("<esc>", buf("|abc")).pass).toBeUndefined();
    expect(engine.mode).toBe("normal");
  });

  test("reset returns to INSERT with empty undo", () => {
    const { engine } = run("|abc", "x");
    engine.reset(buf("|"));
    expect(engine.mode).toBe("insert");
    engine.feed("<esc>", buf("|"));
    expect(engine.feed("u", buf("|"))).toEqual({});
  });
});

describe("registers and clipboard", () => {
  test("yank reports the register for the clipboard", () => {
    const e = normalEngine("|foo bar");
    e.feed("y", buf("|foo bar"));
    expect(e.feed("w", buf("|foo bar")).yanked).toEqual({ text: "foo ", linewise: false });
  });

  test("delete reports the register; motions do not", () => {
    const e = normalEngine("|one\ntwo");
    e.feed("d", buf("|one\ntwo"));
    expect(e.feed("d", buf("|one\ntwo")).yanked).toEqual({ text: "one", linewise: true });
    expect(e.feed("l", buf("|two")).yanked).toBeUndefined();
  });

  test("clipboard text becomes the register; our own text keeps its type", () => {
    const e = normalEngine("|abc");
    e.syncClipboard("from mac\n");
    expect(e.register).toEqual({ text: "from mac", linewise: true });
    e.register = { text: "x\ny", linewise: false };
    e.syncClipboard(clipboardText(e.register));
    expect(e.register).toEqual({ text: "x\ny", linewise: false });
    e.syncClipboard("");
    expect(e.register).toEqual({ text: "x\ny", linewise: false });
  });

  test("wantsRegister only for p/P after a count", () => {
    const e = normalEngine("|abc");
    expect(e.wantsRegister("p")).toBe(true);
    e.feed("3", buf("|abc"));
    expect(e.wantsRegister("P")).toBe(true);
    e.feed("d", buf("|abc"));
    expect(e.wantsRegister("p")).toBe(false);
  });
});

describe("helpers", () => {
  test("insertedText", () => {
    expect(insertedText("ac", "abc")).toBe("b");
    expect(insertedText("", "hello")).toBe("hello");
    expect(insertedText("aa", "aaa")).toBe("a");
  });

  test("InsertRemap: jj within a second escapes", () => {
    const r = new InsertRemap(["jj"]);
    expect(r.feed("j", 0)).toBe("insert");
    expect(r.feed("j", 500)).toBe("escape");
  });

  test("InsertRemap: slow or broken sequences stay text", () => {
    const r = new InsertRemap(["jj"]);
    r.feed("j", 0);
    expect(r.feed("j", 1500)).toBe("insert");
    expect(r.feed("j", 1600)).toBe("escape");
    r.feed("j", 2000);
    expect(r.feed("k", 2100)).toBe("insert");
    expect(r.feed("j", 2200)).toBe("insert");
    r.reset();
    expect(r.feed("j", 2300)).toBe("insert");
  });
});
