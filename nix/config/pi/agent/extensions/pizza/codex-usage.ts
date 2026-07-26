import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CODEX_USAGE_STATUS_KEY = "codex-usage";
let latestCodexUsage = "";
export const getLatestCodexUsage = () => latestCodexUsage;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_INTERVAL_MS = 2 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const AUTH_CLAIM = "https://api.openai.com/auth";

type UsageWindow = {
  usedPercent: number;
  resetAt?: number;
  windowSeconds: number;
};

export type CodexUsage = {
  primary?: UsageWindow;
  secondary?: UsageWindow;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function isTuiContext(ctx: ExtensionContext): boolean {
  const mode = (ctx as ExtensionContext & { mode?: string }).mode;
  return mode === undefined ? ctx.hasUI : mode === "tui";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(value: unknown): UsageWindow | undefined {
  const window = asRecord(value);
  if (!window) return undefined;

  const usedPercent = finiteNumber(window.used_percent);
  const windowSeconds = finiteNumber(window.limit_window_seconds);
  if (usedPercent === undefined || windowSeconds === undefined || windowSeconds <= 0) {
    return undefined;
  }

  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetAt: finiteNumber(window.reset_at),
    windowSeconds,
  };
}

export function parseCodexUsage(value: unknown): CodexUsage | undefined {
  const root = asRecord(value);
  const rateLimit = asRecord(root?.rate_limit);
  if (!rateLimit) return undefined;

  const usage = {
    primary: parseWindow(rateLimit.primary_window),
    secondary: parseWindow(rateLimit.secondary_window),
  };
  return usage.primary || usage.secondary ? usage : undefined;
}

export function extractCodexAccountId(accessToken: string): string | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(payload.length / 4) * 4,
      "=",
    );
    const claims = asRecord(JSON.parse(atob(base64)));
    const auth = asRecord(claims?.[AUTH_CLAIM]);
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function formatWindowDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function formatCodexUsage(usage: CodexUsage): string | undefined {
  const windows = [usage.primary, usage.secondary].filter(
    (window): window is UsageWindow => window !== undefined,
  );
  if (windows.length === 0) return undefined;

  return windows
    .map((window) => `${Math.round(100 - window.usedPercent)}% ${formatWindowDuration(window.windowSeconds)}`)
    .join(" · ");
}

export async function fetchCodexUsage(
  accessToken: string,
  fetchImpl: FetchLike = globalThis.fetch,
  signal?: AbortSignal,
): Promise<CodexUsage> {
  const accountId = extractCodexAccountId(accessToken);
  if (!accountId) throw new Error("Codex OAuth token has no ChatGPT account ID");

  const response = await fetchImpl(USAGE_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-Id": accountId,
      Originator: "pi",
      "User-Agent": "pi-pizza",
    },
    signal,
  });
  if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);

  const usage = parseCodexUsage(await response.json());
  if (!usage) throw new Error("Codex usage response has no rate-limit windows");
  return usage;
}

export function registerCodexUsageExtension(pi: ExtensionAPI) {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let activeRequest: AbortController | undefined;
  let inFlight: Promise<void> | undefined;
  let activeContext: ExtensionContext | undefined;

  const refresh = (ctx: ExtensionContext): Promise<void> => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const accessToken = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
      if (activeContext !== ctx) return;
      if (!accessToken || !extractCodexAccountId(accessToken)) {
        ctx.ui.setStatus(CODEX_USAGE_STATUS_KEY, undefined);
        return;
      }

      const controller = new AbortController();
      activeRequest = controller;
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const usage = await fetchCodexUsage(accessToken, globalThis.fetch, controller.signal);
        if (activeContext === ctx) {
          latestCodexUsage = formatCodexUsage(usage) ?? "";
          ctx.ui.setStatus(CODEX_USAGE_STATUS_KEY, latestCodexUsage || undefined);
        }
      } catch {
        // Keep the last successful value through transient endpoint failures.
      } finally {
        clearTimeout(timeout);
        if (activeRequest === controller) activeRequest = undefined;
      }
    })().finally(() => {
      inFlight = undefined;
    });

    return inFlight;
  };

  pi.on("session_start", (_event, ctx) => {
    if (!isTuiContext(ctx)) return;
    activeContext = ctx;
    void refresh(ctx);
    refreshTimer = setInterval(() => {
      if (activeContext) void refresh(activeContext);
    }, REFRESH_INTERVAL_MS);
    (refreshTimer as unknown as { unref?: () => void }).unref?.();
  });

  pi.on("agent_end", (_event, ctx) => {
    if (isTuiContext(ctx) && activeContext) void refresh(activeContext);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    activeContext = undefined;
    activeRequest?.abort();
    activeRequest = undefined;
    latestCodexUsage = "";
    ctx.ui.setStatus(CODEX_USAGE_STATUS_KEY, undefined);
  });
}
