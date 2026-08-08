import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SubagentRuntime } from "./runtime.js";
import { renderBtwEntry } from "./presenters.js";
import { resultCardText } from "./ui/result-card.js";
import { sanitizeText } from "./ui/transcript.js";

interface BtwEntry {
  id: string;
  title: string;
  status: string;
  prompt: string;
  answer: string;
  sessionFilePath?: string;
}

export function registerSubagentMessageRenderers(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
) {
  pi.registerEntryRenderer<BtwEntry>("btw-result", (entry, { expanded }, theme) => {
    const data = entry.data;
    if (!data) return undefined;
    return new Text(renderBtwEntry(data, expanded, theme), 0, 0);
  });

  if (!runtime.config.resultCards) return;
  pi.registerMessageRenderer(
    "subagent-result",
    (message, { expanded }, theme) =>
      new Text(
        resultCardText(
          message.details ?? {},
          typeof message.content === "string"
            ? sanitizeText(message.content)
            : message.content,
          expanded,
          theme,
        ),
        0,
        0,
      ),
  );
}
