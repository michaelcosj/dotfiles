// Child side of delegation: this pi was started by a parent's `agent` tool.
// It runs no bridge server (so Neovim never finds it) and connects up to the
// parent's socket instead. It exits when the parent says so or goes away.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { PROTOCOL } from "../core.js";
import { toolPath } from "../editor.js";
import { deliverNote, deliverReview } from "../notes.js";
import { ENV, type Roster } from "./protocol.js";

/** The child's side of the ask-the-parent protocol (see parent.ts guidelines). */
export const PARENT_SECTION = [
  "You are a child agent. A parent agent gave you your task and sends follow-ups as user messages.",
  "Your final message of each turn goes to the parent, not straight to the user. Make it a complete, self-contained report: what you did, the results, and anything the parent must know. The parent sees only that message, not your tool calls.",
  "Decide what you can yourself. Ask first, unless the task says so in plain words, before any step that is hard to undo or reaches beyond your working copy: commit, push, publish, deploy, delete, or change a shared or remote system. A vague phrase such as \"finish it\" does not count. When you need information or a decision that changes the result, do not use the questionnaire tool. End your turn with the questions instead, under a heading \"Questions\": number them, give the options, and say which one you recommend. The parent answers from what it knows or asks the user, then replies with a follow-up. Do not continue work that depends on the answer.",
  "When the user types to you directly in your pane (a note in the conversation says so), they are the one you talk to: ask them directly with the questionnaire tool.",
].join("\n");

const RECONNECT_MS = 1000;
const PARENT_GONE_MS = Number(process.env[ENV.parentGone]) || 10_000;
/** On another host: changed files live there, so Neovim here can't review them. */
export const IS_REMOTE = !!process.env[ENV.host];

/** `tcp://ip:port` for a parent on another host, else a Unix socket path. */
function endpoint(parent: string): net.NetConnectOpts {
  const m = /^tcp:\/\/(.+):(\d+)$/.exec(parent);
  return m ? { host: m[1], port: Number(m[2]) } : { path: parent };
}

export function registerChild(pi: any, opts: { onRoster: (r: Roster) => void }) {
  const socketPath = process.env[ENV.parent]!;
  const token = process.env[ENV.token]!;
  const id = process.env[ENV.id]!;
  const name = process.env[ENV.name]!;
  const promptFile = process.env[ENV.prompt];
  let ctxRef: any;
  let socket: net.Socket | undefined;
  let ready = false;
  let buffer = "";
  let nextId = 0;
  let lostAt: number | undefined;
  let closing = false;
  const queue: string[] = []; // requests made while disconnected
  let blocked = 0;
  let lastText: string | undefined;

  function write(method: string, params: Record<string, unknown>) {
    const line = `${JSON.stringify({ id: ++nextId, method, params })}\n`;
    if (ready && socket && !socket.destroyed) socket.write(line);
    else if (method !== "usage") queue.push(line);
  }

  function onEvent(event: string, data: any) {
    switch (event) {
      case "prompt":
        if (typeof data?.text !== "string" || !data.text.trim()) return;
        if (ctxRef?.isIdle?.() === false) pi.sendUserMessage(data.text, { deliverAs: "followUp" });
        else pi.sendUserMessage(data.text);
        return;
      case "note":
        if (typeof data?.text !== "string" || !data.text.trim()) return;
        if (data.review) deliverReview(pi, data.text.trim(), ctxRef?.isIdle?.() !== false);
        else deliverNote(pi, data.text.trim());
        return;
      case "abort":
        ctxRef?.abort?.();
        return;
      case "shutdown":
        closing = true;
        ctxRef?.shutdown?.();
        return;
      case "roster":
        opts.onRoster(data as Roster);
        return;
    }
  }

  function connect() {
    if (closing) return;
    buffer = "";
    const s = net.createConnection(endpoint(socketPath));
    if (IS_REMOTE) s.setKeepAlive(true, 15_000);
    socket = s;
    s.setEncoding("utf8");
    s.on("connect", () => {
      s.write(`${JSON.stringify({ id: ++nextId, method: "hello", params: { protocol: PROTOCOL, token, role: "agent", id, name, pid: process.pid } })}\n`);
    });
    s.on("data", (chunk: string) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.event) onEvent(msg.event, msg.data);
        else if (!ready && msg.result?.protocol) {
          ready = true;
          lostAt = undefined;
          sendState();
          for (const l of queue.splice(0)) s.write(l);
        } else if (!ready && msg.error) {
          // Wrong token: the parent is a different pi now. Nothing to serve.
          closing = true;
          ctxRef?.shutdown?.();
        }
      }
    });
    const lost = () => {
      if (socket !== s) return;
      ready = false;
      socket = undefined;
      if (closing) return;
      lostAt ??= Date.now();
      // The parent reloads in a moment; a parent that is gone for good takes us with it.
      if (Date.now() - lostAt > PARENT_GONE_MS) {
        closing = true;
        ctxRef?.shutdown?.();
        return;
      }
      setTimeout(connect, RECONNECT_MS).unref?.();
    };
    s.on("error", lost);
    s.on("close", lost);
  }

  function sendState() {
    const idle = ctxRef?.isIdle?.() !== false;
    write("state", { status: blocked > 0 ? "blocked" : idle ? "idle" : "working" });
  }

  pi.events.on("herdr:blocked", (data: any) => {
    blocked = Math.max(0, blocked + (data?.active ? 1 : -1));
    sendState();
  });

  pi.on("session_start", (_e: any, ctx: any) => {
    ctxRef = ctx;
    if (!socket) connect();
    // The parent saves it so `agent resume` can reopen this conversation later.
    const file = ctx.sessionManager?.getSessionFile?.();
    if (file) write("session", { session_file: file });
    // First run: the task the parent wrote for us.
    if (promptFile && fs.existsSync(promptFile)) {
      const task = fs.readFileSync(promptFile, "utf8");
      fs.rmSync(promptFile, { force: true });
      if (task.trim()) setTimeout(() => pi.sendUserMessage(task), 0);
    }
  });
  // Prompts from the parent arrive through sendUserMessage (source "extension");
  // text the user types into this pane is "interactive".
  let typed = false;
  pi.on("input", (event: any) => {
    // Only a message that starts a run; a steer or queued follow-up starts none.
    typed = event?.source === "interactive" && !event?.streamingBehavior;
    return { action: "continue" };
  });
  pi.on("before_agent_start", (event: any) => {
    const sections = event?.systemPromptOptions?.sections;
    if (sections) sections.parent_agent = PARENT_SECTION;
    if (event?.messageType !== "user" || !typed) return;
    typed = false;
    return {
      message: {
        customType: "agent-bridge-typed",
        content: "The user typed this message in your pane. Talk to them directly; ask them with the questionnaire tool if you need to.",
        display: false,
      },
    };
  });

  pi.on("agent_start", (_e: any, ctx: any) => {
    ctxRef = ctx;
    typed = false;
    lastText = undefined;
    write("state", { status: "working" });
  });
  pi.on("message_end", (event: any, ctx: any) => {
    const m = event.message;
    if (m?.role !== "assistant") return;
    const t = Array.isArray(m.content)
      ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n").trim()
      : "";
    if (t) lastText = t;
    else if (m.errorMessage) lastText = `Error: ${m.errorMessage}`;
    const u = ctx.getContextUsage?.();
    if (u?.tokens != null) write("usage", { tokens: u.tokens });
  });
  pi.on("agent_settled", (event: any, ctx: any) => {
    ctxRef = ctx;
    if (ctx.isIdle?.() === false) return;
    write("settled", { last_message: lastText ?? "", aborted: !!event?.aborted });
    sendState();
  });
  // tool_execution_end has no args; remember edit targets from the start.
  const editPaths = new Map<string, string>();
  pi.on("tool_execution_start", (event: any, ctx: any) => {
    const rel = ["edit", "write"].includes(event.toolName) ? toolPath(event.args) : undefined;
    if (rel) editPaths.set(event.toolCallId, path.resolve(ctx?.cwd ?? process.cwd(), rel));
  });
  pi.on("tool_execution_end", (event: any) => {
    const file = editPaths.get(event.toolCallId);
    editPaths.delete(event.toolCallId);
    if (file && !event.isError && !IS_REMOTE) write("files_changed", { paths: [file] });
  });
  pi.on("session_shutdown", (event: any) => {
    if (event?.reason === "reload") return;
    closing = true;
    socket?.destroy();
  });

  return {
    /** Tell the parent which block is in view after a swap from here. */
    view: (block: string) => write("view", { block }),
    /** Ask the parent to show `name` (an agent on another machine, or main from there). */
    switchTo: (name: string) => write("switch", { name }),
    name,
  };
}
