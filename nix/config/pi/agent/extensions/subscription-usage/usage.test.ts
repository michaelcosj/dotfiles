// Run: bun test nix/config/pi/agent/extensions/subscription-usage/usage.test.ts
// Pure modules only; no Pi runtime imports.
import { describe as group, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCache, readCache, storeSnapshot, updateEntry } from "./cache.ts";
import { claudeFromMessage, claudeFromUsage, claudeTokenFrom } from "./claude.ts";
import { accountIdFromToken, codexFromHeaders, codexFromUsage } from "./codex.ts";
import { describe, duration, renderUsage, visible } from "./format.ts";
import { mergeSnapshot, type UsageState } from "./model.ts";

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
const plain = (_tone: string, s: string) => s;
const tagged = (tone: string, s: string) => `<${tone}>${s}`;

group("claude", () => {
  test("reads pi-claude-code diagnostics (0..1, epoch s)", () => {
    const s = claudeFromMessage({
      role: "assistant", provider: "claude-code",
      diagnostics: [{ type: "claude-code.rate-limit", details: {
        status: "allowed",
        unifiedWindows: { five_hour: { utilization: 0.27, resetsAt: NOW / 1000 + 3600 }, seven_day: { utilization: 0.1 } },
      } }],
    }, NOW)!;
    expect(s.session).toEqual({ usedPct: 27, resetsAt: NOW + 3_600_000 });
    expect(s.weekly).toEqual({ usedPct: 10 });
    expect(s.blocked).toBe(false);
    expect(s.source).toBe("passive");
  });

  test("ignores other providers and missing diagnostics", () => {
    expect(claudeFromMessage({ role: "assistant", provider: "anthropic", diagnostics: [] })).toBeUndefined();
    expect(claudeFromMessage({ role: "assistant", provider: "claude-code" })).toBeUndefined();
    expect(claudeFromMessage({ role: "user" })).toBeUndefined();
  });

  test("rejected window counts as 0% left", () => {
    const s = claudeFromMessage({ role: "assistant", provider: "claude-code", diagnostics: [{ type: "claude-code.rate-limit", details: {
      status: "rejected", unifiedWindows: { five_hour: { utilization: 0.97, status: "rejected" } } } }] }, NOW)!;
    expect(s.session!.usedPct).toBe(100);
    expect(s.blocked).toBe(true);
  });

  test("parses /api/oauth/usage (0..100, ISO)", () => {
    const s = claudeFromUsage({
      five_hour: { utilization: 27.0, resets_at: "2026-11-12T11:00:00.027595+00:00" },
      seven_day: { utilization: 10.0, resets_at: "2026-11-17T04:00:00.027616+00:00" },
      seven_day_opus: null,
    }, NOW)!;
    expect(s.session!.usedPct).toBe(27);
    expect(s.session!.resetsAt).toBe(Date.parse("2026-11-12T11:00:00.027Z"));
    expect(s.weekly!.usedPct).toBe(10);
  });

  test("rejects garbage", () => {
    expect(claudeFromUsage(null)).toBeUndefined();
    expect(claudeFromUsage({ five_hour: { utilization: "x" } })).toBeUndefined();
    expect(claudeFromUsage({ five_hour: { utilization: -1 } })).toBeUndefined();
  });

  test("token: read, expired, missing", () => {
    expect(claudeTokenFrom(JSON.stringify({ claudeAiOauth: { accessToken: "t", expiresAt: NOW + 3_600_000 } }), NOW)).toBe("t");
    expect(() => claudeTokenFrom(JSON.stringify({ claudeAiOauth: { accessToken: "t", expiresAt: NOW - 1 } }), NOW)).toThrow("expired");
    expect(claudeTokenFrom(JSON.stringify({}), NOW)).toBeUndefined();
  });
});

group("codex", () => {
  const headers = {
    "x-codex-primary-used-percent": "0",
    "x-codex-secondary-used-percent": "100",
    "x-codex-primary-window-minutes": "300",
    "x-codex-secondary-window-minutes": "10080",
    "x-codex-primary-reset-after-seconds": "18000",
    "x-codex-secondary-reset-at": String(NOW / 1000 + 48459),
    "x-codex-turn-state": "secret",
  };

  test("reads response headers", () => {
    const s = codexFromHeaders(headers, NOW)!;
    expect(s.session).toEqual({ usedPct: 0, resetsAt: NOW + 18_000_000 });
    expect(s.weekly).toEqual({ usedPct: 100, resetsAt: NOW + 48_459_000 });
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  test("places windows by length, not by name", () => {
    const s = codexFromHeaders({
      "x-codex-primary-used-percent": "40", "x-codex-primary-window-minutes": "10080",
      "x-codex-secondary-used-percent": "5", "x-codex-secondary-window-minutes": "300",
    }, NOW)!;
    expect(s.weekly!.usedPct).toBe(40);
    expect(s.session!.usedPct).toBe(5);
  });

  test("no headers -> undefined", () => {
    expect(codexFromHeaders({ "content-type": "text/event-stream" }, NOW)).toBeUndefined();
  });

  test("parses wham/usage", () => {
    const s = codexFromUsage({ rate_limit: {
      allowed: false, limit_reached: true,
      primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_after_seconds: 18000, reset_at: NOW / 1000 + 18000 },
      secondary_window: { used_percent: 100, limit_window_seconds: 604800, reset_at: NOW / 1000 + 48509 },
    } }, NOW)!;
    expect(s.session!.usedPct).toBe(0);
    expect(s.weekly!.usedPct).toBe(100);
    expect(s.blocked).toBe(true);
    expect(codexFromUsage({ rate_limit: null })).toBeUndefined();
  });

  test("account id from JWT", () => {
    const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc" } })).toString("base64url");
    expect(accountIdFromToken(`h.${payload}.s`)).toBe("acc");
    expect(accountIdFromToken("bad")).toBeUndefined();
  });
});

group("merge and cache", () => {
  test("newer wins and keeps windows it does not report", () => {
    const old = { session: { usedPct: 10 }, weekly: { usedPct: 20 }, fetchedAt: 1, source: "poll" as const };
    const next = { session: { usedPct: 30 }, fetchedAt: 2, source: "passive" as const };
    expect(mergeSnapshot(old, next)).toEqual({ session: { usedPct: 30 }, weekly: { usedPct: 20 }, blocked: undefined, fetchedAt: 2, source: "passive" });
    expect(mergeSnapshot(next, old)).toBe(next);
  });

  test("corrupt cache is empty", () => {
    expect(parseCache("{nope")).toEqual({ version: 1, providers: {} });
    expect(parseCache(JSON.stringify({ version: 2, providers: {} }))).toEqual({ version: 1, providers: {} });
    expect(parseCache(JSON.stringify({ version: 1, providers: { claude: { snapshot: { fetchedAt: "x" } } } })).providers.claude).toEqual({});
  });

  test("atomic update round trip", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "usage-cache-")), "state", "usage.json");
    expect(await readCache(path)).toEqual({ version: 1, providers: {} });
    await updateEntry(path, "codex", (e) => storeSnapshot(e, { weekly: { usedPct: 5 }, fetchedAt: 1, source: "poll" }));
    await updateEntry(path, "claude", (e) => { e.nextPollAt = 9; });
    const cache = JSON.parse(readFileSync(path, "utf8"));
    expect(cache.providers.codex.snapshot.weekly.usedPct).toBe(5);
    expect(cache.providers.claude.nextPollAt).toBe(9);
    writeFileSync(path, "garbage");
    expect((await readCache(path)).providers).toEqual({});
  });
});

group("format", () => {
  const state: UsageState = {
    claude: { session: { usedPct: 22, resetsAt: NOW + 72 * 60_000 }, weekly: { usedPct: 59, resetsAt: NOW + 5 * 86_400_000 }, fetchedAt: NOW, source: "poll" },
    codex: { session: { usedPct: 8 }, weekly: { usedPct: 37 }, fetchedAt: NOW, source: "passive" },
  };

  test("duration", () => {
    expect(duration(30_000)).toBe("1m");
    expect(duration(72 * 60_000)).toBe("1h12m");
    expect(duration(50 * 3600_000)).toBe("2d2h");
  });

  test("full tier, active provider first with meter", () => {
    expect(renderUsage(state, 200, plain, "claude", NOW)).toBe("Claude 5h ▰▰▰▰▱ 78% 1h12m · wk 41%   GPT 5h 92% · wk 63%");
    expect(renderUsage(state, 200, plain, "codex", NOW)).toBe("GPT 5h ▰▰▰▰▰ 92% · wk 63%   Claude 5h 78% · wk 41%");
  });

  test("medium and narrow tiers by width", () => {
    expect(renderUsage(state, 45, plain, "claude", NOW)).toBe("Claude 78% 1h12m · 41%   GPT 92/63");
    expect(renderUsage(state, 25, plain, "claude", NOW)).toBe("C 78/41 · G 92/63");
    for (const width of [25, 45, 200]) expect(visible(renderUsage(state, width, plain, "claude", NOW)!)).toBeLessThanOrEqual(width);
  });

  test("colours: low is warning, empty is error and shows the countdown", () => {
    const low: UsageState = { codex: { session: { usedPct: 75 }, weekly: { usedPct: 100, resetsAt: NOW + 13 * 3600_000 }, blocked: true, fetchedAt: NOW, source: "poll" } };
    const text = renderUsage(low, 200, tagged, undefined, NOW)!;
    expect(text).toContain("<warning>25%");
    expect(text).toContain("<error>0%");
    expect(text).toContain("<error>13h00m");
    expect(text).toStartWith("<error>GPT");
  });

  test("stale data and passed resets get ~", () => {
    const old: UsageState = { claude: { session: { usedPct: 90, resetsAt: NOW - 1 }, fetchedAt: NOW - 3600_000, source: "poll" } };
    expect(renderUsage(old, 200, plain, undefined, NOW)).toBe("Claude 5h 100%~");
  });

  test("no data renders nothing", () => {
    expect(renderUsage({}, 200, plain, "claude", NOW)).toBeUndefined();
  });

  test("details", () => {
    const text = describe(state, { codex: "HTTP 500" }, NOW);
    expect(text).toContain("Claude: 5h: 78% left, resets");
    expect(text).toContain("(last poll: HTTP 500)");
  });
});
