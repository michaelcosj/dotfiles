import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "assistant";
}

export function registerTpsExtension(pi: ExtensionAPI) {
  let agentStartMs: number | null = null;

  pi.on("agent_start", () => {
    agentStartMs = Date.now();
  });

  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (agentStartMs === null) return;

    const elapsedMs = Date.now() - agentStartMs;
    agentStartMs = null;
    if (elapsedMs <= 0) return;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let totalTokens = 0;

    for (const message of event.messages) {
      if (!isAssistantMessage(message)) continue;
      const usage = message.usage;
      if (!usage) continue;
      input += usage.input || 0;
      output += usage.output || 0;
      cacheRead += usage.cacheRead || 0;
      cacheWrite += usage.cacheWrite || 0;
      totalTokens += usage.totalTokens || 0;
    }

    // If output is 0 the model produced no tokens (error/empty response)
    // Still show a notification so the user knows the run produced nothing
    const elapsedSeconds = elapsedMs / 1000;
    if (output <= 0) {
      ctx.ui.notify(
        `TPS 0 tok/s — model returned no output (${elapsedSeconds.toFixed(1)}s)`,
        "warning",
      );
      return;
    }

    const tokensPerSecond = output / elapsedSeconds;
    const message = `TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${output.toLocaleString()}, in ${input.toLocaleString()}, cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()}, total ${totalTokens.toLocaleString()}, ${elapsedSeconds.toFixed(1)}s`;
    ctx.ui.notify(message, "info");
  });
}
