import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PROTOCOL = "1";
const SOURCE = "pi-nvim-bridge";
const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const HERDR_PANE_ID = process.env.HERDR_PANE_ID;
const HERDR_ENABLED =
  process.env.HERDR_ENV === "1" && !!HERDR_SOCKET_PATH && !!HERDR_PANE_ID;
const HERDR_ENDPOINT =
  process.platform === "win32" && HERDR_SOCKET_PATH
    ? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
    : HERDR_SOCKET_PATH;
const MAX_LINE_BYTES = 1024 * 1024;

type BridgeState = "idle" | "working" | "blocked";
type Client = { socket: net.Socket; authenticated: boolean; buffer: string };

function herdrRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
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
        `${JSON.stringify({
          id: `${SOURCE}:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`,
          method,
          params,
        })}\n`,
      ),
    );
    socket.once("data", finish);
    socket.once("end", finish);
    const timer = setTimeout(finish, 1500);
    timer.unref?.();
  });
}

export default function (pi: any) {
  let server: net.Server | undefined;
  let runtimeDir: string | undefined;
  let socketPath: string | undefined;
  let token: string | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let currentCtx: any;
  let active = false;
  let blockedCount = 0;
  let blockedMessage: string | undefined;
  let state: BridgeState = "idle";
  const clients = new Set<Client>();
  const toolArgs = new Map<string, { toolName: string; args: any }>();

  function send(client: Client, value: unknown) {
    if (!client.socket.destroyed)
      client.socket.write(`${JSON.stringify(value)}\n`);
  }

  function broadcast(event: string, data: Record<string, unknown> = {}) {
    for (const client of clients) {
      if (client.authenticated) send(client, { event, data });
    }
  }

  function desiredState(): BridgeState {
    return blockedCount > 0 ? "blocked" : active ? "working" : "idle";
  }

  function publishState(force = false) {
    const next = desiredState();
    if (!force && next === state) return;
    state = next;
    broadcast("status", {
      state,
      message: blockedMessage,
      pane_id: HERDR_PANE_ID,
    });
  }

  async function reportMetadata(clear = false) {
    if (!HERDR_ENABLED) return;
    await herdrRequest("pane.report_metadata", {
      pane_id: HERDR_PANE_ID,
      source: SOURCE,
      seq: Date.now(),
      ttl_ms: clear ? 1 : 15000,
      tokens: clear
        ? { pi_nvim_socket: null, pi_nvim_token: null, pi_nvim_protocol: null }
        : {
            pi_nvim_socket: socketPath,
            pi_nvim_token: token,
            pi_nvim_protocol: PROTOCOL,
          },
    });
  }

  function response(
    client: Client,
    id: unknown,
    result?: unknown,
    error?: string,
  ) {
    send(client, error ? { id, error: { message: error } } : { id, result });
  }

  function handleRequest(client: Client, request: any) {
    const id = request?.id;
    if (!request || typeof request.method !== "string") {
      response(client, id, undefined, "invalid request");
      return;
    }
    if (request.method === "hello") {
      if (
        request.params?.protocol !== PROTOCOL ||
        request.params?.token !== token
      ) {
        response(client, id, undefined, "authentication failed");
        client.socket.end();
        return;
      }
      client.authenticated = true;
      response(client, id, {
        protocol: PROTOCOL,
        pane_id: HERDR_PANE_ID,
        state,
      });
      return;
    }
    if (!client.authenticated) {
      response(client, id, undefined, "hello required");
      return;
    }
    if (request.method === "ping" || request.method === "get_state") {
      response(client, id, {
        state,
        message: blockedMessage,
        pane_id: HERDR_PANE_ID,
      });
      return;
    }
    if (request.method === "prompt") {
      const text = request.params?.text;
      if (
        typeof text !== "string" ||
        text.trim() === "" ||
        Buffer.byteLength(text) > MAX_LINE_BYTES
      ) {
        response(client, id, undefined, "invalid prompt");
        return;
      }
      try {
        if (currentCtx?.isIdle?.() === false)
          pi.sendUserMessage(text, { deliverAs: "followUp" });
        else pi.sendUserMessage(text);
        response(client, id, { accepted: true });
      } catch (error) {
        response(
          client,
          id,
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
    if (request.method === "append_prompt") {
      const text = request.params?.text;
      if (
        typeof text !== "string" ||
        Buffer.byteLength(text) > MAX_LINE_BYTES ||
        currentCtx?.mode !== "tui"
      ) {
        response(client, id, undefined, "cannot append prompt");
        return;
      }
      currentCtx.ui.pasteToEditor(text);
      response(client, id, { accepted: true });
      return;
    }
    response(client, id, undefined, `unknown method: ${request.method}`);
  }

  function attach(socket: net.Socket) {
    const client: Client = { socket, authenticated: false, buffer: "" };
    clients.add(client);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      client.buffer += chunk;
      if (Buffer.byteLength(client.buffer) > MAX_LINE_BYTES)
        return socket.destroy();
      while (true) {
        const newline = client.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = client.buffer.slice(0, newline);
        client.buffer = client.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          handleRequest(client, JSON.parse(line));
        } catch {
          response(client, null, undefined, "invalid JSON");
        }
      }
    });
    const remove = () => clients.delete(client);
    socket.on("close", remove);
    socket.on("error", remove);
  }

  async function start(ctx: any) {
    if (server || ctx?.mode !== "tui" || !HERDR_ENABLED) return;
    currentCtx = ctx;
    runtimeDir = path.join(
      os.tmpdir(),
      `pi-nvim-${process.getuid?.() ?? "user"}`,
    );
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    socketPath = path.join(
      runtimeDir,
      `${HERDR_PANE_ID!.replace(/[^A-Za-z0-9_-]/g, "_")}.sock`,
    );
    token = crypto.randomBytes(24).toString("hex");
    try {
      fs.unlinkSync(socketPath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    server = net.createServer(attach);
    server.on("error", (error) =>
      broadcast("error", { message: error.message }),
    );
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
    await reportMetadata();
    refreshTimer = setInterval(() => void reportMetadata(), 5000);
    refreshTimer.unref?.();
    publishState(true);
    broadcast("connected", { pane_id: HERDR_PANE_ID });
  }

  async function stop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    await reportMetadata(true);
    for (const client of clients) client.socket.destroy();
    clients.clear();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    if (socketPath)
      try {
        fs.unlinkSync(socketPath);
      } catch {}
    currentCtx = undefined;
  }

  pi.events.on("herdr:blocked", (data: any) => {
    if (data?.active) {
      blockedCount += 1;
      blockedMessage = data.label;
    } else {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) blockedMessage = undefined;
    }
    publishState();
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    currentCtx = ctx;
    active = ctx?.isIdle?.() === false;
    await start(ctx);
  });
  pi.on("agent_start", (_event: any, ctx: any) => {
    currentCtx = ctx;
    active = true;
    publishState();
    broadcast("agent_start");
  });
  pi.on("agent_settled", (_event: any, ctx: any) => {
    currentCtx = ctx;
    if (ctx?.isIdle?.() === true) active = false;
    publishState();
    broadcast("agent_settled");
  });
  pi.on("tool_execution_start", (event: any) => {
    toolArgs.set(event.toolCallId, {
      toolName: event.toolName,
      args: event.args,
    });
    broadcast("tool_start", {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
    });
  });
  pi.on("tool_execution_end", (event: any) => {
    const call = toolArgs.get(event.toolCallId);
    toolArgs.delete(event.toolCallId);
    broadcast("tool_end", {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      is_error: event.isError,
    });
    if (!event.isError && call && ["edit", "write"].includes(call.toolName)) {
      const candidate =
        call.args?.path ?? call.args?.file_path ?? call.args?.filePath;
      if (typeof candidate === "string")
        broadcast("files_changed", {
          paths: [path.resolve(currentCtx?.cwd ?? process.cwd(), candidate)],
        });
    }
  });
  pi.on("session_shutdown", async () => {
    broadcast("shutdown");
    await stop();
  });
}
