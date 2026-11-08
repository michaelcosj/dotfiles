/** Pi's footer with a shorter stats line: cache hit rate, cost, context use,
 * and provider/model. The directory and extension status lines are unchanged.
 */
import { isAbsolute, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function directory(cwd: string): string {
  const home = process.env.HOME;
  if (!home) return cwd;
  const rel = relative(home, cwd);
  if (rel === "") return "~";
  return rel.startsWith("..") || isAbsolute(rel) ? cwd : `~${sep}${rel}`;
}

const oneLine = (text: string) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      // Totals scan the whole session; recount only when it grows or moves.
      let key = "";
      let stats = { cost: 0, cacheHit: undefined as number | undefined };

      function sessionStats() {
        const sm = ctx.sessionManager;
        const next = `${sm.getSessionId()}:${sm.getLeafId()}:${sm.getEntries().length}`;
        if (next === key) return stats;
        key = next;
        let cost = 0;
        let cacheHit: number | undefined;
        for (const entry of sm.getEntries()) {
          const usage =
            entry.type === "usage" || entry.type === "branch_summary" || entry.type === "compaction"
              ? (entry as { usage?: { cost: { total: number } } }).usage
              : entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
                ? (entry.message as { usage?: { input: number; cacheRead: number; cacheWrite: number; cost: { total: number } } }).usage
                : undefined;
          if (!usage) continue;
          cost += usage.cost.total;
          if (entry.type === "message" && entry.message.role === "assistant") {
            const u = usage as { input: number; cacheRead: number; cacheWrite: number };
            const prompt = u.input + u.cacheRead + u.cacheWrite;
            cacheHit = prompt > 0 ? (u.cacheRead / prompt) * 100 : undefined;
          }
        }
        stats = { cost, cacheHit };
        return stats;
      }

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const dim = (s: string) => theme.fg("dim", s);
          let pwd = directory(ctx.sessionManager.getCwd());
          const branch = footerData.getGitBranch();
          if (branch) pwd += ` (${branch})`;
          const name = ctx.sessionManager.getSessionName();
          if (name) pwd += ` • ${name}`;

          const { cost, cacheHit } = sessionStats();
          const model = ctx.model;
          const left: string[] = [];
          if (cacheHit !== undefined) left.push(dim(`CH ${cacheHit.toFixed(0)}%`));
          const subscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
          if (cost || subscription) left.push(dim(`$${cost.toFixed(2)}${subscription ? " (sub)" : ""}`));

          const usage = ctx.getContextUsage();
          const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
          const percent = usage?.percent;
          const context = `${percent == null ? "?" : percent.toFixed(0)}%/${tokens(window)}`;
          left.push(
            percent != null && percent > 90 ? theme.fg("error", context)
              : percent != null && percent > 70 ? theme.fg("warning", context)
                : dim(context),
          );

          let right = model ? `${model.provider}/${model.id}` : "no model";
          const level = pi.getThinkingLevel();
          if (model?.reasoning && level !== "off") right += ` • ${level}`;
          right = dim(right);

          const leftText = left.join(dim(" · "));
          const room = width - visibleWidth(leftText) - 2;
          let stats = truncateToWidth(leftText, width, "");
          if (room > 0) {
            const fitted = truncateToWidth(right, room, "");
            stats = leftText + " ".repeat(width - visibleWidth(leftText) - visibleWidth(fitted)) + fitted;
          }

          const lines = [truncateToWidth(dim(pwd), width, dim("...")), truncateToWidth(stats, width, "")];
          const statuses = [...footerData.getExtensionStatuses().entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => oneLine(text));
          if (statuses.length) lines.push(truncateToWidth(statuses.join(" "), width, dim("...")));
          return lines;
        },
      };
    });
  });
}
