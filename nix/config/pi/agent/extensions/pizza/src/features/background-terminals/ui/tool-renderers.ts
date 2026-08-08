import { formatSize, type Theme } from "@earendil-works/pi-coding-agent";
import type { TerminalSnapshot, TerminalStatus } from "../state.js";
import type { TerminalReadModel } from "../manager.js";
import { sanitizeText } from "./output-view.js";

export const WAIT_UPDATE_THROTTLE_MS = 100;
const WAIT_UPDATE_MAX_BYTES = 16 * 1024;

export interface TerminalToolDetails {
  id: string;
  title: string;
  status: TerminalStatus;
  pid?: number;
  exit?: string;
  elapsedMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  summary?: string;
}

export interface WaitToolDetails {
  terminal: TerminalToolDetails;
  completed: boolean;
  timeoutMs?: number;
  timeoutRemainingMs?: number;
}

export interface WaitToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: WaitToolDetails;
}

const oneLine = (value: unknown, max = 160) => {
  const text = sanitizeText(typeof value === "string" ? value : "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
};

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

function duration(ms: number) {
  if (ms < 1_000) return `${Math.max(1, Math.ceil(ms))}ms`;
  const seconds = Math.ceil(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function statusPresentation(status: TerminalStatus) {
  switch (status) {
    case "done":
      return { glyph: "✓", label: "done", color: "success" as const };
    case "failed":
      return { glyph: "✗", label: "failed", color: "error" as const };
    case "killed":
      return { glyph: "■", label: "killed", color: "muted" as const };
    default:
      return { glyph: "●", label: "running", color: "warning" as const };
  }
}

function snapshotSummary(snapshot: TerminalSnapshot) {
  if (snapshot.errorText) return oneLine(snapshot.errorText);
  const stderr = oneLine(
    snapshot.stderr.text.split("\n").filter(Boolean).at(-1),
  );
  if (stderr) return stderr;
  return oneLine(snapshot.stdout.text.split("\n").filter(Boolean).at(-1));
}

export function terminalDetails(
  snapshot: TerminalSnapshot,
  now = Date.now(),
): TerminalToolDetails {
  const exit =
    snapshot.status === "running"
      ? undefined
      : (snapshot.signal ??
        (snapshot.exitCode !== undefined
          ? `exit ${snapshot.exitCode}`
          : snapshot.status));
  return {
    id: oneLine(snapshot.id, 80) || "?",
    title: oneLine(snapshot.title, 100) || snapshot.id,
    status: snapshot.status,
    pid: finite(snapshot.pid),
    exit,
    elapsedMs: Math.max(0, (snapshot.settledAt ?? now) - snapshot.createdAt),
    stdoutBytes: finite(snapshot.stdout.totalBytes),
    stderrBytes: finite(snapshot.stderr.totalBytes),
    summary: snapshotSummary(snapshot) || undefined,
  };
}

function safeDetails(value: unknown): TerminalToolDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<TerminalToolDetails>;
  if (typeof input.id !== "string") return undefined;
  const status: TerminalStatus =
    input.status === "done" ||
    input.status === "failed" ||
    input.status === "killed"
      ? input.status
      : "running";
  return {
    id: oneLine(input.id, 80) || "?",
    title: oneLine(input.title, 100) || input.id,
    status,
    pid: finite(input.pid),
    exit: oneLine(input.exit, 40) || undefined,
    elapsedMs: finite(input.elapsedMs),
    stdoutBytes: finite(input.stdoutBytes),
    stderrBytes: finite(input.stderrBytes),
    summary: oneLine(input.summary, 160) || undefined,
  };
}

function contentText(result: { content?: unknown }) {
  if (!Array.isArray(result.content)) return "";
  return sanitizeText(
    result.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          !!part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("\n"),
  ).trim();
}

function terminalLine(details: TerminalToolDetails, theme: Theme) {
  const state = statusPresentation(details.status);
  const facts = [
    theme.fg(state.color, state.label),
    details.exit,
    details.elapsedMs === undefined ? undefined : duration(details.elapsedMs),
    details.pid === undefined ? undefined : `pid ${details.pid}`,
    details.stdoutBytes === undefined
      ? undefined
      : `stdout ${formatSize(details.stdoutBytes)}`,
    details.stderrBytes === undefined
      ? undefined
      : `stderr ${formatSize(details.stderrBytes)}`,
  ].filter(Boolean);
  return `${theme.fg("dim", "└─")} ${theme.fg(state.color, state.glyph)} ${theme.fg("text", details.title)}${facts.length ? ` ${theme.fg("dim", "·")} ${facts.join(` ${theme.fg("dim", "·")} `)}` : ""}`;
}

function terminalTree(
  details: ReadonlyArray<TerminalToolDetails>,
  theme: Theme,
  summaries = false,
) {
  const lines = [theme.fg("muted", "Terminals")];
  details.forEach((terminal, index) => {
    const last = index === details.length - 1;
    const line = terminalLine(terminal, theme).replace(
      theme.fg("dim", "└─"),
      theme.fg("dim", last ? "└─" : "├─"),
    );
    lines.push(line);
    if (summaries && terminal.summary) {
      lines.push(
        `${theme.fg("dim", `${last ? "  " : "│ "} └─`)} ${theme.fg("muted", terminal.summary)}`,
      );
    }
  });
  if (!details.length) lines.push(theme.fg("dim", "└─ none"));
  return lines.join("\n");
}

export function startCallText(
  args: { title?: string; command?: string },
  theme: Theme,
) {
  const title = oneLine(args.title, 80) || "terminal";
  const command = oneLine(args.command, 120);
  return [
    `${theme.fg("success", "●")} ${theme.fg("toolTitle", theme.bold(`bg_start(${title})`))}`,
    command ? theme.fg("muted", command) : "",
  ]
    .filter(Boolean)
    .join("  ");
}

export function startResultText(result: { details?: unknown }, theme: Theme) {
  const details = (result.details ?? {}) as { id?: unknown; status?: unknown };
  const id = oneLine(details.id, 80) || "unknown";
  const running = details.status === "running";
  return `${theme.fg("dim", "└─")} ${theme.fg(running ? "muted" : "success", running ? "Running in background" : "Started")} ${theme.fg("dim", `(ID: ${id})`)}`;
}

export function waitCallText(
  id: string,
  timeoutMs: number | undefined,
  theme: Theme,
) {
  const timeout =
    timeoutMs === undefined ? "" : ` · timeout ${duration(timeoutMs)}`;
  return `${theme.fg("toolTitle", theme.bold("bg_wait"))} ${theme.fg("muted", `1 terminal${timeout}`)} ${theme.fg("dim", `(${oneLine(id, 80) || "?"})`)}`;
}

function waitTreeText(details: WaitToolDetails, theme: Theme, summary = false) {
  const lines = terminalTree([details.terminal], theme, summary).split("\n");
  if (!details.completed && details.timeoutRemainingMs !== undefined) {
    lines[1] = `${lines[1] ?? ""} ${theme.fg("dim", "·")} ${theme.fg("warning", `timeout in ${duration(details.timeoutRemainingMs)}`)}`;
  }
  return lines.join("\n");
}

function waitDetails(
  snapshot: TerminalSnapshot,
  completed: boolean,
  timeoutMs: number | undefined,
  deadline: number | undefined,
  now = Date.now(),
): WaitToolDetails {
  return {
    terminal: terminalDetails(snapshot, now),
    completed,
    timeoutMs,
    timeoutRemainingMs:
      !completed && deadline !== undefined
        ? Math.max(0, deadline - now)
        : undefined,
  };
}

function waitUpdate(
  view: TerminalReadModel,
  id: string,
  timeoutMs: number | undefined,
  deadline: number | undefined,
): WaitToolResult {
  const snapshot = view.get(id);
  if (!snapshot) throw new Error(`Unknown terminal id "${id}"`);
  const details = waitDetails(
    snapshot,
    snapshot.status !== "running",
    timeoutMs,
    deadline,
  );
  const state = statusPresentation(details.terminal.status);
  const facts = [
    state.label,
    details.terminal.exit,
    details.terminal.elapsedMs === undefined
      ? undefined
      : duration(details.terminal.elapsedMs),
    details.timeoutRemainingMs === undefined
      ? undefined
      : `timeout in ${duration(details.timeoutRemainingMs)}`,
  ].filter(Boolean);
  let text = `Terminals\n└─ ${state.glyph} ${details.terminal.title}${facts.length ? ` · ${facts.join(" · ")}` : ""}`;
  // Partial content is model-facing too; keep it plain and bounded.
  if (Buffer.byteLength(text) > WAIT_UPDATE_MAX_BYTES)
    text = `${text.slice(0, WAIT_UPDATE_MAX_BYTES - 1)}…`;
  return { content: [{ type: "text", text }], details };
}

export type WaitForTerminal = (
  id: string,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<{ snapshot: TerminalSnapshot; completed: boolean }>;

/** Wait with a read-only view and an explicit command callback. */
export async function waitWithLiveUpdates(
  view: TerminalReadModel,
  wait: WaitForTerminal,
  id: string,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ((result: WaitToolResult) => void) | undefined,
  throttleMs = WAIT_UPDATE_THROTTLE_MS,
) {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;
  let lastPublishedAt = 0;
  const publish = () => {
    timer = undefined;
    lastPublishedAt = Date.now();
    if (!onUpdate) return;
    try {
      onUpdate(waitUpdate(view, id, timeoutMs, deadline));
    } catch {
      // Rendering progress must not interfere with process lifecycle events.
    }
  };
  const schedule = () => {
    const delay = Math.max(0, throttleMs - (Date.now() - lastPublishedAt));
    if (delay === 0) {
      if (timer) clearTimeout(timer);
      publish();
    } else if (!timer) timer = setTimeout(publish, delay);
  };
  const unsubscribe = view.subscribeTo(id, schedule);
  if (deadline !== undefined) countdown = setInterval(schedule, 250);
  try {
    publish();
    const result = await wait(id, timeoutMs, signal);
    return {
      ...result,
      details: waitDetails(
        result.snapshot,
        result.completed,
        timeoutMs,
        deadline,
      ),
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (countdown) clearInterval(countdown);
    unsubscribe();
  }
}

export function waitResultText(
  result: { content?: unknown; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
) {
  const input = result.details as Partial<WaitToolDetails> | undefined;
  const terminal = safeDetails(input?.terminal);
  const body = contentText(result);
  if (!terminal) return body || theme.fg("dim", "Waiting…");
  const details: WaitToolDetails = {
    terminal,
    completed: input?.completed === true,
    timeoutMs: finite(input?.timeoutMs),
    timeoutRemainingMs: finite(input?.timeoutRemainingMs),
  };
  if (options.isPartial) return waitTreeText(details, theme);
  const tree = waitTreeText(details, theme, !options.expanded);
  const timedOut = !details.completed && details.timeoutMs !== undefined;
  const outcome = timedOut
    ? `\n${theme.fg("warning", "◷")} ${theme.fg("warning", `Timed out after ${duration(details.timeoutMs!)}; terminal still running`)}`
    : "";
  if (options.expanded)
    return `${tree}${outcome}\n\n${theme.fg("dim", "Outputs")}\n${body || "(no output)"}`;
  return `${tree}${outcome}\n${theme.fg("dim", "ctrl+o to expand outputs")}`;
}

export function simpleCallText(
  tool: string,
  subject: string | number | undefined,
  theme: Theme,
) {
  return `${theme.fg("toolTitle", theme.bold(tool))}${subject === undefined ? "" : ` ${theme.fg("muted", String(subject))}`}`;
}

export function terminalResultText(
  result: { content?: unknown; details?: unknown },
  options: { expanded: boolean },
  theme: Theme,
  key: "terminal" | "terminals" | "results",
) {
  const raw = (result.details ?? {}) as Record<string, unknown>;
  const values =
    key === "terminal" ? [raw[key]] : Array.isArray(raw[key]) ? raw[key] : [];
  const terminals = values
    .map(safeDetails)
    .filter((item): item is TerminalToolDetails => !!item);
  const body = contentText(result);
  if (!terminals.length) return body || theme.fg("dim", "No terminals.");
  const tree = terminalTree(terminals, theme, !options.expanded);
  if (options.expanded && body)
    return `${tree}\n\n${theme.fg("dim", "Outputs")}\n${body}`;
  if (!options.expanded && body)
    return `${tree}\n${theme.fg("dim", "ctrl+o to expand outputs")}`;
  return tree;
}
