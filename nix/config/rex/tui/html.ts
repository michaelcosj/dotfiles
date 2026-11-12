// HTML to blocks: Markdown for text, controls for <form data-rex>, with the
// same values a browser would send. Loaded only for HTML pages.
import { parse, HTMLElement, type Node } from "node-html-parser";
import { push, type Block, type Choice, type Control } from "./content.ts";

const isEl = (n: Node): n is HTMLElement => n instanceof HTMLElement;
const tag = (n: HTMLElement) => (n.rawTagName || "").toLowerCase();
const cls = (n: HTMLElement) => (n.getAttribute("class") || "").split(/\s+/);
const squash = (s: string) => s.replace(/\s+/g, " ");

export function fromHTML(html: string): Block[] {
  const root = parse(html, { blockTextElements: { textarea: true } });
  const body = root.querySelector("body") ?? root;
  const out: Block[] = [];
  const md: string[] = [];
  const flush = () => { push(out, md.join("\n\n")); md.length = 0; };

  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (!isEl(n)) { const t = squash(n.text).trim(); if (t) md.push(escape(t)); continue; }
      const t = tag(n);
      if (t === "head" || t === "title" || t === "meta") continue;
      if (t === "form" && n.hasAttribute("data-rex")) { flush(); out.push({ kind: "form", controls: formControls(n) }); continue; }
      if (t === "pre" && cls(n).includes("mermaid")) { flush(); out.push({ kind: "mermaid", source: n.text.trim() }); continue; }
      const code = t === "pre" ? n.querySelector("code") : null;
      if (code && /language-mermaid/.test(code.getAttribute("class") || "")) { flush(); out.push({ kind: "mermaid", source: code.text.trim() }); continue; }
      const b = blockMd(n);
      if (b !== null) { if (b.trim()) md.push(b); continue; }
      walk(n.childNodes); // div, section, ...: just their content
    }
  };
  walk(body.childNodes);
  flush();
  return out;
}

// Markdown for a block element, or null for a container to walk into.
function blockMd(n: HTMLElement): string | null {
  const t = tag(n);
  const h = /^h([1-6])$/.exec(t);
  if (h) return "#".repeat(Number(h[1])) + " " + inline(n);
  switch (t) {
    case "p": case "legend": case "caption": return cls(n).includes("muted") ? `*${inline(n)}*` : inline(n);
    case "small": return `*${inline(n)}*`;
    case "hr": return "---";
    case "br": return "";
    case "blockquote": return inline(n).split("\n").map(l => "> " + l).join("\n");
    case "pre": {
      const code = n.querySelector("code");
      const lang = (/language-([\w+-]+)/.exec(code?.getAttribute("class") || "") || [])[1] || "";
      return "```" + lang + "\n" + (code ?? n).text.replace(/\n$/, "") + "\n```";
    }
    case "ul": case "ol": return list(n, 0);
    case "table": return table(n);
    case "label": case "a": case "b": case "strong": case "i": case "em": case "code": case "span": case "kbd": case "u": case "s": case "del": case "mark":
      return inline(n);
  }
  if (cls(n).includes("stat")) {
    const label = n.querySelector(".label")?.text.trim(), value = n.querySelector(".value")?.text.trim();
    if (label || value) return `${label ? `*${label}*  ` : ""}**${value ?? ""}**`;
  }
  if (cls(n).includes("badge")) return `\`${n.text.trim()}\``;
  return null;
}

function list(n: HTMLElement, depth: number): string {
  const ordered = tag(n) === "ol";
  let k = Number(n.getAttribute("start") || 1);
  return n.childNodes.filter(isEl).filter(li => tag(li) === "li").map(li => {
    const nested = li.childNodes.filter(isEl).filter(c => tag(c) === "ul" || tag(c) === "ol");
    const own = inline(li, new Set(nested));
    const box = li.querySelector("input[type=checkbox]");
    const mark = box ? (box.hasAttribute("checked") ? "[x] " : "[ ] ") : "";
    const line = "  ".repeat(depth) + (ordered ? `${k++}. ` : "- ") + mark + own;
    return [line, ...nested.map(c => list(c, depth + 1))].join("\n");
  }).join("\n");
}

function table(n: HTMLElement): string {
  const rows = n.querySelectorAll("tr").map(tr => tr.childNodes.filter(isEl).filter(c => tag(c) === "td" || tag(c) === "th").map(c => inline(c).replace(/\|/g, "\\|").replace(/\n/g, " ")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map(r => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const [head, ...rest] = rows;
  return [pad(head), Array(width).fill("---"), ...rest.map(pad)].map(r => "| " + r.join(" | ") + " |").join("\n");
}

// Inline Markdown for an element's children.
function inline(n: Node, skip = new Set<Node>()): string {
  if (!isEl(n)) return escape(squash(n.text));
  const parts = n.childNodes.filter(c => !skip.has(c)).map(c => {
    if (!isEl(c)) return escape(squash(c.text));
    const t = tag(c), inner = inline(c).trim();
    if (t === "input" || t === "textarea" || t === "select" || t === "button") return "";
    if (!inner && t !== "br") return "";
    switch (t) {
      case "b": case "strong": return `**${inner}**`;
      case "i": case "em": return `*${inner}*`;
      case "s": case "del": return `~~${inner}~~`;
      case "code": case "kbd": case "samp": return "`" + c.text + "`";
      case "a": return c.getAttribute("href") ? `[${inner}](${c.getAttribute("href")})` : inner;
      case "br": return "\n";
      case "small": return `*${inner}*`;
      case "p": case "div": case "li": return "\n" + inner + "\n";
      default: return cls(c).includes("muted") ? `*${inner}*` : inline(c);
    }
  });
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const escape = (s: string) => s.replace(/([\\*_`[\]<>|#&])/g, "\\$1");

// ---- forms ----

function formControls(form: HTMLElement): Control[] {
  const out: Control[] = [];
  const groups = new Map<string, Control & { choices: Choice[] }>();
  let buttons: Extract<Control, { kind: "buttons" }> | null = null;
  const note = (markdown: string) => { if (markdown.trim()) { buttons = null; out.push({ kind: "note", markdown }); } };

  // The label for a control: <label for=id>, or a wrapping <label>.
  const labelFor = (el: HTMLElement) => {
    const id = el.getAttribute("id");
    const l = id ? form.querySelector(`label[for="${id}"]`) : null;
    return l ? inline(l) : "";
  };
  const choice = (input: HTMLElement): Choice => {
    const wrap = closest(input, "label");
    let title = "", detail = "";
    if (wrap) {
      const b = wrap.querySelector("b, strong");
      const sm = wrap.querySelector("small");
      title = b ? inline(b) : inline(wrap, new Set(sm ? [sm] : []));
      detail = sm ? inline(sm) : "";
      if (b && !sm) { const rest = inline(wrap, new Set([b, ...ancestorsUntil(b, wrap)])).trim(); if (rest && rest !== title) detail = rest; }
    } else title = labelFor(input) || input.getAttribute("value") || "";
    return { value: input.getAttribute("value") ?? "on", title: title.replace(/^\*+|\*+$/g, "") || (input.getAttribute("value") ?? ""), detail, checked: input.hasAttribute("checked"), disabled: input.hasAttribute("disabled") };
  };

  const walk = (nodes: Node[], inLabel: boolean) => {
    for (const n of nodes) {
      if (!isEl(n)) { if (!inLabel) note(escape(squash(n.text)).trim()); continue; }
      const t = tag(n);
      if (t === "input") {
        const type = (n.getAttribute("type") || "text").toLowerCase();
        const name = n.getAttribute("name") || "";
        if (type === "radio" || type === "checkbox") {
          const key = type + ":" + name;
          let g = groups.get(key);
          if (!g) {
            g = type === "radio"
              ? { kind: "radio", name, label: "", choices: [], required: false }
              : { kind: "checkbox", name, label: "", choices: [] };
            groups.set(key, g); buttons = null; out.push(g);
          }
          if (type === "radio" && n.hasAttribute("required")) (g as any).required = true;
          g.choices.push(choice(n));
        } else if (type === "hidden") out.push({ kind: "hidden", name, value: n.getAttribute("value") || "" });
        else if (type === "submit" || type === "button" || type === "reset") addButton(n, n.getAttribute("value") || "Submit", type === "submit");
        else {
          buttons = null;
          out.push({ kind: "text", name, label: labelFor(n) || (closest(n, "label") ? inline(closest(n, "label")!) : ""), value: n.getAttribute("value") || "",
            placeholder: n.getAttribute("placeholder") || "", required: n.hasAttribute("required"), multiline: false, type });
        }
        continue;
      }
      if (t === "textarea") {
        buttons = null;
        out.push({ kind: "text", name: n.getAttribute("name") || "", label: labelFor(n) || (closest(n, "label") ? inline(closest(n, "label")!) : ""),
          value: n.text, placeholder: n.getAttribute("placeholder") || "", required: n.hasAttribute("required"), multiline: true, type: "textarea" });
        continue;
      }
      if (t === "select") {
        const name = n.getAttribute("name") || "";
        const opts = n.querySelectorAll("option");
        const anySel = opts.some(o => o.hasAttribute("selected"));
        buttons = null;
        out.push({ kind: "radio", name, label: labelFor(n), required: n.hasAttribute("required"),
          choices: opts.map((o, k) => ({ value: o.getAttribute("value") ?? o.text.trim(), title: o.text.trim(), detail: "", checked: anySel ? o.hasAttribute("selected") : k === 0, disabled: o.hasAttribute("disabled") })) });
        continue;
      }
      if (t === "button") { addButton(n, inline(n) || n.getAttribute("value") || "Submit", (n.getAttribute("type") || "submit").toLowerCase() === "submit"); continue; }
      if (t === "label") {
        const ctl = n.querySelector("input, textarea, select");
        if (ctl) { walk([ctl], true); continue; }
        if (n.getAttribute("for") && form.querySelector(`#${n.getAttribute("for")}`)) continue; // drawn with its control
        note(inline(n)); continue;
      }
      const md = blockMd(n);
      if (md !== null && !n.querySelector("input, textarea, select, button")) { note(md); continue; }
      walk(n.childNodes, inLabel);
    }
  };
  const addButton = (n: HTMLElement, text: string, submit: boolean) => {
    if (!buttons) { buttons = { kind: "buttons", buttons: [] }; out.push(buttons); }
    const c = cls(n);
    buttons.buttons.push({ name: n.getAttribute("name") || "", value: n.getAttribute("value") || "", text: text.replace(/\*+/g, ""), submit,
      primary: c.includes("primary") || (submit && (n.getAttribute("type") || "submit") === "submit" && !n.getAttribute("name")), danger: c.includes("danger") });
  };
  walk(form.childNodes, false);
  if (!out.some(c => c.kind === "buttons")) out.push({ kind: "buttons", buttons: [{ name: "", value: "", text: "Submit", submit: true, primary: true, danger: false }] });
  return out;
}

// n's ancestors below `stop`.
function ancestorsUntil(n: HTMLElement, stop: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = n.parentNode as HTMLElement | null; p && p !== stop; p = p.parentNode as HTMLElement) out.push(p);
  return out;
}

function closest(n: HTMLElement, t: string): HTMLElement | null {
  for (let p: HTMLElement | null = n.parentNode as HTMLElement; p; p = p.parentNode as HTMLElement) if (isEl(p) && tag(p) === t) return p;
  return null;
}

