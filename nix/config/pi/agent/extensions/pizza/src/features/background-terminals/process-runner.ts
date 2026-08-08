import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Writable } from "node:stream";
import { OutputBuffer } from "./output-buffer.js";

const OUTPUT_CAP = 2 * 1024 * 1024;
const FORCE_KILL_AFTER_MS = 2_500;
const LOG_CLOSE_AFTER_MS = 5_000;

export interface TerminalProcessOptions {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  /** Test/integration seam; production uses createWriteStream. */
  readonly createLogStream?: (path: string, stream: "stdout" | "stderr") => Writable;
  readonly logCloseTimeoutMs?: number;
  /** Test seams for process-exit escalation; production uses fixed defaults. */
  readonly terminateGraceMs?: number;
  readonly killConfirmationMs?: number;
}

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

export interface TerminalProcessDisposeOptions {
  /** Keep the closed log directory for the manager's retired-log set. */
  readonly retainLogDir?: boolean;
}

export interface TerminalProcess {
  readonly pid?: number;
  readonly stdout: OutputBuffer;
  readonly stderr: OutputBuffer;
  onOutput(listener: (stream: "stdout" | "stderr") => void): () => void;
  onExit(listener: (exit: ProcessExit) => void): () => void;
  terminate(): Promise<void>;
  /** Returns a retained log directory only when retainLogDir is requested. */
  dispose(options?: TerminalProcessDisposeOptions): string | undefined;
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between the two kill attempts.
    }
  }
}

function closeLog(
  stream: Writable,
  unavailable: () => void,
  timeoutMs: number,
): Promise<void> {
  if (stream.closed) return Promise.resolve();
  if (stream.destroyed) {
    unavailable();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    let complete = false;
    const done = (failed = false) => {
      if (complete) return;
      complete = true;
      if (timer) clearTimeout(timer);
      stream.off("close", onClose);
      stream.off("error", onError);
      if (failed) unavailable();
      resolve();
    };
    const onClose = () => done();
    const onError = () => done(true);
    stream.once("close", onClose);
    stream.once("error", onError);
    timer = setTimeout(() => {
      unavailable();
      stream.destroy();
      done(true);
    }, timeoutMs);
    try {
      stream.end();
    } catch {
      stream.destroy();
      done(true);
    }
  });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Owns child_process and log-spill mechanics. The feature manager only folds
 * its exit/output notifications into bounded terminal state.
 */
export function spawnTerminalProcess(
  options: TerminalProcessOptions,
): TerminalProcess {
  let child: ChildProcess;
  try {
    child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const outputListeners = new Set<(stream: "stdout" | "stderr") => void>();
  const exitListeners = new Set<(exit: ProcessExit) => void>();
  let logDir: string | undefined;
  try {
    logDir = mkdtempSync(join(tmpdir(), `pi-background-${options.id}-`));
  } catch {
    // In-memory output remains useful when a temp directory is unavailable.
  }

  const logStreams: Array<{ stream: Writable; buffer: OutputBuffer }> = [];
  const makeBuffer = (
    name: "stdout" | "stderr",
    source: NodeJS.ReadableStream | null,
  ) => {
    let writer: Writable | undefined;
    const buffer = new OutputBuffer(OUTPUT_CAP, (chunk) => {
      if (!writer || writer.destroyed || writer.closed) return true;
      try {
        const accepted = writer.write(chunk);
        if (!accepted && source && "pause" in source) {
          source.pause();
          writer.once("drain", () => {
            if (!writer?.destroyed && "resume" in source) source.resume();
          });
        }
        return accepted;
      } catch {
        buffer.spillPath = undefined;
        if (source && "resume" in source) source.resume();
        return true;
      }
    });

    if (logDir) {
      const file = join(logDir, `${name}.log`);
      try {
        writer =
          options.createLogStream?.(file, name) ??
          createWriteStream(file, { encoding: "utf8" });
        logStreams.push({ stream: writer, buffer });
        buffer.spillPath = file;
        writer.on("error", () => {
          buffer.spillPath = undefined;
          if (source && "resume" in source) source.resume();
        });
      } catch {
        buffer.spillPath = undefined;
      }
    }
    return buffer;
  };

  const stdout = makeBuffer("stdout", child.stdout);
  const stderr = makeBuffer("stderr", child.stderr);
  let resolveProcessExit!: () => void;
  const processExitPromise = new Promise<void>((resolve) => {
    resolveProcessExit = resolve;
  });
  const exitPromise = new Promise<void>((resolve) => {
    let settled = false;
    let pendingError: Error | undefined;
    const finish = async (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      pendingError = error ?? pendingError;
      // Termination escalation follows the OS process, not potentially slow
      // spill-log finalization. Manager settlement still waits for closed logs.
      resolveProcessExit();
      await Promise.all(
        logStreams.map(({ stream, buffer }) =>
          closeLog(
            stream,
            () => {
              buffer.spillPath = undefined;
            },
            options.logCloseTimeoutMs ?? LOG_CLOSE_AFTER_MS,
          ),
        ),
      );
      const exit: ProcessExit = {
        code,
        signal,
        ...(pendingError ? { error: pendingError } : {}),
      };
      resolve();
      for (const listener of exitListeners) listener(exit);
    };

    child.once("error", (error) => {
      void finish(null, null, error);
    });
    child.once("close", (code, signal) => {
      void finish(code, signal);
    });
  });

  const emitOutput = (stream: "stdout" | "stderr") => {
    for (const listener of outputListeners) listener(stream);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout.push(chunk);
    emitOutput("stdout");
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr.push(chunk);
    emitOutput("stderr");
  });

  let terminated = false;
  return {
    pid: child.pid,
    stdout,
    stderr,
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    async terminate() {
      if (terminated) {
        await exitPromise;
        return;
      }
      terminated = true;
      signalTree(child, "SIGTERM");
      const termRace = await Promise.race([
        processExitPromise.then(() => true),
        wait(options.terminateGraceMs ?? FORCE_KILL_AFTER_MS).then(() => false),
      ]);
      if (termRace) {
        await exitPromise;
        return;
      }

      signalTree(child, "SIGKILL");
      const killRace = await Promise.race([
        processExitPromise.then(() => true),
        wait(options.killConfirmationMs ?? 750).then(() => false),
      ]);
      if (killRace) {
        await exitPromise;
        return;
      }
      // The manager will classify this as a failed forced termination when
      // the platform never emits close after SIGKILL.
      for (const listener of exitListeners) {
        listener({
          code: null,
          signal: "SIGKILL",
          error: new Error("Process did not report exit after SIGKILL"),
        });
      }
    },
    dispose(options = {}) {
      const retainedLogDir = options.retainLogDir ? logDir : undefined;
      if (retainedLogDir) logDir = undefined;
      for (const { stream } of logStreams) {
        if (!stream.closed) stream.destroy();
      }
      if (logDir) {
        try {
          rmSync(logDir, { recursive: true, force: true });
        } catch {
          // Cleanup is best effort during session teardown.
        }
      }
      outputListeners.clear();
      exitListeners.clear();
      return retainedLogDir;
    },
  };
}
