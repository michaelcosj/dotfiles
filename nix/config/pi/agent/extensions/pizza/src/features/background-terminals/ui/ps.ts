/**
 * /ps UI — two-stage full-screen overlay over the synchronous
 * TerminalReadModel:
 * - TerminalDashboard: list of all tracked terminals (select, kill, open).
 * - TerminalDetailView: read-only inspector for one terminal — metadata,
 *   stdout/stderr toggle, scrolling, live tail. No input surface: background
 *   terminals have no stdin by design.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { formatElapsed, formatExit, type TerminalSnapshot } from "../state.js";
import type {
  TerminalCommandPort,
  TerminalReadModel,
} from "../manager.js";
import { createOutputLineCache, sanitizeText } from "./output-view.js";

/** One-line-safe rendering of model-provided text (titles, commands): a
 * newline or control char inside a fixed-height row desyncs the renderer. */
function oneLine(text: string) {
  return sanitizeText(text.replace(/\s+/g, " "));
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

export function terminalDetailViewportRows(
  terminalRows: number,
  commandRows = 1,
) {
  // Header frame (3), command rows, output frame (2). Fill the terminal so
  // pi's main footer cannot bleed through beneath the overlay.
  return Math.max(6, terminalRows - commandRows - 5);
}

export function wrapTerminalCommand(command: string, width: number) {
  const textWidth = Math.max(1, width - 4); // side borders + "$ " prefix
  const wrapped = wrapTextWithAnsi(oneLine(command), textWidth);
  const rows = wrapped.length > 0 ? wrapped : [""];
  return rows.map((line, index) => `${index === 0 ? "$ " : "  "}${line}`);
}

export function terminalPanelBorder(
  width: number,
  left: string,
  right: string,
  position: "top" | "bottom",
  theme: Theme,
) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  if (innerWidth < 6) {
    const [start, end] = position === "top" ? ["╭", "╮"] : ["╰", "╯"];
    return theme.fg("text", `${start}${"─".repeat(innerWidth)}${end}`);
  }

  const labelBudget = innerWidth - 6;
  const safeLeft = truncateToWidth(left, labelBudget, "");
  const safeRight = truncateToWidth(
    right,
    Math.max(0, labelBudget - visibleWidth(safeLeft)),
    "",
  );
  const fill = "─".repeat(
    Math.max(0, labelBudget - visibleWidth(safeLeft) - visibleWidth(safeRight)),
  );
  const [start, end] = position === "top" ? ["╭", "╮"] : ["╰", "╯"];
  return (
    theme.fg("text", `${start}─ `) +
    theme.fg("dim", safeLeft) +
    theme.fg("text", ` ${fill} `) +
    theme.fg("dim", safeRight) +
    theme.fg("text", ` ─${end}`)
  );
}

export function terminalDetailActionHints(status: TerminalSnapshot["status"]) {
  return {
    left: "esc back",
    right:
      status === "running" ? "t switch stream · x kill" : "t switch stream",
  };
}

function terminalPanelLine(width: number, line: string, theme: Theme) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  const content = truncateToWidth(line, innerWidth, "");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  return theme.fg("text", "│") + content + padding + theme.fg("text", "│");
}

function statusHeaderLine(
  width: number,
  line: string,
  color: ReturnType<typeof terminalStatusColor>,
  theme: Theme,
) {
  const safeWidth = Math.max(2, width);
  const innerWidth = safeWidth - 2;
  const content = truncateToWidth(line, innerWidth, "");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  return theme.fg(color, "│") + content + padding + theme.fg(color, "│");
}

export function terminalStatusColor(status: TerminalSnapshot["status"]) {
  switch (status) {
    case "running":
      return "warning" as const;
    case "done":
      return "success" as const;
    case "failed":
      return "error" as const;
    case "killed":
      return "muted" as const;
  }
}

function statusGlyph(snap: TerminalSnapshot, theme: Theme) {
  return theme.fg(terminalStatusColor(snap.status), "■");
}

function statusWord(snap: TerminalSnapshot, theme: Theme) {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "running");
    case "done":
      return theme.fg("success", "done");
    case "failed":
      return theme.fg("error", "failed");
    case "killed":
      return theme.fg("muted", "killed");
  }
}

// --- Entry point ---------------------------------------------------------------

export async function openTerminalPicker(
  ctx: ExtensionCommandContext,
  view: TerminalReadModel,
  commands: TerminalCommandPort,
) {
  const selection: DashboardSelection = { index: 0 };

  while (true) {
    if (view.size() === 0) {
      ctx.ui.notify("No background terminals", "info");
      return;
    }

    const picked = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) =>
        new TerminalDashboard(
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

    await ctx.ui.custom<null>(
      (tui, theme, keybindings, done) =>
        new TerminalDetailView(
          tui,
          theme,
          keybindings,
          picked,
          view,
          commands,
          done,
        ),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );
    // After leaving the detail view, fall back to the dashboard.
  }
}

// --- Dashboard (fullscreen overlay) ----------------------------------------------

export interface DashboardSelection {
  id?: string;
  index: number;
}

export function reconcileDashboardSelection(
  selection: DashboardSelection,
  terminals: ReadonlyArray<Pick<TerminalSnapshot, "id">>,
) {
  const stableIndex = selection.id
    ? terminals.findIndex((snap) => snap.id === selection.id)
    : -1;
  selection.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(
          Math.max(0, selection.index),
          Math.max(0, terminals.length - 1),
        );
  selection.id = terminals[selection.index]?.id;
}

class TerminalDashboard implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private view: TerminalReadModel;
  private commands: TerminalCommandPort;
  private selection: DashboardSelection;
  private done: (value: string | null) => void;

  private closed = false;
  private ticker: ReturnType<typeof setInterval>;
  private unsubChange: () => void;
  private unsubOutput: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    view: TerminalReadModel,
    commands: TerminalCommandPort,
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
    // Elapsed times and output sizes tick along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubChange = view.subscribe(() => this.tui.requestRender());
    this.unsubOutput = view.subscribeOutput(() => this.tui.requestRender());
  }

  private terminals(): ReadonlyArray<TerminalSnapshot> {
    return this.view.list();
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubChange();
    this.unsubOutput();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const snap = terminals[this.selection.index];
      if (snap) this.close(snap.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      if (terminals.length > 0) {
        this.selection.index =
          (this.selection.index - 1 + terminals.length) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      if (terminals.length > 0) {
        this.selection.index = (this.selection.index + 1) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (data === "x") {
      const snap = terminals[this.selection.index];
      if (snap && snap.status === "running") this.commands.requestKill(snap.id);
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
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    const rows = this.tui.terminal.rows || 30;
    // Render exactly terminal rows - 1 so the overlay covers the header,
    // chat, editor, and extra footer lines while leaving pi's final footer
    // row visible.
    const bodyHeight = Math.max(6, rows - 3);
    const innerWidth = width - 2;

    const lines: string[] = [];

    // Header: title left, count right
    const headerLeft = theme.fg("accent", theme.bold("Background terminals"));
    const headerRight = theme.fg(
      "muted",
      `${terminals.length} terminal${terminals.length === 1 ? "" : "s"}`,
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
    const running = terminals.filter((s) => s.status === "running").length;
    lines.push(
      theme.fg("border", "╭") +
        this.borderSegment(
          innerWidth,
          `terminals · ${running} running / ${terminals.length}`,
        ) +
        theme.fg("border", "╮"),
    );

    // Rows
    const divider = theme.fg("border", "│");
    const rowLines = this.renderRows(terminals, innerWidth, bodyHeight);
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(divider + this.pad(rowLines[i] ?? "", innerWidth) + divider);
    }

    // Controls live inside the panel border, matching the main input chrome.
    lines.push(
      theme.fg("border", "╰") +
        this.borderSegment(
          innerWidth,
          `${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")}/jk select · ${configuredKeys(this.keybindings, "tui.select.confirm")} inspect · x kill · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ) +
        theme.fg("border", "╯"),
    );

    return lines;
  }

  private renderRows(
    terminals: ReadonlyArray<TerminalSnapshot>,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const out: string[] = [];

    // Scroll window around selection
    let start = 0;
    if (terminals.length > height) {
      start = Math.min(
        Math.max(0, this.selection.index - Math.floor(height / 2)),
        terminals.length - height,
      );
    }
    const visible = terminals.slice(start, start + height);

    for (let i = 0; i < visible.length; i++) {
      const snap = visible[i];
      const index = start + i;
      const isSelected = index === this.selection.index;

      // Left: marker, status square, title, dim id
      const marker = isSelected ? theme.fg("accent", "❯") : " ";
      const title = isSelected
        ? theme.fg("accent", oneLine(snap.title))
        : theme.fg("text", oneLine(snap.title));
      const left = ` ${marker} ${statusGlyph(snap, theme)} ${title} ${theme.fg("dim", snap.id)}`;

      // Right: pid · elapsed · exit/status
      const dot = theme.fg("dim", " · ");
      const rightParts = [
        theme.fg("muted", `pid ${snap.pid ?? "?"}`),
        theme.fg("muted", formatElapsed(snap)),
        snap.status === "running"
          ? statusWord(snap, theme)
          : theme.fg("muted", formatExit(snap)),
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
    if (start + height < terminals.length) {
      out[out.length - 1] = truncateToWidth(
        theme.fg("dim", `   ... ${terminals.length - start - height} more`),
        width,
      );
    }
    return out;
  }

  invalidate(): void {}
}

// --- Detail view (read-only inspector) --------------------------------------------

const OUTPUT_SCROLL_STEP = 6;

class TerminalDetailView implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: TerminalReadModel;
  private commands: TerminalCommandPort;
  private done: (value: null) => void;

  /** Active output stream shown in the viewport; `t` toggles. */
  private stream: "stdout" | "stderr" = "stdout";
  /** Scroll offset in lines from the bottom. 0 = pinned to bottom (live tail). */
  private scrollOffset = 0;
  private lineCache = createOutputLineCache();
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: TerminalReadModel,
    commands: TerminalCommandPort,
    done: (value: null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.commands = commands;
    this.done = done;
    this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
    // Elapsed time in the header ticks along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
  }

  private snap(): TerminalSnapshot | undefined {
    return this.view.get(this.id);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // A chatty process emits a chunk per write. Limit terminal repaints so
    // this view cannot starve input handling.
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
    if (
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (data === "t") {
      this.stream = this.stream === "stdout" ? "stderr" : "stdout";
      this.lineCache = createOutputLineCache();
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "x") {
      const snap = this.snap();
      if (snap?.status === "running") this.commands.requestKill(this.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") {
      this.scrollOffset += OUTPUT_SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (
      this.keybindings.matches(data, "tui.editor.cursorDown") ||
      data === "j"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - OUTPUT_SCROLL_STEP);
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
    if (data === "g") {
      this.scrollOffset = Number.MAX_SAFE_INTEGER; // clamped to top in render
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
  }

  private viewportHeight(): number {
    return terminalDetailViewportRows(this.tui.terminal.rows || 30);
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

    const stateColor = terminalStatusColor(snap.status);
    const innerWidth = Math.max(0, width - 2);
    lines.push(theme.fg(stateColor, `╭${"─".repeat(innerWidth)}╮`));
    const header =
      `${statusGlyph(snap, theme)} ` +
      theme.fg(stateColor, theme.bold(`${snap.id} · ${oneLine(snap.title)}`)) +
      theme.fg(
        "muted",
        ` · ${snap.status} · ${formatElapsed(snap)} · pid ${snap.pid ?? "?"}`,
      ) +
      (snap.status !== "running"
        ? theme.fg("muted", ` · ${formatExit(snap)}`)
        : "") +
      theme.fg("dim", ` · ${snap.cwd}`);
    lines.push(statusHeaderLine(width, header, stateColor, theme));
    const rows = this.tui.terminal.rows || 30;
    const wrappedCommand = wrapTerminalCommand(snap.command, width);
    const maxCommandRows = Math.max(1, rows - 11); // preserve six output rows
    const commandLines = wrappedCommand.slice(0, maxCommandRows);
    if (wrappedCommand.length > maxCommandRows) {
      const last = commandLines.length - 1;
      commandLines[last] = truncateToWidth(
        `${commandLines[last]} …`,
        Math.max(1, width - 2),
        "…",
      );
    }
    for (const commandLine of commandLines) {
      lines.push(
        statusHeaderLine(
          width,
          theme.fg("dim", commandLine.slice(0, 2)) +
            theme.fg("text", commandLine.slice(2)),
          stateColor,
          theme,
        ),
      );
    }
    lines.push(theme.fg(stateColor, `╰${"─".repeat(innerWidth)}╯`));

    // Stream selection stays left while output navigation is right-aligned.
    const active = this.stream;
    const viewData = active === "stdout" ? snap.stdout : snap.stderr;
    const streamLabel = `${active === "stdout" ? `[stdout ${formatSize(snap.stdout.totalBytes)}]` : `stdout ${formatSize(snap.stdout.totalBytes)}`} · ${active === "stderr" ? `[stderr ${formatSize(snap.stderr.totalBytes)}]` : `stderr ${formatSize(snap.stderr.totalBytes)}`}`;
    const navigationHint = `${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")}/jk scroll · ${configuredKeys(this.keybindings, "tui.editor.pageUp")}/${configuredKeys(this.keybindings, "tui.editor.pageDown")} page · g/G ends`;
    lines.push(
      terminalPanelBorder(width, streamLabel, navigationHint, "top", theme),
    );

    // Fixed-height output viewport. Notes and scroll status consume rows
    // inside the viewport so streaming/scrolling never changes overlay height.
    const buffer = viewData;
    const version =
      // The cached view text identity changes with the buffer; totalBytes is a
      // monotonically increasing proxy for a version counter.
      buffer.totalBytes;
    const output = this.lineCache.get(buffer.text, version, width - 4);
    const viewport = terminalDetailViewportRows(rows, commandLines.length);

    const noteRows: string[] = [];
    if (snap.errorText) {
      noteRows.push(
        truncateToWidth(
          theme.fg("error", `error: ${oneLine(snap.errorText)}`),
          width,
        ),
      );
    }
    if (buffer.truncatedBytes > 0) {
      noteRows.push(
        truncateToWidth(
          theme.fg(
            "dim",
            `first ${formatSize(buffer.truncatedBytes)} dropped from view — full log: ${buffer.spillPath ?? "(unavailable)"}`,
          ),
          width,
        ),
      );
    }

    const body: string[] = [...noteRows];
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    const maxOffset = Math.max(0, output.length - capacity);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

    const end = output.length - this.scrollOffset;
    const visible = output.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0) {
      body.push(theme.fg("dim", `(no ${active} yet)`));
    } else {
      for (const line of visible) {
        body.push(truncateToWidth(`  ${line}`, width));
      }
    }

    if (this.scrollOffset > 0) {
      body.push(
        truncateToWidth(
          theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`),
          width,
        ),
      );
    }
    while (body.length < viewport) body.push("");
    lines.push(
      ...body
        .slice(0, viewport)
        .map((line) => terminalPanelLine(width, line, theme)),
    );

    const actions = terminalDetailActionHints(snap.status);
    lines.push(
      terminalPanelBorder(width, actions.left, actions.right, "bottom", theme),
    );
    return lines;
  }

  invalidate(): void {}
}
