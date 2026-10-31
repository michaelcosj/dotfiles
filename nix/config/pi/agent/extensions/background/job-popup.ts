import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

/** A bounded, UI-only snapshot viewer. Closing never stops the job. */
export class JobPopup {
  private content: Text;
  private offset = 0;
  private pageSize = 1;
  private maxOffset = 0;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private snapshot: () => string,
    private done: () => void,
  ) {
    this.content = new Text(snapshot(), 0, 0);
  }

  invalidate() { this.content.invalidate(); }

  handleInput(data: string) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }
    if (data === "r") {
      this.content.setText(this.snapshot());
    } else if (matchesKey(data, "up")) {
      this.offset--;
    } else if (matchesKey(data, "down")) {
      this.offset++;
    } else if (matchesKey(data, "pageUp")) {
      this.offset -= this.pageSize;
    } else if (matchesKey(data, "pageDown")) {
      this.offset += this.pageSize;
    } else if (matchesKey(data, "home")) {
      this.offset = 0;
    } else if (matchesKey(data, "end")) {
      this.offset = this.maxOffset;
    } else {
      return;
    }
    this.offset = Math.max(0, Math.min(this.maxOffset, this.offset));
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 2);
    const height = Math.max(1, Math.min(30, Math.floor(this.tui.terminal.rows * 0.8)) - 4);
    const content = this.content.render(inner);
    this.pageSize = height;
    this.maxOffset = Math.max(0, content.length - height);
    this.offset = Math.min(this.offset, this.maxOffset);
    const border = (text: string) => this.theme.fg("border", text);
    const row = (text: string) => border("│") + truncateToWidth(text, inner, "…", true) + border("│");
    const lines = [border(`╭${"─".repeat(inner)}╮`)];
    for (const line of content.slice(this.offset, this.offset + height)) lines.push(row(line));
    const end = Math.min(content.length, this.offset + height);
    lines.push(
      row(this.theme.fg("dim", `${this.offset + 1}–${end}/${content.length} · ↑↓ PgUp/PgDn · r refresh · Esc close`)),
      border(`╰${"─".repeat(inner)}╯`),
    );
    // Very narrow terminals must not overflow because of the two border columns.
    return lines.map((line) => truncateToWidth(line, width));
  }
}
