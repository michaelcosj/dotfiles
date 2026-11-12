/** Session titles: generated after the first user message, or on demand with /generate-title.
 *
 * Model: generate-title/config.json ({ model: "provider/id" | null, thinking, auto }), overridden by
 * PI_TITLE_MODEL="provider/id[:thinking]", or once by `/generate-title provider/id[:thinking]`. If the
 * model is missing or has no auth, the session's active model is used instead.
 *
 * In a Rex pane, the pane label follows the session name as `π - <title>` (Rex allows 128 characters).
 * The old label comes back when Pi quits. Child agents keep their `pi-agent:` labels and are never titled.
 * Generation runs in the background with a timeout and never delays the turn.
 */
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uuidv7, type Api, type Model } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanTitle, conversationFromBranch, parseModelSpec, resolveConfig, REX_LABEL_PREFIX, rexLabel, splitModel, titlePrompt, type Thinking } from "./title.ts";

const TIMEOUT_MS = 30_000;
const REX_TIMEOUT_MS = 5_000;
const CONFIG_PATH = join(getAgentDir(), "extensions", "generate-title", "config.json");

function loadConfig() {
  let raw: string | undefined;
  try { raw = readFileSync(CONFIG_PATH, "utf8"); } catch {}
  return resolveConfig(raw, process.env.PI_TITLE_MODEL);
}

const rexBin = () => (process.env.REX_BIN_DIR ? join(process.env.REX_BIN_DIR, "rex") : "rex");

function rex(args: string[]): Promise<string> {
  const bin = rexBin();
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: REX_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
    child.unref();
  });
}

export default function generateTitle(pi: ExtensionAPI) {
  const isChild = !!process.env.PI_BRIDGE_PARENT;
  const block = !isChild ? process.env.REX_BLOCK : undefined;

  let session: AbortController | undefined;
  let attempted = false;
  // Rex pane label: what it was before we touched it (null: Rex's default), and what we last set.
  let originalLabel: string | null | undefined;
  let lastLabel: string | undefined;
  let rexQueue: Promise<unknown> = Promise.resolve();

  function syncPane(name: string | undefined) {
    if (!block || !name) return;
    const label = rexLabel(name);
    if (label === lastLabel) return;
    lastLabel = label;
    rexQueue = rexQueue.then(async () => {
      if (originalLabel === undefined) {
        try {
          const info = JSON.parse(await rex(["block", "inspect", block, "--json"]));
          const current = info?.block?.label;
          originalLabel = typeof current === "string" && !current.startsWith(REX_LABEL_PREFIX) ? current : null;
        } catch {
          originalLabel = null;
        }
      }
      await rex(["block", "rename", block, label]);
    }).catch(() => {});
  }

  function restorePane() {
    if (!block || lastLabel === undefined) return;
    lastLabel = undefined;
    // On quit, Pi exits before queued promises run. Start a detached process now; it outlives Pi.
    try {
      const child = spawn(rexBin(), ["block", "rename", block, originalLabel ?? ""], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    } catch {}
  }

  function pickModel(ctx: ExtensionContext, spec: string | undefined): Model<Api> | undefined {
    const parts = spec ? splitModel(spec) : undefined;
    const found = parts && ctx.modelRegistry.find(parts.provider, parts.id);
    if (found && ctx.modelRegistry.hasConfiguredAuth(found)) return found;
    return ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model) ? ctx.model : undefined;
  }

  async function generate(ctx: ExtensionContext, conversation: string, model: Model<Api>, thinking: Thinking, signal: AbortSignal) {
    const stream = ctx.modelRegistry.streamSimple(
      model,
      { messages: [{ role: "user", content: [{ type: "text", text: titlePrompt(conversation) }], timestamp: Date.now() }] },
      {
        ...(thinking !== "off" && model.reasoning ? { reasoning: thinking } : {}),
        cacheRetention: "none",
        sessionId: uuidv7(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      },
    );
    const response = await stream.result();
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(response.errorMessage || response.stopReason);
    }
    const title = cleanTitle(
      response.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" "),
    );
    if (!title) throw new Error("model returned an empty title");
    return title;
  }

  pi.on("session_start", (_event, ctx) => {
    session?.abort();
    session = new AbortController();
    attempted = false;
    syncPane(ctx.mode === "tui" ? pi.getSessionName() : undefined);
  });

  pi.on("session_shutdown", (event) => {
    session?.abort();
    session = undefined;
    if (event.reason === "quit") restorePane();
  });

  // Covers /name, our own titles, and names set by other extensions.
  pi.on("session_info_changed", (event, ctx) => {
    if (ctx.mode === "tui") syncPane(event.name);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType !== "user" || attempted || isChild || ctx.mode !== "tui") return;
    if (pi.getSessionName()) return;
    const config = loadConfig();
    if (!config.auto) return;
    attempted = true;

    const prompt = event.prompt.trim();
    if (!prompt) return;
    const earlier = conversationFromBranch(ctx.sessionManager.getBranch());
    const conversation = earlier.endsWith(`user: ${prompt}`) ? earlier : [earlier, `user: ${prompt}`].filter(Boolean).join("\n\n");
    const model = pickModel(ctx, config.model);
    const signal = session?.signal;
    if (!model || !signal) return;

    // Do not await: the turn starts now and the title arrives when it is ready.
    void generate(ctx, conversation, model, config.thinking, signal).then(
      (title) => {
        // The user may have named the session while we waited.
        if (!signal.aborted && !pi.getSessionName()) pi.setSessionName(title);
      },
      () => {},
    );
  });

  pi.registerCommand("generate-title", {
    description: "Generate a session title (optional: provider/model[:thinking])",
    handler: async (args, ctx) => {
      const conversation = conversationFromBranch(ctx.sessionManager.getBranch());
      if (!conversation) {
        ctx.ui.notify("No conversation available to title", "warning");
        return;
      }
      const config = loadConfig();
      const override = parseModelSpec(args ?? "");
      const spec = override.model ?? config.model;
      const thinking = override.thinking ?? config.thinking;
      const model = pickModel(ctx, spec);
      if (!model) {
        ctx.ui.notify("No AI model with authentication is available", "error");
        return;
      }
      const label = `${model.provider}/${model.id}`;
      const fallback = spec && spec !== label ? ` (${spec} unavailable)` : "";
      ctx.ui.notify(`Generating title with ${label}${fallback}…`, "info");
      try {
        const title = await generate(ctx, conversation, model, thinking, session?.signal ?? new AbortController().signal);
        pi.setSessionName(title);
        syncPane(title);
        ctx.ui.notify(`Session titled: ${title}`, "info");
      } catch (error) {
        const message = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : String(error);
        ctx.ui.notify(`Could not generate title: ${message}`, "error");
      }
    },
  });
}
