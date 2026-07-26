import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubagentSnapshot, SubagentStatus } from "../domain.ts";
import {
  formatAgentStatusFacts,
  formatStateGlyph,
  formatStateLabel,
  type AgentStatusFacts,
  type AgentStatusState,
} from "./agent-status.ts";
import { sanitizeText } from "./transcript.ts";

const finite = (value: unknown, minimum = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;

export function oneLineSummary(text: unknown, max = 240) {
  const line = sanitizeText(typeof text === "string" ? text : "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "(no output)";
  return line.length <= max ? line : `${line.slice(0, Math.max(1, max - 1))}…`;
}

export function statusState(status: unknown): AgentStatusState {
  return status === "done" ||
    status === "error" ||
    status === "cancelled" ||
    status === "queued"
    ? status
    : "running";
}

interface MetricsSource {
  modelLabel?: unknown;
  reasoningEffort?: unknown;
  turns?: unknown;
  turnLimit?: unknown;
  toolUseCount?: unknown;
  compactionCount?: unknown;
  tokens?: unknown;
  contextWindow?: unknown;
  elapsed?: unknown;
  elapsedMs?: unknown;
}

/** Read only known, valid telemetry so partial result details degrade cleanly. */
export function formatAgentMetrics(source: MetricsSource, theme?: Theme) {
  const parts: string[] = [];
  if (typeof source.modelLabel === "string" && source.modelLabel.trim())
    parts.push(oneLineSummary(source.modelLabel, 60));
  if (
    typeof source.reasoningEffort === "string" &&
    source.reasoningEffort.trim()
  )
    parts.push(source.reasoningEffort.trim());

  const facts: AgentStatusFacts = {};
  const turns = finite(source.turns);
  const turnLimit = finite(source.turnLimit);
  const tools = finite(source.toolUseCount);
  const compactions = finite(source.compactionCount);
  const tokens = finite(source.tokens);
  const contextWindow = finite(source.contextWindow, Number.EPSILON);
  const elapsedMs = finite(source.elapsedMs);
  if (turns !== undefined) facts.turns = turns;
  if (turnLimit !== undefined) facts.turnLimit = turnLimit;
  if (tools !== undefined) facts.toolUses = tools;
  if (compactions !== undefined) facts.compactions = compactions;
  if (tokens !== undefined) facts.tokens = tokens;
  if (contextWindow !== undefined) facts.contextWindow = contextWindow;
  if (elapsedMs !== undefined) facts.elapsedMs = elapsedMs;
  const telemetry = formatAgentStatusFacts(facts, theme);
  if (telemetry) parts.push(telemetry);
  if (
    elapsedMs === undefined &&
    typeof source.elapsed === "string" &&
    source.elapsed.trim()
  )
    parts.push(source.elapsed.trim());
  return parts.join(theme ? ` ${theme.fg("dim", "·")} ` : " · ");
}

export function snapshotMetrics(
  snap: SubagentSnapshot,
  theme?: Theme,
  now = Date.now(),
) {
  const meta = snap.meta as SubagentSnapshot["meta"] | undefined;
  const usage = snap.usage as SubagentSnapshot["usage"] | undefined;
  return formatAgentMetrics(
    {
      modelLabel: meta?.modelLabel,
      reasoningEffort: meta?.reasoningEffort,
      turns: snap.turns,
      toolUseCount: snap.toolUseCount,
      compactionCount: snap.compactionCount,
      tokens: usage?.tokens,
      contextWindow: usage?.contextWindow ?? meta?.contextWindow,
      elapsedMs: Math.max(0, (snap.settledAt ?? now) - snap.createdAt),
    },
    theme,
  );
}

export interface SubagentResultCardDetails extends MetricsSource {
  id?: unknown;
  title?: unknown;
  status?: SubagentStatus | string;
  summary?: unknown;
}

export function resultCardText(
  details: SubagentResultCardDetails,
  content: unknown,
  expanded: boolean,
  theme: Theme,
) {
  const state = statusState(details.status);
  const id =
    typeof details.id === "string" && details.id.trim()
      ? oneLineSummary(details.id, 40)
      : "?";
  const title =
    typeof details.title === "string" && details.title.trim()
      ? oneLineSummary(details.title, 100)
      : undefined;
  const heading = `${formatStateGlyph(state, theme)} ${theme.fg("accent", theme.bold(`subagent ${id}`))}${title ? theme.fg("muted", ` · ${title}`) : ""}`;
  const metrics = formatAgentMetrics(details, theme);
  const stateLine = `  ${formatStateLabel(state, theme)}${metrics ? ` ${theme.fg("dim", "·")} ${metrics}` : ""}`;
  const body = sanitizeText(typeof content === "string" ? content : "").trim();
  const summary = oneLineSummary(details.summary ?? body);
  if (expanded) {
    return `${heading}\n${stateLine}\n${theme.fg("dim", "  full output")}\n${body || "(no output)"}`;
  }
  return `${heading}\n${stateLine}\n  ${theme.fg("text", summary)}\n${theme.fg("dim", "  ctrl+o to expand")}`;
}
