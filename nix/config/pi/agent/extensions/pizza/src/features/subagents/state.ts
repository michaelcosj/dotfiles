export const MAX_RUNNING = 4;
export const MAX_TRACKED = 64;
export const MAX_TRANSCRIPT = 512;
export const MAX_FINAL_BYTES = 1024 * 1024;
export type SubagentStatus = "running" | "done" | "error" | "cancelled";
/** Why a run stopped. Kept separate from status so the legacy status API remains stable. */
export type SubagentCompletionReason =
  "completed" | "wrapped-up" | "stopped" | "error" | "aborted";
export type SubagentOrigin = "model" | "btw";
export const REASONING_EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export interface ParentContext {
  parentCwd: string;
  projectTrusted: boolean;
  inheritedModel?: { provider: string; id: string };
  inheritedThinkingLevel?: string;
  activeTools?: string[];
}
export interface SpawnTask {
  prompt: string;
  title: string;
  cwd: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  origin?: SubagentOrigin;
  parent: ParentContext;
}
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; redacted?: boolean }
  | { type: "toolCall"; toolId: string; name: string; argsPreview?: string };
export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; parts: ReadonlyArray<TranscriptPart> }
  | {
      kind: "toolResult";
      toolId: string;
      name: string;
      isError: boolean;
      outputPreview?: string;
    };
export interface LiveToolState {
  toolId: string;
  name: string;
  argsPreview?: string;
  outputPreview?: string;
  done?: boolean;
  isError?: boolean;
}
export interface QueuedMessage {
  text: string;
  kind: "steer" | "follow-up";
}
export interface SubagentMeta {
  backend: "pi";
  modelLabel?: string;
  contextWindow?: number;
  sessionFilePath?: string;
  reasoningEffort?: ReasoningEffort;
}
export interface SubagentSnapshot {
  id: string;
  origin: SubagentOrigin;
  backend: "pi";
  title: string;
  prompt: string;
  cwd: string;
  status: SubagentStatus;
  /** Monotonic order assigned when spawn is requested (not when setup finishes). */
  launchOrder: number;
  createdAt: number;
  settledAt?: number;
  completionReason?: SubagentCompletionReason;
  errorText?: string;
  meta: SubagentMeta;
  usage: { tokens?: number; contextWindow?: number };
  transcript: ReadonlyArray<TranscriptItem>;
  liveAssistant?: { text: string; thinking: string };
  liveTools: ReadonlyArray<LiveToolState>;
  queued: ReadonlyArray<QueuedMessage>;
  finalText: string;
  turns: number;
  toolUseCount: number;
  /** Number of successful compactions, including overflow compactions that retry. */
  compactionCount: number;
  /** Short, presentation-ready description of what the child is doing now. */
  activity?: string;
}
export type SubagentEvent =
  | { type: "run-start" }
  | {
      type: "settled";
      status: "done" | "error" | "cancelled";
      finalText: string;
      errorText?: string;
      reason?: SubagentCompletionReason;
    }
  | { type: "delta"; kind: "text" | "thinking"; delta: string }
  | { type: "activity"; activity?: string }
  | {
      type: "compaction";
      reason: "threshold" | "overflow" | "manual";
      willRetry: boolean;
      estimatedTokens?: number;
    }
  | { type: "user"; text: string }
  | { type: "assistant"; parts: TranscriptPart[] }
  | { type: "tool-start"; tool: LiveToolState }
  | { type: "tool-update"; toolId: string; outputPreview?: string }
  | {
      type: "tool-end";
      toolId: string;
      name: string;
      isError: boolean;
      outputPreview?: string;
    }
  | { type: "queue"; queued: QueuedMessage[] }
  | {
      type: "meta";
      meta: Partial<SubagentMeta>;
      tokens?: number;
      /** Explicitly clear usage when Pi has not produced a fresh estimate. */
      clearTokens?: boolean;
    };
export function latestText(s: SubagentSnapshot) {
  return s.liveAssistant?.text.trim() || s.finalText;
}
export function formatElapsed(s: SubagentSnapshot) {
  const sec = Math.max(
    0,
    Math.round(((s.settledAt ?? Date.now()) - s.createdAt) / 1000),
  );
  return sec >= 60
    ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`
    : `${sec}s`;
}
export class SpawnError extends Error {
  readonly _tag = "SpawnError";
}
export class ConcurrencyLimitError extends Error {
  readonly _tag = "ConcurrencyLimitError";
}
export class UnknownSubagentError extends Error {
  readonly _tag = "UnknownSubagentError";
}
