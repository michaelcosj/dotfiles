import type { Theme } from "@earendil-works/pi-coding-agent";
import { oneLineSummary } from "./result-card.js";

interface SpawnArgs {
  name?: string;
  prompt?: string;
  model?: string;
  reasoning_effort?: string;
}

interface SpawnDetails {
  id?: string;
  status?: string;
  modelLabel?: string;
  reasoningEffort?: string;
}

export function spawnCallText(args: SpawnArgs, theme: Theme) {
  const name = oneLineSummary(args.name || "Subagent", 80);
  const prompt = oneLineSummary(args.prompt || "", 120);
  const model = oneLineSummary(args.model || "", 60);
  const reasoning = oneLineSummary(args.reasoning_effort || "", 20);
  const identity = [
    model ? theme.fg("text", model) : "",
    reasoning ? theme.fg("muted", reasoning) : "",
  ]
    .filter(Boolean)
    .join(theme.fg("dim", " · "));
  const heading = [
    `${theme.fg("success", "●")} ${theme.fg("toolTitle", theme.bold(`subagent_spawn(${name})`))}`,
    identity,
  ]
    .filter(Boolean)
    .join("  ");
  return prompt
    ? `${heading}\n${theme.fg("dim", "│")} ${theme.fg("muted", prompt)}`
    : heading;
}

export function spawnResultText(
  result: { details?: unknown },
  theme: Theme,
) {
  const details = (result.details ?? {}) as SpawnDetails;
  const id = oneLineSummary(details.id || "unknown", 80);
  const running = details.status === "running";
  const label = running ? "Running in background" : "Started";
  return `${theme.fg("dim", "└─")} ${theme.fg(running ? "muted" : "success", label)} ${theme.fg("dim", `(ID: ${id})`)}`;
}
