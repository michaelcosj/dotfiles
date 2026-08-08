import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundTerminalCommands } from "./commands.js";
import { registerBackgroundTerminalLifecycle } from "./lifecycle.js";
import { registerBackgroundTerminalMessageRenderers } from "./message-renderers.js";
import {
  createBackgroundTerminalRuntime,
  type BackgroundTerminalRuntimeOptions,
} from "./runtime.js";
import { registerBackgroundTerminalTools } from "./tools.js";

export type { BackgroundTerminalRuntimeOptions } from "./runtime.js";

/** Compose the bounded process feature around its session-scoped runtime. */
export function registerBackgroundTerminalsExtension(
  pi: ExtensionAPI,
  options: BackgroundTerminalRuntimeOptions = {},
) {
  const runtime = createBackgroundTerminalRuntime(pi, options);
  registerBackgroundTerminalLifecycle(pi, runtime);
  registerBackgroundTerminalTools(pi, runtime);
  registerBackgroundTerminalMessageRenderers(pi);
  registerBackgroundTerminalCommands(pi, runtime);
}

export default registerBackgroundTerminalsExtension;
