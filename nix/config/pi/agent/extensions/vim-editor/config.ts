// vim-editor/config.json, shared by every VimEditor in this process.
//
// Extensions load through separate module instances (agent-bridge's child
// editor imports VimEditor too), so the live state sits on globalThis.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type Clipboard = "unnamed" | "unnamedplus";
export type VimConfig = {
  enabled: boolean;
  insertRemaps: Record<string, string>;
  clipboard: Clipboard;
};
export type VimState = { enabled: boolean; remaps: string[]; clipboard: Clipboard };

const KEY = Symbol.for("pi.vim-editor.state");
const DEFAULTS: VimConfig = { enabled: true, insertRemaps: {}, clipboard: "unnamedplus" };

export function configPath(): string {
  return join(getAgentDir(), "extensions", "vim-editor", "config.json");
}

/** Valid remaps: two printable characters mapped to "<Esc>". Others are ignored, as in Claude Code. */
export function parseConfig(raw: unknown): VimConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const remaps: Record<string, string> = {};
  if (o.insertRemaps && typeof o.insertRemaps === "object") {
    for (const [k, v] of Object.entries(o.insertRemaps as Record<string, unknown>)) {
      const chars = [...k];
      if (
        chars.length === 2 &&
        chars.every((c) => c >= " ") &&
        typeof v === "string" &&
        v.toLowerCase() === "<esc>"
      )
        remaps[k] = "<Esc>";
    }
  }
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULTS.enabled,
    insertRemaps: remaps,
    clipboard: o.clipboard === "unnamed" ? "unnamed" : "unnamedplus",
  };
}

function readConfig(): { config: VimConfig; raw: Record<string, unknown> } {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    return { config: parseConfig(raw), raw: raw && typeof raw === "object" ? raw : {} };
  } catch {
    return { config: { ...DEFAULTS }, raw: {} };
  }
}

function toState(c: VimConfig): VimState {
  return { enabled: c.enabled, remaps: Object.keys(c.insertRemaps), clipboard: c.clipboard };
}

/** The live state; read from config.json the first time. */
export function vimState(): VimState {
  const g = globalThis as Record<symbol, VimState | undefined>;
  g[KEY] ??= toState(readConfig().config);
  return g[KEY]!;
}

/** Read config.json again (on /reload). */
export function reloadVimState(): VimState {
  (globalThis as Record<symbol, VimState | undefined>)[KEY] = toState(readConfig().config);
  return vimState();
}

/** Turn vim mode on or off now and keep the choice in config.json. */
export function setEnabled(enabled: boolean): void {
  vimState().enabled = enabled;
  const { raw } = readConfig();
  try {
    writeFileSync(configPath(), `${JSON.stringify({ ...raw, enabled }, null, 2)}\n`);
  } catch {
    // The live state still changes; only the saved default is lost.
  }
}
