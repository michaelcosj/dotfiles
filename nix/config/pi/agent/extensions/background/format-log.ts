/**
 * Readable output for pi JSON-mode logs; other output passes through.
 * `createFormatter` works line by line, for streaming (format-log-cli.ts);
 * `formatLog` formats a bounded snapshot.
 */
export function createFormatter() {
  let pending = "";
  const text = (content: unknown): string => Array.isArray(content)
    ? content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n")
    : typeof content === "string" ? content : "";

  /** Formats one log line; returns the lines to show (often none). */
  function line(line: string): string[] {
    let e;
    try { e = JSON.parse(line); } catch {
      // A snapshot can end in the middle of a JSON record.
      return line.trimStart().startsWith('{"type":') ? [] : [line];
    }
    if (!e || typeof e !== "object") return [line];
    switch (e.type) {
      case "session": return [`Session: ${e.id}`];
      case "message_update":
        if (e.assistantMessageEvent?.type === "text_delta") pending += e.assistantMessageEvent.delta ?? "";
        return [];
      case "message_end": {
        if (e.message?.role !== "assistant") return [];
        const out: string[] = [];
        const body = text(e.message.content);
        if (body) out.push(`Assistant:\n${body}`);
        if (e.message.errorMessage) out.push(`Error: ${e.message.errorMessage}`);
        pending = "";
        return out;
      }
      case "tool_execution_start":
        return [`Tool: ${e.toolName}\n${JSON.stringify(e.args ?? {}, null, 2)}`];
      case "tool_execution_end": {
        const body = text(e.result?.content);
        return [`${e.isError ? "Error" : "Result"}: ${e.toolName}${body ? `\n${body}` : ""}`];
      }
      case "auto_retry_start": return [`Retry ${e.attempt}: ${e.errorMessage}`];
      case "auto_retry_end": return e.finalError ? [`Error: ${e.finalError}`] : [];
      case "agent_settled": return [e.aborted ? "Aborted." : "Finished."];
      case "agent_start": case "agent_end": case "turn_start": case "turn_end":
      case "message_start": case "tool_execution_update": case "queue_update":
      case "entry_appended": case "session_info_changed": case "thinking_level_changed":
      case "compaction_start": case "compaction_end": case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start": case "summarization_retry_finished":
        return [];
      default: return [line];
    }
  }

  return { line, pending: () => pending };
}

/** Format a bounded log snapshot; leave non-Pi output unchanged. */
export function formatLog(log: string): string {
  const f = createFormatter();
  const output = log.split("\n").flatMap(f.line);
  if (f.pending()) output.push(`Assistant (in progress):\n${f.pending()}`);
  return output.join("\n").trim() || "(no output)";
}
