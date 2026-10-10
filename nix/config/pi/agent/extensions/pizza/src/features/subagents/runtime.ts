import fs from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createChildSession } from "./child-session.js";
import {
  createHerdrChildSession,
  focusHerdrTab,
  isHerdrAvailable,
} from "./herdr-child-session.js";
import {
  createSubagentManager,
  type SubagentCommandPort,
  type SubagentManager,
  type SubagentReadModel,
} from "./manager.js";
import {
  sameSettlement,
  subagentResultDetails,
  subagentResultText,
  tail,
} from "./presenters.js";
import { createDeferredResultDelivery } from "../../shared/deferred-result-delivery.js";
import { resolveChildCwd } from "./trust.js";
import {
  REASONING_EFFORTS,
  type ReasoningEffort,
  type SpawnTask,
  type SubagentEvent,
  type SubagentHandoff,
  type SubagentOrigin,
  type SubagentSnapshot,
} from "./state.js";
import { sanitizeText } from "./ui/transcript.js";

export interface SubagentConfig {
  enabled: boolean;
  automaticResultDelivery: boolean;
  btw: boolean;
  editorNavigation: boolean;
  resultCards: boolean;
}

export function loadSubagentConfig(): SubagentConfig {
  try {
    return {
      enabled: true,
      automaticResultDelivery: true,
      btw: true,
      editorNavigation: true,
      resultCards: true,
      ...JSON.parse(
        fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"),
      ),
    };
  } catch {
    return {
      enabled: true,
      automaticResultDelivery: true,
      btw: true,
      editorNavigation: true,
      resultCards: true,
    };
  }
}

export interface SubagentRegistrationOptions {
  getInheritedActiveTools?: () => string[] | undefined;
  createManager?: () => SubagentManager;
}

export interface SpawnParameters {
  prompt: string;
  name: string;
  working_dir?: string;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  context?: SubagentHandoff;
  fork_parent?: boolean;
}

export interface SubagentRuntime {
  readonly config: SubagentConfig;
  readonly delivery: ReturnType<typeof createDeferredResultDelivery<SubagentSnapshot>>;
  getManager(): SubagentManager;
  getQuery(): SubagentReadModel;
  getCommands(): SubagentCommandPort;
  getContext(): ExtensionContext | undefined;
  getUi(): ExtensionUIContext | undefined;
  setSessionContext(context: ExtensionContext): void;
  clearSessionContext(): void;
  createTask(
    params: SpawnParameters,
    context: ExtensionContext,
    origin?: SubagentOrigin,
  ): Promise<SpawnTask>;
  flush(): void;
  shutdown(options?: { preserveForReload?: boolean }): Promise<void>;
}

const managerCache: Map<string, SubagentManager> =
  ((globalThis as any).__pizzaSubagentManagers ??= new Map());

export function createSubagentRuntime(
  pi: ExtensionAPI,
  options: SubagentRegistrationOptions = {},
  config = loadSubagentConfig(),
): SubagentRuntime {
  let manager: SubagentManager | undefined;
  let context: ExtensionContext | undefined;
  let ui: ExtensionUIContext | undefined;
  let unsubscribe: (() => void) | undefined;
  const delivery = createDeferredResultDelivery<SubagentSnapshot>();

  const updateStatus = () => {
    if (!ui || !manager) return;
    const snapshots = manager.list();
    const running = snapshots.filter((snapshot) => snapshot.status === "running").length;
    ui.setStatus(
      "subagents",
      snapshots.length ? `subagents ${running}/${snapshots.length}` : undefined,
    );
  };

  const deliver = (snapshot: SubagentSnapshot, max = 48 * 1024) => {
    pi.sendMessage(
      {
        customType: "subagent-result",
        content: subagentResultText(snapshot, max),
        display: true,
        details: subagentResultDetails(snapshot),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const flush = () => {
    const ready = delivery.takeAll();
    const share = Math.max(1024, Math.floor(48 * 1024 / Math.max(1, ready.length)));
    // Pi 0.83 exposes sendMessage as fire-and-forget. Pi reports asynchronous
    // delivery failures; extensions receive no acknowledgement to retry.
    for (const claim of ready) deliver(claim.result, share);
  };

  const onSettled = (snapshot: SubagentSnapshot) => {
    if (!context) return;
    if (snapshot.origin === "btw") {
      pi.appendEntry("btw-result", {
        id: snapshot.id,
        title: snapshot.title,
        status: snapshot.status,
        prompt: snapshot.prompt,
        answer: tail(snapshot.finalText),
        sessionFilePath: snapshot.meta.sessionFilePath,
      });
      ui?.notify(
        `by the way “${snapshot.title}” ${snapshot.status === "done" ? "answered" : "failed"}`,
        snapshot.status === "done" ? "info" : "error",
      );
      return;
    }
    if (config.automaticResultDelivery) {
      delivery.defer(snapshot);
      if (context.isIdle()) flush();
    }
  };

  const getManager = () => {
    if (!manager) {
      const sessionKey = context?.sessionManager?.getSessionFile();
      const currentFactory = (task: SpawnTask) => {
        if (isHerdrAvailable()) {
          return createHerdrChildSession(task);
        }
        const registry = context?.modelRegistry;
        if (!registry) throw new Error("Parent model registry unavailable.");
        return createChildSession(task, { modelRegistry: registry });
      };
      const cached = sessionKey && managerCache.get(sessionKey);
      const reusable = cached && typeof cached.setFactory === "function"
        ? cached
        : undefined;
      // One-time migration from managers cached by an older extension build.
      // Their closed-over factory cannot be replaced, so detach them and start
      // a current-generation manager rather than crashing or spawning stale children.
      if (cached && !reusable) {
        if (sessionKey) managerCache.delete(sessionKey);
        void cached.disposeAll().catch(() => {});
      }
      manager = reusable ?? options.createManager?.() ??
        createSubagentManager(currentFactory);
      // A manager preserved across /reload retains entries, but all future
      // children must use this extension generation's implementation.
      reusable?.setFactory(currentFactory);
      if (sessionKey) managerCache.set(sessionKey, manager);
      manager.setOnSettled(onSettled);
      unsubscribe = manager.view.subscribe(updateStatus);
      updateStatus();
    }
    return manager;
  };

  return {
    config,
    delivery,
    getManager,
    getQuery: () => getManager().view,
    getCommands: () => {
      const current = getManager();
      return {
        requestSend: (id: string, text: string) => current.send(id, text),
        requestAbort: async (id: string) => {
          await current.cancel([id]);
        },
        requestOpen: async (id: string) => {
          const tabId = current.get(id)?.meta.herdrTabId;
          if (!tabId) return false;
          await focusHerdrTab(tabId);
          return true;
        },
      };
    },
    getContext: () => context,
    getUi: () => ui,
    setSessionContext(next) {
      context = next;
      ui = next.hasUI ? next.ui : undefined;
    },
    clearSessionContext() {
      context = undefined;
      ui = undefined;
    },
    async createTask(params, currentContext, origin = "model") {
      const resolved = await resolveChildCwd(
        params.working_dir,
        currentContext.cwd,
        currentContext.isProjectTrusted(),
      );
      const forkParent = origin === "btw" || params.fork_parent === true;
      const parentSessionFile = currentContext.sessionManager?.getSessionFile();
      if (forkParent && !parentSessionFile) {
        throw new Error("Cannot fork an ephemeral or unsaved parent session");
      }
      return {
        prompt: params.prompt,
        context: params.context,
        forkParent,
        title:
          sanitizeText(params.name).replace(/\s+/g, " ").trim().slice(0, 80) ||
          "subagent",
        cwd: resolved.cwd,
        model: params.model,
        reasoningEffort: params.reasoning_effort,
        origin,
        parent: {
          parentCwd: currentContext.cwd,
          projectTrusted: resolved.projectTrusted,
          inheritedModel: currentContext.model
            ? { provider: currentContext.model.provider, id: currentContext.model.id }
            : undefined,
          inheritedThinkingLevel: pi.getThinkingLevel(),
          activeTools:
            options.getInheritedActiveTools?.() ?? pi.getActiveTools(),
          sessionName: pi.getSessionName(),
          sessionFilePath: parentSessionFile,
        },
      };
    },
    flush,
    async shutdown(options = {}) {
      delivery.clear();
      unsubscribe?.();
      unsubscribe = undefined;
      ui?.setStatus("subagents", undefined);
      const closing = manager;
      const sessionKey = context?.sessionManager?.getSessionFile();
      manager = undefined;
      context = undefined;
      ui = undefined;
      if (options.preserveForReload) {
        closing?.setOnSettled(() => {});
        return;
      }
      if (sessionKey) managerCache.delete(sessionKey);
      await closing?.disposeAll();
    },
  };
}

export { REASONING_EFFORTS, sameSettlement };
export type { SubagentEvent };
