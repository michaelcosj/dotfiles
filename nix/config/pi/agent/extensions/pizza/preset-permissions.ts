import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { LoadedPresets, Mode, PermissionSettings, Preset, PresetsConfig } from "./preset-types.js";

export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = { defaultMode: "ask" };

interface PresetsFile {
  defaultPreset?: string;
  defaultMode?: string;
  default?: string;
  presets?: PresetsConfig;
  [key: string]: unknown;
}

interface ParsedRule {
  toolPattern: string;
  argPattern?: string;
}

function parseMode(value: unknown): Mode | undefined {
  return value === "allow" || value === "ask" || value === "deny" ? value : undefined;
}

export function loadPresets(cwd: string): LoadedPresets {
  const globalPath = join(getAgentDir(), "presets.json");
  const projectPath = join(cwd, ".pi", "presets.json");
  const reservedKeys = new Set(["default", "defaultPreset", "defaultMode", "presets"]);

  function parseFile(filePath: string): {
    presets: PresetsConfig;
    defaultPreset: string | undefined;
    defaultMode: Mode | undefined;
  } {
    let presets: PresetsConfig = {};
    let defaultPreset: string | undefined;
    let defaultMode: Mode | undefined;

    if (!existsSync(filePath)) return { presets, defaultPreset, defaultMode };

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as PresetsFile;

      if (raw.presets && typeof raw.presets === "object") {
        presets = raw.presets as PresetsConfig;
      } else {
        for (const key of Object.keys(raw)) {
          if (reservedKeys.has(key)) continue;
          const value = raw[key];
          if (value && typeof value === "object" && !Array.isArray(value)) {
            presets[key] = value as Preset;
          }
        }
      }

      if (typeof raw.defaultPreset === "string" && raw.defaultPreset.trim()) {
        defaultPreset = raw.defaultPreset.trim();
      } else if (typeof raw.default === "string" && raw.default.trim()) {
        defaultPreset = raw.default.trim();
      }

      defaultMode = parseMode(raw.defaultMode);
    } catch (err) {
      console.error(`Failed to load presets from ${filePath}: ${err}`);
    }

    return { presets, defaultPreset, defaultMode };
  }

  const globalResult = parseFile(globalPath);
  const projectResult = parseFile(projectPath);

  return {
    presets: { ...globalResult.presets, ...projectResult.presets },
    defaultPreset: projectResult.defaultPreset ?? globalResult.defaultPreset,
    defaultMode: projectResult.defaultMode ?? globalResult.defaultMode ?? "ask",
  };
}

export function findPresetSourcePath(cwd: string, presetName: string): string {
  const projectPath = join(cwd, ".pi", "presets.json");
  if (existsSync(projectPath)) {
    try {
      const content = readFileSync(projectPath, "utf-8");
      const parsed = JSON.parse(content) as PresetsFile;
      const presetsObj = (parsed.presets || parsed) as Record<string, unknown>;
      if (presetsObj[presetName]) return projectPath;
    } catch {
      // ignore malformed project presets
    }
  }

  return join(getAgentDir(), "presets.json");
}

export function resolveInstructions(
  instructions: string | undefined,
  presetSourcePath: string,
): string | undefined {
  if (!instructions) return undefined;

  const fileMatch = instructions.match(/^\{file:(.+)\}$/);
  if (!fileMatch) return instructions;

  const filePath = fileMatch[1];
  const basePath = dirname(presetSourcePath);
  const fullPath = resolve(basePath, filePath);

  if (!existsSync(fullPath)) return undefined;

  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return undefined;
  }
}

export function normalizePermissionSettings(
  settings: PermissionSettings | undefined,
  fallbackMode: Mode = "ask",
): PermissionSettings {
  return {
    defaultMode: settings?.defaultMode ?? fallbackMode,
    allow: settings?.allow ? [...settings.allow] : [],
    deny: settings?.deny ? [...settings.deny] : [],
    ask: settings?.ask ? [...settings.ask] : [],
  };
}

export function parseRule(rule: string): ParsedRule {
  const match = rule.match(/^([^(]+)\((.+)\)$/);
  if (match) {
    return { toolPattern: match[1], argPattern: match[2] };
  }
  return { toolPattern: rule };
}

export function getAllowedArgPatterns(settings: PermissionSettings, toolName: string): string[] {
  return (settings.allow ?? [])
    .filter((rule) => {
      const parsed = parseRule(rule);
      return parsed.toolPattern === toolName && parsed.argPattern;
    })
    .map((rule) => {
      const parsed = parseRule(rule);
      return `${toolName}(${parsed.argPattern!})`;
    });
}

export function matchPattern(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const adjusted = escaped.replace(/ \.\*$/, "( .*)?");
  return new RegExp(`^${adjusted}$`).test(value);
}

export function matchesAnyRule(rules: string[], toolName: string, argValue: string): boolean {
  return rules.some((rule) => {
    const parsed = parseRule(rule);
    if (!matchPattern(parsed.toolPattern, toolName)) return false;
    if (parsed.argPattern) return matchPattern(parsed.argPattern, argValue);
    return true;
  });
}

function normalizePathValue(value: string): string {
  return value.replace(/\\/g, "/");
}

function getArgCandidates(toolName: string, argValue: string, cwd: string): string[] {
  if (!argValue) return [""];

  const candidates = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizePathValue(value);
    if (normalized) candidates.add(normalized);
  };

  add(argValue);

  if (["read", "edit", "write"].includes(toolName)) {
    const absolute = normalizePathValue(resolve(cwd, argValue));
    const rel = normalizePathValue(relative(cwd, absolute));

    add(absolute);
    if (rel && rel !== ".") {
      add(rel);
      add(`./${rel}`);
    }

    if (argValue.startsWith("./")) add(argValue.slice(2));
  }

  return [...candidates];
}

function matchesAnyRuleForCandidates(
  rules: string[],
  toolName: string,
  argCandidates: string[],
): boolean {
  return rules.some((rule) => {
    const parsed = parseRule(rule);
    if (!matchPattern(parsed.toolPattern, toolName)) return false;
    if (!parsed.argPattern) return true;
    const argPattern = parsed.argPattern;
    return argCandidates.some((candidate) => matchPattern(argPattern, candidate));
  });
}

export function getMatchValue(tool: string, input: Record<string, unknown>): string | undefined {
  switch (tool) {
    case "bash":
      return input.command as string | undefined;
    case "edit":
    case "write":
    case "read":
      return input.path as string | undefined;
    case "fetch":
      return input.url as string | undefined;
    case "grep":
    case "find":
    case "ls":
      return (input.path as string | undefined) ?? "";
    case "switch_preset":
      return input.preset as string | undefined;
    default:
      return undefined;
  }
}

function skipWhitespace(command: string, index: number): number {
  while (index < command.length && /\s/.test(command[index])) index++;
  return index;
}

function readShellWord(command: string, start: number): { word: string; end: number } | undefined {
  if (start >= command.length) return undefined;
  const first = command[start];
  if (first === '"' || first === "'") {
    const quote = first;
    let value = "";
    let escaped = false;
    for (let i = start + 1; i < command.length; i++) {
      const char = command[i];
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\" && quote === '"') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        return { word: value, end: i + 1 };
      }
      value += char;
    }
    return undefined;
  }

  let value = "";
  let escaped = false;
  for (let i = start; i < command.length; i++) {
    const char = command[i];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (/\s/.test(char) || char === "&" || char === "|" || char === ";") {
      return value ? { word: value, end: i } : undefined;
    }
    value += char;
  }

  return value ? { word: value, end: command.length } : undefined;
}

function normalizeBashForPermission(command: string, cwd: string): string {
  const start = skipWhitespace(command, 0);
  if (!command.startsWith("cd", start)) return command;

  const afterCd = start + 2;
  if (afterCd < command.length && !/\s/.test(command[afterCd])) return command;

  const dirStart = skipWhitespace(command, afterCd);
  const dirToken = readShellWord(command, dirStart);
  if (!dirToken?.word) return command;

  const afterDir = skipWhitespace(command, dirToken.end);
  if (command.slice(afterDir, afterDir + 2) !== "&&") return command;

  const rest = command.slice(afterDir + 2).trim();
  if (!rest) return command;

  const targetDir = resolve(cwd, dirToken.word);
  return targetDir === cwd ? rest : command;
}

function splitShellCommand(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingle) {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (char === "|" && command[i + 1] === "|") {
        segments.push(current);
        current = "";
        i++;
        continue;
      }
      if (char === "&" && command[i + 1] === "&") {
        segments.push(current);
        current = "";
        i++;
        continue;
      }
      if (char === ";" || char === "|") {
        segments.push(current);
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function hasShellOutputRedirection(command: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (char === "&" && command[i + 1] === ">") return true;
    if (char !== ">") continue;
    if (command[i + 1] === "&" || command[i + 1] === "(") continue;

    let j = i + 1;
    if (j < command.length && command[j] === ">") j++;
    while (j < command.length && command[j] === " ") j++;
    if (command.startsWith("/dev/null", j)) continue;
    return true;
  }

  return false;
}

function resolveSingleMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
): Mode {
  const override = sessionOverrides.get(toolName);
  if (override) return override;

  const allowRules = settings.allow ?? [];
  const denyRules = settings.deny ?? [];
  const argCandidates = getArgCandidates(toolName, argValue, cwd);

  const hasSpecificAllow = allowRules.some((rule) => {
    const parsed = parseRule(rule);
    return parsed.argPattern && matchPattern(parsed.toolPattern, toolName);
  });

  if (hasSpecificAllow) {
    const matchesSpecificAllow = allowRules.some((rule) => {
      const parsed = parseRule(rule);
      if (!parsed.argPattern) return false;
      if (!matchPattern(parsed.toolPattern, toolName)) return false;
      const argPattern = parsed.argPattern;
      return argCandidates.some((candidate) => matchPattern(argPattern, candidate));
    });
    if (matchesSpecificAllow) return "allow";
  }

  if (matchesAnyRuleForCandidates(denyRules, toolName, argCandidates)) return "deny";
  if (matchesAnyRuleForCandidates(settings.ask ?? [], toolName, argCandidates)) return "ask";
  if (matchesAnyRuleForCandidates(allowRules, toolName, argCandidates)) return "allow";
  return settings.defaultMode ?? "ask";
}

export function resolveMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
): Mode {
  if (toolName !== "bash" || !argValue) {
    return resolveSingleMode(settings, toolName, argValue, cwd, sessionOverrides);
  }

  const normalized = normalizeBashForPermission(argValue, cwd);
  const segments = splitShellCommand(normalized);
  let worst: Mode = "allow";

  for (const segment of segments) {
    const mode = resolveSingleMode(settings, toolName, segment, cwd, sessionOverrides);
    if (mode === "deny") return "deny";
    if (mode === "ask") worst = "ask";
  }

  if (worst === "allow" && hasShellOutputRedirection(normalized)) return "ask";
  return worst;
}

export function generatePermissionSummary(
  settings: PermissionSettings,
  allTools: string[],
): string {
  const allowed: string[] = [];
  const ask: string[] = [];
  const denied: string[] = [];
  const conditional: string[] = [];

  for (const tool of allTools) {
    const allowRules = (settings.allow ?? []).filter((rule) => parseRule(rule).toolPattern === tool);
    const denyRules = (settings.deny ?? []).filter((rule) => parseRule(rule).toolPattern === tool);
    const askRules = (settings.ask ?? []).filter((rule) => parseRule(rule).toolPattern === tool);

    const hasArgRules = [...allowRules, ...denyRules, ...askRules].some(
      (rule) => parseRule(rule).argPattern,
    );

    if (hasArgRules) {
      const rules: string[] = [];
      if (allowRules.length) rules.push(`allow: ${allowRules.join(", ")}`);
      if (denyRules.length) rules.push(`deny: ${denyRules.join(", ")}`);
      if (askRules.length) rules.push(`ask: ${askRules.join(", ")}`);
      conditional.push(`${tool} (${rules.join(" | ")})`);
      continue;
    }

    if (denyRules.length > 0) {
      denied.push(tool);
      continue;
    }
    if (askRules.length > 0) {
      ask.push(tool);
      continue;
    }
    if (allowRules.length > 0) {
      allowed.push(tool);
      continue;
    }

    switch (settings.defaultMode) {
      case "allow":
        allowed.push(tool);
        break;
      case "deny":
        denied.push(tool);
        break;
      default:
        ask.push(tool);
        break;
    }
  }

  const lines: string[] = [
    "## Tool Permissions",
    `Default mode: \`${settings.defaultMode ?? "ask"}\``,
    "",
  ];
  if (allowed.length) lines.push(`**Auto-allowed:** ${allowed.join(", ")}`);
  if (ask.length) lines.push(`**Requires confirmation:** ${ask.join(", ")}`);
  if (denied.length) lines.push(`**Denied:** ${denied.join(", ")}`);
  if (conditional.length) lines.push(`**Conditional:** ${conditional.join("; ")}`);
  return lines.join("\n");
}

export function getPermissionModeLabel(
  settings: PermissionSettings | undefined,
  sessionOverrides: ReadonlyMap<string, Mode>,
): string {
  const normalized = normalizePermissionSettings(settings);
  const overrideCount = sessionOverrides.size;
  const base = normalized.defaultMode ?? "ask";
  return overrideCount > 0
    ? `${base} +${overrideCount} override${overrideCount > 1 ? "s" : ""}`
    : base;
}
