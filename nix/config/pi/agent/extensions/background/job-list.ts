import type { Theme } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, isKeyRelease, matchesKey, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

export interface JobItem {
  name: string;
  /** one line: state, age, command */
  label: string;
  running: boolean;
  startedAt: number;
}

/** Running jobs first, newest first within each group. */
export function sortJobs(items: JobItem[]): JobItem[] {
  return [...items].sort((a, b) => Number(b.running) - Number(a.running) || b.startedAt - a.startedAt);
}

/** A job picker with a search box. Type to filter; ↑↓ select; Enter opens; Esc closes. */
export class JobList {
  private input = new Input({ prompt: "Search: " });
  private index = 0;
  private offset = 0;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private items: JobItem[],
    private done: (name: string | undefined) => void,
  ) {}

  private visible(): JobItem[] {
    const q = this.input.getValue().trim();
    return q ? fuzzyFilter(this.items, q, (i) => `${i.name} ${i.label}`) : this.items;
  }

  // The Input inside shows the cursor while this list has focus.
  set focused(v: boolean) {
    this.input.focused = v;
  }
  get focused() {
    return this.input.focused;
  }

  invalidate() {}

  handleInput(data: string) {
    if (isKeyRelease(data)) return;
    const list = this.visible();
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.done(undefined);
    if (matchesKey(data, "enter")) return this.done(list[this.index]?.name);
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+k")) this.index = Math.max(0, this.index - 1);
    else if (matchesKey(data, "down") || matchesKey(data, "ctrl+j")) this.index = Math.min(list.length - 1, this.index + 1);
    else {
      this.input.handleInput(data);
      this.index = 0;
      this.offset = 0;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(1, width - 2);
    const border = (s: string) => t.fg("border", s);
    const row = (s: string) => border("│") + truncateToWidth(s, inner, "…", true) + border("│");
    const list = this.visible();
    const height = Math.max(3, Math.min(20, Math.floor(this.tui.terminal.rows * 0.6) - 6));
    this.index = Math.max(0, Math.min(this.index, list.length - 1));
    if (this.index < this.offset) this.offset = this.index;
    if (this.index >= this.offset + height) this.offset = this.index - height + 1;
    const lines = [border(`╭${"─".repeat(inner)}╮`), row(t.bold(" Background jobs"))];
    for (const l of this.input.render(inner - 1)) lines.push(row(` ${l}`));
    lines.push(border(`├${"─".repeat(inner)}┤`));
    if (!list.length) lines.push(row(t.fg("dim", " No matching jobs")));
    list.slice(this.offset, this.offset + height).forEach((item, i) => {
      const selected = this.offset + i === this.index;
      const mark = item.running ? t.fg("success", "●") : t.fg("dim", "○");
      const text = `${selected ? t.fg("accent", "›") : " "} ${mark} ${selected ? t.bold(item.name) : item.name}  ${t.fg("dim", item.label)}`;
      lines.push(row(text));
    });
    lines.push(row(t.fg("dim", ` ${list.length}/${this.items.length} · type to search · ↑↓ select · enter open · esc close`)));
    lines.push(border(`╰${"─".repeat(inner)}╯`));
    return lines.map((l) => truncateToWidth(l, width));
  }
}
