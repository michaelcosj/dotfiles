// A page as a list of blocks the tui viewer draws: Markdown, Mermaid diagrams,
// and form controls. html.ts turns HTML pages into blocks.

export type Choice = { value: string; title: string; detail: string; checked: boolean; disabled: boolean };
export type Control =
  | { kind: "radio"; name: string; label: string; choices: Choice[]; required: boolean }
  | { kind: "checkbox"; name: string; label: string; choices: Choice[] }
  | { kind: "text"; name: string; label: string; value: string; placeholder: string; required: boolean; multiline: boolean; type: string }
  | { kind: "buttons"; buttons: { name: string; value: string; text: string; submit: boolean; primary: boolean; danger: boolean }[] }
  | { kind: "hidden"; name: string; value: string }
  | { kind: "range"; name: string; label: string; min: number; max: number; step: number; value: number }
  | { kind: "note"; markdown: string };

export type Block =
  | { kind: "markdown"; text: string }
  | { kind: "mermaid"; source: string }
  | { kind: "form"; controls: Control[] };

// Markdown: split out ```mermaid fences, keep the rest as text.
export function fromMarkdown(md: string): Block[] {
  const out: Block[] = [];
  const re = /^(```|~~~)\s*mermaid\s*\n([\s\S]*?)\n\1\s*$/gm;
  let last = 0;
  for (const m of md.matchAll(re)) {
    push(out, md.slice(last, m.index));
    out.push({ kind: "mermaid", source: m[2] });
    last = m.index! + m[0].length;
  }
  push(out, md.slice(last));
  return out;
}

export function push(out: Block[], text: string) {
  if (text.trim()) {
    const prev = out[out.length - 1];
    if (prev?.kind === "markdown") prev.text += "\n\n" + text.trim();
    else out.push({ kind: "markdown", text: text.trim() });
  }
}

// The value a browser's FormData would send: repeated names become arrays.
export function formValue(controls: Control[], state: Map<Control, any>, button?: { name: string; value: string }): Record<string, any> {
  const o: Record<string, any> = {};
  const add = (k: string, v: string) => { if (!k) return; o[k] = k in o ? [].concat(o[k], v) : v; };
  for (const c of controls) {
    if (c.kind === "hidden") add(c.name, c.value);
    else if (c.kind === "radio") { const i = state.get(c); if (i != null && i >= 0) add(c.name, c.choices[i].value); }
    else if (c.kind === "checkbox") (state.get(c) as boolean[]).forEach((on, k) => on && add(c.name, c.choices[k].value));
    else if (c.kind === "text") add(c.name, state.get(c) ?? c.value);
    else if (c.kind === "range") add(c.name, String(state.get(c) ?? c.value));
  }
  // A named button's value replaces a field of the same name (a "Neither"
  // button answers instead of the radio choice), which is what agents mean.
  if (button?.name) o[button.name] = button.value;
  return o;
}
