import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundTerminalRuntime } from "./runtime.js";

export function registerBackgroundTerminalLifecycle(
  pi: ExtensionAPI,
  runtime: BackgroundTerminalRuntime,
) {
  pi.on("session_start", (_event, context) => {
    runtime.setSessionContext(context);
  });

  pi.on("agent_settled", () => runtime.flush());

  pi.on("session_shutdown", async () => {
    await runtime.shutdown();
  });
}
