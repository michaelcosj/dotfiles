import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { LoadedPresets, Mode, PermissionSettings, Preset, PresetsConfig } from "./preset-types.js";

export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = { defaultMode: "ask" };

interface PresetsFile {
  defaultPreset?: string;
  defaultMode?: string;
  default?: string;
  permission?: PermissionSettings;
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

export function canonicalPermissionToolName(toolName: string): string {
  return toolName === "write" ? "edit" : toolName;
}

export function loadPresets(cwd: string): LoadedPresets {
  const globalPath = join(getAgentDir(), "presets.json");
  const projectPath = join(cwd, ".pi", "presets.json");
  const reservedKeys = new Set(["default", "defaultPreset", "defaultMode", "permission", "presets"]);

  function parseFile(filePath: string): {
    presets: PresetsConfig;
    defaultPreset: string | undefined;
    defaultMode: Mode | undefined;
    globalPermission: PermissionSettings | undefined;
  } {
    let presets: PresetsConfig = {};
    let defaultPreset: string | undefined;
    let defaultMode: Mode | undefined;
    let globalPermission: PermissionSettings | undefined;

    if (!existsSync(filePath)) return { presets, defaultPreset, defaultMode, globalPermission };

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
      if (raw.permission && typeof raw.permission === "object" && !Array.isArray(raw.permission)) {
        globalPermission = raw.permission;
      }
    } catch (err) {
      console.error(`Failed to load presets from ${filePath}: ${err}`);
    }

    return { presets, defaultPreset, defaultMode, globalPermission };
  }

  const globalResult = parseFile(globalPath);
  const projectResult = parseFile(projectPath);

  return {
    presets: { ...globalResult.presets, ...projectResult.presets },
    defaultPreset: projectResult.defaultPreset ?? globalResult.defaultPreset,
    defaultMode: projectResult.defaultMode ?? globalResult.defaultMode ?? "ask",
    globalPermission: projectResult.globalPermission ?? globalResult.globalPermission,
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

function getRuleToolPattern(rule: string): string {
  return canonicalPermissionToolName(parseRule(rule).toolPattern);
}

function mergeRuleList(
  presetRules: string[] | undefined,
  globalRules: string[] | undefined,
  presetCoveredTools: ReadonlySet<string>,
): string[] {
  const merged = [...(presetRules ?? [])];
  for (const rule of globalRules ?? []) {
    if (presetCoveredTools.has(getRuleToolPattern(rule))) continue;
    merged.push(rule);
  }
  return merged;
}

export function mergePermissionSettings(
  preset: PermissionSettings | undefined,
  global: PermissionSettings | undefined,
  rootDefaultMode: Mode = "ask",
): PermissionSettings {
  const presetCoveredTools = new Set<string>([
    ...(preset?.allow ?? []).map(getRuleToolPattern),
    ...(preset?.deny ?? []).map(getRuleToolPattern),
    ...(preset?.ask ?? []).map(getRuleToolPattern),
  ]);

  return {
    defaultMode: preset?.defaultMode ?? global?.defaultMode ?? rootDefaultMode,
    allow: mergeRuleList(preset?.allow, global?.allow, presetCoveredTools),
    deny: mergeRuleList(preset?.deny, global?.deny, presetCoveredTools),
    ask: mergeRuleList(preset?.ask, global?.ask, presetCoveredTools),
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
  const canonicalTool = canonicalPermissionToolName(toolName);
  return (settings.allow ?? [])
    .filter((rule) => {
      const parsed = parseRule(rule);
      return parsed.toolPattern === canonicalTool && parsed.argPattern;
    })
    .map((rule) => {
      const parsed = parseRule(rule);
      return `${canonicalTool}(${parsed.argPattern!})`;
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

  if (["read", "edit"].includes(toolName)) {
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

function matchRules(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  cwd: string,
): Mode | undefined {
  const canonicalToolName = canonicalPermissionToolName(toolName);
  const allowRules = settings.allow ?? [];
  const denyRules = settings.deny ?? [];
  const argCandidates = getArgCandidates(canonicalToolName, argValue, cwd);

  const hasSpecificAllow = allowRules.some((rule) => {
    const parsed = parseRule(rule);
    return parsed.argPattern && matchPattern(parsed.toolPattern, canonicalToolName);
  });

  if (hasSpecificAllow) {
    const matchesSpecificAllow = allowRules.some((rule) => {
      const parsed = parseRule(rule);
      if (!parsed.argPattern) return false;
      if (!matchPattern(parsed.toolPattern, canonicalToolName)) return false;
      const argPattern = parsed.argPattern;
      return argCandidates.some((candidate) => matchPattern(argPattern, candidate));
    });
    if (matchesSpecificAllow) return "allow";
  }

  if (matchesAnyRuleForCandidates(denyRules, canonicalToolName, argCandidates)) return "deny";
  if (matchesAnyRuleForCandidates(settings.ask ?? [], canonicalToolName, argCandidates)) return "ask";
  if (matchesAnyRuleForCandidates(allowRules, canonicalToolName, argCandidates)) return "allow";
  return undefined;
}

function resolveDefaultMode(
  presetSettings: PermissionSettings | undefined,
  globalSettings: PermissionSettings | undefined,
  rootDefaultMode: Mode,
): Mode {
  return presetSettings?.defaultMode ?? globalSettings?.defaultMode ?? rootDefaultMode;
}

function resolveSingleMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
): Mode {
  const canonicalToolName = canonicalPermissionToolName(toolName);
  const override = sessionOverrides.get(canonicalToolName);
  if (override) return override;
  return matchRules(settings, canonicalToolName, argValue, cwd) ?? (settings.defaultMode ?? "ask");
}

function resolveEffectiveSingleMode(
  presetSettings: PermissionSettings | undefined,
  globalSettings: PermissionSettings | undefined,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
  rootDefaultMode: Mode,
): Mode {
  const canonicalToolName = canonicalPermissionToolName(toolName);
  const override = sessionOverrides.get(canonicalToolName);
  if (override) return override;

  const presetMode = presetSettings ? matchRules(presetSettings, canonicalToolName, argValue, cwd) : undefined;
  if (presetMode) return presetMode;

  const globalMode = globalSettings ? matchRules(globalSettings, canonicalToolName, argValue, cwd) : undefined;
  if (globalMode) return globalMode;

  return resolveDefaultMode(presetSettings, globalSettings, rootDefaultMode);
}

export function resolveMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
  sessionBashAllowPatterns: readonly string[] = [],
): Mode {
  const canonicalToolName = canonicalPermissionToolName(toolName);
  if (canonicalToolName !== "bash" || !argValue) {
    return resolveSingleMode(settings, canonicalToolName, argValue, cwd, sessionOverrides);
  }

  const normalized = normalizeBashForPermission(argValue, cwd);
  const segments = splitShellCommand(normalized);
  let worst: Mode = "allow";

  for (const segment of segments) {
    const hasSessionAllow = sessionBashAllowPatterns.some((pattern) => matchPattern(pattern, segment));
    const mode = hasSessionAllow
      ? "allow"
      : resolveSingleMode(settings, canonicalToolName, segment, cwd, sessionOverrides);
    if (mode === "deny") return "deny";
    if (mode === "ask") worst = "ask";
  }

  if (worst === "allow" && hasShellOutputRedirection(normalized)) {
    return resolveSingleMode(settings, "edit", "", cwd, sessionOverrides) === "allow" ? "allow" : "ask";
  }

  return worst;
}

export function resolveEffectiveMode(
  presetSettings: PermissionSettings | undefined,
  globalSettings: PermissionSettings | undefined,
  toolName: string,
  argValue: string,
  cwd: string,
  sessionOverrides: ReadonlyMap<string, Mode>,
  rootDefaultMode: Mode,
  sessionBashAllowPatterns: readonly string[] = [],
): Mode {
  const canonicalToolName = canonicalPermissionToolName(toolName);
  if (canonicalToolName !== "bash" || !argValue) {
    return resolveEffectiveSingleMode(
      presetSettings,
      globalSettings,
      canonicalToolName,
      argValue,
      cwd,
      sessionOverrides,
      rootDefaultMode,
    );
  }

  const normalized = normalizeBashForPermission(argValue, cwd);
  const segments = splitShellCommand(normalized);
  let worst: Mode = "allow";

  for (const segment of segments) {
    const hasSessionAllow = sessionBashAllowPatterns.some((pattern) => matchPattern(pattern, segment));
    const mode = hasSessionAllow
      ? "allow"
      : resolveEffectiveSingleMode(
          presetSettings,
          globalSettings,
          canonicalToolName,
          segment,
          cwd,
          sessionOverrides,
          rootDefaultMode,
        );
    if (mode === "deny") return "deny";
    if (mode === "ask") worst = "ask";
  }

  if (worst === "allow" && hasShellOutputRedirection(normalized)) {
    return resolveEffectiveSingleMode(
      presetSettings,
      globalSettings,
      "edit",
      "",
      cwd,
      sessionOverrides,
      rootDefaultMode,
    ) === "allow"
      ? "allow"
      : "ask";
  }

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
  const seenTools = new Set<string>();

  for (const tool of allTools) {
    const canonicalTool = canonicalPermissionToolName(tool);
    if (seenTools.has(canonicalTool)) continue;
    seenTools.add(canonicalTool);

    const allowRules = (settings.allow ?? []).filter((rule) => parseRule(rule).toolPattern === canonicalTool);
    const denyRules = (settings.deny ?? []).filter((rule) => parseRule(rule).toolPattern === canonicalTool);
    const askRules = (settings.ask ?? []).filter((rule) => parseRule(rule).toolPattern === canonicalTool);

    const hasArgRules = [...allowRules, ...denyRules, ...askRules].some(
      (rule) => parseRule(rule).argPattern,
    );

    if (hasArgRules) {
      const rules: string[] = [];
      if (allowRules.length) rules.push(`allow: ${allowRules.join(", ")}`);
      if (denyRules.length) rules.push(`deny: ${denyRules.join(", ")}`);
      if (askRules.length) rules.push(`ask: ${askRules.join(", ")}`);
      conditional.push(`${canonicalTool} (${rules.join(" | ")})`);
      continue;
    }

    if (denyRules.length > 0) {
      denied.push(canonicalTool);
      continue;
    }
    if (askRules.length > 0) {
      ask.push(canonicalTool);
      continue;
    }
    if (allowRules.length > 0) {
      allowed.push(canonicalTool);
      continue;
    }

    switch (settings.defaultMode) {
      case "allow":
        allowed.push(canonicalTool);
        break;
      case "deny":
        denied.push(canonicalTool);
        break;
      default:
        ask.push(canonicalTool);
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
  extraOverrideCount = 0,
): string {
  const normalized = normalizePermissionSettings(settings);
  const overrideCount = sessionOverrides.size + extraOverrideCount;
  const base = normalized.defaultMode ?? "ask";
  return overrideCount > 0
    ? `${base} +${overrideCount} override${overrideCount > 1 ? "s" : ""}`
    : base;
}
