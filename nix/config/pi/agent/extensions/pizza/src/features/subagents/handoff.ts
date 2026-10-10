import type { SpawnTask } from "./state.js";

const section = (title: string, value?: string) =>
  value?.trim() ? `${title}:\n${value.trim()}` : undefined;
const list = (title: string, values?: string[]) =>
  values?.length
    ? `${title}:\n${values.filter((value) => value.trim()).map((value) => `- ${value.trim()}`).join("\n")}`
    : undefined;

/** Render an explicit, task-specific handoff. No parent transcript is injected. */
export function renderSubagentHandoff(task: SpawnTask): string {
  const context = task.context;
  return [
    task.origin === "btw"
      ? "You are a read-only side-question assistant. Answer the assigned question using the forked conversation context. Do not modify files, run mutating commands, or continue the parent task."
      : `You are a subagent spawned from${task.parent.sessionName ? ` parent session “${task.parent.sessionName}”` : " a parent Pi session"}.`,
    `Parent working directory: ${task.parent.parentCwd}`,
    context && section("Objective", context.objective),
    context && section("Current state", context.current_state),
    context && list("Constraints", context.constraints),
    context && list("Relevant files", context.relevant_files),
    context && list("Decisions already made", context.decisions),
    context && section("Expected output", context.expected_output),
    `Assigned task:\n${task.prompt}`,
    "If essential context is missing, report exactly what is needed rather than guessing.",
  ].filter(Boolean).join("\n\n");
}
