import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentRuntime } from "./runtime.js";
import { openSubagentPicker, openSubagentTakeover } from "./ui/takeover.js";

export function registerSubagentCommands(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
) {
  pi.registerCommand("subagents", {
    description: "List, inspect, and take over subagents",
    handler: async (_args, context) => {
      if (context.mode !== "tui") {
        context.ui.notify("/subagents requires TUI mode", "warning");
        return;
      }
      await openSubagentPicker(
        context,
        runtime.getQuery(),
        runtime.getCommands(),
      );
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
        await openSubagentTakeover(
          context,
          runtime.getQuery(),
          runtime.getCommands(),
          snapshot.id,
          { badge: "by the way" },
        );
      }
    },
  });
}
