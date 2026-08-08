import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

export type EditorMode = "normal" | "insert";

const NORMAL_KEYS: Record<string, string> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  b: "\x1bb",
  "0": "\x01",
  $: "\x05",
  x: "\x1b[3~",
  X: "\x7f",
  u: "\x1f",
};

/** A deliberately small Vim-like layer over Pi's application-aware editor. */
export class ModalEditor extends CustomEditor {
  private mode: EditorMode = "insert";
  private discardingPaste = false;
  private pasteMarkerPrefix = "";

  getMode(): EditorMode {
    return this.mode;
  }

  private setMode(mode: EditorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.tui.requestRender();
  }

  private enterInsert(sequence?: string): void {
    if (sequence) super.handleInput(sequence);
    this.setMode("insert");
  }

  private moveToNextWord(): void {
    const { line, col } = this.getCursor();
    const text = this.getLines()[line] ?? "";
    let target = col;
    if (/\s/u.test(text[target] ?? "")) {
      while (target < text.length && /\s/u.test(text[target] ?? "")) target++;
    } else {
      while (target < text.length && !/\s/u.test(text[target] ?? "")) target++;
      while (target < text.length && /\s/u.test(text[target] ?? "")) target++;
    }
    if (target === col && col >= text.length) {
      super.handleInput("\x1b[C");
      return;
    }
    while (this.getCursor().col < target) super.handleInput("\x1b[C");
  }

  private consumeNormalModePaste(data: string): string[] {
    const start = "\x1b[200~";
    const end = "\x1b[201~";
    const ordinary: string[] = [];
    const pending = this.pasteMarkerPrefix;
    const expected = this.discardingPaste ? end : start;

    // Pi's stdin buffer normally emits complete bracketed-paste markers. Keep
    // a standalone normal-mode Escape immediate so the app interrupt remains
    // responsive; only longer marker prefixes are buffered across calls.
    if (!this.discardingPaste && !pending && data === "\x1b") return [data];

    let input = pending + data;
    this.pasteMarkerPrefix = "";

    // A previously buffered marker prefix that diverges is ordinary input in
    // its own right. Keep it separate from this chunk so Escape/application
    // shortcuts are not merged with the following key.
    if (!this.discardingPaste && pending && !expected.startsWith(input)) {
      ordinary.push(pending);
      input = data;
    }

    while (input) {
      const marker = this.discardingPaste ? end : start;
      const index = input.indexOf(marker);
      if (index >= 0) {
        if (!this.discardingPaste && index > 0) ordinary.push(input.slice(0, index));
        input = input.slice(index + marker.length);
        this.discardingPaste = !this.discardingPaste;
        continue;
      }

      let prefixLength = 0;
      for (let length = Math.min(marker.length - 1, input.length); length >= 1; length--) {
        if (marker.startsWith(input.slice(-length))) {
          prefixLength = length;
          break;
        }
      }
      const complete = prefixLength ? input.slice(0, -prefixLength) : input;
      if (!this.discardingPaste && complete) ordinary.push(complete);
      if (prefixLength) this.pasteMarkerPrefix = input.slice(-prefixLength);
      break;
    }
    return ordinary;
  }

  handleInput(data: string): void {
    if (this.mode === "normal") {
      const ordinary = this.consumeNormalModePaste(data);
      for (const segment of ordinary) this.dispatchInput(segment);
      return;
    }
    this.dispatchInput(data);
  }

  private dispatchInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.mode === "insert") {
        // Escape should close autocomplete before it changes editor mode.
        if (this.isShowingAutocomplete()) {
          super.handleInput(data);
        } else {
          this.setMode("normal");
        }
      } else {
        // Preserve Pi's normal interrupt/abort behavior on a second Escape.
        super.handleInput(data);
      }
      return;
    }

    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }

    const mapped = NORMAL_KEYS[data];
    if (mapped) {
      super.handleInput(mapped);
      return;
    }

    switch (data) {
      case "w":
        this.moveToNextWord();
        return;
      case "i":
        this.enterInsert();
        return;
      case "a":
        this.enterInsert("\x1b[C");
        return;
      case "I":
        this.enterInsert("\x01");
        return;
      case "A":
        this.enterInsert("\x05");
        return;
      case "o":
        super.handleInput("\x05");
        this.enterInsert("\x0a");
        return;
      case "O":
        super.handleInput("\x01");
        super.handleInput("\x0a");
        super.handleInput("\x1b[A");
        this.setMode("insert");
        return;
    }

    // Suppress printable text (including multi-codepoint IME commits) while
    // still forwarding control sequences and application shortcuts to Pi.
    if (data.length > 0 && Array.from(data).every((char) => char >= " ")) return;
    super.handleInput(data);
  }
}
