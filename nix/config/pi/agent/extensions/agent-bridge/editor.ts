// The editor plugin: Neovim <-> pi (nvim/lua/config/agent-bridge). Edit and
// plan review, open_in_editor, follow, ambient editor context, notes, and
// the "nvim" part of the widget above pi's editor.
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { countChanges as countBaselineChanges, trackBaseline } from "./baselines.js";
import { type Bridge, MAX_LINE_BYTES } from "./core.js";
import { deliverNote, deliverReview } from "./notes.js";

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

export function toolPath(args: any): string | undefined {
  const p = args?.path ?? args?.file_path ?? args?.filePath;
  return typeof p === "string" ? p : undefined;
}

/** Cuts text to about `max` characters at a line break, saying how many lines were left out. */
export function clipSelection(text: string, max = MAX_CONTEXT_SELECTION): string {
  if (text.length <= max) return text;
  let cut = text.lastIndexOf("\n", max);
  if (cut <= 0) cut = max;
  const rest = text.slice(cut).replace(/^\n/, "");
  const more = rest.split("\n").length;
  return `${text.slice(0, cut)}\n… (${more} more line${more === 1 ? "" : "s"})`;
}

/**
 * The hidden note on what the user has open, like Claude Code's and
 * opencode's: the file, or the selection. Cursor and scroll position are
 * left out (@this and @visible give them), so moving around doesn't make
 * the next prompt carry it again; see the before_agent_start handler.
 */
export function contextText(c: EditorContext): string | undefined {
  if (!c.file) return undefined;
  const file = `${c.file}${c.modified ? " (unsaved changes)" : ""}`;
  const parts: string[] = [];
  if (c.selection) {
    const range = c.selection.first === c.selection.last ? `line ${c.selection.first}` : `lines ${c.selection.first}-${c.selection.last}`;
    parts.push(`The user selected ${range} of ${file} in Neovim${c.selection.text ? ":" : "."}`);
    if (c.selection.text) parts.push("```" + (c.filetype ?? "") + "\n" + clipSelection(c.selection.text) + "\n```");
  } else {
    parts.push(`The user has ${file} open in Neovim.`);
  }
  parts.push("This may or may not be related to their request.");
  return parts.join("\n");
}

// Mirror pi's matching on LF text: every oldText must match exactly once.
// Anything fuzzier is left to pi, which reports its own error.
function proposedContent(toolName: string, input: any, cwd: string) {
  const rel = toolPath(input);
  if (!rel) return undefined;
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
  const base = original.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
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

export interface EditorHooks {
  /** Neovim sent a note for an agent other than this pi (see agents/). */
  routeNote?: (agent: string, text: string, review?: boolean) => boolean;
}

export function registerEditor(pi: any, bridge: Bridge, hooks: EditorHooks = {}) {
  const editors = () => bridge.clients("editor");
  const cwdOf = (ctx?: any) => ctx?.cwd ?? bridge.ctx?.cwd ?? process.cwd();
  const toolArgs = new Map<string, { toolName: string; args: any }>();
  const adjusted = new Set<string>(); // tool calls the user changed in Neovim before accepting
  const editLines = new Map<string, number>(); // tool call id -> line where an edit landed
  const waitingOn = new Map<string, string>(); // what pi waits on the user for, by request id
  let editorContext: EditorContext | undefined;
  let injectedContext: string | undefined;
  let prefs: { follow?: boolean; review?: string } = {};
  let changesCount = 0;

  // Files under cwd that an agent changed and you haven't reviewed (see baselines.ts).
  const countChanges = () => {
    changesCount = countBaselineChanges(cwdOf());
  };

  /** Called when a file changed, here or in a child agent. */
  function filesChanged(paths: string[]) {
    bridge.broadcast("editor", "files_changed", { paths });
    countChanges();
    bridge.renderWidget();
  }

  bridge.setWidgetPart("editor", 0, (t) => {
    const sep = t.fg("dim", " · ");
    const delta = changesCount ? t.fg("accent", `Δ ${changesCount} file${changesCount === 1 ? "" : "s"}`) : undefined;
    if (editors().length === 0) return [t.fg("dim", "󰕷 no editor"), delta].filter(Boolean).join(sep);
    let editor = t.fg("success", "󰕷") + " nvim";
    if (waitingOn.size) return editor + sep + t.fg("warning", `⏳ waiting for you: ${[...waitingOn.values()].at(-1)} in Neovim`);
    const c = editorContext;
    if (c?.file) {
      const rel = path.relative(cwdOf(), c.file);
      editor += " " + t.fg("muted", `${rel && !rel.startsWith("..") ? rel : path.basename(c.file)}${c.line ? `:${c.line}` : ""}`);
      if (c.selection) editor += t.fg("dim", ` (sel ${c.selection.first}-${c.selection.last})`);
    }
    const parts = [editor];
    if (prefs.follow) parts.push(t.fg("accent", "󰁌 follow"));
    if (delta) parts.push(delta);
    // Show only per-edit review; the default "off" means review later with <leader>ad.
    if (prefs.review && prefs.review !== "off") parts.push(t.fg("dim", `󰈈 ${prefs.review}`));
    return parts.join(sep);
  });

  function askEditor(kind: string, payload: Record<string, unknown>, signal?: AbortSignal, status?: string, waitLabel?: string) {
    return bridge.ask("editor", kind, payload, {
      signal,
      status,
      onWait: (id, on) => {
        if (on) waitingOn.set(id, waitLabel ?? kind);
        else waitingOn.delete(id);
        bridge.renderWidget();
      },
    });
  }

  bridge.onClient("disconnect", (c) => {
    if (c.role !== "editor" || editors().length) return;
    editorContext = undefined;
    prefs = {};
  });

  // ---- methods Neovim calls ----

  bridge.registerMethod("editor", "prompt", (_c, p) => {
    const text = p?.text;
    if (typeof text !== "string" || text.trim() === "" || Buffer.byteLength(text) > MAX_LINE_BYTES) throw new Error("invalid prompt");
    if (bridge.ctx?.isIdle?.() === false) pi.sendUserMessage(text, { deliverAs: "followUp" });
    else pi.sendUserMessage(text);
  });
  bridge.registerMethod("editor", "set_context", (_c, p) => {
    editorContext = p && typeof p === "object" && typeof p.file === "string" ? p : undefined;
    bridge.renderWidget();
  });
  bridge.registerMethod("editor", "set_prefs", (_c, p) => {
    prefs = { follow: !!p.follow, review: typeof p.review === "string" ? p.review : undefined };
    if (p.changes_updated) countChanges();
    bridge.renderWidget();
  });
  // { text, agent? }: agent is the change's author from the review; notes
  // for a child agent go to that child.
  bridge.registerMethod("editor", "note", (_c, p) => {
    const text = p?.text;
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 16384) throw new Error("invalid note");
    const agent = typeof p.agent === "string" ? p.agent : "main";
    if (agent !== "main" && hooks.routeNote?.(agent, text.trim())) return;
    deliverNote(pi, text.trim());
  });
  // { text, agent? }: review comments from Neovim, shown as a user message
  // to the agent that made the change (agent) or to this pi.
  bridge.registerMethod("editor", "review", (_c, p) => {
    const text = p?.text;
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > MAX_LINE_BYTES) throw new Error("invalid review");
    const agent = typeof p.agent === "string" ? p.agent : "main";
    if (agent !== "main" && hooks.routeNote?.(agent, text.trim(), true)) return;
    deliverReview(pi, text.trim(), bridge.ctx?.isIdle?.() !== false);
  });
  bridge.registerMethod("editor", "append_prompt", (_c, p) => {
    const text = p?.text;
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_LINE_BYTES || bridge.ctx?.mode !== "tui")
      throw new Error("cannot append prompt");
    bridge.ctx.ui.pasteToEditor(text);
  });

  // ---- tool events: follow, files_changed ----

  pi.on("session_start", () => {
    countChanges();
    bridge.renderWidget();
  });
  pi.on("tool_execution_start", (event: any) => {
    toolArgs.set(event.toolCallId, { toolName: event.toolName, args: event.args });
    bridge.broadcast("editor", "tool_start", { tool_call_id: event.toolCallId, tool_name: event.toolName });
    const rel = toolPath(event.args);
    if (event.toolName === "read" && rel)
      bridge.broadcast("editor", "follow", {
        tool: "read",
        path: path.resolve(cwdOf(), rel),
        line: typeof event.args?.offset === "number" ? event.args.offset : undefined,
      });
  });
  pi.on("tool_execution_end", (event: any) => {
    const call = toolArgs.get(event.toolCallId);
    toolArgs.delete(event.toolCallId);
    bridge.broadcast("editor", "tool_end", { tool_call_id: event.toolCallId, tool_name: event.toolName, is_error: event.isError });
    if (!event.isError && call && ["edit", "write"].includes(call.toolName)) {
      const rel = toolPath(call.args);
      if (rel) {
        const file = path.resolve(cwdOf(), rel);
        filesChanged([file]);
        bridge.broadcast("editor", "follow", { tool: call.toolName, path: file, line: editLines.get(event.toolCallId) });
      }
    }
    editLines.delete(event.toolCallId);
  });

  // ---- edit review: Neovim shows each edit as a diff before it lands ----

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const cwd = cwdOf(ctx);
    const rel = toolPath(event.input);
    const change = proposedContent(event.toolName, event.input, cwd);
    if (change) editLines.set(event.toolCallId, firstChangedLine(change.original, change.proposed));
    const track = () => {
      if (rel) trackBaseline(path.resolve(cwd, rel));
      return undefined;
    };
    if (!change || editors().length === 0) return track();
    const shown = path.relative(cwd, change.file) || change.file;
    const result = await askEditor(
      "review_edit",
      { tool: event.toolName, path: change.file, exists: change.exists, original: change.original, proposed: change.proposed },
      ctx?.signal,
      `Review edit to ${shown} in Neovim`,
      `edit to ${path.basename(change.file)}`,
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

  // ---- plan review: plans are Markdown files with CriticMarkup comments ----

  pi.registerTool({
    name: "submit_plan",
    label: "Submit plan",
    description:
      "Ask the user to review a plan you wrote to a Markdown file. Opens it in the user's Neovim, where they comment inline with CriticMarkup, and waits for them to approve or request changes.",
    promptSnippet: "Submit a Markdown plan file for the user's review in Neovim and wait for approval",
    promptGuidelines: [
      "When you write a plan for the user to review before implementing, save it as a Markdown file and call submit_plan with its path. Do not start implementing until submit_plan returns approved.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the Markdown plan file" }),
      summary: Type.Optional(Type.String({ description: "One line on what changed since the last review" })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal, _onUpdate: any, ctx: any) {
      const file = path.resolve(cwdOf(ctx), params.path);
      if (!fs.existsSync(file)) throw new Error(`No plan file at ${file}`);
      const result = await askEditor("review_plan", { path: file, summary: params.summary }, signal, "Review the plan in Neovim", "plan review");
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
        lines.push(
          "The user requested changes to the plan. Revise the plan file, then call submit_plan again.",
          "Comments are CriticMarkup in the file: {==quoted text==}{>>comment<<} is on a span; {>>comment<<} alone is a general comment there. Comments starting with 'pi:' are yours.",
          "Resolve a comment by changing the plan and removing its markup (keep the quoted text unless the change replaces it), or answer it inline with {>>pi: your reply<<} right after it, leaving the user's comment in place.",
        );
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

  // ---- jump to code: open a file at a line in the user's Neovim ----

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
      const cwd = cwdOf(ctx);
      const file = path.resolve(cwd, params.path);
      if (editors().length === 0)
        return { content: [{ type: "text", text: "Neovim isn't connected; give the user the path and line instead." }], details: {} };
      bridge.broadcast("editor", "open", { path: file, line: params.line, col: params.col });
      return { content: [{ type: "text", text: `Opened ${path.relative(cwd, file) || file}${params.line ? `:${params.line}` : ""} in Neovim.` }], details: {} };
    },
  });

  // ---- ambient context: where the user is in Neovim, added to each prompt ----

  pi.on("before_agent_start", (event: any) => {
    if (event.messageType !== "user") return;
    const parts: string[] = [];
    if (editorContext && editors().length > 0) {
      const text = contextText(editorContext);
      // Only when the file, its unsaved state or the selection changed.
      if (text && text !== injectedContext) {
        injectedContext = text;
        parts.push(text);
      }
    }
    if (!parts.length) return;
    // Leading blank line: providers that merge consecutive user messages
    // (pi-claude-code) would otherwise run this into the user's last word.
    return { message: { customType: "editor-context", content: `\n\n${parts.join("\n\n")}`, display: false } };
  });

  return { filesChanged };
}

