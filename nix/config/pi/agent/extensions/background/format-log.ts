/** Format a bounded log snapshot; leave non-Pi output unchanged. */
export function formatLog(log: string): string {
  const output: string[] = [];
  let pending = "";
  const text = (content: unknown): string => Array.isArray(content)
    ? content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n")
    : typeof content === "string" ? content : "";

  for (const line of log.split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch {
      // A snapshot can end in the middle of a JSON record.
      if (!line.trimStart().startsWith('{"type":')) output.push(line);
      continue;
    }
    if (!e || typeof e !== "object") { output.push(line); continue; }
    switch (e.type) {
      case "session": output.push(`Session: ${e.id}`); break;
      case "message_update":
        if (e.assistantMessageEvent?.type === "text_delta") pending += e.assistantMessageEvent.delta ?? "";
        break;
      case "message_end":
        if (e.message?.role === "assistant") {
          const body = text(e.message.content);
          if (body) output.push(`Assistant:\n${body}`);
          if (e.message.errorMessage) output.push(`Error: ${e.message.errorMessage}`);
          pending = "";
        }
        break;
      case "tool_execution_start":
        output.push(`Tool: ${e.toolName}\n${JSON.stringify(e.args ?? {}, null, 2)}`);
        break;
      case "tool_execution_end": {
        const body = text(e.result?.content);
        output.push(`${e.isError ? "Error" : "Result"}: ${e.toolName}${body ? `\n${body}` : ""}`);
        break;
      }
      case "auto_retry_start": output.push(`Retry ${e.attempt}: ${e.errorMessage}`); break;
      case "auto_retry_end":
        if (e.finalError) output.push(`Error: ${e.finalError}`);
        break;
      case "agent_settled": output.push(e.aborted ? "Aborted." : "Finished."); break;
      case "agent_start": case "agent_end": case "turn_start": case "turn_end":
      case "message_start": case "tool_execution_update": case "queue_update":
      case "entry_appended": case "session_info_changed": case "thinking_level_changed":
      case "compaction_start": case "compaction_end": case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start": case "summarization_retry_finished":
        break;
      default: output.push(line);
    }
  }
  if (pending) output.push(`Assistant (in progress):\n${pending}`);
  return output.join("\n").trim() || "(no output)";
}
