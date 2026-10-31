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
import { formatLog } from "./format-log.js";
import { JobPopup } from "./job-popup.js";

const ROOT = path.join(process.env.TMPDIR || os.tmpdir(), "pi-bg");
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

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
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
    description: "start a job; restart by name with saved launch settings (no overrides); status of one job (or all when name is omitted); wait for exit or a log match; stop",
  }),
  name: Type.Optional(Type.String({ description: "Job label: letters, digits, . _ - (e.g. web, tests)" })),
  command: Type.Optional(Type.String({ description: "start: shell command, run with bash -c" })),
  cwd: Type.Optional(Type.String({ description: "start: working directory (default: current)" })),
  persist: Type.Optional(Type.Boolean({ description: "start: keep running after Pi exits (default false)" })),
  notify: Type.Optional(
    Type.Boolean({
      description: "start: post a message when the job exits, waking you if idle. For tests/builds/subagents you don't want to block on (default false)",
    }),
  ),
  wait: Type.Optional(
    Type.Number({ minimum: 0, description: "start: wait up to N seconds for exit or until match; default returns immediately. Timeout leaves the job running" }),
  ),
  until: Type.Optional(Type.String({ description: "start (requires wait) / wait: regex; return when a log line matches instead of on exit" })),
  timeout: Type.Optional(
    Type.Number({ description: "wait: seconds (default 60 with until, 300 otherwise). Timing out leaves the job running" }),
  ),
  lines: Type.Optional(
    Type.Number({ description: `status/wait/start with wait: include the last N log lines (max ${MAX_LINES}); start with wait defaults to ${FAIL_LINES}` }),
  ),
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }], details: undefined };
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
  let timer: ReturnType<typeof setInterval> | undefined;
  let notifyTimer: ReturnType<typeof setInterval> | undefined;
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
    const parts = running.length ? [`bg: ${running.length}`] : [];
    if (pendingCount) parts.push(`${pendingCount} question${pendingCount === 1 ? "" : "s"} (/bg_questions)`);
    try {
      ctx.ui.setStatus("background", parts.length ? parts.join(" · ") : undefined);
    } catch {}
  };

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    const dir = stateDir();
    refreshStatus();
    if (ctx.hasUI) {
      timer = setInterval(refreshStatus, 5000);
      timer.unref?.();
    }
    notifyTimer = setInterval(checkNotify, 1000);
    notifyTimer.unref?.();
    void sweepOrphans(dir).catch(() => {});
  });

  pi.on("session_shutdown", async (event) => {
    if (timer) clearInterval(timer);
    if (notifyTimer) clearInterval(notifyTimer);
    timer = notifyTimer = undefined;
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
    description: "Inspect a background job's status and recent output (UI only)",
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
      let name = args.trim();
      if (!name) {
        const choices = names.map((name) => describe(dir, name));
        const selected = await ctx.ui.select("Inspect background job", choices);
        if (selected === undefined) return;
        name = names[choices.indexOf(selected)];
      }
      if (!names.includes(name)) {
        ctx.ui.notify(`No such background job: ${name}`, "error");
        return;
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
      "Run long-lived, non-interactive commands (dev servers, watchers, long builds/tests, subagents) in the background. " +
      "No stdin. Add wait: seconds to start for an initial wait, or use action: wait later; until matches a readiness regex. No polling needed. " +
      "Results are concise; logs are shown on failure, on timeout, on initial-wait completion, or with lines=N. " +
      "notify: true posts a message when the job exits, so you can keep working instead of waiting. " +
      "Restart by name stops the previous job and starts it with its saved launch settings, including initial wait; no overrides. " +
      "Jobs stop when Pi exits or switches session unless persist is true.",
    promptSnippet: "Run and manage long-running background commands (servers, watchers, long tests)",
    promptGuidelines: [
      "Use bash for short commands; use the background tool for dev servers, watchers, long builds/tests and subagents. Never use `&` or `nohup` in bash.",
      "Use background start with wait: seconds, or background wait later (until: 'ready|listening' for servers), instead of sleep loops or repeated status calls.",
      "For long jobs whose result you need later but not now, start with notify: true and carry on; you will get a message when it exits.",
    ],
    parameters: Params,

    async execute(_id, params, signal, _onUpdate, ctx) {
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
      try {
        while (true) {
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

    renderCall(args, theme) {
      let t = theme.fg("toolTitle", theme.bold("background ")) + theme.fg("muted", args.action ?? "");
      if (args.name) t += ` ${theme.fg("accent", args.name)}`;
      if (args.command) t += ` ${theme.fg("dim", args.command)}`;
      if (args.wait !== undefined) t += ` ${theme.fg("dim", `(wait ${args.wait}s)`)}`;
      if (args.until) t += ` ${theme.fg("dim", `until /${args.until}/`)}`;
      if (args.persist) t += ` ${theme.fg("warning", "(persist)")}`;
      if (args.notify) t += ` ${theme.fg("dim", "(notify)")}`;
      return new Text(t, 0, 0);
    },
  });
}
