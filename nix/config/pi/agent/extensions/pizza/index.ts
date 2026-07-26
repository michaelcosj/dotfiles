import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundTerminalsExtension } from "./background-terminals/index.js";
import { registerCodexUsageExtension } from "./codex-usage.js";
import { registerCopyAllExtension } from "./copy-all/index.js";
import { registerFileSearchExtension } from "./file-search/index.js";
import { registerFusionModeExtension } from "./fusion-mode.js";
import { registerPizzaUiExtension } from "./pizza-ui.js";
import { registerQuestionnaireTool } from "./questionnaire.js";
import { registerSubagentExtension } from "./subagent/index.js";
import { registerTpsExtension } from "./tps.js";
import { registerClaudeStyleToolRenderers } from "./tool-renderers.js";

export {
  registerBackgroundTerminalsExtension,
  registerCodexUsageExtension,
  registerCopyAllExtension,
  registerFileSearchExtension,
  registerFusionModeExtension,
  registerPizzaUiExtension,
  registerQuestionnaireTool,
  registerSubagentExtension,
  registerTpsExtension,
  registerClaudeStyleToolRenderers,
};

export default function (pi: ExtensionAPI) {
  const fusion = registerFusionModeExtension(pi);
  registerBackgroundTerminalsExtension(pi);
  registerSubagentExtension(pi, {
    getInheritedActiveTools: () => fusion.getSidekickTools(),
  });
  registerCodexUsageExtension(pi);
  registerCopyAllExtension(pi);
  registerFileSearchExtension(pi);
  registerPizzaUiExtension(pi);
  registerClaudeStyleToolRenderers(pi);
  registerTpsExtension(pi);
  registerQuestionnaireTool(pi);
}
