import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatCompactTokens } from "../format.ts";

/** The small, immutable surface required by the status formatters. */
export type StatusTheme = Pick<Theme, "fg">;

export type AgentStatusState =
  "queued" | "running" | "done" | "error" | "cancelled";

export interface TokenStatus {
  tokens?: number | null;
  contextWindow?: number | null;
  /** Set to false when the renderer has a separate context meter. */
  showPercent?: boolean;
}

export interface ActivityStatus {
  status?: AgentStatusState;
  currentTool?: string;
  /** A preformatted, non-empty detail such as a path or command preview. */
  detail?: string;
  currentToolStartedAt?: number;
  lastActivityAt?: number;
  now?: number;
  activityState?: "active_long_running" | "needs_attention";
}

export interface AgentStatusFacts extends TokenStatus, ActivityStatus {
  turns?: number;
  turnLimit?: number;
  toolUses?: number;
  compactions?: number;
  elapsedMs?: number;
}

const validCount = (value: number | null | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function formatTurns(turns: number, limit?: number): string {
  const count = validCount(turns);
  if (count === undefined) return "";
  const usableLimit = validCount(limit);
  return `↻${count}${usableLimit !== undefined && usableLimit > 0 ? ` ≤${usableLimit}` : ""}`;
}

export function formatToolUses(count: number): string {
  const usable = validCount(count);
  return usable === undefined ? "" : plural(usable, "tool use");
}

export function contextColor(percent: number): "dim" | "warning" | "error" {
  return percent < 70 ? "dim" : percent < 85 ? "warning" : "error";
}

export function formatTokenStatus(
  usage: TokenStatus,
  theme?: StatusTheme,
): string {
  const tokens = validCount(usage.tokens);
  if (tokens === undefined) return "";

  const tokenText = `${formatCompactTokens(tokens)} ${tokens === 1 ? "token" : "tokens"}`;
  const capacity = validCount(usage.contextWindow);
  if (usage.showPercent === false || capacity === undefined || capacity === 0)
    return tokenText;

  const rawPercent = Math.min(100, Math.max(0, (tokens / capacity) * 100));
  const percentText = `${Math.round(rawPercent)}%`;
  const renderedPercent = theme
    ? theme.fg(contextColor(rawPercent), percentText)
    : percentText;
  return `${tokenText} (${renderedPercent})`;
}

/** Compaction badge; zero compactions intentionally occupies no UI space. */
export function formatCompactions(count: number | null | undefined): string {
  const usable = validCount(count);
  return usable ? `⇊${usable}` : "";
}

/** Compact elapsed duration. Durations are inputs, so rendering is deterministic. */
export function formatElapsedTime(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs)) return "";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m${String(remainder).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

const STATE_PRESENTATION: Record<
  AgentStatusState,
  { glyph: string; label: string; color: Parameters<StatusTheme["fg"]>[0] }
> = {
  queued: { glyph: "○", label: "queued", color: "muted" },
  running: { glyph: "●", label: "running", color: "warning" },
  done: { glyph: "✓", label: "done", color: "success" },
  error: { glyph: "✗", label: "failed", color: "error" },
  cancelled: { glyph: "■", label: "cancelled", color: "muted" },
};

export function formatStateGlyph(
  state: AgentStatusState,
  theme?: StatusTheme,
): string {
  const presentation = STATE_PRESENTATION[state];
  return theme
    ? theme.fg(presentation.color, presentation.glyph)
    : presentation.glyph;
}

export function formatStateLabel(
  state: AgentStatusState,
  theme?: StatusTheme,
): string {
  const presentation = STATE_PRESENTATION[state];
  return theme
    ? theme.fg(presentation.color, presentation.label)
    : presentation.label;
}

export function formatAgentState(
  state: AgentStatusState,
  theme?: StatusTheme,
): string {
  return `${formatStateGlyph(state, theme)} ${formatStateLabel(state, theme)}`;
}

function relativeActivity(lastActivityAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000));
  return seconds < 1 ? "active now" : `active ${seconds}s ago`;
}

/**
 * Summarize only immutable activity facts. Callers choose `now`, making this
 * suitable for snapshots, tests, widgets, and mutable TUI views alike.
 */
export function formatActivitySummary(activity: ActivityStatus): string {
  const now = activity.now ?? Date.now();
  if (activity.currentTool?.trim()) {
    const parts = [activity.currentTool.trim()];
    if (activity.detail?.trim()) parts[0] += `(${activity.detail.trim()})`;
    if (
      typeof activity.currentToolStartedAt === "number" &&
      Number.isFinite(activity.currentToolStartedAt)
    ) {
      parts.push(formatElapsedTime(now - activity.currentToolStartedAt));
    }
    return parts.filter(Boolean).join(" | ");
  }
  if (activity.activityState === "needs_attention") return "needs attention";
  if (activity.activityState === "active_long_running")
    return "active but long-running";
  if (
    typeof activity.lastActivityAt === "number" &&
    Number.isFinite(activity.lastActivityAt)
  )
    return relativeActivity(activity.lastActivityAt, now);
  if (activity.status === "running") return "thinking…";
  return "";
}

/** Render the reusable Claude-style statistics segment. */
export function formatAgentStatusFacts(
  facts: AgentStatusFacts,
  theme?: StatusTheme,
): string {
  const parts = [
    facts.turns === undefined ? "" : formatTurns(facts.turns, facts.turnLimit),
    facts.toolUses === undefined ? "" : formatToolUses(facts.toolUses),
    formatTokenStatus(facts, theme),
    formatCompactions(facts.compactions),
    facts.elapsedMs === undefined ? "" : formatElapsedTime(facts.elapsedMs),
  ].filter(Boolean);
  return parts.join(theme ? ` ${theme.fg("dim", "·")} ` : " · ");
}
