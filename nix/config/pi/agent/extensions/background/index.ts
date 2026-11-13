/**
 * background: a native tool for long-running, non-interactive commands.
 *
 * Each Pi process owns one state directory, /tmp/pi-bg/<pid>-<rand>, kept on globalThis so it
 * survives /reload. A job is <name>.pid, <name>.log, <name>.exit (written by the job's own shell
 * wrapper, so it is recorded even if Pi dies) and <name>.json (metadata). The layout matches
 * bg.sh, so `PI_BG_DIR=<dir> ./bg.sh status <name>` works on jobs that outlive Pi.
 *
 * Lifecycle: jobs survive reload and fork. Non-persistent jobs are stopped on quit and when
 * switching to a new or resumed session. Directories left behind by a Pi that died without
 * cleaning up are swept on the next session start.
 *
 * Initial wait: start with wait: seconds reuses the wait path for exit or an until regex.
 * No wait means immediate return; timeout/cancellation leaves the job running. Successful
 * initial waits include bounded output by default; action: wait remains quiet unless lines is set.
 *
 * Restart: name only, no overrides. Validate saved launch settings before stopping the old run,
 * then reuse command, cwd, persist, notify, wait, until and lines. Logs and question relay state
 * are reset. The new process inherits the current environment, not an environment snapshot.
 *
 * Notifications: jobs started with notify: true post a message when they exit, steering the current
 * turn or waking an idle agent. A <name>.notified marker means the exit was already reported (by
 * a notification, or by wait/status/stop), so the agent never hears about it twice.
 *
 * Questions: direct, non-persistent children of an interactive Pi may call the questionnaire tool;
 * it is relayed through a file mailbox (see ask.ts). The parent only shows a passive notification
 * and a footer count; the user answers with /bg_questions. Nothing reaches the parent model's
 * context, except that `wait` returns early while any job has a pending question.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { askQuestionnaire } from "../questionnaire/index.js";
import * as ask from "./ask.js";
import { duration } from "../lib/duration.js";
import * as rex from "../lib/rex.js";
import { formatLog } from "./format-log.js";
import { JobList, sortJobs } from "./job-list.js";
import { JobPopup } from "./job-popup.js";

// macOS gives each user a private TMPDIR. Linux usually shares /tmp, so add the
// uid: the first account to make /tmp/pi-bg would lock the others out (EACCES).
const ROOT = path.join(
  process.env.TMPDIR || os.tmpdir(),
  process.env.TMPDIR || typeof process.getuid !== "function" ? "pi-bg" : `pi-bg-${process.getuid()}`,
);
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FAIL_LINES = 20;
const TIMEOUT_LINES = 10;
const MAX_LINES = 100;
const MAX_BYTES = 8 * 1024;
const STOP_GRACE_MS = 3000;
const STALE_MS = 24 * 60 * 60 * 1000;

interface Meta {
  command: string;
  cwd: string;
  persist: boolean;
  notify?: boolean;
  wait?: number;
  until?: string;
  lines?: number;
  startedAt: number;
}

type State =
  | { kind: "running"; pid: number }
  | { kind: "exited"; code: number }
  | { kind: "stopped" };

// ---------- state directory ----------

const g = globalThis as { __piBackgroundDir?: string };

function stateDir(): string {
  if (!g.__piBackgroundDir) {
    g.__piBackgroundDir = path.join(ROOT, `${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  }
  fs.mkdirSync(g.__piBackgroundDir, { recursive: true });
  fs.writeFileSync(path.join(g.__piBackgroundDir, "owner"), String(process.pid));
  return g.__piBackgroundDir;
}

const file = (dir: string, name: string, ext: string) => path.join(dir, `${name}.${ext}`);

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return undefined;
  }
}

function alive(pid: number, group = false): boolean {
  try {
    process.kill(group ? -pid : pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readMeta(dir: string, name: string): Meta | undefined {
  const raw = readText(file(dir, name, "json"));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Meta;
  } catch {
    return undefined;
  }
}

function jobState(dir: string, name: string): State {
  const exit = readText(file(dir, name, "exit"));
  if (exit !== undefined && exit !== "") return { kind: "exited", code: Number(exit) };
  const pid = Number(readText(file(dir, name, "pid")));
  if (pid > 0 && alive(pid)) return { kind: "running", pid };
  return { kind: "stopped" };
}

function jobNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".pid"))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

const exists = (dir: string, name: string) => fs.existsSync(file(dir, name, "pid"));

// ---------- process control ----------

function startJob(
  dir: string,
  name: string,
  command: string,
  cwd: string,
  persist: boolean,
  notify: boolean,
  relay: Record<string, string | undefined> = {},
  initialWait: Pick<Meta, "wait" | "until" | "lines"> = {},
): number {
  for (const ext of ["exit", "log", "notified"]) fs.rmSync(file(dir, name, ext), { force: true });
  const log = fs.openSync(file(dir, name, "log"), "a");
  try {
    const child = spawn("bash", ["-c", '(eval "$1"); echo $? > "$2"', "_", command, file(dir, name, "exit")], {
      cwd,
      detached: true, // own process group, so stop reaches children
      stdio: ["ignore", log, log],
      env: Object.fromEntries(
        Object.entries({ ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", PI_BG_JOB: name, ...relay }).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ),
    });
    if (!child.pid) throw new Error(`failed to start ${name}`);
    child.on("error", () => {});
    child.unref();
    fs.writeFileSync(file(dir, name, "pid"), String(child.pid));
    const meta: Meta = { command, cwd, persist, notify, ...initialWait, startedAt: Date.now() };
    fs.writeFileSync(file(dir, name, "json"), JSON.stringify(meta));
    return child.pid;
  } finally {
    fs.closeSync(log);
  }
}

function signalGroup(pid: number, sig: NodeJS.Signals) {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {}
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TERM the process groups, then KILL whatever is left after the grace period. */
async function stopPids(pids: number[]): Promise<"stopped" | "killed"> {
  const live = pids.filter((p) => alive(p, true));
  if (!live.length) return "stopped";
  for (const p of live) signalGroup(p, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!live.some((p) => alive(p, true))) return "stopped";
    await sleep(100);
  }
  for (const p of live) signalGroup(p, "SIGKILL");
  return "killed";
}

/** Process groups of non-persistent jobs in dir that are still running. */
function ownedPids(dir: string): number[] {
  return jobNames(dir)
    .filter((n) => !readMeta(dir, n)?.persist)
    .map((n) => Number(readText(file(dir, n, "pid"))))
    .filter((p) => p > 0 && alive(p, true));
}

/** Stop jobs left by Pi processes that died without cleaning up; drop stale dirs. */
async function sweepOrphans(own: string) {
  let entries: string[];
  try {
    entries = fs.readdirSync(ROOT);
  } catch {
    return;
  }
  const pids: number[] = [];
  for (const entry of entries) {
    const dir = path.join(ROOT, entry);
    if (dir === own) continue;
    const owner = Number(readText(path.join(dir, "owner")));
    if (!owner || alive(owner)) continue;
    pids.push(...ownedPids(dir));
    const running = jobNames(dir).some((n) => jobState(dir, n).kind === "running");
    try {
      if (!running && Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  if (pids.length) await stopPids(pids);
}

// ---------- output ----------

function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .split("\n")
    .map((l) => {
      const parts = l.replace(/\r$/, "").split("\r");
      return parts[parts.length - 1];
    })
    .join("\n");
}

/** Last `lines` lines of the log, read from the end of the file and capped at MAX_BYTES. */
function tail(logPath: string, lines: number, readable = false): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(logPath, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let out = clean(buf.toString("utf8")).replace(/\n+$/, "").split("\n");
    if (len < size) out = out.slice(1);
    if (readable) out = formatLog(out.join("\n")).split("\n");
    let text = out.slice(-lines).join("\n");
    if (Buffer.byteLength(text) > MAX_BYTES) {
      text = Buffer.from(text).subarray(-MAX_BYTES).toString("utf8");
      text = `[…truncated]\n${text.slice(text.indexOf("\n") + 1)}`;
    }
    return text.trim() ? text : "(no output)";
  } catch {
    return "(no output)";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function describe(dir: string, name: string): string {
  const st = jobState(dir, name);
  const meta = readMeta(dir, name);
  const age = meta ? `, ${duration(Date.now() - meta.startedAt)}` : "";
  const persist = meta?.persist ? ", persistent" : "";
  if (st.kind === "running") return `${name}: running (pid ${st.pid}${age}${persist})`;
  if (st.kind === "exited") return `${name}: exited ${st.code}`;
  return `${name}: stopped`;
}

function withTail(head: string, logPath: string, lines: number): string {
  return `${head}\n${tail(logPath, lines)}\nLog: ${logPath}`;
}

// ---------- tool ----------

const Params = Type.Object({
  action: StringEnum(["start", "restart", "status", "wait", "stop"] as const, {
    description: "restart: by name, saved settings, no overrides; status: all when name is omitted; wait: for exit or until",
  }),
  name: Type.Optional(Type.String({ description: "Job label: letters, digits, . _ -" })),
  command: Type.Optional(Type.String({ description: "start: bash -c command" })),
  cwd: Type.Optional(Type.String({ description: "start: default current" })),
  persist: Type.Optional(Type.Boolean({ description: "start: outlive Pi" })),
  notify: Type.Optional(Type.Boolean({ description: "start: message when it exits" })),
  wait: Type.Optional(Type.Number({ minimum: 0, description: "start: wait up to N s for exit or until" })),
  until: Type.Optional(Type.String({ description: "regex; return when a log line matches" })),
  timeout: Type.Optional(Type.Number({ description: "wait: seconds (default 60 with until, else 300)" })),
  lines: Type.Optional(Type.Number({ description: `log lines to include (max ${MAX_LINES})` })),
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }], details: undefined };
}

const FORMATTER = path.join(path.dirname(new URL(import.meta.url).pathname), "format-log-cli.ts");

/** Opens (or raises) a Rex float that follows the job's log. Scroll and search with Rex; Ctrl+C closes it. */
async function openFloat(dir: string, name: string) {
  const label = `bg:${name}`;
  const window = await rex.windowOf(rex.REX_BLOCK!);
  const view = await rex.call("session.view");
  for (const w of view?.windows ?? []) {
    for (const layer of w.layers ?? []) {
      if (layer.kind !== "tiled" && layer.blocks?.some((b: any) => b.label === label)) {
        await rex.call("session.set_layer_state", { layer_id: layer.layer_id, state: "normal", focus: true });
        return;
      }
    }
  }
  const meta = readMeta(dir, name);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const header = [`${name}`, meta ? `Command: ${meta.command}` : "", meta ? `Cwd: ${meta.cwd}` : "", `Log: ${file(dir, name, "log")}`, ""]
    .filter((l, i, a) => l || i === a.length - 1)
    .join("\n");
  const script =
    `trap 'exit 0' INT; printf '%s\\n' ${q(header)} ${q("(following; Ctrl+C closes this float, the job keeps running)")} ''; ` +
    `tail -n +1 -F ${q(file(dir, name, "log"))} 2>/dev/null | bun ${q(FORMATTER)}`;
  await rex.call("session.new_layer", {
    ...(window ? { window_id: window } : {}),
    bounds: [0.08, 0.08, 0.84, 0.84],
    focus: true,
    layout: { block: { flavor: "com.superlogical.terminal.shell", label, options: {
      command: ["sh", "-c", script],
      cwd: meta?.cwd ?? process.cwd(),
      exit: { on_completion: true, quick_exit_threshold_ms: 0 },
    } } },
  });
}

/** True when job is running and pid is in its process group (so the request really comes from it). */
function ownsRequest(dir: string, job: string, pid: number): boolean {
  if (!NAME_RE.test(job) || !exists(dir, job)) return false;
  const st = jobState(dir, job);
  if (st.kind !== "running") return false;
  const pgrp = ask.processGroup(pid);
  return pgrp === undefined ? process.platform !== "linux" : pgrp === st.pid;
}

function pendingQuestions(dir: string | undefined): ask.PendingRequest[] {
  if (!dir) return [];
  return ask.listPending(ask.askDirOf(dir), (job, pid) => ownsRequest(dir, job, pid));
}

/** Env telling a new job whether (and where) it may relay questions. */
function relayFor(dir: string, name: string, persist: boolean, mode: ExtensionContext["mode"]) {
  const inherited = process.env[ask.ENV_UNAVAILABLE];
  if (inherited) return ask.relayEnv({ reason: inherited }); // we are a relaying child ourselves
  if (persist) return ask.relayEnv({ reason: "persistent background jobs cannot ask the user (they may outlive Pi)" });
  if (mode !== "tui") return ask.relayEnv({ reason: "the parent Pi is not interactive, so nobody can answer" });
  try {
    return ask.relayEnv({ dir: ask.ensureAskDir(dir), job: name });
  } catch (e) {
    return ask.relayEnv({ reason: `question mailbox unavailable: ${(e as Error).message}` });
  }
}

function questionsNote(pending: ask.PendingRequest[]): string {
  const jobs = [...new Set(pending.map((r) => r.job))].join(", ");
  return `background job(s) ${jobs} are waiting for the user to answer a question in /bg_questions`;
}

export default function (pi: ExtensionAPI) {
  let ctxRef: ExtensionContext | undefined;
  // Runs only while there is something to watch: a running job, or an exit not yet reported.
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticks = 0;
  const waiting = new Set<string>();
  let pendingCount = 0;
  let questionAttention = false;
  const setQuestionAttention = (active: boolean) => {
    if (active === questionAttention) return;
    questionAttention = active;
    // One balanced signal for the entire queue, not one per request or scan.
    pi.events.emit("herdr:blocked", {
      active,
      label: "Background question waiting — /bg_questions",
    });
  };
  ask.captureRelay(); // if we are a relaying child, our own jobs must not relay

  /** Announce new questions once (UI only) and keep the footer count current. */
  const checkQuestions = () => {
    const ctx = ctxRef;
    if (!ctx) return;
    const pending = pendingQuestions(g.__piBackgroundDir);
    setQuestionAttention(ctx.mode === "tui" && pending.length > 0);
    for (const req of pending) {
      if (!ask.markAnnounced(req)) continue;
      try {
        ctx.ui.notify(`Background job "${req.job}" has a question. Answer with /bg_questions.`, "info");
      } catch {}
    }
    if (pending.length !== pendingCount) {
      pendingCount = pending.length;
      refreshStatus();
    }
  };

  const markReported = (dir: string, name: string) => {
    if (jobState(dir, name).kind === "running") return;
    try {
      fs.writeFileSync(file(dir, name, "notified"), "");
    } catch {}
  };

  const checkNotify = () => {
    const dir = g.__piBackgroundDir;
    if (!dir || !ctxRef) return;
    checkQuestions();
    for (const name of jobNames(dir)) {
      if (waiting.has(name) || !readMeta(dir, name)?.notify) continue;
      if (fs.existsSync(file(dir, name, "notified"))) continue;
      const st = jobState(dir, name);
      if (st.kind === "running") continue;
      markReported(dir, name);
      const logPath = file(dir, name, "log");
      const head = `Background job finished: ${describe(dir, name)}`;
      const body =
        st.kind === "exited" && st.code === 0
          ? `${head}. Log: ${logPath} (background status lines=N to read output)`
          : withTail(head, logPath, FAIL_LINES);
      try {
        pi.sendMessage(
          { customType: "background-done", content: body, display: true, details: { name, state: st } },
          { triggerTurn: true, deliverAs: "steer" },
        );
      } catch {}
      refreshStatus();
    }
  };

  const refreshStatus = () => {
    const ctx = ctxRef;
    if (!ctx?.hasUI || !g.__piBackgroundDir) return;
    const dir = g.__piBackgroundDir;
    const running = jobNames(dir).filter((n) => jobState(dir, n).kind === "running");
    const fg = (color: "dim" | "warning", text: string) => ctx.ui.theme.fg(color, text);
    const parts: string[] = [];
    if (running.length) parts.push(fg("dim", `↻ ${running.length} job${running.length === 1 ? "" : "s"}`));
    if (pendingCount) {
      parts.push(fg("warning", `? ${pendingCount} question${pendingCount === 1 ? "" : "s"}`) + fg("dim", " /bg_questions"));
    }
    try {
      ctx.ui.setStatus("background", parts.length ? parts.join(fg("dim", " · ")) : undefined);
    } catch {}
  };

  // Running jobs, for the editor's statusline (see agent-bridge/core.ts).
  let busyCount = -1;
  const emitBusy = (force = false) => {
    const dir = g.__piBackgroundDir;
    const n = dir ? jobNames(dir).filter((name) => jobState(dir, name).kind === "running").length : 0;
    if (n === busyCount && !force) return;
    busyCount = n;
    pi.events.emit("bridge:busy", { source: "background", count: n });
  };

  /** Whether a job still needs the timer: it runs, or its exit is unreported. */
  const needsWatch = (dir: string) =>
    jobNames(dir).some((n) =>
      jobState(dir, n).kind === "running" || (!!readMeta(dir, n)?.notify && !fs.existsSync(file(dir, n, "notified"))),
    );

  const disarm = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  /** Checks exits and questions every second, and the footer every 5 s, until nothing needs it. */
  const arm = () => {
    if (timer || !ctxRef) return;
    ticks = 0;
    timer = setInterval(() => {
      const dir = g.__piBackgroundDir;
      checkNotify();
      emitBusy();
      if (++ticks % 5 === 0) refreshStatus();
      if (!dir || (!needsWatch(dir) && !pendingCount)) {
        disarm();
        refreshStatus();
      }
    }, 1000);
    timer.unref?.();
  };

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    const dir = stateDir();
    refreshStatus();
    emitBusy(true);
    if (needsWatch(dir)) arm(); // jobs kept across /reload
    void sweepOrphans(dir).catch(() => {});
  });

  pi.on("session_shutdown", async (event) => {
    disarm();
    setQuestionAttention(false);
    ctxRef = undefined;
    pendingCount = 0;
    if (event.reason === "reload" || event.reason === "fork") return;
    const dir = g.__piBackgroundDir;
    if (!dir) return;
    // Withdraw questions first so children fail fast instead of waiting for a dead UI.
    ask.clearAll(ask.askDirOf(dir));
    await stopPids(ownedPids(dir));
  });

  pi.registerCommand("bg_questions", {
    description: "Answer questions from background jobs (UI only)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/bg_questions requires the interactive TUI.", "error");
        return;
      }
      const dir = g.__piBackgroundDir;
      const pending = pendingQuestions(dir);
      if (!dir || !pending.length) {
        ctx.ui.notify("No pending background questions.", "info");
        return;
      }
      const choices = pending.map((r, i) => {
        const more = r.questions.length > 1 ? ` (+${r.questions.length - 1} more)` : "";
        return `${i + 1}. [${r.job}] ${ask.oneLine(r.questions[0].prompt, 100)}${more}`;
      });
      const selected = await ctx.ui.select("Background questions", choices);
      if (selected === undefined) return;
      const req = pending[choices.indexOf(selected)];
      if (!req) return;

      // Close the popup if the request disappears (child gave up, job stopped).
      const gone = new AbortController();
      const watch = setInterval(() => {
        if (!ask.isPending(req) || !ownsRequest(dir, req.job, req.pid)) gone.abort();
      }, 500);
      try {
        if (!ask.isPending(req)) gone.abort();
        const asked = await askQuestionnaire(ctx, req.questions, gone.signal, { overlay: true });
        if (gone.signal.aborted) {
          ctx.ui.notify(`The question from "${req.job}" is no longer pending.`, "warning");
        } else if (!asked.ok) {
          ctx.ui.notify(asked.error, "error");
        } else if (asked.result.cancelled) {
          ctx.ui.notify(`Question from "${req.job}" left pending.`, "info");
        } else {
          if (!ownsRequest(dir, req.job, req.pid)) throw new Error(`job "${req.job}" is no longer running`);
          ask.writeAnswer(req, asked.result.answers);
          ctx.ui.notify(`Answer sent to "${req.job}".`, "info");
        }
      } catch (e) {
        ctx.ui.notify(`Could not answer "${req.job}": ${(e as Error).message}`, "error");
      } finally {
        clearInterval(watch);
        checkQuestions();
      }
    },
  });

  pi.registerCommand("bg", {
    description: "List running background jobs",
    handler: async (_args, ctx) => {
      const dir = g.__piBackgroundDir;
      const running = dir ? jobNames(dir).filter((name) => jobState(dir, name).kind === "running") : [];
      ctx.ui.notify(
        dir && running.length ? running.map((name) => describe(dir, name)).join("\n") : "No background jobs running.",
        "info",
      );
    },
  });

  pi.registerCommand("bg_status", {
    description: "Inspect a background job's status and live output (UI only)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/bg_status requires the terminal UI.", "warning");
        return;
      }
      const dir = g.__piBackgroundDir;
      const names = dir ? jobNames(dir) : [];
      if (!dir || !names.length) {
        ctx.ui.notify("No background jobs.", "info");
        return;
      }
      let name: string | undefined = args.trim();
      if (!name) {
        const items = sortJobs(
          names.map((n) => {
            const meta = readMeta(dir, n);
            const label = describe(dir, n).replace(`${n}: `, "") + (meta ? ` — ${meta.command.split("\n")[0]}` : "");
            return { name: n, label, running: jobState(dir, n).kind === "running", startedAt: meta?.startedAt ?? 0 };
          }),
        );
        name = await ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => new JobList(tui, theme, items, done), {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%", margin: 1 },
        });
        if (!name) return;
      }
      if (!names.includes(name)) {
        ctx.ui.notify(`No such background job: ${name}`, "error");
        return;
      }
      // In Rex, follow the log live in a float; closing it never stops the job.
      if (rex.inRex()) {
        try {
          await openFloat(dir, name);
          return;
        } catch (e) {
          ctx.ui.notify(`Rex float failed (${(e as Error).message}); showing a snapshot instead.`, "warning");
        }
      }
      const snapshot = () => {
        const meta = readMeta(dir, name);
        const logPath = file(dir, name, "log");
        const details = [describe(dir, name)];
        if (meta) details.push(`Command: ${meta.command}`, `Cwd: ${meta.cwd}`);
        return [...details, `Log: ${logPath}`, "", tail(logPath, 100, true)].join("\n");
      };
      await ctx.ui.custom<void>((tui, theme, _kb, done) => new JobPopup(tui, theme, snapshot, done), {
        overlay: true,
        overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%", margin: 1 },
      });
    },
  });

  pi.registerTool({
    name: "background",
    label: "Background",
    description:
      "Run long-lived, non-interactive commands (servers, watchers, long builds/tests, subagents) in the background; no stdin. " +
      "Logs show on failure, timeout, or with lines. Jobs stop when Pi exits or switches session unless persist.",
    promptSnippet: "Run and manage long-running background commands (servers, watchers, long tests)",
    promptGuidelines: [
      "Use bash for short commands and the background tool for long ones; never `&` or `nohup` in bash.",
      "For long jobs set notify: true and end your turn or do other work; the exit message wakes you. Use wait only for a quick result or a readiness check (until); a timeout leaves the job running. Don't poll status.",
    ],
    parameters: Params,

    async execute(_id, params, signal, onUpdate, ctx) {
      const dir = stateDir();
      let { action } = params;
      const { name } = params;
      const restarting = action === "restart";

      if (action === "status" && !name) {
        const names = jobNames(dir);
        return text(names.length ? names.map((n) => describe(dir, n)).join("\n") : "No background jobs.");
      }

      if (!name) throw new Error(`${action} requires name`);
      if (!NAME_RE.test(name)) throw new Error(`invalid name "${name}": use letters, digits, . _ - (max 64)`);
      const logPath = file(dir, name, "log");
      if (restarting) {
        if (Object.keys(params).some((key) => key !== "action" && key !== "name" && params[key as keyof typeof params] !== undefined)) {
          throw new Error("restart accepts only action and name; use start to change launch settings");
        }
        if (!exists(dir, name)) throw new Error(`no such job: ${name}`);
        const meta = readMeta(dir, name);
        if (!meta || typeof meta.command !== "string" || !meta.command.trim() ||
            typeof meta.cwd !== "string" || !path.isAbsolute(meta.cwd) ||
            typeof meta.persist !== "boolean" || (meta.notify !== undefined && typeof meta.notify !== "boolean") ||
            (meta.wait !== undefined && (typeof meta.wait !== "number" || !Number.isFinite(meta.wait) || meta.wait < 0)) ||
            (meta.until !== undefined && (typeof meta.until !== "string" || meta.wait === undefined)) ||
            (meta.lines !== undefined && (typeof meta.lines !== "number" || !Number.isFinite(meta.lines)))) {
          throw new Error(`cannot restart ${name}: missing or invalid saved launch settings`);
        }
        params = {
          action: "start", name, command: meta.command, cwd: meta.cwd, persist: meta.persist,
          notify: meta.notify, wait: meta.wait, until: meta.until, lines: meta.lines,
        };
        action = "start";
      }
      const initialWait = action === "start" && params.wait !== undefined;
      if (params.wait !== undefined && (action !== "start" || !Number.isFinite(params.wait) || params.wait < 0)) {
        throw new Error("wait must be a finite, non-negative number of seconds on start");
      }
      if (action === "start" && params.until !== undefined && !initialWait) {
        throw new Error("start with until requires wait (seconds)");
      }
      const lines = Math.min(Math.max(0, Math.floor(params.lines ?? (initialWait ? FAIL_LINES : 0))), MAX_LINES);
      let re: RegExp | undefined;
      if ((action === "wait" || initialWait) && params.until) {
        try {
          // Accept /pattern/flags too; models often write regexes that way.
          const m = /^\/(.+)\/([a-z]*)$/.exec(params.until);
          re = m ? new RegExp(m[1], m[2].replace(/[gy]/g, "")) : new RegExp(params.until);
        } catch (e) {
          throw new Error(`invalid until regex: ${(e as Error).message}`);
        }
      }
      const timeoutS = initialWait ? params.wait! : Math.max(1, params.timeout ?? (re ? 60 : 300));
      if ((action === "wait" || initialWait) && !Number.isFinite(timeoutS)) throw new Error("wait timeout must be finite");
      if (action === "start" && signal?.aborted) throw new Error("start cancelled before launch");
      let startNote = "";

      if (action === "start") {
        if (!params.command?.trim()) throw new Error("start requires command");
        const st = jobState(dir, name);
        if (st.kind === "running" && !restarting) throw new Error(`${name} is already running (pid ${st.pid}); stop it or pick another name`);
        const cwd = path.resolve(ctx.cwd, params.cwd ?? ".");
        if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
        if (restarting) {
          // Suppress completion notices for the old run while stopping it.
          waiting.add(name);
          try {
            ask.clearJob(ask.askDirOf(dir), name);
            if (st.kind === "running") await stopPids([st.pid]);
            ask.clearJob(ask.askDirOf(dir), name);
          } finally {
            waiting.delete(name);
            checkQuestions();
            refreshStatus();
          }
          if (signal?.aborted) throw new Error("restart cancelled before launch; previous job stopped");
        }
        ask.clearJob(ask.askDirOf(dir), name);
        const relay = relayFor(dir, name, !!params.persist, ctx.mode);
        const pid = startJob(dir, name, params.command, cwd, !!params.persist, !!params.notify, relay, {
          wait: params.wait, until: params.until, lines: params.lines,
        });
        refreshStatus();
        emitBusy();
        arm();
        const extra = params.persist ? `\nPersistent. Manage after Pi exits: PI_BG_DIR=${dir} bg.sh status|kill ${name}` : "";
        const n = params.notify ? " Will notify on exit." : "";
        if (!initialWait) return text(`${name}: ${restarting ? "restarted" : "started"} (pid ${pid}).${n} Log: ${logPath}${extra}`);
        startNote = extra;
      }
      const waitResult = (message: string) => {
        const notify = initialWait && params.notify && jobState(dir, name).kind === "running" ? "\nWill notify on exit." : "";
        return text(`${message}${notify}${startNote}`);
      };

      if (!exists(dir, name)) {
        const names = jobNames(dir);
        throw new Error(`no such job: ${name}${names.length ? ` (jobs: ${names.join(", ")})` : ""}`);
      }

      if (action === "status") {
        markReported(dir, name);
        const head = describe(dir, name);
        if (lines > 0) return text(withTail(head, logPath, lines));
        const st = jobState(dir, name);
        if (st.kind === "exited" && st.code !== 0) return text(withTail(head, logPath, FAIL_LINES));
        return text(`${head}. Log: ${logPath}`);
      }

      if (action === "stop") {
        const st = jobState(dir, name);
        if (st.kind !== "running") return text(`${describe(dir, name)} (nothing to stop)`);
        ask.clearJob(ask.askDirOf(dir), name);
        const how = await stopPids([st.pid]);
        ask.clearJob(ask.askDirOf(dir), name);
        checkQuestions();
        markReported(dir, name);
        refreshStatus();
        emitBusy();
        return text(`${name}: ${how}`);
      }

      // Shared wait path for action: wait and start with an initial wait.
      const deadline = Date.now() + timeoutS * 1000;
      let offset = 0;
      let carry = "";

      const scan = (): string | undefined => {
        if (!re) return undefined;
        let fd: number | undefined;
        try {
          fd = fs.openSync(logPath, "r");
          const size = fs.fstatSync(fd).size;
          if (size < offset) offset = 0;
          if (size === offset) return undefined;
          const buf = Buffer.alloc(size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          offset = size;
          const parts = (carry + buf.toString("utf8")).split("\n");
          carry = parts.pop() ?? "";
          for (const l of [...parts, carry]) {
            const line = clean(l).trim();
            if (re.test(line)) return line.length > 300 ? `${line.slice(0, 300)}…` : line;
          }
        } catch {
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
        return undefined;
      };

      waiting.add(name);
      let lastUpdate = 0;
      try {
        while (true) {
          // Refresh the call's elapsed counter without adding progress to the final result.
          if (onUpdate && Date.now() - lastUpdate >= 1000) {
            lastUpdate = Date.now();
            onUpdate({ content: [], details: undefined });
          }
          const hit = scan();
          const st = jobState(dir, name);
          if (hit !== undefined) {
            const still = st.kind === "running" ? "still running" : describe(dir, name).replace(`${name}: `, "");
            markReported(dir, name);
            refreshStatus();
            return waitResult(`${name}: matched: ${hit}\n(${still}). Log: ${logPath}`);
          }
          if (st.kind !== "running") {
            markReported(dir, name);
            refreshStatus();
            const head = re ? `${describe(dir, name)} before matching /${params.until}/` : describe(dir, name);
            if (st.kind === "exited" && st.code === 0 && !re) {
              return waitResult(lines > 0 ? withTail(head, logPath, lines) : `${head}. Log: ${logPath}`);
            }
            return waitResult(withTail(head, logPath, Math.max(lines, FAIL_LINES)));
          }
          // Waiting while a child waits for the user would deadlock: return instead.
          const pending = pendingQuestions(dir);
          if (pending.length) {
            return waitResult(`${name}: still running; wait returned early because ${questionsNote(pending)}. Log: ${logPath}`);
          }
          if (signal?.aborted) return waitResult(`${name}: wait cancelled; still running. Log: ${logPath}`);
          if (Date.now() >= deadline) {
            return waitResult(withTail(`${name}: still running after ${timeoutS}s (wait timed out; job not stopped)`, logPath, Math.max(lines, TIMEOUT_LINES)));
          }
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(t);
              signal?.removeEventListener("abort", finish);
              resolve();
            };
            const t = setTimeout(finish, Math.min(250, Math.max(0, deadline - Date.now())));
            signal?.addEventListener("abort", finish, { once: true });
            if (signal?.aborted) finish();
          });
        }
      } finally {
        waiting.delete(name);
      }
    },

    renderCall(args, theme, context) {
      const state = context.state;
      if (context.executionStarted && state.startedAt === undefined) state.startedAt = Date.now();
      if (!context.isPartial && state.startedAt !== undefined) state.endedAt ??= Date.now();
      let t = theme.fg("toolTitle", theme.bold("background ")) + theme.fg("muted", String(args.action ?? ""));
      if (args.name) t += ` ${theme.fg("accent", args.name)}`;
      if (args.command) t += ` ${theme.fg("dim", args.command)}`;
      if (args.wait !== undefined) t += ` ${theme.fg("dim", `(wait ${args.wait}s)`)}`;
      if (args.until) t += ` ${theme.fg("dim", `until /${args.until}/`)}`;
      if (args.persist) t += ` ${theme.fg("warning", "(persist)")}`;
      if (args.notify) t += ` ${theme.fg("dim", "(notify)")}`;
      const elapsed = context.durationMs ?? (state.startedAt === undefined ? undefined : (state.endedAt ?? Date.now()) - state.startedAt);
      if (context.isPartial && elapsed !== undefined) {
        const time = elapsed < 60000 ? `${(elapsed / 1000).toFixed(1)}s` : duration(elapsed);
        t += `\n${theme.fg("dim", `Elapsed ${time}`)}`;
      }
      return new Text(t, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      const output = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      const lines = output ? output.split("\n") : [];
      const visible = expanded ? lines : lines.slice(0, 10);
      let t = theme.fg("toolOutput", visible.join("\n"));
      if (visible.length < lines.length) {
        t += theme.fg("muted", `\n... (${lines.length - visible.length} more lines, expand to view)`);
      }
      if (!isPartial) {
        const state = context.state;
        const elapsed = context.durationMs ?? (state.startedAt === undefined ? undefined : (state.endedAt ?? Date.now()) - state.startedAt);
        if (elapsed !== undefined) {
          const time = elapsed < 60000 ? `${(elapsed / 1000).toFixed(1)}s` : duration(elapsed);
          t += `${t ? "\n\n" : ""}${theme.fg("dim", `Took ${time}`)}`;
        }
      }
      return new Text(t, 0, 0);
    },
  });
}
