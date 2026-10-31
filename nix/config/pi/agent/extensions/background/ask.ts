/**
 * Question mailbox: lets a direct background child (`pi -p` started by the background tool) ask
 * the user through the parent Pi's questionnaire UI, without the parent model ever seeing it.
 *
 * Layout, inside the parent's state directory: ask/ (mode 0700)
 *   <job>--<id>.q.json   request, written atomically by the child
 *   <job>--<id>.a.json   answer, written atomically by the parent when the user submits
 *   <job>--<id>.seen     marker: the parent already announced this request (survives /reload)
 * The child removes all three once it has the answer, gives up, or is aborted. The parent removes
 * requests whose job or requesting process is gone, and the whole directory on quit/session switch.
 *
 * Only files are used: no sockets, no RPC. Both sides validate and bound everything they read.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { QuestionnaireAnswer, QuestionnaireUiResult } from "../questionnaire/types.js";

export type AskQuestion = QuestionnaireUiResult["questions"][number];

export const ENV_DIR = "PI_BG_ASK_DIR";
export const ENV_PARENT = "PI_BG_PARENT_PID";
export const ENV_JOB = "PI_BG_JOB";
export const ENV_UNAVAILABLE = "PI_BG_ASK_UNAVAILABLE";
export const ENV_TIMEOUT = "PI_BG_ASK_TIMEOUT_MS";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_MS = 250;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILES = 200;
const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 30;
const MAX_ID = 64;
const MAX_LABEL = 500;
const MAX_TEXT = 4000;

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ID_RE = /^[0-9a-z]{6,12}-[0-9a-f]{12}$/;
const FILE_RE = /^(.+)--([0-9a-z]{6,12}-[0-9a-f]{12})\.(q\.json|a\.json|seen)$/;
// Control characters other than tab/newline (includes ESC, so no terminal escapes reach the UI).
const UNSAFE_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

export interface Relay {
  dir: string;
  job: string;
  parentPid: number;
}
export type RelayState = { relay: Relay } | { unavailable: string } | undefined;

export interface PendingRequest {
  base: string;
  id: string;
  job: string;
  pid: number;
  createdAt: number;
  questions: AskQuestion[];
}

type AskResult =
  | { ok: true; result: QuestionnaireUiResult; values: Record<string, string> }
  | { ok: false; error: string };

// ---------- small helpers ----------

export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Process group of pid (Linux /proc), or undefined when it can't be determined. */
export function processGroup(pid: number): number | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
    return pgrp > 0 ? pgrp : undefined;
  } catch {
    return undefined;
  }
}

const rm = (p: string) => fs.rmSync(p, { force: true });
const q = (base: string) => `${base}.q.json`;
const a = (base: string) => `${base}.a.json`;
const seen = (base: string) => `${base}.seen`;

function removeRequest(base: string) {
  // Request first, so the parent never sees "request without answer" mid-cleanup.
  for (const p of [q(base), a(base), seen(base)]) rm(p);
}

function atomicWrite(target: string, body: string) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, target);
  } catch (e) {
    rm(tmp);
    throw e;
  }
}

/** Parse a regular, bounded JSON file; undefined if absent, throws if unreadable/oversized/invalid. */
function readJson(p: string): unknown {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return undefined;
  }
  if (!st.isFile()) throw new Error("not a regular file");
  if (st.size > MAX_FILE_BYTES) throw new Error("file too large");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------- directory ----------

export const askDirOf = (stateDir: string) => path.join(stateDir, "ask");

export function checkPrivateDir(dir: string) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (process.getuid && st.uid !== process.getuid()) throw new Error(`${dir} is not owned by this user`);
  if (st.mode & 0o077) throw new Error(`${dir} is not private (mode ${(st.mode & 0o777).toString(8)})`);
}

export function ensureAskDir(stateDir: string): string {
  const dir = askDirOf(stateDir);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const st = fs.lstatSync(dir);
  if (st.isDirectory() && !st.isSymbolicLink() && (!process.getuid || st.uid === process.getuid())) fs.chmodSync(dir, 0o700);
  checkPrivateDir(dir);
  return dir;
}

// ---------- environment ----------

/** Env for a new job: relay vars when the job may ask, otherwise a reason it can't. */
export function relayEnv(opt: { dir: string; job: string } | { reason: string }): Record<string, string | undefined> {
  if ("reason" in opt) return { [ENV_DIR]: undefined, [ENV_PARENT]: undefined, [ENV_UNAVAILABLE]: opt.reason };
  return { [ENV_DIR]: opt.dir, [ENV_PARENT]: String(process.pid), [ENV_JOB]: opt.job, [ENV_UNAVAILABLE]: undefined };
}

export function readRelayEnv(env: NodeJS.ProcessEnv): RelayState {
  const dir = env[ENV_DIR];
  if (dir) {
    const job = env[ENV_JOB] ?? "";
    const parentPid = Number(env[ENV_PARENT]);
    if (!path.isAbsolute(dir) || !NAME_RE.test(job) || !Number.isInteger(parentPid) || parentPid <= 0) {
      return { unavailable: "question relay environment is invalid" };
    }
    return { relay: { dir, job, parentPid } };
  }
  const reason = env[ENV_UNAVAILABLE];
  return reason ? { unavailable: reason.slice(0, 300) } : undefined;
}

const G = globalThis as { __piBgAskRelay?: { state: RelayState } };
export const NESTED_REASON =
  "nested background jobs cannot ask the user; only direct background children of an interactive Pi can";

/**
 * Read this process's relay env once (memoized across /reload) and scrub it, so processes this
 * child starts (bash tool, its own background jobs) are told they are nested instead of relaying.
 */
export function captureRelay(): RelayState {
  if (!G.__piBgAskRelay) {
    const state = readRelayEnv(process.env);
    G.__piBgAskRelay = { state };
    if (state && "relay" in state) {
      delete process.env[ENV_DIR];
      delete process.env[ENV_PARENT];
      process.env[ENV_UNAVAILABLE] = NESTED_REASON;
    }
  }
  return G.__piBgAskRelay.state;
}

// ---------- validation ----------

function text(v: unknown, what: string, max: number, opt: { min?: number; multiline?: boolean } = {}): string {
  if (typeof v !== "string") throw new Error(`${what} must be a string`);
  if (v.length < (opt.min ?? 0)) throw new Error(`${what} is empty`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters`);
  if (UNSAFE_RE.test(v) || (!opt.multiline && /[\n\t]/.test(v))) throw new Error(`${what} contains control characters`);
  return v;
}

/** Validate normalized questions (as produced by the questionnaire's normalization) and copy known fields. */
export function validateQuestions(input: unknown): AskQuestion[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("no questions");
  if (input.length > MAX_QUESTIONS) throw new Error(`at most ${MAX_QUESTIONS} questions`);
  const ids = new Set<string>();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`question ${i} is not an object`);
    const r = raw as Record<string, unknown>;
    const id = text(r.id, `question ${i} id`, MAX_ID, { min: 1 });
    if (ids.has(id)) throw new Error(`duplicate question id "${id}"`);
    ids.add(id);
    if (!Array.isArray(r.options) || r.options.length > MAX_OPTIONS) throw new Error(`question "${id}" needs at most ${MAX_OPTIONS} options`);
    if (typeof r.allowOther !== "boolean") throw new Error(`question "${id}" allowOther must be boolean`);
    if (!r.options.length && !r.allowOther) throw new Error(`question "${id}" has no options and allowOther is false`);
    const options = r.options.map((o, j) => {
      const op = (o ?? {}) as Record<string, unknown>;
      const what = `question "${id}" option ${j + 1}`;
      return {
        value: text(op.value, `${what} value`, MAX_LABEL),
        label: text(op.label, `${what} label`, MAX_LABEL),
        ...(op.description === undefined ? {} : { description: text(op.description, `${what} description`, MAX_TEXT, { multiline: true }) }),
      };
    });
    return {
      id,
      label: text(r.label, `question "${id}" label`, MAX_LABEL, { min: 1 }),
      prompt: text(r.prompt, `question "${id}" prompt`, MAX_TEXT, { min: 1, multiline: true }),
      options,
      allowOther: r.allowOther,
    };
  });
}

/** Validate an answer set against its questions: every question answered once, choices match options. */
export function validateAnswers(questions: AskQuestion[], input: unknown): QuestionnaireAnswer[] {
  if (!Array.isArray(input) || input.length !== questions.length) throw new Error("every question needs exactly one answer");
  const done = new Set<string>();
  return input.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const question = questions.find((qq) => qq.id === r.id);
    if (!question || done.has(question.id)) throw new Error(`unknown or duplicate answer id "${String(r.id).slice(0, 64)}"`);
    done.add(question.id);
    const value = text(r.value, `answer "${question.id}" value`, MAX_TEXT, { min: r.wasCustom ? 1 : 0, multiline: true });
    const label = text(r.label, `answer "${question.id}" label`, MAX_TEXT, { multiline: true });
    if (typeof r.wasCustom !== "boolean") throw new Error(`answer "${question.id}" wasCustom must be boolean`);
    if (r.wasCustom) {
      if (!question.allowOther) throw new Error(`question "${question.id}" does not allow custom answers`);
      return { id: question.id, value, label, wasCustom: true };
    }
    const index = r.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > question.options.length) {
      throw new Error(`answer "${question.id}" has an invalid option index`);
    }
    if (question.options[index - 1].value !== value) throw new Error(`answer "${question.id}" does not match its option`);
    return { id: question.id, value, label, wasCustom: false, index };
  });
}

// ---------- child side ----------

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Post questions to the parent's mailbox and wait for the user's answer. Never guesses an answer. */
export async function askViaMailbox(
  relay: Relay,
  questions: AskQuestion[],
  signal?: AbortSignal,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<AskResult> {
  const fail = (msg: string): AskResult => ({ ok: false, error: `Error: ${msg}. No answer was given; do not assume one.` });
  const cancelled = (): AskResult => ({ ok: true, result: { questions, answers: [], cancelled: true }, values: {} });
  try {
    questions = validateQuestions(questions);
  } catch (e) {
    return { ok: false, error: `Error: ${(e as Error).message}` };
  }
  if (signal?.aborted) return cancelled();
  try {
    checkPrivateDir(relay.dir);
  } catch (e) {
    return fail(`question relay unavailable: ${(e as Error).message}`);
  }
  if (!alive(relay.parentPid)) return fail("the parent Pi is no longer running");

  const envTimeout = Number(process.env[ENV_TIMEOUT]);
  const timeoutMs = opts.timeoutMs ?? (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
  const id = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const base = path.join(relay.dir, `${relay.job}--${id}`);
  const body = JSON.stringify({ version: 1, id, job: relay.job, pid: process.pid, createdAt: Date.now(), questions });
  if (Buffer.byteLength(body) > MAX_FILE_BYTES) return { ok: false, error: "Error: questions are too large" };

  try {
    atomicWrite(q(base), body);
  } catch (e) {
    return fail(`could not post the question: ${(e as Error).message}`);
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      if (signal?.aborted) return cancelled();
      let answer: unknown;
      try {
        answer = readJson(a(base));
      } catch (e) {
        return fail(`invalid answer file: ${(e as Error).message}`);
      }
      if (answer !== undefined) {
        const r = answer as Record<string, unknown>;
        if (r?.version !== 1 || r.id !== id) return fail("invalid answer file");
        let answers: QuestionnaireAnswer[];
        try {
          answers = validateAnswers(questions, r.answers);
        } catch (e) {
          return fail(`invalid answer: ${(e as Error).message}`);
        }
        const values: Record<string, string> = {};
        for (const ans of answers) values[ans.id] = ans.value;
        return { ok: true, result: { questions, answers, cancelled: false }, values };
      }
      if (!fs.existsSync(q(base))) return fail("the question was withdrawn by the parent Pi (job stopped or session ended)");
      if (!alive(relay.parentPid)) return fail("the parent Pi exited before the user answered");
      if (Date.now() >= deadline) {
        return fail(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for the user to answer (they answer with /bg_questions in the parent Pi)`);
      }
      await sleep(opts.pollMs ?? POLL_MS, signal);
    }
  } finally {
    removeRequest(base);
  }
}

// ---------- parent side ----------

/**
 * Valid, unanswered requests, oldest first. `owns(job, pid)` must confirm the job is running and
 * the requesting pid belongs to it. Invalid, oversized or stale requests are removed.
 */
export function listPending(askDir: string, owns: (job: string, pid: number) => boolean): PendingRequest[] {
  let entries: string[];
  try {
    checkPrivateDir(askDir);
    entries = fs.readdirSync(askDir);
  } catch {
    return [];
  }
  const out: PendingRequest[] = [];
  const requests = entries.filter((f) => f.endsWith(".q.json"));
  for (const f of requests.slice(MAX_FILES)) rm(path.join(askDir, f)); // flood guard
  for (const f of requests.slice(0, MAX_FILES)) {
    const m = FILE_RE.exec(f);
    if (!m) {
      rm(path.join(askDir, f));
      continue;
    }
    const [, job, id] = m;
    const base = path.join(askDir, `${job}--${id}`);
    if (fs.existsSync(a(base))) continue; // answered, waiting for the child to pick it up
    try {
      if (!NAME_RE.test(job) || !ID_RE.test(id)) throw new Error("bad name");
      const r = readJson(q(base)) as Record<string, unknown> | undefined;
      if (!r) continue;
      if (r.version !== 1 || r.id !== id || r.job !== job) throw new Error("mismatch");
      const pid = r.pid as number;
      const createdAt = r.createdAt as number;
      if (!Number.isInteger(pid) || pid <= 0 || typeof createdAt !== "number") throw new Error("bad header");
      const questions = validateQuestions(r.questions);
      if (!alive(pid) || !owns(job, pid)) throw new Error("stale");
      out.push({ base, id, job, pid, createdAt, questions });
    } catch {
      removeRequest(base);
    }
  }
  return out.sort((x, y) => x.createdAt - y.createdAt);
}

export const isPending = (req: PendingRequest) => fs.existsSync(q(req.base)) && !fs.existsSync(a(req.base));

/** Mark a request announced. True only the first time. */
export function markAnnounced(req: PendingRequest): boolean {
  try {
    fs.writeFileSync(seen(req.base), "", { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Write the user's answers for a still-pending request. Throws if it is gone or the answers are invalid. */
export function writeAnswer(req: PendingRequest, answers: QuestionnaireAnswer[]) {
  if (!isPending(req)) throw new Error("the question is no longer pending");
  const scrub = (s: string) => s.replace(new RegExp(UNSAFE_RE.source, "g"), " ").slice(0, MAX_TEXT);
  const clean = answers.map((x) => (x.wasCustom ? { ...x, value: scrub(x.value), label: scrub(x.label) } : x));
  const valid = validateAnswers(req.questions, clean);
  atomicWrite(a(req.base), JSON.stringify({ version: 1, id: req.id, answers: valid }));
}

/** Remove every mailbox file belonging to job (on stop or restart under the same name). */
export function clearJob(askDir: string, job: string) {
  let entries: string[];
  try {
    entries = fs.readdirSync(askDir);
  } catch {
    return;
  }
  for (const f of entries) {
    const m = FILE_RE.exec(f);
    if (m && m[1] === job) rm(path.join(askDir, f));
  }
}

export function clearAll(askDir: string) {
  fs.rmSync(askDir, { recursive: true, force: true });
}
