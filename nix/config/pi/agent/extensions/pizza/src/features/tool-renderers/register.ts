import { relative, resolve, sep } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatSize,
  getLanguageFromPath,
  highlightCode,
  keyHint,
  SettingsManager,
  type BashToolDetails,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface ToolRendererDependencies {
  createReadDefinition?: typeof createReadToolDefinition;
  createBashDefinition?: typeof createBashToolDefinition;
  createEditDefinition?: typeof createEditToolDefinition;
  createWriteDefinition?: typeof createWriteToolDefinition;
  createSettingsManager?: typeof SettingsManager.create;
  /** Narrow seam for tests; production uses Pi's public keyHint API. */
  keyHint?: typeof keyHint;
}

type Theme = Parameters<NonNullable<ReturnType<typeof createReadToolDefinition>["renderCall"]>>[1];
type Status = "pending" | "success" | "error";
type ToolRenderContext<TState = any, TArgs = any> = {
  args: TArgs;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: TState;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
};

type PizzaRenderState = {
  startedAt?: number;
  endedAt?: number;
};

type RenderModel = {
  status: Status;
  theme: Theme;
  version: string;
  lines: (theme: Theme) => string[];
};

class PizzaDelegatedComponent implements Component {
  constructor(
    private delegate: Component,
    private theme: Theme,
    private status: Status,
  ) {}

  update(delegate: Component, theme: Theme, status: Status): this {
    this.delegate = delegate;
    this.theme = theme;
    this.status = status;
    return this;
  }

  getDelegate(): Component {
    return this.delegate;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const background =
      this.status === "error" ? "toolErrorBg" : this.status === "success" ? "toolSuccessBg" : "toolPendingBg";
    const lines = this.delegate.render(Math.max(1, width - 2));
    return lines.map((line) => this.theme.bg(background, truncateToWidth(` ${line}`, width, "…", true)));
  }

  invalidate(): void {
    this.delegate.invalidate();
  }
}

/** Self-rendered tool shell with width-safe wrapping, padding, backgrounds, and caching. */
export class PizzaToolComponent implements Component {
  private model?: RenderModel;
  private cachedWidth?: number;
  private cachedVersion?: string;
  private cachedLines?: string[];

  update(model: RenderModel): this {
    if (
      this.model?.version !== model.version ||
      this.model.theme !== model.theme ||
      this.model.status !== model.status
    ) {
      this.cachedWidth = undefined;
      this.cachedVersion = undefined;
      this.cachedLines = undefined;
    }
    this.model = model;
    return this;
  }

  render(width: number): string[] {
    if (!this.model || width <= 0) return [];
    if (this.cachedLines && this.cachedWidth === width && this.cachedVersion === this.model.version) {
      return this.cachedLines;
    }

    const { status, theme } = this.model;
    const background = status === "error" ? "toolErrorBg" : status === "success" ? "toolSuccessBg" : "toolPendingBg";
    const innerWidth = Math.max(1, width - 2);
    const source = this.model.lines(theme);
    const wrapped: string[] = [];
    for (const logicalLine of source.length > 0 ? source : [""]) {
      const pieces = wrapTextWithAnsi(logicalLine, innerWidth);
      wrapped.push(...(pieces.length > 0 ? pieces : [""]));
    }
    this.cachedLines = wrapped.map((line) => {
      const padded = truncateToWidth(` ${line}`, width, "…", true);
      return theme.bg(background, padded);
    });
    this.cachedWidth = width;
    this.cachedVersion = this.model.version;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedVersion = undefined;
    this.cachedLines = undefined;
  }
}

function component(
  context: ToolRenderContext<any, any>,
  theme: Theme,
  status: Status,
  version: string,
  lines: (theme: Theme) => string[],
): PizzaToolComponent {
  const value = context.lastComponent instanceof PizzaToolComponent ? context.lastComponent : new PizzaToolComponent();
  return value.update({ status, theme, version, lines });
}

function statusFor(context: ToolRenderContext<any, any>, settled = false): Status {
  if (context.isError) return "error";
  if (!context.executionStarted || !settled || context.isPartial) return "pending";
  return "success";
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Remove terminal control sequences before adding trusted theme styling. */
function sanitizeOutput(text: string): string {
  return Array.from(
    text
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[@-_]?|\r/g, "")
      .replace(/\t/g, "   "),
  )
    .filter((character) => {
      const code = character.codePointAt(0);
      if (code === undefined) return false;
      if (code === 0x0a) return true;
      return code > 0x1f && !(code >= 0x7f && code <= 0x9f) && !(code >= 0xfff9 && code <= 0xfffb);
    })
    .join("");
}

function textOutput(result: { content: Array<{ type: string; text?: string }> }): string {
  return sanitizeOutput(
    result.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n"),
  );
}

function hasImage(result: { content: Array<{ type: string }> }): boolean {
  return result.content.some((part) => part.type === "image");
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function displayPath(path: unknown, cwd: string): string {
  const value = safeString(path);
  if (!value) return "...";
  const absolute = resolve(cwd, value.replace(/^@/, ""));
  const local = relative(cwd, absolute);
  const display = local && local !== ".." && !local.startsWith(`..${sep}`) ? local : absolute;
  return sanitizeOutput(display.split(sep).join("/"));
}

function expansionHint(): string {
  return keyHint("app.tools.expand", "to expand");
}

function titleLine(theme: Theme, name: string, detail: string, status: Status): string {
  const color = status === "pending" ? "warning" : status === "error" ? "error" : "success";
  return theme.fg(color, "● ") + theme.fg("toolTitle", theme.bold(name)) + theme.fg("text", `(${detail})`);
}

function resultLine(theme: Theme, text: string, color: "muted" | "toolOutput" | "error" = "toolOutput"): string {
  return theme.fg("dim", "└─ ") + theme.fg(color, text);
}

function gutterWidth(count: number): number {
  return Math.max(1, String(Math.max(1, count)).length);
}

function numberedBodyLines(theme: Theme, text: string, color: "toolOutput" | "error" = "toolOutput"): string[] {
  if (!text) return [theme.fg("dim", "  · │ (no output)")];
  const lines = text.split("\n");
  const width = gutterWidth(lines.length);
  return lines.map(
    (line, index) =>
      theme.fg("dim", `${String(index + 1).padStart(width)} │ `) + theme.fg(color, line),
  );
}

function outputBodyLines(theme: Theme, text: string, color: "toolOutput" | "error" = "toolOutput"): string[] {
  if (!text) return [theme.fg("dim", "  > │ (no output)")];
  return text.split("\n").map((line) => theme.fg("dim", "  > │ ") + theme.fg(color, line));
}

const COLLAPSED_DIFF_LINES = 12;
const COLLAPSED_PREVIEW_LINES = 10;

function previewBodyLines(
  theme: Theme,
  text: string,
  color: "toolOutput" | "error" = "toolOutput",
): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  const shown = lines.slice(0, COLLAPSED_PREVIEW_LINES);
  const rendered = shown.map((line) => theme.fg("dim", "  > │ ") + theme.fg(color, line));
  if (lines.length > shown.length)
    rendered.push(theme.fg("muted", `    └─ ${lines.length - shown.length} more lines`));
  return rendered;
}

function readSnippet(text: string): { text: string; hasMore: boolean } {
  if (!text) return { text: "", hasMore: false };
  const lines = text
    .split("\n")
    .filter((line) => !/^\[Showing lines .* Use offset=\d+ to continue\.\]$/.test(line));
  const shown = lines.slice(0, COLLAPSED_PREVIEW_LINES);
  return {
    text: shown.join("\n"),
    hasMore: lines.length > shown.length,
  };
}

function diffBodyLines(
  theme: Theme,
  lines: string[],
  expanded: boolean,
  renderExpansionHint = expansionHint,
): string[] {
  const shown = expanded ? lines : lines.slice(0, COLLAPSED_DIFF_LINES);
  let oldLine: number | undefined;
  let newLine: number | undefined;
  const rendered = shown.map((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return theme.fg("toolDiffContext", `    │ ${line}`);
    }
    const added = line.startsWith("+") && !line.startsWith("+++");
    const removed = line.startsWith("-") && !line.startsWith("---");
    const marker = added ? "+" : removed ? "-" : " ";
    const number = added ? newLine : removed ? oldLine : newLine;
    const color = added ? "toolDiffAdded" : removed ? "toolDiffRemoved" : "toolDiffContext";
    if (added && newLine !== undefined) newLine++;
    else if (removed && oldLine !== undefined) oldLine++;
    else if (!added && !removed) {
      if (oldLine !== undefined) oldLine++;
      if (newLine !== undefined) newLine++;
    }
    const label = number === undefined ? "   " : String(number).padStart(3);
    return theme.fg("dim", `${label} ${marker}│ `) + theme.fg(color, line);
  });
  if (!expanded && lines.length > shown.length) {
    rendered.push(
      theme.fg("muted", `      └─ ${lines.length - shown.length} more diff lines · ${renderExpansionHint()}`),
    );
  }
  return rendered;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function loadToolSettings(
  ctx: ExtensionContext,
  createSettingsManager: typeof SettingsManager.create,
): { shellPath?: string; shellCommandPrefix?: string; imageAutoResize: boolean } {
  const settings = createSettingsManager(ctx.cwd, undefined, {
    projectTrusted: ctx.isProjectTrusted(),
  });
  return {
    shellPath: settings.getShellPath(),
    shellCommandPrefix: settings.getShellCommandPrefix(),
    imageAutoResize: settings.getImageAutoResize(),
  };
}

function sameNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Register compact renderers only over currently built-in tools. Execution remains SDK-owned. */
export function registerClaudeStyleToolRenderers(pi: ExtensionAPI, dependencies: ToolRendererDependencies = {}): void {
  const createRead = dependencies.createReadDefinition ?? createReadToolDefinition;
  const createBash = dependencies.createBashDefinition ?? createBashToolDefinition;
  const createEdit = dependencies.createEditDefinition ?? createEditToolDefinition;
  const createWrite = dependencies.createWriteDefinition ?? createWriteToolDefinition;
  const createSettingsManager = dependencies.createSettingsManager ?? SettingsManager.create;
  const renderExpansionHint = () =>
    (dependencies.keyHint ?? keyHint)("app.tools.expand", "to expand");
  let registered = false;
  pi.on("session_start", () => {
    if (registered) return;
    registered = true;

    const activeBefore = [...pi.getActiveTools()];
    const eligible = new Set(
      pi
        .getAllTools()
        .filter((tool) => tool.sourceInfo.source === "builtin")
        .map((tool) => tool.name),
    );

    if (eligible.has("read")) {
      const template = createRead(process.cwd());
      pi.registerTool({
        ...template,
        renderShell: "self",
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const settings = loadToolSettings(ctx, createSettingsManager);
          const delegate = createRead(ctx.cwd, { autoResizeImages: settings.imageAutoResize });
          return delegate.execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
          const detail = [displayPath(args.path, context.cwd)];
          const offset = finiteNumber(args.offset);
          const limit = finiteNumber(args.limit);
          if (offset !== undefined) detail.push(`offset ${offset}`);
          if (limit !== undefined) detail.push(`limit ${limit}`);
          const value = detail.join(" · ");
          return component(
            context,
            theme,
            statusFor(context, !context.isPartial),
            `read-call:${value}:${context.isError}`,
            (current) => [titleLine(current, "Read", value, statusFor(context, !context.isPartial))],
          );
        },
        renderResult(result, options, theme, context) {
          if (hasImage(result) && template.renderResult) {
            const previous =
              context.lastComponent instanceof PizzaDelegatedComponent
                ? context.lastComponent.getDelegate()
                : undefined;
            const delegate = (template.renderResult as NonNullable<typeof template.renderResult>)(
              result as Parameters<NonNullable<typeof template.renderResult>>[0],
              options,
              theme,
              { ...context, lastComponent: previous },
            );
            return context.lastComponent instanceof PizzaDelegatedComponent
              ? context.lastComponent.update(delegate, theme, statusFor(context, !options.isPartial))
              : new PizzaDelegatedComponent(delegate, theme, statusFor(context, !options.isPartial));
          }
          const output = textOutput(result);
          const truncation = (result.details as ReadToolDetails | undefined)?.truncation;
          const version = `read-result:${options.isPartial}:${options.expanded}:${context.isError}:${output}:${JSON.stringify(truncation)}`;
          return component(context, theme, statusFor(context, !options.isPartial), version, (current) => {
            if (options.isPartial) return [resultLine(current, "Reading…", "muted")];
            if (context.isError) return [resultLine(current, output || "Read failed", "error")];
            if (!options.expanded) {
              const parts = [`Read ${lineCount(output)} lines`];
              if (truncation?.truncated) parts.push("truncated");
              if (/Use offset=\d+ to continue/.test(output)) parts.push("more available");
              parts.push(renderExpansionHint());
              const lines = [resultLine(current, parts.join(" · "))];
              const snippet = readSnippet(output);
              if (snippet.text) lines.push(...numberedBodyLines(current, snippet.text));
              if (snippet.hasMore) lines.push(current.fg("muted", "   …"));
              return lines;
            }
            const language = getLanguageFromPath(safeString(context.args.path));
            const highlighted = language
              ? highlightCode(output, language)
              : output.split("\n").map((line) => current.fg("toolOutput", line));
            const lines = [resultLine(current, `Read ${lineCount(output)} lines`)];
            const width = gutterWidth(highlighted.length);
            lines.push(
              ...highlighted.map(
                (line, index) => current.fg("dim", `${String(index + 1).padStart(width)} │ `) + line,
              ),
            );
            if (truncation?.truncated)
              lines.push(current.fg("warning", "   [Result truncated; use the continuation instruction above.]"));
            return lines;
          });
        },
      });
    }

    if (eligible.has("bash")) {
      const template = createBash(process.cwd());
      pi.registerTool({
        ...template,
        renderShell: "self",
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const settings = loadToolSettings(ctx, createSettingsManager);
          const delegate = createBash(ctx.cwd, {
            shellPath: settings.shellPath,
            commandPrefix: settings.shellCommandPrefix,
          });
          return delegate.execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
          const state = context.state as PizzaRenderState;
          if (context.executionStarted && state.startedAt === undefined) state.startedAt = Date.now();
          // Always show the complete command, even while collapsed, so hidden lines
          // cannot obscure unsafe shell operations.
          const command = sanitizeOutput(safeString(args.command));
          const timeout = finiteNumber(args.timeout);
          const detail = timeout === undefined ? command : `${command} · timeout ${timeout}s`;
          return component(
            context,
            theme,
            statusFor(context, !context.isPartial),
            `bash-call:${detail}:${context.isError}`,
            (current) => [titleLine(current, "Bash", detail || "…", statusFor(context, !context.isPartial))],
          );
        },
        renderResult(result, options, theme, context) {
          const output = textOutput(result);
          const details = result.details as BashToolDetails | undefined;
          const state = context.state as PizzaRenderState;
          if (!options.isPartial) state.endedAt ??= Date.now();
          const duration =
            state.startedAt === undefined ? undefined : formatDuration((state.endedAt ?? Date.now()) - state.startedAt);
          const version = `bash-result:${options.isPartial}:${options.expanded}:${context.isError}:${duration}:${output}:${JSON.stringify(details)}`;
          return component(context, theme, statusFor(context, !options.isPartial), version, (current) => {
            if (options.isPartial) {
              const tail = output ? output.split("\n").slice(-COLLAPSED_PREVIEW_LINES) : [];
              return [
                resultLine(current, "Running…", "muted"),
                ...tail.map((line) => current.fg("dim", "  > │ ") + current.fg("toolOutput", line)),
              ];
            }
            if (options.expanded) {
              const lines = [
                resultLine(current, context.isError ? "Failed" : "Completed", context.isError ? "error" : "toolOutput"),
              ];
              lines.push(...outputBodyLines(current, output, context.isError ? "error" : "toolOutput"));
              if (details?.fullOutputPath && !output.includes(details.fullOutputPath)) {
                lines.push(current.fg("warning", `   Full output: ${sanitizeOutput(details.fullOutputPath)}`));
              }
              return lines;
            }
            const parts = [context.isError ? "Failed" : "Completed", `${lineCount(output)} lines`];
            if (details?.truncation?.truncated) parts.push("truncated");
            if (duration) parts.push(duration);
            if (output || details?.fullOutputPath) parts.push(renderExpansionHint());
            const lines = [resultLine(current, parts.join(" · "), context.isError ? "error" : "toolOutput")];
            lines.push(...previewBodyLines(current, output, context.isError ? "error" : "toolOutput"));
            return lines;
          });
        },
      });
    }

    if (eligible.has("edit")) {
      const template = createEdit(process.cwd());
      pi.registerTool({
        ...template,
        renderShell: "self",
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return createEdit(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
          const count = Array.isArray(args.edits) ? args.edits.length : 0;
          const detail = `${displayPath(args.path, context.cwd)} · ${count} replacement${count === 1 ? "" : "s"}`;
          return component(
            context,
            theme,
            statusFor(context, !context.isPartial),
            `edit-call:${detail}:${context.isError}`,
            (current) => [titleLine(current, "Edit", detail, statusFor(context, !context.isPartial))],
          );
        },
        renderResult(result, options, theme, context) {
          const output = textOutput(result);
          const diff = sanitizeOutput((result.details as EditToolDetails | undefined)?.diff ?? "");
          const diffLines = diff.split("\n");
          const additions = diffLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
          const removals = diffLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
          const version = `edit-result:${options.isPartial}:${options.expanded}:${context.isError}:${output}:${diff}`;
          return component(context, theme, statusFor(context, !options.isPartial), version, (current) => {
            if (options.isPartial) return [resultLine(current, "Editing…", "muted")];
            if (context.isError) return [resultLine(current, output || "Edit failed", "error")];
            const summary = `Applied · +${additions} -${removals}`;
            if (!diff) return [resultLine(current, summary)];
            return [
              resultLine(current, summary),
              ...diffBodyLines(current, diffLines, options.expanded, renderExpansionHint),
            ];
          });
        },
      });
    }

    if (eligible.has("write")) {
      const template = createWrite(process.cwd());
      pi.registerTool({
        ...template,
        renderShell: "self",
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return createWrite(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
          const content = safeString(args.content);
          const lines = lineCount(content);
          const detail = `${displayPath(args.path, context.cwd)} · ${lines} lines · ${formatSize(Buffer.byteLength(content, "utf8"))}`;
          return component(
            context,
            theme,
            statusFor(context, !context.isPartial),
            `write-call:${detail}:${context.isError}`,
            (current) => [titleLine(current, "Write", detail, statusFor(context, !context.isPartial))],
          );
        },
        renderResult(result, options, theme, context) {
          const output = textOutput(result);
          const written = sanitizeOutput(safeString(context.args.content));
          const additions = written ? written.split("\n").map((line) => `+${line}`) : [];
          const version = `write-result:${options.isPartial}:${options.expanded}:${context.isError}:${output}:${written}`;
          return component(context, theme, statusFor(context, !options.isPartial), version, (current) => {
            if (options.isPartial) return [resultLine(current, "Writing…", "muted")];
            if (context.isError) return [resultLine(current, output || "Write failed", "error")];
            const lines = [resultLine(current, `Written · +${additions.length} -0`)];
            lines.push(
              ...diffBodyLines(current, additions, options.expanded, renderExpansionHint),
            );
            return lines;
          });
        },
      });
    }

    const activeAfter = pi.getActiveTools();
    if (!sameNames(activeBefore, activeAfter)) pi.setActiveTools(activeBefore);
  });
}
