import {
  CustomEditor,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type AutocompleteProvider,
  type EditorComponent,
  type EditorTheme,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import type { SubagentSnapshot } from "../state.js";
import type { SubagentReadModel } from "../manager.js";
import { formatElapsedTime, formatTokenStatus } from "./agent-status.js";

const DEFAULT_WIDGET_KEY = "subagent-editor-list";
const TERMINAL_CHROME_ROWS = 4;

type EditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

export interface SubagentEditorNavigationOptions {
  /** Called when Enter is pressed on a selected child. */
  readonly onOpen: (snapshot: SubagentSnapshot) => void | Promise<void>;
  readonly widgetKey?: string;
  /** Useful for constrained layouts and deterministic tests. */
  readonly maxVisibleRows?: number;
}

interface NavigableEditor extends EditorComponent, Partial<Focusable> {
  wantsKeyRelease?: boolean;
  dispose?: () => void;
  actionHandlers?: Map<unknown, () => void>;
  onEscape?: () => void;
  onCtrlD?: () => void;
  onPasteImage?: () => void;
  onExtensionShortcut?: (data: string) => boolean;
}

function orderedSnapshots(view: SubagentReadModel): SubagentSnapshot[] {
  return view
    .list()
    .filter(
      (snapshot) =>
        snapshot.origin === "model" &&
        snapshot.status === "running" &&
        Boolean(snapshot.meta.sessionFilePath),
    )
    .map((snapshot, insertionIndex) => ({ snapshot, insertionIndex }))
    .sort(
      (a, b) =>
        a.snapshot.launchOrder - b.snapshot.launchOrder ||
        a.snapshot.createdAt - b.snapshot.createdAt ||
        a.insertionIndex - b.insertionIndex,
    )
    .map(({ snapshot }) => snapshot);
}

class NavigationState {
  active = false;
  selectedId: string | undefined;
  editorHeight = 1;
  readonly view: SubagentReadModel;
  readonly options: SubagentEditorNavigationOptions;

  constructor(
    view: SubagentReadModel,
    options: SubagentEditorNavigationOptions,
  ) {
    this.view = view;
    this.options = options;
  }

  rows(): SubagentSnapshot[] {
    return orderedSnapshots(this.view);
  }

  reconcile(rows = this.rows()): SubagentSnapshot[] {
    if (rows.length === 0) {
      this.restoreEditor();
      return rows;
    }
    if (!rows.some((row) => row.id === this.selectedId)) {
      this.selectedId = rows[0]?.id;
    }
    return rows;
  }

  enter(): boolean {
    const rows = this.reconcile();
    if (rows.length === 0) return false;
    this.active = true;
    return true;
  }

  restoreEditor(): void {
    this.active = false;
    this.selectedId = undefined;
  }

  move(delta: -1 | 1): void {
    const rows = this.reconcile();
    if (rows.length === 0) return;
    const index = Math.max(
      0,
      rows.findIndex((row) => row.id === this.selectedId),
    );
    const next = index + delta;
    if (next < 0) {
      this.restoreEditor();
      return;
    }
    this.selectedId = rows[Math.min(next, rows.length - 1)]?.id;
  }

  selected(): SubagentSnapshot | undefined {
    return this.reconcile().find((row) => row.id === this.selectedId);
  }
}

export class SubagentNavigationEditor implements EditorComponent, Focusable {
  private _focused = false;
  private readonly tui: TUI;
  private readonly keybindings: KeybindingsManager;
  private readonly base: NavigableEditor;
  private readonly navigation: NavigationState;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    base: NavigableEditor,
    navigation: NavigationState,
  ) {
    this.tui = tui;
    this.keybindings = keybindings;
    this.base = base;
    this.navigation = navigation;
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if ("focused" in this.base) this.base.focused = value;
  }

  get wantsKeyRelease(): boolean | undefined {
    return this.base.wantsKeyRelease;
  }

  get actionHandlers(): Map<unknown, () => void> | undefined {
    return this.base.actionHandlers;
  }

  get onEscape(): (() => void) | undefined {
    return this.base.onEscape;
  }
  set onEscape(value: (() => void) | undefined) {
    this.base.onEscape = value;
  }

  get onCtrlD(): (() => void) | undefined {
    return this.base.onCtrlD;
  }
  set onCtrlD(value: (() => void) | undefined) {
    this.base.onCtrlD = value;
  }

  get onPasteImage(): (() => void) | undefined {
    return this.base.onPasteImage;
  }
  set onPasteImage(value: (() => void) | undefined) {
    this.base.onPasteImage = value;
  }

  get onExtensionShortcut(): ((data: string) => boolean) | undefined {
    return this.base.onExtensionShortcut;
  }
  set onExtensionShortcut(value: ((data: string) => boolean) | undefined) {
    this.base.onExtensionShortcut = value;
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this.base.onSubmit;
  }
  set onSubmit(value: ((text: string) => void) | undefined) {
    this.base.onSubmit = value;
  }

  get onChange(): ((text: string) => void) | undefined {
    return this.base.onChange;
  }
  set onChange(value: ((text: string) => void) | undefined) {
    this.base.onChange = value;
  }

  get borderColor(): ((text: string) => string) | undefined {
    return this.base.borderColor;
  }
  set borderColor(value: ((text: string) => string) | undefined) {
    this.base.borderColor = value;
  }

  handleInput(data: string): void {
    if (this.navigation.active) {
      if (
        matchesKey(data, Key.escape) ||
        this.keybindings.matches(data, "tui.select.cancel")
      ) {
        this.navigation.restoreEditor();
      } else if (
        matchesKey(data, Key.up) ||
        this.keybindings.matches(data, "tui.select.up")
      ) {
        this.navigation.move(-1);
      } else if (
        matchesKey(data, Key.down) ||
        this.keybindings.matches(data, "tui.select.down")
      ) {
        this.navigation.move(1);
      } else if (
        matchesKey(data, Key.enter) ||
        this.keybindings.matches(data, "tui.select.confirm")
      ) {
        const selected = this.navigation.selected();
        if (selected) {
          this.navigation.restoreEditor();
          void Promise.resolve(this.navigation.options.onOpen(selected)).catch(
            () => {},
          );
        }
      } else {
        return;
      }
      this.tui.requestRender();
      return;
    }

    const entersRows =
      this.base.getText() === "" &&
      (matchesKey(data, Key.down) || matchesKey(data, Key.left));
    if (entersRows && this.navigation.enter()) {
      this.tui.requestRender();
      return;
    }
    this.base.handleInput(data);
  }

  render(width: number): string[] {
    const lines = this.base.render(width);
    this.navigation.editorHeight = Math.max(1, lines.length);
    return lines;
  }

  invalidate(): void {
    this.base.invalidate();
  }

  dispose(): void {
    this.base.dispose?.();
  }

  getText(): string {
    return this.base.getText();
  }
  getExpandedText(): string {
    return this.base.getExpandedText?.() ?? this.base.getText();
  }
  setText(text: string): void {
    this.base.setText(text);
  }
  addToHistory(text: string): void {
    this.base.addToHistory?.(text);
  }
  insertTextAtCursor(text: string): void {
    this.base.insertTextAtCursor?.(text);
  }
  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.base.setAutocompleteProvider?.(provider);
  }
  setPaddingX(padding: number): void {
    this.base.setPaddingX?.(padding);
  }
  setAutocompleteMaxVisible(maxVisible: number): void {
    this.base.setAutocompleteMaxVisible?.(maxVisible);
  }
}

class SubagentRowsWidget {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly navigation: NavigationState;
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(tui: TUI, theme: Theme, navigation: NavigationState) {
    this.tui = tui;
    this.theme = theme;
    this.navigation = navigation;
    this.ticker = setInterval(() => this.tui.requestRender(), 1_000);
    this.ticker.unref?.();
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const rows = this.navigation.reconcile();
    if (rows.length === 0) return [];

    const terminalLimit = Math.max(
      1,
      (this.tui.terminal.rows || 24) -
        this.navigation.editorHeight -
        TERMINAL_CHROME_ROWS -
        4,
    );
    const lineLimit = Math.max(
      1,
      Math.min(
        this.navigation.options.maxVisibleRows ?? Infinity,
        terminalLimit,
      ),
    );
    const isTruncated = rows.length > lineLimit;
    const itemLimit = isTruncated && lineLimit > 1 ? lineLimit - 1 : lineLimit;
    const selectedIndex = this.navigation.active
      ? Math.max(
          0,
          rows.findIndex((row) => row.id === this.navigation.selectedId),
        )
      : 0;
    const start = isTruncated
      ? Math.min(
          Math.max(0, selectedIndex - itemLimit + 1),
          Math.max(0, rows.length - itemLimit),
        )
      : 0;
    const shown = rows.slice(start, start + itemLimit);
    const help = truncateToWidth(
      this.theme.fg(
        "dim",
        "  empty prompt: ↓/← agents · ↑/↓ select · enter open · esc back",
      ),
      width,
      "",
    );
    const mainMarker = this.theme.fg(
      this.navigation.active ? "dim" : "accent",
      this.navigation.active ? "◯" : "⏺",
    );
    const main = truncateToWidth(
      `  ${mainMarker} ${this.theme.fg(this.navigation.active ? "text" : "accent", "main")}`,
      width,
      "",
    );
    const lines = shown.map((snapshot) => {
      const selected =
        this.navigation.active && snapshot.id === this.navigation.selectedId;
      const marker = this.theme.fg(
        selected ? "accent" : "dim",
        selected ? "⏺" : "◯",
      );
      const identity = [snapshot.meta?.modelLabel, snapshot.meta?.reasoningEffort]
        .filter(Boolean)
        .join(` ${this.theme.fg("dim", "·")} `);
      const left = [
        `  ${marker} ${this.theme.fg(selected ? "accent" : "text", snapshot.title)}`,
        identity ? this.theme.fg("muted", identity) : "",
      ]
        .filter(Boolean)
        .join(` ${this.theme.fg("dim", "·")} `);
      const stats = [
        formatElapsedTime(
          Math.max(0, (snapshot.settledAt ?? Date.now()) - snapshot.createdAt),
        ),
        formatTokenStatus(
          {
            tokens: snapshot.usage?.tokens,
            contextWindow:
              snapshot.usage?.contextWindow ?? snapshot.meta?.contextWindow,
          },
          this.theme,
        ),
      ]
        .filter(Boolean)
        .join(` ${this.theme.fg("dim", "·")} `);
      if (stats && visibleWidth(left) + visibleWidth(stats) + 2 <= width) {
        return `${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(stats))}${stats}`;
      }
      return truncateToWidth(left, width, "");
    });
    const hiddenBelow = rows.length - start - shown.length;
    if (hiddenBelow > 0 && lines.length < lineLimit) {
      lines.push(
        truncateToWidth(
          this.theme.fg("dim", `  ↓ ${hiddenBelow} more`),
          width,
          "",
        ),
      );
    }
    return ["", help, main, ...lines, ""];
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.ticker);
  }
}

/** Compose navigation around any existing editor factory (including Pizza). */
export function createSubagentNavigationEditorFactory(
  baseFactory: EditorFactory | undefined,
  view: SubagentReadModel,
  options: SubagentEditorNavigationOptions,
): EditorFactory {
  const navigation = new NavigationState(view, options);
  return (tui, theme, keybindings) => {
    const base = (baseFactory?.(tui, theme, keybindings) ??
      new CustomEditor(tui, theme, keybindings)) as NavigableEditor;
    return new SubagentNavigationEditor(tui, keybindings, base, navigation);
  };
}

export interface InstalledSubagentEditorNavigation {
  readonly editorFactory: EditorFactory;
  dispose(): void;
}

/**
 * Install the below-editor rows by wrapping, rather than replacing, the current
 * editor. The same base editor instance keeps prompt state, history and IME
 * focus while row navigation is active.
 */
export function installSubagentEditorNavigation(
  ctx: ExtensionContext,
  view: SubagentReadModel,
  options: SubagentEditorNavigationOptions,
): InstalledSubagentEditorNavigation {
  const previousFactory = ctx.ui.getEditorComponent();
  const navigation = new NavigationState(view, options);
  const editorFactory: EditorFactory = (tui, theme, keybindings) => {
    const base = (previousFactory?.(tui, theme, keybindings) ??
      new CustomEditor(tui, theme, keybindings)) as NavigableEditor;
    return new SubagentNavigationEditor(tui, keybindings, base, navigation);
  };
  const widgetKey = options.widgetKey ?? DEFAULT_WIDGET_KEY;
  let requestRender: (() => void) | undefined;

  ctx.ui.setWidget(
    widgetKey,
    (tui, theme) => {
      requestRender = () => tui.requestRender();
      return new SubagentRowsWidget(tui, theme, navigation);
    },
    { placement: "belowEditor" },
  );
  ctx.ui.setEditorComponent(editorFactory);
  const unsubscribe = view.subscribe(() => requestRender?.());
  let disposed = false;

  return {
    editorFactory,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      ctx.ui.setWidget(widgetKey, undefined);
      if (ctx.ui.getEditorComponent() === editorFactory) {
        ctx.ui.setEditorComponent(previousFactory);
      }
    },
  };
}
