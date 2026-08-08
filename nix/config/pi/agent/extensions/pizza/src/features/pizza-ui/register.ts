import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  CODEX_USAGE_STATUS_KEY,
  getLatestCodexUsage,
} from "../codex-usage/register.js";
import { ModalEditor } from "./modal-editor.js";
import { workingPhrases } from "./working-phrases.js";

function isEditorBorder(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  return plain.includes("─") && /^[─ ↑↓0-9more]+$/.test(plain);
}

function borderLine(
  width: number,
  left: string,
  right: string,
  labelLeft = "",
  labelRight = "",
  colorRule: (text: string) => string = (text) => text,
): string {
  if (width <= 0) return "";
  if (width === 1) return left;
  const available = width - visibleWidth(left) - visibleWidth(right);
  const leftLabel = labelLeft ? ` ${labelLeft} ` : "";
  const rightLabel = labelRight ? ` ${labelRight} ` : "";
  const labels = truncateToWidth(leftLabel + rightLabel, Math.max(0, available), "");
  const gap = Math.max(0, available - visibleWidth(labels));
  return truncateToWidth(
    colorRule(left) + leftLabel + colorRule("━".repeat(gap)) + rightLabel + colorRule(right),
    width,
    "",
  );
}

class FramedEditor extends ModalEditor {
  constructor(
    tui: ConstructorParameters<typeof ModalEditor>[0],
    theme: ConstructorParameters<typeof ModalEditor>[1],
    keybindings: ConstructorParameters<typeof ModalEditor>[2],
    private readonly getTopLabel: () => string,
    private readonly getBottomLabels: () => { left: string; right: string },
    private readonly colorRule: (text: string) => string,
    private readonly colorMode: (mode: "NORMAL" | "INSERT") => string,
  ) {
    super(tui, theme, keybindings);
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const rendered = super.render(Math.max(1, width - 4));
    let bottomBorder = -1;
    for (let i = rendered.length - 1; i > 0; i--) {
      if (isEditorBorder(rendered[i])) {
        bottomBorder = i;
        break;
      }
    }
    const content = rendered.filter((_, i) => i !== 0 && i !== bottomBorder);
    const innerWidth = Math.max(0, width - 4);
    const fit = (line: string) => truncateToWidth(line, width, "");
    const emptyLine = fit(
      this.colorRule("┃") + " ".repeat(Math.max(0, width - 2)) + this.colorRule("┃"),
    );
    const framed = content.map((line) => {
      const text = truncateToWidth(line, innerWidth, "");
      return fit(
        this.colorRule("┃") +
          " " +
          text +
          " ".repeat(Math.max(0, innerWidth - visibleWidth(text))) +
          " " +
          this.colorRule("┃"),
      );
    });
    const bottom = this.getBottomLabels();
    const mode = this.getMode() === "normal" ? "NORMAL" : "INSERT";
    const bottomLeft = [this.colorMode(mode), bottom.left].filter(Boolean).join(" · ");
    return [
      borderLine(width, "┏", "┓", "", this.getTopLabel(), this.colorRule),
      ...(framed.length ? framed : [emptyLine]),
      emptyLine,
      borderLine(width, "┗", "┛", bottomLeft, bottom.right, this.colorRule),
    ];
  }
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function sanitizeStatus(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

const LONG_PATH_THRESHOLD = 40;

function compactPath(path: string): string {
  const home = process.env.HOME;
  const homeRelative = home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  if (visibleWidth(homeRelative) <= LONG_PATH_THRESHOLD) return homeRelative;

  const parts = homeRelative.split("/");
  return parts
    .map((part, index) => {
      const isDirectory = index < parts.length - 1;
      if (!isDirectory || part === "" || part === "~") return part;
      return Array.from(part)[0] ?? part;
    })
    .join("/");
}

function parseGitIndicators(status: string): string {
  const aheadBehind = status.match(/^# branch\.ab \+(\d+) -(\d+)$/m);
  const indicators = [];
  if (status.split("\n").some((line) => line && !line.startsWith("#"))) indicators.push("*");
  if (aheadBehind && Number(aheadBehind[1])) indicators.push(`↑${aheadBehind[1]}`);
  if (aheadBehind && Number(aheadBehind[2])) indicators.push(`↓${aheadBehind[2]}`);
  return indicators.join(" ");
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const thinkingColor = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
} as const;

const pizzaLogo = [
  "11110  22  33333 55555  04440",
  "11 11  22     33    55  44 44",
  "11110  22    33    55   44444",
  "11     22   33    55    44 44",
  "11     22  33333 55555  44 44",
];
const pizzaTagline = "A coding harness built on PI by Michael";

function renderPizzaLogo(theme: Theme, width: number, height?: number): string[] {
  if (width <= 0) return [];
  const colors = ["dim", "accent", "borderAccent", "toolTitle", "warning", "toolTitle"] as const;
  const logoWidth = pizzaLogo[0]?.length ?? 0;
  const center = (text: string) =>
    " ".repeat(Math.max(0, Math.floor((width - visibleWidth(text)) / 2))) + text;
  const taglineText = truncateToWidth(pizzaTagline, width, "");
  const tagline = center(
    `\x1b[32m${taglineText.replace("PI", "\x1b[1;37mPI\x1b[22;32m")}\x1b[39m`,
  );
  if (width < logoWidth)
    return [
      center(truncateToWidth(theme.fg("accent", theme.bold("PIZZA")), width, "")),
      "",
      tagline,
    ];

  const padding = " ".repeat(Math.floor((width - logoWidth) / 2));
  const logo = [
    "",
    ...pizzaLogo.map(
      (row) =>
        padding +
        Array.from(row, (pixel) => {
          if (pixel === " ") return " ";
          if (pixel === "3") return "\x1b[38;2;80;140;255m█\x1b[39m";
          return theme.fg(colors[Number(pixel)] ?? "accent", "█");
        }).join(""),
    ),
    "",
    tagline,
    "",
  ];
  const topPadding = height == null ? 0 : Math.max(0, Math.floor((height - logo.length) / 2) - 2);
  return [...Array(topPadding).fill(""), ...logo];
}

export function registerPizzaUiExtension(pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let totalCost = 0;
  let codexUsageLabel = "";
  let lastWorkingPhrase = "";
  let gitIndicators = "";
  let gitRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let gitRefreshInFlight = false;

  const refresh = () => requestRender?.();
  const refreshGitIndicators = (cwd: string) => {
    if (gitRefreshInFlight) return;
    gitRefreshInFlight = true;
    execFile(
      "git",
      ["status", "--porcelain=v2", "--branch"],
      { cwd, encoding: "utf8", timeout: 1_000 },
      (error, stdout) => {
        gitRefreshInFlight = false;
        const next = error ? "" : parseGitIndicators(stdout);
        if (next === gitIndicators) return;
        gitIndicators = next;
        refresh();
      },
    );
  };

  const updateWorkingPhrase = (ctx: ExtensionContext, configureSpinner = false) => {
    if (ctx.mode !== "tui") return;
    const choices = workingPhrases.filter((phrase) => phrase !== lastWorkingPhrase);
    lastWorkingPhrase = choices[Math.floor(Math.random() * choices.length)] ?? "working…";
    ctx.ui.setWorkingMessage(ctx.ui.theme.fg("warning", `${lastWorkingPhrase}...`));
    if (configureSpinner) {
      ctx.ui.setWorkingIndicator({
        frames: spinnerFrames.map((frame) => ctx.ui.theme.fg("warning", frame)),
        intervalMs: 100,
      });
    }
  };

  pi.on("agent_start", (_event, ctx) => {
    updateWorkingPhrase(ctx, true);
    refresh();
  });

  pi.on("tool_execution_end", (_event, ctx) => updateWorkingPhrase(ctx));
  pi.on("agent_end", refresh);
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode === "tui" && event.message.role === "assistant") {
      totalCost += event.message.usage.cost.total;
      updateWorkingPhrase(ctx);
    }
    refresh();
  });

  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("session_shutdown", () => {
    if (gitRefreshTimer) clearInterval(gitRefreshTimer);
    gitRefreshTimer = undefined;
    gitRefreshInFlight = false;
    gitIndicators = "";
    requestRender = undefined;
    totalCost = 0;
    codexUsageLabel = "";
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    totalCost = 0;
    gitIndicators = "";
    refreshGitIndicators(ctx.cwd);
    if (gitRefreshTimer) clearInterval(gitRefreshTimer);
    gitRefreshTimer = setInterval(() => refreshGitIndicators(ctx.cwd), 5_000);
    gitRefreshTimer.unref?.();
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "message" && entry.message.role === "assistant")
        totalCost += entry.message.usage.cost.total;
    }

    const getTopLabel = () => {
      const subscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
      const cost = `$${totalCost.toFixed(3)}${subscription ? " sub" : ""}`;
      const usage = ctx.getContextUsage();
      const limit = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      const context =
        usage?.tokens == null
          ? `?/${formatTokens(limit)}`
          : `${formatTokens(usage.tokens)}/${formatTokens(limit)}`;
      const thinking = ctx.model?.reasoning ? pi.getThinkingLevel() : "";
      const separator = ctx.ui.theme.fg("dim", " · ");
      return [
        ctx.ui.theme.fg("dim", ctx.ui.theme.bold(cost)),
        ctx.ui.theme.bold(ctx.model?.id ?? "no model"),
        thinking && ctx.ui.theme.fg(thinkingColor[thinking], thinking),
        ctx.ui.theme.fg("warning", context),
      ]
        .filter(Boolean)
        .join(separator);
    };

    let bottomLeft = "";
    let bottomRight = "";

    ctx.ui.setTitle("Pizza");
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setHeader((tui, theme) => ({
      render: (width: number) => renderPizzaLogo(theme, width, tui.terminal.rows),
      invalidate() {},
    }));
    ctx.ui.setWidget("pizza-codex-usage", (_tui, theme) => ({
      render(width: number): string[] {
        const codexUsage = getLatestCodexUsage() || codexUsageLabel;
        if (!codexUsage) return [];
        const parts: string[] = [];
        parts.push(theme.fg("text", `codex ${codexUsage}`));
        const label = "  " + parts.join(theme.fg("dim", " · "));
        return [truncateToWidth(label, width, "")];
      },
      invalidate() {},
    }));
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new FramedEditor(
          tui,
          theme,
          keybindings,
          getTopLabel,
          () => ({ left: bottomLeft, right: bottomRight }),
          (text) => `\x1b[2m${ctx.ui.theme.fg(thinkingColor[pi.getThinkingLevel()], text)}\x1b[22m`,
          (mode) => ctx.ui.theme.fg(mode === "NORMAL" ? "accent" : "warning", mode),
        ),
    );

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(() => {
        refreshGitIndicators(ctx.cwd);
        tui.requestRender();
      });

      return {
        dispose: unsubscribe,
        render(width: number): string[] {
          const statuses = footerData.getExtensionStatuses();
          const codexStatus = statuses.get(CODEX_USAGE_STATUS_KEY);
          const nextCodexUsageLabel = codexStatus ? sanitizeStatus(codexStatus) : "";
          if (nextCodexUsageLabel !== codexUsageLabel) {
            codexUsageLabel = nextCodexUsageLabel;
            queueMicrotask(() => tui.requestRender());
          }
          const otherStatuses = Array.from(statuses.entries())
            .filter(([key]) => key !== CODEX_USAGE_STATUS_KEY)
            .map(([, status]) => sanitizeStatus(status))
            .filter(Boolean);
          const coloredIndicators = gitIndicators
            ? theme.fg("warning", gitIndicators)
            : "";
          const left = [coloredIndicators, ...otherStatuses].filter(Boolean).join(" · ");
          const cwd = theme.fg("dim", theme.bold(compactPath(ctx.cwd)));
          if (left !== bottomLeft || cwd !== bottomRight) {
            bottomLeft = left;
            bottomRight = cwd;
            queueMicrotask(() => tui.requestRender());
          }
          return [];
        },
        invalidate() {},
      };
    });
  });
}
