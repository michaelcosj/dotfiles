/** Pure helpers for generate-title. No Pi runtime imports, so bun test can load them. */

export const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = (typeof THINKING_LEVELS)[number] | "off";

export interface TitleConfig {
  /** provider/model-id. Undefined: use the session's active model. */
  model?: string;
  thinking: Thinking;
  /** Title the session after the first user message. */
  auto: boolean;
}

export const DEFAULT_CONFIG: TitleConfig = { model: "claude-code/claude-haiku-5-5", thinking: "medium", auto: true };

const isThinking = (v: unknown): v is Thinking => v === "off" || (THINKING_LEVELS as readonly unknown[]).includes(v);

/** Parse "provider/model[:thinking]". The model id can contain "/" and ":" is only a thinking suffix if valid. */
export function parseModelSpec(spec: string): { model?: string; thinking?: Thinking } {
  const value = spec.trim();
  if (!value) return {};
  const colon = value.lastIndexOf(":");
  if (colon > 0 && isThinking(value.slice(colon + 1))) {
    const model = value.slice(0, colon);
    return { model: model || undefined, thinking: value.slice(colon + 1) as Thinking };
  }
  return { model: value };
}

export function splitModel(model: string): { provider: string; id: string } | undefined {
  const slash = model.indexOf("/");
  return slash > 0 && slash < model.length - 1 ? { provider: model.slice(0, slash), id: model.slice(slash + 1) } : undefined;
}

/** File config, then PI_TITLE_MODEL ("provider/model[:thinking]") overrides it. Bad values fall back to defaults. */
export function resolveConfig(raw: string | undefined, env: string | undefined): TitleConfig {
  const config: TitleConfig = { ...DEFAULT_CONFIG };
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (typeof data?.model === "string") config.model = data.model.trim() || undefined;
      if (data?.model === null) config.model = undefined;
      if (isThinking(data?.thinking)) config.thinking = data.thinking;
      if (typeof data?.auto === "boolean") config.auto = data.auto;
    } catch {}
  }
  if (env) {
    const spec = parseModelSpec(env);
    if (spec.model) config.model = spec.model;
    if (spec.thinking) config.thinking = spec.thinking;
  }
  return config;
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

const MAX_CONVERSATION_CHARS = 24_000;

export function conversationFromBranch(branch: readonly unknown[]): string {
  const messages: string[] = [];
  for (const entry of branch as { type?: string; message?: { role?: string; content?: unknown } }[]) {
    if (entry?.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textFromContent(entry.message?.content).trim();
    if (text) messages.push(`${role}: ${text}`);
  }
  return messages.join("\n\n").slice(-MAX_CONVERSATION_CHARS);
}

export function titlePrompt(conversation: string): string {
  return [
    "Generate a concise title for this coding-agent session.",
    "Use 3-8 words, plain text only. Do not use quotes, markdown, or ending punctuation.",
    "Describe the main task rather than the latest incidental detail.",
    "Reply with the title only.",
    "",
    "<conversation>",
    conversation,
    "</conversation>",
  ].join("\n");
}

export function cleanTitle(value: string): string {
  const line = value.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return [...line
    .replace(/^#+\s*/, "")
    .replace(/^(title|session title)\s*:\s*/i, "")
    .replace(/^["'`*_]+|["'`*_]+$/g, "")
    .replace(/[.!:;]+$/, "")
    .replace(/\s+/g, " ")
    .trim()]
    .slice(0, 80)
    .join("")
    .trim();
}

/** Rex refuses labels over 128 characters (code points) and labels with newlines. */
export const REX_LABEL_MAX = 128;
export const REX_LABEL_PREFIX = "π - ";

export function rexLabel(title: string): string {
  const clean = title.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  return [...`${REX_LABEL_PREFIX}${clean}`].slice(0, REX_LABEL_MAX).join("").trimEnd();
}
