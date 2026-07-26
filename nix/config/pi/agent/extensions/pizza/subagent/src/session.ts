import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  SpawnTask,
  SubagentEvent,
  SubagentMeta,
  TranscriptPart,
} from "./domain.ts";
import { SpawnError } from "./domain.ts";

export const CHILD_EXCLUDED_TOOLS = [
  "subagent_spawn",
  "subagent_wait",
  "subagent_cancel",
  "subagent_check",
  "subagent_list",
  "subagent",
  "workflow",
  "questionnaire",
  "ask_user",
  "ask_question",
];
export const isChildToolExcluded = (name: string) =>
  CHILD_EXCLUDED_TOOLS.includes(name) ||
  /(^|[_-])(subagents?|delegate|workflow|questionnaire|ask[_-]?(user|question))($|[_-])/i.test(
    name,
  );
const MAX_LIVE = 256 * 1024;
const bounded = (v: unknown, n = 4096) =>
  (v instanceof Error ? v.message : String(v)).slice(0, n);
const json = (v: unknown) => {
  try {
    return JSON.stringify(v).slice(0, 4096);
  } catch {
    return undefined;
  }
};
function role(v: unknown) {
  return (v as { role?: string })?.role;
}
export function resolvePiModel(
  reg: ModelRegistry,
  hint: string | undefined,
  inherited: SpawnTask["parent"]["inheritedModel"],
): Model<any> | undefined {
  if (!hint)
    return inherited
      ? (reg.find(inherited.provider, inherited.id) ?? undefined)
      : undefined;
  const slash = hint.indexOf("/");
  if (slash > 0) {
    const found = reg.find(hint.slice(0, slash), hint.slice(slash + 1));
    if (found) return found;
    throw new SpawnError(`Unknown model "${hint}".`);
  }
  if (inherited) {
    const found = reg.find(inherited.provider, hint);
    if (found) return found;
  }
  const matches = reg.getAll().filter((m) => m.id === hint);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    throw new SpawnError(
      `Model "${hint}" is ambiguous (${matches.map((m) => m.provider).join(", ")}); use provider/model.`,
    );
  throw new SpawnError(`Unknown model "${hint}".`);
}
function textOf(msg: Message) {
  const c = (msg as { content: unknown }).content;
  return typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .filter((p: any) => p?.type === "text")
          .map((p: any) => p.text)
          .join("\n")
      : "";
}
function assistantParts(msg: AssistantMessage): TranscriptPart[] {
  return msg.content.flatMap((p): TranscriptPart[] =>
    p.type === "text"
      ? [{ type: "text", text: p.text }]
      : p.type === "thinking"
        ? [
            {
              type: "thinking",
              text: p.redacted ? "" : p.thinking,
              redacted: p.redacted,
            },
          ]
        : p.type === "toolCall"
          ? [
              {
                type: "toolCall",
                toolId: p.id,
                name: p.name,
                argsPreview: json(p.arguments),
              },
            ]
          : [],
  );
}
export function isSuccessfulCompaction(
  event: Extract<AgentSessionEvent, { type: "compaction_end" }>,
) {
  return Boolean(event.result && !event.aborted && !event.willRetry);
}
function preview(v: unknown) {
  if (typeof v === "string") return v.slice(0, 4096);
  const c = (v as any)?.content;
  return Array.isArray(c)
    ? c
        .filter((p: any) => p?.type === "text")
        .map((p: any) => p.text)
        .join("\n")
        .slice(0, 4096)
    : undefined;
}
function finalText(session: AgentSession) {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (role(m) === "assistant") {
      const t = textOf(m as Message).trim();
      if (t) return t.slice(-1024 * 1024);
    }
  }
  return "";
}
export function updateToolActivity(
  active: Map<string, string>,
  event:
    | { type: "start"; toolId: string; toolName: string }
    | { type: "end"; toolId: string },
) {
  if (event.type === "start") {
    active.delete(event.toolId);
    active.set(event.toolId, event.toolName);
  } else {
    active.delete(event.toolId);
  }
  const current = [...active.values()].at(-1);
  return current ? `Using ${current}` : "Working";
}
async function boundedWait(p: Promise<unknown>, ms = 5000) {
  let t: NodeJS.Timeout | undefined;
  await Promise.race([
    p.catch(() => {}),
    new Promise<void>((r) => (t = setTimeout(r, ms))),
  ]);
  if (t) clearTimeout(t);
}
export interface ChildSession {
  readonly session: AgentSession;
  readonly meta: ChildSessionMeta;
  subscribe(fn: (e: SubagentEvent) => void): () => void;
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
}
export interface ChildSessionMeta extends SubagentMeta {}
export async function createChildSession(
  task: SpawnTask,
): Promise<ChildSession> {
  const reg = task.parent.modelRegistry;
  if (!reg) throw new SpawnError("Parent model registry unavailable.");
  const model = resolvePiModel(reg, task.model, task.parent.inheritedModel);
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(task.cwd, agentDir, {
    projectTrusted: task.parent.projectTrusted,
  });
  const loader = new DefaultResourceLoader({
    cwd: task.cwd,
    agentDir,
    settingsManager: settings,
  });
  await loader.reload();
  const inheritedTools = (task.parent.activeTools ?? []).filter(
    (name) => !isChildToolExcluded(name),
  );
  let session: AgentSession;
  try {
    ({ session } = await createAgentSession({
      cwd: task.cwd,
      sessionManager: SessionManager.create(task.cwd),
      settingsManager: settings,
      resourceLoader: loader,
      model,
      thinkingLevel: (task.reasoningEffort ??
        task.parent.inheritedThinkingLevel) as any,
      tools: inheritedTools,
      excludeTools: CHILD_EXCLUDED_TOOLS,
    }));
    await session.bindExtensions({ mode: "print" });
  } catch (e) {
    throw new SpawnError(bounded(e));
  }
  let closed = false,
    settled = false,
    runError: string | undefined;
  const listeners = new Set<(e: SubagentEvent) => void>();
  const activeTools = new Map<string, string>();
  const emit = (e: SubagentEvent) => {
    for (const l of listeners) l(e);
  };
  const activeMeta = (): ChildSessionMeta => ({
    backend: "pi",
    modelLabel: session.model
      ? `${session.model.provider}/${session.model.id}`
      : undefined,
    contextWindow: session.model?.contextWindow,
    sessionFilePath: session.sessionFile,
    reasoningEffort: session.thinkingLevel,
  });
  const settle = () => {
    if (settled) return;
    settled = true;
    const last = [...session.messages]
      .reverse()
      .find((m) => role(m) === "assistant") as AssistantMessage | undefined;
    const aborted = last?.stopReason === "aborted";
    const err =
      runError ||
      (last?.stopReason === "error"
        ? (last.errorMessage ?? "Run failed")
        : undefined);
    emit({
      type: "settled",
      status: err ? "error" : aborted ? "cancelled" : "done",
      reason: err ? "error" : aborted ? "aborted" : "completed",
      finalText: finalText(session),
      errorText: err ? bounded(err) : aborted ? "Interrupted" : undefined,
    });
  };
  const unsub = session.subscribe((e: AgentSessionEvent) => {
    if (closed) return;
    switch (e.type) {
      case "agent_start":
        settled = false;
        activeTools.clear();
        emit({ type: "run-start" });
        emit({ type: "activity", activity: "Starting" });
        break;
      case "message_update": {
        const x = e.assistantMessageEvent;
        if (x.type === "text_delta" || x.type === "thinking_delta") {
          emit({
            type: "delta",
            kind: x.type === "text_delta" ? "text" : "thinking",
            delta: x.delta.slice(-MAX_LIVE),
          });
          emit({
            type: "activity",
            activity: x.type === "text_delta" ? "Writing" : "Thinking",
          });
        }
        break;
      }
      case "message_end":
        if (role(e.message) === "user")
          emit({ type: "user", text: textOf(e.message as Message) });
        else if (role(e.message) === "assistant") {
          emit({
            type: "assistant",
            parts: assistantParts(e.message as AssistantMessage),
          });
          const u = session.getContextUsage();
          emit({
            type: "meta",
            meta: activeMeta(),
            tokens: u?.tokens ?? undefined,
          });
        }
        break;
      case "tool_execution_start":
        emit({
          type: "activity",
          activity: updateToolActivity(activeTools, {
            type: "start",
            toolId: e.toolCallId,
            toolName: e.toolName,
          }),
        });
        emit({
          type: "tool-start",
          tool: {
            toolId: e.toolCallId,
            name: e.toolName,
            argsPreview: json(e.args),
          },
        });
        break;
      case "tool_execution_update":
        emit({
          type: "tool-update",
          toolId: e.toolCallId,
          outputPreview: preview(e.partialResult),
        });
        break;
      case "tool_execution_end": {
        const activity = updateToolActivity(activeTools, {
          type: "end",
          toolId: e.toolCallId,
        });
        emit({
          type: "tool-end",
          toolId: e.toolCallId,
          name: e.toolName,
          isError: e.isError,
          outputPreview: preview(e.result),
        });
        emit({ type: "activity", activity });
        break;
      }
      case "compaction_start":
        emit({ type: "activity", activity: "Compacting context" });
        break;
      case "compaction_end":
        if (isSuccessfulCompaction(e)) emit({ type: "compaction" });
        emit({ type: "activity", activity: "Working" });
        break;
      case "queue_update":
        emit({
          type: "queue",
          queued: [
            ...e.steering.map((text) => ({ text, kind: "steer" as const })),
            ...e.followUp.map((text) => ({ text, kind: "follow-up" as const })),
          ],
        });
        break;
      case "agent_settled":
        settle();
        break;
    }
  });
  const start = (text: string) => {
    runError = undefined;
    settled = false;
    void session.prompt(text).catch((e) => {
      runError = bounded(e);
      settle();
    });
  };
  try {
    session.sessionManager.appendSessionInfo(
      `${task.origin === "btw" ? "btw" : "subagent"}: ${task.title}`,
    );
  } catch {}
  setTimeout(() => {
    if (!closed) {
      emit({ type: "meta", meta: activeMeta() });
      start(task.prompt);
    }
  }, 0);
  return {
    session,
    meta: activeMeta(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async send(text) {
      if (closed) throw new Error("Subagent session closed");
      if (session.isStreaming) await session.steer(text);
      else start(text);
    },
    async interrupt() {
      if (closed) return;
      try {
        session.clearQueue();
      } catch {}
      await session.abort().catch(() => {});
      if (!settled) settle();
    },
    async dispose() {
      if (closed) return;
      closed = true;
      unsub();
      try {
        session.clearQueue();
      } catch {}
      await boundedWait(session.abort());
      try {
        if (session.extensionRunner.hasHandlers("session_shutdown"))
          await boundedWait(
            session.extensionRunner.emit({
              type: "session_shutdown",
              reason: "quit",
            }),
          );
      } catch {}
      session.dispose();
      listeners.clear();
    },
  };
}
