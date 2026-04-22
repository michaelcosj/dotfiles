import type { Api } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import {
  DEFAULT_PERMISSION_SETTINGS,
  findPresetSourcePath,
  generatePermissionSummary,
  getAllowedArgPatterns,
  getMatchValue,
  getPermissionModeLabel,
  loadPresets,
  normalizePermissionSettings,
  resolveInstructions,
  resolveMode,
} from "./permissions.js";
import { registerQuestionnaireTool } from "./questionnaire.js";
import {
  captureOriginalState,
  clearPermissionState,
  type OriginalAgentState,
  restoreOriginalState,
  writePermissionState,
} from "./state.js";
import { registerSubagentFeatures } from "./subagents.js";
import type { Mode, PermissionSettings, Preset, PresetsConfig } from "./types.js";

const STATUS_ACCEPTED = "[accepted]";
const SUBAGENT_ENV = "PI_SUBAGENT";

const approvedToolCalls = new Set<string>();
const sessionModeOverrides = new Map<string, Mode>();

async function getAllTools(pi: ExtensionAPI): Promise<string[]> {
  return pi
    .getAllTools()
    .map((tool) => tool.name)
    .sort();
}

async function toggleAutoAccept(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  onApply: () => void,
): Promise<void> {
  const tools = await getAllTools(pi);
  if (tools.length === 0) {
    ctx.ui.notify("No tools found", "warning");
    return;
  }

  const allowSet = new Set<string>();
  for (const tool of tools) {
    if (sessionModeOverrides.get(tool) === "allow") allowSet.add(tool);
  }

  const result = await ctx.ui.custom<Set<string> | null>((tui, theme, _kb, done) => {
    let selectedIndex = 0;
    const selectAllIndex = 0;
    const clearAllIndex = 1;
    const toolOffset = 2;
    const applyIndex = toolOffset + tools.length;
    const cancelIndex = applyIndex + 1;
    const totalRows = cancelIndex + 1;

    const container = new Container();
    const borderStyle = (str: string) => theme.fg("accent", str);

    const render = () => {
      container.clear();
      container.addChild(new DynamicBorder(borderStyle));

      const allowedCount = allowSet.size;
      const statusText =
        allowedCount === tools.length
          ? "All auto-accepted"
          : allowedCount === 0
            ? "None (use preset rules)"
            : `${allowedCount}/${tools.length} tools`;

      container.addChild(new Text(theme.fg("accent", theme.bold("Permission Overrides")), 0, 0));
      container.addChild(new Text(theme.fg("dim", statusText), 0, 0));
      container.addChild(new Text("", 0, 0));

      const selectAllActive = allowSet.size === tools.length;
      const selectAllPrefix = selectedIndex === selectAllIndex ? theme.fg("accent", "▸ ") : "  ";
      const selectAllIcon = selectAllActive ? "[✓]" : "[ ]";
      container.addChild(
        new Text(`${selectAllPrefix}${selectAllIcon} ${theme.fg("success", "Select all")}`, 0, 0),
      );

      const clearAllPrefix = selectedIndex === clearAllIndex ? theme.fg("accent", "▸ ") : "  ";
      container.addChild(new Text(`${clearAllPrefix} ${theme.fg("error", "Clear all")}`, 0, 0));
      container.addChild(new Text(theme.fg("dim", "─".repeat(30)), 0, 0));

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        const isSelected = selectedIndex === toolOffset + i;
        const prefix = isSelected ? theme.fg("accent", "▸ ") : "  ";
        const icon = allowSet.has(tool) ? "[✓]" : "[ ]";
        const state = allowSet.has(tool)
          ? theme.fg("success", "allow")
          : theme.fg("muted", "preset");
        container.addChild(
          new Text(`${prefix}${icon} ${theme.fg("toolTitle", tool)} → ${state}`, 0, 0),
        );
      }

      container.addChild(new Text("", 0, 0));
      container.addChild(new Text(theme.fg("dim", "─".repeat(30)), 0, 0));

      const applyPrefix = selectedIndex === applyIndex ? theme.fg("accent", "▸ ") : "  ";
      container.addChild(new Text(`${applyPrefix}${theme.fg("success", "Apply")}`, 0, 0));

      const cancelPrefix = selectedIndex === cancelIndex ? theme.fg("accent", "▸ ") : "  ";
      container.addChild(new Text(`${cancelPrefix}${theme.fg("muted", "Cancel")}`, 0, 0));

      container.addChild(new Text("", 0, 0));
      container.addChild(
        new Text(theme.fg("dim", "↑↓ navigate • space toggle • enter apply • esc cancel"), 0, 0),
      );
      container.addChild(new DynamicBorder(borderStyle));
    };

    render();

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        if (data === "k" || data === "\u001b[A") {
          selectedIndex = (selectedIndex - 1 + totalRows) % totalRows;
          render();
          tui.requestRender();
          return true;
        }
        if (data === "j" || data === "\u001b[B") {
          selectedIndex = (selectedIndex + 1) % totalRows;
          render();
          tui.requestRender();
          return true;
        }

        const isActivate = data === " " || data === "\n" || data === "\r";
        if (isActivate) {
          if (selectedIndex === selectAllIndex) {
            if (allowSet.size === tools.length) allowSet.clear();
            else for (const tool of tools) allowSet.add(tool);
          } else if (selectedIndex === clearAllIndex) {
            allowSet.clear();
          } else if (selectedIndex >= toolOffset && selectedIndex < applyIndex) {
            const tool = tools[selectedIndex - toolOffset];
            if (allowSet.has(tool)) allowSet.delete(tool);
            else allowSet.add(tool);
          } else if (selectedIndex === applyIndex) {
            done(allowSet);
            return true;
          } else if (selectedIndex === cancelIndex) {
            done(null);
            return true;
          }
          render();
          tui.requestRender();
          return true;
        }

        if (data === "\u001b") {
          done(null);
          return true;
        }
        return false;
      },
    };
  });

  if (result === null) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  sessionModeOverrides.clear();
  for (const tool of result) sessionModeOverrides.set(tool, "allow");
  onApply();

  const count = result.size;
  ctx.ui.notify(count === 0 ? "All overrides cleared" : `Auto-accept: ${count} tools`, "info");
}

export default function agentsExtension(pi: ExtensionAPI) {
  // Register preset flag in both parent and child mode.
  // Child process receives --preset from parent spawn args.
  pi.registerFlag("preset", {
    description: "Preset configuration to use",
    type: "string",
  });

  const isSubagent = process.env[SUBAGENT_ENV] === "1";

  // Child mode only needs subagent hooks (permissions + forwarded questionnaire).
  if (isSubagent) {
    registerSubagentFeatures(pi);
    return;
  }

  registerQuestionnaireTool(pi);
  registerSubagentFeatures(pi);

  let presets: PresetsConfig = {};
  let loadedDefaultName: string | undefined;

  let activePresetName: string | undefined;
  let activePermissionSettings: PermissionSettings = { ...DEFAULT_PERMISSION_SETTINGS };
  let activeInstructionsResolved: string | undefined;

  let originalState: OriginalAgentState | undefined;
  let originalStateCaptured = false;

  const persistPermissionState = () => {
    writePermissionState({
      presetName: activePresetName,
      permission: activePermissionSettings,
      sessionOverrides: sessionModeOverrides,
    });
  };

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    const widget = [];
    if (activePresetName) {
      widget.push(ctx.ui.theme.fg("accent", `preset:${activePresetName}`));
    } else {
      widget.push(undefined);
    }

    const modeLabel = getPermissionModeLabel(activePermissionSettings, sessionModeOverrides);
    ctx.ui.setWidget("preset-permission", [...widget, ctx.ui.theme.fg("dim", `perm:${modeLabel}`)]);
  };

  const ensureOriginalState = (ctx: ExtensionContext) => {
    if (originalStateCaptured) return;
    originalState = captureOriginalState(pi, ctx);
    originalStateCaptured = true;
  };

  const setPermissionFromPreset = (preset: Preset | undefined) => {
    activePermissionSettings = normalizePermissionSettings(preset?.permission);
  };

  const applyPreset = async (
    name: string,
    preset: Preset,
    ctx: ExtensionContext,
  ): Promise<boolean> => {
    ensureOriginalState(ctx);

    if (preset.provider && preset.model) {
      const model = ctx.modelRegistry.find(preset.provider as Api, preset.model);
      if (model) {
        const ok = await pi.setModel(model);
        if (!ok) {
          ctx.ui.notify(
            `Preset "${name}": No API key for ${preset.provider}/${preset.model}`,
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `Preset "${name}": Model ${preset.provider}/${preset.model} not found`,
          "warning",
        );
      }
    }

    if (preset.thinkingLevel) pi.setThinkingLevel(preset.thinkingLevel);

    if (preset.tools && preset.tools.length > 0) {
      const allToolNames = pi.getAllTools().map((tool) => tool.name);
      const validTools = preset.tools.filter((tool) => allToolNames.includes(tool));
      const invalidTools = preset.tools.filter((tool) => !allToolNames.includes(tool));
      if (invalidTools.length > 0) {
        ctx.ui.notify(`Preset "${name}": Unknown tools: ${invalidTools.join(", ")}`, "warning");
      }
      if (validTools.length > 0) pi.setActiveTools(validTools);
    }

    activeInstructionsResolved = undefined;
    if (preset.instructions) {
      const sourcePath = findPresetSourcePath(ctx.cwd, name);
      const resolved = resolveInstructions(preset.instructions, sourcePath);
      if (resolved !== undefined) {
        activeInstructionsResolved = resolved;
      } else if (preset.instructions.startsWith("{file:")) {
        const fileMatch = preset.instructions.match(/^\{file:(.+)\}$/);
        ctx.ui.notify(
          `Preset "${name}": Instructions file "${fileMatch?.[1] ?? preset.instructions}" not found`,
          "warning",
        );
      }
    }

    sessionModeOverrides.clear();
    activePresetName = name;
    setPermissionFromPreset(preset);

    persistPermissionState();
    updateStatus(ctx);
    return true;
  };

  const clearPreset = async (ctx: ExtensionContext) => {
    sessionModeOverrides.clear();
    activePresetName = undefined;
    activeInstructionsResolved = undefined;
    setPermissionFromPreset(undefined);

    await restoreOriginalState(pi, originalState);

    persistPermissionState();
    updateStatus(ctx);
    ctx.ui.notify("Preset cleared, defaults restored", "info");
  };

  const buildPresetDescription = (preset: Preset): string => {
    if (preset.description) return preset.description;
    const parts: string[] = [];
    if (preset.provider && preset.model) parts.push(`${preset.provider}/${preset.model}`);
    if (preset.thinkingLevel) parts.push(`thinking:${preset.thinkingLevel}`);
    if (preset.tools?.length) parts.push(`tools:${preset.tools.join(",")}`);
    if (preset.instructions) {
      const fileMatch = preset.instructions.match(/^\{file:(.+)\}$/);
      const instructionPreview = fileMatch
        ? `{file:${fileMatch[1]}}`
        : preset.instructions.length > 30
          ? `${preset.instructions.slice(0, 27)}...`
          : preset.instructions;
      parts.push(`"${instructionPreview}"`);
    }

    if (preset.permission) {
      const permission = normalizePermissionSettings(preset.permission);
      const permissionBits: string[] = [];
      if (permission.allow?.length) permissionBits.push(`allow=${permission.allow.join(",")}`);
      if (permission.deny?.length) permissionBits.push(`deny=${permission.deny.join(",")}`);
      if (permission.ask?.length) permissionBits.push(`ask=${permission.ask.join(",")}`);
      if (permissionBits.length > 0) parts.push(`perm:${permissionBits.join(" ")}`);
    }

    return parts.join(" | ");
  };

  const showPresetSelector = async (ctx: ExtensionContext) => {
    const presetNames = Object.keys(presets).filter((name) => presets[name].type !== "subagent");
    if (presetNames.length === 0) {
      ctx.ui.notify(
        "No presets defined. Add presets to ~/.pi/agent/presets.json or .pi/presets.json",
        "warning",
      );
      return;
    }

    const items: SelectItem[] = presetNames.map((name) => {
      const isActive = name === activePresetName;
      return {
        value: name,
        label: isActive ? `${name} (active)` : name,
        description: buildPresetDescription(presets[name]),
      };
    });

    items.push({
      value: "(none)",
      label: "(none)",
      description: "Clear active preset and restore original state",
    });

    const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(item.value as string);
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!selected) return;
    if (selected === "(none)") {
      await clearPreset(ctx);
      return;
    }

    const preset = presets[selected];
    if (!preset) return;

    await applyPreset(selected, preset, ctx);
    ctx.ui.notify(`Preset "${selected}" activated`, "info");
  };

  const cyclePreset = async (ctx: ExtensionContext) => {
    const presetNames = Object.keys(presets)
      .filter((name) => presets[name].type !== "subagent")
      .sort();
    if (presetNames.length === 0) {
      ctx.ui.notify("No presets defined", "warning");
      return;
    }

    const cycleList = ["(none)", ...presetNames];
    const currentName = activePresetName ?? "(none)";
    const currentIndex = cycleList.indexOf(currentName);
    const nextName = cycleList[(currentIndex + 1 + cycleList.length) % cycleList.length];

    if (nextName === "(none)") {
      await clearPreset(ctx);
      return;
    }

    const preset = presets[nextName];
    if (!preset) return;

    await applyPreset(nextName, preset, ctx);
    ctx.ui.notify(`Preset "${nextName}" activated`, "info");
  };

  pi.registerShortcut(Key.ctrlShift("u"), {
    description: "Cycle presets",
    handler: async (ctx) => {
      await cyclePreset(ctx);
    },
  });

  pi.registerCommand("preset", {
    description: "Switch preset configuration",
    handler: async (args, ctx) => {
      const requested = args?.trim();
      if (!requested) {
        await showPresetSelector(ctx);
        return;
      }

      const preset = presets[requested];
      if (!preset) {
        const available = Object.keys(presets).join(", ") || "(none defined)";
        ctx.ui.notify(`Unknown preset "${requested}". Available: ${available}`, "error");
        return;
      }

      if (preset.type === "subagent") {
        ctx.ui.notify(
          `Preset "${requested}" is subagent-only and cannot be used in regular sessions.`,
          "error",
        );
        return;
      }

      await applyPreset(requested, preset, ctx);
      ctx.ui.notify(`Preset "${requested}" activated`, "info");
    },
  });

  pi.registerCommand("permission-toggle-auto-accept", {
    description: "Toggle permissions to auto-accept (per-tool or all)",
    handler: async (_args, ctx) => {
      await toggleAutoAccept(ctx, pi, () => {
        persistPermissionState();
        updateStatus(ctx);
      });
    },
  });

  pi.registerCommand("permission-mode", {
    description: "Set permission mode for a tool in current session",
    handler: async (_args, ctx) => {
      const tool = await ctx.ui.input("Tool name", "e.g. bash, edit");
      if (!tool) return;
      const mode = await ctx.ui.select("Mode", ["allow", "ask", "deny"]);
      if (!mode) return;

      sessionModeOverrides.set(tool, mode as Mode);
      persistPermissionState();
      updateStatus(ctx);

      ctx.ui.notify(`Permission mode for "${tool}" set to "${mode}" (session only)`, "info");
    },
  });

  pi.registerCommand("permission-settings", {
    description: "Show resolved permission settings for active preset",
    handler: async (_args, ctx) => {
      const output = JSON.stringify(
        {
          preset: activePresetName ?? "(none)",
          permission: normalizePermissionSettings(activePermissionSettings),
          sessionOverrides: Object.fromEntries(sessionModeOverrides),
        },
        null,
        2,
      );
      await ctx.ui.editor("Resolved permission settings", output);
    },
  });

  const buildSubagentPresetList = (): string => {
    const lines = Object.entries(presets)
      .filter(([, preset]) => preset.type === "subagent" || preset.type === "all")
      .map(([name, preset]) => `- **${name}**: ${preset.description ?? "No description"}`);
    if (lines.length === 0) return "";
    return [
      "## Available Subagent Presets",
      "You can delegate tasks to specialized subagents using the `subagent` tool. Available presets:",
      "",
      ...lines,
      "",
      "Use the preset name when calling the subagent tool.",
    ].join("\n");
  };

  pi.on("message_end", async (event) => {
    const msg = event.message as unknown as Record<string, unknown>;
    if (msg.role !== "toolResult") return;
    if (typeof msg.toolCallId !== "string") return;
    if (approvedToolCalls.delete(msg.toolCallId)) {
      msg.isError = false;
    }
  });

  pi.on(
    "tool_call",
    async (
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ): Promise<ToolCallEventResult | undefined> => {
      const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>);
      const mode = resolveMode(
        normalizePermissionSettings(activePermissionSettings),
        event.toolName,
        argValue ?? "",
        ctx.cwd,
        sessionModeOverrides,
      );

      if (mode === "allow") return undefined;
      if (mode === "deny") {
        let reason = `Permission denied: Tool "${event.toolName}" is blocked by permission settings.`;
        const patterns = getAllowedArgPatterns(
          normalizePermissionSettings(activePermissionSettings),
          event.toolName,
        );
        if (patterns.length > 0) {
          reason += ` Allowed: ${patterns.join(", ")}.`;
        }
        reason += " Use another approach.";
        return { block: true, reason };
      }

      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `Permission denied: Tool "${event.toolName}" requires user confirmation (no UI available).`,
        };
      }

      if (event.toolName === "edit" || event.toolName === "write") {
        if (!argValue) {
          return { block: true, reason: `Permission denied: Missing path for ${event.toolName}.` };
        }

        const title = JSON.stringify({
          prompt: `${event.toolName}: ${argValue}`,
          toolName: event.toolName,
          toolInput: event.input,
        });
        const choice = await ctx.ui.select(title, ["Accept", "Reject"]);
        if (choice === "Accept") return undefined;

        if (choice?.startsWith("{")) {
          const parsed = JSON.parse(choice) as { result?: string };
          if (parsed.result === "Accepted") {
            approvedToolCalls.add(event.toolCallId);
            return {
              block: true,
              reason: `${STATUS_ACCEPTED} User approved edit. Applied to ${argValue} as proposed.`,
            };
          }
          if (parsed.result === "AcceptModified") {
            approvedToolCalls.add(event.toolCallId);
            return {
              block: true,
              reason: `${STATUS_ACCEPTED} User approved with modifications. ${argValue} updated with user version.`,
            };
          }
        }

        const notes = await ctx.ui.input(
          "Edit rejected. Provide instructions for agent",
          "e.g. Different file, skip edit, adjust approach",
        );
        return {
          block: true,
          reason: notes
            ? `Permission denied: User rejected ${event.toolName} for ${argValue}. User instructions: ${notes}`
            : `Permission denied: User rejected ${event.toolName} for ${argValue}. File unchanged.`,
        };
      }

      if (event.toolName === "bash") {
        if (!argValue) return { block: true, reason: "No command provided" };
        const allowed = await ctx.ui.confirm("Agent wants to run shell command. Allow?", argValue);
        if (allowed) return undefined;

        const notes = await ctx.ui.input(
          "Command rejected. Provide instructions for agent",
          "e.g. Different command, skip step",
        );
        return {
          block: true,
          reason: notes
            ? `Permission denied: User rejected bash command: ${argValue}. User instructions: ${notes}`
            : `Permission denied: User rejected bash command: ${argValue}.`,
        };
      }

      const message = argValue ?? JSON.stringify(event.input, null, 2);
      const allowed = await ctx.ui.confirm(event.toolName, message);
      if (allowed) return undefined;

      const notes = await ctx.ui.input(
        "Tool call rejected. Provide instructions for agent",
        "e.g. Try different tool, skip step",
      );
      return {
        block: true,
        reason: notes
          ? `Permission denied: User rejected ${event.toolName}. User instructions: ${notes}`
          : `Permission denied: User rejected ${event.toolName}.`,
      };
    },
  );

  pi.on("before_agent_start", async (event) => {
    const allTools = pi
      .getAllTools()
      .map((tool) => tool.name)
      .sort();
    const parts: string[] = [];

    if (activeInstructionsResolved) parts.push(activeInstructionsResolved);

    const subagentPresetList = buildSubagentPresetList();
    if (subagentPresetList) parts.push(subagentPresetList);

    parts.push(
      generatePermissionSummary(normalizePermissionSettings(activePermissionSettings), allTools),
    );

    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${parts.join("\n\n")}`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionModeOverrides.clear();
    approvedToolCalls.clear();

    const loaded = loadPresets(ctx.cwd);
    presets = loaded.presets;
    loadedDefaultName = loaded.defaultName;

    ensureOriginalState(ctx);

    const presetFlag = pi.getFlag("preset");
    const requestedFromFlag = typeof presetFlag === "string" && presetFlag ? presetFlag : undefined;

    if (requestedFromFlag) {
      const preset = presets[requestedFromFlag];
      if (!preset) {
        const available = Object.keys(presets).join(", ") || "(none defined)";
        ctx.ui.notify(`Unknown preset "${requestedFromFlag}". Available: ${available}`, "warning");
      } else if (preset.type === "subagent") {
        ctx.ui.notify(
          `Preset "${requestedFromFlag}" is subagent-only. Skipping auto-apply.`,
          "warning",
        );
      } else {
        await applyPreset(requestedFromFlag, preset, ctx);
        ctx.ui.notify(`Preset "${requestedFromFlag}" activated`, "info");
      }
    }

    const entries = ctx.sessionManager.getEntries();
    const presetEntry = entries
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === "preset-state",
      )
      .pop() as { data?: { name: string } } | undefined;

    if (!requestedFromFlag && presetEntry?.data?.name) {
      const restored = presets[presetEntry.data.name];
      if (restored && restored.type !== "subagent") {
        await applyPreset(presetEntry.data.name, restored, ctx);
      }
    } else if (!requestedFromFlag && loadedDefaultName) {
      const defaultPreset = presets[loadedDefaultName];
      if (defaultPreset && defaultPreset.type !== "subagent") {
        await applyPreset(loadedDefaultName, defaultPreset, ctx);
      }
    }

    persistPermissionState();
    updateStatus(ctx);
  });

  pi.on("turn_start", async () => {
    if (activePresetName) {
      pi.appendEntry("preset-state", { name: activePresetName });
    }
  });

  pi.on("session_shutdown", async () => {
    clearPermissionState();
  });
}
