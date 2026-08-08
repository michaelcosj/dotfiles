import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installSubagentEditorNavigation } from "./ui/agent-editor.js";
import { openSubagentTakeover } from "./ui/takeover.js";
import type { SubagentRuntime } from "./runtime.js";

/**
 * Session lifecycle is kept separate from tool registration so child managers
 * are created only when a session/UI path actually needs them.
 */
export function registerSubagentLifecycle(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
) {
  let editorNavigation: { dispose(): void } | undefined;
  let pendingEditorContext: ExtensionContext | undefined;

  pi.on("session_start", (_event, context) => {
    runtime.setSessionContext(context);
    editorNavigation?.dispose();
    editorNavigation = undefined;
    pendingEditorContext =
      context.mode === "tui" && runtime.config.editorNavigation
        ? context
        : undefined;
  });

  // resources_discover runs after session_start handlers. Wrapping here makes
  // the child rows compose with whichever editor factory won startup.
  pi.on("resources_discover", (_event, context) => {
    const pending = pendingEditorContext;
    if (!pending || pending !== runtime.getContext() || context.mode !== "tui") {
      return;
    }
    pendingEditorContext = undefined;
    const manager = runtime.getManager();
    editorNavigation = installSubagentEditorNavigation(context, manager.view, {
      onOpen: (snapshot) =>
        openSubagentTakeover(
          context,
          manager.view,
          runtime.getCommands(),
          snapshot.id,
        ),
    });
  });

  pi.on("agent_settled", () => runtime.flush());

  pi.on("session_shutdown", async () => {
    pendingEditorContext = undefined;
    editorNavigation?.dispose();
    editorNavigation = undefined;
    await runtime.shutdown();
  });
}
