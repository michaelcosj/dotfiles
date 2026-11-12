import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cachedReference, errorText, parseConfig, referencePrompt, resolveReference, type Reference, type ResolvedReference } from "./references.js";

const IS_CHILD = !!process.env.PI_BRIDGE_PARENT;

/** Maps over items with at most four at once, keeping order. */
async function limited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

export default function references(pi: ExtensionAPI) {
  let resolved: ResolvedReference[] = [];
  let configError: string | undefined;
  let loadedCwd: string | undefined;
  // Bumped on each load, so a late refresh from an older load is dropped.
  let generation = 0;
  let loading: Promise<void> | undefined;
  let refreshing: Promise<void> | undefined;

  /**
   * Reads the config and uses cached checkouts at once. Git references then
   * refresh in the background (a child agent only clones missing ones).
   * refresh: false skips that step.
   */
  function load(ctx: ExtensionContext, refresh = !IS_CHILD) {
    const gen = ++generation;
    loadedCwd = ctx.cwd;
    refreshing = undefined;
    loading = (async () => {
      resolved = [];
      configError = undefined;
      const configPath = path.join(ctx.cwd, ".pi", "references.json");
      const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "references");
      let references: Reference[];
      try {
        const text = await fs.readFile(configPath, "utf8");
        if (!ctx.isProjectTrusted()) throw new Error("Project references require project trust. Use /trust, then /reload.");
        references = parseConfig(JSON.parse(text), configPath);
      } catch (error) {
        if (gen !== generation || (error as NodeJS.ErrnoException).code === "ENOENT") return;
        configError = `${configPath}: ${errorText(error)}`;
        if (ctx.hasUI) ctx.ui.notify(configError, "warning");
        return;
      }
      const cached = await limited(references, (r) => cachedReference(r, cache));
      if (gen !== generation) return;
      resolved = cached;
      const todo = references.filter((r, i) => r.repository !== undefined && (refresh || cached[i].status === "unavailable"));
      if (!todo.length) return;
      refreshing = limited(todo, (r) => resolveReference(r, cache)).then((fresh) => {
        if (gen !== generation) return;
        resolved = resolved.map((r) => fresh.find((f) => f.name === r.name) ?? r);
        const failures = resolved.filter((reference) => reference.error);
        if (ctx.hasUI && failures.length) {
          ctx.ui.notify(`References: ${failures.map((r) => `${r.name} (${r.status})`).join(", ")}. Use /refs for details.`, "warning");
        }
      });
    })();
    return loading;
  }

  pi.on("session_start", (_event, ctx) => { void load(ctx); });

  pi.on("before_agent_start", async (event, ctx) => {
    if (loadedCwd !== ctx.cwd) load(ctx);
    await loading;
    // Wait for the network only when a reference has nothing usable yet.
    if (refreshing && resolved.some((r) => r.status === "unavailable" && r.source === "git")) await refreshing;
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
        await load(ctx, true);
        await refreshing;
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
