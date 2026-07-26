import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RUNNING,
  MAX_TRACKED,
  type SpawnTask,
  type SubagentEvent,
} from "./src/domain.ts";
import { createSubagentManager } from "./src/manager.ts";
import type { ChildSession } from "./src/session.ts";
function task(title: string): SpawnTask {
  return {
    prompt: "go",
    title,
    cwd: process.cwd(),
    parent: { parentCwd: process.cwd(), projectTrusted: true },
  };
}
function factory() {
  const controls: ((e: SubagentEvent) => void)[] = [];
  return {
    controls,
    create: async (): Promise<ChildSession> => {
      let listener: (e: SubagentEvent) => void = () => {};
      controls.push((e) => listener(e));
      return {
        session: {} as any,
        meta: { backend: "pi", sessionFilePath: "/tmp/child.jsonl" },
        subscribe(fn) {
          listener = fn;
          return () => {};
        },
        async send() {},
        async interrupt() {
          listener({
            type: "settled",
            status: "done",
            finalText: "partial",
            errorText: "Interrupted",
          });
        },
        async dispose() {},
      };
    },
  };
}
test("parallel spawn reservation enforces four", async () => {
  let releases: (() => void)[] = [];
  const m = createSubagentManager(async (t) => {
    await new Promise<void>((r) => releases.push(r));
    return factory().create();
  });
  const pending = [0, 1, 2, 3].map((i) => m.spawn(task(String(i))));
  await assert.rejects(() => m.spawn(task("fifth")), /At most 4/);
  releases.forEach((r) => r());
  await Promise.all(pending);
  await m.disposeAll();
});
test("wait is settlement-driven and abort does not cancel child", async () => {
  const f = factory(),
    m = createSubagentManager(f.create);
  const s = await m.spawn(task("one"));
  const ac = new AbortController();
  const waiting = m.wait([s.id], ac.signal);
  ac.abort();
  await assert.rejects(waiting, /aborted/);
  assert.equal(m.get(s.id)?.status, "running");
  const done = m.wait([s.id]);
  f.controls[0]!({ type: "settled", status: "done", finalText: "ok" });
  await done;
  assert.equal(m.get(s.id)?.finalText, "ok");
  await m.disposeAll();
});
test("a child resolving after disposal is immediately disposed and never tracked", async () => {
  let release!: (child: ChildSession) => void;
  let disposed = 0;
  const pending = new Promise<ChildSession>((resolve) => (release = resolve));
  const m = createSubagentManager(() => pending);
  const spawning = m.spawn(task("late"));
  await m.disposeAll();
  const child: ChildSession = {
    session: {} as any,
    meta: { backend: "pi", sessionFilePath: "/tmp/late.jsonl" },
    subscribe: () => () => {},
    async send() {},
    async interrupt() {},
    async dispose() {
      disposed++;
    },
  };
  release(child);
  await assert.rejects(spawning, /disposed during spawn/);
  assert.equal(disposed, 1);
  assert.equal(m.list().length, 0);
});

test("duplicate settlement is ignored and disposal is idempotent", async () => {
  const f = factory(),
    m = createSubagentManager(f.create);
  const s = await m.spawn(task("one"));
  f.controls[0]!({ type: "settled", status: "done", finalText: "first" });
  f.controls[0]!({
    type: "settled",
    status: "error",
    finalText: "second",
    errorText: "bad",
  });
  assert.equal(m.get(s.id)?.finalText, "first");
  await m.disposeAll();
  await m.disposeAll();
});

test("folds telemetry, activity, and explicit completion reason", async () => {
  const f = factory(),
    m = createSubagentManager(f.create);
  const s = await m.spawn(task("telemetry"));
  f.controls[0]!({
    type: "tool-start",
    tool: { toolId: "1", name: "read" },
  });
  f.controls[0]!({ type: "activity", activity: "Reading domain.ts" });
  f.controls[0]!({ type: "compaction" });
  f.controls[0]!({ type: "compaction" });
  const current = m.get(s.id)!;
  assert.equal(current.toolUseCount, 1);
  assert.equal(current.compactionCount, 2);
  assert.equal(current.activity, "Reading domain.ts");
  f.controls[0]!({
    type: "settled",
    status: "done",
    reason: "wrapped-up",
    finalText: "summary",
  });
  assert.equal(m.get(s.id)?.completionReason, "wrapped-up");
  assert.equal(m.get(s.id)?.activity, undefined);
  await m.disposeAll();
});

test("launch order follows spawn requests, not factory completion", async () => {
  const f = factory();
  let releaseFirst!: () => void;
  const firstReady = new Promise<void>((resolve) => (releaseFirst = resolve));
  let call = 0;
  const m = createSubagentManager(async () => {
    if (call++ === 0) await firstReady;
    return f.create();
  });
  const first = m.spawn(task("first"));
  const second = await m.spawn(task("second"));
  releaseFirst();
  const firstSnapshot = await first;
  assert.ok(firstSnapshot.launchOrder < second.launchOrder);
  await m.disposeAll();
});

test("user cancellation records stopped rather than child abort", async () => {
  const f = factory(),
    m = createSubagentManager(f.create);
  const s = await m.spawn(task("stop"));
  await m.cancel([s.id]);
  assert.equal(m.get(s.id)?.completionReason, "stopped");
  await m.disposeAll();
});

test("continuation at the running limit rejects without changing settled state", async () => {
  const f = factory(),
    m = createSubagentManager(f.create);
  const settled = await m.spawn(task("settled"));
  f.controls[0]!({
    type: "settled",
    status: "done",
    finalText: "finished",
  });
  await Promise.all(
    Array.from({ length: MAX_RUNNING }, (_, i) =>
      m.spawn(task(`running-${i}`)),
    ),
  );

  await assert.rejects(() => m.send(settled.id, "resume"), /At most 4/);
  const unchanged = m.get(settled.id)!;
  assert.equal(unchanged.status, "done");
  assert.equal(unchanged.completionReason, "completed");
  assert.equal(unchanged.finalText, "finished");
  assert.ok(unchanged.settledAt);
  await m.disposeAll();
});

test("failed continuation settles instead of leaving a hanging running entry", async () => {
  const f = factory();
  const m = createSubagentManager(async () => {
    const child = await f.create();
    child.send = async () => {
      throw new Error("continuation failed");
    };
    return child;
  });
  const s = await m.spawn(task("continue"));
  f.controls[0]!({ type: "settled", status: "done", finalText: "first" });

  await assert.rejects(m.send(s.id, "more"), /continuation failed/);
  const failed = m.get(s.id)!;
  assert.equal(failed.status, "error");
  assert.equal(failed.completionReason, "error");
  assert.equal(failed.errorText, "continuation failed");
  assert.equal(failed.finalText, "first");
  await m.wait([s.id]);
  await m.disposeAll();
});

test("disposeAll clears tracking and subscriptions when child disposal rejects", async () => {
  let listener: (event: SubagentEvent) => void = () => {};
  let unsubscribed = 0;
  let notifications = 0;
  const m = createSubagentManager(async () => ({
    session: {} as any,
    meta: { backend: "pi" },
    subscribe(fn) {
      listener = fn;
      return () => {
        unsubscribed++;
        listener = () => {};
      };
    },
    async send() {},
    async interrupt() {},
    async dispose() {
      throw new Error("dispose failed");
    },
  }));
  await m.spawn(task("rejecting disposal"));
  m.view.subscribe(() => notifications++);

  await m.disposeAll();
  listener({ type: "activity", activity: "late" });
  assert.equal(m.list().length, 0);
  assert.equal(unsubscribed, 1);
  assert.equal(notifications, 0);
});

test("prune removes entries and subscriptions when child disposal rejects", async () => {
  const controls: Array<(event: SubagentEvent) => void> = [];
  let unsubscribed = 0;
  const m = createSubagentManager(async () => {
    let listener: (event: SubagentEvent) => void = () => {};
    controls.push((event) => listener(event));
    return {
      session: {} as any,
      meta: { backend: "pi" },
      subscribe(fn: (event: SubagentEvent) => void) {
        listener = fn;
        return () => {
          unsubscribed++;
          listener = () => {};
        };
      },
      async send() {},
      async interrupt() {},
      async dispose() {
        throw new Error("dispose failed");
      },
    };
  });

  let oldestId = "";
  for (let i = 0; i <= MAX_TRACKED; i++) {
    const snapshot = await m.spawn(task(`settled-${i}`));
    if (i === 0) oldestId = snapshot.id;
    controls[i]!({ type: "settled", status: "done", finalText: "ok" });
  }
  assert.equal(m.list().length, MAX_TRACKED);
  assert.equal(m.get(oldestId), undefined);
  assert.equal(unsubscribed, 1);
  await m.disposeAll();
});
