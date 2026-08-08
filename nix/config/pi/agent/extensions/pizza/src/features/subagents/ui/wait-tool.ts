import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubagentSnapshot } from "../state.js";
import type { SubagentReadModel } from "../manager.js";
import {
  formatStateGlyph,
  formatStateLabel,
  type AgentStatusState,
} from "./agent-status.js";
import {
  formatAgentMetrics,
  oneLineSummary,
  statusState,
} from "./result-card.js";

export const WAIT_UPDATE_THROTTLE_MS = 100;
export const WAIT_UPDATE_MAX_BYTES = 16 * 1024;
const WAIT_UPDATE_MAX_AGENTS = 64;

export interface WaitAgentDetails {
  id: string;
  title: string;
  status: AgentStatusState;
  activity?: string;
  summary?: string;
  modelLabel?: string;
  reasoningEffort?: string;
  turns?: number;
  toolUseCount?: number;
  compactionCount?: number;
  tokens?: number;
  contextWindow?: number;
  elapsedMs?: number;
}

export interface WaitToolDetails {
  agents: WaitAgentDetails[];
}

export interface WaitToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: WaitToolDetails;
}

const finite = (value: unknown, minimum = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;

const boundedString = (value: unknown, max: number) => {
  if (typeof value !== "string") return undefined;
  const clean = oneLineSummary(value, max);
  return clean === "(no output)" ? undefined : clean;
};

const boundedText = (text: string, maxBytes = WAIT_UPDATE_MAX_BYTES) => {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let output = text.slice(0, maxBytes);
  while (Buffer.byteLength(output) > maxBytes - 4) output = output.slice(0, -1);
  return `${output}…`;
};

/** Stable wait display order, independent of caller id order. */
export function orderAwaitedSnapshots(
  snapshots: ReadonlyArray<SubagentSnapshot>,
): SubagentSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const aOrder = finite(a.launchOrder) ?? finite(a.createdAt);
    const bOrder = finite(b.launchOrder) ?? finite(b.createdAt);
    return (
      (aOrder ?? Number.MAX_SAFE_INTEGER) -
        (bOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
    );
  });
}

function snapshotDetails(
  snapshot: SubagentSnapshot,
  includeSummary: boolean,
  now: number,
): WaitAgentDetails {
  const modelLabel = boundedString(snapshot.meta?.modelLabel, 60);
  const reasoningEffort = boundedString(snapshot.meta?.reasoningEffort, 20);
  const activity = boundedString(snapshot.activity, 160);
  const summary = includeSummary
    ? oneLineSummary(snapshot.errorText || snapshot.finalText, 240)
    : undefined;
  return {
    id: oneLineSummary(snapshot.id, 80),
    title: oneLineSummary(snapshot.title, 100),
    status: statusState(snapshot.status),
    ...(activity ? { activity } : {}),
    ...(summary ? { summary } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    turns: finite(snapshot.turns),
    toolUseCount: finite(snapshot.toolUseCount),
    compactionCount: finite(snapshot.compactionCount),
    tokens: finite(snapshot.usage?.tokens),
    contextWindow: finite(
      snapshot.usage?.contextWindow ?? snapshot.meta?.contextWindow,
      Number.EPSILON,
    ),
    elapsedMs: Math.max(
      0,
      (finite(snapshot.settledAt) ?? now) - (finite(snapshot.createdAt) ?? now),
    ),
  };
}

export function waitDetailsFromSnapshots(
  snapshots: ReadonlyArray<SubagentSnapshot>,
  includeSummary: boolean,
  now = Date.now(),
): WaitToolDetails {
  return {
    agents: orderAwaitedSnapshots(snapshots)
      .slice(0, WAIT_UPDATE_MAX_AGENTS)
      .map((snapshot) => snapshotDetails(snapshot, includeSummary, now)),
  };
}

function selectedDetails(
  view: SubagentReadModel,
  ids: ReadonlyArray<string>,
  now = Date.now(),
): WaitToolDetails {
  const wanted = new Set(ids);
  const snapshots = view.list().filter((snapshot) => wanted.has(snapshot.id));
  const details = waitDetailsFromSnapshots(snapshots, false, now);
  const found = new Set(details.agents.map((agent) => agent.id));
  for (const id of ids) {
    const safeId = oneLineSummary(id, 80);
    if (details.agents.length >= WAIT_UPDATE_MAX_AGENTS) break;
    if (found.has(safeId)) continue;
    details.agents.push({
      id: safeId,
      title: safeId,
      status: "queued",
      activity: "waiting for snapshot",
    });
    found.add(safeId);
  }
  return details;
}

function themed(
  theme: Theme | undefined,
  color: Parameters<Theme["fg"]>[0],
  text: string,
) {
  return theme ? theme.fg(color, text) : text;
}

export function waitTreeText(
  details: WaitToolDetails,
  theme?: Theme,
  options: { summaries?: boolean } = {},
) {
  const agents = Array.isArray(details.agents) ? details.agents : [];
  const lines = [themed(theme, "muted", "Agents")];
  agents.forEach((agent, index) => {
    const last = index === agents.length - 1;
    const branch = last ? "└─" : "├─";
    const state = statusState(agent.status);
    const title = oneLineSummary(agent.title || agent.id, 100);
    const activity = boundedString(agent.activity, 160);
    const model = boundedString(agent.modelLabel, 60);
    const reasoning = boundedString(agent.reasoningEffort, 20);
    // Keep model identity near the front so long activity text cannot clip it.
    const metrics = formatAgentMetrics(
      { ...agent, modelLabel: undefined, reasoningEffort: undefined },
      theme,
    );
    const facts = [
      formatStateLabel(state, theme),
      model,
      reasoning,
      activity,
      metrics,
    ]
      .filter(Boolean)
      .join(` ${themed(theme, "dim", "·")} `);
    lines.push(
      `${themed(theme, "dim", branch)} ${formatStateGlyph(state, theme)} ${themed(theme, "text", title)}${facts ? ` ${themed(theme, "dim", "·")} ${facts}` : ""}`,
    );
    if (options.summaries && agent.summary) {
      const continuation = last ? "  " : "│ ";
      lines.push(
        `${themed(theme, "dim", `${continuation} └─`)} ${themed(theme, "muted", oneLineSummary(agent.summary, 240))}`,
      );
    }
  });
  if (!agents.length) lines.push(themed(theme, "dim", "└─ waiting…"));
  return boundedText(lines.join("\n"));
}

export function buildWaitUpdate(
  view: SubagentReadModel,
  ids: ReadonlyArray<string>,
): WaitToolResult {
  const details = selectedDetails(view, ids);
  return {
    content: [{ type: "text", text: waitTreeText(details) }],
    details,
  };
}

export type WaitForSubagents = (
  ids: ReadonlyArray<string>,
  signal?: AbortSignal,
) => Promise<void>;

/** Wait using a read-only view and an explicit command callback. */
export async function waitWithLiveUpdates(
  view: SubagentReadModel,
  wait: WaitForSubagents,
  ids: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
  onUpdate: ((result: WaitToolResult) => void) | undefined,
  throttleMs = WAIT_UPDATE_THROTTLE_MS,
): Promise<SubagentSnapshot[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPublishedAt = 0;
  let unsubscribed = false;
  const publish = () => {
    timer = undefined;
    lastPublishedAt = Date.now();
    if (!onUpdate) return;
    try {
      onUpdate(buildWaitUpdate(view, ids));
    } catch {
      // Rendering progress must not interfere with child lifecycle events.
    }
  };
  const schedule = () => {
    const delay = Math.max(0, throttleMs - (Date.now() - lastPublishedAt));
    if (delay === 0) {
      if (timer) clearTimeout(timer);
      publish();
    } else if (!timer) {
      timer = setTimeout(publish, delay);
    }
  };
  const unsubscribe = view.subscribe(schedule);
  try {
    publish();
    await wait(ids, signal);
  } finally {
    if (timer) clearTimeout(timer);
    if (!unsubscribed) {
      unsubscribed = true;
      unsubscribe();
    }
  }
  return ids.map((id) => {
    const snapshot = view.get(id);
    if (!snapshot) throw new Error(`Unknown subagent "${id}"`);
    return snapshot;
  });
}

function resultContent(result: { content?: unknown }) {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function waitCallText(ids: ReadonlyArray<string>, theme: Theme) {
  const count = new Set(ids).size;
  return `${theme.fg("toolTitle", theme.bold("subagent_wait"))} ${theme.fg("muted", `${count} ${count === 1 ? "agent" : "agents"}`)}`;
}

export function waitResultText(
  result: { content?: unknown; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
) {
  const rawDetails = result.details as { agents?: unknown } | undefined;
  const details: WaitToolDetails = {
    agents: Array.isArray(rawDetails?.agents)
      ? (rawDetails.agents as WaitAgentDetails[])
      : [],
  };
  const body = boundedText(resultContent(result), 48 * 1024).trim();
  if (!details.agents.length) return body || themed(theme, "dim", "Waiting…");
  if (options.isPartial) return waitTreeText(details, theme);
  const tree = waitTreeText(details, theme, {
    summaries: !options.expanded,
  });
  if (options.expanded)
    return `${tree}\n\n${theme.fg("dim", "Outputs")}\n${body || "(no output)"}`;
  return `${tree}\n${theme.fg("dim", "ctrl+o to expand outputs")}`;
}
