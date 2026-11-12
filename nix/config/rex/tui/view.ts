// rex-web's tui viewer: draws Markdown, Mermaid diagrams and <form data-rex>
// as terminal text with OpenTUI, in the Rex theme. rex-web starts it in a
// pane (`rex-web show` picks it for pages it can draw); it serves the same
// control socket as the Chrome viewer, so `wait`, `hide` and `status` work
// the same.
//
//   bun view.ts --name NAME --state DIR FILE    (from rex-web show)
//   bun view.ts FILE                            (try it in any terminal)
//
// Keys: tab / shift-tab move between fields, j/k or arrows move within a
// choice list, space toggles, enter submits (alt+enter: new line in a text
// box), PgUp/PgDn/g/G scroll, ctrl-r reloads, ctrl-q closes.
import { readFileSync, watch, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, extname, basename } from "node:path";
import {
  createCliRenderer, BoxRenderable, TextRenderable, ScrollBoxRenderable, MarkdownRenderable, ImageRenderable,
  InputRenderable, TextareaRenderable, SyntaxStyle, RGBA, type CliRenderer, type Renderable, type KeyEvent,
} from "@opentui/core";
import { fromHTML, fromMarkdown, formValue, type Block, type Control } from "./content.ts";
import { makeTheme, mix, themeKey, type Theme } from "./theme.ts";
import { layout, rasterize, type Diagram } from "./mermaid.ts";

// ---- arguments ----
const args = process.argv.slice(2);
let name = "", stateDir = "", file = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--name") name = args[++i];
  else if (args[i] === "--state") stateDir = args[++i];
  else file = args[i];
}
if (!file) { console.error("usage: view.ts [--name N --state DIR] FILE"); process.exit(2); }
file = resolve(file.replace(/^file:\/\//, ""));

const DEBUG = process.env.REX_WEB_DEBUG;
const log = (...a: any[]) => DEBUG && require("node:fs").appendFileSync(DEBUG, "[tui] " + a.join(" ") + "\n");

// ---- renderer and theme ----
const r: CliRenderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, targetFps: 30, autoFocus: false });
let theme: Theme = makeTheme();

async function readTheme(): Promise<boolean> {
  try {
    r.clearPaletteCache();
    const c = await r.getPalette({ size: 16, timeout: 800 });
    log("palette", c.defaultForeground, c.defaultBackground, c.palette.slice(0, 8).join(" "));
    const next = makeTheme(c.defaultForeground, c.defaultBackground, c.palette);
    if (themeKey(next) === themeKey(theme)) return false;
    theme = next;
    return true;
  } catch (e: any) { log("palette", e?.message); return false; }
}

// Plain text and the page background use the terminal's default colors
// (SGR 39/49), so they're right even before the pane reports its fg/bg.
// (A snapshot color argument would make OpenTUI write that RGB instead.)
const FG = () => RGBA.defaultForeground();
const BG = () => RGBA.defaultBackground();

function syntax(): SyntaxStyle {
  const t = theme;
  return SyntaxStyle.fromStyles({
    default: { fg: FG() },
    conceal: { fg: t.muted },
    "markup.heading": { fg: t.accent, bold: true },
    "markup.heading.1": { fg: t.accent, bold: true, underline: true },
    "markup.heading.2": { fg: t.accent, bold: true },
    "markup.heading.3": { fg: t.magenta, bold: true },
    "markup.heading.4": { fg: t.muted, bold: true }, "markup.heading.5": { fg: t.muted, bold: true }, "markup.heading.6": { fg: t.muted, bold: true },
    "markup.list.checked": { fg: t.green }, "markup.list.unchecked": { fg: t.muted },
    "markup.raw.block": { fg: FG() }, "markup.link.bracket.close": { fg: t.muted },
    "punctuation.special": { fg: t.muted }, "string.escape": { fg: t.muted }, label: { fg: t.cyan },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { dim: true },
    "markup.raw": { fg: t.cyan },
    "markup.link": { fg: t.muted },
    "markup.link.label": { fg: t.accent, underline: true },
    "markup.link.url": { fg: t.muted, underline: true },
    "markup.list": { fg: t.muted },
    "markup.quote": { fg: t.muted, italic: true },
    keyword: { fg: t.magenta }, "keyword.function": { fg: t.magenta }, "keyword.return": { fg: t.magenta },
    string: { fg: t.green }, "string.special": { fg: t.green }, number: { fg: t.yellow }, boolean: { fg: t.yellow },
    constant: { fg: t.yellow }, "constant.builtin": { fg: t.yellow },
    function: { fg: t.blue }, "function.call": { fg: t.blue }, "function.method": { fg: t.blue }, "function.method.call": { fg: t.blue },
    type: { fg: t.yellow }, "type.builtin": { fg: t.yellow }, constructor: { fg: t.yellow },
    variable: { fg: t.fg }, "variable.member": { fg: t.cyan }, property: { fg: t.cyan }, "variable.parameter": { fg: t.fg },
    operator: { fg: t.cyan }, punctuation: { fg: t.muted }, "punctuation.bracket": { fg: t.muted }, "punctuation.delimiter": { fg: t.muted },
    comment: { fg: t.muted, italic: true }, tag: { fg: t.red }, attribute: { fg: t.yellow },
  }, r.nativeScene);
}

// ---- the page ----
let blocks: Block[] = [];
function load() {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const md = /\.(md|markdown)$/i.test(file) || !text.trimStart().startsWith("<");
  blocks = md ? fromMarkdown(text) : fromHTML(text);
  const title = md ? /^#\s+(.+)$/m.exec(text)?.[1] : /<h1[^>]*>([^<]+)/i.exec(text)?.[1] || /<title>([^<]+)/i.exec(text)?.[1];
  if (title) process.stdout.write(`\x1b]2;${title.replace(/[\x00-\x1f]/g, "")}\x07`);
}

// Form state survives rebuilds (theme change, resize redraw, reload of the same form).
type Field = { focus: () => void; blur: () => void; key?: (k: KeyEvent) => boolean; box: Renderable; control?: Control; button?: number };
const formState = new Map<string, any>(); // key: form index + control name/kind
let fields: Field[] = [];
let focused = -1;
let sent: string | null = null;
let errorLine: TextRenderable | null = null;
const diagrams = new Map<string, Diagram | { error: string }>();

let scroll: ScrollBoxRenderable;
let mdStyle: SyntaxStyle | null = null;

function build() {
  const keepScroll = scroll?.scrollTop ?? 0;
  const keepFocus = focused;
  r.root.getChildren().forEach(c => { r.root.remove(c); c.destroyRecursively(); });
  mdStyle?.destroy?.();
  mdStyle = syntax();
  r.setBackgroundColor(BG());
  fields = []; focused = -1; errorLine = null;

  scroll = new ScrollBoxRenderable(r, {
    width: "100%", height: "100%", scrollY: true, focusable: false,
    contentOptions: { flexDirection: "column", paddingX: 2, paddingY: 1, gap: 1 },
    verticalScrollbarOptions: { trackOptions: { foregroundColor: theme.border, backgroundColor: BG() } as any },
  });
  r.root.add(scroll);

  let formIndex = 0;
  for (const b of blocks) {
    if (b.kind === "markdown") scroll.add(markdown(b.text));
    else if (b.kind === "mermaid") scroll.add(mermaid(b.source));
    else scroll.add(form(b.controls, formIndex++));
  }
  if (sent !== null) scroll.add(text(`✓ Sent ${sent}`, theme.green));

  quietFocus = true;
  if (fields.length) setFocus(keepFocus >= 0 && keepFocus < fields.length ? keepFocus : 0);
  quietFocus = false;
  // scrollTo applies again after the next layout, against the new content
  scroll.scrollTo(keepScroll);
}

// Focus set by a rebuild doesn't scroll the page to the field.
let quietFocus = false;
const reveal = (n: Renderable) => { if (!quietFocus) scroll.scrollChildIntoView(n, { inset: 1 } as any); };

const text = (s: string, color: string | RGBA = FG(), extra: any = {}) => new TextRenderable(r, { content: s, fg: color, wrapMode: "word", ...extra });

function markdown(md: string): Renderable {
  return new MarkdownRenderable(r, {
    content: md, syntaxStyle: mdStyle!, fg: FG(), width: "100%", conceal: true,
    tableOptions: { style: "grid", widthMode: "content", wrapMode: "word", borderColor: theme.border, borderStyle: "rounded" },
  });
}

// ---- mermaid ----
function mermaid(source: string): Renderable {
  let d = diagrams.get(source);
  if (!d) { d = layout(source); diagrams.set(source, d); }
  if ("error" in d) {
    const box = new BoxRenderable(r, { flexDirection: "column", width: "100%" });
    box.add(text(`Mermaid: ${d.error}`, theme.red));
    box.add(markdown("```\n" + source + "\n```"));
    return box;
  }
  // Size: the pane's width in pixels (or the diagram's own), height from its aspect ratio.
  const cols = Math.max(10, r.width - 6);
  const cell = cellSize();
  const pxWidth = Math.min(cols * cell.w, d.width * 2);
  const rows = Math.max(3, Math.min(Math.round((pxWidth * d.height / d.width) / cell.h), Math.max(8, r.height * 2)));
  const widthCells = Math.max(10, Math.min(cols, Math.round(pxWidth / cell.w)));
  const png = rasterize(d, theme, Math.round(widthCells * cell.w * 2)); // 2x for sharpness
  const img = new ImageRenderable(r, { source: png, fit: "fit", width: widthCells, height: rows, protocol: "auto",
    onError: (e) => log("image", String(e)) });
  return img;
}

function cellSize() {
  const res = (r as any).resolution as { width: number; height: number } | null;
  if (res?.width && r.width) return { w: res.width / r.width, h: res.height / r.height };
  return { w: 8, h: 17 };
}

// ---- forms ----
function form(controls: Control[], fi: number): Renderable {
  const box = new BoxRenderable(r, { flexDirection: "column", width: "100%", gap: 1 });
  const keyOf = (c: Control, k: number) => `${fi}:${k}:${c.kind}:${(c as any).name ?? ""}`;
  const state = new Map<Control, any>();

  controls.forEach((c, k) => {
    const sk = keyOf(c, k);
    if (c.kind === "note") { box.add(markdown(c.markdown)); return; }
    if (c.kind === "hidden") return;
    if (c.kind === "radio" || c.kind === "checkbox") {
      const multi = c.kind === "checkbox";
      if (!formState.has(sk)) formState.set(sk, multi ? c.choices.map(x => x.checked) : c.choices.findIndex(x => x.checked));
      const group = new BoxRenderable(r, { flexDirection: "column", width: "100%", gap: 0 });
      if (c.label) group.add(text(c.label, FG(), { attributes: 1 }));
      let cursor = multi ? 0 : Math.max(0, formState.get(sk) as number);
      const rows: BoxRenderable[] = [];
      const paint = () => {
        const v = formState.get(sk);
        c.choices.forEach((ch, j) => {
          const on = multi ? v[j] : v === j;
          const here = fields[focused]?.control === c && cursor === j;
          const row = rows[j];
          row.backgroundColor = here ? theme.subtle : on ? theme.surface : "transparent";
          row.borderColor = on ? theme.accent : here ? mix(theme.accent, theme.bg, 0.4) : theme.border;
          const [mark, label] = row.getChildren()[0].getChildren() as TextRenderable[];
          mark.content = multi ? (on ? "▣" : "□") : (on ? "◉" : "○");
          mark.fg = on ? theme.accent : theme.muted;
          label.fg = ch.disabled ? theme.muted : FG();
        });
      };
      c.choices.forEach((ch, j) => {
        const row = new BoxRenderable(r, { flexDirection: "column", width: "100%", border: true, borderStyle: "rounded", borderColor: theme.border, paddingX: 1 });
        const top = new BoxRenderable(r, { flexDirection: "row", gap: 1 });
        top.add(text("○", theme.muted));
        top.add(text(ch.title, FG(), { attributes: 1, flexGrow: 1 }));
        row.add(top);
        if (ch.detail) row.add(new MarkdownRenderable(r, { content: ch.detail, syntaxStyle: mdStyle!, fg: theme.muted, paddingLeft: 2, width: "100%" }));
        row.onMouseDown = () => { if (ch.disabled) return; setFocus(fields.indexOf(field)); cursor = j; pick(j); };
        rows.push(row); group.add(row);
      });
      const pick = (j: number) => {
        if (c.choices[j].disabled) return;
        if (multi) { const v = [...formState.get(sk)]; v[j] = !v[j]; formState.set(sk, v); }
        else formState.set(sk, j);
        paint();
      };
      const field: Field = {
        box: group, control: c,
        focus: () => { if (!multi) cursor = Math.max(0, formState.get(sk)); paint(); reveal(rows[cursor]); },
        blur: () => paint(),
        key: (e) => {
          const n = c.choices.length;
          if (e.name === "down" || e.name === "j" || e.name === "right" || e.name === "l") { cursor = (cursor + 1) % n; if (!multi) pick(cursor); else paint(); reveal(rows[cursor]); return true; }
          if (e.name === "up" || e.name === "k" || e.name === "left" || e.name === "h") { cursor = (cursor - 1 + n) % n; if (!multi) pick(cursor); else paint(); reveal(rows[cursor]); return true; }
          if (e.name === "space" || e.name === "x") { pick(cursor); return true; }
          return false;
        },
      };
      fields.push(field);
      state.set(c, undefined);
      box.add(group);
      queueMicrotask(paint);
      return;
    }
    if (c.kind === "text") {
      if (!formState.has(sk)) formState.set(sk, c.value);
      const group = new BoxRenderable(r, { flexDirection: "column", width: "100%" });
      if (c.label) group.add(text(c.label + (c.required ? " *" : ""), FG(), { attributes: 1 }));
      const frame = new BoxRenderable(r, { width: "100%", border: true, borderStyle: "rounded", borderColor: theme.border, paddingX: 1 });
      const opts: any = {
        width: "100%", textColor: FG(), focusedTextColor: FG(), backgroundColor: "transparent", focusedBackgroundColor: "transparent",
        placeholder: c.placeholder || null, placeholderColor: theme.muted, cursorColor: theme.accent,
      };
      const input: InputRenderable | TextareaRenderable = c.multiline
        ? new TextareaRenderable(r, { ...opts, initialValue: formState.get(sk), height: 4, wrapMode: "word",
            keyBindings: [{ name: "return", action: "submit" }, { name: "return", meta: true, action: "newline" }, { name: "linefeed", action: "newline" }] as any,
            onSubmit: () => submit() })
        : new InputRenderable(r, { ...opts, value: formState.get(sk) });
      const save = () => formState.set(sk, c.multiline ? (input as TextareaRenderable).plainText : (input as InputRenderable).value);
      input.on("input", save); input.on("change", save);
      (input as any).onContentChange = save;
      if (!c.multiline) input.on("enter", () => { save(); submit(); });
      frame.add(input); group.add(frame);
      frame.onMouseDown = () => setFocus(fields.indexOf(field));
      const field: Field = {
        box: group, control: c,
        focus: () => { frame.borderColor = theme.accent; input.focus(); reveal(frame); },
        blur: () => { save(); frame.borderColor = c.required && !formState.get(sk) && errorLine ? theme.red : theme.border; input.blur(); },
      };
      fields.push(field);
      state.set(c, undefined);
      box.add(group);
      return;
    }
    if (c.kind === "buttons") {
      const row = new BoxRenderable(r, { flexDirection: "row", gap: 2, flexWrap: "wrap" });
      c.buttons.forEach((b, j) => {
        const btn = new BoxRenderable(r, { border: true, borderStyle: "rounded", paddingX: 2, borderColor: theme.border });
        const label = text(b.text, FG(), { attributes: b.primary ? 1 : 0 });
        btn.add(label);
        const paint = (here: boolean) => {
          btn.backgroundColor = b.primary ? (here ? mix(theme.accent, theme.fg, 0.15) : theme.accent) : here ? theme.subtle : "transparent";
          btn.borderColor = b.primary ? theme.accent : here ? theme.accent : theme.border;
          label.fg = b.primary ? BG() : b.danger ? theme.red : FG();
        };
        paint(false);
        const field: Field = { box: btn, button: j, focus: () => paint(true), blur: () => paint(false),
          key: (e) => { if (e.name === "return" || e.name === "space") { if (b.submit) submit(b); return true; } return false; } };
        btn.onMouseDown = () => { setFocus(fields.indexOf(field)); if (b.submit) submit(b); };
        btn.onMouseOver = () => { if (fields[focused] !== field) paint(true); };
        btn.onMouseOut = () => { if (fields[focused] !== field) paint(false); };
        fields.push(field); row.add(btn);
      });
      box.add(row);
    }
  });
  errorLine = text("", theme.red);
  box.add(errorLine);

  // Values from formState, as FormData would send them.
  const submit = (button?: { name: string; value: string; submit?: boolean }) => {
    const st = new Map<Control, any>();
    const missing: string[] = [];
    controls.forEach((c, k) => {
      const v = formState.get(keyOf(c, k));
      if (c.kind === "radio") { st.set(c, v); if (c.required && (v == null || v < 0)) missing.push(c.label || c.name); }
      else if (c.kind === "checkbox") st.set(c, v ?? c.choices.map(x => x.checked));
      else if (c.kind === "text") { st.set(c, v ?? c.value); if (c.required && !String(v ?? "").trim()) missing.push(c.label || c.name); }
    });
    // A named button (like "Neither") answers on its own; required fields don't block it.
    if (missing.length && !button?.name) {
      errorLine!.content = `Fill in: ${missing.join(", ")}`;
      // focus the first missing field (which scrolls to it)
      const k = controls.findIndex((c, k) => (c.kind === "text" || c.kind === "radio") && c.required && missing.includes(c.label || c.name));
      const f = fields.findIndex(f => f.control === controls[k]);
      if (f >= 0) setFocus(f);
      return;
    }
    const value = formValue(controls, st, button);
    send(value);
  };
  return box;
}


function setFocus(i: number) {
  if (i < 0 || i >= fields.length) return;
  if (focused >= 0 && fields[focused]) fields[focused].blur();
  focused = i;
  fields[i].focus();
}

// ---- answers: the control socket ----
const events: any[] = [];
const waiters: ((v: any) => void)[] = [];
const CLOSED = Symbol("closed");
function send(value: any) {
  log("send", JSON.stringify(value));
  sent = summarize(value);
  const w = waiters.shift();
  if (w) w(value); else events.push(value);
  build();
}
function summarize(v: any): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const parts = Object.entries(v).filter(([, x]) => x !== "").map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : String(x).split("\n")[0].slice(0, 40)}`);
    return parts.join(" · ") || "";
  }
  return JSON.stringify(v);
}

let control: ReturnType<typeof Bun.serve> | null = null;
const sockPath = stateDir ? join(stateDir, "sock") : "";
function startControl() {
  mkdirSync(stateDir, { recursive: true });
  try { unlinkSync(sockPath); } catch {}
  control = Bun.serve({
    unix: sockPath, idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url), path = u.pathname;
      const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (path === "/status") return Response.json({ name, open: true, engine: "tui", url: "file://" + file, cols: r.width, rows: r.height, pending: events.length, pid: process.pid });
      if (path === "/open") {
        const target = String(body.url || "").replace(/^file:\/\//, "");
        if (!target) return new Response("no url", { status: 400 });
        // page.md and page.html (stdin) swap names, so always re-read
        file = resolve(decodeURIComponent(target)); events.length = 0; sent = null; formState.clear(); diagrams.clear();
        watchFile(); load(); build();
        return new Response("ok");
      }
      if (path === "/close") { setTimeout(quit, 10); return new Response("ok"); }
      if (path === "/shot") return new Response("tui", { status: 501 });
      if (path === "/eval") return new Response("eval needs the web engine (rex-web show --engine web)", { status: 400 });
      if (path === "/wait") {
        if (events.length) return new Response(JSON.stringify(events.shift()));
        const timeout = Number(u.searchParams.get("timeout") || 0);
        return new Promise<Response>(res => {
          let timer: any = 0;
          const w = (v: any) => { clearTimeout(timer); res(v === CLOSED ? new Response("closed", { status: 410 }) : new Response(JSON.stringify(v))); };
          if (timeout) timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); res(new Response("timeout", { status: 408 })); }, timeout * 1000);
          waiters.push(w);
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// ---- live reload ----
let watcher: ReturnType<typeof watch> | null = null;
function watchFile() {
  watcher?.close();
  let t: any;
  // the directory: editors replace files instead of writing in place
  watcher = watch(dirname(file), (_, f) => {
    if (f && basename(String(f)) !== basename(file)) return;
    clearTimeout(t); t = setTimeout(() => { load(); build(); }, 80);
  });
}

// ---- keys ----
r.keyInput.on("keypress", (e: KeyEvent) => {
  if (e.ctrl && (e.name === "q" || e.name === "c")) { e.preventDefault(); e.stopPropagation(); return quit(); }
  if (e.ctrl && e.name === "r") { e.preventDefault(); load(); build(); return; }
  if (e.name === "tab") {
    e.preventDefault(); e.stopPropagation();
    if (fields.length) setFocus((focused + (e.shift ? -1 : 1) + fields.length) % fields.length);
    return;
  }
  const f = fields[focused];
  const typing = f?.control?.kind === "text";
  if (f?.key && f.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
  if (typing) return; // the input handles it
  if (e.name === "return" && fields.length) {
    // enter on a choice list submits with the form's first submit button
    e.preventDefault();
    const btn = fields.find(x => x.button !== undefined);
    btn?.key?.({ name: "return" } as any);
    return;
  }
  const page = Math.max(1, r.height - 3);
  const by = (d: number) => scroll.scrollBy(d);
  if (e.name === "pagedown" || (e.name === "space" && !f) || (e.ctrl && e.name === "d")) by(e.ctrl ? page >> 1 : page);
  else if (e.name === "pageup" || e.name === "b" || (e.ctrl && e.name === "u")) by(-(e.ctrl ? page >> 1 : page));
  else if (!f && (e.name === "j" || e.name === "down")) by(1);
  else if (!f && (e.name === "k" || e.name === "up")) by(-1);
  else if (e.name === "g" && !e.shift) scroll.scrollTo(0);
  else if (e.name === "g" && e.shift || e.name === "G") scroll.scrollTo(Infinity);
});

// ---- run ----
let quitting = false;
function quit() {
  if (quitting) return; quitting = true;
  waiters.splice(0).forEach(w => w(CLOSED));
  watcher?.close();
  if (control) { try { control.stop(true); } catch {} try { unlinkSync(sockPath); } catch {} }
  try { r.destroy(); } catch {}
  setTimeout(() => process.exit(0), 50);
}
process.on("SIGTERM", quit); process.on("SIGHUP", quit);
process.on("uncaughtException", e => { log("crash", e?.stack); quit(); });
const ppid = process.ppid;
setInterval(() => { try { process.kill(ppid, 0); } catch { quit(); } }, 2000).unref();

load();
await readTheme();
build();
r.start();
if (stateDir) startControl();
watchFile();

// Theme: OpenTUI re-reads the palette on Rex's light/dark notification; a
// new pane reports defaults first, and dark→dark switches send nothing, so
// also re-read now and then (cheap: one OSC round trip).
r.on("palette", async () => { if (await readTheme()) build(); });
r.on("theme_mode", async () => { if (await readTheme()) build(); });
for (const ms of [300, 1200, 3000]) setTimeout(async () => { if (!quitting && await readTheme()) build(); }, ms);
setInterval(async () => { if (!quitting && await readTheme()) build(); }, 4000);

// Resize: text reflows by itself; diagrams are drawn for a width, so redraw them.
let resizeTimer: any;
r.on("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (blocks.some(b => b.kind === "mermaid")) build(); }, 150); });
