import fs from "node:fs";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  MAX_RUNNING,
  REASONING_EFFORTS,
  formatElapsed,
  latestText,
  type SpawnTask,
  type SubagentSnapshot,
} from "./src/domain.ts";
import { createSubagentManager, type SubagentManager } from "./src/manager.ts";
import { createDeferredResultDelivery } from "./src/result-delivery.ts";
import { resolveChildCwd } from "./src/trust.ts";
import { installSubagentEditorNavigation } from "./src/ui/agent-editor.ts";
import { oneLineSummary, resultCardText } from "./src/ui/result-card.ts";
import {
  waitCallText,
  waitDetailsFromSnapshots,
  waitResultText,
  waitWithLiveUpdates,
  type WaitToolResult,
} from "./src/ui/wait-tool.ts";
import { openSubagentPicker, openSubagentTakeover } from "./src/ui/takeover.ts";
import { sanitizeText } from "./src/ui/transcript.ts";
import { spawnCallText, spawnResultText } from "./src/ui/spawn-tool.ts";

interface Config {
  enabled: boolean;
  automaticResultDelivery: boolean;
  btw: boolean;
  editorNavigation: boolean;
  resultCards: boolean;
}
const config: Config = (() => {
  try {
    return {
      enabled: true,
      automaticResultDelivery: true,
      btw: true,
      editorNavigation: true,
      resultCards: true,
      ...JSON.parse(
        fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"),
      ),
    };
  } catch {
    return {
      enabled: true,
      automaticResultDelivery: true,
      btw: true,
      editorNavigation: true,
      resultCards: true,
    };
  }
})();
const OUTPUT_LIMIT = 48 * 1024;
function tail(text: string, max = OUTPUT_LIMIT) {
  const bytes = Buffer.byteLength(text);
  if (bytes <= max) return text;
  let out = text.slice(-max);
  while (Buffer.byteLength(out) > max)
    out = out.slice(Math.ceil(out.length * 0.05));
  return `[truncated; full transcript: session file]\n${out}`;
}
function describe(s: SubagentSnapshot) {
  return `${s.id} [${s.status}] "${s.title}" (${s.meta.modelLabel ?? "inherited model"}, ${formatElapsed(s)}, ${s.cwd})`;
}
function resultText(s: SubagentSnapshot, max = OUTPUT_LIMIT) {
  let out = `Subagent ${s.id} "${s.title}" ${s.status}.`;
  if (s.errorText) out += `\nError: ${s.errorText}`;
  const prefix = `${out}\nSession: ${s.meta.sessionFilePath ?? "?"}\n\n`;
  return (
    prefix +
    tail(
      s.finalText || "(no output)",
      Math.max(1024, max - Buffer.byteLength(prefix)),
    )
  );
}
function resultBatch(snaps: SubagentSnapshot[]) {
  const separator = "\n\n---\n\n";
  const share = Math.max(
    1024,
    Math.floor(
      (OUTPUT_LIMIT - separator.length * Math.max(0, snaps.length - 1)) /
        Math.max(1, snaps.length),
    ),
  );
  return tail(
    snaps.map((s) => resultText(s, share)).join(separator),
    OUTPUT_LIMIT,
  );
}
function spawnResult(s: SubagentSnapshot) {
  return `Started ${s.id} "${s.title}" in ${s.cwd}.`;
}
function resultDetails(s: SubagentSnapshot) {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    summary: oneLineSummary(s.errorText || s.finalText),
    modelLabel: s.meta?.modelLabel,
    reasoningEffort: s.meta?.reasoningEffort,
    turns: s.turns,
    toolUseCount: s.toolUseCount,
    compactionCount: s.compactionCount,
    tokens: s.usage?.tokens,
    contextWindow: s.usage?.contextWindow ?? s.meta?.contextWindow,
    elapsedMs: Math.max(0, (s.settledAt ?? Date.now()) - s.createdAt),
  };
}
export function registerSubagentExtension(
  pi: ExtensionAPI,
  options: { getInheritedActiveTools?: () => string[] | undefined } = {},
) {
  if (!config.enabled) return;
  let manager: SubagentManager | undefined,
    ctx: ExtensionContext | undefined,
    ui: ExtensionUIContext | undefined,
    unsub: (() => void) | undefined,
    editorNavigation: { dispose(): void } | undefined,
    pendingEditorContext: ExtensionContext | undefined;
  const delivery = createDeferredResultDelivery<SubagentSnapshot>();
  const update = () => {
    if (!ui || !manager) return;
    const all = manager.list();
    const running = all.filter((x) => x.status === "running").length;
    ui.setStatus(
      "subagents",
      all.length ? `subagents ${running}/${all.length}` : undefined,
    );
  };
  const deliver = (s: SubagentSnapshot, max = OUTPUT_LIMIT) =>
    pi.sendMessage(
      {
        customType: "subagent-result",
        content: resultText(s, max),
        display: true,
        details: resultDetails(s),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  const flush = () => {
    const ready = delivery.drain();
    const share = Math.max(
      1024,
      Math.floor(OUTPUT_LIMIT / Math.max(1, ready.length)),
    );
    for (const s of ready) deliver(s, share);
  };
  const getManager = () => {
    if (!manager) {
      manager = createSubagentManager();
      manager.setOnSettled((s) => {
        if (!ctx) return;
        if (s.origin === "btw") {
          pi.appendEntry("btw-result", {
            id: s.id,
            title: s.title,
            status: s.status,
            prompt: s.prompt,
            answer: tail(s.finalText),
            sessionFilePath: s.meta.sessionFilePath,
          });
          ui?.notify(
            `by the way “${s.title}” ${s.status === "done" ? "answered" : "failed"}`,
            s.status === "done" ? "info" : "error",
          );
          return;
        }
        if (config.automaticResultDelivery) {
          delivery.defer(s);
          if (ctx.isIdle()) flush();
        }
      });
      unsub = manager.view.subscribe(update);
      update();
    }
    return manager;
  };
  pi.on("session_start", (_e, c) => {
    ctx = c;
    if (c.hasUI) ui = c.ui;
    editorNavigation?.dispose();
    editorNavigation = undefined;
    pendingEditorContext =
      c.mode === "tui" && config.editorNavigation ? c : undefined;
  });
  // Resource discovery runs after every session_start handler has settled and
  // before initialization returns. Installing here makes us wrap whichever
  // editor factory won startup (notably Pizza), independent of extension order.
  pi.on("resources_discover", (_e, c) => {
    const pending = pendingEditorContext;
    if (!pending || ctx !== pending || c.mode !== "tui") return;
    pendingEditorContext = undefined;
    const m = getManager();
    editorNavigation = installSubagentEditorNavigation(c, m.view, {
      onOpen: (snapshot) =>
        openSubagentTakeover(c as ExtensionCommandContext, m.view, snapshot.id),
    });
  });
  pi.on("agent_settled", flush);
  pi.on("session_shutdown", async () => {
    pendingEditorContext = undefined;
    ctx = undefined;
    delivery.clear();
    editorNavigation?.dispose();
    editorNavigation = undefined;
    unsub?.();
    unsub = undefined;
    ui?.setStatus("subagents", undefined);
    ui = undefined;
    const closing = manager;
    manager = undefined;
    await closing?.disposeAll();
  });
  const task = async (
    params: {
      prompt: string;
      name: string;
      working_dir?: string;
      model?: string;
      reasoning_effort?: (typeof REASONING_EFFORTS)[number];
    },
    c: ExtensionContext,
    origin: "model" | "btw" = "model",
  ): Promise<SpawnTask> => {
    const resolved = await resolveChildCwd(
      params.working_dir,
      c.cwd,
      c.isProjectTrusted(),
    );
    return {
      prompt: params.prompt,
      title:
        sanitizeText(params.name).replace(/\s+/g, " ").trim().slice(0, 80) ||
        "subagent",
      cwd: resolved.cwd,
      model: params.model,
      reasoningEffort: params.reasoning_effort,
      origin,
      parent: {
        parentCwd: c.cwd,
        projectTrusted: resolved.projectTrusted,
        inheritedModel: c.model
          ? { provider: c.model.provider, id: c.model.id }
          : undefined,
        inheritedThinkingLevel: pi.getThinkingLevel(),
        modelRegistry: c.modelRegistry,
        activeTools: options.getInheritedActiveTools?.() ?? pi.getActiveTools(),
      },
    };
  };
  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description: `Start a separate persisted Pi agent session in the background. At most ${MAX_RUNNING} run concurrently.`,
    promptSnippet: "Delegate an independent task to a background Pi subagent.",
    promptGuidelines: [
      "Use subagent_wait when its result is required before continuing; do not poll.",
      "Use subagent_send to continue an existing subagent session instead of spawning a new one.",
      "Children cannot spawn subagents or ask the user questions.",
    ],
    parameters: Type.Object({
      prompt: Type.String(),
      name: Type.String(),
      working_dir: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      reasoning_effort: Type.Optional(StringEnum(REASONING_EFFORTS)),
    }),
    async execute(_id, p, signal, _u, c) {
      if (signal?.aborted) throw new Error("Spawn aborted");
      const s = await getManager().spawn(await task(p, c), signal);
      return {
        content: [{ type: "text", text: spawnResult(s) }],
        details: {
          id: s.id,
          status: s.status,
          sessionFilePath: s.meta.sessionFilePath,
        },
      };
    },
    renderCall(args, theme) {
      return new Text(spawnCallText(args, theme), 0, 0);
    },
    renderResult(result, _options, theme) {
      return new Text(spawnResultText(result, theme), 0, 0);
    },
  });
  pi.registerTool({
    name: "subagent_send",
    label: "Message Subagent",
    description:
      "Send a message to an existing model-origin subagent. A settled subagent resumes its persisted session; a running subagent receives steering input.",
    promptSnippet: "Continue or steer an existing subagent session.",
    parameters: Type.Object({
      id: Type.String(),
      message: Type.String(),
    }),
    async execute(_toolCallId, p) {
      const m = getManager();
      const before = m.get(p.id);
      if (!before || before.origin !== "model")
        throw new Error(`Unknown subagent "${p.id}"`);
      const message = p.message.trim();
      if (!message) throw new Error("Message must not be empty");
      delivery.consume([p.id]);
      await m.send(p.id, message);
      const after = m.get(p.id)!;
      return {
        content: [
          {
            type: "text",
            text: `${before.status === "running" ? "Sent steering input to" : "Resumed"} ${after.id} "${after.title}".`,
          },
        ],
        details: { id: after.id, status: after.status },
      };
    },
  });
  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description:
      "Wait without polling for all specified subagents to settle. Aborting the wait does not cancel them.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1 }),
    }),
    async execute(_toolCallId, p, signal, onUpdate) {
      const m = getManager();
      const ids = [...new Set(p.ids)];
      const emitUpdate = onUpdate
        ? (update: WaitToolResult) => onUpdate(update)
        : undefined;
      const snaps = await waitWithLiveUpdates(m, ids, signal, emitUpdate);
      delivery.consume(ids);
      return {
        content: [{ type: "text", text: resultBatch(snaps) }],
        details: waitDetailsFromSnapshots(snaps, true),
      };
    },
    renderCall(args, theme) {
      return new Text(waitCallText(args.ids, theme), 0, 0);
    },
    renderResult(result, options, theme) {
      return new Text(waitResultText(result, options, theme), 0, 0);
    },
  });
  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description:
      "Interrupt running subagents and preserve partial output and persisted sessions.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1 }),
    }),
    async execute(_id, p, signal) {
      const ids = [...new Set(p.ids)];
      const r = await getManager().cancel(ids, signal);
      delivery.consume(ids);
      return {
        content: [
          {
            type: "text",
            text: r
              .map(
                (x) =>
                  `${x.id} [${x.status}] ${x.cancelled ? "cancelled" : "already settled"}`,
              )
              .join("\n"),
          },
        ],
        details: { results: r },
      };
    },
  });
  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description:
      "Nonblocking status and latest bounded output preview for one model-origin subagent.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, p) {
      const s = getManager().get(p.id);
      if (!s || s.origin !== "model")
        throw new Error(`Unknown subagent "${p.id}"`);
      if (s.status !== "running") delivery.consume([s.id]);
      return {
        content: [
          {
            type: "text",
            text: `${describe(s)}\nSession: ${s.meta.sessionFilePath ?? "?"}\n\n${tail(latestText(s) || "(no output)", 16 * 1024)}`,
          },
        ],
        details: { id: s.id, status: s.status, turns: s.turns },
      };
    },
  });
  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: "List model-spawned subagents and their current states.",
    parameters: Type.Object({}),
    async execute() {
      const all = getManager()
        .list()
        .filter((s) => s.origin === "model");
      return {
        content: [
          {
            type: "text",
            text: all.length ? all.map(describe).join("\n") : "No subagents.",
          },
        ],
        details: {
          agents: all.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
          })),
        },
      };
    },
  });
  pi.registerEntryRenderer<{
    id: string;
    title: string;
    status: string;
    prompt: string;
    answer: string;
    sessionFilePath?: string;
  }>("btw-result", (entry, { expanded }, theme) => {
    const data = entry.data;
    if (!data) return undefined;
    const ok = data.status === "done";
    const header = `${theme.fg(ok ? "success" : "error", ok ? "■" : "x")} ${theme.fg("accent", theme.bold(`by the way · ${sanitizeText(data.title)}`))}${theme.fg("muted", ` · ${data.status}`)}`;
    const answer = sanitizeText(data.answer || "(no answer)");
    const lines = answer.split("\n");
    const shown = expanded ? lines : lines.slice(0, 12);
    let text = `${header}\n${shown.join("\n")}`;
    if (!expanded && shown.length < lines.length)
      text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
    if (expanded && data.sessionFilePath)
      text += `\n${theme.fg("dim", `session: ${data.sessionFilePath}`)}`;
    return new Text(text, 0, 0);
  });

  if (config.resultCards)
    pi.registerMessageRenderer(
      "subagent-result",
      (message, { expanded }, theme) =>
        new Text(
          resultCardText(
            message.details ?? {},
            message.content,
            expanded,
            theme,
          ),
          0,
          0,
        ),
    );

  pi.registerCommand("subagents", {
    description: "List, inspect, and take over subagents",
    handler: async (_a, c) => {
      if (c.mode !== "tui") {
        c.ui.notify("/subagents requires TUI mode", "warning");
        return;
      }
      await openSubagentPicker(c, getManager().view);
    },
  });
  if (config.btw)
    pi.registerCommand("btw", {
      description: "Ask a side question in a child session",
      handler: async (args, c) => {
        const prompt = args.trim();
        if (!prompt) {
          c.ui.notify("Usage: /btw <question>", "warning");
          return;
        }
        const title = prompt.split(/\s+/).slice(0, 7).join(" ").slice(0, 60);
        const s = await getManager().spawn(
          await task({ prompt, name: title }, c, "btw"),
        );
        if (c.mode === "tui")
          await openSubagentTakeover(c, getManager().view, s.id, {
            badge: "by the way",
          });
      },
    });
}

export default registerSubagentExtension;
