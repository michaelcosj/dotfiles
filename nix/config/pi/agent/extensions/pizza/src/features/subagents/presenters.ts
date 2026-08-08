import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  formatElapsed,
  latestText,
  type SubagentSnapshot,
} from "./state.js";
import { oneLineSummary } from "./ui/result-card.js";
import { sanitizeText } from "./ui/transcript.js";

export const OUTPUT_LIMIT = 48 * 1024;

export function tail(text: string, max = OUTPUT_LIMIT) {
  const bytes = Buffer.byteLength(text);
  if (bytes <= max) return text;
  let out = text.slice(-max);
  while (Buffer.byteLength(out) > max) {
    out = out.slice(Math.ceil(out.length * 0.05));
  }
  return `[truncated; full transcript: session file]\n${out}`;
}

export function describeSubagent(snapshot: SubagentSnapshot) {
  return `${snapshot.id} [${snapshot.status}] "${snapshot.title}" (${snapshot.meta.modelLabel ?? "inherited model"}, ${formatElapsed(snapshot)}, ${snapshot.cwd})`;
}

export function subagentResultText(
  snapshot: SubagentSnapshot,
  max = OUTPUT_LIMIT,
) {
  let output = `Subagent ${snapshot.id} "${snapshot.title}" ${snapshot.status}.`;
  if (snapshot.errorText) output += `\nError: ${snapshot.errorText}`;
  const prefix = `${output}\nSession: ${snapshot.meta.sessionFilePath ?? "?"}\n\n`;
  return (
    prefix +
    tail(
      snapshot.finalText || "(no output)",
      Math.max(1024, max - Buffer.byteLength(prefix)),
    )
  );
}

export function subagentResultBatch(snapshots: SubagentSnapshot[]) {
  const separator = "\n\n---\n\n";
  const share = Math.max(
    1024,
    Math.floor(
      (OUTPUT_LIMIT - separator.length * Math.max(0, snapshots.length - 1)) /
        Math.max(1, snapshots.length),
    ),
  );
  return tail(
    snapshots.map((snapshot) => subagentResultText(snapshot, share)).join(separator),
    OUTPUT_LIMIT,
  );
}

export function spawnResultText(snapshot: SubagentSnapshot) {
  return `Started ${snapshot.id} "${snapshot.title}" in ${snapshot.cwd}.`;
}

export function subagentResultDetails(snapshot: SubagentSnapshot) {
  return {
    id: snapshot.id,
    title: snapshot.title,
    status: snapshot.status,
    summary: oneLineSummary(snapshot.errorText || snapshot.finalText),
    modelLabel: snapshot.meta.modelLabel,
    reasoningEffort: snapshot.meta.reasoningEffort,
    turns: snapshot.turns,
    toolUseCount: snapshot.toolUseCount,
    compactionCount: snapshot.compactionCount,
    tokens: snapshot.usage?.tokens,
    contextWindow: snapshot.usage?.contextWindow ?? snapshot.meta?.contextWindow,
    elapsedMs: Math.max(0, (snapshot.settledAt ?? Date.now()) - snapshot.createdAt),
  };
}

/** Compare settlement identity without hiding a newer continuation generation. */
export function sameSettlement(
  left: SubagentSnapshot,
  right: SubagentSnapshot,
) {
  return (
    left.status === right.status &&
    left.settledAt === right.settledAt &&
    left.turns === right.turns &&
    left.finalText === right.finalText &&
    left.errorText === right.errorText
  );
}

export function renderBtwEntry(
  data: {
    title: string;
    status: string;
    answer: string;
    sessionFilePath?: string;
  },
  expanded: boolean,
  theme: Theme,
) {
  const ok = data.status === "done";
  const header = `${theme.fg(ok ? "success" : "error", ok ? "■" : "x")} ${theme.fg("accent", theme.bold(`by the way · ${sanitizeText(data.title)}`))}${theme.fg("muted", ` · ${data.status}`)}`;
  const answer = sanitizeText(data.answer || "(no answer)");
  const lines = answer.split("\n");
  const shown = expanded ? lines : lines.slice(0, 12);
  let text = `${header}\n${shown.join("\n")}`;
  if (!expanded && shown.length < lines.length) {
    text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
  }
  if (expanded && data.sessionFilePath) {
    text += `\n${theme.fg("dim", `session: ${data.sessionFilePath}`)}`;
  }
  return text;
}

export function latestPreview(snapshot: SubagentSnapshot, max = 16 * 1024) {
  return tail(latestText(snapshot) || "(no output)", max);
}
