import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "assistant";
}

export function registerTpsExtension(pi: ExtensionAPI) {
  let agentStartMs: number | null = null;
  let assistantStartMs: number | null = null;
  let modelElapsedMs = 0;
  let responseCount = 0;
  let hasInvalidModelTiming = false;

  function resetState() {
    agentStartMs = null;
    assistantStartMs = null;
    modelElapsedMs = 0;
    responseCount = 0;
    hasInvalidModelTiming = false;
  }

  pi.on("agent_start", () => {
    const startMs = Date.now();
    resetState();
    agentStartMs = startMs;
  });

  pi.on("message_start", (event) => {
    if (!isAssistantMessage(event.message) || agentStartMs === null) return;
    if (assistantStartMs !== null) hasInvalidModelTiming = true;
    assistantStartMs = Date.now();
  });

  pi.on("message_end", (event) => {
    if (!isAssistantMessage(event.message) || agentStartMs === null) return;

    responseCount++;
    if (assistantStartMs === null) {
      hasInvalidModelTiming = true;
      return;
    }

    const endMs = Date.now();
    const intervalMs = endMs - assistantStartMs;
    assistantStartMs = null;
    if (intervalMs <= 0) {
      hasInvalidModelTiming = true;
      return;
    }

    modelElapsedMs += intervalMs;
  });

  pi.on("agent_end", (event, ctx) => {
    const endMs = Date.now();
    const elapsedMs = agentStartMs === null
      ? 0
      : Math.max(0, endMs - agentStartMs);
    const completedModelElapsedMs = modelElapsedMs;
    const completedResponseCount = responseCount;
    const completedHasInvalidModelTiming = hasInvalidModelTiming
      || assistantStartMs !== null;
    resetState();

    if (!ctx.hasUI) return;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let totalTokens = 0;
    let assistantMessageCount = 0;

    for (const message of event.messages) {
      if (!isAssistantMessage(message)) continue;
      assistantMessageCount++;
      const usage = message.usage;
      if (!usage) continue;
      input += usage.input || 0;
      output += usage.output || 0;
      cacheRead += usage.cacheRead || 0;
      cacheWrite += usage.cacheWrite || 0;
      totalTokens += usage.totalTokens || 0;
    }

    // TPS uses only completed assistant message intervals; elapsed is full agent wall time.
    const modelSeconds = completedModelElapsedMs / 1000;
    const modelTime = `${modelSeconds.toFixed(1)}s model time`;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s elapsed`;
    if (output <= 0) {
      ctx.ui.notify(
        `TPS 0 tok/s — model returned no output (${elapsed})`,
        "warning",
      );
      return;
    }

    if (
      completedHasInvalidModelTiming
      || completedResponseCount !== assistantMessageCount
      || completedModelElapsedMs <= 0
    ) {
      ctx.ui.notify(
        `TPS unavailable — model timing was incomplete or invalid (${elapsed})`,
        "warning",
      );
      return;
    }

    const tokensPerSecond = output / modelSeconds;
    const message = `TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${output.toLocaleString()}, in ${input.toLocaleString()}, cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()}, total ${totalTokens.toLocaleString()}, ${completedResponseCount} response${completedResponseCount === 1 ? "" : "s"}, ${modelTime}, ${elapsed}`;
    ctx.ui.notify(message, "info");
  });
}
