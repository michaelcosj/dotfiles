import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalManager } from "./src/manager.ts";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for terminal");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("starts a local process, captures output, and settles", async () => {
  const manager = createTerminalManager();
  try {
    const started = await manager.start({
      command: 'printf "hello\\n"',
      title: "finite",
      cwd: process.cwd(),
    });
    assert.match(started.id, /^bt-\d+$/);
    await waitFor(() => manager.view.get(started.id)?.status !== "running");
    const settled = manager.view.get(started.id)!;
    assert.equal(settled.status, "done");
    assert.equal(settled.exitCode, 0);
    assert.equal(settled.stdout.text, "hello\n");
  } finally {
    await manager.disposeAll();
  }
});

test("wait resolves on completion and can return on timeout", async () => {
  const manager = createTerminalManager();
  try {
    const started = await manager.start({
      command: "sleep 0.15",
      title: "waiter",
      cwd: process.cwd(),
    });
    const timedOut = await manager.wait(started.id, 10);
    assert.equal(timedOut.completed, false);
    assert.equal(timedOut.snapshot.status, "running");

    const completed = await manager.wait(started.id, 2_000);
    assert.equal(completed.completed, true);
    assert.equal(completed.snapshot.status, "done");
  } finally {
    await manager.disposeAll();
  }
});

test("kills the whole background job and reports its final state", async () => {
  const manager = createTerminalManager();
  try {
    const started = await manager.start({
      command: "sleep 30",
      title: "sleeper",
      cwd: process.cwd(),
    });
    const [result] = await manager.kill([started.id]);
    assert.equal(result?.wasRunning, true);
    assert.equal(result?.killed, true);
    assert.equal(manager.view.get(started.id)?.status, "killed");
  } finally {
    await manager.disposeAll();
  }
});
