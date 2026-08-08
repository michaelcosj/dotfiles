import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentCommands } from "./commands.js";
import { registerSubagentLifecycle } from "./lifecycle.js";
import { registerSubagentMessageRenderers } from "./message-renderers.js";
import {
  createSubagentRuntime,
  loadSubagentConfig,
  type SubagentRegistrationOptions,
} from "./runtime.js";
import { registerSubagentTools } from "./tools.js";

export type { SubagentRegistrationOptions } from "./runtime.js";

/** Compose the bounded subagent feature without exposing its lifecycle state. */
export function registerSubagentExtension(
  pi: ExtensionAPI,
  options: SubagentRegistrationOptions = {},
) {
  const config = loadSubagentConfig();
  if (!config.enabled) return;

  const runtime = createSubagentRuntime(pi, options, config);
  registerSubagentLifecycle(pi, runtime);
  registerSubagentTools(pi, runtime);
  registerSubagentMessageRenderers(pi, runtime);
  registerSubagentCommands(pi, runtime);
}

export default registerSubagentExtension;
