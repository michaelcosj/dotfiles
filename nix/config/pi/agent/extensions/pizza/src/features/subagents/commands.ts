import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentRuntime } from "./runtime.js";
import { openSubagentPicker, openSubagentTakeover } from "./ui/takeover.js";

export function registerSubagentCommands(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
) {
  pi.registerCommand("subagents", {
    description: "List, inspect, and take over subagents",
    handler: async (args, context) => {
      if (args.trim() === "reconcile") {
        const count = await runtime.getManager().reconcile();
        context.ui.notify(
          count ? `Reconciled ${count} stale subagent${count === 1 ? "" : "s"}` : "No stale subagents found",
          "info",
        );
        return;
      }
      if (context.mode !== "tui") {
        context.ui.notify("/subagents requires TUI mode", "warning");
        return;
      }
      const query = runtime.getQuery();
      const commands = runtime.getCommands();
      const snapshots = query.list();
      const native = snapshots.filter((snapshot) => snapshot.meta.herdrTabId);
      if (native.length) {
        const labels = native.map(
          (snapshot) => `${snapshot.id} · ${snapshot.status} · ${snapshot.title}`,
        );
        const picked = await context.ui.select("Open subagent", labels);
        const index = picked ? labels.indexOf(picked) : -1;
        if (index >= 0) await commands.requestOpen(native[index]!.id);
        return;
      }
      await openSubagentPicker(context, query, commands);
    },
  });

  if (!runtime.config.btw) return;
  pi.registerCommand("btw", {
    description: "Ask a side question in a child session",
    handler: async (args, context) => {
      const prompt = args.trim();
      if (!prompt) {
        context.ui.notify("Usage: /btw <question>", "warning");
        return;
      }
      const title = prompt.split(/\s+/).slice(0, 7).join(" ").slice(0, 60);
      const snapshot = await runtime.getManager().spawn(
        await runtime.createTask(
          { prompt, name: title },
          context,
          "btw",
        ),
      );
      if (context.mode === "tui") {
        const commands = runtime.getCommands();
        if (await commands.requestOpen(snapshot.id)) return;
        await openSubagentTakeover(
          context,
          runtime.getQuery(),
          commands,
          snapshot.id,
          { badge: "by the way" },
        );
      }
    },
  });
}
