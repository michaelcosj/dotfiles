import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundTerminalRuntime } from "./runtime.js";
import { describeTerminal } from "./prompt.js";
import { openTerminalPicker } from "./ui/ps.js";

export function registerBackgroundTerminalCommands(
  pi: ExtensionAPI,
  runtime: BackgroundTerminalRuntime,
) {
  pi.registerCommand("ps", {
    description: "List and inspect background terminals",
    handler: async (_args, context) => {
      const query = runtime.getQuery();
      if (context.mode !== "tui") {
        if (context.hasUI) {
          const terminals = query.list();
          context.ui.notify(
            terminals.length === 0
              ? "No background terminals."
              : terminals.map((snapshot) => describeTerminal(snapshot)).join("\n"),
            "info",
          );
        }
        return;
      }
      if (query.size() === 0) {
        context.ui.notify(
          "No background terminals yet. The agent starts them with bg_start.",
          "info",
        );
        return;
      }
      await openTerminalPicker(
        context,
        query,
        runtime.getCommands(),
      );
    },
  });
}
