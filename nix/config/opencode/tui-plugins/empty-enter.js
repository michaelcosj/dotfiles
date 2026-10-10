import { Plugin } from "@opencode-ai/plugin/tui";

export default Plugin.define({
  id: "empty-enter.tui",
  setup(ctx) {
    ctx.keymap.layer(() => ({
      priority: 10,
      commands: [
        {
          id: "empty-enter.continue",
          title: "Continue session from empty prompt",
          bind: "return",
          run() {
            const editor = ctx.renderer.currentFocusedEditor;
            const route = ctx.ui.router.current();
            // OpenCode marks its composer with these OpenTUI traits.
            if (
              !editor?.focused ||
              editor.isDestroyed ||
              editor.traits?.owner !== "opencode" ||
              editor.traits?.role !== "prompt" ||
              editor.traits?.status === "SHELL" ||
              editor.traits?.suspend ||
              editor.traits?.capture?.includes("submit") ||
              editor.plainText !== "" ||
              route.type !== "session" ||
              ctx.data.session.status(route.sessionID) !== "idle" ||
              !ctx.data.session.message.list(route.sessionID)?.length
            ) {
              return false;
            }

            editor.insertText("Continue");
            ctx.keymap.dispatch("prompt.submit");
          },
        },
      ],
    }));
  },
});
