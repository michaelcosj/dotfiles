/**
 * Pure rendering of the usage line. Shows remaining %, fitted to the available width.
 *
 * Pace: the used % and the time to reset give the use rate so far, and so the used %
 * at reset if the rate holds. Near full use (80-105%) is on pace (green), more runs
 * out before the reset (ahead, yellow), less leaves capacity unused (under, dim).
 */
import { PROVIDERS, type ProviderId, type Snapshot, type UsageState, type Window } from "./model.ts";

export type Tone = "dim" | "success" | "warning" | "error";
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

type WindowKind = "session" | "weekly";
const LENGTH: Record<WindowKind, number> = { session: 5 * 3600_000, weekly: 7 * 86_400_000 };
/** Too early to judge: before this part of the window has passed, or below this used %. */
const MIN_ELAPSED = 0.1;
const MIN_USED = 3;
const ON_PACE = [80, 105] as const;
const URGENT_MS = 30 * 60_000;

export type Pace = "ahead" | "on" | "under";

interface View {
  left: number;
  tone: Tone;
  resetIn?: number;
  expired: boolean;
  pace?: Pace;
  /** Ahead only: time until the window is used up at the current rate. */
  emptyIn?: number;
  /** % left now on a full-use pace; where the meter's tick goes. */
  due?: number;
}

/** A window whose reset time has passed is assumed reset (100% left) but marked as old. */
function view(window: Window, kind: WindowKind, now: number): View {
  const expired = window.resetsAt !== undefined && window.resetsAt <= now;
  const left = expired ? 100 : Math.max(0, Math.round(100 - window.usedPct));
  const resetIn = !expired && window.resetsAt ? window.resetsAt - now : undefined;
  const v: View = { left, tone: "dim", resetIn, expired };
  const elapsed = resetIn !== undefined ? LENGTH[kind] - resetIn : 0;
  const part = elapsed / LENGTH[kind];
  if (left > 0 && part >= MIN_ELAPSED && part <= 1 && window.usedPct >= MIN_USED) {
    const projected = window.usedPct / part;
    v.pace = projected > ON_PACE[1] ? "ahead" : projected >= ON_PACE[0] ? "on" : "under";
    v.due = 100 * (1 - part);
    if (v.pace === "ahead") v.emptyIn = ((100 - window.usedPct) * elapsed) / window.usedPct;
  }
  v.tone =
    left <= 0 || (v.emptyIn !== undefined && v.emptyIn < URGENT_MS) ? "error"
    : v.pace === "ahead" ? "warning"
    : v.pace === "on" ? "success"
    : v.pace === undefined && left < 30 ? "warning" // no reset time, or too early: fall back to the level
    : "dim";
  return v;
}

/** Five cells of % left, with a tick at the full-use pace: fill past the tick is under pace. */
function meter(v: View, paint: Paint): string {
  const cells = 5;
  const cell = (pct: number) => Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  const full = cell(v.left);
  // Cells from..to: filled ones in the window's tone, empty ones dim.
  const draw = (from: number, to: number) => {
    const split = Math.max(from, Math.min(to, full));
    return (split > from ? paint(v.tone, "▰".repeat(split - from)) : "") + (to > split ? paint("dim", "▱".repeat(to - split)) : "");
  };
  if (v.due === undefined) return draw(0, cells);
  const tick = cell(v.due);
  return draw(0, tick) + paint("dim", "┃") + draw(tick, cells);
}

type Tier = "full" | "medium" | "narrow";

function provider(id: ProviderId, s: Snapshot, active: boolean, tier: Tier, paint: Paint, now: number): string {
  const session = s.session && view(s.session, "session", now);
  const weekly = s.weekly && view(s.weekly, "weekly", now);
  const stale = now - s.fetchedAt > STALE_MS || !!session?.expired || !!weekly?.expired;
  const nameTone: Tone = s.blocked ? "error" : "dim";
  const mark = stale ? paint("warning", "~") : "";
  // Ahead: when it runs out (↑). Otherwise the reset countdown, for the active
  // session and any window that is low or empty.
  const clock = (v: View, always: boolean) =>
    v.emptyIn !== undefined ? " " + paint(v.tone, "↑" + duration(v.emptyIn))
    : v.resetIn !== undefined && (always || v.tone === "warning" || v.tone === "error") ? " " + paint(v.tone, duration(v.resetIn))
    : "";
  const num = (v: View | undefined) => (v ? paint(v.tone, String(v.left) + (v.pace === "ahead" ? "↑" : "")) : paint("dim", "-"));

  if (tier === "narrow") {
    const nums = [session, weekly].map(num);
    return paint(nameTone, NAMES[id][1]) + " " + nums.join(paint("dim", "/")) + mark;
  }
  const parts: string[] = [];
  if (tier === "full") {
    if (session) parts.push(paint("dim", "5h ") + (active ? meter(session, paint) + " " : "") + paint(session.tone, `${session.left}%`) + clock(session, active));
    if (weekly) parts.push(paint("dim", "wk ") + paint(weekly.tone, `${weekly.left}%`) + clock(weekly, false));
    return paint(nameTone, NAMES[id][0]) + " " + parts.join(paint("dim", " · ")) + mark;
  }
  // medium
  if (active) {
    if (session) parts.push(paint(session.tone, `${session.left}%`) + clock(session, true));
    if (weekly) parts.push(paint(weekly.tone, `${weekly.left}%`) + clock(weekly, false));
    return paint(nameTone, NAMES[id][0]) + " " + parts.join(paint("dim", " · ")) + mark;
  }
  const nums = [session, weekly].map(num);
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
    const windows = ([["5h", s.session, "session"], ["week", s.weekly, "weekly"]] as const)
      .filter(([, w]) => w)
      .map(([label, w, kind]) => {
        const v = view(w!, kind, now);
        const pace = v.pace === "ahead" ? `ahead, empty in ${duration(v.emptyIn!)}` : v.pace === "on" ? "on pace" : v.pace === "under" ? "under pace" : "";
        const reset = v.expired ? "reset passed" : w!.resetsAt ? `resets ${clockTime(w!.resetsAt, now)} (${duration(w!.resetsAt - now)})` : "";
        return `${label}: ${v.left}% left${pace ? `, ${pace}` : ""}${reset ? `, ${reset}` : ""}`;
      });
    const age = duration(now - s.fetchedAt);
    lines.push(`${name}: ${windows.join(" · ")}${s.blocked ? " · BLOCKED" : ""} — ${s.source}, ${age} ago${errors[id] ? ` (last poll: ${errors[id]})` : ""}`);
  }
  return lines.join("\n");
}
