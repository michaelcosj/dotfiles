import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundTerminalLifecycle } from "../pizza/src/features/background-terminals/lifecycle.js";
import { createBackgroundTerminalRuntime } from "../pizza/src/features/background-terminals/runtime.js";
import { registerBackgroundTerminalTools } from "../pizza/src/features/background-terminals/tools.js";

/**
 * Child-only Pizza profile.
 *
 * Native Herdr subagents receive PIZZA_SUBAGENT=1. Normal Pi sessions ignore
 * this extension, while the full Pizza extension ignores child sessions.
 * Keep this deliberately small: default Pi UI plus background-terminal tools.
 */
export default function registerPizzaMinimal(pi: ExtensionAPI) {
  if (process.env.PIZZA_SUBAGENT !== "1") return;
  const runtime = createBackgroundTerminalRuntime(pi);
  registerBackgroundTerminalLifecycle(pi, runtime);
  registerBackgroundTerminalTools(pi, runtime);
}
