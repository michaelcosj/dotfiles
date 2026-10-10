import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import { promisify } from "node:util";
import type { SpawnTask, SubagentEvent, SubagentMeta } from "./state.js";
import { SpawnError } from "./state.js";
import type { ChildSession } from "./child-session.js";
import { renderSubagentHandoff } from "./handoff.js";

const execFileAsync = promisify(execFile);

type HerdrAgent = {
  agent_status?: "idle" | "working" | "blocked" | "done" | "unknown";
  pane_id: string;
  tab_id: string;
  agent_session?: { value?: string };
  interactive_ready?: boolean;
  tokens?: {
    pi_control_protocol?: string;
    pi_control_socket?: string;
    pi_control_token?: string;
  };
};

type HerdrSnapshot = { result?: { snapshot?: { agents?: HerdrAgent[] } } };

async function herdr(args: string[]): Promise<any> {
  try {
    const { stdout } = await execFileAsync("herdr", args, {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim() ? JSON.parse(stdout) : undefined;
  } catch (error: any) {
    throw new SpawnError(
      error?.stderr?.trim() || error?.message || `herdr ${args[0]} failed`,
    );
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function startAgentWhenShellReady(args: string[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await herdr(args);
      return;
    } catch (error) {
      if (
        Date.now() >= deadline ||
        !String(error).includes("agent_pane_busy")
      ) throw error;
      await delay(100);
    }
  }
}

async function findAgent(paneId: string): Promise<HerdrAgent | undefined> {
  const response = (await herdr(["api", "snapshot"])) as HerdrSnapshot;
  return response.result?.snapshot?.agents?.find((agent) => agent.pane_id === paneId);
}

type BridgeTokens = Required<NonNullable<HerdrAgent["tokens"]>>;

async function waitForBridge(paneId: string): Promise<BridgeTokens> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const tokens = (await findAgent(paneId))?.tokens;
    if (tokens?.pi_control_socket && tokens.pi_control_token) {
      return {
        pi_control_protocol: tokens.pi_control_protocol ?? "1",
        pi_control_socket: tokens.pi_control_socket,
        pi_control_token: tokens.pi_control_token,
      };
    }
    await delay(100);
  }
  throw new SpawnError("Pi control bridge did not become available");
}

async function bridgePrompt(tokens: BridgeTokens, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(tokens.pi_control_socket);
    let buffer = "";
    let stage: "hello" | "prompt" = "hello";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const send = (value: unknown) => socket.write(`${JSON.stringify(value)}\n`);
    const timer = setTimeout(
      () => finish(new Error("Pi control bridge timed out")),
      10_000,
    );
    timer.unref?.();
    socket.setEncoding("utf8");
    socket.once("error", finish);
    socket.once("connect", () => send({
      id: 1,
      method: "hello",
      params: {
        protocol: tokens.pi_control_protocol,
        token: tokens.pi_control_token,
        client_id: `pizza-${process.pid}`,
      },
    }));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let response: any;
        try {
          response = JSON.parse(line);
        } catch {
          finish(new Error("Pi control bridge returned invalid JSON"));
          return;
        }
        if (response.error) {
          finish(new Error(response.error.message ?? "Pi control bridge rejected the request"));
          return;
        }
        if (stage === "hello" && response.id === 1) {
          stage = "prompt";
          send({ id: 2, method: "prompt", params: { text } });
        } else if (stage === "prompt" && response.id === 2) {
          response.result?.accepted
            ? finish()
            : finish(new Error("Pi control bridge did not accept the prompt"));
          return;
        }
      }
    });
  });
}

async function submitPrompt(paneId: string, text: string): Promise<void> {
  try {
    await bridgePrompt(await waitForBridge(paneId), text);
  } catch (error) {
    throw new SpawnError(`Could not submit the Pi prompt: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
}

async function readFinalText(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    const lines = (await fs.readFile(path, "utf8")).trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]!);
      const message = entry?.message ?? entry;
      if (message?.role !== "assistant") continue;
      const text = textOfContent(message.content).trim();
      if (text) return text.slice(-1024 * 1024);
    }
  } catch {}
  return "";
}

export function isHerdrAvailable(): boolean {
  return process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_WORKSPACE_ID);
}

export async function focusHerdrTab(tabId: string): Promise<void> {
  await herdr(["tab", "focus", tabId]);
}

/** Run a child as a native Pi process in a Herdr tab. */
function herdrAgentName(task: SpawnTask): string {
  const prefix = task.origin === "btw" ? "btw" : "subagent";
  const slug = task.title.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 32 - prefix.length - 1);
  return `${prefix}-${slug || "task"}`;
}

export async function createHerdrChildSession(task: SpawnTask): Promise<ChildSession> {
  const workspace = process.env.HERDR_WORKSPACE_ID;
  if (!workspace) throw new SpawnError("HERDR_WORKSPACE_ID is unavailable");

  const created = await herdr([
    "tab", "create", "--workspace", workspace, "--cwd", task.cwd,
    "--label", task.title, "--env", "PIZZA_SUBAGENT=1", "--no-focus",
  ]);
  const paneId = created?.result?.root_pane?.pane_id as string | undefined;
  const tabId = created?.result?.tab?.tab_id as string | undefined;
  if (!paneId || !tabId) throw new SpawnError("Herdr did not return a tab and pane");

  const model = task.model ?? (task.parent.inheritedModel
    ? `${task.parent.inheritedModel.provider}/${task.parent.inheritedModel.id}`
    : undefined);
  const args = ["agent", "start", herdrAgentName(task), "--kind", "pi", "--pane", paneId];
  args.push(
    "--",
    "--tui-mode", "regular",
    // Herdr must encode these arguments for the target shell. Arbitrary task
    // text can contain quotes/newlines, so use the already shell-safe slug.
    "--name", herdrAgentName(task),
  );
  if (task.forkParent && task.parent.sessionFilePath) {
    args.push("--fork", task.parent.sessionFilePath);
  }
  // Forked sessions already inherit their model and thinking configuration.
  // Keep /btw startup argv minimal; forwarding runtime model identifiers through
  // Herdr's conservative shell encoder caused repeated invalid_agent_argument failures.
  if (!task.forkParent) {
    if (model) args.push("--model", model);
    if (task.reasoningEffort ?? task.parent.inheritedThinkingLevel) {
      args.push("--thinking", task.reasoningEffort ?? task.parent.inheritedThinkingLevel!);
    }
  }
  // Do not pass the handoff as a positional startup argument. It contains
  // arbitrary multiline user text, which Herdr intentionally refuses to encode
  // into a target-shell command. Submit it through the pane after Pi starts.

  try {
    await startAgentWhenShellReady(args);
  } catch (error) {
    await herdr(["tab", "close", tabId]).catch(() => {});
    throw error;
  }

  try {
    await submitPrompt(paneId, renderSubagentHandoff(task));
  } catch (error) {
    await herdr(["tab", "close", tabId]).catch(() => {});
    throw error;
  }

  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let sessionFilePath: string | undefined;
  let sawWorking = (await findAgent(paneId))?.agent_status === "working";
  let lastStatus: HerdrAgent["agent_status"];
  let missingChecks = 0;
  const listeners = new Set<(event: SubagentEvent) => void>();
  const emit = (event: SubagentEvent) => listeners.forEach((listener) => listener(event));
  const meta: SubagentMeta = {
    backend: "pi",
    modelLabel: model,
    reasoningEffort: (task.reasoningEffort ?? task.parent.inheritedThinkingLevel) as any,
    herdrTabId: tabId,
    herdrPaneId: paneId,
  };

  const monitor = async () => {
    if (closed) return;
    try {
      const agent = await findAgent(paneId);
      if (!agent) {
        // Herdr owns process existence. A tab may be closed outside Pizza, so
        // reconcile that disappearance back into the manager. Require several
        // misses to tolerate transient snapshot/API races.
        if (++missingChecks >= 3) {
          closed = true;
          emit({
            type: "settled",
            status: "cancelled",
            reason: "aborted",
            finalText: await readFinalText(sessionFilePath),
            errorText: "Herdr agent or tab was closed",
          });
          return;
        }
      } else {
        missingChecks = 0;
      }
      const nextSessionFile = agent?.agent_session?.value;
      if (nextSessionFile && nextSessionFile !== sessionFilePath) {
        sessionFilePath = nextSessionFile;
        emit({ type: "meta", meta: { sessionFilePath } });
      }
      if (agent?.agent_status === "working") sawWorking = true;
      if (agent?.agent_status === "blocked" && lastStatus !== "blocked") {
        emit({ type: "activity", activity: "Waiting for input in Herdr" });
      }
      lastStatus = agent?.agent_status;
      if (agent && sawWorking && ["idle", "done"].includes(agent.agent_status ?? "")) {
        const finalText = await readFinalText(sessionFilePath);
        emit({ type: "settled", status: "done", reason: "completed", finalText });
        return;
      }
    } catch {}
    timer = setTimeout(monitor, 400);
    timer.unref?.();
  };

  // The initial prompt was accepted through Pi's control bridge. Monitoring
  // starts after the manager has had a chance to subscribe to this child.
  timer = setTimeout(() => void monitor(), 0);

  return {
    session: undefined,
    meta,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(text) {
      sawWorking = false;
      emit({ type: "run-start" });
      emit({ type: "activity", activity: "Working in Herdr" });
      await submitPrompt(paneId, text);
      if (timer) clearTimeout(timer);
      void monitor();
    },
    async interrupt() {
      // Cancellation is process lifecycle, not merely an editor Escape. Closing
      // the tab guarantees the native Pi process exits; the monitor then settles
      // the manager entry and releases its concurrency slot.
      await herdr(["tab", "close", tabId]).catch(() => {});
    },
    async reconcile() {
      return Boolean(await findAgent(paneId));
    },
    async dispose() {
      closed = true;
      if (timer) clearTimeout(timer);
      await herdr(["tab", "close", tabId]).catch(() => {});
      listeners.clear();
    },
  };
}
