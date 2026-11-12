/** Pure rendering of the usage line. Shows remaining %, fitted to the available width. */
import { PROVIDERS, type ProviderId, type Snapshot, type UsageState, type Window } from "./model.ts";

export type Tone = "dim" | "warning" | "error";
export type Paint = (tone: Tone, text: string) => string;

export const STALE_MS = 15 * 60_000;
const NAMES: Record<ProviderId, [full: string, short: string]> = { claude: ["Claude", "C"], codex: ["GPT", "G"] };
const ESC = /\x1b\[[0-9;]*m/g;

export const visible = (text: string) => [...text.replace(ESC, "")].length;

export function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d${hours % 24}h`;
}

interface View { left: number; tone: Tone; resetIn?: number; expired: boolean }

/** A window whose reset time has passed is assumed reset (100% left) but marked as old. */
function view(window: Window, now: number): View {
  const expired = window.resetsAt !== undefined && window.resetsAt <= now;
  const left = expired ? 100 : Math.max(0, Math.round(100 - window.usedPct));
  const tone: Tone = left <= 0 ? "error" : left < 30 ? "warning" : "dim";
  return { left, tone, resetIn: !expired && window.resetsAt ? window.resetsAt - now : undefined, expired };
}

function meter(left: number, paint: Paint, tone: Tone): string {
  const cells = 5;
  const full = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)));
  return paint(tone, "▰".repeat(full)) + paint("dim", "▱".repeat(cells - full));
}

type Tier = "full" | "medium" | "narrow";

function provider(id: ProviderId, s: Snapshot, active: boolean, tier: Tier, paint: Paint, now: number): string {
  const session = s.session && view(s.session, now);
  const weekly = s.weekly && view(s.weekly, now);
  const stale = now - s.fetchedAt > STALE_MS || !!session?.expired || !!weekly?.expired;
  const nameTone: Tone = s.blocked ? "error" : "dim";
  const mark = stale ? paint("warning", "~") : "";
  // Show the countdown where it matters: the active session, and any window that is low.
  const clock = (v: View, always: boolean) =>
    v.resetIn !== undefined && (always || v.tone !== "dim") ? " " + paint(v.tone, duration(v.resetIn)) : "";

  if (tier === "narrow") {
    const nums = [session, weekly].map((v) => (v ? paint(v.tone, String(v.left)) : paint("dim", "-")));
    return paint(nameTone, NAMES[id][1]) + " " + nums.join(paint("dim", "/")) + mark;
  }
  const parts: string[] = [];
  if (tier === "full") {
    if (session) parts.push(paint("dim", "5h ") + (active ? meter(session.left, paint, session.tone) + " " : "") + paint(session.tone, `${session.left}%`) + clock(session, active));
    if (weekly) parts.push(paint("dim", "wk ") + paint(weekly.tone, `${weekly.left}%`) + clock(weekly, false));
    return paint(nameTone, NAMES[id][0]) + " " + parts.join(paint("dim", " · ")) + mark;
  }
  // medium
  if (active) {
    if (session) parts.push(paint(session.tone, `${session.left}%`) + clock(session, true));
    if (weekly) parts.push(paint(weekly.tone, `${weekly.left}%`) + clock(weekly, false));
    return paint(nameTone, NAMES[id][0]) + " " + parts.join(paint("dim", " · ")) + mark;
  }
  const nums = [session, weekly].map((v) => (v ? paint(v.tone, String(v.left)) : paint("dim", "-")));
  return paint(nameTone, NAMES[id][0]) + " " + nums.join(paint("dim", "/")) + mark;
}

export function order(state: UsageState, active?: ProviderId): ProviderId[] {
  const ids = PROVIDERS.filter((id) => state[id]);
  return active && ids.includes(active) ? [active, ...ids.filter((id) => id !== active)] : ids;
}

export function renderTier(state: UsageState, tier: Tier, paint: Paint, active?: ProviderId, now = Date.now()): string | undefined {
  const ids = order(state, active);
  if (!ids.length) return undefined;
  const gap = tier === "narrow" ? paint("dim", " · ") : "   ";
  return ids.map((id) => provider(id, state[id]!, id === active, tier, paint, now)).join(gap);
}

/** The widest tier that fits in width. The caller still truncates the narrow tier if needed. */
export function renderUsage(state: UsageState, width: number, paint: Paint, active?: ProviderId, now = Date.now()): string | undefined {
  let text: string | undefined;
  for (const tier of ["full", "medium", "narrow"] as const) {
    text = renderTier(state, tier, paint, active, now);
    if (text === undefined || visible(text) <= width) return text;
  }
  return text;
}

function clockTime(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return at - now < 20 * 3600_000 ? time : `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** Plain multi-line details for /subscription-usage. */
export function describe(state: UsageState, errors: Partial<Record<ProviderId, string>>, now = Date.now()): string {
  const lines: string[] = [];
  for (const id of PROVIDERS) {
    const s = state[id];
    const name = id === "claude" ? "Claude" : "ChatGPT";
    if (!s) {
      lines.push(`${name}: ${errors[id] ?? "no data"}`);
      continue;
    }
    const windows = ([["5h", s.session], ["week", s.weekly]] as const)
      .filter(([, w]) => w)
      .map(([label, w]) => {
        const v = view(w!, now);
        const reset = v.expired ? "reset passed" : w!.resetsAt ? `resets ${clockTime(w!.resetsAt, now)} (${duration(w!.resetsAt - now)})` : "";
        return `${label}: ${v.left}% left${reset ? `, ${reset}` : ""}`;
      });
    const age = duration(now - s.fetchedAt);
    lines.push(`${name}: ${windows.join(" · ")}${s.blocked ? " · BLOCKED" : ""} — ${s.source}, ${age} ago${errors[id] ? ` (last poll: ${errors[id]})` : ""}`);
  }
  return lines.join("\n");
}
