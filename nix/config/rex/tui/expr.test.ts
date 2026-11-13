import { describe, expect, test } from "bun:test";
import { exprLib } from "./expr.js";

const { compile, value, show } = exprLib();
const run = (src: string, s: Record<string, unknown> = {}) => compile(src)(s);

describe("expr", () => {
  test("arithmetic and precedence", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("2 ** 3 ** 2")).toBe(512); // right-assoc
    expect(run("-2 ** 2")).toBe(4); // unary binds tighter, like Math
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("7 % 4")).toBe(3);
  });
  test("names, ternary, logic", () => {
    const s = { seats: 20, annual: true, plan: "pro" };
    expect(run("(49 + seats * 12) * (annual ? 0.85 : 1)", s)).toBeCloseTo(245.65);
    expect(run("plan == 'pro' && seats > 10", s)).toBe(true);
    expect(run("!annual || seats < 5 ? 1 : 2", s)).toBe(2);
    expect(run("a ? 1 : b ? 2 : 3", { a: false, b: true })).toBe(2);
  });
  test("functions", () => {
    expect(run("money(1234.5)")).toBe("$1,235");
    expect(run("money(-5, '€', 2)")).toBe("−€5.00");
    expect(run("pct(0.153, 1)")).toBe("15.3%");
    expect(run("round(2.345, 2)")).toBe(2.35);
    expect(run("clamp(15, 0, 10)")).toBe(10);
    expect(run("has(opts, 'wal')", { opts: ["wal", "fts"] })).toBe(true);
    expect(run("count(opts)", { opts: ["wal"] })).toBe(1);
    expect(run("max(1, 5, 3)")).toBe(5);
  });
  test("is not JavaScript", () => {
    expect(() => run("constructor")).toThrow(/unknown name/);
    expect(() => run("toString()")).toThrow(/unknown function/);
    expect(() => run("a.b", { a: {} })).toThrow();
    expect(() => run("x = 1")).toThrow();
    expect(() => run("1 +")).toThrow(/end/);
    expect(() => run("(1")).toThrow(/expected/);
  });
  test("values and display", () => {
    expect(value("12")).toBe(12);
    expect(value("")).toBe("");
    expect(value("abc")).toBe("abc");
    expect(show(1234)).toBe("1,234");
    expect(show(2 / 3)).toBe("0.67");
    expect(show(1 / 0)).toBe("∞");
    expect(show(true)).toBe("yes");
  });
});
