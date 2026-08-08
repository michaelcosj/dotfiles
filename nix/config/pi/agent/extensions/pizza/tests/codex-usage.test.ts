import { describe, expect, it } from "bun:test";
import {
  extractCodexAccountId,
  fetchCodexUsage,
  formatCodexUsage,
  formatResetTimestamp,
  getLatestCodexUsage,
  parseCodexUsage,
  registerCodexUsageExtension,
} from "../src/features/codex-usage/register.ts";

function accessToken(accountId = "account-123"): string {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `header.${payload}.signature`;
}

const responseBody = {
  plan_type: "plus",
  rate_limit: {
    primary_window: {
      used_percent: 18.4,
      reset_at: 1_800_000_000,
      limit_window_seconds: 18_000,
    },
    secondary_window: {
      used_percent: 42.1,
      reset_at: 1_800_100_000,
      limit_window_seconds: 604_800,
    },
  },
  credits: {
    has_credits: true,
    balance: "1671.2073250000",
  },
};

const formattedUsage = `82%/5h ↻${formatResetTimestamp(1_800_000_000)} · 58%/7d ↻${formatResetTimestamp(1_800_100_000)} · +1,671.21`;

describe("Codex usage", () => {
  it("extracts the ChatGPT account ID from the OAuth token", () => {
    expect(extractCodexAccountId(accessToken())).toBe("account-123");
    expect(extractCodexAccountId("not-a-jwt")).toBeUndefined();
  });

  it("parses and formats server-provided windows without hardcoded labels", () => {
    const usage = parseCodexUsage(responseBody);

    expect(usage).toEqual({
      primary: { usedPercent: 18.4, resetAt: 1_800_000_000, windowSeconds: 18_000 },
      secondary: { usedPercent: 42.1, resetAt: 1_800_100_000, windowSeconds: 604_800 },
      creditBalance: 1671.207325,
    });
    expect(formatCodexUsage(usage!)).toBe(formattedUsage);
  });

  it("only includes a balance when has_credits is true", () => {
    const withoutCredits = parseCodexUsage({
      ...responseBody,
      credits: { has_credits: false, balance: "1671.2073250000" },
    });

    expect(withoutCredits?.creditBalance).toBeUndefined();
    expect(formatCodexUsage(withoutCredits!)).not.toContain("+1,671.21");
  });

  it("accepts a response with only one valid window", () => {
    const usage = parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 7_200 },
        secondary_window: { used_percent: "invalid", limit_window_seconds: 604_800 },
      },
    });

    expect(formatCodexUsage(usage!)).toBe("88%/2h");
  });

  it("starts the initial credential lookup without blocking session startup", () => {
    const handlers = new Map<string, Function>();
    let credentialLookups = 0;
    const pi: any = {
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
    };
    const ctx: any = {
      mode: "tui",
      hasUI: true,
      modelRegistry: {
        async getApiKeyForProvider() {
          credentialLookups++;
          return undefined;
        },
      },
      ui: { setStatus() {} },
    };

    registerCodexUsageExtension(pi);
    handlers.get("session_start")!({}, ctx);
    expect(credentialLookups).toBe(1);
    handlers.get("session_shutdown")!({}, ctx);
  });

  it("refreshes after a run even though Pi supplies a fresh event context", async () => {
    const handlers = new Map<string, Function>();
    const pi: any = { on: (event: string, handler: Function) => handlers.set(event, handler) };
    const statuses: string[] = [];
    const makeContext = () => ({
      mode: "tui",
      hasUI: true,
      modelRegistry: { async getApiKeyForProvider() { return accessToken(); } },
      ui: { setStatus(_key: string, value: string) { if (value) statuses.push(value); } },
    });
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const sessionContext = makeContext();
    try {
      registerCodexUsageExtension(pi);
      handlers.get("session_start")!({}, sessionContext);
      await new Promise((resolve) => setTimeout(resolve, 0));
      handlers.get("agent_end")!({}, makeContext());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetches).toBe(2);
      expect(statuses).toEqual([formattedUsage, formattedUsage]);
    } finally {
      handlers.get("session_shutdown")!({}, sessionContext);
      globalThis.fetch = originalFetch;
    }
  });

  it("clears last account usage when credentials are removed", async () => {
    const handlers = new Map<string, Function>();
    const pi: any = { on: (event: string, handler: Function) => handlers.set(event, handler) };
    let token: string | undefined = accessToken();
    const statuses: Array<string | undefined> = [];
    const ctx: any = {
      mode: "tui",
      hasUI: true,
      modelRegistry: { async getApiKeyForProvider() { return token; } },
      ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(responseBody), { status: 200 })) as unknown as typeof globalThis.fetch;

    try {
      registerCodexUsageExtension(pi);
      handlers.get("session_start")!({}, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getLatestCodexUsage()).toBe(formattedUsage);

      token = undefined;
      handlers.get("agent_end")!({}, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getLatestCodexUsage()).toBe("");
      expect(statuses.at(-1)).toBeUndefined();
    } finally {
      handlers.get("session_shutdown")!({}, ctx);
      globalThis.fetch = originalFetch;
    }
  });

  it("sends the Pi OAuth token and account ID to the usage endpoint", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const usage = await fetchCodexUsage(accessToken(), fetchImpl);
    const headers = new Headers(requestInit?.headers);

    expect(requestUrl).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(headers.get("authorization")).toBe(`Bearer ${accessToken()}`);
    expect(headers.get("chatgpt-account-id")).toBe("account-123");
    expect(formatCodexUsage(usage)).toBe(formattedUsage);
  });
});
