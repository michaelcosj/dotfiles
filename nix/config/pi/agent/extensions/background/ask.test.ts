// Run: PI_NODE_MODULES=<pi-monorepo>/node_modules bun test --no-install nix/config/pi/agent/extensions/background/ask.test.ts
// PI_NODE_MODULES defaults to the node_modules next to the `pi` binary on PATH.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Resolve Pi's packages (and typebox) from the installed Pi, since this repo has no node_modules.
const PI_MODULES =
  process.env.PI_NODE_MODULES ??
  path.join(path.dirname(fs.realpathSync(execFileSync("which", ["pi"]).toString().trim())), "../lib/node_modules/pi-monorepo/node_modules");
process.env.NODE_PATH = PI_MODULES; // for child jobs (`bun run` honours NODE_PATH)
for (const id of ["@earendil-works/pi-ai", "@earendil-works/pi-tui", "@earendil-works/pi-coding-agent", "typebox"]) {
  const mod = await import(Bun.resolveSync(id, path.dirname(PI_MODULES)));
  mock.module(id, () => mod);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ask-test-"));
const previousTmpDir = process.env.TMPDIR;
process.env.TMPDIR = TMP; // background ROOT lives under TMPDIR, computed at import
delete process.env.PI_BG_ASK_DIR;
delete process.env.PI_BG_ASK_UNAVAILABLE;

const ask = await import("./ask.ts");
const { default: background } = await import("./index.ts");
const QUESTIONNAIRE = path.join(import.meta.dir, "../questionnaire/index.ts");

const Q = [
  { id: "color", label: "Color", prompt: "Pick a color", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }], allowOther: true },
];

// ---------- fake parent Pi ----------

const tools: Record<string, any> = {};
const commands: Record<string, any> = {};
const handlers: Record<string, any[]> = {};
const notes: string[] = [];
const attention: { active: boolean; label: string }[] = [];
let status: string | undefined;
let nextKey: string | undefined; // key the fake popup feeds to the questionnaire
let customOptions: any;

const pi = {
  events: { emit: (name: string, data: any) => { if (name === "herdr:blocked") attention.push(data); } },
  registerTool: (t: any) => (tools[t.name] = t),
  registerCommand: (n: string, c: any) => (commands[n] = c),
  on: (e: string, h: any) => (handlers[e] ??= []).push(h),
  sendMessage: () => {},
};
const theme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
const ctx: any = {
  mode: "tui",
  hasUI: true,
  cwd: TMP,
  ui: {
    notify: (m: string) => notes.push(m),
    setStatus: (_k: string, t?: string) => (status = t),
    theme,
    select: async (_t: string, choices: string[]) => choices[0],
    custom: (factory: any, options: any) =>
      new Promise((resolve) => {
        customOptions = options;
        const c = factory({ requestRender() {}, terminal: { rows: 40, columns: 100 } }, theme, {}, resolve);
        c.render(80);
        if (nextKey) c.handleInput(nextKey);
      }),
  },
};
background(pi as any);

const run = (params: any, signal?: AbortSignal) => tools.background.execute("id", params, signal, undefined, ctx);
const out = (r: any) => r.content[0].text as string;
const stateDir = () => (globalThis as any).__piBackgroundDir as string;
const askDir = () => ask.askDirOf(stateDir());
const until = async (fn: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(50);
  }
};

/** Start a real background child that asks via the questionnaire module, as `pi -p` would. */
function childScript(extra = "") {
  const p = path.join(TMP, `child-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(
    p,
    `import { askQuestionnaire } from ${JSON.stringify(QUESTIONNAIRE)};
     ${extra}
     const r = await askQuestionnaire({ mode: "print" } as any, ${JSON.stringify(Q)});
     console.log("RESULT " + JSON.stringify(r));`,
  );
  return `${JSON.stringify(process.execPath)} --no-install ${JSON.stringify(p)}`;
}
const result = (name: string) => {
  const line = fs.readFileSync(path.join(stateDir(), `${name}.log`), "utf8").split("\n").find((l) => l.startsWith("RESULT "));
  return line ? JSON.parse(line.slice(7)) : undefined;
};

beforeAll(async () => {
  for (const h of handlers.session_start) await h({}, ctx);
});
afterAll(async () => {
  for (const h of handlers.session_shutdown) await h({ reason: "quit" });
  fs.rmSync(TMP, { recursive: true, force: true });
  if (previousTmpDir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpDir;
});

// ---------- tests ----------

describe("end to end", () => {
  test("wait returns early, Esc leaves pending, submit resumes child, notify once", async () => {
    expect(out(await run({ action: "start", name: "kid", command: childScript() }))).toContain("started");
    expect(fs.statSync(askDir()).mode & 0o777).toBe(0o700);

    // Parent waiting on the job must not deadlock.
    const w = out(await run({ action: "wait", name: "kid", timeout: 20 }));
    expect(w).toContain("wait returned early");
    expect(w).toContain("/bg_questions");
    expect(w).not.toContain("Pick a color"); // question content never reaches the model

    await until(() => status?.includes("1 question") ?? false);
    expect(status).toContain("↻ 1 job");
    const announced = () => notes.filter((n) => n.includes('"kid" has a question')).length;
    await until(() => announced() === 1);
    expect(attention.map((e) => e.active)).toEqual([true]);
    expect(attention[0].label).toContain("/bg_questions");

    // Esc in the popup: nothing sent, still pending.
    nextKey = "\x1b";
    await commands.bg_questions.handler("", ctx);
    expect(customOptions?.overlay).toBe(true);
    expect(notes.at(-1)).toContain("left pending");
    expect(ask.listPending(askDir(), () => true)).toHaveLength(1);
    expect(result("kid")).toBeUndefined();
    expect(attention.map((e) => e.active)).toEqual([true]);

    // Simulate /reload: re-init the extension; no duplicate announcement.
    for (const h of handlers.session_shutdown) await h({ reason: "reload" });
    expect(attention.map((e) => e.active)).toEqual([true, false]);
    for (const h of handlers.session_start) await h({}, ctx);
    await Bun.sleep(1500);
    expect(announced()).toBe(1);
    expect(attention.map((e) => e.active)).toEqual([true, false, true]);

    // Enter picks the first option; child receives exactly the questionnaire result shape.
    nextKey = "\r";
    await commands.bg_questions.handler("", ctx);
    expect(notes.at(-1)).toContain("Answer sent");
    expect(attention.map((e) => e.active)).toEqual([true, false, true, false]);
    await run({ action: "wait", name: "kid", timeout: 20 });
    const r = result("kid");
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ color: "red" });
    expect(r.result.cancelled).toBe(false);
    expect(r.result.answers).toEqual([{ id: "color", value: "red", label: "Red", wasCustom: false, index: 1 }]);
    expect(fs.readdirSync(askDir())).toEqual([]); // child cleaned up
  }, 60000);

  test("stopping the job withdraws its question", async () => {
    await run({ action: "start", name: "stopme", command: childScript() });
    await until(() => ask.listPending(askDir(), () => true).length === 1);
    await until(() => attention.at(-1)?.active === true);
    const beforeStop = attention.length;
    await run({ action: "stop", name: "stopme" });
    expect(attention.slice(beforeStop).map((e) => e.active)).toEqual([false]);
    expect(fs.readdirSync(askDir()).filter((f) => f.startsWith("stopme--"))).toEqual([]);
  }, 30000);

  test("restart withdraws the old question and creates a new relay", async () => {
    await run({ action: "start", name: "restartme", command: childScript() });
    await until(() => ask.listPending(askDir(), () => true).length === 1);
    const oldFiles = fs.readdirSync(askDir());
    expect(out(await run({ action: "restart", name: "restartme" }))).toContain("restarted");
    await until(() => ask.listPending(askDir(), () => true).length === 1);
    const newFiles = fs.readdirSync(askDir());
    for (const old of oldFiles) expect(newFiles).not.toContain(old);
    await run({ action: "stop", name: "restartme" });
    expect(ask.listPending(askDir(), () => true)).toEqual([]);
  }, 30000);

  test("multiple pending jobs share one balanced Herdr attention signal", async () => {
    const start = attention.length;
    await run({ action: "start", name: "queue-a", command: childScript() });
    await run({ action: "start", name: "queue-b", command: childScript() });
    await until(() => status?.includes("2 questions") ?? false);
    expect(attention.slice(start).map((e) => e.active)).toEqual([true]);
    await run({ action: "stop", name: "queue-a" });
    expect(attention.slice(start).map((e) => e.active)).toEqual([true]);
    await run({ action: "stop", name: "queue-b" });
    expect(attention.slice(start).map((e) => e.active)).toEqual([true, false]);
  }, 30000);

  test("persistent jobs and nested children cannot relay", async () => {
    await run({ action: "start", name: "pers", command: childScript(), persist: true });
    await run({ action: "wait", name: "pers", timeout: 20 });
    expect(result("pers").error).toContain("persistent background jobs cannot ask");

    // A relaying child that starts its own process (e.g. via bash) passes on "nested".
    const nested = childScript(
      `const { execFileSync } = await import("node:child_process");
       const { captureRelay } = await import(${JSON.stringify(path.join(import.meta.dir, "ask.ts"))});
       captureRelay();
       console.log(execFileSync(process.execPath, ["-e", "console.log('NESTED ' + process.env.PI_BG_ASK_UNAVAILABLE + ' ' + (process.env.PI_BG_ASK_DIR ?? 'none'))"], { env: process.env }).toString());
       process.exit(0);`,
    );
    await run({ action: "start", name: "nest", command: nested });
    const w = out(await run({ action: "wait", name: "nest", timeout: 20, lines: 20 }));
    expect(w).toContain("NESTED nested background jobs cannot ask");
    expect(w).toContain(" none");
  }, 60000);
});

describe("mailbox", () => {
  const mk = () => {
    const d = fs.mkdtempSync(path.join(TMP, "box-"));
    return ask.ensureAskDir(d);
  };
  const relay = (dir: string) => ({ dir, job: "j", parentPid: process.pid });

  test("roundtrip in process, including custom answers", async () => {
    const dir = mk();
    const p = ask.askViaMailbox(relay(dir), Q, undefined, { pollMs: 10, timeoutMs: 5000 });
    await until(() => ask.listPending(dir, () => true).length === 1);
    const [req] = ask.listPending(dir, () => true);
    ask.writeAnswer(req, [{ id: "color", value: "teal\x1b[31m", label: "teal\x1b[31m", wasCustom: true }]);
    const r = await p;
    expect(r.ok && r.values).toEqual({ color: "teal [31m" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("validation rejects bad questions and answers", () => {
    expect(() => ask.validateQuestions([])).toThrow();
    expect(() => ask.validateQuestions([{ ...Q[0], prompt: "\x1b]0;evil\x07" }])).toThrow("control");
    expect(() => ask.validateQuestions([{ ...Q[0], options: [], allowOther: false }])).toThrow();
    expect(() => ask.validateQuestions(Array(11).fill(Q[0]))).toThrow("at most");
    const qs = ask.validateQuestions(Q);
    expect(() => ask.validateAnswers(qs, [])).toThrow();
    expect(() => ask.validateAnswers(qs, [{ id: "color", value: "green", label: "Red", wasCustom: false, index: 1 }])).toThrow("match");
    expect(() => ask.validateAnswers(qs, [{ id: "nope", value: "red", label: "Red", wasCustom: false, index: 1 }])).toThrow();
    const strict = ask.validateQuestions([{ ...Q[0], allowOther: false }]);
    expect(() => ask.validateAnswers(strict, [{ id: "color", value: "x", label: "x", wasCustom: true }])).toThrow("custom");
  });

  test("invalid, foreign and stale requests are dropped", () => {
    const dir = mk();
    const id = `${Date.now().toString(36)}-0123456789ab`;
    fs.writeFileSync(path.join(dir, `j--${id}.q.json`), "{not json");
    fs.writeFileSync(path.join(dir, "junk.q.json"), "{}");
    const deadId = `${Date.now().toString(36)}-ba9876543210`;
    fs.writeFileSync(
      path.join(dir, `j--${deadId}.q.json`),
      JSON.stringify({ version: 1, id: deadId, job: "j", pid: 2 ** 22 + 7, createdAt: 1, questions: ask.validateQuestions(Q) }),
    );
    expect(ask.listPending(dir, () => true)).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("request from a job that is not running is dropped and the child is told", async () => {
    const dir = mk();
    const p = ask.askViaMailbox(relay(dir), Q, undefined, { pollMs: 10, timeoutMs: 5000 });
    await Bun.sleep(50);
    expect(ask.listPending(dir, () => false)).toEqual([]);
    const r = await p;
    expect(!r.ok && r.error).toContain("withdrawn");
  });

  test("notification marker is set once", async () => {
    const dir = mk();
    const ac = new AbortController();
    const p = ask.askViaMailbox(relay(dir), Q, ac.signal, { pollMs: 10, timeoutMs: 5000 });
    await until(() => ask.listPending(dir, () => true).length === 1);
    const [req] = ask.listPending(dir, () => true);
    expect(ask.markAnnounced(req)).toBe(true);
    expect(ask.markAnnounced(ask.listPending(dir, () => true)[0])).toBe(false);
    ac.abort();
    await p;
  });

  test("timeout and abort return clear results and clean up", async () => {
    const dir = mk();
    const t = await ask.askViaMailbox(relay(dir), Q, undefined, { pollMs: 10, timeoutMs: 100 });
    expect(!t.ok && t.error).toContain("timed out");
    expect(!t.ok && t.error).toContain("do not assume");
    const ac = new AbortController();
    const p = ask.askViaMailbox(relay(dir), Q, ac.signal, { pollMs: 10, timeoutMs: 5000 });
    await Bun.sleep(50);
    ac.abort();
    const a = await p;
    expect(a.ok && a.result.cancelled).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("dead parent and non-private dir are refused", async () => {
    const dir = mk();
    const dead = await ask.askViaMailbox({ dir, job: "j", parentPid: 2 ** 22 + 7 }, Q);
    expect(!dead.ok && dead.error).toContain("no longer running");
    fs.chmodSync(dir, 0o755);
    const open = await ask.askViaMailbox(relay(dir), Q);
    expect(!open.ok && open.error).toContain("not private");
  });

  test("answer for a request that is gone is refused", async () => {
    const dir = mk();
    const ac = new AbortController();
    const p = ask.askViaMailbox(relay(dir), Q, ac.signal, { pollMs: 10, timeoutMs: 5000 });
    await until(() => ask.listPending(dir, () => true).length === 1);
    const [req] = ask.listPending(dir, () => true);
    ac.abort();
    await p;
    expect(() => ask.writeAnswer(req, [{ id: "color", value: "red", label: "Red", wasCustom: false, index: 1 }])).toThrow("no longer pending");
  });
});
