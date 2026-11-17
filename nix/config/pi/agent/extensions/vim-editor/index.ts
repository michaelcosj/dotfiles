/**
 * Vim editor mode for pi's prompt, modelled on Claude Code's vim mode.
 *
 * - Starts in INSERT. Esc (or Ctrl+[, or an insert remap such as "jj") goes to
 *   NORMAL; Esc in NORMAL is pi's Esc (abort). Enter submits in both modes.
 * - Mode badge (I/N) at the right end of the editor's bottom border.
 * - Config: vim-editor/config.json ({ enabled, insertRemaps, clipboard }).
 * - /vim toggles vim mode and saves the choice.
 *
 * Child agents (agent-bridge) build their editor on VimEditor themselves, so
 * this extension leaves their editor alone.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reloadVimState, setEnabled, vimState } from "./config.ts";
import { VimEditor } from "./editor.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") reloadVimState();
    if (ctx.mode !== "tui" || process.env.PI_BRIDGE_PARENT) return;
    ctx.ui.setEditorComponent(
      (tui, theme, kb) =>
        new VimEditor(tui, theme, kb, { embedWorkingStatus: true, getTheme: () => ctx.ui.theme }),
    );
  });

  pi.registerCommand("vim", {
    description: "Toggle vim editor mode",
    handler: async (_args, ctx) => {
      const on = !vimState().enabled;
      setEnabled(on);
      ctx.ui.notify(`Vim mode ${on ? "on" : "off"}`, "info");
    },
  });
}
