/** ChatGPT (Codex) subscription limits: from Codex response headers (passive) and wham/usage (poll). */
import { makeWindow, num, type Snapshot, type Window } from "./model.ts";
import { fetchJson, UsageError } from "./http.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const DAY_MINUTES = 24 * 60;

interface Slot { window: Window; minutes?: number }

/** Put each window in the right slot: the short (five-hour) one is the session, the long one is weekly. */
function place(slots: { primary?: Slot; secondary?: Slot }, fetchedAt: number, source: Snapshot["source"]): Snapshot | undefined {
  const snapshot: Snapshot = { fetchedAt, source };
  for (const [name, slot] of Object.entries(slots) as [string, Slot | undefined][]) {
    if (!slot) continue;
    const isSession = slot.minutes !== undefined ? slot.minutes <= DAY_MINUTES : name === "primary";
    snapshot[isSession ? "session" : "weekly"] ??= slot.window;
  }
  return snapshot.session || snapshot.weekly ? snapshot : undefined;
}

/** Only the allowlisted x-codex-* usage headers are read. Header names are lower case. */
export function codexFromHeaders(headers: Record<string, string | undefined>, now = Date.now()): Snapshot | undefined {
  const slot = (name: "primary" | "secondary"): Slot | undefined => {
    const used = num(headers[`x-codex-${name}-used-percent`]);
    const at = num(headers[`x-codex-${name}-reset-at`]);
    const after = num(headers[`x-codex-${name}-reset-after-seconds`]);
    const window = makeWindow(used, at !== undefined ? at * 1000 : after !== undefined ? now + after * 1000 : undefined);
    return window ? { window, minutes: num(headers[`x-codex-${name}-window-minutes`]) } : undefined;
  };
  return place({ primary: slot("primary"), secondary: slot("secondary") }, now, "passive");
}

export function codexFromUsage(json: unknown, now = Date.now()): Snapshot | undefined {
  const limit = (json as Record<string, any>)?.rate_limit;
  if (!limit || typeof limit !== "object") return undefined;
  const slot = (raw: any): Slot | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const at = num(raw.reset_at);
    const after = num(raw.reset_after_seconds);
    const window = makeWindow(num(raw.used_percent), at !== undefined ? at * 1000 : after !== undefined ? now + after * 1000 : undefined);
    const seconds = num(raw.limit_window_seconds);
    return window ? { window, minutes: seconds !== undefined ? seconds / 60 : undefined } : undefined;
  };
  const snapshot = place({ primary: slot(limit.primary_window), secondary: slot(limit.secondary_window) }, now, "poll");
  if (snapshot) snapshot.blocked = limit.limit_reached === true || limit.allowed === false;
  return snapshot;
}

export function accountIdFromToken(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    const id = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** token comes from Pi's own openai-codex login (Pi refreshes it). undefined: not logged in. */
export async function pollCodex(token: string | undefined, signal: AbortSignal): Promise<Snapshot | undefined> {
  if (!token) return undefined;
  const accountId = accountIdFromToken(token);
  if (!accountId) throw new UsageError("No ChatGPT account id in token");
  const json = await fetchJson(USAGE_URL, {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    Accept: "application/json",
  }, signal);
  const snapshot = codexFromUsage(json);
  if (!snapshot) throw new UsageError("Unexpected Codex usage response");
  return snapshot;
}
