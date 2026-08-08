/**
 * Takeover UI for subagents (ported from v1, rendering from the synchronous
 * SubagentReadModel instead of live pi sessions):
 * - SubagentDashboard: full popup (overlay) listing all subagents.
 * - TakeoverView: full interactive view of one subagent with an input line
 *   to steer/continue it.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatElapsed, type SubagentSnapshot } from "../state.js";
import { formatContextTokens } from "../format.js";
import type {
  SubagentCommandPort,
  SubagentReadModel,
} from "../manager.js";
import { buildTranscriptLines } from "./transcript.js";

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

/** Right-align transcript navigation in the white input panel's top border. */
export function inputNavigationBorder(
  width: number,
  hint: string,
  theme: Theme,
) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  const label = ` ${truncateToWidth(hint, Math.max(0, innerWidth - 2))} `;
  const labelWidth = visibleWidth(label);
  return truncateToWidth(
    theme.fg("text", "╭") +
      theme.fg("text", "─".repeat(Math.max(0, innerWidth - labelWidth - 1))) +
      theme.fg("dim", label) +
      theme.fg("text", "─╮"),
    safeWidth,
    "",
  );
}

/** Main-editor-style border with action controls embedded at the bottom. */
export function inputHintBorder(width: number, hint: string, theme: Theme) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  const label = ` ${truncateToWidth(hint, Math.max(0, innerWidth - 2))} `;
  const labelWidth = visibleWidth(label);
  return truncateToWidth(
    theme.fg("text", "╰") +
      theme.fg("text", "─") +
      theme.fg("dim", label) +
      theme.fg("text", "─".repeat(Math.max(0, innerWidth - labelWidth - 1))) +
      theme.fg("text", "╯"),
    safeWidth,
    "",
  );
}

/** Input supplies its own shell-like prompt; the bordered takeover does not. */
export function takeoverInputLine(width: number, line: string, theme: Theme) {
  const safeWidth = Math.max(6, width);
  const contentWidth = safeWidth - 4;
  const withoutPrompt = line.startsWith("> ") ? line.slice(2) : line;
  const content = truncateToWidth(withoutPrompt, contentWidth, "");
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
  return (
    theme.fg("text", "│ ") +
    theme.fg("text", content + padding) +
    theme.fg("text", " │")
  );
}

export function takeoverTranscriptRows(
  terminalRows: number,
  inputRows: number,
) {
  // Header (3), transcript/input gap (1), and input borders (2). Fill the
  // terminal so pi's main footer cannot bleed through beneath the overlay.
  return Math.max(1, terminalRows - inputRows - 6);
}

function statusHeaderLine(
  width: number,
  line: string,
  color: ReturnType<typeof subagentStatusColor>,
  theme: Theme,
) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  const content = truncateToWidth(line, innerWidth, "");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  return theme.fg(color, "│") + content + padding + theme.fg(color, "│");
}

export function subagentStatusColor(status: SubagentSnapshot["status"]) {
  switch (status) {
    case "running":
      return "warning" as const;
    case "done":
      return "success" as const;
    case "error":
      return "error" as const;
    case "cancelled":
      return "muted" as const;
  }
}

function statusGlyph(snap: SubagentSnapshot, theme: Theme): string {
  return theme.fg(subagentStatusColor(snap.status), "■");
}

function statusWord(snap: SubagentSnapshot, theme: Theme): string {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "running");
    case "done":
      return theme.fg("success", "done");
    case "error":
      return theme.fg("error", "failed");
    case "cancelled":
      return theme.fg("muted", "cancelled");
  }
}

// --- Entry points --------------------------------------------------------------

export interface TakeoverOptions {
  readonly badge?: string;
}

export async function openSubagentTakeover(
  ctx: ExtensionContext,
  view: SubagentReadModel,
  commands: SubagentCommandPort,
  id: string,
  options?: TakeoverOptions,
) {
  if (!view.get(id)) return;
  await ctx.ui.custom<null>(
    (tui, theme, keybindings, done) =>
      new TakeoverView(
        tui,
        theme,
        keybindings,
        id,
        view,
        commands,
        done,
        options,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}

export async function openSubagentPicker(
  ctx: ExtensionContext,
  view: SubagentReadModel,
  commands: SubagentCommandPort,
) {
  const selection: DashboardSelection = { index: 0 };

  while (true) {
    if (view.size() === 0) {
      ctx.ui.notify("No subagents", "info");
      return;
    }

    const picked = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) =>
        new SubagentDashboard(
          tui,
          theme,
          keybindings,
          view,
          commands,
          selection,
          done,
        ),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );

    if (!picked) return;
    if (!view.get(picked)) continue;

    await openSubagentTakeover(ctx, view, commands, picked);
    // After leaving the takeover view, fall back to the dashboard.
  }
}

// --- Dashboard (fullscreen overlay) ----------------------------------------------

export interface DashboardSelection {
  id?: string;
  index: number;
}

export function reconcileDashboardSelection(
  selection: DashboardSelection,
  subs: ReadonlyArray<Pick<SubagentSnapshot, "id">>,
) {
  const stableIndex = selection.id
    ? subs.findIndex((snap) => snap.id === selection.id)
    : -1;
  selection.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(Math.max(0, selection.index), Math.max(0, subs.length - 1));
  selection.id = subs[selection.index]?.id;
}

class SubagentDashboard implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private view: SubagentReadModel;
  private commands: SubagentCommandPort;
  private selection: DashboardSelection;
  private done: (value: string | null) => void;

  private closed = false;
  private ticker: ReturnType<typeof setInterval>;
  private unsubChange: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    view: SubagentReadModel,
    commands: SubagentCommandPort,
    selection: DashboardSelection,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.view = view;
    this.commands = commands;
    this.selection = selection;
    this.done = done;
    // Elapsed times, token counts, and statuses tick along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubChange = view.subscribe(() => this.tui.requestRender());
  }

  private subs(): ReadonlyArray<SubagentSnapshot> {
    return this.view.list();
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubChange();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    const subs = this.subs();
    reconcileDashboardSelection(this.selection, subs);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const snap = subs[this.selection.index];
      if (snap) this.close(snap.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      if (subs.length > 0) {
        this.selection.index =
          (this.selection.index - 1 + subs.length) % subs.length;
        this.selection.id = subs[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      if (subs.length > 0) {
        this.selection.index = (this.selection.index + 1) % subs.length;
        this.selection.id = subs[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (data === "x") {
      const snap = subs[this.selection.index];
      if (snap && snap.status === "running")
        void this.commands.requestAbort(snap.id).catch(() => {});
      return;
    }
  }

  private pad(text: string, width: number): string {
    const truncated = truncateToWidth(text, width);
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  }

  private borderSegment(width: number, title: string): string {
    const theme = this.theme;
    const label = title
      ? ` ${truncateToWidth(title, Math.max(0, width - 3))} `
      : "";
    const labelWidth = visibleWidth(label);
    return (
      theme.fg("border", "─") +
      (label ? theme.fg("text", label) : "") +
      theme.fg("border", "─".repeat(Math.max(0, width - 1 - labelWidth)))
    );
  }

  render(width: number): string[] {
    const theme = this.theme;
    const subs = this.subs();
    reconcileDashboardSelection(this.selection, subs);

    const rows = this.tui.terminal.rows || 30;
    // Render exactly terminal rows - 1 so the overlay covers the header,
    // chat, editor, and extra footer lines while leaving pi's final footer
    // row visible.
    const bodyHeight = Math.max(6, rows - 3);
    const innerWidth = width - 2;

    const lines: string[] = [];

    // Header: title left, count right
    const headerLeft = theme.fg("accent", theme.bold("Subagents"));
    const headerRight = theme.fg(
      "muted",
      `${subs.length} agent${subs.length === 1 ? "" : "s"}`,
    );
    const headerPad = Math.max(
      1,
      width - visibleWidth(headerLeft) - visibleWidth(headerRight) - 4,
    );
    lines.push(
      truncateToWidth(
        `  ${headerLeft}${" ".repeat(headerPad)}${headerRight}  `,
        width,
      ),
    );

    // Top border with panel title
    const settled = subs.filter((s) => s.status !== "running").length;
    lines.push(
      theme.fg("border", "╭") +
        this.borderSegment(innerWidth, `agents · ${settled}/${subs.length}`) +
        theme.fg("border", "╮"),
    );

    // Rows
    const divider = theme.fg("border", "│");
    const rowLines = this.renderRows(subs, innerWidth, bodyHeight);
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(divider + this.pad(rowLines[i] ?? "", innerWidth) + divider);
    }

    // Controls live inside the panel border, matching the main input chrome.
    lines.push(
      theme.fg("border", "╰") +
        this.borderSegment(
          innerWidth,
          `${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")}/jk select · ${configuredKeys(this.keybindings, "tui.select.confirm")} take over · x abort · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ) +
        theme.fg("border", "╯"),
    );

    return lines;
  }

  private renderRows(
    subs: ReadonlyArray<SubagentSnapshot>,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const out: string[] = [];

    // Scroll window around selection
    let start = 0;
    if (subs.length > height) {
      start = Math.min(
        Math.max(0, this.selection.index - Math.floor(height / 2)),
        subs.length - height,
      );
    }
    const visible = subs.slice(start, start + height);

    for (let i = 0; i < visible.length; i++) {
      const snap = visible[i];
      const index = start + i;
      const isSelected = index === this.selection.index;

      // Left: marker, status square, title, dim id
      const marker = isSelected ? theme.fg("accent", "❯") : " ";
      const title = isSelected
        ? theme.fg("accent", snap.title)
        : theme.fg("text", snap.title);
      const left = ` ${marker} ${statusGlyph(snap, theme)} ${title} ${theme.fg("dim", snap.id)}`;

      // Right: backend · model · context utilization · elapsed · status
      const contextTokens = formatContextTokens(snap.usage);
      const dot = theme.fg("dim", " · ");
      const rightParts = [
        theme.fg("muted", snap.backend),
        theme.fg("muted", snap.meta.modelLabel ?? "?"),
        theme.fg("muted", snap.meta.reasoningEffort ?? "?"),
        ...(contextTokens ? [theme.fg("muted", contextTokens)] : []),
        theme.fg("muted", formatElapsed(snap)),
        statusWord(snap, theme),
      ];
      const right = `${rightParts.join(dot)} `;

      const rightWidth = visibleWidth(right);
      const leftMax = Math.max(0, width - rightWidth - 2);
      const leftTruncated = truncateToWidth(left, leftMax);
      const gap = Math.max(2, width - visibleWidth(leftTruncated) - rightWidth);
      out.push(truncateToWidth(leftTruncated + " ".repeat(gap) + right, width));
    }

    if (start > 0) {
      out[0] = truncateToWidth(theme.fg("dim", `   ... ${start} more`), width);
    }
    if (start + height < subs.length) {
      out[out.length - 1] = truncateToWidth(
        theme.fg("dim", `   ... ${subs.length - start - height} more`),
        width,
      );
    }
    return out;
  }

  invalidate(): void {}
}

// --- Takeover view ------------------------------------------------------------

const TRANSCRIPT_SCROLL_STEP = 6;

class TakeoverView implements Component, Focusable {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: SubagentReadModel;
  private commands: SubagentCommandPort;
  private done: (value: null) => void;
  private options?: TakeoverOptions;

  private input = new Input();
  /** Scroll offset in lines from the bottom of the transcript. 0 = pinned to bottom. */
  private scrollOffset = 0;
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;
  private actionError?: string;

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: SubagentReadModel,
    commands: SubagentCommandPort,
    done: (value: null) => void,
    options?: TakeoverOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.commands = commands;
    this.done = done;
    this.options = options;
    this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
    // Elapsed time in the header ticks along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.input.onSubmit = (value: string) => {
      const text = value.trim();
      if (!text) return;
      void this.commands
        .requestSend(this.id, text)
        .then(() => {
          this.input.setValue("");
          this.actionError = undefined;
          this.scrollOffset = 0;
          this.tui.requestRender();
        })
        .catch((error) => {
          this.actionError =
            error instanceof Error ? error.message : String(error);
          this.tui.requestRender();
        });
    };
  }

  private snap(): SubagentSnapshot | undefined {
    return this.view.get(this.id);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // Streaming can emit an event per token. Limit terminal repaints so this
    // view cannot starve input handling or make the child look frozen.
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.ticker);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    return true;
  }

  private close() {
    if (this.cleanup()) this.done(null);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "app.clear")) {
      const snap = this.snap();
      if (snap?.status === "running")
        void this.commands.requestAbort(this.id).catch((error) => {
          this.actionError =
            error instanceof Error ? error.message : String(error);
          this.tui.requestRender();
        });
      return;
    }
    if (
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp")) {
      this.scrollOffset += TRANSCRIPT_SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorDown")) {
      this.scrollOffset = Math.max(
        0,
        this.scrollOffset - TRANSCRIPT_SCROLL_STEP,
      );
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageUp")) {
      this.scrollOffset += this.viewportHeight();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageDown")) {
      this.scrollOffset = Math.max(
        0,
        this.scrollOffset - this.viewportHeight(),
      );
      this.tui.requestRender();
      return;
    }
    this.input.handleInput(data);
    this.tui.requestRender();
  }

  private viewportHeight(): number {
    return Math.max(6, takeoverTranscriptRows(this.tui.terminal.rows || 30, 1));
  }

  render(width: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const snap = this.snap();

    if (!snap) {
      const innerWidth = Math.max(0, width - 2);
      lines.push(theme.fg("muted", `╭${"─".repeat(innerWidth)}╮`));
      lines.push(
        statusHeaderLine(
          width,
          theme.fg("dim", `${this.id} is no longer tracked`),
          "muted",
          theme,
        ),
      );
      lines.push(theme.fg("muted", `╰${"─".repeat(innerWidth)}╯`));
      return lines;
    }

    const stateColor = subagentStatusColor(snap.status);
    const innerWidth = Math.max(0, width - 2);
    lines.push(theme.fg(stateColor, `╭${"─".repeat(innerWidth)}╮`));
    const contextTokens = formatContextTokens(snap.usage);
    const header =
      `${statusGlyph(snap, theme)} ` +
      theme.fg(stateColor, theme.bold(`${snap.id} · ${snap.title}`)) +
      theme.fg("muted", ` · ${snap.status} · ${formatElapsed(snap)}`) +
      (this.options?.badge
        ? theme.fg("muted", ` · ${this.options.badge}`)
        : "") +
      theme.fg("dim", ` · ${snap.backend}: ${snap.meta.modelLabel ?? "?"}`) +
      theme.fg("dim", ` · ${snap.meta.reasoningEffort ?? "?"}`) +
      (contextTokens ? theme.fg("dim", ` · ${contextTokens}`) : "");
    lines.push(statusHeaderLine(width, header, stateColor, theme));
    lines.push(theme.fg(stateColor, `╰${"─".repeat(innerWidth)}╯`));

    // Fixed-height transcript viewport. Error and scroll status consume rows
    // inside the viewport so streaming/scrolling never changes overlay height.
    const transcript = buildTranscriptLines(snap, width, theme);
    // Input's two-character prompt is replaced by panel padding and side borders.
    const inputLines = this.input.render(Math.max(2, width - 2));
    const rows = this.tui.terminal.rows || 30;
    const viewport = takeoverTranscriptRows(rows, inputLines.length);
    const errorRows = snap.errorText || this.actionError ? 1 : 0;
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const transcriptCapacity = Math.max(1, viewport - errorRows - scrollRows);
    const maxOffset = Math.max(0, transcript.length - transcriptCapacity);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

    const body: string[] = [];
    const visibleError = this.actionError ?? snap.errorText;
    if (visibleError) {
      body.push(
        truncateToWidth(theme.fg("error", `error: ${visibleError}`), width),
      );
    }

    const capacity = Math.max(
      1,
      viewport - body.length - (this.scrollOffset > 0 ? 1 : 0),
    );
    const end = transcript.length - this.scrollOffset;
    const visible = transcript.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0) body.push(theme.fg("dim", "(no output yet)"));
    else body.push(...visible);

    if (this.scrollOffset > 0) {
      body.push(
        truncateToWidth(
          theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`),
          width,
        ),
      );
    }
    while (body.length < viewport) body.push("");
    lines.push(...body.slice(0, viewport));

    // Dedicated spacer prevents the streaming transcript from visually
    // colliding with (or appearing to overwrite) the input surface.
    lines.push("");
    // White editor chrome differentiates takeover input from the main editor.
    lines.push(
      inputNavigationBorder(
        width,
        `${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")} scroll · ${configuredKeys(this.keybindings, "tui.editor.pageUp")}/${configuredKeys(this.keybindings, "tui.editor.pageDown")} page`,
        theme,
      ),
    );
    lines.push(
      ...inputLines.map((line) => takeoverInputLine(width, line, theme)),
    );
    lines.push(
      inputHintBorder(
        width,
        `${configuredKeys(this.keybindings, "tui.input.submit")} send · ${configuredKeys(this.keybindings, "app.interrupt")} back · ${configuredKeys(this.keybindings, "app.clear")} abort run`,
        theme,
      ),
    );
    return lines;
  }

  invalidate(): void {
    this.input.invalidate();
  }
}
