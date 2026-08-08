import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "bun:test";
import { createBackgroundTerminalRuntime } from "../../src/features/background-terminals/runtime.ts";
import { MAX_SETTLED_HISTORY } from "../../src/features/background-terminals/manager.ts";


test("retains pending spill logs through history pruning", async () => {
  let sent = 0;
  const runtime = createBackgroundTerminalRuntime({
    sendMessage() {
      sent++;
    },
  } as any);
  runtime.setSessionContext({ hasUI: false, isIdle: () => false } as any);
  const manager = runtime.getManager();
  let spillPath: string | undefined;

  try {
    const bytes = 2 * 1024 * 1024 + 4096;
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.stdout.write("x".repeat(${bytes}))`)}`;
    const started = await manager.start({
      command,
      title: "pending-spill",
      cwd: process.cwd(),
    });
    const settled = await manager.wait(started.id, 10_000);
    spillPath = settled.snapshot.stdout.spillPath;
    if (!spillPath) throw new Error("expected a spill path");
    assert.equal(sent, 0, "non-idle session must leave delivery pending");

    for (let i = 0; i <= MAX_SETTLED_HISTORY; i++) {
      const extra = await manager.start({
        command: "true",
        title: `history-${i}`,
        cwd: process.cwd(),
      });
      await manager.wait(extra.id, 2_000);
    }

    assert.equal(manager.view.get(started.id), undefined);
    const claim = runtime.delivery.take(started.id);
    assert.equal(claim?.result.stdout.spillPath, spillPath);
    assert.equal(existsSync(spillPath), true);
  } finally {
    await runtime.shutdown();
  }

  assert.equal(existsSync(spillPath!), false);
});

test("shutdown does not requeue settlements from disposed terminals", async () => {
  const runtime = createBackgroundTerminalRuntime({
    sendMessage() {},
  } as any);
  const manager = runtime.getManager();
  const started = await manager.start({
    command: "sleep 30",
    title: "shutdown-race",
    cwd: process.cwd(),
  });

  try {
    await runtime.shutdown();

    assert.deepEqual(runtime.delivery.takeAll(), []);
    assert.equal(manager.view.get(started.id), undefined);
  } finally {
    await runtime.shutdown();
  }
});
