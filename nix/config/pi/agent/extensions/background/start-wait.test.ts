import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { getEventListeners } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Use the installed Pi's dependencies, not whichever version Bun might download.
const modules = process.env.PI_NODE_MODULES ?? path.join(
  path.dirname(fs.realpathSync(execFileSync("which", ["pi"]).toString().trim())),
  "../lib/node_modules/pi-monorepo/node_modules",
);
for (const id of ["@earendil-works/pi-ai", "@earendil-works/pi-tui", "@earendil-works/pi-coding-agent", "typebox"]) {
  const mod = await import(Bun.resolveSync(id, path.dirname(modules)));
  mock.module(id, () => mod);
}
const { default: background } = await import("./index.ts");
const globalState = globalThis as { __piBackgroundDir?: string };
let previousDir: string | undefined;
let dir: string;
let tool: any;
const ctx = { cwd: os.tmpdir(), mode: "json", hasUI: false };
const execute = async (params: Record<string, unknown>, signal?: AbortSignal): Promise<string> => {
  const result = await tool.execute("test", params, signal, undefined, ctx);
  return result.content[0].text;
};

beforeEach(() => {
  previousDir = globalState.__piBackgroundDir;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-start-wait-test-"));
  globalState.__piBackgroundDir = dir;
  background({
    on() {}, registerCommand() {}, events: { emit() {} },
    registerTool(definition: unknown) { tool = definition; },
  } as any);
});
afterEach(() => {
  for (const entry of fs.readdirSync(dir).filter((name) => name.endsWith(".pid"))) {
    const pid = Number(fs.readFileSync(path.join(dir, entry), "utf8"));
    try { process.kill(-pid, "SIGKILL"); } catch {}
  }
  globalState.__piBackgroundDir = previousDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("wait sends empty progress updates for the elapsed display", async () => {
  const updates: any[] = [];
  const result = await tool.execute("test", {
    action: "start", name: "job", command: "sleep 1.2; echo done", wait: 3,
  }, undefined, (update: unknown) => updates.push(update), ctx);
  expect(updates.length).toBeGreaterThanOrEqual(2);
  expect(updates.every((update) => update.content.length === 0)).toBe(true);
  expect(result.content[0].text).toContain("job: exited 0");
  expect(result.content[0].text).not.toContain("Elapsed");
});

test("call counter starts at execution and freezes on completion", () => {
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
  const context: any = { state: {}, executionStarted: false, isPartial: true };
  const render = () => tool.renderCall({ action: "wait", name: "job" }, theme, context).render(100).join("\n");
  expect(render()).not.toContain("Elapsed");
  context.executionStarted = true;
  expect(render()).toContain("Elapsed 0.0s");
  context.state.startedAt = Date.now() - 2500;
  expect(render()).toContain("Elapsed 2.5s");
  context.isPartial = false;
  context.durationMs = 2750;
  expect(render()).not.toContain("Took");
  expect(render()).not.toContain("Elapsed");
  const renderResult = () => tool.renderResult(
    { content: [{ type: "text", text: "job: exited 0" }] },
    { expanded: false, isPartial: context.isPartial }, theme, context,
  ).render(100).map((line: string) => line.trimEnd()).join("\n");
  expect(renderResult()).toBe("job: exited 0\n\nTook 2.8s");
  context.durationMs = undefined;
  render();
  const endedAt = context.state.endedAt;
  render();
  expect(context.state.endedAt).toBe(endedAt);
  // Recorded durations also work when viewing an old call without live state.
  context.state = {};
  context.executionStarted = false;
  context.durationMs = 4000;
  expect(renderResult()).toBe("job: exited 0\n\nTook 4.0s");
});

test("start still returns immediately without wait", async () => {
  const result = await execute({ action: "start", name: "job", command: "sleep 5" });
  expect(result).toContain("job: started (pid");
  expect(await execute({ action: "status", name: "job" })).toContain("running");
});

test("start with wait returns successful exit and bounded output", async () => {
  const result = await execute({ action: "start", name: "job", command: "seq 1 130", wait: 2, lines: 1000 });
  expect(result).toContain("job: exited 0\n31\n32\n");
  expect(result).toContain("\n130\nLog:");
  expect(result).not.toContain("\n30\n");
});

test("start with wait shows successful output by default", async () => {
  const result = await execute({ action: "start", name: "job", command: "printf 'done\\n'", wait: 2 });
  expect(result).toContain("job: exited 0\ndone\nLog:");
});

test("start with wait reports failure and stderr", async () => {
  const result = await execute({ action: "start", name: "job", command: "echo broken >&2; exit 7", wait: 2 });
  expect(result).toContain("job: exited 7\nbroken\nLog:");
});

test("readiness regex returns while the job keeps running", async () => {
  const result = await execute({ action: "start", name: "job", command: "printf 'noise\\nSERVER READY\\n'; sleep 5", wait: 2, until: "/server ready/iy" });
  expect(result).toContain("matched: SERVER READY");
  expect(result).toContain("still running");
  expect(await execute({ action: "status", name: "job" })).toContain("running");
});

test("initial timeout leaves the job running and preserves notification and persistence notes", async () => {
  const result = await execute({ action: "start", name: "job", command: "sleep 5", wait: 0.02, persist: true, notify: true });
  expect(result).toContain("still running after 0.02s");
  expect(result).toContain("wait timed out; job not stopped");
  expect(result).toContain("Will notify on exit.");
  expect(result).toContain("Persistent.");
  expect(await execute({ action: "status", name: "job" })).toContain("running");
});

test("wait zero performs an immediate state check", async () => {
  const result = await execute({ action: "start", name: "job", command: "sleep 5", wait: 0 });
  expect(result).toContain("still running after 0s");
});

test("invalid regex, wait, or missing wait never launches a process", async () => {
  for (const extra of [{ wait: 1, until: "[" }, { wait: -1 }, { wait: Infinity }, { until: "ready" }]) {
    await expect(execute({ action: "start", name: "job", command: "sleep 5", ...extra })).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, "job.pid"))).toBe(false);
  }
});

test("already cancelled start does not launch a process", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(execute({ action: "start", name: "job", command: "sleep 5", wait: 2 }, controller.signal)).rejects.toThrow("cancelled before launch");
  expect(fs.existsSync(path.join(dir, "job.pid"))).toBe(false);
});

test("cancelling the initial wait leaves the job running and removes listeners", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    const result = await execute({ action: "start", name: "job", command: "sleep 5", wait: 2 }, controller.signal);
    expect(result).toContain("wait cancelled; still running");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(await execute({ action: "status", name: "job" })).toContain("running");
  } finally { clearTimeout(timer); }
});

test("separate wait can finish a job after the initial wait times out", async () => {
  await execute({ action: "start", name: "job", command: "sleep 0.1; echo complete", wait: 0 });
  const result = await execute({ action: "wait", name: "job", timeout: 2, lines: 5 });
  expect(result).toContain("job: exited 0\ncomplete\nLog:");
});

test("separate wait keeps its previous quiet successful-exit default", async () => {
  await execute({ action: "start", name: "job", command: "echo quiet" });
  const result = await execute({ action: "wait", name: "job", timeout: 2 });
  expect(result).toContain("job: exited 0. Log:");
  expect(result).not.toContain("\nquiet");
});

test("completion during initial wait is marked reported instead of notified twice", async () => {
  const result = await execute({ action: "start", name: "job", command: "echo done", wait: 2, notify: true });
  expect(result).toContain("exited 0");
  expect(result).not.toContain("Will notify on exit");
  expect(fs.existsSync(path.join(dir, "job.notified"))).toBe(true);
});

test("exit before readiness match reports the exit and output", async () => {
  const result = await execute({ action: "start", name: "job", command: "echo not-ready; exit 3", wait: 2, until: "^ready$" });
  expect(result).toContain("exited 3 before matching");
  expect(result).toContain("not-ready");
});

const metadata = () => JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8"));

test("restart stops the running process and reuses its launch settings", async () => {
  await execute({ action: "start", name: "job", command: "echo ready; sleep 5", cwd: dir, wait: 0.01, until: "ready", lines: 3, persist: true, notify: true });
  const before = metadata();
  const oldPid = fs.readFileSync(path.join(dir, "job.pid"), "utf8");
  fs.appendFileSync(path.join(dir, "job.log"), "OLD OUTPUT\n");
  fs.writeFileSync(path.join(dir, "job.notified"), "");
  const result = await execute({ action: "restart", name: "job" });
  const after = metadata();
  expect(result).toMatch(/matched: ready|wait timed out/);
  expect(result).toContain("Persistent.");
  expect(result).toContain("Will notify on exit.");
  expect(fs.readFileSync(path.join(dir, "job.pid"), "utf8")).not.toBe(oldPid);
  expect(fs.readFileSync(path.join(dir, "job.log"), "utf8")).not.toContain("OLD OUTPUT");
  expect(fs.existsSync(path.join(dir, "job.notified"))).toBe(false);
  for (const key of ["command", "cwd", "persist", "notify", "wait", "until", "lines"]) {
    expect(after[key]).toEqual(before[key]);
  }
}, 10000);

test("restart of an exited job reuses its initial wait and output limit", async () => {
  await execute({ action: "start", name: "job", command: "printf 'first\\nlast\\n'", cwd: dir, wait: 2, lines: 1 });
  const result = await execute({ action: "restart", name: "job" });
  expect(result).toContain("job: exited 0\nlast\nLog:");
  expect(result).not.toContain("\nfirst\n");
});

test("restart without an original initial wait returns immediately", async () => {
  await execute({ action: "start", name: "job", command: "echo done" });
  await execute({ action: "wait", name: "job", timeout: 2 });
  const result = await execute({ action: "restart", name: "job" });
  expect(result).toContain("job: restarted (pid");
  expect(metadata().wait).toBeUndefined();
});

test("restart rejects unknown jobs, missing metadata, and overrides", async () => {
  await expect(execute({ action: "restart", name: "unknown" })).rejects.toThrow("no such job");
  await execute({ action: "start", name: "job", command: "sleep 5" });
  const oldPid = fs.readFileSync(path.join(dir, "job.pid"), "utf8");
  for (const extra of [{ command: "echo override" }, { wait: 1 }, { notify: false }, { lines: 0 }]) {
    await expect(execute({ action: "restart", name: "job", ...extra })).rejects.toThrow("restart accepts only");
  }
  fs.unlinkSync(path.join(dir, "job.json"));
  await expect(execute({ action: "restart", name: "job" })).rejects.toThrow("missing or invalid saved launch settings");
  expect(fs.readFileSync(path.join(dir, "job.pid"), "utf8")).toBe(oldPid);
  expect(await execute({ action: "status", name: "job" })).toContain("running");
});

test("restart validates saved settings before stopping the old job", async () => {
  await execute({ action: "start", name: "job", command: "sleep 5", cwd: dir });
  const original = metadata();
  const oldPid = fs.readFileSync(path.join(dir, "job.pid"), "utf8");
  for (const extra of [{ wait: -1 }, { wait: "2" }, { notify: "yes" }, { cwd: path.join(dir, "missing") }, { wait: 1, until: "[" }]) {
    fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ ...original, ...extra }));
    await expect(execute({ action: "restart", name: "job" })).rejects.toThrow();
    expect(fs.readFileSync(path.join(dir, "job.pid"), "utf8")).toBe(oldPid);
    expect(await execute({ action: "status", name: "job" })).toContain("running");
  }
});

test("restart uses the current environment, not an environment snapshot", async () => {
  const key = "PI_RESTART_TEST_VALUE";
  const previous = process.env[key];
  try {
    process.env[key] = "old-value";
    await execute({ action: "start", name: "job", command: `echo "$${key}"`, wait: 2 });
    process.env[key] = "new-value";
    const result = await execute({ action: "restart", name: "job" });
    expect(result).toContain("\nnew-value\n");
    expect(result).not.toContain("old-value");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
