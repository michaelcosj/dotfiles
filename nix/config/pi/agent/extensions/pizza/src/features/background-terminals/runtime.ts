import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createDeferredResultDelivery } from "../../shared/deferred-result-delivery.js";
import {
  buildTerminalResultMessage,
} from "./prompt.js";
import {
  createTerminalManager,
  type TerminalCommandPort,
  type TerminalManagerShape,
  type TerminalReadModel,
} from "./manager.js";
import type { TerminalSnapshot } from "./state.js";

export const BACKGROUND_TERMINAL_WIDGET_KEY = "background-terminals";

export interface BackgroundTerminalRuntimeOptions {
  createManager?: () => TerminalManagerShape;
}

export interface BackgroundTerminalRuntime {
  readonly delivery: ReturnType<
    typeof createDeferredResultDelivery<TerminalSnapshot>
  >;
  getManager(): TerminalManagerShape;
  getQuery(): TerminalReadModel;
  getCommands(): TerminalCommandPort;
  getContext(): ExtensionContext | undefined;
  setSessionContext(context: ExtensionContext): void;
  flush(): void;
  shutdown(): Promise<void>;
}

export function createBackgroundTerminalRuntime(
  pi: ExtensionAPI,
  options: BackgroundTerminalRuntimeOptions = {},
): BackgroundTerminalRuntime {
  let manager: TerminalManagerShape | undefined;
  let sessionContext: ExtensionContext | undefined;
  let ui: ExtensionUIContext | undefined;
  let unsubscribeStatus: (() => void) | undefined;
  let widgetRunning = 0;
  let shuttingDown = false;
  const delivery = createDeferredResultDelivery<TerminalSnapshot>();

  const updateWidget = (current: TerminalManagerShape) => {
    if (!ui) return;
    try {
      const running = current.view.runningCount();
      if (running === widgetRunning) return;
      widgetRunning = running;
      if (running === 0) {
        ui.setWidget(BACKGROUND_TERMINAL_WIDGET_KEY, undefined);
        return;
      }
      ui.setWidget(BACKGROUND_TERMINAL_WIDGET_KEY, (_tui, theme) => {
        const line =
          theme.fg("warning", "■ ") +
          theme.fg(
            "text",
            `${running} background terminal${running === 1 ? "" : "s"} running`,
          ) +
          theme.fg("dim", " • ") +
          theme.fg("accent", "/ps") +
          theme.fg("dim", " to view");
        return { render: () => [line], invalidate: () => {} };
      });
    } catch {
      // UI may be unavailable during print mode or session teardown.
    }
  };

  const deliverResult = (snapshot: TerminalSnapshot) => {
    // Pi 0.83 intentionally exposes sendMessage as fire-and-forget. Delivery
    // failures are reported by Pi and cannot be acknowledged by extensions.
    pi.sendMessage(
      {
        customType: "background-terminal-result",
        content: buildTerminalResultMessage(snapshot),
        display: true,
        details: {
          id: snapshot.id,
          title: snapshot.title,
          status: snapshot.status,
          exitCode: snapshot.exitCode,
          signal: snapshot.signal,
        },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const flushResults = () => {
    for (const claim of delivery.takeAll()) deliverResult(claim.result);
  };

  const onSettled = (snapshot: TerminalSnapshot, consumed: boolean) => {
    if (shuttingDown) return;
    if (consumed) {
      delivery.consume([snapshot.id]);
      return;
    }
    // Output views continue to be updated until the process/log streams close.
    // Claim a detached snapshot so a later flush sees the settled bytes.
    delivery.defer({
      ...snapshot,
      stdout: { ...snapshot.stdout },
      stderr: { ...snapshot.stderr },
    });
    if (sessionContext?.isIdle()) flushResults();
  };

  const getManager = () => {
    if (!manager) {
      manager = options.createManager?.() ?? createTerminalManager();
      manager.setOnSettled(onSettled);
      unsubscribeStatus = manager.view.subscribe(() => updateWidget(manager!));
      updateWidget(manager);
    }
    return manager;
  };

  return {
    delivery,
    getManager,
    getQuery: () => getManager().view,
    getCommands: () => getManager().commands,
    getContext: () => sessionContext,
    setSessionContext(context) {
      sessionContext = context;
      ui = context.hasUI ? context.ui : undefined;
    },
    flush: flushResults,
    async shutdown() {
      shuttingDown = true;
      sessionContext = undefined;
      unsubscribeStatus?.();
      unsubscribeStatus = undefined;
      try {
        ui?.setWidget(BACKGROUND_TERMINAL_WIDGET_KEY, undefined);
      } catch {
        // UI may already be gone.
      }
      widgetRunning = 0;
      ui = undefined;
      const closing = manager;
      manager = undefined;
      // Disable the manager callback before disposal: killing a running process
      // settles it synchronously/asynchronously during disposeAll.
      closing?.setOnSettled(() => {});
      delivery.clear();
      try {
        await closing?.disposeAll();
      } finally {
        shuttingDown = false;
      }
    },
  };
}
