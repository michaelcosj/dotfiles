import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCavemanExtension } from "./caveman.js";
import { registerDdgsExtension } from "./ddgs.js";
import { registerRtkExtension } from "./rtk.js";
import { registerTodoExtension } from "./todo.js";
import { registerTpsExtension } from "./tps.js";

export {
  registerCavemanExtension,
  registerDdgsExtension,
  registerRtkExtension,
  registerTodoExtension,
  registerTpsExtension,
};

export default function (pi: ExtensionAPI) {
  registerCavemanExtension(pi);
  registerDdgsExtension(pi);
  registerRtkExtension(pi);
  registerTodoExtension(pi);
  registerTpsExtension(pi);
}
