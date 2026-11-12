/** Claude and ChatGPT subscription limits in the footer, without the Agent Bar daemon.
 *
 * Passive data comes from Pi's own requests (pi-claude-code rate-limit diagnostics, Codex x-codex-* headers).
 * A low-frequency poll of the providers' usage endpoints fills the gaps at startup and when idle. A cache
 * file shared by all Pi processes means one process polls for all of them. Nothing here blocks Pi: all I/O
 * is async, every request has a timeout, and timers are unref'd.
 *
 * compact-footer.ts claims the `subscription-usage:update` event and draws the line at its real width. If
 * no footer claims it, the compact text goes to setStatus instead. /subscription-usage forces a poll.
 */
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCache, storeSnapshot, updateEntry, type CacheFile } from "./cache.ts";
import { claudeFromMessage, pollClaude } from "./claude.ts";
import { codexFromHeaders, pollCodex } from "./codex.ts";
import { describe, renderTier, renderUsage, type Paint } from "./format.ts";
import { UsageError } from "./http.ts";
import { mergeSnapshot, PROVIDERS, providerOfModel, type ProviderId, type Snapshot, type UsageState } from "./model.ts";

const KEY = "subscription-usage";
export const UPDATE_EVENT = "subscription-usage:update";
export const REQUEST_EVENT = "subscription-usage:request";
const TICK_MS = 30_000;
const FRESH_MS = 5 * 60_000;
const CLAIM_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const BACKOFF_MS = [5, 10, 30].map((m) => m * 60_000);
const NOT_LOGGED_IN_MS = 30 * 60_000;

export interface UsageUpdate {
  render(width: number, paint: Paint): string | undefined;
  /** A footer that draws the line sets this during emit. */
  claimed: boolean;
}

export default function subscriptionUsage(pi: ExtensionAPI) {
  const cachePath = join(getAgentDir(), "state", "subscription-usage.json");
  const debug = process.env.PI_SUBSCRIPTION_USAGE_DEBUG
    ? (msg: string) => void appendFile(join(getAgentDir(), "state", "subscription-usage.log"), `${new Date().toISOString()} ${process.pid} ${msg}\n`).catch(() => {})
    : () => {};

  let ctx: ExtensionContext | undefined;
  let session: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: UsageState = {};
  let errors: Partial<Record<ProviderId, string>> = {};
  let busy = false;
  let statusText: string | undefined;
  const polling = new Set<ProviderId>();
  let writes: Promise<unknown> = Promise.resolve();

  const active = () => providerOfModel(ctx?.model?.provider);

  function publish() {
    const c = ctx;
    if (!c?.hasUI) return;
    const snapshot = state;
    const current = active();
    const update: UsageUpdate = {
      render: (width, paint) => renderUsage(snapshot, width, paint, current),
      claimed: false,
    };
    pi.events.emit(UPDATE_EVENT, update);
    const theme = c.ui.theme;
    const text = update.claimed ? undefined : renderTier(snapshot, "medium", (tone, s) => theme.fg(tone, s), current);
    if (text !== statusText) {
      statusText = text;
      c.ui.setStatus(KEY, text);
    }
  }

  function adopt(cache: CacheFile) {
    const next: UsageState = {};
    for (const id of PROVIDERS) {
      const merged = mergeSnapshot(state[id], cache.providers[id]?.snapshot);
      if (merged) next[id] = merged;
      const error = cache.providers[id]?.lastError;
      if (error) errors[id] = error; else delete errors[id];
    }
    state = next;
  }

  /** Serialise this process's cache writes so they do not overwrite each other. */
  function write(id: ProviderId, change: Parameters<typeof updateEntry>[2]): Promise<void> {
    const job = writes.then(() => updateEntry(cachePath, id, change)).then(
      (cache) => adopt(cache),
      (error) => debug(`cache write failed: ${error}`),
    );
    writes = job;
    return job;
  }

  function passive(id: ProviderId, snapshot: Snapshot | undefined) {
    if (!snapshot) return;
    state[id] = mergeSnapshot(state[id], snapshot);
    publish();
    void write(id, (entry) => storeSnapshot(entry, snapshot));
  }

  async function poll(id: ProviderId, force: boolean): Promise<void> {
    const c = ctx;
    const signal = session?.signal;
    if (!c || !signal || signal.aborted || polling.has(id)) return;
    polling.add(id);
    try {
      const now = Date.now();
      // Claim the poll in the shared file. Another process that sees the claim waits.
      let skip = false;
      await write(id, (entry) => {
        const age = entry.snapshot ? now - entry.snapshot.fetchedAt : Infinity;
        const blocked = (entry.nextPollAt ?? 0) > now;
        if (force ? blocked && entry.rateLimited : blocked || age < FRESH_MS) { skip = true; return; }
        entry.nextPollAt = now + CLAIM_MS;
      });
      if (skip || signal.aborted) return;
      debug(`poll ${id}${force ? " (forced)" : ""}`);

      const request = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      let snapshot: Snapshot | undefined;
      let failure: unknown;
      try {
        if (id === "claude") snapshot = await pollClaude(request);
        else {
          const auth = await c.modelRegistry.getProviderAuth("openai-codex").catch(() => undefined);
          snapshot = await pollCodex(auth?.auth.apiKey, request);
        }
      } catch (error) {
        failure = error;
      }
      if (signal.aborted) return;

      await write(id, (entry) => {
        if (snapshot) {
          storeSnapshot(entry, snapshot);
          delete entry.nextPollAt; delete entry.failures; delete entry.lastError; delete entry.rateLimited;
        } else if (!failure) {
          entry.nextPollAt = Date.now() + NOT_LOGGED_IN_MS;
          entry.lastError = "not logged in";
        } else {
          const status = failure instanceof UsageError ? failure.status : undefined;
          const failures = (entry.failures ?? 0) + 1;
          entry.failures = failures;
          entry.rateLimited = status === 429;
          entry.nextPollAt = Date.now() + (status === 429 ? BACKOFF_MS.at(-1)! : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]);
          entry.lastError = failure instanceof Error ? (failure.name === "TimeoutError" ? "timed out" : failure.message) : String(failure);
          debug(`poll ${id} failed: ${entry.lastError}`);
        }
      });
      publish();
    } catch (error) {
      debug(`poll ${id} crashed: ${error}`);
    } finally {
      polling.delete(id);
    }
  }

  async function tick() {
    try {
      adopt(await readCache(cachePath));
    } catch {}
    publish();
    // While a turn runs, its responses bring fresh data for the active provider.
    for (const id of PROVIDERS) if (!(busy && id === active())) void poll(id, false);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    session?.abort();
    session = undefined;
  }

  pi.on("session_start", (_event, c) => {
    stop();
    if (!c.hasUI) return;
    ctx = c;
    session = new AbortController();
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
    timer.unref();
  });

  pi.on("session_shutdown", (_event, c) => {
    stop();
    if (c.hasUI) c.ui.setStatus(KEY, undefined);
    statusText = undefined;
    ctx = undefined;
  });

  pi.on("agent_start", () => { busy = true; });
  pi.on("agent_end", () => { busy = false; });
  pi.on("model_select", () => publish());
  pi.events.on(REQUEST_EVENT, () => publish());

  pi.on("message_end", (event) => {
    try { passive("claude", claudeFromMessage(event.message)); } catch {}
  });
  pi.on("after_provider_response", (event) => {
    try { passive("codex", codexFromHeaders(event.headers)); } catch {}
  });

  pi.registerCommand("subscription-usage", {
    description: "Refresh Claude and ChatGPT subscription limits now and show details",
    handler: async (_args, c) => {
      if (!session) return;
      ctx = c;
      await Promise.all(PROVIDERS.map((id) => poll(id, true)));
      c.ui.notify(describe(state, errors), "info");
    },
  });
}
