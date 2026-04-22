/**
 * Subagent Dispatch Extension
 *
 * Dispatch tasks to subagent pi processes with isolated context windows.
 * Uses the m-preset system for configuration (--preset flag).
 *
 * Features:
 * - Single / parallel / chain dispatch modes
 * - Persistent subagent sessions (viewable from parent via /subagents)
 * - Permission & questionnaire forwarding from subagent to parent via IPC
 * - Nested subagent prevention via PI_SUBAGENT env var
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Markdown,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  findPresetSourcePath,
  generatePermissionSummary,
  loadPresetsConfig,
  normalizePermissionSettings,
  parsePermissionSnapshot,
  resolveInstructions,
  resolveModeWithParent,
} from "./permissions.js";
import { askQuestionnaire, QuestionnaireParams } from "./questionnaire.js";
import type {
  IpcPermissionRequest,
  IpcPermissionResponse,
  IpcQuestionnaireRequest,
  IpcQuestionnaireResponse,
  IpcRequest,
  IpcResponse,
  Preset,
  PresetsConfig,
  SingleResult,
  SubagentDetails,
  UsageStats,
} from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUBAGENT_ENV = "PI_SUBAGENT";
const SUBAGENT_CONTROL_DIR_ENV = "PI_SUBAGENT_CONTROL_DIR";
const SUBAGENT_PARENT_SESSION_ENV = "PI_SUBAGENT_PARENT_SESSION";
const SUBAGENT_PARENT_PERMISSIONS_ENV = "PI_SUBAGENT_PARENT_PERMISSIONS";
const SUBAGENT_ID_ENV = "PI_SUBAGENT_ID";
const SUBAGENT_TASK_ENV = "PI_SUBAGENT_TASK";
const IPC_POLL_INTERVAL_MS = 50;
const IPC_TIMEOUT_MS = 60_000;
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0)
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function uuid(): string {
  return crypto.randomUUID();
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const textParts = messages[i].content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0);
    if (textParts.length > 0) return textParts.join("\n");
  }
  return "";
}

type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall")
          items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return themeFg("muted", "read ") + themeFg("accent", shortenPath(rawPath));
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = themeFg("muted", "write ") + themeFg("accent", shortenPath(rawPath));
      if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
    }
  }
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

function writeIpcRequest(dir: string, request: IpcRequest): void {
  const filePath = path.join(dir, `${request.id}.request.json`);
  fs.writeFileSync(filePath, JSON.stringify(request), { mode: 0o600 });
}

function readIpcResponse(dir: string, id: string): IpcResponse | null {
  const filePath = path.join(dir, `${id}.response.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    fs.unlinkSync(filePath);
    return data as IpcResponse;
  } catch {
    return null;
  }
}

function writeIpcResponse(dir: string, response: IpcResponse): void {
  const filePath = path.join(dir, `${response.id}.response.json`);
  fs.writeFileSync(filePath, JSON.stringify(response), { mode: 0o600 });
}

async function waitForIpcResponse(
  dir: string,
  id: string,
  signal: AbortSignal | undefined,
  timeoutMs = IPC_TIMEOUT_MS,
): Promise<IpcResponse | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return null;
    const response = readIpcResponse(dir, id);
    if (response) return response;
    await new Promise((r) => setTimeout(r, IPC_POLL_INTERVAL_MS));
  }
  return null;
}

function cleanupControlDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Clean up all session files for this parent process. */
function cleanupSessionDir(): void {
  try {
    const dir = path.join(os.tmpdir(), `pi-subagent-sessions-${process.pid}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ─── Permission helpers (child mode) ─────────────────────────────────────────

// Set of tool calls already approved via IPC (prevents double-prompting)
const approvedViaIpc = new Set<string>();

// ─── Child Mode (PI_SUBAGENT=1) ──────────────────────────────────────────────

function setupChildMode(pi: ExtensionAPI): void {
  const presetName = pi.getFlag("preset") as string | undefined;
  const controlDir = process.env[SUBAGENT_CONTROL_DIR_ENV];
  const cwd = process.cwd();

  if (!controlDir) {
    console.error("m-agents: PI_SUBAGENT_CONTROL_DIR not set in child mode");
    return;
  }

  const parentSnapshot = parsePermissionSnapshot(process.env[SUBAGENT_PARENT_PERMISSIONS_ENV]);

  let activePreset: Preset | undefined;
  let activeInstructions: string | undefined;

  if (presetName) {
    const presets = loadPresetsConfig(cwd);
    activePreset = presets[presetName];
    if (activePreset?.instructions) {
      const sourcePath = findPresetSourcePath(cwd, presetName);
      activeInstructions = resolveInstructions(activePreset.instructions, sourcePath);
    }
  }

  const childPermission = normalizePermissionSettings(activePreset?.permission);

  pi.on("before_agent_start", async (event) => {
    const parts: string[] = [];
    if (activeInstructions) parts.push(activeInstructions);

    const allTools = pi
      .getAllTools()
      .map((t) => t.name)
      .sort();
    if (parentSnapshot?.permission) {
      parts.push(
        generatePermissionSummary(normalizePermissionSettings(parentSnapshot.permission), allTools),
      );
      parts.push("Inherited from parent session. Child preset may add extra restrictions only.");
    } else {
      parts.push(generatePermissionSummary(childPermission, allTools));
    }

    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${parts.join("\n\n")}`,
    };
  });

  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire (forwarded to parent)",
    description: "Ask user questions. Answers forwarded to parent session UI.",
    parameters: QuestionnaireParams,
    async execute(toolCallId, params, signal) {
      const id = uuid();
      const request: IpcQuestionnaireRequest = {
        id,
        subagentId: process.env[SUBAGENT_ID_ENV] || "unknown",
        type: "questionnaire",
        toolCallId,
        questions: params.questions,
      };

      writeIpcRequest(controlDir, request);
      const response = (await waitForIpcResponse(
        controlDir,
        id,
        signal,
      )) as IpcQuestionnaireResponse | null;

      if (!response || response.type !== "questionnaire_response") {
        return {
          content: [
            {
              type: "text",
              text: "Error: questionnaire request timed out or parent did not answer.",
            },
          ],
          isError: true,
        };
      }

      if (response.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled questionnaire" }],
          details: { answers: response.answers, cancelled: true },
        };
      }

      const lines = Object.entries(response.answers)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `User answers:\n${lines}` }],
        details: { answers: response.answers, cancelled: false },
      };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (approvedViaIpc.has(event.toolCallId)) return undefined;

    const mode = resolveModeWithParent({
      toolName: event.toolName,
      toolInput: event.input as Record<string, unknown>,
      cwd,
      childPermission,
      parentSnapshot,
    });

    if (mode === "allow") return undefined;
    if (mode === "deny") {
      ctx.abort();
      return {
        block: true,
        reason: `[rejected] Denied by inherited permissions: ${event.toolName}`,
      };
    }

    const requestId = uuid();
    const input = event.input as Record<string, unknown>;
    const message =
      event.toolName === "bash"
        ? ((input.command as string) ?? JSON.stringify(input))
        : event.toolName === "edit" || event.toolName === "write"
          ? ((input.path as string) ?? JSON.stringify(input))
          : JSON.stringify(input, null, 2);

    const request: IpcPermissionRequest = {
      id: requestId,
      subagentId: process.env[SUBAGENT_ID_ENV] || "unknown",
      type: "permission",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      prompt: `Subagent wants to use ${event.toolName}. Allow?`,
      message,
      toolInput: input,
    };

    writeIpcRequest(controlDir, request);
    const response = (await waitForIpcResponse(
      controlDir,
      requestId,
      event.signal ?? ctx.signal,
    )) as IpcPermissionResponse | null;

    if (!response || response.type !== "permission_response") {
      ctx.abort();
      return {
        block: true,
        reason: `[rejected] Permission request timed out: ${event.toolName}`,
      };
    }

    if (!response.approved) {
      ctx.abort();
      return {
        block: true,
        reason: `[rejected] Parent denied: ${event.toolName}`,
      };
    }

    approvedViaIpc.add(event.toolCallId);
    return undefined;
  });
}

// ─── Parent Mode ──────────────────────────────────────────────────────────────

interface ActiveSubagent {
  id: string;
  preset: string;
  task: string;
  controlDir: string;
  sessionFile: string;
  childProcess: ChildProcess | null;
  status: "running" | "completed" | "failed" | "aborted";
  result: SingleResult | null;
  startTime: number;
}

const activeSubagents = new Map<string, ActiveSubagent>();

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
  defaultCwd: string,
  presets: PresetsConfig,
  presetName: string,
  task: string,
  parentSessionFile: string | null,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
  const preset = presets[presetName];

  if (!preset) {
    const available = Object.keys(presets).join(", ") || "none";
    return {
      preset: presetName,
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown preset: "${presetName}". Available presets: ${available}.`,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      step,
    };
  }

  const subagentId = uuid();
  const controlDir = path.join(os.tmpdir(), `pi-subagent-ipc-${process.pid}-${subagentId}`);
  fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });

  // Session file for persistent subagent session
  const sessionDir = path.join(os.tmpdir(), `pi-subagent-sessions-${process.pid}`);
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const safePreset = presetName.replace(/[^\w.-]+/g, "_");
  const safeTask = task.slice(0, 40).replace(/[^\w.-]+/g, "_");
  const sessionFile = path.join(sessionDir, `${subagentId}-${safePreset}-${safeTask}.jsonl`);

  const currentResult: SingleResult = {
    preset: presetName,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    model: preset.model,
    step,
    sessionFile,
  };

  const subagent: ActiveSubagent = {
    id: subagentId,
    preset: presetName,
    task,
    controlDir,
    sessionFile,
    childProcess: null,
    status: "running",
    result: null,
    startTime: Date.now(),
  };
  activeSubagents.set(subagentId, subagent);

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
        details: makeDetails([currentResult]),
      });
    }
  };

  // Build child pi args
  const args: string[] = ["--mode", "json", "-p", "--session", sessionFile, "--preset", presetName];

  if (preset.provider && preset.model) {
    args.push("--model", `${preset.provider}/${preset.model}`);
  } else if (preset.model) {
    args.push("--model", preset.model);
  }
  if (preset.thinkingLevel) {
    args.push("--thinking", preset.thinkingLevel);
  }
  if (preset.tools && preset.tools.length > 0) {
    args.push("--tools", preset.tools.join(","));
  }

  // Resolve instructions to temp file
  let tmpInstructionsPath: string | null = null;
  if (preset.instructions) {
    const sourcePath = findPresetSourcePath(defaultCwd, presetName);
    const resolved = resolveInstructions(preset.instructions, sourcePath);
    if (resolved) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-instr-"));
      tmpInstructionsPath = path.join(tmpDir, "instructions.md");
      fs.writeFileSync(tmpInstructionsPath, resolved, { mode: 0o600 });
      args.push("--append-system-prompt", tmpInstructionsPath);
    }
  }

  const taskPrompt = `Task: ${task}`;
  args.push(taskPrompt);

  // Read parent permission state for inheritance
  let parentPermissionState: string | undefined;
  const parentPermissionStateFile = path.join(
    os.tmpdir(),
    "pi-permission-state",
    `${process.pid}.json`,
  );
  try {
    if (fs.existsSync(parentPermissionStateFile)) {
      parentPermissionState = fs.readFileSync(parentPermissionStateFile, "utf-8");
    }
  } catch {
    /* ignore */
  }

  // Environment for child
  const env: Record<string, string> = { ...process.env };
  env[SUBAGENT_ENV] = "1";
  env[SUBAGENT_CONTROL_DIR_ENV] = controlDir;
  if (parentSessionFile) env[SUBAGENT_PARENT_SESSION_ENV] = parentSessionFile;
  if (parentPermissionState) env[SUBAGENT_PARENT_PERMISSIONS_ENV] = parentPermissionState;
  env[SUBAGENT_ID_ENV] = subagentId;
  env[SUBAGENT_TASK_ENV] = task;

  let wasAborted = false;

  const exitCode = await new Promise<number>((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: defaultCwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    subagent.childProcess = proc;

    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== "object") return;
      const event = parsed as { type?: string; message?: unknown };

      if (event.type === "message_end" && event.message) {
        const msg = event.message as Message;
        currentResult.messages.push(msg);
        if (msg.role === "assistant") {
          currentResult.usage.turns++;
          const usage = msg.usage;
          if (usage) {
            currentResult.usage.input += usage.input || 0;
            currentResult.usage.output += usage.output || 0;
            currentResult.usage.cacheRead += usage.cacheRead || 0;
            currentResult.usage.cacheWrite += usage.cacheWrite || 0;
            currentResult.usage.cost += usage.cost?.total || 0;
            currentResult.usage.contextTokens = usage.totalTokens || 0;
          }
          if (!currentResult.model && msg.model) currentResult.model = msg.model;
          if (msg.stopReason) currentResult.stopReason = msg.stopReason;
          if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
        }
        emitUpdate();
      }

      if (event.type === "tool_result_end" && event.message) {
        currentResult.messages.push(event.message as Message);
        emitUpdate();
      }
    };

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data: Buffer) => {
      currentResult.stderr += data.toString();
    });

    proc.on("close", (code: number | null) => {
      if (buffer.trim()) processLine(buffer);
      resolve(code ?? 0);
    });

    proc.on("error", () => resolve(1));

    if (signal) {
      const killProc = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (signal.aborted) killProc();
      else signal.addEventListener("abort", killProc, { once: true });
    }
  });

  currentResult.exitCode = exitCode;
  subagent.status = wasAborted ? "aborted" : exitCode === 0 ? "completed" : "failed";
  subagent.result = currentResult;

  // Cleanup instructions temp file
  if (tmpInstructionsPath) {
    try {
      fs.unlinkSync(tmpInstructionsPath);
    } catch {
      /* ignore */
    }
    try {
      fs.rmdirSync(path.dirname(tmpInstructionsPath));
    } catch {
      /* ignore */
    }
  }
  cleanupControlDir(controlDir);

  if (wasAborted) throw new Error("Subagent was aborted");
  return currentResult;
}

// ─── Session Viewer ───────────────────────────────────────────────────────────

interface SessionEntry {
  id: string;
  parentId?: string;
  type: string;
  timestamp?: number;
  message?: Message;
  customType?: string;
}

function loadSessionEntries(filePath: string): SessionEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return entries;
}

function extractTextContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function sessionEntriesToLines(entries: SessionEntry[]): string[] {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const msg = entry.message;

    if (msg.role === "user") {
      const text = extractTextContent(msg);
      for (const line of text.split("\n").filter(Boolean)) lines.push(`U ${line}`);
      continue;
    }

    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          for (const line of part.text.split("\n").filter(Boolean)) lines.push(`A ${line}`);
          continue;
        }

        if (part.type === "toolCall") {
          const argsPreview = JSON.stringify(part.arguments);
          const suffix = argsPreview.length > 120 ? `${argsPreview.slice(0, 120)}...` : argsPreview;
          lines.push(`A → ${part.name} ${suffix}`);
        }
      }
      continue;
    }

    if (msg.role === "toolResult") {
      const text = extractTextContent(msg).replace(/\s+/g, " ").trim();
      const preview = text.length > 160 ? `${text.slice(0, 160)}...` : text;
      lines.push(`T ${msg.toolName}${msg.isError ? " (error)" : ""}: ${preview}`);
    }
  }

  return lines;
}

class SubagentSessionOverlay {
  private lines: string[] = [];
  private scrollFromBottom = 0;
  private interval: ReturnType<typeof setInterval>;

  constructor(
    private sessionFile: string,
    private title: string,
    private getStatus: () => ActiveSubagent["status"],
    private tui: { requestRender(): void },
    private theme: {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
    private done: () => void,
  ) {
    this.refresh();
    this.interval = setInterval(() => {
      this.refresh();
      this.tui.requestRender();
    }, 700);
  }

  private refresh(): void {
    if (!fs.existsSync(this.sessionFile)) {
      this.lines = ["(waiting for session file...)"];
      return;
    }

    const entries = loadSessionEntries(this.sessionFile);
    const extracted = sessionEntriesToLines(entries);
    this.lines = extracted.length > 0 ? extracted : ["(session started, no messages yet)"];
  }

  private cropLine(line: string, width: number): string {
    if (line.length <= width) return line.padEnd(width, " ");
    return `${line.slice(0, Math.max(0, width - 1))}…`;
  }

  handleInput(data: string): void {
    if (data === "\u001b" || data === "\u0003") {
      this.done();
      return;
    }

    const bodyHeight = 16;
    const maxScroll = Math.max(0, this.lines.length - bodyHeight);

    if (data === "k" || data === "\u001b[A") {
      this.scrollFromBottom = Math.min(maxScroll, this.scrollFromBottom + 1);
      this.tui.requestRender();
      return;
    }

    if (data === "j" || data === "\u001b[B") {
      this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 1);
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const inner = Math.max(20, width - 2);
    const bodyHeight = 16;
    const maxScroll = Math.max(0, this.lines.length - bodyHeight);
    if (this.scrollFromBottom > maxScroll) this.scrollFromBottom = maxScroll;

    const start = Math.max(0, this.lines.length - bodyHeight - this.scrollFromBottom);
    const visible = this.lines.slice(start, start + bodyHeight);

    const border = (char: string) => this.theme.fg("accent", char);
    const lines: string[] = [];

    const status = this.getStatus();
    const header = `${this.title} [${status}]`;

    lines.push(`${border("╭")}${border("─".repeat(inner))}${border("╮")}`);
    lines.push(`${border("│")}${this.cropLine(this.theme.bold(header), inner)}${border("│")}`);
    lines.push(
      `${border("│")}${this.cropLine(this.theme.fg("dim", "jsonl stream • ↑↓ scroll • esc close"), inner)}${border("│")}`,
    );
    lines.push(`${border("├")}${border("─".repeat(inner))}${border("┤")}`);

    for (const line of visible) {
      lines.push(`${border("│")}${this.cropLine(line, inner)}${border("│")}`);
    }
    for (let i = visible.length; i < bodyHeight; i++) {
      lines.push(`${border("│")}${" ".repeat(inner)}${border("│")}`);
    }

    const scrollInfo =
      this.scrollFromBottom > 0
        ? `scrolled ${this.scrollFromBottom}/${maxScroll}`
        : `tail ${Math.min(this.lines.length, bodyHeight)}/${this.lines.length}`;
    lines.push(`${border("├")}${border("─".repeat(inner))}${border("┤")}`);
    lines.push(
      `${border("│")}${this.cropLine(this.theme.fg("dim", scrollInfo), inner)}${border("│")}`,
    );
    lines.push(`${border("╰")}${border("─".repeat(inner))}${border("╯")}`);

    return lines;
  }

  dispose(): void {
    clearInterval(this.interval);
  }
}

async function showSessionViewer(
  sessionFile: string,
  title: string,
  ctx: ExtensionContext,
  getStatus: () => ActiveSubagent["status"],
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) =>
      new SubagentSessionOverlay(sessionFile, title, getStatus, tui, theme, () => done()),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "85%", maxHeight: 24 },
    },
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const TaskItem = Type.Object({
  preset: Type.String({ description: "Name of the preset to use" }),
  task: Type.String({ description: "Task to delegate" }),
});

const ChainItem = Type.Object({
  preset: Type.String({ description: "Name of the preset to use" }),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
});

const SubagentParams = Type.Object({
  preset: Type.Optional(Type.String({ description: "Preset name (for single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
  tasks: Type.Optional(
    Type.Array(TaskItem, { description: "Array of {preset, task} for parallel execution" }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description: "Array of {preset, task} for sequential chain execution",
    }),
  ),
});

// ─── Extension Export ─────────────────────────────────────────────────────────

export function registerSubagentFeatures(pi: ExtensionAPI): void {
  const isSubagent = process.env[SUBAGENT_ENV] === "1";

  if (isSubagent) {
    setupChildMode(pi);
    return;
  }

  // ─── Parent Mode ──────────────────────────────────────────────────────

  let presets: PresetsConfig = {};

  pi.on("session_start", async (_event, ctx) => {
    presets = loadPresetsConfig(ctx.cwd);
  });

  // ─── IPC handler (async polling loop, only active when subagents exist) ─

  let stopIpcPolling: (() => void) | null = null;
  let ipcAbortController: AbortController | null = null;

  async function startIpcPolling(ctx: ExtensionContext): Promise<void> {
    stopIpcPolling?.();
    ipcAbortController = new AbortController();
    const signal = ipcAbortController.signal;

    const poll = async () => {
      while (!signal.aborted) {
        // Only poll while there are running subagents
        const hasRunning = Array.from(activeSubagents.values()).some(
          (sa) => sa.status === "running",
        );
        if (!hasRunning) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1000);
            const onAbort = () => {
              clearTimeout(timer);
              resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
          });
          continue;
        }

        for (const [, sa] of activeSubagents) {
          if (sa.status !== "running" || !sa.controlDir) continue;
          try {
            const entries = fs.readdirSync(sa.controlDir);
            for (const entry of entries) {
              if (!entry.endsWith(".request.json")) continue;
              const filePath = path.join(sa.controlDir, entry);
              try {
                const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                fs.unlinkSync(filePath);
                // Await the handler to catch errors
                await handleIpcRequest(data, sa, ctx);
              } catch {
                /* skip malformed */
              }
            }
          } catch {
            /* ignore */
          }
        }

        // Poll interval — abortable
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, IPC_POLL_INTERVAL_MS);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    };

    poll().catch(() => {
      /* expected on abort */
    });

    stopIpcPolling = () => {
      ipcAbortController?.abort();
    };
  }

  async function handleIpcRequest(
    request: IpcRequest,
    sa: ActiveSubagent,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!request.id) return;
    if (!ctx.hasUI) {
      const response: IpcResponse =
        request.type === "permission"
          ? { id: request.id, type: "permission_response", approved: false }
          : { id: request.id, type: "questionnaire_response", answers: {}, cancelled: true };
      if (sa.controlDir) writeIpcResponse(sa.controlDir, response);
      return;
    }

    if (request.type === "permission") {
      const req = request as IpcPermissionRequest;
      const allowed = await ctx.ui.confirm(
        `[subagent:${req.subagentId.slice(0, 8)}] ${req.prompt}`,
        req.message,
      );
      const response: IpcPermissionResponse = {
        id: req.id,
        type: "permission_response",
        approved: allowed,
      };
      if (sa.controlDir) writeIpcResponse(sa.controlDir, response);
      return;
    }

    const req = request as IpcQuestionnaireRequest;
    const asked = await askQuestionnaire(ctx, req.questions);
    const response: IpcQuestionnaireResponse = asked.ok
      ? {
          id: req.id,
          type: "questionnaire_response",
          answers: asked.values,
          cancelled: asked.result.cancelled,
        }
      : {
          id: req.id,
          type: "questionnaire_response",
          answers: {},
          cancelled: true,
        };

    if (sa.controlDir) writeIpcResponse(sa.controlDir, response);
  }

  pi.on("session_start", async (_event, ctx) => {
    await startIpcPolling(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopIpcPolling?.();
    // Clean up IPC control directories
    for (const [, sa] of activeSubagents) {
      if (sa.controlDir) cleanupControlDir(sa.controlDir);
    }
    // Clean up session files
    cleanupSessionDir();
    // Clear the subagents map to prevent unbounded growth
    activeSubagents.clear();
  });

  // ─── Subagent Tool ────────────────────────────────────────────────────

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to subagents with isolated context using presets.",
      "Modes: single (preset + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
      "Presets are defined in ~/.pi/agent/presets.json or .pi/presets.json.",
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasTasks = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.preset && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

      const makeDetails =
        (mode: "single" | "parallel" | "chain") =>
        (results: SingleResult[]): SubagentDetails => ({
          mode,
          results,
        });

      if (modeCount !== 1) {
        const available = Object.keys(presets).join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `Invalid parameters. Provide exactly one mode (single/parallel/chain).\nAvailable presets: ${available}`,
            },
          ],
          details: makeDetails("single")([]),
        };
      }

      // ── Chain mode ──
      if (hasChain) {
        const chain = params.chain ?? [];
        const results: SingleResult[] = [];
        let previousOutput = "";

        for (let i = 0; i < chain.length; i++) {
          const step = chain[i];
          const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

          const chainUpdate: OnUpdateCallback | undefined = onUpdate
            ? (partial) => {
                const currentResult = partial.details?.results[0];
                if (currentResult) {
                  const allResults = [...results, currentResult];
                  onUpdate({ content: partial.content, details: makeDetails("chain")(allResults) });
                }
              }
            : undefined;

          try {
            const result = await runSingleAgent(
              ctx.cwd,
              presets,
              step.preset,
              taskWithContext,
              parentSessionFile,
              i + 1,
              signal,
              chainUpdate,
              makeDetails("chain"),
            );
            results.push(result);
            const isError =
              result.exitCode !== 0 ||
              result.stopReason === "error" ||
              result.stopReason === "aborted";
            if (isError) {
              const errorMsg =
                result.errorMessage ||
                result.stderr ||
                getFinalOutput(result.messages) ||
                "(no output)";
              return {
                content: [
                  {
                    type: "text",
                    text: `Chain stopped at step ${i + 1} (${step.preset}): ${errorMsg}`,
                  },
                ],
                details: makeDetails("chain")(results),
                isError: true,
              };
            }
            previousOutput = getFinalOutput(result.messages);
          } catch (err: unknown) {
            if (err instanceof Error && err.message === "Subagent was aborted") {
              return {
                content: [
                  { type: "text", text: `Chain aborted at step ${i + 1} (${step.preset})` },
                ],
                details: makeDetails("chain")(results),
                isError: true,
              };
            }
            throw err;
          }
        }
        return {
          content: [
            {
              type: "text",
              text: getFinalOutput(results[results.length - 1].messages) || "(no output)",
            },
          ],
          details: makeDetails("chain")(results),
        };
      }

      // ── Parallel mode ──
      if (hasTasks) {
        const tasks = params.tasks ?? [];
        if (tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [
              {
                type: "text",
                text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              },
            ],
            details: makeDetails("parallel")([]),
          };
        }

        const allResults: SingleResult[] = new Array(tasks.length);
        for (let i = 0; i < tasks.length; i++) {
          allResults[i] = {
            preset: tasks[i].preset,
            task: tasks[i].task,
            exitCode: -1,
            messages: [],
            stderr: "",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0,
              contextTokens: 0,
              turns: 0,
            },
          };
        }

        const emitParallelUpdate = () => {
          if (onUpdate) {
            const running = allResults.filter((r) => r.exitCode === -1).length;
            const done = allResults.filter((r) => r.exitCode !== -1).length;
            onUpdate({
              content: [
                {
                  type: "text",
                  text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
                },
              ],
              details: makeDetails("parallel")([...allResults]),
            });
          }
        };

        const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (t, index) => {
          try {
            const result = await runSingleAgent(
              ctx.cwd,
              presets,
              t.preset,
              t.task,
              parentSessionFile,
              undefined,
              signal,
              (partial) => {
                if (partial.details?.results[0]) {
                  allResults[index] = partial.details.results[0];
                  emitParallelUpdate();
                }
              },
              makeDetails("parallel"),
            );
            allResults[index] = result;
            emitParallelUpdate();
            return result;
          } catch (err: unknown) {
            if (err instanceof Error && err.message === "Subagent was aborted") {
              allResults[index] = { ...allResults[index], exitCode: 1, stderr: "Aborted" };
              emitParallelUpdate();
              return allResults[index];
            }
            throw err;
          }
        });

        const successCount = results.filter((r) => r.exitCode === 0).length;
        const summaries = results.map((r) => {
          const output = getFinalOutput(r.messages);
          const preview = `${output.slice(0, 100)}${output.length > 100 ? "..." : ""}`;
          return `[${r.preset}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
            },
          ],
          details: makeDetails("parallel")(results),
        };
      }

      // ── Single mode ──
      if (hasSingle) {
        const presetName = params.preset;
        const task = params.task;
        if (!presetName || !task) {
          return {
            content: [{ type: "text", text: "Invalid single mode parameters" }],
            details: makeDetails("single")([]),
            isError: true,
          };
        }

        try {
          const result = await runSingleAgent(
            ctx.cwd,
            presets,
            presetName,
            task,
            parentSessionFile,
            undefined,
            signal,
            onUpdate,
            makeDetails("single"),
          );
          const isError =
            result.exitCode !== 0 ||
            result.stopReason === "error" ||
            result.stopReason === "aborted";
          if (isError) {
            const errorMsg =
              result.errorMessage ||
              result.stderr ||
              getFinalOutput(result.messages) ||
              "(no output)";
            return {
              content: [
                { type: "text", text: `Subagent ${result.stopReason || "failed"}: ${errorMsg}` },
              ],
              details: makeDetails("single")([result]),
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
            details: makeDetails("single")([result]),
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.message === "Subagent was aborted") {
            return {
              content: [{ type: "text", text: "Subagent aborted by user" }],
              details: makeDetails("single")([]),
              isError: true,
            };
          }
          throw err;
        }
      }

      const available = Object.keys(presets).join(", ") || "none";
      return {
        content: [{ type: "text", text: `Invalid parameters. Available presets: ${available}` }],
        details: makeDetails("single")([]),
      };
    },

    renderCall(args, theme, _context) {
      if (args.chain && args.chain.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", `chain (${args.chain.length} steps)`);
        for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
          const step = args.chain[i];
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
          text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.preset)}${theme.fg("dim", ` ${preview}`)}`;
        }
        if (args.chain.length > 3)
          text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }
      if (args.tasks && args.tasks.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
        for (const t of args.tasks.slice(0, 3)) {
          const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
          text += `\n  ${theme.fg("accent", t.preset)}${theme.fg("dim", ` ${preview}`)}`;
        }
        if (args.tasks.length > 3)
          text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }
      const presetName = args.preset || "...";
      const preview = args.task
        ? args.task.length > 60
          ? `${args.task.slice(0, 60)}...`
          : args.task
        : "...";
      let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", presetName);
      text += `\n  ${theme.fg("dim", preview)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as SubagentDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      const mdTheme = getMarkdownTheme();

      const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
        const toShow = limit ? items.slice(-limit) : items;
        const skipped = limit && items.length > limit ? items.length - limit : 0;
        let text = "";
        if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
        for (const item of toShow) {
          if (item.type === "text") {
            const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
            text += `${theme.fg("toolOutput", preview)}\n`;
          } else {
            text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
          }
        }
        return text.trimEnd();
      };

      if (details.mode === "single" && details.results.length === 1) {
        const r = details.results[0];
        const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const displayItems = getDisplayItems(r.messages);
        const finalOutput = getFinalOutput(r.messages);

        if (expanded) {
          const container = new Container();
          let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.preset))}`;
          if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
          container.addChild(new Text(header, 0, 0));
          if (isError && r.errorMessage)
            container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
          container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
          if (displayItems.length === 0 && !finalOutput) {
            container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
          } else {
            for (const item of displayItems) {
              if (item.type === "toolCall") {
                container.addChild(
                  new Text(
                    theme.fg("muted", "→ ") +
                      formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                    0,
                    0,
                  ),
                );
              }
            }
            if (finalOutput) {
              container.addChild(new Spacer(1));
              container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
            }
          }
          const usageStr = formatUsageStats(r.usage, r.model);
          if (usageStr) {
            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
          }
          return container;
        }

        let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.preset))}`;
        if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
        if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
        else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
        else text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
        const usageStr = formatUsageStats(r.usage, r.model);
        if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
        return new Text(text, 0, 0);
      }

      const aggregateUsage = (results: SingleResult[]) => {
        const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
        for (const r of results) {
          total.input += r.usage.input;
          total.output += r.usage.output;
          total.cacheRead += r.usage.cacheRead;
          total.cacheWrite += r.usage.cacheWrite;
          total.cost += r.usage.cost;
          total.turns += r.usage.turns;
        }
        return total;
      };

      if (details.mode === "chain") {
        const successCount = details.results.filter((r) => r.exitCode === 0).length;
        const icon =
          successCount === details.results.length
            ? theme.fg("success", "✓")
            : theme.fg("error", "✗");

        if (expanded) {
          const container = new Container();
          container.addChild(
            new Text(
              icon +
                " " +
                theme.fg("toolTitle", theme.bold("chain ")) +
                theme.fg("accent", `${successCount}/${details.results.length} steps`),
              0,
              0,
            ),
          );
          for (const r of details.results) {
            const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
            const displayItems = getDisplayItems(r.messages);
            const finalOutput = getFinalOutput(r.messages);
            container.addChild(new Spacer(1));
            container.addChild(
              new Text(
                `${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.preset)} ${rIcon}`,
                0,
                0,
              ),
            );
            container.addChild(
              new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0),
            );
            for (const item of displayItems) {
              if (item.type === "toolCall") {
                container.addChild(
                  new Text(
                    theme.fg("muted", "→ ") +
                      formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                    0,
                    0,
                  ),
                );
              }
            }
            if (finalOutput) {
              container.addChild(new Spacer(1));
              container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
            }
            const stepUsage = formatUsageStats(r.usage, r.model);
            if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
          }
          const usageStr = formatUsageStats(aggregateUsage(details.results));
          if (usageStr) {
            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
          }
          return container;
        }

        let text =
          icon +
          " " +
          theme.fg("toolTitle", theme.bold("chain ")) +
          theme.fg("accent", `${successCount}/${details.results.length} steps`);
        for (const r of details.results) {
          const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
          const displayItems = getDisplayItems(r.messages);
          text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.preset)} ${rIcon}`;
          if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
          else text += `\n${renderDisplayItems(displayItems, 5)}`;
        }
        const usageStr = formatUsageStats(aggregateUsage(details.results));
        if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
        text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
        return new Text(text, 0, 0);
      }

      if (details.mode === "parallel") {
        const running = details.results.filter((r) => r.exitCode === -1).length;
        const successCount = details.results.filter((r) => r.exitCode === 0).length;
        const failCount = details.results.filter((r) => r.exitCode > 0).length;
        const isRunning = running > 0;
        const icon = isRunning
          ? theme.fg("warning", "⏳")
          : failCount > 0
            ? theme.fg("warning", "◐")
            : theme.fg("success", "✓");
        const status = isRunning
          ? `${successCount + failCount}/${details.results.length} done, ${running} running`
          : `${successCount}/${details.results.length} tasks`;

        if (expanded && !isRunning) {
          const container = new Container();
          container.addChild(
            new Text(
              `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
              0,
              0,
            ),
          );
          for (const r of details.results) {
            const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
            const displayItems = getDisplayItems(r.messages);
            const finalOutput = getFinalOutput(r.messages);
            container.addChild(new Spacer(1));
            container.addChild(
              new Text(
                `${theme.fg("muted", "─── ") + theme.fg("accent", r.preset)} ${rIcon}`,
                0,
                0,
              ),
            );
            container.addChild(
              new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0),
            );
            for (const item of displayItems) {
              if (item.type === "toolCall") {
                container.addChild(
                  new Text(
                    theme.fg("muted", "→ ") +
                      formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                    0,
                    0,
                  ),
                );
              }
            }
            if (finalOutput) {
              container.addChild(new Spacer(1));
              container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
            }
            const taskUsage = formatUsageStats(r.usage, r.model);
            if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
          }
          const usageStr = formatUsageStats(aggregateUsage(details.results));
          if (usageStr) {
            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
          }
          return container;
        }

        let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
        for (const r of details.results) {
          const rIcon =
            r.exitCode === -1
              ? theme.fg("warning", "⏳")
              : r.exitCode === 0
                ? theme.fg("success", "✓")
                : theme.fg("error", "✗");
          const displayItems = getDisplayItems(r.messages);
          text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.preset)} ${rIcon}`;
          if (displayItems.length === 0)
            text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
          else text += `\n${renderDisplayItems(displayItems, 5)}`;
        }
        if (!isRunning) {
          const usageStr = formatUsageStats(aggregateUsage(details.results));
          if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
        }
        if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
        return new Text(text, 0, 0);
      }

      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
    },
  });

  // ─── /subagents Command ─────────────────────────────────────────────────

  pi.registerCommand("subagents", {
    description: "List and view subagent sessions",
    handler: async (_args, ctx) => {
      const entries = Array.from(activeSubagents.values());
      if (entries.length === 0) {
        ctx.ui.notify("No subagent sessions", "info");
        return;
      }

      const items: SelectItem[] = entries.map((sa) => {
        const elapsed = Math.round((Date.now() - sa.startTime) / 1000);
        const timeStr = sa.status === "running" ? `${elapsed}s` : `${elapsed}s total`;
        const statusIcon =
          sa.status === "completed"
            ? "✓"
            : sa.status === "failed"
              ? "✗"
              : sa.status === "aborted"
                ? "⊘"
                : "⏳";
        const usage = sa.result?.usage;
        const usageStr = usage ? ` | ${usage.turns} turns | $${usage.cost.toFixed(3)}` : "";
        return {
          value: sa.id,
          label: `${statusIcon} ${sa.id.slice(0, 8)} ${sa.preset}: ${sa.task.slice(0, 50)}${sa.task.length > 50 ? "..." : ""}`,
          description: `${sa.status} | ${timeStr}${usageStr}`,
        };
      });

      items.push({ value: "__close__", label: "(close)", description: "Close this list" });

      const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Subagent Sessions"))));

        const list = new SelectList(items, Math.min(items.length, 12), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        list.onSelect = (item) => done(item.value as string);
        list.onCancel = () => done(null);
        container.addChild(list);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            list.handleInput(data);
            tui.requestRender();
          },
        };
      });

      if (!selected || selected === "__close__") return;

      const sa = entries.find((entry) => entry.id === selected);
      if (!sa) return;

      await showSessionViewer(
        sa.sessionFile,
        `Subagent: ${sa.preset} - ${sa.task.slice(0, 40)}`,
        ctx,
        () => sa.status,
      );
    },
  });

  // ─── /subagent-view Command ─────────────────────────────────────────────

  pi.registerCommand("subagent-view", {
    description: "View a specific subagent session by ID prefix",
    getArgumentCompletions: (prefix: string) => {
      const entries = Array.from(activeSubagents.values());
      const filtered = entries.filter((sa) => sa.id.startsWith(prefix));
      return filtered.map((sa) => ({
        value: sa.id.slice(0, 8),
        label: `${sa.preset}: ${sa.task.slice(0, 40)}`,
      }));
    },
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /subagent-view <id-prefix>", "warning");
        return;
      }
      const prefix = args.trim();
      const matches = Array.from(activeSubagents.values()).filter((s) => s.id.startsWith(prefix));

      if (matches.length === 0) {
        ctx.ui.notify(`No subagent matching "${prefix}"`, "warning");
        return;
      }

      if (matches.length > 1) {
        const list = matches.map((s) => `${s.id.slice(0, 8)} ${s.preset}: ${s.task.slice(0, 40)}`);
        ctx.ui.notify(`Multiple matches: ${list.join(" | ")}`, "warning");
        return;
      }

      const sa = matches[0];
      await showSessionViewer(
        sa.sessionFile,
        `Subagent: ${sa.preset} - ${sa.task.slice(0, 40)}`,
        ctx,
        () => sa.status,
      );
    },
  });
}

// Prevent accidental auto-registration if this helper module is discovered directly.
export default function (): void {}
