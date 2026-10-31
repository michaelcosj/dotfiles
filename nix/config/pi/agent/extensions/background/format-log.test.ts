import { describe, expect, test } from "bun:test";
import { formatLog } from "./format-log";

const log = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n");
const delta = (delta: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });

describe("background log formatting", () => {
  test("keeps ordinary logs and unrelated JSON", () => {
    const raw = 'Listening on :3000\n{"level":"info","message":"ready"}\n42\nnull';
    expect(formatLog(raw)).toBe(raw);
  });
  test("shows session and mixed diagnostics", () => {
    expect(formatLog('Warning: creating session\n' + log({ type: "session", id: "child-1" })))
      .toBe("Warning: creating session\nSession: child-1");
  });
  test("uses completed text without repeating deltas or turn copies", () => {
    expect(formatLog(log(delta("Hel"), delta("lo"), {
      type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    }, { type: "turn_end" }, { type: "agent_end" }, { type: "agent_settled" })))
      .toBe("Assistant:\nHello\nFinished.");
  });
  test("shows unfinished text and ignores incomplete records", () => {
    expect(formatLog(log(delta("Working")) + '\n{"type":"message_update"'))
      .toBe("Assistant (in progress):\nWorking");
  });
  test("shows tools and errors without duplicate tool results", () => {
    const output = formatLog(log(
      { type: "tool_execution_start", toolName: "bash", args: { command: "false" } },
      { type: "tool_execution_update", toolName: "bash" },
      { type: "tool_execution_end", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "exit 1" }] } },
      { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "exit 1" }] } },
    ));
    expect(output).toContain('Tool: bash\n{\n  "command": "false"\n}');
    expect(output.match(/exit 1/g)).toHaveLength(1);
    expect(output).toContain("Error: bash\nexit 1");
  });
  test("shows provider failure and retry", () => {
    expect(formatLog(log(
      { type: "auto_retry_start", attempt: 1, errorMessage: "overloaded" },
      { type: "message_end", message: { role: "assistant", content: [], errorMessage: "unavailable" } },
    ))).toBe("Retry 1: overloaded\nError: unavailable");
  });
  test("hides thinking and protocol noise", () => {
    expect(formatLog(log({ type: "agent_start" }, {
      type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "private" },
    }))).toBe("(no output)");
  });
});
