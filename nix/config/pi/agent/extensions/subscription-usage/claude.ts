/** Claude subscription limits: from pi-claude-code diagnostics (passive) and the OAuth usage endpoint (poll). */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeWindow, num, type Snapshot } from "./model.ts";
import { fetchJson, UsageError } from "./http.ts";

const exec = promisify(execFile);
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/** Read the `claude-code.rate-limit` diagnostic that pi-claude-code puts on each assistant message. */
export function claudeFromMessage(message: unknown, now = Date.now()): Snapshot | undefined {
  const m = message as { role?: string; provider?: string; diagnostics?: { type?: string; details?: unknown }[] };
  if (m?.role !== "assistant" || m.provider !== "claude-code" || !Array.isArray(m.diagnostics)) return undefined;
  const details = m.diagnostics.findLast((d) => d?.type === "claude-code.rate-limit")?.details as Record<string, any> | undefined;
  if (!details || typeof details !== "object") return undefined;

  // Header values: utilization 0..1, resetsAt epoch seconds.
  const fromRaw = (raw: any) => {
    if (!raw || typeof raw !== "object") return undefined;
    const used = num(raw.utilization);
    const reset = num(raw.resetsAt);
    const window = makeWindow(used === undefined ? undefined : used * 100, reset === undefined ? undefined : reset * 1000);
    if (window && raw.status === "rejected") window.usedPct = 100;
    return window;
  };
  const windows = details.unifiedWindows && typeof details.unifiedWindows === "object" ? details.unifiedWindows : {};
  let session = fromRaw(windows.five_hour);
  let weekly = fromRaw(windows.seven_day);
  // The Claude Code CLI report has one representative window instead.
  if (!session && details.rateLimitType === "five_hour") session = fromRaw(details);
  if (!weekly && details.rateLimitType === "seven_day") weekly = fromRaw(details);
  if (!session && !weekly) return undefined;
  const snapshot: Snapshot = { fetchedAt: now, source: "passive" };
  if (session) snapshot.session = session;
  if (weekly) snapshot.weekly = weekly;
  if (details.status === "rejected") snapshot.blocked = true;
  else if (details.status === "allowed" || details.status === "allowed_warning") snapshot.blocked = false;
  return snapshot;
}

/** Parse GET /api/oauth/usage. utilization 0..100, resets_at ISO. */
export function claudeFromUsage(json: unknown, now = Date.now()): Snapshot | undefined {
  const body = json as Record<string, any>;
  if (!body || typeof body !== "object") return undefined;
  const fromRaw = (raw: any) =>
    raw && typeof raw === "object" ? makeWindow(num(raw.utilization), Date.parse(raw.resets_at ?? "")) : undefined;
  const session = fromRaw(body.five_hour);
  const weekly = fromRaw(body.seven_day);
  if (!session && !weekly) return undefined;
  const snapshot: Snapshot = { fetchedAt: now, source: "poll" };
  if (session) snapshot.session = session;
  if (weekly) snapshot.weekly = weekly;
  return snapshot;
}

/** Parse Claude Code's credential JSON. Read only; we never refresh another app's token. */
export function claudeTokenFrom(raw: string, now = Date.now()): string | undefined {
  const oauth = JSON.parse(raw)?.claudeAiOauth;
  if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) return undefined;
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt < now + 30_000) throw new UsageError("Claude Code token expired");
  return oauth.accessToken;
}

async function readCredentials(signal: AbortSignal): Promise<string | undefined> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await exec("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        timeout: 3_000, maxBuffer: 256 * 1024, signal,
      });
      if (stdout.trim()) return stdout;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  try {
    return await readFile(join(dir, ".credentials.json"), { encoding: "utf8", signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** undefined: no Claude login on this machine. */
export async function pollClaude(signal: AbortSignal): Promise<Snapshot | undefined> {
  const raw = await readCredentials(signal);
  if (!raw) return undefined;
  const token = claudeTokenFrom(raw);
  if (!token) return undefined;
  const json = await fetchJson(USAGE_URL, {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json",
  }, signal);
  const snapshot = claudeFromUsage(json);
  if (!snapshot) throw new UsageError("Unexpected Claude usage response");
  return snapshot;
}
