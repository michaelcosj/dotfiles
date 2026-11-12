/** Normalised subscription usage shared by the parsers, cache, and formatter. No runtime Pi imports. */

export type ProviderId = "claude" | "codex";
export const PROVIDERS: readonly ProviderId[] = ["claude", "codex"];

export interface Window {
  /** 0..100 */
  usedPct: number;
  /** Epoch ms */
  resetsAt?: number;
}

export interface Snapshot {
  /** Short window (five hours) */
  session?: Window;
  weekly?: Window;
  /** The provider reports that requests are refused now. */
  blocked?: boolean;
  /** Epoch ms when the data was read */
  fetchedAt: number;
  source: "passive" | "poll";
}

export type UsageState = Partial<Record<ProviderId, Snapshot>>;

export function num(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Epoch ms between 2001 and 2200, else undefined. */
export function time(ms: number | undefined): number | undefined {
  return ms !== undefined && Number.isFinite(ms) && ms > 1e12 && ms < 7.3e12 ? ms : undefined;
}

export function makeWindow(usedPct: number | undefined, resetsAt?: number): Window | undefined {
  if (usedPct === undefined || !Number.isFinite(usedPct) || usedPct < 0) return undefined;
  const window: Window = { usedPct: Math.min(100, usedPct) };
  const reset = time(resetsAt);
  if (reset) window.resetsAt = reset;
  return window;
}

/** Newer data wins. A partial update keeps the windows it does not report. */
export function mergeSnapshot(old: Snapshot | undefined, next: Snapshot | undefined): Snapshot | undefined {
  if (!next) return old;
  if (!old) return next;
  if (next.fetchedAt < old.fetchedAt) return old;
  return {
    session: next.session ?? old.session,
    weekly: next.weekly ?? old.weekly,
    blocked: next.blocked ?? old.blocked,
    fetchedAt: next.fetchedAt,
    source: next.source,
  };
}

export function isSnapshot(value: unknown): value is Snapshot {
  const s = value as Snapshot;
  const okWindow = (w: unknown) => w === undefined || (typeof (w as Window).usedPct === "number" && Number.isFinite((w as Window).usedPct));
  return !!s && typeof s === "object" && typeof s.fetchedAt === "number" && (s.source === "passive" || s.source === "poll") &&
    okWindow(s.session) && okWindow(s.weekly);
}

export function providerOfModel(provider: string | undefined): ProviderId | undefined {
  if (provider === "openai-codex") return "codex";
  if (provider === "claude-code" || provider === "anthropic") return "claude";
  return undefined;
}
