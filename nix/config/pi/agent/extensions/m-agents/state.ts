import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createPermissionSnapshot, parsePermissionSnapshot } from "./permissions.js";
import type { Mode, PermissionSettings, PermissionSnapshot, ThinkingLevel } from "./types.js";

export const PERMISSION_STATE_DIR = path.join(os.tmpdir(), "pi-permission-state");

export interface OriginalAgentState {
  model: Model | undefined;
  thinkingLevel: ThinkingLevel;
  tools: string[];
}

export function captureOriginalState(pi: ExtensionAPI, ctx: ExtensionContext): OriginalAgentState {
  return {
    model: ctx.model,
    thinkingLevel: pi.getThinkingLevel() as ThinkingLevel,
    tools: pi.getActiveTools(),
  };
}

export async function restoreOriginalState(
  pi: ExtensionAPI,
  state: OriginalAgentState | undefined,
): Promise<void> {
  if (state) {
    if (state.model) await pi.setModel(state.model);
    pi.setThinkingLevel(state.thinkingLevel);
    pi.setActiveTools(state.tools);
    return;
  }

  // Fallback if snapshot unavailable.
  pi.setActiveTools(["read", "bash", "edit", "write"]);
}

export function writePermissionState(input: {
  presetName?: string;
  permission: PermissionSettings | undefined;
  sessionOverrides: ReadonlyMap<string, Mode>;
}): void {
  try {
    mkdirSync(PERMISSION_STATE_DIR, { recursive: true });
    const stateFile = path.join(PERMISSION_STATE_DIR, `${process.pid}.json`);
    const snapshot = createPermissionSnapshot(input);
    writeFileSync(stateFile, JSON.stringify(snapshot), { mode: 0o600 });
  } catch (err) {
    console.error("Failed to write permission state:", err);
  }
}

export function clearPermissionState(): void {
  try {
    const stateFile = path.join(PERMISSION_STATE_DIR, `${process.pid}.json`);
    rmSync(stateFile, { force: true });
  } catch (err) {
    console.error("Failed to cleanup permission state:", err);
  }
}

export function readPermissionStateForParentPid(parentPid: number): PermissionSnapshot | undefined {
  try {
    const stateFile = path.join(PERMISSION_STATE_DIR, `${parentPid}.json`);
    if (!existsSync(stateFile)) return undefined;
    const raw = readFileSync(stateFile, "utf-8");
    return parsePermissionSnapshot(raw);
  } catch {
    return undefined;
  }
}

// Prevent accidental auto-registration if this helper module is discovered directly.
export default function (): void {}
