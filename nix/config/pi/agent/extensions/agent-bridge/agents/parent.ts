// Parent side of delegation: the `agent` and `remote_agent` tools, the
// roster, and child lifecycle. A local child is an interactive pi in a
// detached Rex block; it connects to this pi's bridge socket as role "agent"
// (see child.ts). A remote child runs in a tab of a `pi-agents` session on
// another Rex host and connects back over Tailscale (bridge.listenRemote).
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import * as rex from "../../lib/rex.js";
import { type Bridge, type Client, programStatus } from "../core.js";
import { deliverNote, deliverReview } from "../notes.js";
import { type AgentStatus, ENV, type Roster } from "./protocol.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const START_TIMEOUT_MS = 30_000;
const REMOTE_START_TIMEOUT_MS = 60_000;
/** A remote child outlives a lost connection this long (sleep, network). */
const REMOTE_PARENT_GONE_MS = 5 * 60_000;
const STOP_GRACE_MS = 3_000;
const LABEL_PREFIX = "pi-agent:";
const REMOTE_SESSION = "pi-agents";
const MACHINE = os.hostname().split(".")[0];
const MAX_RESULT_BYTES = 16 * 1024;

export interface Agent {
  id: string;
  name: string;
  title: string;
  block: string;
  /** the Rex host it runs on; undefined is this machine */
  host?: string;
  /** where it runs on that host */
  remote?: { session: string; window: string };
  /** a remote child's first prompt, sent when it first connects */
  firstPrompt?: string;
  /** cwd on its machine (for a remote child, may start with ~) */
  cwd: string;
  model?: string;
  status: AgentStatus;
  message?: string;
  client?: Client;
  startedAt: number;
  runStartedAt?: number;
  runMs?: number;
  tokens?: number;
  lastMessage?: string;
  lastAborted?: boolean;
  /** settled result not yet given to the model */
  unreported: boolean;
  /** reports sent as messages that pi has not delivered yet */
  queued?: number;
  notify: boolean;
  /** "" for a remote child */
  promptFile: string;
  /** notes waiting for this child to reconnect; review: a visible message */
  pendingNotes?: (string | { text: string; review: true })[];
  thinking?: string;
  /** the child's pi session file, for resume */
  sessionFile?: string;
  /** its own git worktree (agent-worktree), when started with worktree */
  worktree?: { name: string; branch: string };
}

/** What this pi's session remembers about a child, so it can be resumed after a restart. */
export interface SavedAgent {
  name: string;
  title: string;
  cwd: string;
  model?: string;
  thinking?: string;
  /** a path on `host` when set */
  sessionFile: string;
  host?: string;
  worktree?: { name: string; branch: string };
}
const SAVED_TYPE = "agent-child";

const RemoteParams = Type.Object({
  action: StringEnum(["start", "hosts"] as const, {
    description: "start a child agent on another Rex host; hosts lists the hosts and whether each answers",
  }),
  host: Type.Optional(Type.String({ description: "start: the host's full label from hosts, e.g. devbox-work" })),
  name: Type.Optional(Type.String({ description: "start: agent name: lowercase letters, digits, - (shared with local agents)" })),
  task: Type.Optional(Type.String({ description: "start: the full task prompt. Put everything the child needs in it" })),
  title: Type.Optional(Type.String({ description: "start: a short title for the agent list (default: name)" })),
  model: Type.Optional(Type.String({ description: "start: model, as named on that host (default: the host's pi default)" })),
  thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, { description: "start: thinking level" })),
  cwd: Type.Optional(Type.String({ description: "start: working directory on the host; ~ is the host's home (default: this cwd, under ~ if it is in your home)" })),
  notify: Type.Optional(Type.Boolean({ description: "start: post a message to you each time it settles (default true)" })),
});

/** This machine's cwd as a path on another host: the same place under ~. */
export function remoteCwd(cwd: string, home = os.homedir()): string {
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
}

// Runs on the host: go to the directory (Rex silently uses ~ for a bad cwd),
// check a resumed session file exists, then start pi with the bridge env.
/** agent-worktree (nix/scripts); AGENT_WORKTREE_BIN overrides it, for tests. */
const WORKTREE_BIN = () => process.env.AGENT_WORKTREE_BIN || "agent-worktree";

/** Creates (or finds) the worktree for `name` in the repo at `repo`; its path. */
export function newWorktree(name: string, repo: string): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return Promise.reject(new Error(`bad worktree name ${name}: use letters, digits, . _ -`));
  return new Promise((resolve, reject) => {
    execFile(WORKTREE_BIN(), ["new", name, "--repo", repo], { timeout: 120_000 }, (err, stdout, stderr) => {
      const out = stdout.trim().split("\n").at(-1);
      if (err || !out) reject(new Error(`could not create worktree ${name}: ${(stderr || err?.message || "no path printed").trim()}`));
      else resolve(out);
    });
  });
}

export const worktreeNote = (branch: string) =>
  `You are in your own git worktree on branch ${branch}. Commit your work there when done; your parent reviews and merges it.`;

const REMOTE_SCRIPT = [
  'd=$1; r=$2; shift 2',
  'case $d in "~") d=$HOME ;; "~/"*) d=$HOME/${d#"~/"} ;; esac',
  'cd -- "$d" || { echo "pi-agent: no directory $d on $(hostname)"; exit 1; }',
  'if [ -n "$r" ] && [ ! -f "$r" ]; then echo "pi-agent: session file is gone: $r"; exit 1; fi',
  'exec env "$@"',
].join("\n");

const Params = Type.Object({
  action: StringEnum(["start", "send", "wait", "status", "stop", "resume"] as const, {
    description:
      "start a child agent; send a follow-up to a running child; wait for children to settle; status of one or all (lists resumable ones); stop (closes it); resume a stopped child's conversation in a new pane (e.g. after a restart)",
  }),
  name: Type.Optional(Type.String({ description: "Agent name: lowercase letters, digits, - (e.g. scout-auth). wait: omit to wait for any" })),
  task: Type.Optional(Type.String({ description: "start: the full task prompt. Put everything the child needs in it" })),
  title: Type.Optional(Type.String({ description: "start: a short title for the agent list (default: name)" })),
  text: Type.Optional(Type.String({ description: "send: the message. resume: optional first message" })),
  model: Type.Optional(Type.String({ description: "start: model, e.g. claude-code/claude-opus-5-5 (default: yours)" })),
  thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, { description: "start: thinking level" })),
  cwd: Type.Optional(Type.String({ description: "start: working directory (default: current)" })),
  worktree: Type.Optional(
    Type.Union([Type.Boolean(), Type.String()], {
      description: "start: run in its own git worktree on branch agent/<name> (true: named after the agent, or a name). Not with cwd",
    }),
  ),
  notify: Type.Optional(Type.Boolean({ description: "start: post a message to you each time it settles (default true)" })),
  timeout: Type.Optional(Type.Number({ description: "wait: seconds (default 600). Timing out leaves the child running" })),
});

function text(t: string, details?: unknown) {
  return { content: [{ type: "text" as const, text: t }], details };
}

function clip(s: string | undefined) {
  if (!s) return "(no reply)";
  return Buffer.byteLength(s) > MAX_RESULT_BYTES ? `${Buffer.from(s).subarray(0, MAX_RESULT_BYTES).toString("utf8")}\n[…truncated]` : s;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export function registerParent(pi: any, bridge: Bridge, opts: { onFilesChanged: (paths: string[]) => void; onRoster: (r: Roster) => void }) {
  // Kept across /reload (the old module's map), so running children are not
  // forgotten; they reconnect with the same id and token.
  const g = globalThis as { __piAgents?: Map<string, Agent> };
  const agents = (g.__piAgents ??= new Map<string, Agent>()); // by name
  for (const a of agents.values()) a.client = undefined;
  const changed = new Set<() => void>(); // wake waiters
  let visible = rex.REX_BLOCK!;
  /** the remote agent the Rex app was last switched to, if any */
  let remoteView: string | undefined;
  let selfTokens: number | undefined;
  // The pi-agents session on each host, and hosts already swept this run.
  const remoteSessions = new Map<string, string>();
  const swept = new Set<string>();
  const targetOf = (a: Agent): rex.Target | undefined => (a.host && a.remote ? { server: a.host, session: a.remote.session } : undefined);
  const wake = () => {
    for (const fn of [...changed]) fn();
  };

  const byClient = (c: Client) => [...agents.values()].find((a) => a.client === c);

  // Children this pi's session has run, by name; read from the session on start.
  let saved = new Map<string, SavedAgent>();
  function loadSaved(ctx: any) {
    saved = new Map();
    for (const e of ctx?.sessionManager?.getBranch?.() ?? []) {
      if (e?.type !== "custom" || e.customType !== SAVED_TYPE) continue;
      const d = e.data as SavedAgent;
      if (d?.name && d.sessionFile) saved.set(d.name, d);
    }
  }
  function remember(a: Agent) {
    if (!a.sessionFile) return;
    const d: SavedAgent = { name: a.name, title: a.title, cwd: a.cwd, model: a.model, thinking: a.thinking, sessionFile: a.sessionFile, host: a.host, worktree: a.worktree };
    const old = saved.get(a.name);
    if (old && JSON.stringify(old) === JSON.stringify(d)) return;
    saved.set(a.name, d);
    try {
      pi.appendEntry(SAVED_TYPE, d);
    } catch {}
  }
  /** Saved children that are not running and whose session still exists (a remote one is checked on its host at launch). */
  const resumable = () => [...saved.values()].filter((d) => !agents.has(d.name) && (!!d.host || fs.existsSync(d.sessionFile)));

  function roster(): Roster {
    return {
      main: rex.REX_BLOCK!,
      visible,
      agents: [...agents.values()].filter((a) => a.block).map((a) => ({
        name: a.name,
        title: a.title,
        block: a.block,
        host: a.host,
        status: a.status,
        message: a.message,
        runStartedAt: a.runStartedAt,
        runMs: a.runMs,
        tokens: a.tokens,
      })),
    };
  }

  let rosterTimer: ReturnType<typeof setTimeout> | undefined;
  function publish() {
    // Coalesce bursts (usage, state) into one update.
    if (rosterTimer) return;
    rosterTimer = setTimeout(() => {
      rosterTimer = undefined;
      const r = roster();
      bridge.broadcast("agent", "roster", r as any);
      opts.onRoster(r);
      refreshAttention();
    }, 50);
  }

  // A blocked child sets a status record on this pi's tab, so the tab shows
  // it while the child is out of view.
  const attention = new Set<string>();
  function refreshAttention() {
    for (const a of agents.values()) {
      const want = a.status === "blocked";
      if (want && !attention.has(a.name)) {
        attention.add(a.name);
        programStatus(`agent-${a.name}`, "blocked", `${a.name} needs an answer`);
      } else if (!want && attention.has(a.name)) {
        attention.delete(a.name);
        programStatus(`agent-${a.name}`, "clear");
      }
    }
  }

  function setStatus(a: Agent, status: AgentStatus, message?: string) {
    const was = a.status;
    if (status === "working" && was !== "working") a.runStartedAt = Date.now();
    if (status !== "working" && status !== "blocked" && a.runStartedAt) {
      a.runMs = Date.now() - a.runStartedAt;
      a.runStartedAt = undefined;
    }
    a.status = status;
    a.message = message;
    if (status === "blocked" && was !== "blocked") {
      bridge.ctx?.ui?.notify?.(`Agent ${a.name} has a question. Press ↓ on an empty prompt to switch to it.`, "warning");
    }
    publish();
    wake();
  }

  // ---- child -> parent ----

  bridge.onClient("connect", (c) => {
    if (c.role !== "agent") return;
    const a = [...agents.values()].find((x) => x.id === c.info.id);
    if (!a) return void c.socket.destroy();
    a.client = c;
    if (a.status === "starting" || a.status === "crashed") setStatus(a, "working");
    bridge.event(c, "roster", roster() as any);
    for (const n of a.pendingNotes?.splice(0) ?? [])
      bridge.event(c, "note", typeof n === "string" ? { text: n } : { text: n.text, review: true });
    // A remote child can't read a prompt file here; it gets its task now, once.
    if (a.firstPrompt) {
      bridge.event(c, "prompt", { text: a.firstPrompt });
      a.firstPrompt = undefined;
    }
  });

  bridge.onClient("disconnect", (c) => {
    const a = byClient(c);
    if (!a) return;
    a.client = undefined;
    // A child that reloads reconnects within a moment; only then is it gone.
    // A remote child may be out of reach for a while (sleep, network): keep
    // checking until it is back or has outlived its own grace period.
    const lostAt = Date.now();
    const check = (delay: number) =>
      setTimeout(() => {
        if (a.client || !agents.has(a.name)) return;
        void (async () => {
          const over = !!a.host && Date.now() - lostAt > REMOTE_PARENT_GONE_MS + 30_000;
          if (!over && !(await gone(a))) {
            if (a.host) check(30_000);
            return; // still running; it will reconnect
          }
          if (a.client || !agents.has(a.name)) return;
          await bringBack(a);
          flushNotes(a);
          setStatus(a, "crashed", over ? `lost ${a.host}` : "exited");
          report(
            a,
            over
              ? `Agent ${a.name} on ${a.host} has been unreachable for over ${REMOTE_PARENT_GONE_MS / 60_000} minutes; it has exited. Stop it to clean up.`
              : `Agent ${a.name} exited unexpectedly. Its pane shows its last output; stop it to close it.`,
          );
        })();
      }, delay);
    check(3000);
  });

  const agentMethod = (name: string, fn: (a: Agent, p: any) => unknown) =>
    bridge.registerMethod("agent", name, (c, p) => {
      const a = byClient(c);
      if (!a) throw new Error("unknown agent");
      return fn(a, p);
    });

  agentMethod("state", (a, p) => {
    const status = (["working", "idle", "blocked"] as const).find((s) => s === p.status);
    if (status) setStatus(a, status, typeof p.message === "string" ? p.message : undefined);
  });
  agentMethod("usage", (a, p) => {
    if (typeof p.tokens === "number") a.tokens = p.tokens;
    publish();
  });
  agentMethod("settled", (a, p) => {
    a.lastMessage = typeof p.last_message === "string" ? p.last_message : undefined;
    a.lastAborted = !!p.aborted;
    a.unreported = true;
    setStatus(a, "idle");
    if (a.notify) {
      // A wait in progress reports it instead (it checks after this tick).
      setTimeout(() => {
        if (a.unreported) report(a);
      }, 0);
    }
  });
  agentMethod("files_changed", (_a, p) => {
    if (Array.isArray(p.paths)) opts.onFilesChanged(p.paths.filter((x: unknown) => typeof x === "string"));
  });
  agentMethod("session", (a, p) => {
    if (typeof p.session_file !== "string" || !path.isAbsolute(p.session_file)) return;
    a.sessionFile = p.session_file;
    remember(a);
  });
  agentMethod("view", (a, p) => {
    if (a.host || typeof p.block !== "string") return; // a remote child's blocks are not in this session
    visible = p.block;
    remoteView = undefined;
    publish();
  });
  agentMethod("switch", (_a, p) => {
    if (typeof p.name !== "string") return;
    return view(p.name).catch((e) => {
      bridge.ctx?.ui?.notify?.(`Could not switch to ${p.name}: ${(e as Error).message}`, "error");
      throw e;
    });
  });

  function resultText(a: Agent) {
    a.unreported = false;
    return `Agent ${a.name} ${a.lastAborted ? "was aborted" : "finished"}${a.runMs ? ` (${duration(a.runMs)})` : ""}:\n${clip(a.lastMessage)}`;
  }

  /**
   * Posts a child's result (or an exit) to this pi's conversation. As a
   * steer: it lands after the current tool calls, before the next model
   * call, not at the end of the whole run. Until pi delivers it, a wait
   * returns at once instead of waiting for a result that is on its way.
   */
  function report(a: Agent, body?: string) {
    const content = body ?? resultText(a);
    try {
      pi.sendMessage(
        { customType: "agent-result", content, display: true, details: { name: a.name } },
        { triggerTurn: true, deliverAs: "steer" },
      );
      a.queued = (a.queued ?? 0) + 1;
      wake();
    } catch {}
  }

  pi.on("message_start", (event: any) => {
    const m = event.message;
    if (m?.role !== "custom" || m.customType !== "agent-result") return;
    const a = agents.get(m.details?.name);
    if (a?.queued) a.queued--;
  });

  // ---- lifecycle ----

  async function paneSize() {
    try {
      const s = await rex.blockCall(rex.REX_BLOCK!, "size");
      if (s?.columns && s?.rows) return { columns: s.columns, rows: s.rows };
    } catch {}
    return undefined;
  }

  /**
   * Whether a child's program has exited. A host that doesn't answer is not
   * proof: only a missing block or a finished program is.
   */
  async function gone(a: Agent): Promise<boolean> {
    const t = targetOf(a);
    if (!t) return rex.exited(a.block);
    try {
      const p = await rex.blockCall(a.block, "process", {}, t);
      return !p?.child;
    } catch (e) {
      return /not found/.test((e as Error).message);
    }
  }

  /** The command line a child runs: pi with its bridge env. */
  function piArgs(name: string, title: string, model?: string, thinking?: string, resume?: SavedAgent) {
    const args = ["pi"];
    // A resumed session keeps its own model, thinking level and name.
    if (resume) args.push("--session", resume.sessionFile);
    else {
      if (model) args.push("--model", model);
      if (thinking) args.push("--thinking", thinking);
      args.push("--name", `${name}: ${title}`);
    }
    return args;
  }

  /** Starts a child on another Rex host, in a tab of its pi-agents session. */
  async function startRemote(p: any, resume?: SavedAgent): Promise<Agent> {
    const name = p.name;
    const host: string = resume?.host ?? p.host;
    if (agents.has(name)) throw new Error(`agent ${name} already exists; send it work, or stop it first`);
    if (!resume && !p.task?.trim()) throw new Error("start requires task");
    if (!host) throw new Error("start requires host");
    const id = crypto.randomBytes(6).toString("hex");
    const title = resume ? resume.title : (p.title?.trim() || name).slice(0, 60);
    const model = resume ? resume.model : p.model;
    const thinking = resume ? resume.thinking : p.thinking;
    const cwd = resume ? resume.cwd : (p.cwd?.trim() || remoteCwd(bridge.ctx?.cwd ?? process.cwd()));
    const first = resume ? (p.text ?? "") : p.task;
    const a: Agent = {
      id, name, title, block: "", host, cwd, model, thinking, status: "starting", startedAt: Date.now(),
      unreported: false, notify: p.notify !== false, promptFile: "", sessionFile: resume?.sessionFile,
      firstPrompt: first?.trim() ? first : undefined,
    };
    // Register before any await: a wait or send in the same batch of tool calls runs in parallel.
    agents.set(name, a);
    try {
      const { address, token } = await bridge.listenRemote();
      const env = [
        `${ENV.parent}=${address}`,
        `${ENV.token}=${token}`,
        `${ENV.id}=${id}`,
        `${ENV.name}=${name}`,
        `${ENV.title}=${title}`,
        `${ENV.host}=${host}`,
        `${ENV.parentGone}=${REMOTE_PARENT_GONE_MS}`,
      ];
      let session = remoteSessions.get(host);
      if (!session) {
        session = await rex.ensureSession(host, REMOTE_SESSION);
        remoteSessions.set(host, session);
      }
      if (!swept.has(host)) {
        swept.add(host);
        await sweepRemote({ server: host, session }).catch(() => {});
      }
      const t = { server: host, session };
      const size = await paneSize();
      const open = () =>
        rex.newWindowTerminal(t, {
          name,
          label: `${LABEL_PREFIX}${name}:${MACHINE}:${process.pid}`,
          command: ["sh", "-c", REMOTE_SCRIPT, "sh", cwd, resume?.sessionFile ?? "", ...env, ...piArgs(name, title, model, thinking, resume)],
          size,
          keepOpen: true,
        });
      const opened = await open().catch(async (e) => {
        // The session may have been closed on the host since; make it again once.
        remoteSessions.delete(host);
        if (!/not found/.test((e as Error).message)) throw e;
        t.session = await rex.ensureSession(host, REMOTE_SESSION);
        remoteSessions.set(host, t.session);
        return open();
      });
      a.block = opened.block;
      a.remote = { session: t.session, window: opened.window };
    } catch (e) {
      flushNotes(a);
      agents.delete(name);
      wake();
      throw new Error(`could not open a pane for ${name} on ${host}: ${(e as Error).message}`);
    }
    publish();
    // Ready when it says hello; a pane whose program ended will never say it.
    const deadline = Date.now() + REMOTE_START_TIMEOUT_MS;
    while (!a.client && a.status !== "crashed" && Date.now() < deadline) {
      await until(() => !!a.client || a.status === "crashed", 2000);
      if (a.client || !agents.has(name)) break;
      if (await gone(a)) break;
    }
    if (!a.client) {
      const screen = await rex.capture(a.block, targetOf(a)).catch(() => "");
      await stop(a);
      throw new Error(
        `agent ${name} on ${host} did not connect.${screen.trim() ? `\nIts screen:\n${screen.trim().split("\n").slice(-15).join("\n")}` : ""}`,
      );
    }
    return a;
  }

  async function start(p: any, ctx: any, resume?: SavedAgent): Promise<Agent> {
    if (resume?.host) return startRemote(p, resume);
    const name = p.name;
    if (agents.has(name)) throw new Error(`agent ${name} already exists; send it work, or stop it first`);
    if (!resume && !p.task?.trim()) throw new Error("start requires task");
    if (resume && !fs.existsSync(resume.sessionFile)) throw new Error(`agent ${name}'s session file is gone: ${resume.sessionFile}`);
    let worktree = resume?.worktree;
    let cwd = resume ? resume.cwd : path.resolve(ctx.cwd, p.cwd ?? ".");
    if (!resume && p.worktree) {
      if (p.cwd) throw new Error("use worktree or cwd, not both");
      const wt = typeof p.worktree === "string" ? p.worktree.trim() : name;
      cwd = await newWorktree(wt, ctx.cwd);
      worktree = { name: wt, branch: `agent/${wt}` };
    }
    if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
    if (!bridge.running || !bridge.socketPath || !bridge.token) throw new Error("the agent bridge is not running in this pi");
    const id = crypto.randomBytes(6).toString("hex");
    const promptFile = path.join(os.tmpdir(), `pi-agent-${id}.md`);
    const first = resume ? (p.text ?? "") : worktree ? `${p.task}\n\n${worktreeNote(worktree.branch)}` : p.task;
    fs.writeFileSync(promptFile, first, { mode: 0o600 });
    const title = resume ? resume.title : (p.title?.trim() || name).slice(0, 60);
    const model = resume ? resume.model : p.model;
    const thinking = resume ? resume.thinking : p.thinking;
    const args = piArgs(name, title, model, thinking, resume);
    // The child reads its first prompt from the file (see child.ts), so no quoting issues.
    const env = [
      `${ENV.parent}=${bridge.socketPath}`,
      `${ENV.token}=${bridge.token}`,
      `${ENV.id}=${id}`,
      `${ENV.name}=${name}`,
      `${ENV.title}=${title}`,
      `${ENV.prompt}=${promptFile}`,
    ];
    // Register first: a wait or send in the same batch of tool calls runs in parallel.
    const a: Agent = {
      id, name, title, block: "", cwd, model, thinking, status: "starting", startedAt: Date.now(),
      unreported: false, notify: p.notify !== false, promptFile, sessionFile: resume?.sessionFile, worktree,
    };
    agents.set(name, a);
    try {
      a.block = await rex.newDetachedTerminal({
        label: `${LABEL_PREFIX}${name}:${process.pid}`,
        command: ["env", ...env, ...args],
        cwd,
        size: await paneSize(),
        keepOpen: true,
      });
    } catch (e) {
      flushNotes(a);
      agents.delete(name);
      fs.rmSync(promptFile, { force: true });
      wake();
      throw new Error(`could not open a Rex pane for ${name}: ${(e as Error).message}`);
    }
    const block = a.block;
    publish();
    // Ready when it says hello.
    const ok = await until(() => !!a.client || a.status === "crashed", START_TIMEOUT_MS);
    if (!ok) {
      const screen = await rex.capture(block).catch(() => "");
      await stop(a);
      throw new Error(`agent ${name} did not connect within ${START_TIMEOUT_MS / 1000}s.${screen.trim() ? `\nIts screen:\n${screen.trim().split("\n").slice(-15).join("\n")}` : ""}`);
    }
    return a;
  }

  async function stop(a: Agent) {
    flushNotes(a);
    agents.delete(a.name);
    attention.delete(a.name);
    programStatus(`agent-${a.name}`, "clear");
    await bringBack(a);
    if (a.client) bridge.event(a.client, "shutdown");
    const left = await until(() => !a.client || a.client.socket.destroyed, STOP_GRACE_MS);
    if (!left) a.client?.socket.destroy();
    const t = targetOf(a);
    if (a.block) await rex.closeBlock(a.block, t).catch(() => {});
    if (a.promptFile) fs.rmSync(a.promptFile, { force: true });
    // The host's pi-agents session goes with its last agent.
    if (t && ![...agents.values()].some((x) => x.host === a.host)) {
      remoteSessions.delete(a.host!);
      await rex.killSession(t).catch(() => {});
    }
    publish();
    wake();
  }

  /** If `a` is in view, put this pi back in its place. Never leave the user looking at a closed pane. */
  async function bringBack(a: Agent) {
    if (a.host) {
      if (remoteView !== a.name) return;
      remoteView = undefined;
      await rex.showSession({ session: rex.REX_SESSION! }).catch(() => {});
      return;
    }
    if (!a.block || !rex.REX_BLOCK) return;
    const placed = (await rex.blocks().catch(() => [])).find((b) => b.block_id === a.block)?.placement === "placed";
    if (!placed && visible !== a.block) return;
    if (placed) await rex.swap(a.block, rex.REX_BLOCK).catch(() => {});
    visible = rex.REX_BLOCK;
    publish();
  }

  function until(cond: () => boolean, ms: number, signal?: AbortSignal): Promise<boolean> {
    if (cond()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(t);
        changed.delete(check);
        signal?.removeEventListener("abort", abort);
        resolve(v);
      };
      const check = () => cond() && done(true);
      const abort = () => done(false);
      const t = setTimeout(() => done(cond()), ms);
      changed.add(check);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /**
   * Shows agent `name` (or "main"): a local one is swapped into this pi's
   * place; a remote one is shown by switching the Rex app to its host's
   * session. From a remote session, local rows switch the app back here.
   */
  async function view(name: string) {
    if (name !== "main") {
      const a = agents.get(name);
      if (!a?.block) throw new Error(`no agent ${name}`);
      if (a.host) {
        await rex.showSession(targetOf(a)!, a.remote!.window);
        remoteView = a.name;
        return;
      }
    }
    await rex.showSession({ session: rex.REX_SESSION! });
    remoteView = undefined;
    const block = name === "main" ? rex.REX_BLOCK! : agents.get(name)!.block;
    if (block !== visible) {
      await rex.swap(visible, block);
      visible = block;
    }
    publish();
  }

  /** Closes blocks on a host left by a pi on this machine that died. */
  async function sweepRemote(t: rex.Target) {
    for (const b of await rex.blocks(t)) {
      const m = b.label?.startsWith(LABEL_PREFIX) ? /:([^:]+):(\d+)$/.exec(b.label) : null;
      if (!m || m[1] !== MACHINE || Number(m[2]) === process.pid) continue;
      try {
        process.kill(Number(m[2]), 0);
        continue; // owner alive
      } catch (e: any) {
        if (e?.code === "EPERM") continue;
      }
      await rex.closeBlock(b.block_id, t).catch(() => {});
    }
  }

  /** Closes blocks left by a parent pi that died. */
  async function sweep() {
    const list = await rex.blocks().catch(() => []);
    for (const b of list) {
      const m = b.label?.startsWith(LABEL_PREFIX) ? /:(\d+)$/.exec(b.label) : null;
      if (!m || Number(m[1]) === process.pid) continue;
      try {
        process.kill(Number(m[1]), 0);
        continue; // owner alive
      } catch (e: any) {
        if (e?.code === "EPERM") continue;
      }
      await rex.closeBlock(b.block_id).catch(() => {});
    }
  }

  // ---- this pi's own usage, for the "main" row ----

  pi.on("message_end", (event: any, ctx: any) => {
    if (event.message?.role !== "assistant") return;
    const u = ctx.getContextUsage?.();
    if (u?.tokens != null) selfTokens = u.tokens;
    publish();
  });

  pi.on("session_start", (_e: any, ctx: any) => {
    loadSaved(ctx);
    for (const a of agents.values()) remember(a); // a /new or /resume keeps running children resumable
    void sweep();
    // After a restart the children are gone but their conversations are not.
    // Deferred: a notice during startup is drawn before the TUI is up and lost.
    setTimeout(() => {
      const res = resumable();
      if (res.length && !agents.size && ctx?.mode === "tui") {
        ctx.ui.notify(`Stopped agents from this session: ${res.map((d) => d.name).join(", ")}. /agents resumes one.`, "info");
      }
    }, 1000).unref?.();
  });

  // reload/fork keep this pi (and its socket path) alive; children reconnect.
  bridge.onShutdown(async (reason) => {
    if (reason === "reload" || reason === "fork") return;
    await Promise.all([...agents.values()].map((a) => stop(a)));
  });

  // ---- the tool ----

  pi.registerTool({
    name: "agent",
    label: "Agent",
    description:
      "Delegate work to child agents. Each child is an interactive pi in its own Rex pane that the user can view, steer, and answer questions in. " +
      "start runs a task; the child stays alive after it finishes, so send gives it follow-up work. You get each child's final reply when it settles " +
      "(notify, default true), or use wait. stop closes a child; resume reopens a stopped child's conversation (e.g. after a restart). Children cannot start agents.",
    promptSnippet: "Delegate tasks to child agents the user can watch and steer (Rex)",
    promptGuidelines: [
      "Use the agent tool for subagents; load the subagent skill for model picks and prompting guidance.",
      "After agent start or send, carry on with other work; each child's reply arrives as a message when it settles. Use agent wait only when you need a result before you can continue.",
      "A child that needs an answer ends its turn with numbered questions. Answer from what you know: facts, earlier decisions in this conversation, and the user's standing rules. Then reply with agent send and tell the user your answer in one line, so they can correct it.",
      "Ask the user (questionnaire) about new choices, anything destructive or hard to undo, anything outside the task's scope, and matters of taste. Send their answer to the child. Batch questions from several children into one questionnaire.",
      "If agent wait reports that a child is blocked on a question in its own pane, the user is talking to it directly: tell the user and stop waiting; never answer for them.",
      "Reuse a settled child with agent send when the follow-up builds on its work; stop children you no longer need.",
      "Children close when this pi exits. When a follow-up builds on a closed child's work, agent resume it (agent status lists resumable children) instead of starting over.",
    ],
    parameters: Params,

    async execute(_id: string, p: any, signal: AbortSignal, onUpdate: any, ctx: any) {
      const get = (name?: string) => {
        if (!name) throw new Error(`${p.action} requires name`);
        const a = agents.get(name);
        if (!a || (p.action !== "wait" && !a.block)) throw new Error(`no agent ${name}${agents.size ? ` (agents: ${[...agents.keys()].join(", ")})` : ""}`);
        return a;
      };
      const describe = (a: Agent) => {
        const time = a.runStartedAt ? `, ${duration(Date.now() - a.runStartedAt)}` : "";
        return `${a.name}${a.host ? `@${a.host}` : ""}: ${a.status}${a.message ? ` (${a.message})` : ""}${time} — ${a.title}`;
      };

      switch (p.action) {
        case "start": {
          if (!p.name || !NAME_RE.test(p.name)) throw new Error("name must be lowercase letters, digits and - (max 32)");
          const a = await start(p, ctx);
          const where = a.worktree ? ` in worktree ${a.cwd} (branch ${a.worktree.branch}); merge or discard it, then agent-worktree rm ${a.worktree.name}` : "";
          return text(
            `Started agent ${a.name}${a.model ? ` (${a.model})` : ""}${where}.${a.notify ? " Its reply will arrive as a message when it settles." : ""}`,
            { names: [a.name], title: a.title },
          );
        }
        case "resume": {
          if (!p.name) throw new Error("resume requires name");
          if (agents.has(p.name)) throw new Error(`agent ${p.name} is running; use send`);
          const d = saved.get(p.name);
          if (!d) {
            const list = resumable().map((x) => x.name);
            throw new Error(`no saved agent ${p.name}${list.length ? ` (resumable: ${list.join(", ")})` : ""}`);
          }
          const a = await start({ ...p, notify: p.notify }, ctx, d);
          return text(
            `Resumed agent ${a.name}${a.host ? ` on ${a.host}` : ""} with its previous conversation.${p.text?.trim() ? (a.notify ? " Its reply will arrive as a message when it settles." : "") : " It is idle; send it work."}`,
            { names: [a.name], title: a.title, resumed: true },
          );
        }
        case "send": {
          const a = get(p.name);
          if (!p.text?.trim()) throw new Error("send requires text");
          if (!a.client) throw new Error(`agent ${a.name} is not connected (${a.status})`);
          bridge.event(a.client, "prompt", { text: p.text });
          a.unreported = false;
          return text(`Sent to ${a.name}${a.status === "working" ? " (queued as a follow-up)" : ""}.`);
        }
        case "status": {
          if (p.name) {
            const a = get(p.name);
            return text(`${describe(a)}${a.lastMessage ? `\nLast reply:\n${clip(a.lastMessage)}` : ""}`);
          }
          const res = resumable();
          const tail = res.length ? `\nResumable (stopped): ${res.map((d) => `${d.name}${d.host ? `@${d.host}` : ""} — ${d.title}`).join("; ")}` : "";
          return text((agents.size ? [...agents.values()].map(describe).join("\n") : "No agents running.") + tail);
        }
        case "stop": {
          const a = get(p.name);
          await stop(a);
          return text(`Stopped ${a.name}.`);
        }
        case "wait": {
          const pick = () => {
            const list = p.name ? [get(p.name)] : [...agents.values()];
            return (
              list.find((a) => a.unreported) ??
              list.find((a) => a.queued) ??
              list.find((a) => a.status === "blocked") ??
              list.find((a) => a.status === "crashed") ??
              (p.name && !agents.has(p.name) ? undefined : null)
            );
          };
          if (!p.name && !agents.size) return text("No agents.");
          const timeout = Math.max(1, p.timeout ?? 600) * 1000;
          const tick = setInterval(() => onUpdate?.({ content: [], details: undefined }), 1000);
          try {
            await until(() => !!pick(), timeout, signal);
          } finally {
            clearInterval(tick);
          }
          const a = pick();
          if (!a) {
            if (signal?.aborted) return text("Wait cancelled; agents still running.");
            return text(`No agent settled within ${timeout / 1000}s; they are still running.\n${[...agents.values()].map(describe).join("\n")}`);
          }
          if (a.unreported) return text(resultText(a));
          if (a.queued) return text(`Agent ${a.name} already settled; its result is queued as a message and arrives right after this call.`);
          if (a.status === "blocked")
            return text(`Agent ${a.name} is waiting for the user to answer a question in its pane. Tell the user; they can switch to it with ↓ on an empty prompt.`);
          return text(`Agent ${a.name} exited unexpectedly.`);
        }
      }
      throw new Error(`unknown action ${p.action}`);
    },

    renderCall(args: any, theme: any) {
      let t = theme.fg("toolTitle", theme.bold("agent ")) + theme.fg("muted", args.action ?? "");
      if (args.name) t += ` ${theme.fg("accent", args.name)}`;
      if (args.action === "start" && args.title) t += ` ${theme.fg("dim", args.title)}`;
      if (args.action === "start" && args.worktree) t += theme.fg("dim", ` ⎇ ${typeof args.worktree === "string" ? args.worktree : args.name}`);
      if (args.model) t += ` ${theme.fg("dim", `(${args.model}${args.thinking ? `:${args.thinking}` : ""})`)}`;
      if ((args.action === "send" || args.action === "resume") && args.text) t += ` ${theme.fg("dim", args.text.split("\n")[0].slice(0, 80))}`;
      return new Text(t, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const d = result.details;
      if (d?.names) {
        return new Text(
          `${theme.fg("success", "●")} ${theme.bold(d.names.join(", "))} ${theme.fg("dim", `${d.resumed ? "resumed" : "launched"}${d.title ? ` — ${d.title}` : ""} (↓ to manage)`)}`,
          0,
          0,
        );
      }
      const out = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      const lines = out.split("\n");
      const shown = expanded ? lines : lines.slice(0, 8);
      let t = theme.fg("toolOutput", shown.join("\n"));
      if (shown.length < lines.length) t += theme.fg("muted", `\n... (${lines.length - shown.length} more lines, expand to view)`);
      return new Text(t, 0, 0);
    },
  });

  pi.registerTool({
    name: "remote_agent",
    label: "Remote agent",
    description:
      "Start a child agent on another Rex host (another machine running Rex), e.g. for more power or a project that lives there. " +
      "It runs in a tab of the host's pi-agents session and joins the same agent list; after start, manage it with the agent tool " +
      "(send, wait, status, stop, resume). Its files, paths and models are the host's; its edits are not reviewed in Neovim here. " +
      "hosts lists the hosts and whether each answers.",
    promptSnippet: "Start child agents on another Rex host; manage them with the agent tool",
    promptGuidelines: [
      "Use remote_agent only when the user asks for a host or the work belongs there; otherwise use agent. Pass the host's full label from remote_agent hosts.",
      "After remote_agent start, use the agent tool (send, wait, status, stop, resume) for that child, as for a local one.",
    ],
    parameters: RemoteParams,

    async execute(_id: string, p: any) {
      if (p.action === "hosts") {
        const list = await rex.hosts();
        if (!list.length) return text("No Rex hosts are known. Add one with rex hosts.");
        return text(list.map((h) => `${h.label}: ${h.status}${h.detail ? ` (${h.detail})` : ""}`).join("\n"));
      }
      if (p.action !== "start") throw new Error(`unknown action ${p.action}`);
      if (!p.name || !NAME_RE.test(p.name)) throw new Error("name must be lowercase letters, digits and - (max 32)");
      if (!p.host?.trim()) throw new Error("start requires host (see remote_agent hosts)");
      if (p.worktree) throw new Error("worktree is not supported for remote agents yet");
      const a = await startRemote({ ...p, host: p.host.trim() });
      return text(
        `Started agent ${a.name} on ${a.host} in ${a.cwd}${a.model ? ` (${a.model})` : ""}. Manage it with the agent tool.${a.notify ? " Its reply will arrive as a message when it settles." : ""}`,
        { names: [a.name], title: a.title, host: a.host },
      );
    },

    renderCall(args: any, theme: any) {
      let t = theme.fg("toolTitle", theme.bold("remote_agent ")) + theme.fg("muted", args.action ?? "");
      if (args.name) t += ` ${theme.fg("accent", args.name)}`;
      if (args.host) t += theme.fg("dim", `@${args.host}`);
      if (args.title) t += ` ${theme.fg("dim", args.title)}`;
      if (args.model) t += ` ${theme.fg("dim", `(${args.model}${args.thinking ? `:${args.thinking}` : ""})`)}`;
      return new Text(t, 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const d = result.details;
      if (d?.names) {
        return new Text(
          `${theme.fg("success", "●")} ${theme.bold(d.names.join(", "))}${theme.fg("dim", `@${d.host}`)} ${theme.fg("dim", `launched${d.title ? ` — ${d.title}` : ""} (↓ to manage)`)}`,
          0,
          0,
        );
      }
      const out = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      return new Text(theme.fg("toolOutput", out), 0, 0);
    },
  });

  /** Notes that could not reach their child go to this pi. */
  function flushNotes(a: Agent) {
    for (const n of a.pendingNotes?.splice(0) ?? [])
      if (typeof n === "string") deliverNote(pi, n);
      else deliverReview(pi, n.text, bridge.ctx?.isIdle?.() !== false);
  }

  // A note from Neovim's change review for a child. Hold it while the child
  // reconnects; an unknown or crashed child sends it to this pi instead.
  // review: the user's review comments, shown in the child's conversation.
  function routeNote(name: string, note: string, review = false) {
    const a = agents.get(name);
    if (!a || a.status === "crashed") return false;
    if (a.client) bridge.event(a.client, "note", review ? { text: note, review: true } : { text: note });
    else (a.pendingNotes ??= []).push(review ? { text: note, review: true } : note);
    return true;
  }

  return {
    roster,
    routeNote,
    resumable,
    resume: (name: string) => {
      const d = saved.get(name);
      if (!d) return Promise.reject(new Error(`no saved agent ${name}`));
      return start({ name, notify: true }, bridge.ctx, d);
    },
    selfTokens: () => selfTokens,
    setVisible(block: string) {
      visible = block;
      remoteView = undefined;
      publish();
    },
    view,
  };
}
