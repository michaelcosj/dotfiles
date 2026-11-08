import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { countChanges as countBaselineChanges, trackBaseline } from "./baselines.js";

const PROTOCOL = "1";
const SOURCE = "pi-control-bridge";
const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const HERDR_PANE_ID = process.env.HERDR_PANE_ID;
const HERDR_ENABLED =
  process.env.HERDR_ENV === "1" && !!HERDR_SOCKET_PATH && !!HERDR_PANE_ID;
const HERDR_ENDPOINT =
  process.platform === "win32" && HERDR_SOCKET_PATH
    ? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
    : HERDR_SOCKET_PATH;
// In a Rex pane there is no herdr metadata; Neovim finds pi through a
// discovery file beside the socket instead (<runtime dir>/<block>.json).
const REX_BLOCK = process.env.REX_BLOCK;
const REX_SESSION = process.env.REX_SESSION;
const REX_ENABLED = !HERDR_ENABLED && !!REX_BLOCK && !!REX_SESSION;
const PANE_ID = HERDR_ENABLED ? HERDR_PANE_ID : REX_BLOCK;
const MAX_LINE_BYTES = 1024 * 1024;
const INSTANCE_ID = PANE_ID;
// Footer line: the connected editor, what it shows, follow, changes to review.
const STATUS_KEY = "pi-editor";

type BridgeState = "idle" | "working" | "blocked";
type Client = { socket: net.Socket; authenticated: boolean; buffer: string };
// A question for Neovim (edit or plan review). Every connected Neovim gets
// it; each answers with a result or { pass: true }. The first result wins;
// if all pass or disconnect, the caller gets undefined and carries on alone.
type Pending = {
  waiting: Set<Client>;
  resolve: (value: any) => void;
};
type EditorContext = {
  file?: string;
  line?: number;
  col?: number;
  filetype?: string;
  visible?: [number, number];
  selection?: { first: number; last: number; text?: string };
  modified?: boolean;
};

const MAX_CONTEXT_SELECTION = 4000;

// First line that differs between two texts (1-based), for autofollow.
function firstChangedLine(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return Math.min(i + 1, Math.max(b.length, 1));
}

function toolPath(args: any): string | undefined {
  const p = args?.path ?? args?.file_path ?? args?.filePath;
  return typeof p === "string" ? p : undefined;
}

// OSC 7501 program status on pi's own terminal, in a child record so pi's
// own status (the root record) is untouched. Rex shows it on the tab.
function programStatus(id: string, state: "blocked" | "clear", msg?: string) {
  if (!process.stdout.isTTY) return;
  const pairs = [`id=${id}`, `state=${state}`, "app=pi"];
  if (state === "blocked") {
    pairs.push("kind=permission");
    if (msg)
      pairs.push(`msg=${Buffer.from(msg.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 200)).toString("base64")}`);
  }
  process.stdout.write(`\x1b]7501;${pairs.join(":")}\x1b\\`);
}

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
  const pending = new Map<string, Pending>();
  // tool calls whose content the user changed in Neovim before accepting
  const adjusted = new Set<string>();
  let editorContext: EditorContext | undefined;
  let injectedContext: string | undefined;
  // Notes from Neovim for the next prompt, e.g. "the user reverted X".
  const notes: string[] = [];
  // tool call id -> line where an edit landed, for autofollow
  const editLines = new Map<string, number>();
  // Neovim's settings, shown in the footer (sent with set_prefs)
  let prefs: { follow?: boolean; review?: string } = {};
  let changesCount = 0;
  // what pi is waiting on the user for, by request id
  const waitingOn = new Map<string, string>();

  // Files under cwd that pi changed and you haven't reviewed (see baselines.ts).
  function countChanges() {
    changesCount = countBaselineChanges(currentCtx?.cwd ?? process.cwd());
  }

  function renderStatus() {
    const ui = currentCtx?.ui;
    if (!ui?.setStatus || !ui.theme) return;
    const t = ui.theme;
    const sep = t.fg("dim", " · ");
    // pi joins footer statuses with a space and usage comes next, so end
    // with a dot to separate them
    const end = t.fg("dim", " ·");
    if (connectedClients().length === 0) {
      const parts = [t.fg("dim", "󰕷 no editor")];
      if (changesCount) parts.push(t.fg("accent", `Δ ${changesCount} file${changesCount === 1 ? "" : "s"}`));
      ui.setStatus(STATUS_KEY, parts.join(sep) + end);
      return;
    }
    const cwd = currentCtx?.cwd ?? process.cwd();
    let editor = t.fg("success", "󰕷") + " nvim";
    if (waitingOn.size) {
      const what = [...waitingOn.values()].at(-1)!;
      ui.setStatus(STATUS_KEY, editor + sep + t.fg("warning", `⏳ waiting for you: ${what} in Neovim`) + end);
      return;
    }
    const c = editorContext;
    if (c?.file) {
      const rel = path.relative(cwd, c.file);
      editor += " " + t.fg("muted", `${rel && !rel.startsWith("..") ? rel : path.basename(c.file)}${c.line ? `:${c.line}` : ""}`);
      if (c.selection) editor += t.fg("dim", ` (sel ${c.selection.first}-${c.selection.last})`);
    }
    const parts = [editor];
    if (prefs.follow) parts.push(t.fg("accent", "󰁌 follow"));
    if (changesCount) parts.push(t.fg("accent", `Δ ${changesCount} file${changesCount === 1 ? "" : "s"}`));
    if (prefs.review) parts.push(t.fg("dim", `review: ${prefs.review === "off" ? "grouped" : prefs.review}`));
    ui.setStatus(STATUS_KEY, parts.join(sep) + end);
  }

  function connectedClients() {
    return [...clients].filter((c) => c.authenticated && !c.socket.destroyed);
  }

  function askEditor(
    kind: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    statusMessage?: string,
  ): Promise<any> {
    const targets = connectedClients();
    if (targets.length === 0) return Promise.resolve(undefined);
    const requestId = crypto.randomBytes(8).toString("hex");
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: any) => {
        if (settled) return;
        settled = true;
        pending.delete(requestId);
        signal?.removeEventListener("abort", onAbort);
        broadcast("request_done", { request_id: requestId });
        programStatus(`review-${requestId}`, "clear");
        waitingOn.delete(requestId);
        renderStatus();
        resolve(value);
      };
      const onAbort = () => finish({ aborted: true });
      if (signal?.aborted) return finish({ aborted: true });
      signal?.addEventListener("abort", onAbort);
      pending.set(requestId, { waiting: new Set(targets), resolve: finish });
      programStatus(`review-${requestId}`, "blocked", statusMessage);
      waitingOn.set(requestId, kind === "review_plan" ? "plan review" : `edit to ${path.basename(String(payload.path ?? "file"))}`);
      renderStatus();
      for (const client of targets)
        send(client, { event: "request", data: { request_id: requestId, kind, ...payload } });
    });
  }

  function clientGone(client: Client) {
    for (const entry of pending.values()) {
      entry.waiting.delete(client);
      if (entry.waiting.size === 0) entry.resolve(undefined);
    }
  }

  function contextText(c: EditorContext): string | undefined {
    if (!c.file) return undefined;
    const parts = [`The user's editor (Neovim) shows ${c.file}${c.modified ? " (unsaved changes)" : ""}`];
    if (c.line) parts[0] += `, cursor on line ${c.line}`;
    if (c.visible) parts[0] += `, lines ${c.visible[0]}-${c.visible[1]} visible`;
    parts[0] += ".";
    if (c.selection) {
      const range = c.selection.first === c.selection.last ? `line ${c.selection.first}` : `lines ${c.selection.first}-${c.selection.last}`;
      parts.push(`Selected ${range}:`);
      if (c.selection.text)
        parts.push("```" + (c.filetype ?? "") + "\n" + c.selection.text.slice(0, MAX_CONTEXT_SELECTION) + "\n```");
    }
    parts.push("This is background on where the user is looking; it may not relate to their request.");
    return parts.join("\n");
  }

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
      pane_id: PANE_ID,
    });
  }

  let discoveryPath: string | undefined;

  function writeDiscovery() {
    if (!REX_ENABLED || !runtimeDir) return;
    discoveryPath = path.join(
      runtimeDir,
      `${REX_BLOCK!.replace(/[^A-Za-z0-9_-]/g, "_")}.json`,
    );
    const data = {
      pane_id: REX_BLOCK,
      rex_session: REX_SESSION,
      pid: process.pid,
      cwd: currentCtx?.cwd ?? process.cwd(),
      tokens: {
        pi_control_socket: socketPath,
        pi_control_token: token,
        pi_control_protocol: PROTOCOL,
        pi_instance_id: INSTANCE_ID,
      },
    };
    fs.writeFileSync(`${discoveryPath}.tmp`, JSON.stringify(data), {
      mode: 0o600,
    });
    fs.renameSync(`${discoveryPath}.tmp`, discoveryPath);
  }

  async function reportMetadata(clear = false) {
    if (!HERDR_ENABLED) return;
    await herdrRequest("pane.report_metadata", {
      pane_id: HERDR_PANE_ID,
      source: SOURCE,
      seq: Date.now(),
      ttl_ms: clear ? 1 : 15000,
      tokens: clear
        ? {
            pi_control_socket: null,
            pi_control_token: null,
            pi_control_protocol: null,
            pi_instance_id: null,
          }
        : {
            pi_control_socket: socketPath,
            pi_control_token: token,
            pi_control_protocol: PROTOCOL,
            pi_instance_id: INSTANCE_ID,
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
      setImmediate(renderStatus);
      response(client, id, {
        protocol: PROTOCOL,
        pane_id: PANE_ID,
        instance_id: INSTANCE_ID,
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
        pane_id: PANE_ID,
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
    if (request.method === "respond") {
      const entry = pending.get(request.params?.request_id);
      if (!entry) {
        response(client, id, { accepted: false });
        return;
      }
      const result = request.params?.result;
      if (!result || result.pass) {
        entry.waiting.delete(client);
        if (entry.waiting.size === 0) entry.resolve(undefined);
      } else entry.resolve(result);
      response(client, id, { accepted: true });
      return;
    }
    if (request.method === "set_context") {
      const c = request.params;
      editorContext = c && typeof c === "object" && typeof c.file === "string" ? c : undefined;
      response(client, id, { accepted: true });
      renderStatus();
      return;
    }
    if (request.method === "set_prefs") {
      const p = request.params ?? {};
      prefs = { follow: !!p.follow, review: typeof p.review === "string" ? p.review : undefined };
      if (p.changes_updated) countChanges();
      response(client, id, { accepted: true });
      renderStatus();
      return;
    }
    if (request.method === "note") {
      const text = request.params?.text;
      if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 16384) {
        response(client, id, undefined, "invalid note");
        return;
      }
      notes.push(text.trim());
      response(client, id, { accepted: true });
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
    const remove = () => {
      clients.delete(client);
      clientGone(client);
      if (connectedClients().length === 0) {
        editorContext = undefined;
        prefs = {};
      }
      renderStatus();
    };
    socket.on("close", remove);
    socket.on("error", remove);
  }

  async function start(ctx: any) {
    if (server || ctx?.mode !== "tui" || (!HERDR_ENABLED && !REX_ENABLED))
      return;
    currentCtx = ctx;
    countChanges();
    renderStatus();
    runtimeDir = path.join(
      os.tmpdir(),
      `pi-control-${process.getuid?.() ?? "user"}`,
    );
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    socketPath = path.join(
      runtimeDir,
      // macOS caps socket paths at 104 bytes, and Rex block IDs are long
      HERDR_ENABLED
        ? `${PANE_ID!.replace(/[^A-Za-z0-9_-]/g, "_")}.sock`
        : `${crypto.createHash("sha256").update(PANE_ID!).digest("hex").slice(0, 16)}.sock`,
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
    writeDiscovery();
    await reportMetadata();
    refreshTimer = setInterval(() => void reportMetadata(), 5000);
    refreshTimer.unref?.();
    publishState(true);
    broadcast("connected", { pane_id: PANE_ID });
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
    for (const file of [socketPath, discoveryPath])
      if (file)
        try {
          fs.unlinkSync(file);
        } catch {}
    discoveryPath = undefined;
    currentCtx?.ui?.setStatus?.(STATUS_KEY, undefined);
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
    const rel = toolPath(event.args);
    if (event.toolName === "read" && rel)
      broadcast("follow", {
        tool: "read",
        path: path.resolve(currentCtx?.cwd ?? process.cwd(), rel),
        line: typeof event.args?.offset === "number" ? event.args.offset : undefined,
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
      if (typeof candidate === "string") {
        const file = path.resolve(currentCtx?.cwd ?? process.cwd(), candidate);
        broadcast("files_changed", { paths: [file] });
        countChanges();
        renderStatus();
        broadcast("follow", { tool: call.toolName, path: file, line: editLines.get(event.toolCallId) });
      }
    }
    editLines.delete(event.toolCallId);
  });
  // ---- Edit review: Neovim shows each edit as a diff before it lands. ----

  function proposedContent(toolName: string, input: any, cwd: string) {
    const rel = input?.path ?? input?.file_path ?? input?.filePath;
    if (typeof rel !== "string") return undefined;
    const file = path.resolve(cwd, rel);
    let original = "";
    let exists = true;
    try {
      original = fs.readFileSync(file, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") return undefined;
      exists = false;
    }
    if (toolName === "write") {
      if (typeof input.content !== "string") return undefined;
      return { file, original, proposed: input.content, exists };
    }
    if (!exists || !Array.isArray(input.edits)) return undefined;
    // Mirror pi's matching on LF text: every oldText must match exactly once.
    // Anything fuzzier is left to pi, which reports its own error.
    const base = original.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const spans: { start: number; end: number; text: string }[] = [];
    for (const e of input.edits) {
      if (typeof e?.oldText !== "string" || typeof e?.newText !== "string" || e.oldText === "") return undefined;
      const start = base.indexOf(e.oldText);
      if (start < 0 || base.indexOf(e.oldText, start + 1) >= 0) return undefined;
      spans.push({ start, end: start + e.oldText.length, text: e.newText });
    }
    spans.sort((a, b) => b.start - a.start);
    let proposed = base;
    for (const sp of spans) proposed = proposed.slice(0, sp.start) + sp.text + proposed.slice(sp.end);
    return { file, original: base, proposed, exists };
  }

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const cwd = ctx?.cwd ?? currentCtx?.cwd ?? process.cwd();
    const rel = toolPath(event.input);
    const change = proposedContent(event.toolName, event.input, cwd);
    if (change) editLines.set(event.toolCallId, firstChangedLine(change.original, change.proposed));
    const track = () => {
      if (rel) trackBaseline(path.resolve(cwd, rel));
      return undefined;
    };
    if (!change || connectedClients().length === 0) return track();
    const result = await askEditor(
      "review_edit",
      {
        tool: event.toolName,
        path: change.file,
        exists: change.exists,
        original: change.original,
        proposed: change.proposed,
      },
      ctx?.signal,
      `Review edit to ${path.relative(cwd, change.file) || change.file} in Neovim`,
    );
    if (result?.aborted) return { block: true, reason: "Edit review was cancelled." };
    if (!result) return track();
    if (result.decision === "reject") {
      const why = typeof result.reason === "string" && result.reason.trim() ? ` Their feedback: ${result.reason.trim()}` : "";
      return { block: true, reason: `The user rejected this edit in Neovim; the file is unchanged.${why}` };
    }
    if (typeof result.content === "string" && result.content !== change.proposed) {
      if (event.toolName === "write") event.input.content = result.content;
      else event.input.edits = [{ oldText: change.original, newText: result.content }];
      adjusted.add(event.toolCallId);
    }
    return track();
  });

  pi.on("tool_result", (event: any) => {
    if (!adjusted.delete(event.toolCallId) || event.isError) return;
    return {
      content: [
        ...(event.content ?? []),
        {
          type: "text",
          text: "Note: the user changed your edit in Neovim before accepting it, so the file differs from what you proposed. Read it again before editing it further.",
        },
      ],
    };
  });

  // ---- Plan review: plans are Markdown files with CriticMarkup comments. ----

  pi.registerTool({
    name: "submit_plan",
    label: "Submit plan",
    description:
      "Ask the user to review a plan you wrote to a Markdown file. Opens it in the user's Neovim, where they comment inline with CriticMarkup, and waits for them to approve or request changes.",
    promptSnippet: "Submit a Markdown plan file for the user's review in Neovim and wait for approval",
    promptGuidelines: [
      "When you write a plan for the user to review before implementing, save it as a Markdown file and call submit_plan with its path. Do not start implementing until submit_plan returns approved.",
      "Plan review comments use CriticMarkup inside the plan file: {==quoted text==}{>>comment<<} comments on a span, and {>>comment<<} alone is a general comment at that spot. Comments starting with 'pi:' are yours.",
      "When submit_plan returns requested changes, revise the plan file: resolve a comment by changing the plan and removing its markup (keep the quoted text unless the change replaces it), or answer it inline by adding {>>pi: your reply<<} right after it and leave the user's comment in place. Then call submit_plan again.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the Markdown plan file" }),
      summary: Type.Optional(Type.String({ description: "One line on what changed since the last review" })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal, _onUpdate: any, ctx: any) {
      const cwd = ctx?.cwd ?? currentCtx?.cwd ?? process.cwd();
      const file = path.resolve(cwd, params.path);
      if (!fs.existsSync(file)) throw new Error(`No plan file at ${file}`);
      const result = await askEditor("review_plan", { path: file, summary: params.summary }, signal, "Review the plan in Neovim");
      if (!result)
        return {
          content: [
            {
              type: "text",
              text: `Neovim isn't connected, so the plan wasn't opened for review. Tell the user the plan is at ${file}, ask them to review it (they can comment inline with CriticMarkup), and wait for their reply before implementing.`,
            },
          ],
          details: { decision: "unavailable", path: file },
        };
      if (result.aborted) throw new Error("Plan review was cancelled");
      const comments: { quote?: string; comment: string; line?: number }[] = Array.isArray(result.comments) ? result.comments : [];
      const lines: string[] = [];
      if (result.decision === "approve") {
        lines.push("The user approved the plan.");
        if (comments.length) lines.push("They left these comments; take them into account while implementing:");
      } else {
        lines.push("The user requested changes to the plan. Revise the plan file, then call submit_plan again.");
      }
      if (result.edited) lines.push("They also edited the plan text directly; re-read the file.");
      for (const c of comments) {
        const where = c.line ? `line ${c.line}` : "";
        lines.push(`- ${where}${c.quote ? `${where ? ", " : ""}on "${c.quote}"` : ""}: ${c.comment}`);
      }
      if (typeof result.message === "string" && result.message.trim()) lines.push(`Their note: ${result.message.trim()}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { decision: result.decision, path: file, comments: comments.length },
      };
    },
  });

  // ---- Jump to code: open a file at a line in the user's Neovim. ----

  pi.registerTool({
    name: "open_in_editor",
    label: "Open in editor",
    description: "Open a file at a line in the user's Neovim and switch to it, to show them code you are talking about.",
    promptSnippet: "Show the user a file and line in their Neovim",
    promptGuidelines: [
      "Use open_in_editor when the user asks you to show them where something is, or to point at the one place they need to look; don't call it for every file you mention.",
    ],
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Optional(Type.Integer({ minimum: 1 })),
      col: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: any, ctx: any) {
      const cwd = ctx?.cwd ?? currentCtx?.cwd ?? process.cwd();
      const file = path.resolve(cwd, params.path);
      if (connectedClients().length === 0)
        return { content: [{ type: "text", text: "Neovim isn't connected; give the user the path and line instead." }], details: {} };
      broadcast("open", { path: file, line: params.line, col: params.col });
      return { content: [{ type: "text", text: `Opened ${path.relative(cwd, file) || file}${params.line ? `:${params.line}` : ""} in Neovim.` }], details: {} };
    },
  });

  // ---- Ambient context: where the user is in Neovim, added to each prompt. ----

  pi.on("before_agent_start", (event: any) => {
    if (event.messageType !== "user") return;
    const parts: string[] = [];
    if (editorContext && connectedClients().length > 0) {
      const text = contextText(editorContext);
      if (text && text !== injectedContext) {
        injectedContext = text;
        parts.push(text);
      }
    }
    if (notes.length) parts.push(...notes.splice(0));
    if (!parts.length) return;
    return { message: { customType: "editor-context", content: parts.join("\n\n"), display: false } };
  });

  pi.on("session_shutdown", async () => {
    broadcast("shutdown");
    await stop();
  });
}
