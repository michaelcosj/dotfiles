import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { value } from "./expr.ts";

export type Choice = { value: string; title: string; detail: string; checked: boolean; disabled: boolean };
export type Control =
  | { kind: "radio"; name: string; label: string; choices: Choice[]; required: boolean }
  | { kind: "checkbox"; name: string; label: string; choices: Choice[]; single: boolean }
  | { kind: "text"; name: string; label: string; value: string; placeholder: string; required: boolean; multiline: boolean; type: "text" | "number" }
  | { kind: "range"; name: string; label: string; min: number; max: number; step: number; value: number }
  | { kind: "hidden"; name: string; value: string | number }
  | { kind: "buttons"; buttons: { name: string; value: string; text: string; submit: boolean; primary: boolean; danger: boolean }[] }
  | { kind: "note"; markdown: string };
export type Block =
  | { kind: "markdown"; text: string }
  | { kind: "mermaid"; source: string }
  | { kind: "form"; controls: Control[] }
  | { kind: "chart"; type: "bar" | "line" | "pie"; title: string; series: string[]; rows: { label: string; values: string[] }[] }
  | { kind: "cols"; columns: string[] }
  | { kind: "svg"; source: string }
  | { kind: "image"; path: string; alt: string }
  | { kind: "colors"; colors: { name: string; value: string }[] }
  | { kind: "error"; message: string; source: string };

export const liveToken = (src: string): string => "\uE000" + encodeURIComponent(src).replace(/[!'()*~]/g, c => "%" + c.charCodeAt(0).toString(16)) + "\uE001";
const opening = /^(`{3,}|~{3,})\s*(\w+)?(.*)$/;
const closes = (line: string, fence: string) => new RegExp("^" + fence[0] + "{" + fence.length + ",}\\s*$").test(line);

// Keep code opaque: a column can contain fences of its own.
function live(text: string): string {
  let fence = "", ticks = "";
  const lines = text.split("\n");
  return lines.map((line, lineIndex) => {
    if (fence) { if (closes(line, fence)) fence = ""; return line; }
    const m = line.match(opening);
    if (!ticks && m) { fence = m[1]; return line; }
    let out = "";
    for (let i = 0; i < line.length;) {
      if (line[i] === "`") {
        const run = line.slice(i).match(/^`+/)![0];
        if (!ticks) {
          const rest = [line.slice(i + run.length), ...lines.slice(lineIndex + 1)].join("\n");
          // An unmatched backtick is ordinary Markdown, not a code span.
          if ([...rest.matchAll(/`+/g)].some(m => m[0] === run)) ticks = run;
        } else if (ticks === run) ticks = "";
        out += run; i += run.length;
      } else if (!ticks && line.startsWith("\\{{", i)) { out += "{{"; i += 3; }
      else if (!ticks && line.startsWith("{{", i) && line.indexOf("}}", i + 2) >= 0) {
        const end = line.indexOf("}}", i + 2);
        out += liveToken(line.slice(i + 2, end).trim()); i = end + 2;
      } else out += line[i++];
    }
    return out;
  }).join("\n");
}
const choice = (title: string, v = title, checked = false, detail = ""): Choice => ({ title, value: v, checked, detail, disabled: false });
const button = (text: string, name = "", v = "", primary = true) => ({ text, name, value: v, primary, submit: true, danger: false });
const num = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const quoted = '"(?:[^"\\\\]|\\\\.)*"';
const unquote = (s: string) => JSON.parse(s) as string;
function inputs(source: string): Control[] {
  const controls: Control[] = [], buttons: Extract<Control, { kind: "buttons" }>["buttons"] = [];
  source.split("\n").forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const bad = (msg: string): never => { throw new Error(`inputs line ${i + 1}: ${msg}`); };
    try {
      const b = line.match(/^\[([^\]]+)\](?:\(([A-Za-z_]\w*)=([^)]*)\))?$/);
      if (b) { buttons.push(button(b[1], b[2] || "", b[3] || "", !buttons.length)); return; }
      const m = line.match(/^([A-Za-z_]\w*):\s*(.+)$/);
      if (!m) bad("expected name: kind args");
      const name = m![1]; let args = m![2];
      if (new RegExp(`^(?:${num}|${quoted})$`).test(args)) {
        controls.push({ kind: "hidden", name, value: args.startsWith('"') ? unquote(args) : Number(args) }); return;
      }
      const k = args.match(/^(slider|number|check|pick|multi|text|long)\b/);
      if (!k) bad("unknown control kind");
      const kind = k![1]; args = args.slice(kind.length).trim();
      let required = false;
      // Only unquoted tokens are keywords; labels and defaults retain their text.
      args = args.replace(new RegExp(`${quoted}|\\brequired\\b`, "g"), token => {
        if (token === "required") { required = true; return ""; } return token;
      }).trim();
      let label = name.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
      // A sole quoted token after '=' is the default, not a label.
      const labelMatch = args.match(new RegExp(`(?:^|\\s)(${quoted})$`));
      if (labelMatch && !/^=\s*$/.test(args.slice(0, labelMatch.index))) {
        label = unquote(labelMatch[1]); args = args.slice(0, labelMatch.index).trim();
      }
      if (kind === "pick" || kind === "multi") {
        const choices = args.split("|").map(part => {
          part = part.trim(); const checked = part.startsWith("*"); if (checked) part = part.slice(1).trim();
          const at = part.indexOf("="); const title = (at < 0 ? part : part.slice(0, at)).trim(), v = (at < 0 ? part : part.slice(at + 1)).trim();
          if (!title || !v) bad("expected a nonempty option");
          return choice(title, v, checked);
        });
        if (kind === "pick") { if (!choices.some(c => c.checked)) choices[0].checked = true; controls.push({ kind: "radio", name, label, choices, required }); }
        else controls.push({ kind: "checkbox", name, label, choices, single: false });
      } else if (kind === "check") {
        if (args && !/^=\s*(true|false)$/.test(args)) bad("expected = true or = false");
        controls.push({ kind: "checkbox", name, label, choices: [choice(label, "true", /=\s*true$/.test(args))], single: true });
      } else if (kind === "text" || kind === "long") {
        if (args && !new RegExp(`^=\\s*${quoted}$`).test(args)) bad("expected a quoted default");
        controls.push({ kind: "text", name, label, value: args ? unquote(args.replace(/^=\s*/, "")) : "", placeholder: "", required, multiline: kind === "long", type: "text" });
      } else {
        const r = args.match(new RegExp(`^(?:(${num})\\.\\.(${num}))?\\s*(?:step\\s+(${num}))?\\s*(?:=\\s*(${num}))?$`));
        if (!r || (kind === "slider" && r[1] === undefined)) bad("expected range, optional step and default");
        if (r![1] !== undefined && Number(r![1]) > Number(r![2])) bad("range minimum exceeds maximum");
        if (r![3] !== undefined && Number(r![3]) <= 0) bad("step must be positive");
        if (kind === "slider") controls.push({ kind: "range", name, label, min: Number(r![1]), max: Number(r![2]), step: Number(r![3] ?? 1), value: Number(r![4] ?? r![1]) });
        else controls.push({ kind: "text", name, label, value: r![4] ?? "", placeholder: "", required, multiline: false, type: "number" });
      }
    } catch (e) { if (e instanceof Error && e.message.startsWith("inputs line")) throw e; bad("invalid quoted string"); }
  });
  if (buttons.length) controls.push({ kind: "buttons", buttons });
  return controls;
}
function ask(source: string, multi: boolean): Control[] {
  const lines = source.split("\n"), question: string[] = [], choices: Choice[] = []; let other = false;
  lines.forEach((line, i) => {
    if (line.trim() === "other") { other = true; return; }
    if (line.startsWith("- ")) {
      const text = line.slice(2), at = text.indexOf(": ");
      choices.push(choice(at < 0 ? text : text.slice(0, at), at < 0 ? text : text.slice(0, at), false, at < 0 ? "" : text.slice(at + 2)));
    } else if (!choices.length) question.push(line);
    else if (line.trim()) throw new Error(`ask line ${i + 1}: expected a choice or other`);
  });
  if (!choices.length) throw new Error("ask line 1: expected choices");
  const controls: Control[] = [];
  if (question.join("\n").trim()) controls.push({ kind: "note", markdown: live(question.join("\n").trim()) });
  controls.push(multi ? { kind: "checkbox", name: "answer", label: "", choices, single: false } : { kind: "radio", name: "answer", label: "", choices, required: true });
  if (other) controls.push({ kind: "text", name: "other", label: "Other", value: "", placeholder: "", required: false, multiline: false, type: "text" });
  controls.push({ kind: "buttons", buttons: [button("Send")] }); return controls;
}
function splitValues(s: string): string[] {
  let depth = 0, quote = "", start = 0; const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++; else if (c === ")") depth--;
    else if (c === "," && !depth) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  if (depth || quote || out.some(v => !v)) throw new Error("invalid chart values");
  return out;
}
function special(lang: string, args: string, source: string): Block | undefined {
  if (lang === "inputs") return { kind: "form", controls: inputs(source) };
  if (lang === "ask") return { kind: "form", controls: ask(source, args.trim() === "multi") };
  if (lang === "mermaid" || lang === "svg") return { kind: lang, source };
  if (lang === "cols") {
    const columns = [""]; let fence = "";
    for (const line of source.split("\n")) {
      if (!fence && line === "---") { columns.push(""); continue; }
      if (fence) { if (closes(line, fence)) fence = ""; } else { const m = line.match(opening); if (m) fence = m[1]; }
      columns[columns.length - 1] += line + "\n";
    }
    return { kind: "cols", columns: columns.map(c => live(c.trim())) };
  }
  if (lang === "colors") return { kind: "colors", colors: source.split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    const m = line.match(/^(.+?):\s*(#[\da-fA-F]{6})\s*$/);
    if (!m) throw new Error(`colors line ${i + 1}: expected name: #rrggbb`);
    return [{ name: m[1].trim(), value: m[2] }];
  }) };
  if (lang === "chart") {
    const m = args.trim().match(/^(bar|line|pie)(?:\s+"(.*)")?$/);
    if (!m) throw new Error("chart line 1: expected bar, line or pie and optional title");
    const rows: { label: string; values: string[] }[] = []; let series = [""];
    source.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const at = line.indexOf(": "); if (at < 0) throw new Error("expected label: values");
        const label = line.slice(0, at), values = splitValues(line.slice(at + 2));
        if (label === "series" && m[1] !== "pie") series = values; else rows.push({ label, values });
      } catch (e) { throw new Error(`chart line ${i + 1}: ${(e as Error).message}`); }
    });
    return { kind: "chart", type: m[1] as "bar" | "line" | "pie", title: m[2] || "", series, rows };
  }
}
export function fromMarkdown(md: string, baseDir: string): Block[] {
  const out: Block[] = [], lines = md.split(/\r?\n/); let pending: string[] = [];
  const flush = () => {
    const text = pending.join("\n").trim(); pending = []; if (!text) return;
    // Only a whole paragraph can become an image.
    const paragraphs: string[] = []; let chunk: string[] = [], fence = "";
    for (const line of text.split("\n")) {
      if (fence) { if (closes(line, fence)) fence = ""; }
      else { const m = line.match(opening); if (m) fence = m[1]; }
      if (!fence && !line.trim()) { if (chunk.length) paragraphs.push(chunk.join("\n")); chunk = []; }
      else chunk.push(line);
    }
    if (chunk.length) paragraphs.push(chunk.join("\n"));
    for (const paragraph of paragraphs) {
      const image = paragraph.match(/^!\[([^\]]*)\]\(([^\n]+)\)$/);
      if (image) { const path = resolve(baseDir, image[2]); out.push(existsSync(path) ? { kind: "image", path, alt: image[1] } : { kind: "error", message: `image: missing file ${path}`, source: paragraph }); }
      else { const prev = out.at(-1); if (prev?.kind === "markdown") prev.text += "\n\n" + live(paragraph); else out.push({ kind: "markdown", text: live(paragraph) }); }
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(opening);
    if (!m) { pending.push(lines[i]); continue; }
    const start = i; let end = i + 1;
    while (end < lines.length && !closes(lines[end], m[1])) end++;
    const source = lines.slice(i + 1, end).join("\n");
    let block: Block | undefined;
    try { block = special(m[2] || "", m[3], source); }
    catch (e) { block = { kind: "error", message: e instanceof Error ? e.message : String(e), source }; }
    if (block) { flush(); out.push(block); }
    else pending.push(...lines.slice(start, Math.min(end + 1, lines.length)));
    i = end;
  }
  flush(); return out;
}
export function controlValue(c: Control, state: any): any {
  if (c.kind === "hidden") return c.value;
  if (c.kind === "radio") { const i = state ?? c.choices.findIndex(c => c.checked); return i >= 0 && c.choices[i] ? value(c.choices[i].value) : ""; }
  if (c.kind === "checkbox") { const checked: boolean[] = state ?? c.choices.map(c => c.checked); return c.single ? !!checked[0] : c.choices.filter((_, i) => checked[i]).map(c => value(c.value)); }
  if (c.kind === "text") return c.type === "number" ? value(state ?? c.value) : state ?? c.value;
  if (c.kind === "range") return state ?? c.value;
}
export function formValue(controls: Control[], state: Map<Control, any>, button?: { name: string; value: string }): Record<string, any> {
  const o: Record<string, any> = {};
  for (const c of controls) if ("name" in c) Object.defineProperty(o, c.name, { value: controlValue(c, state.get(c)), enumerable: true, writable: true, configurable: true });
  if (button?.name) Object.defineProperty(o, button.name, { value: button.value, enumerable: true, writable: true, configurable: true });
  return o;
}
