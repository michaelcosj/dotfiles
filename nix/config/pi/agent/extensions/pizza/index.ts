import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCavemanExtension } from "./caveman.js";
import { registerDdgsExtension } from "./ddgs.js";
import { registerPresetControlExtension } from "./preset-control.js";
import { registerQuestionnaireTool } from "./questionnaire.js";
import { registerRtkExtension } from "./rtk.js";
import { registerTodoExtension } from "./todo.js";
import { registerTpsExtension } from "./tps.js";
import { registerVccCompactExtension } from "./vcc-compact.js";
import { registerVccRecallExtension } from "./vcc-recall.js";

export {
  registerCavemanExtension,
  registerDdgsExtension,
  registerPresetControlExtension,
  registerQuestionnaireTool,
  registerRtkExtension,
  registerTodoExtension,
  registerTpsExtension,
  registerVccCompactExtension,
  registerVccRecallExtension,
};

export default function (pi: ExtensionAPI) {
  registerCavemanExtension(pi);
  registerDdgsExtension(pi);
  registerRtkExtension(pi);
  registerTodoExtension(pi);
  registerTpsExtension(pi);
  registerQuestionnaireTool(pi);
  registerPresetControlExtension(pi);
  registerVccCompactExtension(pi);
  registerVccRecallExtension(pi);
}
