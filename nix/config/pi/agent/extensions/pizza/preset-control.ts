import type { Api } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  DEFAULT_PERMISSION_SETTINGS,
  canonicalPermissionToolName,
  findPresetSourcePath,
  generatePermissionSummary,
  getAllowedArgPatterns,
  getMatchValue,
  getPermissionModeLabel,
  loadPresets,
  mergePermissionSettings,
  normalizePermissionSettings,
  resolveEffectiveMode,
  resolveInstructions,
} from "./preset-permissions.js";
import type { LoadedPresets, Mode, PermissionSettings, Preset, PresetsConfig } from "./preset-types.js";

const STATUS_ACCEPTED = "[accepted]";

interface OriginalAgentState {
  model: ExtensionContext["model"];
  thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>;
  tools: string[];
}

async function getAllTools(pi: ExtensionAPI): Promise<string[]> {
  return pi
    .getAllTools()
    .map((tool) => tool.name)
    .sort();
}

async function toggleAutoAccept(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  sessionModeOverrides: Map<string, Mode>,
  sessionBashAllowOverrides: Set<string>,
  onApply: () => void,
): Promise<void> {
  const tools = await getAllTools(pi);
  if (tools.length === 0) {
    ctx.ui.notify("No tools found", "warning");
    return;
  }

  const selectableTools = [...new Set(tools.map((tool) => canonicalPermissionToolName(tool)))];
  const allowSet = new Set<string>();
  for (const tool of selectableTools) {
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
        allowedCount === selectableTools.length
          ? "All auto-accepted"
          : allowedCount === 0
            ? "None (use preset rules)"
            : `${allowedCount}/${selectableTools.length} tools`;

      container.addChild(new Text(theme.fg("accent", theme.bold("Permission Overrides")), 0, 0));
      container.addChild(new Text(theme.fg("dim", statusText), 0, 0));
      container.addChild(new Text("", 0, 0));

      const selectAllActive = allowSet.size === selectableTools.length;
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
        const canonicalTool = canonicalPermissionToolName(tool);
        const isSelected = selectedIndex === toolOffset + i;
        const prefix = isSelected ? theme.fg("accent", "▸ ") : "  ";
        const icon = allowSet.has(canonicalTool) ? "[✓]" : "[ ]";
        const state = allowSet.has(canonicalTool)
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
            if (allowSet.size === selectableTools.length) allowSet.clear();
            else for (const tool of selectableTools) allowSet.add(tool);
          } else if (selectedIndex === clearAllIndex) {
            allowSet.clear();
          } else if (selectedIndex >= toolOffset && selectedIndex < applyIndex) {
            const tool = tools[selectedIndex - toolOffset];
            const canonicalTool = canonicalPermissionToolName(tool);
            if (allowSet.has(canonicalTool)) allowSet.delete(canonicalTool);
            else allowSet.add(canonicalTool);
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
  sessionBashAllowOverrides.clear();
  for (const tool of result) {
    sessionModeOverrides.set(canonicalPermissionToolName(tool), "allow");
  }
  onApply();

  const count = result.size;
  ctx.ui.notify(count === 0 ? "All overrides cleared" : `Auto-accept: ${count} tools`, "info");
}

export function registerPresetControlExtension(pi: ExtensionAPI): void {
  pi.registerFlag("preset", {
    description: "Preset configuration to use",
    type: "string",
  });

  let presets: PresetsConfig = {};
  let loaded: LoadedPresets = {
    presets: {},
    defaultPreset: undefined,
    defaultMode: "ask",
    globalPermission: undefined,
  };

  let rootDefaultMode: Mode = "ask";
  let globalPermissionSettings: PermissionSettings | undefined;
  let activePresetName: string | undefined;
  let activePresetPermissionSettings: PermissionSettings | undefined;
  let activePermissionSettings: PermissionSettings = { ...DEFAULT_PERMISSION_SETTINGS };
  let activeInstructionsResolved: string | undefined;

  let originalState: OriginalAgentState | undefined;
  let originalStateCaptured = false;

  const approvedToolCalls = new Set<string>();
  const sessionModeOverrides = new Map<string, Mode>();
  const sessionBashAllowOverrides = new Set<string>();

  const ensureOriginalState = (ctx: ExtensionContext) => {
    if (originalStateCaptured) return;
    originalState = {
      model: ctx.model,
      thinkingLevel: pi.getThinkingLevel(),
      tools: pi.getActiveTools(),
    };
    originalStateCaptured = true;
  };

  const restoreOriginalState = async () => {
    if (originalState) {
      if (originalState.model) await pi.setModel(originalState.model);
      pi.setThinkingLevel(originalState.thinkingLevel);
      pi.setActiveTools(originalState.tools);
      return;
    }
    pi.setActiveTools(["read", "bash", "edit", "write"]);
  };

  const setPermissionFromPreset = (preset: Preset | undefined) => {
    activePresetPermissionSettings = preset?.permission;
    activePermissionSettings = mergePermissionSettings(
      activePresetPermissionSettings,
      globalPermissionSettings,
      rootDefaultMode,
    );
  };

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    const widget: (string | undefined)[] = [];
    if (activePresetName) {
      widget.push(ctx.ui.theme.fg("accent", `preset:${activePresetName}`));
    } else {
      widget.push(ctx.ui.theme.fg("dim", "preset:(none)"));
    }

    const modeLabel = getPermissionModeLabel(
      activePermissionSettings,
      sessionModeOverrides,
      sessionBashAllowOverrides.size,
    );
    ctx.ui.setWidget("preset-permission", [...widget, ctx.ui.theme.fg("dim", `perm:${modeLabel}`)]);
  };

  const buildPresetContext = (): string => {
    const allTools = pi
      .getAllTools()
      .map((tool) => tool.name)
      .sort();

    const parts: string[] = [];
    parts.push(`Preset: ${activePresetName ?? "(none)"}`);
    if (activeInstructionsResolved) {
      parts.push("\n## Preset Instructions\n" + activeInstructionsResolved);
    }
    parts.push("\n" + generatePermissionSummary(activePermissionSettings, allTools));
    if (sessionModeOverrides.size > 0 || sessionBashAllowOverrides.size > 0) {
      parts.push(`\nSession overrides: ${JSON.stringify({
        tools: Object.fromEntries(sessionModeOverrides),
        bashAllow: [...sessionBashAllowOverrides],
      })}`);
    }

    return parts.join("\n");
  };

  const buildBashOverridePattern = (command: string): string | undefined => {
    const trimmed = command.trim();
    if (!trimmed) return undefined;

    const withoutCdPrefix = trimmed.replace(/^cd\s+[^;&|]+\s*&&\s*/, "");
    const firstSegment = withoutCdPrefix.split(/(?:\|\||&&|[|;])/)[0]?.trim() ?? "";
    if (!firstSegment) return undefined;

    const tokens = firstSegment.match(/\S+/g) ?? [];
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
    }
    if (tokens[0] === "sudo") tokens.shift();

    const commandName = tokens[0];
    if (!commandName) return undefined;
    return `${commandName} *`;
  };

  const confirmAndApplyAlwaysOverride = async (
    toolName: string,
    argValue: string,
    ctx: ExtensionContext,
  ): Promise<boolean> => {
    if (toolName === "bash") {
      const pattern = buildBashOverridePattern(argValue);
      if (!pattern) return false;
      const confirmed = await ctx.ui.confirm(
        "Always allow this bash command pattern for this session?",
        `bash(${pattern})`,
      );
      if (!confirmed) return false;
      sessionBashAllowOverrides.add(pattern);
      updateStatus(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`Session override set: bash(${pattern}) -> allow`, "info");
      }
      return true;
    }

    const canonicalTool = canonicalPermissionToolName(toolName);
    const confirmed = await ctx.ui.confirm(
      `Always allow ${canonicalTool} for this session?`,
      `${canonicalTool} -> allow`,
    );
    if (!confirmed) return false;

    sessionModeOverrides.set(canonicalTool, "allow");
    updateStatus(ctx);
    if (ctx.hasUI) {
      ctx.ui.notify(`Session override set: ${canonicalTool} -> allow`, "info");
    }
    return true;
  };

  const applyPreset = async (
    name: string,
    preset: Preset,
    ctx: ExtensionContext,
    options?: { clearOverrides?: boolean },
  ): Promise<{ context: string }> => {
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
        ctx.ui.notify(`Preset "${name}": Model ${preset.provider}/${preset.model} not found`, "warning");
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

    if (options?.clearOverrides !== false) {
      sessionModeOverrides.clear();
      sessionBashAllowOverrides.clear();
    }
    activePresetName = name;
    setPermissionFromPreset(preset);
    updateStatus(ctx);

    return { context: buildPresetContext() };
  };

  const clearPreset = async (ctx: ExtensionContext): Promise<{ context: string }> => {
    sessionModeOverrides.clear();
    sessionBashAllowOverrides.clear();
    activePresetName = undefined;
    activeInstructionsResolved = undefined;
    setPermissionFromPreset(undefined);

    await restoreOriginalState();
    updateStatus(ctx);

    return { context: buildPresetContext() };
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
      const permission = normalizePermissionSettings(preset.permission, rootDefaultMode);
      const permissionBits: string[] = [];
      if (permission.allow?.length) permissionBits.push(`allow=${permission.allow.join(",")}`);
      if (permission.deny?.length) permissionBits.push(`deny=${permission.deny.join(",")}`);
      if (permission.ask?.length) permissionBits.push(`ask=${permission.ask.join(",")}`);
      if (permissionBits.length > 0) parts.push(`perm:${permissionBits.join(" ")}`);
    }

    return parts.join(" | ");
  };

  const showPresetSelector = async (ctx: ExtensionContext) => {
    const presetNames = Object.keys(presets).sort();
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
      const border = (str: string) => theme.fg("accent", str);

      let search = "";
      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      const rerender = () => {
        container.clear();
        container.addChild(new DynamicBorder(border));
        container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));
        container.addChild(new Text(theme.fg("muted", `Search (prefix): ${search || ""}`)));
        container.addChild(new Text(theme.fg("dim", "Type to filter • backspace delete")));
        container.addChild(new Text(""));
        container.addChild(selectList);
        container.addChild(new Text(""));
        container.addChild(
          new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")),
        );
        container.addChild(new DynamicBorder(border));
      };

      selectList.onSelect = (item) => done(item.value as string);
      selectList.onCancel = () => done(null);

      rerender();

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          const isBackspace = data === "\u007f" || data === "\b" || data === "\x08";
          if (isBackspace) {
            if (search.length > 0) {
              search = search.slice(0, -1);
              selectList.setFilter(search);
              rerender();
              tui.requestRender();
              return;
            }
          }

          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            search += data;
            selectList.setFilter(search);
            rerender();
            tui.requestRender();
            return;
          }

          selectList.handleInput(data);
          rerender();
          tui.requestRender();
        },
      };
    });

    if (!selected) return;
    if (selected === "(none)") {
      await clearPreset(ctx);
      ctx.ui.notify("Preset cleared, defaults restored", "info");
      return;
    }

    const preset = presets[selected];
    if (!preset) return;

    await applyPreset(selected, preset, ctx);
    ctx.ui.notify(`Preset "${selected}" activated`, "info");
  };

  const cyclePreset = async (ctx: ExtensionContext) => {
    const presetNames = Object.keys(presets).sort();
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
      ctx.ui.notify("Preset cleared, defaults restored", "info");
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
      const requestedRaw = args?.trim();
      if (!requestedRaw) {
        await showPresetSelector(ctx);
        return;
      }

      const requested = requestedRaw;
      const preset = presets[requested];
      if (!preset || !requested) {
        const available = Object.keys(presets).join(", ") || "(none defined)";
        ctx.ui.notify(`Unknown preset "${requestedRaw}". Available: ${available}`, "error");
        return;
      }

      await applyPreset(requested, preset, ctx);
      ctx.ui.notify(`Preset "${requested}" activated`, "info");
    },
  });

  pi.registerCommand("permission-toggle-auto-accept", {
    description: "Toggle permissions to auto-accept (per-tool or all)",
    handler: async (_args, ctx) => {
      await toggleAutoAccept(ctx, pi, sessionModeOverrides, sessionBashAllowOverrides, () => {
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

      const canonicalTool = canonicalPermissionToolName(tool);
      sessionModeOverrides.set(canonicalTool, mode as Mode);
      updateStatus(ctx);

      ctx.ui.notify(`Permission mode for "${canonicalTool}" set to "${mode}" (session only)`, "info");
    },
  });

  pi.registerCommand("permission-settings", {
    description: "Show resolved permission settings for active preset",
    handler: async (_args, ctx) => {
      const output = JSON.stringify(
        {
          preset: activePresetName ?? "(none)",
          presetPermission: activePresetPermissionSettings
            ? normalizePermissionSettings(activePresetPermissionSettings, rootDefaultMode)
            : undefined,
          globalPermission: globalPermissionSettings
            ? normalizePermissionSettings(globalPermissionSettings, rootDefaultMode)
            : undefined,
          permission: normalizePermissionSettings(activePermissionSettings, rootDefaultMode),
          rootFallbackDefaultMode: rootDefaultMode,
          sessionOverrides: {
            tools: Object.fromEntries(sessionModeOverrides),
            bashAllow: [...sessionBashAllowOverrides],
          },
        },
        null,
        2,
      );
      await ctx.ui.editor("Resolved permission settings", output);
    },
  });

  pi.registerTool({
    name: "switch_preset",
    label: "Switch Preset",
    executionMode: "sequential",
    description:
      "Switch to another preset. Requires target preset name and reason. Permission can be scoped per target like switch_preset(plan).",
    parameters: Type.Object({
      preset: Type.String({ description: "Target preset name to switch to" }),
      reason: Type.String({ description: "Why switching preset is needed now" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const requested = params.preset?.trim();
      if (!requested || !presets[requested]) {
        const available = Object.keys(presets).sort().join(", ") || "(none defined)";
        return {
          content: [
            {
              type: "text",
              text: `Error: unknown preset \"${params.preset}\". Available: ${available}`,
            },
          ],
          isError: true,
        };
      }

      const preset = presets[requested];
      const result = await applyPreset(requested, preset, ctx);

      const lines = [
        `Preset switched to \"${requested}\".`,
        `Reason: ${params.reason}`,
        "",
        "--- Active Preset Context ---",
        result.context,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          preset: requested,
          reason: params.reason,
          context: result.context,
        },
      };
    },
    renderCall(args, theme) {
      const preset = (args.preset as string) || "...";
      const reason = (args.reason as string) || "";
      const preview = reason.length > 60 ? `${reason.slice(0, 60)}...` : reason;
      const text =
        theme.fg("toolTitle", theme.bold("switch_preset ")) +
        theme.fg("accent", preset) +
        (preview ? `\n  ${theme.fg("dim", preview)}` : "");
      return new Text(text, 0, 0);
    },
  });

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
      const mode = resolveEffectiveMode(
        activePresetPermissionSettings,
        globalPermissionSettings,
        event.toolName,
        argValue ?? "",
        ctx.cwd,
        sessionModeOverrides,
        rootDefaultMode,
        [...sessionBashAllowOverrides],
      );

      if (mode === "allow") return undefined;
      if (mode === "deny") {
        let reason = `Permission denied: Tool "${event.toolName}" is blocked by permission settings.`;
        const patterns = getAllowedArgPatterns(activePermissionSettings, event.toolName);
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
        const choice = await ctx.ui.select(title, ["Accept", "Always", "Reject"]);
        if (choice === "Accept") return undefined;

        if (choice === "Always") {
          const applied = await confirmAndApplyAlwaysOverride(event.toolName, argValue, ctx);
          if (applied) return undefined;
        }

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

        const choice = await ctx.ui.select(
          `bash: ${argValue}`,
          ["Accept", "Always", "Reject"],
        );
        if (choice === "Accept") return undefined;
        if (choice === "Always") {
          const applied = await confirmAndApplyAlwaysOverride("bash", argValue, ctx);
          if (applied) return undefined;
        }

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
      const choice = await ctx.ui.select(
        `${event.toolName}: ${message}`,
        ["Accept", "Always", "Reject"],
      );
      if (choice === "Accept") return undefined;
      if (choice === "Always") {
        const applied = await confirmAndApplyAlwaysOverride(event.toolName, message, ctx);
        if (applied) return undefined;
      }

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

    parts.push(generatePermissionSummary(activePermissionSettings, allTools));

    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${parts.join("\n\n")}`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionModeOverrides.clear();
    sessionBashAllowOverrides.clear();
    approvedToolCalls.clear();

    loaded = loadPresets(ctx.cwd);
    presets = loaded.presets;
    rootDefaultMode = loaded.defaultMode;
    globalPermissionSettings = loaded.globalPermission;

    ensureOriginalState(ctx);
    setPermissionFromPreset(undefined);

    const presetFlag = pi.getFlag("preset");
    const requestedFromFlag =
      typeof presetFlag === "string" && presetFlag ? presetFlag : undefined;

    if (requestedFromFlag) {
      const preset = presets[requestedFromFlag];
      if (!preset) {
        const available = Object.keys(presets).join(", ") || "(none defined)";
        ctx.ui.notify(`Unknown preset "${requestedFromFlag}". Available: ${available}`, "warning");
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
      const restoredName = presetEntry.data.name;
      const restored = presets[restoredName];
      if (restored) {
        await applyPreset(restoredName, restored, ctx);
      } else if (loaded.defaultPreset) {
        // Saved preset no longer exists; fall back to default
        const defaultPresetName = loaded.defaultPreset;
        const defaultPreset = presets[defaultPresetName];
        if (defaultPreset) {
          await applyPreset(defaultPresetName, defaultPreset, ctx);
        } else {
          ctx.ui.notify(
            `Default preset "${loaded.defaultPreset}" not found. Using fallback permission mode ${rootDefaultMode}.`,
            "warning",
          );
        }
      }
    } else if (!requestedFromFlag && loaded.defaultPreset) {
      const defaultPresetName = loaded.defaultPreset;
      const defaultPreset = presets[defaultPresetName];
      if (defaultPreset) {
        await applyPreset(defaultPresetName, defaultPreset, ctx);
      } else {
        ctx.ui.notify(
          `Default preset \"${loaded.defaultPreset}\" not found. Using fallback permission mode ${rootDefaultMode}.`,
          "warning",
        );
      }
    }

    updateStatus(ctx);
  });

  pi.on("turn_start", async () => {
    if (activePresetName) {
      pi.appendEntry("preset-state", { name: activePresetName });
    }
  });

  pi.on("session_shutdown", async () => {
    sessionModeOverrides.clear();
    sessionBashAllowOverrides.clear();
    approvedToolCalls.clear();
  });
}
