import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import {
  ConcurrencyLimitError,
  formatExit,
  SpawnError,
  type TerminalSnapshot,
  UnknownTerminalError,
} from "./domain.ts";
import { OutputBuffer } from "./output.ts";

export const MAX_RUNNING = 8;
const OUTPUT_CAP = 2 * 1024 * 1024;
const FORCE_KILL_AFTER_MS = 2_500;

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
export interface TerminalReadModel {
  list(): ReadonlyArray<TerminalSnapshot>;
  get(id: string): TerminalSnapshot | undefined;
  size(): number;
  subscribe(listener: () => void): () => void;
  subscribeTo(id: string, listener: () => void): () => void;
  requestKill(id: string): void;
  setOnSettled(
    listener: (snapshot: TerminalSnapshot, consumed: boolean) => void,
  ): void;
}
export interface TerminalManagerShape {
  readonly view: TerminalReadModel;
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
}
interface Entry {
  id: string;
  command: string;
  title: string;
  cwd: string;
  child: ChildProcess;
  createdAt: number;
  settledAt?: number;
  exitCode?: number;
  signal?: string;
  status: TerminalSnapshot["status"];
  errorText?: string;
  stdout: OutputBuffer;
  stderr: OutputBuffer;
  killWaiters: number;
  settled: Promise<void>;
  resolveSettled: () => void;
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

export function createTerminalManager(): TerminalManagerShape {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const perTerminal = new Map<string, Set<() => void>>();
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
    pid: entry.child.pid,
    status: entry.status,
    createdAt: entry.createdAt,
    settledAt: entry.settledAt,
    exitCode: entry.exitCode,
    signal: entry.signal,
    errorText: entry.errorText,
    stdout: entry.stdout.view(),
    stderr: entry.stderr.view(),
  });
  const notify = (id: string) => {
    for (const listener of listeners) listener();
    for (const listener of perTerminal.get(id) ?? []) listener();
  };
  const settle = (
    entry: Entry,
    code: number | null,
    signal: NodeJS.Signals | null,
    error?: Error,
  ) => {
    if (entry.status !== "running") return;
    entry.settledAt = Date.now();
    entry.exitCode = code ?? undefined;
    entry.signal = signal ?? undefined;
    entry.errorText = error?.message;
    entry.status =
      entry.killWaiters > 0
        ? "killed"
        : error || code !== 0
          ? "failed"
          : "done";
    entry.resolveSettled();
    notify(entry.id);
    onSettled(snapshot(entry), entry.killWaiters > 0);
  };
  const terminate = async (entry: Entry) => {
    if (entry.status !== "running") return;
    signalTree(entry.child, "SIGTERM");
    await Promise.race([
      entry.settled,
      new Promise<void>((resolve) => setTimeout(resolve, FORCE_KILL_AFTER_MS)),
    ]);
    if (entry.status === "running") {
      signalTree(entry.child, "SIGKILL");
      await Promise.race([
        entry.settled,
        new Promise<void>((resolve) => setTimeout(resolve, 750)),
      ]);
    }
    if (entry.status === "running")
      settle(
        entry,
        null,
        "SIGKILL",
        new Error("Process did not report exit after SIGKILL"),
      );
  };

  const view: TerminalReadModel = {
    list: () => [...entries.values()].map(snapshot),
    get: (id) => {
      const entry = entries.get(id);
      return entry && snapshot(entry);
    },
    size: () => entries.size,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
    requestKill(id) {
      const entry = entries.get(id);
      if (entry) void terminate(entry);
    },
    setOnSettled(listener) {
      onSettled = listener;
    },
  };

  return {
    view,
    async start(options) {
      if (disposed) throw new SpawnError("Terminal manager is disposed");
      const running = [...entries.values()].filter(
        (entry) => entry.status === "running",
      ).length;
      if (running >= MAX_RUNNING)
        throw new ConcurrencyLimitError(
          `At most ${MAX_RUNNING} background terminals may run at once`,
        );
      const id = `bt-${++counter}`;
      let child: ChildProcess;
      try {
        child = spawn(options.command, {
          cwd: options.cwd,
          shell: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        throw new SpawnError(
          error instanceof Error ? error.message : String(error),
        );
      }
      let resolveSettled!: () => void;
      const entry: Entry = {
        id,
        ...options,
        child,
        createdAt: Date.now(),
        status: "running",
        stdout: new OutputBuffer(OUTPUT_CAP),
        stderr: new OutputBuffer(OUTPUT_CAP),
        killWaiters: 0,
        settled: new Promise((resolve) => {
          resolveSettled = resolve;
        }),
        resolveSettled: () => resolveSettled(),
      };
      entries.set(id, entry);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        entry.stdout.push(chunk);
        notify(id);
      });
      child.stderr?.on("data", (chunk: string) => {
        entry.stderr.push(chunk);
        notify(id);
      });
      child.once("error", (error) => settle(entry, null, null, error));
      child.once("close", (code, signal) => settle(entry, code, signal));
      notify(id);
      return snapshot(entry);
    },
    async status(id) {
      const entry = entries.get(id);
      if (!entry) throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
      return snapshot(entry);
    },
    async wait(id, timeoutMs, signal) {
      const entry = entries.get(id);
      if (!entry) throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
      if (entry.status !== "running")
        return { snapshot: snapshot(entry), completed: true };

      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;
      const interrupted = new Promise<"timeout" | "aborted">((resolve) => {
        if (timeoutMs !== undefined)
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
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
          if (!entry)
            throw new UnknownTerminalError(`Unknown terminal id "${id}"`);
          const wasRunning = entry.status === "running";
          if (wasRunning) {
            entry.killWaiters++;
            try {
              await terminate(entry);
            } finally {
              entry.killWaiters--;
            }
          }
          const snap = snapshot(entry);
          return {
            ...snap,
            killed: wasRunning && snap.status === "killed",
            wasRunning,
            exit: formatExit(snap),
          };
        }),
      );
    },
    async list() {
      return view.list();
    },
    async disposeAll() {
      disposed = true;
      await Promise.all([...entries.values()].map(terminate));
      listeners.clear();
      perTerminal.clear();
    },
  };
}
