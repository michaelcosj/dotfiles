import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import os from "node:os";

// The bridge runs only in a Rex pane; pretend to be one.
process.env.REX_BLOCK ??= "block:test";
process.env.REX_SESSION ??= "session:test";
delete process.env.HERDR_ENV;
delete process.env.PI_BRIDGE_PARENT;

const hasTailscale = Object.values(os.networkInterfaces()).some((l) =>
  (l ?? []).some((a) => a.family === "IPv4" && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)),
);

const { createBridge, PROTOCOL } = await import("./core.ts");

function hello(address: string, params: Record<string, unknown>): Promise<any> {
  const m = /^tcp:\/\/(.+):(\d+)$/.exec(address)!;
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: m[1], port: Number(m[2]) });
    let buf = "";
    s.setEncoding("utf8");
    s.on("connect", () => s.write(`${JSON.stringify({ id: 1, method: "hello", params: { protocol: PROTOCOL, ...params } })}\n`));
    s.on("data", (d: string) => {
      buf += d;
      if (buf.includes("\n")) {
        s.destroy();
        resolve(JSON.parse(buf.slice(0, buf.indexOf("\n"))));
      }
    });
    s.on("error", reject);
  });
}

describe.skipIf(!hasTailscale)("remote listener", () => {
  const handlers = new Map<string, any>();
  const pi: any = { on: (ev: string, fn: any) => handlers.set(ev, fn), events: { on: () => {}, emit: () => {} } };
  const bridge = createBridge(pi);
  const connected: any[] = [];
  bridge.onClient("connect", (c) => connected.push(c));
  let remote: { address: string; token: string };

  beforeAll(async () => {
    await handlers.get("session_start")({}, { mode: "tui", isIdle: () => true, ui: {} });
    remote = await bridge.listenRemote();
  });
  afterAll(async () => {
    await handlers.get("session_shutdown")({ reason: "quit" });
  });

  test("listens on the Tailscale address with its own token", async () => {
    expect(remote.address).toMatch(/^tcp:\/\/100\.\d+\.\d+\.\d+:\d+$/);
    expect(remote.token).not.toBe(bridge.token);
    expect(await bridge.listenRemote()).toEqual(remote); // once
  });

  test("accepts an agent with the remote token", async () => {
    const r = await hello(remote.address, { token: remote.token, role: "agent", id: "x" });
    expect(r.result?.protocol).toBe(PROTOCOL);
    expect(connected.at(-1)?.remote).toBe(true);
  });

  test("rejects an editor, and the local token", async () => {
    expect((await hello(remote.address, { token: remote.token, role: "editor" })).error?.message).toBe("authentication failed");
    expect((await hello(remote.address, { token: remote.token })).error?.message).toBe("authentication failed");
    expect((await hello(remote.address, { token: bridge.token, role: "agent" })).error?.message).toBe("authentication failed");
  });
});

describe("busy counts", () => {
  test("status events carry busy counts, also when only the counts change", async () => {
    const handlers = new Map<string, any>();
    const listeners = new Map<string, any>();
    const pi: any = { on: (ev: string, fn: any) => handlers.set(ev, fn), events: { on: (ev: string, fn: any) => listeners.set(ev, fn), emit: () => {} } };
    const bridge = createBridge(pi);
    await handlers.get("session_start")({}, { mode: "tui", isIdle: () => true, ui: {} });
    try {
      const lines: any[] = [];
      const s = net.createConnection({ path: bridge.socketPath! });
      s.setEncoding("utf8");
      let buf = "";
      s.on("data", (d: string) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          lines.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
        }
      });
      await new Promise((r) => s.on("connect", r));
      s.write(`${JSON.stringify({ id: 1, method: "hello", params: { protocol: PROTOCOL, token: bridge.token, role: "editor" } })}\n`);
      const until = async (fn: () => boolean) => {
        for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
      };
      await until(() => lines.length > 0);
      expect(lines[0].result.busy).toEqual({ agents: 0, background: 0 });

      listeners.get("bridge:busy")({ source: "agents", count: 2 });
      listeners.get("bridge:busy")({ source: "background", count: 1 });
      listeners.get("bridge:busy")({ source: "background", count: 1 }); // no change, no event
      listeners.get("bridge:busy")({ source: "other", count: 5 }); // ignored
      await until(() => lines.filter((l) => l.event === "status").length >= 2);
      await new Promise((r) => setTimeout(r, 30));
      const status = lines.filter((l) => l.event === "status").map((l) => l.data);
      expect(status.map((d) => d.busy)).toEqual([{ agents: 2, background: 0 }, { agents: 2, background: 1 }]);
      expect(status.every((d) => d.state === "idle")).toBe(true);
      s.destroy();
    } finally {
      await handlers.get("session_shutdown")({ reason: "quit" });
    }
  });
});
