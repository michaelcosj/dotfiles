import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_ENABLED = true;

const _stateDir = join(homedir(), ".pi", "agents");
const _statePath = join(_stateDir, "caveman.json");

const CAVEMAN_PROMPT = `
You are in CAVEMAN MODE (full intensity). Rules:

Respond terse like smart caveman. All technical substance stay. Only fluff die.

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure. Document Exemption is NARROW — technical questions stay caveman. Off only: "stop caveman" / "normal mode".

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Example — "Why React component re-render?"
Response: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."

Example — "Explain database connection pooling."
Response: "Pool reuse open DB connections. No new connection per request. Skip handshake overhead."

Auto-Clarity: temporarily drop caveman for security warnings, irreversible confirmations, multi-step sequences where fragments risk misread, or when user explicitly asks for clarity. Resume caveman after the clear part done.

Boundaries: code/commits/PRs — write normal. "stop caveman" or "normal mode" — revert.

ACTIVE EVERY RESPONSE. Document Exemption applies only when producing a deliverable document (README, CHANGELOG, ADR, design doc, email, PR description, content inside Write/Edit tool calls), not when answering technical questions. Technical Q&A, code review, debugging, recommendations, comparisons — stay caveman. Long session — stay caveman. Unsure — stay caveman.
`;

function readEnabledFromFile(path: string): boolean | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const obj = JSON.parse(readFileSync(path, "utf8"));
    if (typeof obj.enabled === "boolean") return obj.enabled;
    return undefined;
  } catch {
    return undefined;
  }
}

function loadEnabled(): boolean {
  const current = readEnabledFromFile(_statePath);
  if (current !== undefined) return current;
  return DEFAULT_ENABLED;
}

function saveEnabled(value: boolean): void {
  try {
    if (!existsSync(_stateDir)) mkdirSync(_stateDir, { recursive: true });
    writeFileSync(_statePath, JSON.stringify({ enabled: value }, null, 2), "utf8");
  } catch (e) {
    console.error("caveman: failed to save setting", e);
  }
}

export function registerCavemanExtension(pi: ExtensionAPI) {
  let enabled = loadEnabled();

  function updateStatus(ctx: {
    hasUI: boolean;
    ui: { setStatus: (key: string, value: string | undefined) => void };
  }) {
    if (ctx.hasUI) ctx.ui.setStatus("caveman", enabled ? "caveman(on)" : undefined);
  }

  pi.registerCommand("caveman", {
    description: "Toggle caveman mode: /caveman on|off|toggle|status",
    handler: async (args, ctx) => {
      const arg = (args || "").toString().trim().toLowerCase();

      if (arg === "on") {
        enabled = true;
        saveEnabled(true);
        updateStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify("Caveman on.", "info");
        return;
      }

      if (arg === "off") {
        enabled = false;
        saveEnabled(false);
        updateStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify("Caveman off.", "info");
        return;
      }

      if (arg === "toggle" || arg === "") {
        enabled = !enabled;
        saveEnabled(enabled);
        updateStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify(enabled ? "Caveman on." : "Caveman off.", "info");
        return;
      }

      if (arg === "status") {
        if (ctx.hasUI) ctx.ui.notify(`Caveman ${enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      if (ctx.hasUI) ctx.ui.notify("Usage: /caveman on|off|toggle|status", "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return undefined;
    return { systemPrompt: (event.systemPrompt || "") + CAVEMAN_PROMPT };
  });

  // Re-sync from disk on session start (handles external edits to settings file)
  pi.on("session_start", async (_event, ctx) => {
    enabled = loadEnabled();
    updateStatus(ctx);
    if (ctx.hasUI && enabled) ctx.ui.notify("Caveman mode active.", "info");
  });
}
