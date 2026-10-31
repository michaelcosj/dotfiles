import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { errorText, parseConfig, referencePrompt, resolveReference, type ResolvedReference } from "./references.js";

export default function references(pi: ExtensionAPI) {
  let resolved: ResolvedReference[] = [];
  let configError: string | undefined;
  let loadedCwd: string | undefined;

  async function load(ctx: ExtensionContext) {
    resolved = [];
    configError = undefined;
    loadedCwd = ctx.cwd;
    const configPath = path.join(ctx.cwd, ".pi", "references.json");
    try {
      const text = await fs.readFile(configPath, "utf8");
      if (!ctx.isProjectTrusted()) throw new Error("Project references require project trust. Use /trust, then /reload.");
      const references = parseConfig(JSON.parse(text), configPath);
      const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "references");
      // Limit network work, preserving config order in the advertised list.
      const results: ResolvedReference[] = new Array(references.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, references.length) }, async () => {
        while (next < references.length) {
          const index = next++;
          results[index] = await resolveReference(references[index], cache);
        }
      }));
      resolved = results;
      const failures = resolved.filter((reference) => reference.error);
      if (ctx.hasUI && failures.length) {
        ctx.ui.notify(`References: ${failures.map((r) => `${r.name} (${r.status})`).join(", ")}. Use /refs for details.`, "warning");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      configError = `${configPath}: ${errorText(error)}`;
      if (ctx.hasUI) ctx.ui.notify(configError, "warning");
    }
  }

  pi.on("session_start", async (_event, ctx) => { await load(ctx); });

  pi.on("before_agent_start", async (event, ctx) => {
    if (loadedCwd !== ctx.cwd) await load(ctx);
    const section = ctx.isProjectTrusted() ? referencePrompt(resolved) : "";
    if (section || configError) {
      event.systemPromptOptions.sections.project_references = section || `Project references unavailable: ${JSON.stringify(configError)}`;
    } else {
      delete event.systemPromptOptions.sections.project_references;
    }
  });

  pi.registerCommand("refs", {
    description: "Show project references; /refs refresh reloads config and updates Git checkouts",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action && action !== "refresh") {
        ctx.ui.notify("Usage: /refs [refresh]", "warning");
        return;
      }
      if (action === "refresh") {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Wait for the current turn to finish before refreshing references.", "warning");
          return;
        }
        await load(ctx);
      }
      const text = configError ?? (resolved.length ? resolved.map((r) => [
        `${r.name}: ${r.status}${r.revision ? ` (${r.revision.slice(0, 12)})` : ""}`,
        `Path: ${r.path}`,
        ...(r.description ? [r.description] : []),
        ...(r.error ? [`Warning: ${r.error}`] : []),
      ].join("\n")).join("\n\n") : "No project references. Configure .pi/references.json.");
      ctx.ui.notify(text, configError ? "warning" : "info");
    },
  });
}
