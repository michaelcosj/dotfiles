/** Antigravity (Gemini) subscription limits from agy's read-only `/usage` command. It sends no model
 *  request. The lines are tab-separated: group, window, remaining %, reset (ISO; 1970 = not started). */
import { execFile } from "node:child_process";
import { makeWindow, type Snapshot } from "./model.ts";

/** pi-agy-acp registers this provider. Without it, Gemini usage is not shown or polled. */
export const AGY_PROVIDER = "antigravity";
const GROUP = "Gemini Models";

export function geminiFromUsage(out: string, now = Date.now()): Snapshot | undefined {
  const s: Snapshot = { fetchedAt: now, source: "poll" };
  for (const line of out.split("\n")) {
    const [group, window, remaining, resets] = line.split("\t").map((x) => x?.trim());
    if (group !== GROUP || !/^\d+(\.\d+)?%$/.test(remaining ?? "")) continue;
    const at = resets && !resets.startsWith("1970") ? Date.parse(resets) : undefined;
    const w = makeWindow(100 - parseFloat(remaining!), at);
    if (/five hour/i.test(window ?? "")) s.session = w;
    else if (/weekly/i.test(window ?? "")) s.weekly = w;
  }
  return s.session || s.weekly ? s : undefined;
}

export function pollGemini(signal: AbortSignal, command = process.env.PI_ANTIGRAVITY_COMMAND?.trim() || "agy"): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    execFile(command, ["-p", "/usage"], { signal, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout) => {
      if (error) return reject(error);
      resolve(geminiFromUsage(stdout));
    });
  });
}
