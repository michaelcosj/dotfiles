import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubagentSnapshot } from "./src/domain.ts";
import type { SubagentManager, SubagentReadModel } from "./src/manager.ts";
import {
  WAIT_UPDATE_MAX_BYTES,
  buildWaitUpdate,
  orderAwaitedSnapshots,
  waitCallText,
  waitDetailsFromSnapshots,
  waitResultText,
  waitTreeText,
  waitWithLiveUpdates,
} from "./src/ui/wait-tool.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function snapshot(
  id: string,
  createdAt: number,
  overrides: Partial<SubagentSnapshot> = {},
): SubagentSnapshot {
  return {
    id,
    origin: "model",
    backend: "pi",
    title: id,
    prompt: "go",
    cwd: "/tmp",
    status: "running",
    launchOrder: createdAt,
    createdAt,
    meta: { backend: "pi", modelLabel: "claude" },
    usage: { tokens: 1_250, contextWindow: 200_000 },
    transcript: [],
    liveAssistant: { text: "", thinking: "" },
    liveTools: [],
    queued: [],
    finalText: "",
    turns: 2,
    toolUseCount: 0,
    compactionCount: 0,
    ...overrides,
  };
}

function managerHarness(initial: SubagentSnapshot[]) {
  let snapshots = initial;
  const listeners = new Set<() => void>();
  let resolveWait!: () => void;
  let rejectWait!: (error: Error) => void;
  const waiting = new Promise<void>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  let cancelCalls = 0;
  let waitSignal: AbortSignal | undefined;
  const view: SubagentReadModel = {
    list: () => snapshots,
    get: (id) => snapshots.find((item) => item.id === id),
    size: () => snapshots.length,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeTo: () => () => {},
    requestSend: async () => {},
    requestAbort: async () => {},
  };
  const manager = {
    view,
    spawn: async () => {
      throw new Error("not used");
    },
    async wait(_ids: string[], signal?: AbortSignal) {
      waitSignal = signal;
      if (signal?.aborted) throw new Error("Operation aborted");
      const abort = () => rejectWait(new Error("Operation aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await waiting;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    async cancel() {
      cancelCalls++;
      return [];
    },
    send: async () => {},
    get: (id: string) => snapshots.find((item) => item.id === id),
    list: () => snapshots,
    disposeAll: async () => {},
    setOnSettled() {},
  } as SubagentManager;
  return {
    manager,
    listeners,
    resolveWait,
    emit(next: SubagentSnapshot[]) {
      snapshots = next;
      listeners.forEach((listener) => listener());
    },
    get cancelCalls() {
      return cancelCalls;
    },
    get waitSignal() {
      return waitSignal;
    },
  };
}

test("awaited agents are ordered earliest first with stable ties", () => {
  const ordered = orderAwaitedSnapshots([
    snapshot("sub-3", 20),
    snapshot("sub-2", 10),
    snapshot("sub-1", 10),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["sub-1", "sub-2", "sub-3"],
  );
});

test("partial update is a bounded Claude-style Agents tree", () => {
  const long = "x".repeat(WAIT_UPDATE_MAX_BYTES * 2);
  const current = snapshot("sub-1", 10, {
    title: long,
    activity: long,
  });
  const view = managerHarness([current]).manager.view;
  const update = buildWaitUpdate(view, ["sub-1"]);
  assert.ok(
    Buffer.byteLength(update.content[0]!.text) <= WAIT_UPDATE_MAX_BYTES,
  );
  assert.ok(update.details.agents[0]!.title.length <= 100);
  assert.ok((update.details.agents[0]!.activity?.length ?? 0) <= 160);
  assert.match(update.content[0]!.text, /^Agents\n└─ ●/);
});

test("wait publishes initially, throttles snapshots, and always unsubscribes", async () => {
  const first = snapshot("sub-1", Date.now());
  const harness = managerHarness([first]);
  const updates: ReturnType<typeof buildWaitUpdate>[] = [];
  const waiting = waitWithLiveUpdates(
    harness.manager,
    ["sub-1"],
    undefined,
    (update) => updates.push(update),
    20,
  );

  assert.equal(updates.length, 1);
  assert.equal(harness.listeners.size, 1);
  harness.emit([{ ...first, activity: "Reading" }]);
  harness.emit([{ ...first, activity: "Writing" }]);
  assert.equal(updates.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(updates.length, 2);
  assert.match(updates[1]!.content[0]!.text, /Writing/);

  harness.resolveWait();
  const settled = await waiting;
  assert.equal(settled[0]!.id, "sub-1");
  assert.equal(harness.listeners.size, 0);
});

test("aborting wait unsubscribes without cancelling children", async () => {
  const child = snapshot("sub-1", Date.now());
  const harness = managerHarness([child]);
  const controller = new AbortController();
  const waiting = waitWithLiveUpdates(
    harness.manager,
    ["sub-1"],
    controller.signal,
    () => {},
    20,
  );
  assert.equal(harness.waitSignal, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /Operation aborted/);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.cancelCalls, 0);
  assert.equal(harness.manager.get("sub-1")?.status, "running");
});

test("wait renderers keep live and final results coherent and expandable", () => {
  const done = snapshot("sub-1", 10, {
    status: "done",
    settledAt: 20,
    finalText: "short answer",
  });
  const details = waitDetailsFromSnapshots([done], true, 20);
  assert.equal(waitCallText(["sub-1"], theme), "subagent_wait 1 agent");
  assert.match(waitTreeText(details, theme), /^Agents\n└─ ✓ sub-1/);

  const result = {
    content: [{ type: "text" as const, text: "FULL OUTPUT ONLY" }],
    details,
  };
  const partial = waitResultText(
    result,
    {
      expanded: false,
      isPartial: true,
    },
    theme,
  );
  assert.match(partial, /^Agents\n└─ ✓ sub-1/);
  assert.doesNotMatch(partial, /FULL OUTPUT ONLY/);

  const collapsed = waitResultText(
    result,
    {
      expanded: false,
      isPartial: false,
    },
    theme,
  );
  assert.match(collapsed, /short answer/);
  assert.match(collapsed, /ctrl\+o to expand outputs/);
  assert.doesNotMatch(collapsed, /FULL OUTPUT ONLY/);

  const expanded = waitResultText(
    result,
    {
      expanded: true,
      isPartial: false,
    },
    theme,
  );
  assert.match(expanded, /Outputs\nFULL OUTPUT ONLY$/);
});
