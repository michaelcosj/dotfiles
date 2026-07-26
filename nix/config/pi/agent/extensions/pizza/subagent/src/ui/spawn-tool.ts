import type { Theme } from "@earendil-works/pi-coding-agent";
import { oneLineSummary } from "./result-card.ts";

interface SpawnArgs {
  name?: string;
  prompt?: string;
}

interface SpawnDetails {
  id?: string;
  status?: string;
}

export function spawnCallText(args: SpawnArgs, theme: Theme) {
  const name = oneLineSummary(args.name || "Subagent", 80);
  const prompt = oneLineSummary(args.prompt || "", 120);
  return [
    `${theme.fg("success", "●")} ${theme.fg("toolTitle", theme.bold(`subagent_spawn(${name})`))}`,
    prompt ? theme.fg("muted", prompt) : "",
  ]
    .filter(Boolean)
    .join("  ");
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
