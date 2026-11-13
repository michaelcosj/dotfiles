import { expect, test } from "bun:test";
import { fromMarkdown, controlValue, formValue, liveToken, type Control } from "./content.ts";
const parse = (src: string) => fromMarkdown(src, import.meta.dir);
const fence = (lang: string, src: string) => parse('```' + lang + '\n' + src + '\n```')[0];
const form = (src: string, lang = "inputs"): Control[] => {
  const b = fence(lang, src); expect(b.kind).toBe("form");
  if (b.kind !== "form") throw new Error(JSON.stringify(b)); return b.controls;
};
test("every inputs row, labels, defaults, buttons and typed values", () => {
  const controls = form(`# ignored
seats: slider 1..200 = 20
stepped: slider 0..100 step 5
n: number 0..10 step 0.5 = 2
empty: number
annual: check = true "Annual billing"
annual_billing: check
plan: pick Team ($12)=12 | *Business ($20)=20 required
dbs: multi Postgres=pg | *SQLite=sqlite | Mongo
who: text = "Ann" "Your name"
notes: long "Notes"
base: 49
cur: "€"
[Use this]
[Neither](choice=none)`);
  expect(formValue(controls, new Map())).toEqual({ seats: 20, stepped: 0, n: 2, empty: "", annual: true, annual_billing: false, plan: 20, dbs: ["sqlite"], who: "Ann", notes: "", base: 49, cur: "€" });
  expect(controls[1]).toMatchObject({ step: 5, min: 0, max: 100 });
  expect(controls[5]).toMatchObject({ label: "Annual billing", single: true });
  expect(controls[6]).toMatchObject({ required: true, choices: [{ value: "12" }, { value: "20", checked: true }] });
  expect(controls.at(-1)).toMatchObject({ kind: "buttons", buttons: [{ primary: true }, { primary: false, name: "choice", value: "none" }] });
  expect(formValue(controls, new Map([[controls[0], 7], [controls[4], [false]], [controls[6], 0], [controls[7], [true, false, true]], [controls[8], "123"]]), { name: "plan", value: "none" })).toMatchObject({ seats: 7, annual: false, plan: "none", dbs: ["pg", "Mongo"], who: "123" });
});
test("text, required tokens, constants and choice defaults", () => {
  const cs = form('a: text = "required"\nb: long required = "hello"\nc: pick A | B\nd: multi *One=1 | *Two=2\ne: text required "Label"\nf: number required\ng: -2.5');
  expect(cs[0]).toMatchObject({ value: "required", required: false });
  expect(cs[1]).toMatchObject({ multiline: true, required: true, value: "hello" });
  expect(controlValue(cs[2], undefined)).toBe("A");
  expect(controlValue(cs[3], undefined)).toEqual([1, 2]);
  expect(controlValue(cs[2], -1)).toBe("");
  expect(cs[4]).toMatchObject({ label: "Label", required: true });
  expect(formValue(cs, new Map())).toMatchObject({ f: "", g: -2.5 });
  expect(cs.some(c => c.kind === "buttons")).toBe(false);
});
test("ask and ask multi with other and note formulas", () => {
  const source = 'Which {{ thing }}?\n- Rebase: linear history\n- Merge: keeps: context\nother';
  const cs = form(source, "ask");
  expect(cs[0]).toEqual({ kind: "note", markdown: `Which ${liveToken("thing")}?` });
  expect(cs[1]).toMatchObject({ kind: "radio", required: true, choices: [{ title: "Rebase", value: "Rebase", detail: "linear history" }, { detail: "keeps: context" }] });
  expect(formValue(cs, new Map([[cs[1], 0]]))).toEqual({ answer: "Rebase", other: "" });
  const ms = form(source, "ask multi");
  expect(formValue(ms, new Map([[ms[1], [true, true]], [ms[2], "Else"]]))).toEqual({ answer: ["Rebase", "Merge"], other: "Else" });
  expect(ms.at(-1)).toMatchObject({ buttons: [{ text: "Send", primary: true }] });
});
test("chart series, formulas, first colon and nested commas", () => {
  expect(fence('chart bar "Revenue"', 'series: Revenue, Cost\nQ1: 120, 80\nQ2: max(seats * 3, 4), 100')).toEqual({ kind: "chart", type: "bar", title: "Revenue", series: ["Revenue", "Cost"], rows: [{ label: "Q1", values: ["120", "80"] }, { label: "Q2", values: ["max(seats * 3, 4)", "100"] }] });
  expect(fence("chart pie", "A: 1")).toMatchObject({ type: "pie", series: [""], title: "" });
  expect(fence("chart line", 'A: x ? "a: b" : "c"')).toMatchObject({ rows: [{ label: "A", values: ['x ? "a: b" : "c"'] }] });
});
test("cols match fence length and character and retain nested code", () => {
  const b = parse('````cols\nLeft {{x}}\n```js\n{{ untouched }}\n---\n```\n---\nRight {{ y }}\n````')[0];
  expect(b).toEqual({ kind: "cols", columns: [`Left ${liveToken("x")}\n\`\`\`js\n{{ untouched }}\n---\n\`\`\``, `Right ${liveToken("y")}`] });
  expect(parse('```cols\n~~~js\n{{code}}\n~~~\n---\n{{text}}\n```')[0]).toMatchObject({ columns: ['~~~js\n{{code}}\n~~~', liveToken("text")] });
  expect(parse('~~~svg\n<svg/>\n```\n~~~~')[0]).toEqual({ kind: "svg", source: '<svg/>\n```' });
  expect(parse('````svg\n```\n```` trailing\n<svg/>\n`````')[0]).toEqual({ kind: "svg", source: '```\n```` trailing\n<svg/>' });
});
test("svg, mermaid, colors and resolved image files", () => {
  expect(fence("svg", '<svg fill="{{x}}"/>')).toEqual({ kind: "svg", source: '<svg fill="{{x}}"/>' });
  expect(fence("mermaid", "graph LR\nA-->B")).toMatchObject({ kind: "mermaid" });
  expect(fence("colors", "Red: #ff0000\nBlue: #00aAFF")).toEqual({ kind: "colors", colors: [{ name: "Red", value: "#ff0000" }, { name: "Blue", value: "#00aAFF" }] });
  expect(parse("![File](./content.test.ts)")[0]).toEqual({ kind: "image", path: import.meta.path, alt: "File" });
  expect(parse("![Missing](does-not-exist.png)")[0]).toMatchObject({ kind: "error" });
  expect(parse("Text ![File](content.test.ts)")[0]).toMatchObject({ kind: "markdown" });
});
test("live tokens skip inline and fenced code, escape braces", () => {
  expect(parse('Hello {{ money(x, "!") }} `{{x}}` ``{{y}}`` \\{{ literal }}')[0]).toEqual({ kind: "markdown", text: `Hello ${liveToken('money(x, "!")')} \`{{x}}\` \`\`{{y}}\`\` {{ literal }}` });
  const md = '```unknown\n{{x}}\n\n{{y}}\n```\n\n{{z}}';
  expect(parse(md)).toEqual([{ kind: "markdown", text: '```unknown\n{{x}}\n\n{{y}}\n```\n\n' + liveToken("z") }]);
  expect(liveToken("!'()*~")).toBe("\uE000%21%27%28%29%2a%7e\uE001");
  expect(parse('Unmatched ` {{x}}')[0]).toEqual({ kind: "markdown", text: 'Unmatched ` ' + liveToken("x") });
  expect(parse('A `code\n{{x}}` {{y}}')[0]).toEqual({ kind: "markdown", text: 'A `code\n{{x}}` ' + liveToken("y") });
});
test("bad known lines become source-bearing errors and never throw", () => {
  for (const line of ["bad", "a: unknown", "a: slider", "a: check = yes", "a: text = hi", "a: pick A |", "a: number nonsense", "a: slider 10..1", "a: slider 1..2 step 0"]) {
    expect(fence("inputs", "# comment\n\n" + line)).toMatchObject({ kind: "error", message: expect.stringMatching(/^inputs line 3: /), source: "# comment\n\n" + line });
  }
  expect(fence("colors", "bad")).toMatchObject({ kind: "error", message: expect.stringMatching(/^colors line 1:/) });
  expect(fence("chart line", "bad")).toMatchObject({ kind: "error" });
  expect(fence("ask", "No choices")).toMatchObject({ kind: "error" });
});
