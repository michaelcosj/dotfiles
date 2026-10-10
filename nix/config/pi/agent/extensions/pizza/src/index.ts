import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundTerminalsExtension } from "./features/background-terminals/register.js";
import { registerCodexUsageExtension } from "./features/codex-usage/register.js";
import { registerCopyAllExtension } from "./features/copy-all/register.js";
import { registerPizzaUiExtension } from "./features/pizza-ui/register.js";
import { registerQuestionnaireTool } from "./features/questionnaire/register.js";
import { registerSubagentExtension } from "./features/subagents/register.js";
import { registerTpsExtension } from "./features/tps/register.js";

export {
  registerBackgroundTerminalsExtension,
  registerCodexUsageExtension,
  registerCopyAllExtension,
  registerPizzaUiExtension,
  registerQuestionnaireTool,
  registerSubagentExtension,
  registerTpsExtension,
};

/** The sole Pizza composition root. Feature internals do not compose siblings. */
export default function registerPizza(pi: ExtensionAPI) {
  // Herdr children use the child-only pizza-minimal profile instead.
  if (process.env.PIZZA_SUBAGENT === "1") return;
  registerBackgroundTerminalsExtension(pi);
  registerSubagentExtension(pi);
  registerCodexUsageExtension(pi);
  registerCopyAllExtension(pi);
  registerPizzaUiExtension(pi);
  registerTpsExtension(pi);
  registerQuestionnaireTool(pi);
}
