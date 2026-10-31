/** Subscription quota from the existing Agent Bar daemon; no API calls or credentials.
 * Reload Pi to enable. /subscription-usage rereads the daemon's cached snapshot.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);
const KEY = "subscription-usage";
const POLL_MS = 30_000;

interface Provider {
  id: string;
  status: string;
  limits_updated_at?: string;
  limits: { id: string; used_pct: number }[];
}

export function parseSnapshot(output: string): Provider[] {
  const reply = JSON.parse(output);
  if (reply.type !== "s" || typeof reply.data?.[0] !== "string") throw new Error("Invalid D-Bus reply");
  const snapshot = JSON.parse(reply.data[0]);
  if (snapshot.version !== 1 || !Array.isArray(snapshot.providers)) throw new Error("Invalid usage snapshot");
  return snapshot.providers.filter((p: Provider) =>
    p && ["claude", "openai"].includes(p.id) && typeof p.status === "string" && Array.isArray(p.limits),
  );
}

export function providerText(p: Provider, now = Date.now()): { text: string; color: "dim" | "warning" | "error" } {
  const ids = p.id === "claude" ? ["session", "weekly_all"] : ["primary", "secondary"];
  const limits = ids.map((id) => {
    const limit = p.limits.find((l) => l?.id === id);
    return limit && Number.isFinite(limit.used_pct) && limit.used_pct >= 0
      ? { pct: limit.used_pct }
      : undefined;
  }).filter((l) => l !== undefined);
  const updated = Date.parse(p.limits_updated_at ?? "");
  const stale = p.status !== "ok" || !Number.isFinite(updated) || now - updated > 10 * 60_000;
  const name = p.id === "claude" ? "Claude" : "ChatGPT";
  const usage = limits.length ? limits.map((l) => `${Math.round(Math.max(0, 100 - l.pct))}`).join("/") : "unavailable";
  const max = Math.max(0, ...limits.map((l) => l.pct));
  return {
    text: `${name} ${usage}${stale && limits.length ? " (stale)" : ""}`,
    color: max >= 100 ? "error" : stale || max >= 80 || !limits.length ? "warning" : "dim",
  };
}

export default function subscriptionUsage(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let generation = 0;

  function stop() {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  async function refresh(ctx: ExtensionContext) {
    if (!ctx.hasUI || controller) return;
    const current = generation;
    const pending = new AbortController();
    controller = pending;
    try {
      const { stdout } = await exec("busctl", [
        "--user", "--auto-start=no", "--timeout=3s", "--json=short", "call",
        "dev.agentbar.Usage", "/dev/agentbar/Usage", "dev.agentbar.Usage", "GetSnapshot",
      ], { timeout: 5_000, maxBuffer: 1024 * 1024, signal: pending.signal });
      if (current !== generation) return;
      const theme = ctx.ui.theme;
      const parts = parseSnapshot(stdout).map((p) => {
        const { text, color } = providerText(p);
        return theme.fg(color, text);
      });
      ctx.ui.setStatus(KEY, parts.length ? parts.join(theme.fg("dim", " · ")) : theme.fg("warning", "Usage unavailable"));
    } catch {
      if (current === generation) ctx.ui.setStatus(KEY, ctx.ui.theme.fg("dim", "Usage: Agent Bar unavailable"));
    } finally {
      if (controller === pending) controller = undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    stop();
    if (!ctx.hasUI) return;
    void refresh(ctx);
    timer = setInterval(() => void refresh(ctx), POLL_MS);
    timer.unref();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    stop();
    if (ctx.hasUI) ctx.ui.setStatus(KEY, undefined);
  });
  pi.registerCommand("subscription-usage", {
    description: "Reread subscription quotas from Agent Bar (no network refresh)",
    handler: async (_args, ctx) => { await refresh(ctx); },
  });
}
