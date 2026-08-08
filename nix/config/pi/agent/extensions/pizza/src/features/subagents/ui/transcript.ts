/**
 * Transcript rendering for the takeover view: turns a SubagentSnapshot's
 * normalized transcript + live state into plain wrapped lines. Ported from
 * v1, with the session-poking replaced by snapshot reads.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SubagentSnapshot, TranscriptItem } from "../state.js";

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Strip raw ANSI codes, expand tabs, and drop control chars. Terminal-expanded
 * tabs (and stray escapes) make lines wider than the width we declare to the
 * TUI, which desyncs the renderer and smears the overlay.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(ANSI_PATTERN, "")
    .replaceAll("\t", "  ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function renderUserText(
  theme: Theme,
  text: string,
  width: number,
  out: string[],
) {
  const clean = sanitizeText(text).trim();
  if (!clean) return;
  const wrapped = wrapTextWithAnsi(clean, Math.max(10, width - 2));
  for (let i = 0; i < wrapped.length; i++) {
    const prefix = i === 0 ? theme.fg("accent", "> ") : "  ";
    out.push(
      truncateToWidth(prefix + theme.fg("userMessageText", wrapped[i]), width),
    );
  }
}

function renderThinking(
  theme: Theme,
  text: string,
  width: number,
  out: string[],
) {
  const reasoning = sanitizeText(text).trim();
  if (!reasoning) return;
  const prefix = theme.fg("dim", "~ ");
  const wrapped = wrapTextWithAnsi(reasoning, Math.max(10, width - 2));
  for (let i = 0; i < wrapped.length; i++) {
    out.push(
      truncateToWidth(
        (i === 0 ? prefix : "  ") + theme.fg("muted", theme.italic(wrapped[i])),
        width,
      ),
    );
  }
}

function toolSummary(name: string, raw?: string) {
  if (!raw || raw === "{}") return "";
  try {
    const args = JSON.parse(raw) as Record<string, unknown>;
    const path = args.path ?? args.file_path;
    if (name === "bash") return String(args.command ?? "");
    if (name === "read") {
      const range = [
        args.offset && `from ${args.offset}`,
        args.limit && `${args.limit} lines`,
      ]
        .filter(Boolean)
        .join(", ");
      return `${String(path ?? "")}${range ? ` (${range})` : ""}`;
    }
    if (["edit", "write"].includes(name)) return String(path ?? "");
    if (["rg", "grep", "fd", "find"].includes(name))
      return [args.pattern, path].filter(Boolean).map(String).join(" in ");
    return Object.entries(args)
      .slice(0, 3)
      .map(
        ([key, value]) =>
          `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join(" ");
  } catch {
    return raw;
  }
}

function renderAssistantItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "assistant" }>,
  width: number,
  out: string[],
) {
  for (const part of item.parts) {
    if (part.type === "text") {
      const text = sanitizeText(part.text).trim();
      if (!text) continue;
      out.push(...wrapTextWithAnsi(text, width));
    } else if (part.type === "thinking") {
      renderThinking(
        theme,
        part.redacted ? "[redacted reasoning]" : part.text,
        width,
        out,
      );
    } else if (part.type === "toolCall") {
      const summary = sanitizeText(toolSummary(part.name, part.argsPreview));
      const prefix = theme.fg("toolTitle", `● ${part.name}`);
      const wrapped = wrapTextWithAnsi(summary, Math.max(10, width - 2));
      out.push(
        truncateToWidth(
          prefix + (wrapped[0] ? theme.fg("toolOutput", ` ${wrapped[0]}`) : ""),
          width,
        ),
      );
      for (const line of wrapped.slice(1, 4))
        out.push(truncateToWidth(theme.fg("toolOutput", `  ${line}`), width));
    }
  }
}

function renderToolResultItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "toolResult" }>,
  width: number,
  out: string[],
) {
  const clean = sanitizeText(item.outputPreview ?? "").trim();
  const wrapped = wrapTextWithAnsi(
    clean || "(no output)",
    Math.max(10, width - 4),
  );
  const color = item.isError ? "error" : "toolOutput";
  const marker = item.isError ? "└ error " : "└ ";
  for (let i = 0; i < Math.min(6, wrapped.length); i++)
    out.push(
      truncateToWidth(
        theme.fg(color, `${i === 0 ? marker : "  "}${wrapped[i]}`),
        width,
      ),
    );
  if (wrapped.length > 6)
    out.push(
      truncateToWidth(
        theme.fg("dim", `  … ${wrapped.length - 6} more lines`),
        width,
        "",
      ),
    );
}

/** Render a subagent's conversation as plain lines, wrapped to `width`. */
export function buildTranscriptLines(
  snap: SubagentSnapshot,
  width: number,
  theme: Theme,
): string[] {
  if (width <= 0) return [];
  const out: string[] = [];

  for (const item of snap.transcript) {
    const before = out.length;
    if (item.kind === "user") {
      renderUserText(theme, item.text, width, out);
    } else if (item.kind === "assistant") {
      renderAssistantItem(theme, item, width, out);
    } else {
      renderToolResultItem(theme, item, width, out);
    }
    if (out.length > before) out.push("");
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  // Live streaming assistant buffers (cleared when the finalized message lands).
  if (snap.liveAssistant) {
    const { thinking, text } = snap.liveAssistant;
    const before = out.length;
    if (out.length > 0) out.push("");
    if (thinking.trim()) renderThinking(theme, thinking, width, out);
    if (text.trim())
      out.push(...wrapTextWithAnsi(sanitizeText(text).trim(), width));
    if (out.length === before + 1) out.pop();
  }

  // Live tool executions (present until the ToolEnd lands in the transcript).
  for (const tool of snap.liveTools) {
    if (out.length > 0) out.push("");
    const marker = tool.done
      ? tool.isError
        ? theme.fg("error", "error")
        : theme.fg("success", "done")
      : theme.fg("warning", "running");
    let line = `${theme.fg("toolTitle", `● ${tool.name}`)} ${marker}`;
    const summary = sanitizeText(toolSummary(tool.name, tool.argsPreview));
    if (summary) line += theme.fg("toolOutput", ` ${summary}`);
    const preview = tool.outputPreview && sanitizeText(tool.outputPreview);
    if (preview) line += theme.fg("dim", ` · ${preview.split("\n")[0]}`);
    out.push(truncateToWidth(line, width));
  }

  // Queued steering/follow-up messages: show them immediately so Enter
  // visibly acknowledges the user's input instead of appearing to do nothing.
  for (const message of snap.queued) {
    if (out.length > 0) out.push("");
    const prefix = theme.fg("warning", `> [queued ${message.kind}] `);
    const wrapped = wrapTextWithAnsi(
      sanitizeText(message.text),
      Math.max(10, width - visibleWidth(prefix)),
    );
    for (let i = 0; i < wrapped.length; i++) {
      out.push(
        truncateToWidth(
          (i === 0 ? prefix : " ".repeat(visibleWidth(prefix))) +
            theme.fg("muted", wrapped[i]),
          width,
        ),
      );
    }
  }

  // Keep the renderer contract even for narrow widths and unusual ANSI-aware
  // wrapping behavior: no returned line may exceed the requested width.
  return out.map((line) => truncateToWidth(line, width, ""));
}
