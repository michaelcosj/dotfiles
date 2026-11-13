// Formulas for live pages: <output data-expr="(base + seats * seat) * (annual ? 0.85 : 1)">.
// A small safe expression language, not JavaScript: numbers, strings, the
// page's named inputs, arithmetic, comparisons, && || !, a ? b : c, and the
// functions in FN. The tui viewer imports it; rex-view puts exprLib's source
// in Chrome pages, so it must stay self-contained (no imports, no outer names).
export function exprLib() {
  const fmt = (x, n = 0) => Number(x).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n });
  const FN = {
    min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow,
    round: (x, n = 0) => { const f = 10 ** n; return Math.round(x * f) / f; },
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    fmt,
    money: (x, sym = "$", n = 0) => (x < 0 ? "−" : "") + sym + fmt(Math.abs(x), n),
    pct: (x, n = 0) => fmt(x * 100, n) + "%",
    has: (list, v) => (Array.isArray(list) ? list.includes(v) : list === v),
    count: (list) => (Array.isArray(list) ? list.length : list ? 1 : 0),
  };

  const TOKEN = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(\*\*|===|!==|==|!=|<=|>=|&&|\|\||[-+*\/%<>!?:(),]))/y;
  function tokenize(src) {
    const out = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < src.length) {
      if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
      const at = TOKEN.lastIndex, m = TOKEN.exec(src);
      if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}"`);
      if (m[1]) out.push({ t: "num", v: Number(m[1]) });
      else if (m[2]) out.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
      else if (m[3]) out.push({ t: "id", v: m[3] });
      else out.push({ t: "op", v: m[4] === "===" ? "==" : m[4] === "!==" ? "!=" : m[4] });
    }
    return out;
  }

  // Binding powers: higher binds tighter. ** and ?: group to the right.
  const BIN = { "||": 2, "&&": 3, "==": 4, "!=": 4, "<": 5, "<=": 5, ">": 5, ">=": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7, "**": 8 };
  const OPS = {
    "||": (a, b) => a || b, "&&": (a, b) => a && b, "==": (a, b) => a === b, "!=": (a, b) => a !== b,
    "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
    "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b, "**": (a, b) => a ** b,
  };

  // Compiles a formula to a function of the scope (name -> value).
  function compile(src) {
    const toks = tokenize(String(src));
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v) => toks[i]?.t === "op" && toks[i].v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error(`expected "${v}"`); i++; };
    function primary() {
      const tk = toks[i++];
      if (!tk) throw new Error("unexpected end");
      if (tk.t === "num" || tk.t === "str") { const v = tk.v; return () => v; }
      if (tk.t === "id") {
        if (tk.v === "true" || tk.v === "false") { const v = tk.v === "true"; return () => v; }
        if (isOp("(")) {
          const fn = Object.hasOwn(FN, tk.v) ? FN[tk.v] : null;
          if (!fn) throw new Error(`unknown function ${tk.v}()`);
          i++;
          const args = [];
          if (!isOp(")")) do args.push(expr(0)); while (isOp(",") && ++i);
          expect(")");
          return (s) => fn(...args.map((a) => a(s)));
        }
        const name = tk.v;
        return (s) => { if (!Object.hasOwn(s, name)) throw new Error(`unknown name ${name}`); return s[name]; };
      }
      if (tk.v === "(") { const e = expr(0); expect(")"); return e; }
      if (tk.v === "-" || tk.v === "+" || tk.v === "!") {
        const e = expr(9), op = tk.v;
        return op === "-" ? (s) => -e(s) : op === "+" ? (s) => +e(s) : (s) => !e(s);
      }
      throw new Error(`unexpected "${tk.v}"`);
    }
    function expr(minBp) {
      let left = primary();
      for (;;) {
        const tk = peek();
        if (!tk || tk.t !== "op") break;
        if (tk.v === "?" && minBp <= 1) {
          i++;
          const yes = expr(0); expect(":"); const no = expr(1), cond = left;
          left = (s) => (cond(s) ? yes(s) : no(s));
          continue;
        }
        const bp = BIN[tk.v];
        if (!bp || bp < minBp) break;
        i++;
        const right = expr(tk.v === "**" ? bp : bp + 1), l = left, f = OPS[tk.v];
        left = (s) => f(l(s), right(s));
      }
      return left;
    }
    const e = expr(0);
    if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
    return e;
  }

  // A form value as formulas see it: numeric text becomes a number.
  const value = (raw) => (typeof raw === "string" && raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) : raw);

  // A result as text.
  function show(v) {
    if (typeof v === "number") return Number.isNaN(v) ? "—" : !Number.isFinite(v) ? "∞" : fmt(v, Number.isInteger(v) ? 0 : 2);
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (Array.isArray(v)) return v.join(", ");
    return v == null ? "" : String(v);
  }

  return { compile, value, show };
}
