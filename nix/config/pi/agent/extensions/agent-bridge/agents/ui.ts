// The agent list below the editor, in the parent and in every child, and
// in-place switching: the selected agent's Rex block takes this pane's
// place, and this one is detached (it keeps running).
//
// An agent on another Rex host can't be swapped in: selecting it switches the
// Rex app to its host's session instead (the parent does it, see view()).
//
// Keys: ↓ on an empty prompt enters the list; ↑/↓ select; Enter switches;
// Esc (or any other key) leaves the list. /agents does the same from a menu.
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as rex from "../../lib/rex.js";
import { duration } from "./parent.js";
import type { Roster, RosterEntry } from "./protocol.js";

const WIDGET = "agents";

interface Row {
  name: string;
  title: string;
  block: string;
  entry?: RosterEntry; // undefined for main
}

/** "https://devbox-m.danio-wezen.ts.net" → "devbox-m": the scheme and domain go. */
export function shortHost(host: string) {
  const bare = host.replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "");
  return /^[\d.]+$/.test(bare) ? bare : bare.split(".")[0] || host;
}

function tokens(n?: number) {
  if (n == null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
}

export function registerAgentsUI(
  pi: any,
  opts: {
    /** this pi's name in the roster ("main" for the parent) */
    self: string;
    /** called after this pi swapped `block` into view */
    onSwitched: (block: string) => void;
    /** this pi's own context tokens, for the main row (parent only) */
    selfTokens?: () => number | undefined;
    /** stopped children that can be reopened (parent only) */
    resumable?: () => { name: string; title: string }[];
    resume?: (name: string) => Promise<unknown>;
    /** shows a row that can't be swapped into this pane (another machine's) */
    switchRemote?: (name: string) => Promise<unknown> | void;
    /** this pi runs on another host, so no row can be swapped in here */
    remote?: boolean;
  },
) {
  let roster: Roster | undefined;
  let ctxRef: any;
  let selected: number | undefined; // index into rows() while the list has focus
  let tick: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let switching = false;
  let dialogs = 0; // open dialogs (questionnaire, select, ...) own the keys

  const rows = (): Row[] =>
    roster
      ? [
          { name: "main", title: "", block: roster.main },
          ...roster.agents.map((a) => ({ name: a.name, title: a.title, block: a.block, entry: a })),
        ]
      : [];

  const render = () => {
    const ui = ctxRef?.ui;
    if (!ui || ctxRef.mode !== "tui") return;
    if (!roster || roster.agents.length === 0) {
      ui.setWidget(WIDGET, undefined);
      selected = undefined;
      return;
    }
    ui.setWidget(
      WIDGET,
      (_tui: any, theme: any) => ({
        invalidate() {},
        render(width: number) {
          const list = rows();
          const lines: string[] = [];
          list.forEach((r, i) => {
            const here = r.block === rex.REX_BLOCK;
            const focus = selected === i;
            const e = r.entry;
            let mark = here ? theme.fg("accent", "●") : theme.fg("dim", "○");
            if (e?.status === "blocked") mark = theme.fg("warning", "⚠");
            else if (e?.status === "crashed") mark = theme.fg("error", "✗");
            else if (e?.status === "working" || e?.status === "starting") mark = here ? mark : theme.fg("success", "◌");
            const nameText = focus ? theme.bold(theme.fg("accent", r.name)) : here ? theme.bold(r.name) : theme.fg("muted", r.name);
            const ms = e?.runStartedAt ? Date.now() - e.runStartedAt : e?.runMs;
            const tk = e ? e.tokens : opts.self === "main" ? opts.selfTokens?.() : undefined;
            const right = [ms != null ? duration(ms) : "", tokens(tk) ? `↓ ${tokens(tk)}` : ""].filter(Boolean).join(" · ");
            const rightText = focus || here ? right : theme.fg("dim", right);
            // Narrow panes: drop the title first, then shorten the host to its
            // first name ("rex" for rex.danio-wezen.ts.net).
            const build = (title: boolean, host: "full" | "short") => {
              let s = `${focus ? theme.fg("accent", "› ") : "  "}${mark} ${nameText}`;
              if (e?.host) s += theme.fg("dim", `@${host === "full" ? e.host : shortHost(e.host)}`);
              if (title && r.title && r.title !== r.name) s += `  ${focus || here ? r.title : theme.fg("dim", r.title)}`;
              if (e?.status === "blocked") s += theme.fg("warning", "  needs an answer");
              return s;
            };
            const fits = (s: string) => visibleWidth(s) + visibleWidth(right) + 3 <= width;
            const left = [build(true, "full"), build(false, "full"), build(false, "short")].find(fits) ?? build(false, "short");
            const gap = width - visibleWidth(left) - visibleWidth(right) - 1;
            lines.push(truncateToWidth(gap > 1 ? left + " ".repeat(gap) + rightText : left, width));
          });
          if (selected !== undefined) lines.push(theme.fg("dim", "  ↑↓ select · enter switch · esc back"));
          // A blank line keeps the list apart from the footer below it.
          lines.push("");
          return lines;
        },
      }),
      { placement: "belowEditor" },
    );
  };

  async function switchTo(row: Row) {
    if (switching || row.block === rex.REX_BLOCK) return;
    switching = true;
    try {
      if (opts.remote || row.entry?.host) await opts.switchRemote?.(row.name);
      else {
        await rex.swap(rex.REX_BLOCK!, row.block);
        opts.onSwitched(row.block);
      }
    } catch (e) {
      ctxRef?.ui?.notify?.(`Could not switch to ${row.name}: ${(e as Error).message}`, "error");
    } finally {
      switching = false;
    }
  }

  function onInput(data: string) {
    const list = rows();
    if (list.length < 2) return undefined;
    if (dialogs > 0) {
      if (selected !== undefined) {
        selected = undefined;
        render();
      }
      return undefined;
    }
    // Kitty keyboard protocol sends releases too; act on presses only.
    if (isKeyRelease(data)) return selected === undefined ? undefined : { consume: true };
    if (selected === undefined) {
      if (matchesKey(data, "down") && ctxRef?.ui?.getEditorText?.() === "") {
        const here = list.findIndex((r) => r.block === rex.REX_BLOCK);
        selected = (here + 1) % list.length;
        render();
        return { consume: true };
      }
      return undefined;
    }
    if (matchesKey(data, "up")) {
      selected = selected === 0 ? undefined : selected - 1;
    } else if (matchesKey(data, "down")) {
      selected = Math.min(list.length - 1, selected + 1);
    } else if (matchesKey(data, "enter")) {
      const row = list[selected];
      selected = undefined;
      render();
      if (row) void switchTo(row);
      return { consume: true };
    } else if (matchesKey(data, "escape")) {
      selected = undefined;
    } else {
      selected = undefined;
      render();
      return undefined; // leave the list and type as usual
    }
    render();
    return { consume: true };
  }

  pi.on("session_start", (_e: any, ctx: any) => {
    ctxRef = ctx;
    if (ctx.mode !== "tui") return;
    unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput(onInput);
    // Elapsed times move while anyone works.
    tick ??= setInterval(() => {
      if (roster?.agents.some((a) => a.runStartedAt)) render();
    }, 1000);
    tick.unref?.();
    render();
  });
  pi.on("ui_prompt_start", () => {
    dialogs++;
  });
  pi.on("ui_prompt_end", () => {
    dialogs = Math.max(0, dialogs - 1);
  });
  pi.on("session_shutdown", () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (tick) clearInterval(tick);
    tick = undefined;
    ctxRef?.ui?.setWidget?.(WIDGET, undefined);
  });

  pi.registerCommand("agents", {
    description: "Switch to the main session or a child agent, or resume a stopped one",
    handler: async (_args: string, ctx: any) => {
      const list = rows();
      const stopped = opts.resumable?.() ?? [];
      if (list.length < 2 && !stopped.length) return ctx.ui.notify("No child agents.", "info");
      const labels = list.length < 2 ? [] : list.map((r) => {
        const here = r.block === rex.REX_BLOCK ? " (here)" : "";
        const st = r.entry ? ` [${r.entry.status}]` : "";
        return `${r.name}${r.entry?.host ? `@${r.entry.host}` : ""}${r.title && r.title !== r.name ? ` — ${r.title}` : ""}${st}${here}`;
      });
      const resumeLabels = stopped.map((d) => `resume ${d.name}${d.title && d.title !== d.name ? ` — ${d.title}` : ""} [stopped]`);
      const pick = await ctx.ui.select("Agents", [...labels, ...resumeLabels]);
      if (pick === undefined) return;
      const i = labels.indexOf(pick);
      if (i >= 0) return switchTo(list[i]);
      const d = stopped[resumeLabels.indexOf(pick)];
      try {
        await opts.resume?.(d.name);
        ctx.ui.notify(`Resumed ${d.name}. It is idle; ↓ on an empty prompt to switch to it.`, "info");
      } catch (e) {
        ctx.ui.notify(`Could not resume ${d.name}: ${(e as Error).message}`, "error");
      }
    },
  });

  return {
    setRoster(r: Roster) {
      roster = r;
      if (selected !== undefined && selected >= rows().length) selected = undefined;
      render();
    },
  };
}

/** A child's editor: "Message @name…" when empty, and its title in the top border. */
export function childEditor(pi: any, name: string, title: string) {
  pi.on("session_start", (_e: any, ctx: any) => {
    if (ctx.mode !== "tui") return;
    const theme = ctx.ui.theme;
    class ChildEditor extends CustomEditor {
      render(width: number): string[] {
        const lines = super.render(width);
        if (this.getText() === "" && lines.length >= 2) {
          // Line 1 is the empty input row; keep its cursor marker, add the hint.
          const hint = theme.fg("dim", `Message @${name}…`);
          lines[1] = truncateToWidth(lines[1].replace(/\s+$/, "") + " " + hint, width);
        }
        return lines;
      }
      protected renderTopBorder(w: number, hidden: number): string {
        const base = super.renderTopBorder(w, hidden);
        const label = ` ${title} `;
        // Keep pi's border while it shows the working spinner or a scroll mark.
        if (hidden > 0 || w < visibleWidth(label) + 6 || base !== this.borderColor("─".repeat(w))) return base;
        // Replace the right end of the plain border with the label.
        return this.borderColor("─".repeat(w - visibleWidth(label) - 2)) + theme.inverse(theme.fg("accent", label)) + this.borderColor("──");
      }
    }
    ctx.ui.setEditorComponent((tui: any, t: any, kb: any) => new ChildEditor(tui, t, kb, { embedWorkingStatus: true }));
  });
}
