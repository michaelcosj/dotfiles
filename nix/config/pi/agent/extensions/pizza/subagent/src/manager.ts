import {
  ConcurrencyLimitError,
  MAX_RUNNING,
  MAX_TRACKED,
  MAX_TRANSCRIPT,
  type SpawnTask,
  type SubagentCompletionReason,
  type SubagentEvent,
  type SubagentSnapshot,
  UnknownSubagentError,
} from "./domain.ts";
import { createChildSession, type ChildSession } from "./session.ts";
export interface CancelResult {
  id: string;
  title: string;
  status: string;
  cancelled: boolean;
}
export interface SubagentReadModel {
  list(): SubagentSnapshot[];
  get(id: string): SubagentSnapshot | undefined;
  size(): number;
  subscribe(fn: () => void): () => void;
  subscribeTo(id: string, fn: () => void): () => void;
  requestSend(id: string, text: string): Promise<void>;
  requestAbort(id: string): Promise<void>;
}
export interface SubagentManager {
  spawn(task: SpawnTask, signal?: AbortSignal): Promise<SubagentSnapshot>;
  wait(ids: string[], signal?: AbortSignal): Promise<void>;
  cancel(ids: string[], signal?: AbortSignal): Promise<CancelResult[]>;
  send(id: string, text: string): Promise<void>;
  get(id: string): SubagentSnapshot | undefined;
  list(): SubagentSnapshot[];
  disposeAll(): Promise<void>;
  view: SubagentReadModel;
  setOnSettled(fn: (s: SubagentSnapshot) => void): void;
}
type Mutable = { -readonly [K in keyof SubagentSnapshot]: SubagentSnapshot[K] };
interface Entry {
  snapshot: Mutable;
  child: ChildSession;
  unsubscribe: () => void;
  settled: Promise<void>;
  resolve: () => void;
  disposed: boolean;
  stopRequested: boolean;
}
const clone = (s: SubagentSnapshot): SubagentSnapshot => ({
  ...s,
  meta: { ...s.meta },
  usage: { ...s.usage },
  transcript: [...s.transcript],
  liveAssistant: s.liveAssistant && { ...s.liveAssistant },
  liveTools: s.liveTools.map((x) => ({ ...x })),
  queued: s.queued.map((x) => ({ ...x })),
});
const abortable = async (p: Promise<void>, signal?: AbortSignal) => {
  if (!signal) return p;
  if (signal.aborted) throw new Error("Operation aborted");
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error("Operation aborted"));
    signal.addEventListener("abort", abort, { once: true });
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort),
    );
  });
};
const tolerateWithin = async (action: () => Promise<unknown>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.resolve()
      .then(action)
      .catch(() => {}),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))),
  ]);
  if (timer) clearTimeout(timer);
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function createSubagentManager(
  factory = createChildSession,
): SubagentManager {
  const entries = new Map<string, Entry>(),
    listeners = new Set<() => void>(),
    per = new Map<string, Set<() => void>>();
  let counter = 0,
    btw = 0,
    launchCounter = 0,
    reserved = 0,
    disposed = false;
  let onSettled = (_s: SubagentSnapshot) => {};
  const running = () =>
    [...entries.values()].filter((e) => e.snapshot.status === "running").length;
  const notify = (id: string) => {
    for (const f of listeners) f();
    for (const f of per.get(id) ?? []) f();
  };
  const transcript = (
    e: Entry,
    item: SubagentSnapshot["transcript"][number],
  ) => {
    e.snapshot.transcript = [...e.snapshot.transcript, item].slice(
      -MAX_TRANSCRIPT,
    );
  };
  const settle = (
    e: Entry,
    status: "done" | "error" | "cancelled",
    finalText: string,
    errorText?: string,
    reason?: SubagentCompletionReason,
  ) => {
    if (e.snapshot.status !== "running") return;
    e.snapshot.status = status;
    e.snapshot.settledAt = Date.now();
    e.snapshot.completionReason = e.stopRequested
      ? "stopped"
      : (reason ??
        (status === "done"
          ? "completed"
          : status === "error"
            ? "error"
            : "aborted"));
    e.snapshot.finalText = finalText.slice(-1024 * 1024);
    e.snapshot.errorText = errorText?.slice(0, 4096);
    e.snapshot.liveAssistant = undefined;
    e.snapshot.liveTools = [];
    e.snapshot.queued = [];
    e.snapshot.activity = undefined;
    e.resolve();
    notify(e.snapshot.id);
    onSettled(clone(e.snapshot));
    prune();
  };
  const fold = (e: Entry, event: SubagentEvent) => {
    const s = e.snapshot;
    switch (event.type) {
      case "run-start":
        s.status = "running";
        s.settledAt = undefined;
        s.completionReason = undefined;
        s.errorText = undefined;
        s.activity = "Starting";
        e.stopRequested = false;
        s.liveAssistant = { text: "", thinking: "" };
        break;
      case "settled":
        settle(e, event.status, event.finalText, event.errorText, event.reason);
        return;
      case "activity":
        s.activity = event.activity;
        break;
      case "compaction":
        s.compactionCount++;
        break;
      case "delta": {
        const live = s.liveAssistant ?? { text: "", thinking: "" };
        live[event.kind] = (live[event.kind] + event.delta).slice(-256 * 1024);
        s.liveAssistant = live;
        s.activity = event.kind === "thinking" ? "Thinking" : "Writing";
        break;
      }
      case "user":
        if (event.text.trim())
          transcript(e, { kind: "user", text: event.text.slice(-65536) });
        break;
      case "assistant":
        transcript(e, { kind: "assistant", parts: event.parts });
        s.liveAssistant = undefined;
        s.turns++;
        break;
      case "tool-start":
        if (!s.liveTools.some((x) => x.toolId === event.tool.toolId))
          s.toolUseCount++;
        s.liveTools = [
          ...s.liveTools.filter((x) => x.toolId !== event.tool.toolId),
          event.tool,
        ];
        s.activity = `Using ${event.tool.name}`;
        break;
      case "tool-update":
        s.liveTools = s.liveTools.map((x) =>
          x.toolId === event.toolId
            ? { ...x, outputPreview: event.outputPreview }
            : x,
        );
        break;
      case "tool-end":
        s.liveTools = s.liveTools.filter((x) => x.toolId !== event.toolId);
        s.activity = s.liveTools.length
          ? `Using ${s.liveTools[s.liveTools.length - 1]!.name}`
          : "Working";
        transcript(e, {
          kind: "toolResult",
          toolId: event.toolId,
          name: event.name,
          isError: event.isError,
          outputPreview: event.outputPreview,
        });
        break;
      case "queue":
        s.queued = event.queued;
        break;
      case "meta":
        s.meta = { ...s.meta, ...event.meta };
        s.usage = {
          tokens: event.tokens ?? s.usage.tokens,
          contextWindow: event.meta.contextWindow ?? s.usage.contextWindow,
        };
        break;
    }
    notify(s.id);
  };
  const prune = () => {
    const settled = [...entries.values()]
      .filter((e) => e.snapshot.status !== "running")
      .sort((a, b) => a.snapshot.createdAt - b.snapshot.createdAt);
    while (entries.size > MAX_TRACKED && settled.length) {
      const e = settled.shift()!;
      entries.delete(e.snapshot.id);
      per.delete(e.snapshot.id);
      try {
        e.unsubscribe();
      } catch {}
      try {
        void e.child.dispose().catch(() => {});
      } catch {}
    }
  };
  const getEntry = (id: string) => {
    const e = entries.get(id);
    if (!e) throw new UnknownSubagentError(`Unknown subagent "${id}"`);
    return e;
  };
  const view: SubagentReadModel = {
    list: () => [...entries.values()].map((e) => clone(e.snapshot)),
    get: (id) => {
      const e = entries.get(id);
      return e && clone(e.snapshot);
    },
    size: () => entries.size,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeTo(id, fn) {
      const set = per.get(id) ?? new Set();
      set.add(fn);
      per.set(id, set);
      return () => {
        set.delete(fn);
        if (!set.size) per.delete(id);
      };
    },
    requestSend: (id, text) => api.send(id, text),
    requestAbort: async (id) => {
      await api.cancel([id]);
    },
  };
  const api: SubagentManager = {
    view,
    setOnSettled(fn) {
      onSettled = fn;
    },
    async spawn(task, signal) {
      if (disposed) throw new Error("Subagent manager disposed");
      if (signal?.aborted) throw new Error("Spawn aborted");
      if (running() + reserved >= MAX_RUNNING)
        throw new ConcurrencyLimitError(
          `At most ${MAX_RUNNING} subagents may run at once`,
        );
      reserved++;
      const launchOrder = ++launchCounter;
      let child: ChildSession;
      try {
        child = await factory(task);
      } finally {
        reserved--;
      }
      if (disposed || signal?.aborted) {
        await child.dispose().catch(() => {});
        throw new Error(
          disposed ? "Subagent manager disposed during spawn" : "Spawn aborted",
        );
      }
      const id = task.origin === "btw" ? `btw-${++btw}` : `sub-${++counter}`;
      let resolve!: () => void;
      const settled = new Promise<void>((r) => (resolve = r));
      const snapshot: Mutable = {
        id,
        origin: task.origin ?? "model",
        backend: "pi",
        title: task.title,
        prompt: task.prompt,
        cwd: task.cwd,
        status: "running",
        launchOrder,
        createdAt: Date.now(),
        meta: child.meta,
        usage: { contextWindow: child.meta.contextWindow },
        transcript: [],
        liveAssistant: { text: "", thinking: "" },
        liveTools: [],
        queued: [],
        finalText: "",
        turns: 0,
        toolUseCount: 0,
        compactionCount: 0,
        activity: "Starting",
      };
      const e: Entry = {
        snapshot,
        child,
        unsubscribe: () => {},
        settled,
        resolve,
        disposed: false,
        stopRequested: false,
      };
      e.unsubscribe = child.subscribe((ev) => fold(e, ev));
      entries.set(id, e);
      notify(id);
      return clone(snapshot);
    },
    async wait(ids, signal) {
      const targets = [...new Set(ids)]
        .map(getEntry)
        .filter((e) => e.snapshot.status === "running");
      await Promise.all(targets.map((e) => abortable(e.settled, signal)));
    },
    async cancel(ids, signal) {
      return Promise.all(
        [...new Set(ids)].map(async (id) => {
          const e = getEntry(id),
            was = e.snapshot.status === "running";
          if (!was)
            return {
              id,
              title: e.snapshot.title,
              status: e.snapshot.status,
              cancelled: false,
            };
          e.stopRequested = true;
          await abortable(
            Promise.race([
              e.child.interrupt().then(() => e.settled),
              new Promise<void>((r) => setTimeout(r, 5000)).then(async () => {
                if (e.snapshot.status === "running") {
                  await e.child.dispose();
                  settle(
                    e,
                    "cancelled",
                    e.snapshot.finalText,
                    "Interrupted (forced shutdown)",
                    "stopped",
                  );
                }
              }),
            ]).then(() => {}),
            signal,
          );
          return {
            id,
            title: e.snapshot.title,
            status: e.snapshot.status,
            cancelled: true,
          };
        }),
      );
    },
    async send(id, text) {
      if (disposed) throw new Error("Subagent manager disposed");
      const e = getEntry(id);
      const continuation = e.snapshot.status !== "running";
      if (continuation) {
        if (running() >= MAX_RUNNING)
          throw new ConcurrencyLimitError(
            `At most ${MAX_RUNNING} subagents may run at once`,
          );
        let resolve!: () => void;
        e.settled = new Promise<void>((r) => (resolve = r));
        e.resolve = resolve;
        e.snapshot.status = "running";
        e.snapshot.settledAt = undefined;
        e.snapshot.completionReason = undefined;
      }
      e.stopRequested = false;
      try {
        await e.child.send(text);
      } catch (error) {
        if (continuation)
          settle(
            e,
            "error",
            e.snapshot.finalText,
            errorMessage(error),
            "error",
          );
        throw error;
      }
    },
    get: (id) => view.get(id),
    list: () => view.list(),
    async disposeAll() {
      if (disposed) return;
      disposed = true;
      const tracked = [...entries.values()];
      entries.clear();
      listeners.clear();
      per.clear();
      await Promise.all(
        tracked.map(async (e) => {
          try {
            e.unsubscribe();
          } catch {}
          await tolerateWithin(() => e.child.interrupt(), 2000);
          await tolerateWithin(() => e.child.dispose(), 5000);
        }),
      );
    },
  };
  return api;
}
