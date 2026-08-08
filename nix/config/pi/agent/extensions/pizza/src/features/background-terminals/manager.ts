import { rmSync } from "node:fs";
import {
  ConcurrencyLimitError,
  formatExit,
  SpawnError,
  type TerminalSnapshot,
  UnknownTerminalError,
} from "./state.js";
import {
  spawnTerminalProcess,
  type TerminalProcess,
  type TerminalProcessOptions,
  type ProcessExit,
} from "./process-runner.js";

export const MAX_RUNNING = 8;
/** Settled terminals retained for inspection. Running terminals are never pruned. */
export const MAX_SETTLED_HISTORY = 100;

export interface TerminalManagerOptions
  extends Pick<
    TerminalProcessOptions,
    | "createLogStream"
    | "logCloseTimeoutMs"
    | "terminateGraceMs"
    | "killConfirmationMs"
  > {}

export interface StartOptions {
  command: string;
  title: string;
  cwd: string;
}

export interface KillResult {
  readonly id: string;
  readonly title: string;
  readonly status: TerminalSnapshot["status"];
  readonly killed: boolean;
  readonly wasRunning: boolean;
  readonly exit: string;
}

/** Read-only terminal state and subscriptions. */
export interface TerminalReadModel {
  list(): ReadonlyArray<TerminalSnapshot>;
  get(id: string): TerminalSnapshot | undefined;
  size(): number;
  runningCount(): number;
  /** Lifecycle/history changes only; output chunks use subscribeTo. */
  subscribe(listener: () => void): () => void;
  subscribeOutput(listener: () => void): () => void;
  subscribeTo(id: string, listener: () => void): () => void;
}

/** UI commands are explicit; they are not hidden behind the query port. */
export interface TerminalCommandPort {
  requestKill(id: string): void;
}

export interface TerminalManagerShape {
  readonly view: TerminalReadModel;
  readonly commands: TerminalCommandPort;
  start(options: StartOptions): Promise<TerminalSnapshot>;
  status(id: string): Promise<TerminalSnapshot>;
  wait(
    id: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<{ snapshot: TerminalSnapshot; completed: boolean }>;
  kill(ids: ReadonlyArray<string>): Promise<ReadonlyArray<KillResult>>;
  list(): Promise<ReadonlyArray<TerminalSnapshot>>;
  disposeAll(): Promise<void>;
  setOnSettled(
    listener: (snapshot: TerminalSnapshot, consumed: boolean) => void,
  ): void;
}

interface Entry {
  id: string;
  command: string;
  title: string;
  cwd: string;
  process: TerminalProcess;
  createdAt: number;
  settledAt?: number;
  exitCode?: number;
  signal?: string;
  status: TerminalSnapshot["status"];
  errorText?: string;
  terminationRequested: boolean;
  settlementConsumed: boolean;
  settling: boolean;
  settled: Promise<void>;
  resolveSettled: () => void;
  unsubscribeOutput: () => void;
  unsubscribeExit: () => void;
}

export function createTerminalManager(
  managerOptions: TerminalManagerOptions = {},
): TerminalManagerShape {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const outputListeners = new Set<() => void>();
  const perTerminal = new Map<string, Set<() => void>>();
  // A deferred settlement can outlive its history entry. Retired spill
  // directories therefore remain session-scoped until manager disposal.
  const retiredLogDirs = new Set<string>();
  let counter = 0;
  let disposed = false;
  let onSettled: (
    snapshot: TerminalSnapshot,
    consumed: boolean,
  ) => void = () => {};

  const snapshot = (entry: Entry): TerminalSnapshot => ({
    id: entry.id,
    command: entry.command,
    title: entry.title,
    cwd: entry.cwd,
    pid: entry.process.pid,
    status: entry.status,
    createdAt: entry.createdAt,
    settledAt: entry.settledAt,
    exitCode: entry.exitCode,
    signal: entry.signal,
    errorText: entry.errorText,
    stdout: entry.process.stdout.view(),
    stderr: entry.process.stderr.view(),
  });

  const notifyLifecycle = () => {
    for (const listener of listeners) listener();
  };
  const notifyOutput = (id: string) => {
    for (const listener of outputListeners) listener();
    for (const listener of perTerminal.get(id) ?? []) listener();
  };

  const cleanupEntry = (entry: Entry, retainLogDir = false) => {
    entry.unsubscribeOutput();
    entry.unsubscribeExit();
    perTerminal.delete(entry.id);
    const retiredLogDir = entry.process.dispose({ retainLogDir });
    if (retiredLogDir) retiredLogDirs.add(retiredLogDir);
  };

  const prune = () => {
    const settled = [...entries.values()]
      .filter((entry) => entry.status !== "running")
      .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
    while (settled.length > MAX_SETTLED_HISTORY) {
      const entry = settled.shift()!;
      entries.delete(entry.id);
      cleanupEntry(entry, true);
    }
  };

  const settle = (entry: Entry, exit: ProcessExit) => {
    if (entry.status !== "running" || entry.settling) return;
    entry.settling = true;
    entry.settledAt = Date.now();
    entry.exitCode = exit.code ?? undefined;
    entry.signal = exit.signal ?? undefined;
    entry.errorText = exit.error?.message;
    entry.status =
      exit.error ||
      (exit.signal &&
        !(
          entry.terminationRequested &&
          (exit.signal === "SIGTERM" || exit.signal === "SIGKILL")
        )) ||
      (exit.code !== null && exit.code !== 0)
        ? "failed"
        : exit.signal
          ? "killed"
          : "done";
    entry.resolveSettled();
    notifyLifecycle();
    notifyOutput(entry.id);
    onSettled(snapshot(entry), entry.settlementConsumed);
    prune();
  };

  const terminate = async (entry: Entry, consume = false) => {
    if (entry.status !== "running") return;
    entry.terminationRequested = true;
    if (consume) entry.settlementConsumed = true;
    await entry.process.terminate();
    // ProcessRunner normally emits exit before terminate resolves. The short
    // fallback covers a platform that reports close on the next event turn.
    if (entry.status === "running") {
      await Promise.race([
        entry.settled,
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  };

  const view: TerminalReadModel = {
    list: () => [...entries.values()].map(snapshot),
    get: (id) => {
      const entry = entries.get(id);
      return entry && snapshot(entry);
    },
    size: () => entries.size,
    runningCount: () =>
      [...entries.values()].reduce(
        (count, entry) => count + (entry.status === "running" ? 1 : 0),
        0,
      ),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    subscribeTo(id, listener) {
      const set = perTerminal.get(id) ?? new Set<() => void>();
      set.add(listener);
      perTerminal.set(id, set);
      return () => {
        set.delete(listener);
        if (!set.size) perTerminal.delete(id);
      };
    },
  };

  const commands: TerminalCommandPort = {
    requestKill(id) {
      const entry = entries.get(id);
      if (entry) {
        void terminate(entry).catch((error) => {
          console.error(`background-terminals: failed to kill ${id}`, error);
        });
      }
    },
  };

  const api: TerminalManagerShape = {
    view,
    commands,
    setOnSettled(listener) {
      onSettled = listener;
    },
    async start(options) {
      if (disposed) throw new SpawnError("Terminal manager is disposed");
      if (view.runningCount() >= MAX_RUNNING) {
        throw new ConcurrencyLimitError(
          `At most ${MAX_RUNNING} background terminals can run at once`,
        );
      }
      const id = `bt-${++counter}`;
      let processHandle: TerminalProcess;
      try {
        processHandle = spawnTerminalProcess({
          ...options,
          ...managerOptions,
          id,
        });
      } catch (error) {
        throw new SpawnError(error instanceof Error ? error.message : String(error));
      }

      let resolveSettled!: () => void;
      const entry: Entry = {
        id,
        ...options,
        process: processHandle,
        createdAt: Date.now(),
        status: "running",
        terminationRequested: false,
        settlementConsumed: false,
        settling: false,
        settled: new Promise((resolve) => {
          resolveSettled = resolve;
        }),
        resolveSettled: () => resolveSettled(),
        unsubscribeOutput: () => {},
        unsubscribeExit: () => {},
      };
      entry.unsubscribeOutput = processHandle.onOutput(() => notifyOutput(id));
      entry.unsubscribeExit = processHandle.onExit((exit) => settle(entry, exit));
      entries.set(id, entry);
      notifyLifecycle();
      return snapshot(entry);
    },
    async status(id) {
      const entry = entries.get(id);
      if (!entry) {
        throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
      }
      return snapshot(entry);
    },
    async wait(id, timeoutMs, signal) {
      const entry = entries.get(id);
      if (!entry) {
        throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
      }
      if (entry.status !== "running") {
        return { snapshot: snapshot(entry), completed: true };
      }

      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;
      const interrupted = new Promise<"timeout" | "aborted">((resolve) => {
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }
        if (signal) {
          onAbort = () => resolve("aborted");
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      const outcome = await Promise.race([
        entry.settled.then(() => "settled" as const),
        interrupted,
      ]);
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (outcome === "aborted") throw new Error("Wait aborted.");
      return {
        snapshot: snapshot(entry),
        completed: outcome === "settled" || entry.status !== "running",
      };
    },
    async kill(ids) {
      return Promise.all(
        ids.map(async (id) => {
          const entry = entries.get(id);
          if (!entry) {
            throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
          }
          const wasRunning = entry.status === "running";
          if (wasRunning) await terminate(entry, true);
          const current = snapshot(entry);
          return {
            id: current.id,
            title: current.title,
            status: current.status,
            killed: wasRunning && current.status === "killed",
            wasRunning,
            exit: formatExit(current),
          };
        }),
      );
    },
    async list() {
      return view.list();
    },
    async disposeAll() {
      if (disposed) return;
      disposed = true;
      await Promise.all(
        [...entries.values()]
          .filter((entry) => entry.status === "running")
          .map((entry) => terminate(entry)),
      );
      for (const entry of entries.values()) cleanupEntry(entry);
      entries.clear();
      for (const logDir of retiredLogDirs) {
        try {
          rmSync(logDir, { recursive: true, force: true });
        } catch {
          // Cleanup is best effort during session teardown.
        }
      }
      retiredLogDirs.clear();
      listeners.clear();
      outputListeners.clear();
      perTerminal.clear();
    },
  };

  return api;
}
