import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

interface RtkGainSummary {
  total_commands: number;
  total_input: number;
  total_output: number;
  total_saved: number;
  avg_savings_pct: number;
  total_time_ms: number;
  avg_time_ms: number;
}

interface RtkGainResult {
  summary: RtkGainSummary;
}

const GAIN_POLL_INTERVAL_MS = 10_000; // debounce: only poll gain stats every 10s

export function registerRtkExtension(pi: ExtensionAPI) {
  let rtkAvailable: boolean | null = null;
  let rtkAvailablePromise: Promise<boolean> | null = null;
  let uiCtx: ExtensionContext | null = null;
  let lastGainUpdateMs = 0;

  pi.on("session_start", async (_event, ctx) => {
    uiCtx = ctx;
    lastGainUpdateMs = 0;
    await updateGainStatus();
  });

  pi.on("session_shutdown", () => {
    uiCtx = null;
  });

  async function checkRtk(): Promise<boolean> {
    // Return cached value if already resolved
    if (rtkAvailable !== null) return rtkAvailable;

    // If already checking, return the in-flight promise
    if (rtkAvailablePromise) return rtkAvailablePromise;

    rtkAvailablePromise = (async () => {
      try {
        const result = await pi.exec("which", ["rtk"]);
        rtkAvailable = result.code === 0;
      } catch {
        rtkAvailable = false;
      } finally {
        rtkAvailablePromise = null;
      }
      return rtkAvailable;
    })();

    return rtkAvailablePromise;
  }

  async function updateGainStatus(): Promise<void> {
    if (!uiCtx) return;

    // Debounce: skip if updated recently
    const now = Date.now();
    if (now - lastGainUpdateMs < GAIN_POLL_INTERVAL_MS) return;
    lastGainUpdateMs = now;

    if (!(await checkRtk())) {
      uiCtx.ui.setStatus("rtk", "RTK: not installed");
      return;
    }

    try {
      const result = await pi.exec("rtk", ["gain", "-p", "-f", "json"]);
      if (result.code === 0 && result.stdout) {
        const data = JSON.parse(result.stdout) as RtkGainResult;
        const pct = data.summary.avg_savings_pct.toFixed(1);
        uiCtx.ui.setStatus("rtk", `rtk(${pct}%)`);
      }
    } catch {
      uiCtx.ui.setStatus("rtk", "rtk active");
    }
  }

  // Update status after bash tool finishes (debounced)
  pi.on("tool_execution_end", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    await updateGainStatus();
  });

  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!(await checkRtk())) return;

    const command = event.input.command;
    if (!command) return;

    try {
      const rewriteResult = await pi.exec("rtk", ["rewrite", command]);
      const rewritten = rewriteResult.stdout.trim();
      if (rewritten && rewritten !== command) {
        event.input.command = rewritten;
      }
    } catch {
      // rtk rewrite failed — pass through unchanged
    }
  });
}
