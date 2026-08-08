import fs from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createChildSession } from "./child-session.js";
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
  shutdown(): Promise<void>;
}

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
      manager =
        options.createManager?.() ??
        createSubagentManager((task) => {
          const registry = context?.modelRegistry;
          if (!registry) throw new Error("Parent model registry unavailable.");
          return createChildSession(task, { modelRegistry: registry });
        });
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
      return {
        prompt: params.prompt,
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
        },
      };
    },
    flush,
    async shutdown() {
      delivery.clear();
      unsubscribe?.();
      unsubscribe = undefined;
      ui?.setStatus("subagents", undefined);
      const closing = manager;
      manager = undefined;
      context = undefined;
      ui = undefined;
      await closing?.disposeAll();
    },
  };
}

export { REASONING_EFFORTS, sameSettlement };
export type { SubagentEvent };
