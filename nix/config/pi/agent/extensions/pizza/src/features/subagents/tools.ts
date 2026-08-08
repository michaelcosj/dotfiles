import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  MAX_RUNNING,
  REASONING_EFFORTS,
  type SpawnTask,
} from "./state.js";
import type { SubagentRuntime, SpawnParameters } from "./runtime.js";
import {
  sameSettlement,
  subagentResultBatch,
  describeSubagent,
  spawnResultText,
  latestPreview,
} from "./presenters.js";
import {
  waitCallText,
  waitDetailsFromSnapshots,
  waitResultText,
  waitWithLiveUpdates,
  type WaitToolResult,
} from "./ui/wait-tool.js";
import { spawnCallText, spawnResultText as compactSpawnResultText } from "./ui/spawn-tool.js";

interface TaskInput {
  prompt: string;
  name: string;
  working_dir?: string;
  model?: string;
  reasoning_effort?: (typeof REASONING_EFFORTS)[number];
}

function taskInput(input: TaskInput): SpawnParameters {
  return input;
}

export function registerSubagentTools(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
) {
  const task = async (
    params: TaskInput,
    context: ExtensionContext,
    origin: "model" | "btw" = "model",
  ): Promise<SpawnTask> => runtime.createTask(taskInput(params), context, origin);

  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description: `Start a separate persisted Pi agent session in the background. At most ${MAX_RUNNING} run concurrently.`,
    promptSnippet: "Delegate an independent task to a background Pi subagent.",
    promptGuidelines: [
      "Use subagent_wait when its result is required before continuing; do not poll.",
      "Use subagent_send to continue an existing subagent session instead of spawning a new one.",
      "Children cannot spawn subagents or ask the user questions.",
    ],
    parameters: Type.Object({
      prompt: Type.String(),
      name: Type.String(),
      working_dir: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      reasoning_effort: Type.Optional(StringEnum(REASONING_EFFORTS)),
    }),
    async execute(_id, params, signal, _update, context) {
      if (signal?.aborted) throw new Error("Spawn aborted");
      const snapshot = await runtime
        .getManager()
        .spawn(await task(params, context), signal);
      return {
        content: [{ type: "text", text: spawnResultText(snapshot) }],
        details: {
          id: snapshot.id,
          status: snapshot.status,
          sessionFilePath: snapshot.meta.sessionFilePath,
          modelLabel: snapshot.meta.modelLabel,
          reasoningEffort: snapshot.meta.reasoningEffort,
        },
      };
    },
    renderCall(args, theme) {
      const context = runtime.getContext();
      const inheritedModel = context?.model
        ? `${context.model.provider}/${context.model.id}`
        : undefined;
      return new Text(
        spawnCallText(
          {
            ...args,
            model: args.model ?? inheritedModel,
            reasoning_effort: args.reasoning_effort ?? pi.getThinkingLevel(),
          },
          theme,
        ),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      return new Text(compactSpawnResultText(result, theme), 0, 0);
    },
  });

  pi.registerTool({
    name: "subagent_send",
    label: "Message Subagent",
    description:
      "Send a message to an existing model-origin subagent. A settled subagent resumes its persisted session; a running subagent receives steering input.",
    promptSnippet: "Continue or steer an existing subagent session.",
    parameters: Type.Object({
      id: Type.String(),
      message: Type.String(),
    }),
    async execute(_toolCallId, params) {
      const manager = runtime.getManager();
      const before = manager.get(params.id);
      if (!before || before.origin !== "model") {
        throw new Error(`Unknown subagent "${params.id}"`);
      }
      const message = params.message.trim();
      if (!message) throw new Error("Message must not be empty");
      const priorResult = runtime.delivery.take(params.id);
      try {
        await manager.send(params.id, message);
      } catch (error) {
        if (priorResult) runtime.delivery.restoreIfAbsent(priorResult);
        throw error;
      }
      const after = manager.get(params.id)!;
      return {
        content: [
          {
            type: "text",
            text: `${before.status === "running" ? "Sent steering input to" : "Resumed"} ${after.id} "${after.title}".`,
          },
        ],
        details: { id: after.id, status: after.status },
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description:
      "Wait without polling for all specified subagents to settle. Aborting the wait does not cancel them.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1 }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const manager = runtime.getManager();
      const ids = [...new Set(params.ids)];
      const emitUpdate = onUpdate
        ? (update: WaitToolResult) => onUpdate(update)
        : undefined;
      const snapshots = await waitWithLiveUpdates(
        manager.view,
        (waitIds, waitSignal) => manager.wait([...waitIds], waitSignal),
        ids,
        signal,
        emitUpdate,
      );
      for (const snapshot of snapshots) {
        runtime.delivery.consumeIf(snapshot.id, (pending) =>
          sameSettlement(pending, snapshot),
        );
      }
      return {
        content: [{ type: "text", text: subagentResultBatch(snapshots) }],
        details: waitDetailsFromSnapshots(snapshots, true),
      };
    },
    renderCall(args, theme) {
      return new Text(waitCallText(args.ids, theme), 0, 0);
    },
    renderResult(result, options, theme) {
      return new Text(waitResultText(result, options, theme), 0, 0);
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description:
      "Interrupt running subagents and preserve partial output and persisted sessions.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1 }),
    }),
    async execute(_id, params, signal) {
      const manager = runtime.getManager();
      const ids = [...new Set(params.ids)];
      const results = await manager.cancel(ids, signal);
      for (const id of ids) {
        const snapshot = manager.get(id);
        if (snapshot && snapshot.status !== "running") {
          runtime.delivery.consumeIf(id, (pending) =>
            sameSettlement(pending, snapshot),
          );
        }
      }
      return {
        content: [
          {
            type: "text",
            text: results
              .map(
                (entry) =>
                  `${entry.id} [${entry.status}] ${entry.cancelled ? "cancelled" : "already settled"}`,
              )
              .join("\n"),
          },
        ],
        details: { results },
      };
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description:
      "Nonblocking status and latest bounded output preview for one model-origin subagent.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      const snapshot = runtime.getManager().get(params.id);
      if (!snapshot || snapshot.origin !== "model") {
        throw new Error(`Unknown subagent "${params.id}"`);
      }
      if (snapshot.status !== "running") {
        runtime.delivery.consumeIf(snapshot.id, (pending) =>
          sameSettlement(pending, snapshot),
        );
      }
      return {
        content: [
          {
            type: "text",
            text: `${describeSubagent(snapshot)}\nSession: ${snapshot.meta.sessionFilePath ?? "?"}\n\n${latestPreview(snapshot)}`,
          },
        ],
        details: { id: snapshot.id, status: snapshot.status, turns: snapshot.turns },
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: "List model-spawned subagents and their current states.",
    parameters: Type.Object({}),
    async execute() {
      const snapshots = runtime
        .getManager()
        .list()
        .filter((snapshot) => snapshot.origin === "model");
      return {
        content: [
          {
            type: "text",
            text: snapshots.length
              ? snapshots.map(describeSubagent).join("\n")
              : "No subagents.",
          },
        ],
        details: {
          agents: snapshots.map((snapshot) => ({
            id: snapshot.id,
            title: snapshot.title,
            status: snapshot.status,
          })),
        },
      };
    },
  });
}
