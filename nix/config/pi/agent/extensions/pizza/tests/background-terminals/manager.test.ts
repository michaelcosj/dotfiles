import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { test } from "bun:test";
import {
  createTerminalManager,
  MAX_SETTLED_HISTORY,
} from "../../src/features/background-terminals/manager.ts";

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

test("persists complete output beyond the memory cap and cleans logs", async () => {
  const manager = createTerminalManager();
  const bytes = 2 * 1024 * 1024 + 4096;
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.stdout.write("x".repeat(${bytes}))`)}`;
  const started = await manager.start({ command, title: "large", cwd: process.cwd() });
  await manager.wait(started.id, 10_000);
  const snap = manager.view.get(started.id)!;
  assert.ok(snap.stdout.truncatedBytes > 0);
  assert.ok(snap.stdout.spillPath, "a real spill path is reported");
  assert.equal(readFileSync(snap.stdout.spillPath!).length, bytes);
  const path = snap.stdout.spillPath!;
  await manager.disposeAll();
  assert.equal(existsSync(path), false);
});

test("output chunks do not trigger lifecycle subscribers", async () => {
  const manager = createTerminalManager();
  let lifecycle = 0;
  const unsubscribe = manager.view.subscribe(() => lifecycle++);
  try {
    const started = await manager.start({ command: 'printf "a"; sleep 0.05; printf "b"', title: "chunks", cwd: process.cwd() });
    await manager.wait(started.id, 2_000);
    assert.equal(lifecycle, 2, "start and settlement only");
  } finally {
    unsubscribe();
    await manager.disposeAll();
  }
});

test("prunes only the oldest settled history", async () => {
  const manager = createTerminalManager();
  try {
    let first = "";
    for (let i = 0; i <= MAX_SETTLED_HISTORY; i++) {
      const snap = await manager.start({ command: "true", title: `finite-${i}`, cwd: process.cwd() });
      first ||= snap.id;
      await manager.wait(snap.id, 2_000);
    }
    assert.equal(manager.view.size(), MAX_SETTLED_HISTORY);
    assert.equal(manager.view.get(first), undefined);
  } finally {
    await manager.disposeAll();
  }
});

test("view.requestKill classifies a normal sleeper as killed", async () => {
  const manager = createTerminalManager();
  try {
    const started = await manager.start({ command: "sleep 30", title: "ui-kill", cwd: process.cwd() });
    manager.commands.requestKill(started.id);
    const settled = await manager.wait(started.id, 4_000);
    assert.equal(settled.completed, true);
    assert.equal(settled.snapshot.status, "killed");
    assert.match(settled.snapshot.signal ?? "", /^SIG(?:TERM|KILL)$/);
  } finally {
    await manager.disposeAll();
  }
});

test("a SIGTERM handler that exits zero wins the bg_kill race", async () => {
  if (process.platform === "win32") return;
  const manager = createTerminalManager();
  try {
    const started = await manager.start({
      command: `trap 'exit 0' TERM; echo ready; while :; do sleep 1; done`,
      title: "clean-race",
      cwd: process.cwd(),
    });
    await waitFor(() => manager.view.get(started.id)?.stdout.text.includes("ready") ?? false);
    const [result] = await manager.kill([started.id]);
    assert.equal(result?.status, "done");
    const snapshot = manager.view.get(started.id)!;
    assert.equal(snapshot.exitCode, 0);
    assert.equal(snapshot.signal, undefined);
    assert.equal(result?.wasRunning, true);
    assert.equal(result?.killed, false);
    assert.equal(result?.exit, "exit 0");
  } finally {
    await manager.disposeAll();
  }
});

test("process exit prevents kill escalation while spill logs finish closing", async () => {
  const manager = createTerminalManager({
    createLogStream: () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          setTimeout(callback, 200);
        },
      }),
    logCloseTimeoutMs: 500,
    terminateGraceMs: 20,
    killConfirmationMs: 20,
  });
  try {
    const started = await manager.start({
      command: `printf 'done\\n'`,
      title: "slow-log-close",
      cwd: process.cwd(),
    });
    await waitFor(
      () => manager.view.get(started.id)?.stdout.text.includes("done") ?? false,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const [result] = await manager.kill([started.id]);
    const snapshot = manager.view.get(started.id)!;
    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.exitCode, 0);
    assert.equal(snapshot.signal, undefined);
    assert.equal(result?.status, "done");
    assert.equal(result?.exit, "exit 0");
  } finally {
    await manager.disposeAll();
  }
});

test("writer errors disable the full log without blocking settlement", async () => {
  const manager = createTerminalManager({
    createLogStream: () => new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(new Error("disk failed")));
      },
    }),
    logCloseTimeoutMs: 100,
  });
  try {
    const started = await manager.start({ command: `printf 'enough output'`, title: "spill-error", cwd: process.cwd() });
    const settled = await manager.wait(started.id, 2_000);
    assert.equal(settled.completed, true);
    assert.equal(settled.snapshot.status, "done");
    assert.equal(settled.snapshot.stdout.text, "enough output");
    assert.equal(settled.snapshot.stdout.spillPath, undefined);
  } finally {
    await manager.disposeAll();
  }
});

test("a log writer that never closes is bounded and marked unavailable", async () => {
  const manager = createTerminalManager({
    createLogStream: () => new Writable({ final() {} }),
    logCloseTimeoutMs: 30,
  });
  try {
    const started = await manager.start({ command: "true", title: "stuck-log", cwd: process.cwd() });
    const settled = await manager.wait(started.id, 1_000);
    assert.equal(settled.completed, true);
    assert.equal(settled.snapshot.status, "done");
    assert.equal(settled.snapshot.stdout.spillPath, undefined);
    assert.equal(settled.snapshot.stderr.spillPath, undefined);
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
