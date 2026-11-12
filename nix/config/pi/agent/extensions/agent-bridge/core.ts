// The bridge core: a line-JSON socket that other programs connect to.
// Each client says who it is in hello ({ role }): "editor" (Neovim, the
// default for older clients) or "agent" (a child pi, see agents/). Plugins
// add methods per role and send events to one role; the core owns the
// socket, auth, discovery, and pi's working/blocked state.
//
// Wire format, one JSON object per line:
//   request  { id, method, params }  ->  response { id, result } | { id, error: { message } }
//   event    { event, data }          (server to client only)
//
// A child pi (PI_BRIDGE_PARENT set) runs no server, so editors can't find
// it; it connects up to its parent instead.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const PROTOCOL = "1";
const SOURCE = "pi-control-bridge"; // herdr metadata source name
const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const HERDR_PANE_ID = process.env.HERDR_PANE_ID;
const HERDR_ENABLED = process.env.HERDR_ENV === "1" && !!HERDR_SOCKET_PATH && !!HERDR_PANE_ID;
const HERDR_ENDPOINT =
  process.platform === "win32" && HERDR_SOCKET_PATH ? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}` : HERDR_SOCKET_PATH;
// In a Rex pane there is no herdr metadata; Neovim finds pi through a
// discovery file beside the socket instead (<runtime dir>/<block>.json).
const REX_BLOCK = process.env.REX_BLOCK;
const REX_SESSION = process.env.REX_SESSION;
const REX_ENABLED = !HERDR_ENABLED && !!REX_BLOCK && !!REX_SESSION;
export const PANE_ID = HERDR_ENABLED ? HERDR_PANE_ID : REX_BLOCK;
export const IS_CHILD = !!process.env.PI_BRIDGE_PARENT;
export const MAX_LINE_BYTES = 1024 * 1024;

export type Role = "editor" | "agent";
export type BridgeState = "idle" | "working" | "blocked";
export interface Client {
  socket: net.Socket;
  /** came in over the TCP listener (a child on another host) */
  remote?: boolean;
  authenticated: boolean;
  buffer: string;
  role: Role;
  /** hello params, for plugins (e.g. an agent's id) */
  info: Record<string, unknown>;
}
type Handler = (client: Client, params: any) => unknown | Promise<unknown>;
type Pending = { waiting: Set<Client>; resolve: (value: any) => void };
type WidgetPart = { order: number; render: (theme: any) => string | undefined };

// Kept across /reload so connected children can reconnect with the same token.
// The TCP listener for children on other hosts is kept too: it stays bound,
// so their address does not change; a reload only swaps its handler.
const g = globalThis as {
  __piBridgeToken?: string;
  __piBridgeRemote?: { server: net.Server; address: string; token: string; attach?: (s: net.Socket) => void };
};

/** This machine's Tailscale IPv4 address (100.64.0.0/10), if it has one. */
function tailscaleIP(): string | undefined {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [x, y] = a.address.split(".").map(Number);
      if (x === 100 && y >= 64 && y < 128) return a.address;
    }
  return undefined;
}

/** OSC 7501 program status on pi's own terminal, in a child record so pi's
 * own status (the root record) is untouched. Rex shows it on the tab. */
export function programStatus(id: string, state: "blocked" | "clear", msg?: string) {
  if (!process.stdout.isTTY) return;
  const pairs = [`id=${id}`, `state=${state}`, "app=pi"];
  if (state === "blocked") {
    pairs.push("kind=permission");
    if (msg) pairs.push(`msg=${Buffer.from(msg.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 200)).toString("base64")}`);
  }
  process.stdout.write(`\x1b]7501;${pairs.join(":")}\x1b\\`);
}

function herdrRequest(method: string, params: Record<string, unknown>): Promise<void> {
  if (!HERDR_ENABLED) return Promise.resolve();
  return new Promise((resolve) => {
    const socket = net.createConnection(HERDR_ENDPOINT!);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve();
    };
    socket.once("error", finish);
    socket.once("connect", () =>
      socket.write(
        `${JSON.stringify({ id: `${SOURCE}:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`, method, params })}\n`,
      ),
    );
    socket.once("data", finish);
    socket.once("end", finish);
    const timer = setTimeout(finish, 1500);
    timer.unref?.();
  });
}

export type Bridge = ReturnType<typeof createBridge>;

export function createBridge(pi: any) {
  let server: net.Server | undefined;
  let runtimeDir: string | undefined;
  let socketPath: string | undefined;
  let discoveryPath: string | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let active = false;
  let blockedCount = 0;
  let blockedMessage: string | undefined;
  let state: BridgeState = "idle";
  const clients = new Set<Client>();
  const methods = new Map<string, Handler>(); // `${role}:${name}`
  const listeners = { connect: [] as ((c: Client) => void)[], disconnect: [] as ((c: Client) => void)[] };
  const pending = new Map<string, Pending>();
  const widgetParts = new Map<string, WidgetPart>();
  const shutdownHooks: ((reason: string) => Promise<void> | void)[] = [];
  const WIDGET_KEY = "pi-editor";

  const bridge = {
    ctx: undefined as any,
    get running() {
      return !!server;
    },
    get socketPath() {
      return socketPath;
    },
    get token() {
      return g.__piBridgeToken;
    },

    /**
     * Opens (once) a TCP listener on this machine's Tailscale address for
     * children on other hosts. It has its own token, and only agents may
     * connect through it. Tailscale encrypts the traffic.
     */
    async listenRemote(): Promise<{ address: string; token: string }> {
      if (!server) throw new Error("the agent bridge is not running in this pi");
      const r = g.__piBridgeRemote;
      if (r) {
        r.attach = (s) => attach(s, true);
        return { address: r.address, token: r.token };
      }
      const ip = tailscaleIP();
      if (!ip) throw new Error("this machine has no Tailscale address for remote agents to reach");
      // During a reload there is no handler for a moment; the child retries.
      const tcp = net.createServer((s) => {
        const fn = g.__piBridgeRemote?.attach;
        if (fn) fn(s);
        else s.destroy();
      });
      await new Promise<void>((resolve, reject) => {
        tcp.once("error", reject);
        tcp.listen(0, ip, () => {
          tcp.removeListener("error", reject);
          resolve();
        });
      });
      tcp.on("error", () => {});
      const port = (tcp.address() as net.AddressInfo).port;
      g.__piBridgeRemote = { server: tcp, address: `tcp://${ip}:${port}`, token: crypto.randomBytes(24).toString("hex"), attach: (s) => attach(s, true) };
      return { address: g.__piBridgeRemote.address, token: g.__piBridgeRemote.token };
    },

    clients(role: Role) {
      return [...clients].filter((c) => c.authenticated && c.role === role && !c.socket.destroyed);
    },

    registerMethod(role: Role, name: string, handler: Handler) {
      methods.set(`${role}:${name}`, handler);
    },

    onClient(kind: "connect" | "disconnect", fn: (c: Client) => void) {
      listeners[kind].push(fn);
    },

    /** Runs, awaited, before the socket closes on session_shutdown. */
    onShutdown(fn: (reason: string) => Promise<void> | void) {
      shutdownHooks.push(fn);
    },

    send(client: Client, value: unknown) {
      if (!client.socket.destroyed) client.socket.write(`${JSON.stringify(value)}\n`);
    },

    event(client: Client, event: string, data: Record<string, unknown> = {}) {
      bridge.send(client, { event, data });
    },

    broadcast(role: Role, event: string, data: Record<string, unknown> = {}) {
      for (const c of bridge.clients(role)) bridge.event(c, event, data);
    },

    /**
     * Sends a request to every client with `role`. Each answers with a
     * result or { pass: true }; the first result wins. If all pass or
     * disconnect, resolves undefined.
     */
    ask(role: Role, kind: string, payload: Record<string, unknown>, opts: { signal?: AbortSignal; status?: string; onWait?: (id: string, waiting: boolean) => void } = {}) {
      const targets = bridge.clients(role);
      if (targets.length === 0) return Promise.resolve(undefined);
      const requestId = crypto.randomBytes(8).toString("hex");
      const { signal } = opts;
      return new Promise<any>((resolve) => {
        let settled = false;
        const finish = (value: any) => {
          if (settled) return;
          settled = true;
          pending.delete(requestId);
          signal?.removeEventListener("abort", onAbort);
          bridge.broadcast(role, "request_done", { request_id: requestId });
          programStatus(`review-${requestId}`, "clear");
          opts.onWait?.(requestId, false);
          resolve(value);
        };
        const onAbort = () => finish({ aborted: true });
        if (signal?.aborted) return finish({ aborted: true });
        signal?.addEventListener("abort", onAbort);
        pending.set(requestId, { waiting: new Set(targets), resolve: finish });
        programStatus(`review-${requestId}`, "blocked", opts.status);
        opts.onWait?.(requestId, true);
        for (const client of targets) bridge.event(client, "request", { request_id: requestId, kind, ...payload });
      });
    },

    /** Shared widget line above the editor; parts render in `order`. */
    setWidgetPart(key: string, order: number, render: WidgetPart["render"] | undefined) {
      if (render) widgetParts.set(key, { order, render });
      else widgetParts.delete(key);
      bridge.renderWidget();
    },

    renderWidget() {
      const ui = bridge.ctx?.ui;
      if (bridge.ctx?.mode !== "tui" || !ui?.setWidget || !ui.theme) return;
      const t = ui.theme;
      const parts = [...widgetParts.values()]
        .sort((a, b) => a.order - b.order)
        .map((p) => p.render(t))
        .filter((s): s is string => !!s);
      ui.setStatus(WIDGET_KEY, undefined); // clear the former footer entry
      ui.setWidget(WIDGET_KEY, parts.length ? [parts.join(t.fg("dim", " · "))] : undefined, { placement: "aboveEditor" });
    },

    get state() {
      return state;
    },
    get blockedMessage() {
      return blockedMessage;
    },
  };

  function desiredState(): BridgeState {
    return blockedCount > 0 ? "blocked" : active ? "working" : "idle";
  }

  function publishState(force = false) {
    const next = desiredState();
    if (!force && next === state) return;
    state = next;
    bridge.broadcast("editor", "status", { state, message: blockedMessage, pane_id: PANE_ID });
    pi.events.emit("bridge:state", { state, message: blockedMessage });
  }

  function writeDiscovery() {
    if (!REX_ENABLED || !runtimeDir) return;
    discoveryPath = path.join(runtimeDir, `${REX_BLOCK!.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
    const data = {
      pane_id: REX_BLOCK,
      rex_session: REX_SESSION,
      pid: process.pid,
      cwd: bridge.ctx?.cwd ?? process.cwd(),
      tokens: {
        pi_control_socket: socketPath,
        pi_control_token: g.__piBridgeToken,
        pi_control_protocol: PROTOCOL,
        pi_instance_id: PANE_ID,
      },
    };
    fs.writeFileSync(`${discoveryPath}.tmp`, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(`${discoveryPath}.tmp`, discoveryPath);
  }

  async function reportMetadata(clear = false) {
    if (!HERDR_ENABLED) return;
    const tokens = clear
      ? { pi_control_socket: null, pi_control_token: null, pi_control_protocol: null, pi_instance_id: null }
      : { pi_control_socket: socketPath, pi_control_token: g.__piBridgeToken, pi_control_protocol: PROTOCOL, pi_instance_id: PANE_ID };
    await herdrRequest("pane.report_metadata", {
      pane_id: HERDR_PANE_ID,
      source: SOURCE,
      seq: Date.now(),
      ttl_ms: clear ? 1 : 15000,
      tokens,
    });
  }

  function response(client: Client, id: unknown, result?: unknown, error?: string) {
    bridge.send(client, error ? { id, error: { message: error } } : { id, result });
  }

  async function handleRequest(client: Client, request: any) {
    const id = request?.id;
    if (!request || typeof request.method !== "string") return response(client, id, undefined, "invalid request");
    if (request.method === "hello") {
      const p = request.params ?? {};
      const want = client.remote ? g.__piBridgeRemote?.token : g.__piBridgeToken;
      if (p.protocol !== PROTOCOL || !want || p.token !== want || (client.remote && p.role !== "agent")) {
        response(client, id, undefined, "authentication failed");
        client.socket.end();
        return;
      }
      client.authenticated = true;
      client.role = p.role === "agent" ? "agent" : "editor";
      client.info = p;
      response(client, id, { protocol: PROTOCOL, pane_id: PANE_ID, instance_id: PANE_ID, state });
      for (const fn of listeners.connect) fn(client);
      setImmediate(() => bridge.renderWidget());
      return;
    }
    if (!client.authenticated) return response(client, id, undefined, "hello required");
    if (request.method === "ping" || request.method === "get_state")
      return response(client, id, { state, message: blockedMessage, pane_id: PANE_ID });
    if (request.method === "respond") {
      const entry = pending.get(request.params?.request_id);
      if (!entry) return response(client, id, { accepted: false });
      const result = request.params?.result;
      if (!result || result.pass) {
        entry.waiting.delete(client);
        if (entry.waiting.size === 0) entry.resolve(undefined);
      } else entry.resolve(result);
      return response(client, id, { accepted: true });
    }
    const handler = methods.get(`${client.role}:${request.method}`);
    if (!handler) return response(client, id, undefined, `unknown method: ${request.method}`);
    try {
      response(client, id, (await handler(client, request.params ?? {})) ?? { accepted: true });
    } catch (error) {
      response(client, id, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  function attach(socket: net.Socket, remote = false) {
    const client: Client = { socket, remote, authenticated: false, buffer: "", role: "editor", info: {} };
    if (remote) {
      // Notice a host that vanished (sleep, network) instead of waiting forever.
      socket.setKeepAlive(true, 15_000);
      socket.setNoDelay(true);
    }
    clients.add(client);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      client.buffer += chunk;
      if (Buffer.byteLength(client.buffer) > MAX_LINE_BYTES) return socket.destroy();
      while (true) {
        const newline = client.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = client.buffer.slice(0, newline);
        client.buffer = client.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          response(client, null, undefined, "invalid JSON");
          continue;
        }
        void handleRequest(client, request);
      }
    });
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      clients.delete(client);
      for (const entry of pending.values()) {
        entry.waiting.delete(client);
        if (entry.waiting.size === 0) entry.resolve(undefined);
      }
      if (client.authenticated) for (const fn of listeners.disconnect) fn(client);
      bridge.renderWidget();
    };
    socket.on("close", remove);
    socket.on("error", remove);
  }

  async function start(ctx: any) {
    if (server || IS_CHILD || ctx?.mode !== "tui" || (!HERDR_ENABLED && !REX_ENABLED)) return;
    runtimeDir = path.join(os.tmpdir(), `pi-control-${process.getuid?.() ?? "user"}`);
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    socketPath = path.join(
      runtimeDir,
      // macOS caps socket paths at 104 bytes, and Rex block IDs are long
      HERDR_ENABLED
        ? `${PANE_ID!.replace(/[^A-Za-z0-9_-]/g, "_")}.sock`
        : `${crypto.createHash("sha256").update(PANE_ID!).digest("hex").slice(0, 16)}.sock`,
    );
    g.__piBridgeToken ??= crypto.randomBytes(24).toString("hex");
    try {
      fs.unlinkSync(socketPath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    server = net.createServer(attach);
    server.on("error", (error) => bridge.broadcast("editor", "error", { message: error.message }));
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => {
        server!.removeListener("error", reject);
        try {
          fs.chmodSync(socketPath!, 0o600);
        } catch {}
        resolve();
      });
    });
    // After a reload, remote children reconnect through the kept listener.
    if (g.__piBridgeRemote) g.__piBridgeRemote.attach = (s) => attach(s, true);
    writeDiscovery();
    await reportMetadata();
    refreshTimer = setInterval(() => void reportMetadata(), 5000);
    refreshTimer.unref?.();
    publishState(true);
    bridge.broadcast("editor", "connected", { pane_id: PANE_ID });
  }

  async function stop(reason?: string) {
    if (g.__piBridgeRemote) {
      if (reason === "reload" || reason === "fork") g.__piBridgeRemote.attach = undefined; // until the new module starts
      else {
        g.__piBridgeRemote.server.close();
        g.__piBridgeRemote = undefined;
      }
    }
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    await reportMetadata(true);
    for (const client of clients) client.socket.destroy();
    clients.clear();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    for (const file of [socketPath, discoveryPath])
      if (file)
        try {
          fs.unlinkSync(file);
        } catch {}
    discoveryPath = undefined;
    bridge.ctx?.ui?.setStatus?.(WIDGET_KEY, undefined);
    bridge.ctx?.ui?.setWidget?.(WIDGET_KEY, undefined);
  }

  // "herdr:blocked" is the shared "waiting for the user" signal (questionnaire, background questions).
  // It also raises a Rex alert on this pane, so the tab and app show that pi waits.
  pi.events.on("herdr:blocked", (data: any) => {
    const was = blockedCount;
    if (data?.active) {
      blockedCount += 1;
      blockedMessage = data.label;
    } else {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) blockedMessage = undefined;
    }
    if (blockedCount > 0 && (was === 0 || data?.active)) programStatus("question", "blocked", blockedMessage ?? "pi needs an answer");
    else if (blockedCount === 0 && was > 0) programStatus("question", "clear");
    publishState();
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    bridge.ctx = ctx;
    active = ctx?.isIdle?.() === false;
    await start(ctx);
    bridge.renderWidget();
  });
  pi.on("agent_start", (_event: any, ctx: any) => {
    bridge.ctx = ctx;
    active = true;
    publishState();
    bridge.broadcast("editor", "agent_start");
  });
  pi.on("agent_settled", (_event: any, ctx: any) => {
    bridge.ctx = ctx;
    if (ctx?.isIdle?.() === true) active = false;
    publishState();
    bridge.broadcast("editor", "agent_settled");
  });
  pi.on("session_shutdown", async (event: any) => {
    if (blockedCount > 0) programStatus("question", "clear");
    for (const fn of shutdownHooks) {
      try {
        await fn(event?.reason ?? "quit");
      } catch {}
    }
    bridge.broadcast("editor", "shutdown");
    await stop(event?.reason);
    bridge.ctx = undefined;
  });

  (globalThis as any).__piBridge = bridge;
  return bridge;
}
