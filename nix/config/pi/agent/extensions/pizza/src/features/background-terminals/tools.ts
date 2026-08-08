import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { BackgroundTerminalRuntime } from "./runtime.js";
import {
  BG_KILL_PARAMETER_DESCRIPTIONS,
  BG_KILL_TOOL_DESCRIPTION,
  BG_LIST_TOOL_DESCRIPTION,
  BG_START_PARAMETER_DESCRIPTIONS,
  BG_START_PROMPT_GUIDELINES,
  BG_START_PROMPT_SNIPPET,
  BG_START_TOOL_DESCRIPTION,
  BG_STATUS_PARAMETER_DESCRIPTIONS,
  BG_STATUS_TOOL_DESCRIPTION,
  buildKillReport,
  buildStartResult,
  buildStatusResult,
  describeTerminal,
} from "./prompt.js";
import {
  simpleCallText,
  startCallText,
  startResultText,
  terminalDetails,
  terminalResultText,
  waitCallText,
  waitResultText,
  waitWithLiveUpdates,
  type WaitToolResult,
} from "./ui/tool-renderers.js";

export function registerBackgroundTerminalTools(
  pi: ExtensionAPI,
  runtime: BackgroundTerminalRuntime,
) {
  pi.registerTool({
    name: "bg_start",
    label: "Start Background Terminal",
    description: BG_START_TOOL_DESCRIPTION,
    promptSnippet: BG_START_PROMPT_SNIPPET,
    promptGuidelines: BG_START_PROMPT_GUIDELINES,
    parameters: Type.Object({
      command: Type.String({
        description: BG_START_PARAMETER_DESCRIPTIONS.command,
      }),
      title: Type.String({
        description: BG_START_PARAMETER_DESCRIPTIONS.title,
      }),
      working_dir: Type.Optional(
        Type.String({
          description: BG_START_PARAMETER_DESCRIPTIONS.workingDir,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const manager = runtime.getManager();
      const command = params.command.trim();
      if (!command) throw new Error("command must not be empty.");

      const cwd = path.resolve(context.cwd, params.working_dir ?? ".");
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }

      const title =
        params.title.replace(/\s+/g, " ").trim().slice(0, 80) || "terminal";
      const snapshot = await manager.start({ command, title, cwd });
      return {
        content: [{ type: "text", text: buildStartResult(snapshot) }],
        details: {
          id: snapshot.id,
          title: snapshot.title,
          status: snapshot.status,
          cwd,
          pid: snapshot.pid,
        },
      };
    },
    renderCall(args, theme) {
      return new Text(startCallText(args, theme), 0, 0);
    },
    renderResult(result, _options, theme) {
      return new Text(startResultText(result, theme), 0, 0);
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Check Background Terminal",
    description: BG_STATUS_TOOL_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: BG_STATUS_PARAMETER_DESCRIPTIONS.id }),
    }),
    async execute(_toolCallId, params) {
      const query = runtime.getQuery();
      const snapshot = query.get(params.id);
      if (!snapshot) {
        const known = query.list().map((item) => item.id);
        throw new Error(
          `Unknown terminal id "${params.id}". Known: ${known.join(", ") || "none"}.`,
        );
      }
      if (snapshot.status !== "running") {
        runtime.delivery.consume([snapshot.id]);
      }
      return {
        content: [{ type: "text", text: buildStatusResult(snapshot) }],
        details: {
          terminal: terminalDetails(snapshot),
          id: snapshot.id,
          status: snapshot.status,
          pid: snapshot.pid,
          exitCode: snapshot.exitCode,
          signal: snapshot.signal,
        },
      };
    },
    renderCall(args, theme) {
      return new Text(simpleCallText("bg_status", args.id, theme), 0, 0);
    },
    renderResult(result, options, theme) {
      return new Text(
        terminalResultText(result, options, theme, "terminal"),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "bg_wait",
    label: "Wait for Background Terminal",
    description:
      "Wait for one background terminal to exit without polling or running sleep. Returns immediately if it already settled, or when the optional timeout expires.",
    parameters: Type.Object({
      id: Type.String({
        description: "Background terminal id, for example bt-1.",
      }),
      timeout_ms: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 86_400_000,
          description:
            "Optional maximum wait in milliseconds. Omit to wait until completion.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const manager = runtime.getManager();
      const emitUpdate = onUpdate
        ? (update: WaitToolResult) => onUpdate(update)
        : undefined;
      const { snapshot, completed, details } = await waitWithLiveUpdates(
        manager.view,
        (id, timeoutMs, waitSignal) => manager.wait(id, timeoutMs, waitSignal),
        params.id,
        params.timeout_ms,
        signal,
        emitUpdate,
      );
      if (completed) runtime.delivery.consume([snapshot.id]);
      const prefix = completed
        ? "Background terminal completed."
        : `Wait timed out after ${params.timeout_ms}ms; terminal is still running.`;
      return {
        content: [
          { type: "text", text: `${prefix}\n\n${buildStatusResult(snapshot)}` },
        ],
        details: {
          ...details,
          id: snapshot.id,
          completed,
          status: snapshot.status,
          pid: snapshot.pid,
          exitCode: snapshot.exitCode,
          signal: snapshot.signal,
        },
      };
    },
    renderCall(args, theme) {
      return new Text(waitCallText(args.id, args.timeout_ms, theme), 0, 0);
    },
    renderResult(result, options, theme) {
      return new Text(waitResultText(result, options, theme), 0, 0);
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "List Background Terminals",
    description: BG_LIST_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const terminals = runtime.getQuery().list();
      return {
        content: [
          {
            type: "text",
            text: terminals.length
              ? terminals.map(describeTerminal).join("\n")
              : "No background terminals.",
          },
        ],
        details: {
          terminals: terminals.map((terminal) => terminalDetails(terminal)),
        },
      };
    },
    renderCall(_args, theme) {
      return new Text(simpleCallText("bg_list", undefined, theme), 0, 0);
    },
    renderResult(result, options, theme) {
      return new Text(
        terminalResultText(result, options, theme, "terminals"),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Kill Background Terminals",
    description: BG_KILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: BG_KILL_PARAMETER_DESCRIPTIONS.ids,
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const manager = runtime.getManager();
      const ids = [...new Set(params.ids)];
      if (ids.length === 0) throw new Error("Provide at least one terminal id.");

      const query = runtime.getQuery();
      const known = query.list().map((snapshot) => snapshot.id);
      const unknown = ids.filter((id) => !query.get(id));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown terminal id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }
      if (signal?.aborted) {
        throw new Error("Kill cancelled before termination started.");
      }

      const report = await manager.kill(ids);
      runtime.delivery.consume(ids);
      return {
        content: [{ type: "text", text: buildKillReport(report) }],
        details: {
          results: report.map((entry) => ({
            id: entry.id,
            title: entry.title,
            status: entry.status,
            killed: entry.killed,
            wasRunning: entry.wasRunning,
            exit: entry.exit,
            summary: entry.killed
              ? "terminated"
              : entry.wasRunning
                ? "exited before termination"
                : "already settled",
          })),
        },
      };
    },
    renderCall(args, theme) {
      const count = new Set(args.ids).size;
      return new Text(
        simpleCallText(
          "bg_kill",
          `${count} ${count === 1 ? "terminal" : "terminals"}`,
          theme,
        ),
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      return new Text(
        terminalResultText(result, options, theme, "results"),
        0,
        0,
      );
    },
  });
}
