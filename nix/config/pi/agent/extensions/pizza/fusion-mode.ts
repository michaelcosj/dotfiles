import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const FUSION_MODE_STATUS_KEY = "fusion-mode";

const ORCHESTRATOR_TOOLS = new Set([
  "subagent_spawn",
  "subagent_send",
  "subagent_wait",
  "subagent_check",
  "subagent_list",
  "subagent_cancel",
  "questionnaire",
]);

interface FusionModeState {
  enabled: boolean;
  toolsBeforeFusion?: string[];
}

export interface FusionModeController {
  getSidekickTools(): string[] | undefined;
}

export interface FusionModeOptions {
  /** Internal seam for testing skill-load failures and recovery. */
  loadSubagentSkill?: () => Promise<string>;
}

const SUBAGENT_SKILL_PATH = fileURLToPath(
  new URL("../../skills/subagent/SKILL.md", import.meta.url),
);

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export async function loadCanonicalSubagentSkill(): Promise<string> {
  const body = stripFrontmatter(await readFile(SUBAGENT_SKILL_PATH, "utf8")).trim();
  if (!body) throw new Error("canonical subagent skill is empty");

  return `<skill name="subagent" location="${SUBAGENT_SKILL_PATH}">\nReferences are relative to ${dirname(SUBAGENT_SKILL_PATH)}.\n\n${body}\n</skill>`;
}

const FUSION_PROMPT = `[FUSION MODE ACTIVE]
You are the orchestrator. You cannot inspect or modify the project directly. All project work must be delegated to sidekicks (subagents).

Required workflow:
1. Delegate context gathering and investigation to one or more sidekicks. Give each a focused task.
2. Use subagent_wait when their results are required; never poll.
3. Synthesize their findings into an explicit implementation plan before implementation begins.
4. Delegate implementation to fresh sidekicks with precise scope and relevant gathered context.
5. Delegate verification and review to separate sidekicks. Verification must include appropriate tests or checks.
6. If verification finds problems, delegate fixes and repeat independent verification.
7. Report only outcomes supported by sidekick results. Never claim to have read, changed, or verified files yourself.

Do not ask sidekicks to dump files merely to bypass your restrictions. Ask them to investigate, implement, or verify and return concise findings, changed paths, commands run, and results. Children cannot spawn other subagents or ask the user questions.`;

export function registerFusionModeExtension(
  pi: ExtensionAPI,
  { loadSubagentSkill = loadCanonicalSubagentSkill }: FusionModeOptions = {},
): FusionModeController {
  let enabled = false;
  let toolsBeforeFusion: string[] | undefined;
  let subagentSkillWarningShown = false;

  const fusionTools = () =>
    pi.getActiveTools().filter((name) => ORCHESTRATOR_TOOLS.has(name));

  const apply = (ctx: ExtensionContext) => {
    pi.setActiveTools(fusionTools());
    ctx.ui.setStatus(FUSION_MODE_STATUS_KEY, "FUSION");
  };

  const persist = () =>
    pi.appendEntry(FUSION_MODE_STATUS_KEY, {
      enabled,
      toolsBeforeFusion,
    } satisfies FusionModeState);

  const setEnabled = (next: boolean, ctx: ExtensionContext) => {
    if (next === enabled) {
      ctx.ui.notify(`Fusion mode is already ${enabled ? "enabled" : "disabled"}.`, "info");
      return;
    }

    if (next) {
      toolsBeforeFusion = pi.getActiveTools();
      enabled = true;
      apply(ctx);
      ctx.ui.notify("Fusion mode enabled. Main agent is now an orchestrator.", "info");
    } else {
      enabled = false;
      pi.setActiveTools(toolsBeforeFusion ?? pi.getActiveTools());
      toolsBeforeFusion = undefined;
      ctx.ui.setStatus(FUSION_MODE_STATUS_KEY, undefined);
      ctx.ui.notify("Fusion mode disabled. Main-agent tools restored.", "info");
    }
    persist();
  };

  pi.registerCommand("fusion", {
    description: "Control user-only fusion orchestrator mode: toggle, on, off, or status",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "") setEnabled(!enabled, ctx);
      else if (action === "on") setEnabled(true, ctx);
      else if (action === "off") setEnabled(false, ctx);
      else if (action === "status")
        ctx.ui.notify(`Fusion mode is ${enabled ? "enabled" : "disabled"}.`, "info");
      else ctx.ui.notify("Usage: /fusion [on|off|status]", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const entry = ctx.sessionManager
      .getEntries()
      .filter(
        (candidate: { type: string; customType?: string }) =>
          candidate.type === "custom" &&
          candidate.customType === FUSION_MODE_STATUS_KEY,
      )
      .pop() as { data?: FusionModeState } | undefined;
    enabled = entry?.data?.enabled ?? false;
    toolsBeforeFusion = entry?.data?.toolsBeforeFusion;
    if (enabled) apply(ctx);
    else ctx.ui.setStatus(FUSION_MODE_STATUS_KEY, undefined);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!enabled) return;

    let subagentSkill = "";
    try {
      subagentSkill = await loadSubagentSkill();
      subagentSkillWarningShown = false;
    } catch (error) {
      if (!subagentSkillWarningShown) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Fusion mode could not load the subagent skill; continuing without it: ${detail}`, "warning");
        subagentSkillWarningShown = true;
      }
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${FUSION_PROMPT}${subagentSkill ? `\n\n${subagentSkill}` : ""}`,
    };
  });

  pi.on("tool_call", (event) => {
    if (!enabled || ORCHESTRATOR_TOOLS.has(event.toolName)) return;
    return {
      block: true,
      reason: `Fusion mode blocks "${event.toolName}" for the main agent. Delegate the work to a sidekick. Only the user can leave fusion mode with /fusion off.`,
    };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(FUSION_MODE_STATUS_KEY, undefined);
  });

  return {
    getSidekickTools: () =>
      enabled && toolsBeforeFusion ? [...toolsBeforeFusion] : undefined,
  };
}

export default registerFusionModeExtension;
