import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm } from "@mariozechner/pi-coding-agent";
import { compile, type FileOps } from "./vcc-core.js";

// ── Compaction stats ──

export interface CompactionStats {
  summarized: number;
  kept: number;
  keptTokensEst: number;
}

let lastStats: CompactionStats | null = null;

export const getLastCompactionStats = () => lastStats;

const formatTokens = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

// ── Own cut logic (ported from pi-vcc) ──

interface EntryWithMessage {
  entry: { id: string; type: string };
  message: { role: string; content: unknown };
}

export type OwnCutCancelReason =
  | "no_live_messages"
  | "too_few_live_messages"
  | "no_user_message";

export type OwnCutResult =
  | { ok: true; messages: any[]; firstKeptEntryId: string; compactAll: boolean }
  | { ok: false; reason: OwnCutCancelReason };

export function buildOwnCut(branchEntries: any[]): OwnCutResult {
  let lastCompactionIdx = -1;
  let lastKeptId: string | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (branchEntries[i].type === "compaction") {
      lastCompactionIdx = i;
      lastKeptId = branchEntries[i].firstKeptEntryId;
      break;
    }
  }

  const hasPriorCompaction = lastCompactionIdx >= 0;
  const hasValidKeptId = !!lastKeptId && branchEntries.some((e: any) => e.id === lastKeptId);
  const orphanRecovery = hasPriorCompaction && !hasValidKeptId;

  const liveMessages: EntryWithMessage[] = [];
  if (orphanRecovery) {
    for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
      const e = branchEntries[i];
      if (e.type === "compaction") continue;
      if (e.type === "message" && e.message) liveMessages.push({ entry: e, message: e.message });
    }
  } else {
    let foundKept = !lastKeptId;
    for (const e of branchEntries) {
      if (!foundKept && e.id === lastKeptId) foundKept = true;
      if (!foundKept) continue;
      if (e.type === "compaction") continue;
      if (e.type === "message" && e.message) liveMessages.push({ entry: e, message: e.message });
    }
  }

  if (liveMessages.length === 0) return { ok: false, reason: "no_live_messages" };
  if (liveMessages.length <= 2) return { ok: false, reason: "too_few_live_messages" };

  let cutIdx = liveMessages.length - 1;
  while (cutIdx > 0 && liveMessages[cutIdx].message.role !== "user") {
    cutIdx--;
  }

  if (cutIdx <= 0) {
    const hasUser = liveMessages.some((m) => m.message.role === "user");
    if (!hasUser) return { ok: false, reason: "no_user_message" };
    // Compact all: use the first message's entry ID so `firstKeptEntryId` is valid.
    // Pi expects a real entry ID; empty string would be invalid.
    const firstEntryId = liveMessages[0].entry.id;
    return {
      ok: true,
      messages: liveMessages.map((e) => e.message),
      firstKeptEntryId: firstEntryId,
      compactAll: true,
    };
  }

  return {
    ok: true,
    messages: liveMessages.slice(0, cutIdx).map((e) => e.message),
    firstKeptEntryId: liveMessages[cutIdx].entry.id,
    compactAll: false,
  };
}

// ── Register compaction system ──

export function registerVccCompactExtension(pi: ExtensionAPI) {
  // 1) Hook: custom VCC summary for all compactions handled by Pi.
  pi.on("session_before_compact", async (event) => {
    const { preparation, branchEntries } = event;

    const ownCut = buildOwnCut(branchEntries as any[]);
    if (!ownCut.ok) {
      // Nothing to compact — let Pi handle the cancellation message
      return { cancel: true };
    }

    const agentMessages = ownCut.messages;
    const firstKeptEntryId = ownCut.firstKeptEntryId;

    // Count kept messages for stats
    const keptIdx = (branchEntries as any[]).findIndex((e: any) => e.id === firstKeptEntryId);
    const keptEntries = keptIdx >= 0
      ? (branchEntries as any[]).slice(keptIdx).filter((e: any) => e.type === "message")
      : [];
    const keptChars = keptEntries.reduce((sum: number, e: any) => {
      const c = e.message?.content;
      if (typeof c === "string") return sum + c.length;
      if (Array.isArray(c)) {
        return sum + c.reduce((s: number, p: any) => {
          if (p.text) return s + p.text.length;
          if (p.type === "toolCall") return s + (p.name?.length ?? 0) + JSON.stringify(p.input ?? "").length;
          if (p.type === "toolResult") return s + (typeof p.content === "string" ? p.content.length : JSON.stringify(p.content ?? "").length);
          return s;
        }, 0);
      }
      return sum;
    }, 0);

    lastStats = {
      summarized: agentMessages.length,
      kept: keptEntries.length,
      keptTokensEst: Math.round(keptChars / 4),
    };

    const messages = convertToLlm(agentMessages);
    const summary = compile({
      messages,
      previousSummary: preparation.previousSummary,
      fileOps: {
        readFiles: [...preparation.fileOps.read],
        modifiedFiles: [...preparation.fileOps.written, ...preparation.fileOps.edited],
      },
    });

    return {
      compaction: {
        summary,
        firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
        details: { compactor: "vcc", version: 1 },
      },
    };
  });

  // 2) session_compact toast for VCC compactions
  pi.on("session_compact", (event, ctx) => {
    if (!event.fromExtension) return;
    const stats = lastStats;
    if (!stats) return;
    setTimeout(() => {
      try {
        ctx?.ui?.notify?.(
          `vcc: ${stats.summarized} entries summarized; tail kept ${stats.kept} (~${formatTokens(stats.keptTokensEst)} tok).`,
          "info",
        );
      } catch {}
    }, 500);
  });

}
