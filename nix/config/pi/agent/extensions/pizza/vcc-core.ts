// Based on pi-vcc by @sting8k — MIT licensed
// Ported and merged into a single module for the pizza extension.

import type { Message } from "@mariozechner/pi-ai";

// ── Types ──

export interface FileOps {
  readFiles?: string[];
  modifiedFiles?: string[];
  createdFiles?: string[];
}

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; sourceIndex?: number }
  | { kind: "tool_result"; name: string; text: string; isError: boolean; sourceIndex?: number }
  | { kind: "thinking"; text: string; redacted: boolean; sourceIndex?: number };

export interface BriefLine {
  header: string;
  lines: string[];
}

export interface TranscriptEntry {
  role: "user" | "assistant" | "tool_error";
  text?: string;
  tool?: string;
  cmd?: string;
  ref?: string;
  count?: number;
}

export interface SectionData {
  sessionGoal: string[];
  outstandingContext: string[];
  filesAndChanges: string[];
  commits: string[];
  userPreferences: string[];
  briefTranscript: string;
  transcriptEntries: TranscriptEntry[];
}

export interface CompileInput {
  messages: Message[];
  previousSummary?: string;
  fileOps?: FileOps;
}

// ── Content helpers ──

export const clip = (text: string, max = 200): string => {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  let end = cut > max * 0.6 ? cut : max;
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return text.slice(0, end);
};

export const clipSentence = (text: string, max = 200): string => {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const matches = [...window.matchAll(/[.!?](?:\s|$)/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const end = (last.index ?? 0) + 1;
    if (end >= max * 0.5) return text.slice(0, end);
  }
  return clip(text, max);
};

export const nonEmptyLines = (text: string): string[] =>
  text.split("\n").map((l) => l.trim()).filter(Boolean);

export const firstLine = (text: string, max = 200): string =>
  clip(text.split("\n")[0] ?? "", max);

export const textParts = (content: Message["content"]): string[] => {
  if (!content) return [];
  if (typeof content === "string") return [content];
  return content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text);
};

export const textOf = (content: Message["content"]): string => textParts(content).join("\n");

// ── Sanitize ──

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export const sanitize = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(ANSI_RE, "").replace(CTRL_RE, "");

// ── Normalize ──

const normalizeOne = (msg: Message, msgIndex: number): NormalizedBlock[] => {
  if (msg.role === "user") {
    const blocks: NormalizedBlock[] = [];
    const text = sanitize(textOf(msg.content));
    if (text) blocks.push({ kind: "user", text, sourceIndex: msgIndex });
    if (msg.content && typeof msg.content !== "string") {
      for (const part of msg.content) {
        if (part.type === "image") {
          blocks.push({ kind: "user", text: `[image: ${part.mimeType}]`, sourceIndex: msgIndex });
        }
      }
    }
    return blocks.length > 0 ? blocks : [{ kind: "user", text: "", sourceIndex: msgIndex }];
  }

  if (msg.role === "toolResult") {
    return [{
      kind: "tool_result",
      name: msg.toolName,
      text: sanitize(textOf(msg.content)),
      isError: msg.isError,
      sourceIndex: msgIndex,
    }];
  }

  if (msg.role === "assistant") {
    if (!msg.content) return [];
    if (typeof msg.content === "string") {
      return [{ kind: "assistant", text: sanitize(msg.content), sourceIndex: msgIndex }];
    }
    const blocks: NormalizedBlock[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        blocks.push({ kind: "assistant", text: sanitize(part.text), sourceIndex: msgIndex });
      } else if (part.type === "thinking") {
        blocks.push({ kind: "thinking", text: sanitize(part.thinking), redacted: part.redacted ?? false, sourceIndex: msgIndex });
      } else if (part.type === "toolCall") {
        blocks.push({ kind: "tool_call", name: part.name, args: part.arguments, sourceIndex: msgIndex });
      }
    }
    return blocks;
  }

  // bashExecution
  if ((msg as any).role === "bashExecution") {
    const cmd = (msg as any).command ?? "";
    const out = (msg as any).output ?? "";
    return [{ kind: "tool_result", name: "bash", text: sanitize(`$ ${cmd}\n${out}`), isError: (msg as any).exitCode !== 0, sourceIndex: msgIndex }];
  }

  return [];
};

export const normalize = (messages: Message[]): NormalizedBlock[] =>
  messages.flatMap((msg, i) => normalizeOne(msg, i));

// ── Filter noise ──

const NOISE_TOOLS = new Set([
  "TodoWrite", "TodoRead", "ToolSearch", "WebSearch",
  "AskUser", "ExitSpecMode", "GenerateDroid",
]);

const NOISE_STRINGS = [
  "Continue from where you left off.",
  "No response requested.",
  "IMPORTANT: TodoWrite was not called yet.",
];

const XML_WRAPPER_RE = /<(system-reminder|ide_opened_file|command-message|context-window-usage)[^>]*>[\s\S]*?<\/\1>/g;

const isNoiseUserBlock = (text: string): boolean => {
  const trimmed = text.trim();
  if (NOISE_STRINGS.some((s) => trimmed.includes(s))) return true;
  const stripped = trimmed.replace(XML_WRAPPER_RE, "").trim();
  return stripped.length === 0;
};

const cleanUserText = (text: string): string =>
  text.replace(XML_WRAPPER_RE, "").trim();

export const filterNoise = (blocks: NormalizedBlock[]): NormalizedBlock[] => {
  const out: NormalizedBlock[] = [];
  for (const b of blocks) {
    if (b.kind === "thinking") continue;
    if (b.kind === "tool_call" && NOISE_TOOLS.has(b.name)) continue;
    if (b.kind === "tool_result" && NOISE_TOOLS.has(b.name)) continue;
    if (b.kind === "user") {
      if (isNoiseUserBlock(b.text)) continue;
      const cleaned = cleanUserText(b.text);
      if (!cleaned) continue;
      out.push({ kind: "user", text: cleaned });
      continue;
    }
    out.push(b);
  }
  return out;
};

// ── Skill collapse ──

const SKILL_TAG_RE = /^-?\s*<skill\s+name="([^"]+)"/;
const SKILL_CLOSE_RE = /^-?\s*<\/skill>/;

const collapseSkillLines = (lines: string[]): string[] => {
  const result: string[] = [];
  const seenSkills = new Set<string>();
  let insideSkill = false;
  for (const line of lines) {
    const skillMatch = line.match(SKILL_TAG_RE);
    if (skillMatch) {
      insideSkill = true;
      const name = skillMatch[1];
      if (!seenSkills.has(name)) {
        seenSkills.add(name);
        result.push(`[skill: ${name}]`);
      }
      continue;
    }
    if (insideSkill) {
      if (SKILL_CLOSE_RE.test(line)) insideSkill = false;
      continue;
    }
    result.push(line);
  }
  return result;
};

const SKILL_BLOCK_RE = /<skill\s+name="([^"]+)"[^>]*>[\s\S]*?(?:<\/skill>|$)/g;
const collapseSkillText = (text: string): string =>
  text.replace(SKILL_BLOCK_RE, (_, name) => `[skill: ${name}]`);

// ── Extract: goals ──

const SCOPE_CHANGE_RE =
  /\b(instead|actually|change of plan|forget that|new task|switch to|now I want|pivot|let'?s do|stop .* and)\b/i;

const TASK_RE =
  /\b(fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up)\b/i;

const NOISE_SHORT_RE = /^(ok|yes|no|sure|yeah|yep|go|hi|hey|thx|thanks|ok\b.*|y|n|k)\s*[.!?]*$/i;

const NON_GOAL_RE =
  /^\s*[\[│├└─╭╰]|```|^\s*(=[A-Z]+\(|function |const |let |var |import |export |class )|^(https?:|file:|\/[A-Za-z])|\\n|^\s*For each\b|\bin full\b[^\n]*\b(comments|issue|issues|PRs?|linked)\b/;

const TEMPLATE_SIGNAL_RE =
  /^\s*(For each\b|Do NOT implement\b|Analyze and propose\b|If Task\/context\b|Output:\s*$)/i;

const MAX_GOAL_CHARS = 200;

const isSubstantiveGoal = (text: string): boolean => {
  const t = text.trim();
  if (t.length <= 5) return false;
  if (t.length > MAX_GOAL_CHARS) return false;
  if (NOISE_SHORT_RE.test(t)) return false;
  if (NON_GOAL_RE.test(t)) return false;
  return true;
};

const stripLeadingBullet = (line: string): string =>
  line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();

export const extractGoals = (blocks: NormalizedBlock[]): string[] => {
  const goals: string[] = [];
  let latestScopeChange: string[] | null = null;

  for (const b of blocks) {
    if (b.kind !== "user") continue;
    const rawLines = nonEmptyLines(b.text);
    const idx = rawLines.findIndex((l) => TEMPLATE_SIGNAL_RE.test(l));
    const lines = collapseSkillLines((idx >= 0 ? rawLines.slice(0, idx) : rawLines).filter(isSubstantiveGoal))
      .map(stripLeadingBullet)
      .filter((l) => l.length > 5);
    if (lines.length === 0) continue;

    if (goals.length === 0) {
      goals.push(...lines.slice(0, 6));
      continue;
    }

    const leading = b.text.slice(0, 200);
    if (SCOPE_CHANGE_RE.test(leading)) {
      latestScopeChange = lines.slice(0, 3).map((l) => clip(l, MAX_GOAL_CHARS));
    } else if (TASK_RE.test(leading) && lines[0].length > 15) {
      latestScopeChange = lines.slice(0, 2).map((l) => clip(l, MAX_GOAL_CHARS));
    }
  }

  if (latestScopeChange && latestScopeChange.length > 0) {
    goals.push("[Scope change]", ...latestScopeChange);
  }
  return goals.slice(0, 8);
};

// ── Extract: preferences ──

const PREF_PATTERNS = [
  /\bprefer(?:s|red|ring)?\s+\w/i,
  /\bdon'?t want\b/i,
  /\balways (?:use|do|run|prefer|keep|make|format|write|add|set|put|prefix|start|include|append)\b/i,
  /\bnever (?:use|do|run|push|commit|write|ignore|add|set|put|remove|delete|include|deploy)\b/i,
  /\bplease (?:use|avoid|keep|make|don'?t|do not|format|write)\b/i,
  /\b(?:style|format|language|naming)\s*[:=]\s*\S/i,
];

export const extractPreferences = (blocks: NormalizedBlock[]): string[] => {
  const prefs: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.kind !== "user") continue;
    let perBlock = 0;
    for (const line of nonEmptyLines(b.text)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 5) continue;
      if (trimmed.length > 200) continue;
      if (trimmed.endsWith("?") || trimmed.includes("?...")) continue;
      if (!PREF_PATTERNS.some((p) => p.test(trimmed))) continue;
      const clipped = clip(trimmed, 200);
      const key = clipped.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      prefs.push(clipped);
      if (++perBlock >= 1) break;
    }
  }
  return prefs.slice(0, 10);
};

export const dedupPreferencesAgainstGoals = (prefs: string[], goals: string[]): string[] => {
  const norm = (s: string) => s.trim().toLowerCase();
  const goalSet = new Set(goals.map(norm));
  return prefs.filter((p) => !goalSet.has(norm(p)));
};

// ── Extract: files ──

const extractPath = (args: Record<string, unknown>): string | null => {
  for (const key of ["path", "file_path", "filePath", "file"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
};

const longestCommonDirPrefix = (paths: string[]): string => {
  const abs = paths.filter((p) => p.startsWith("/"));
  if (abs.length < 2) return "";
  const split = abs.map((p) => p.split("/"));
  const min = Math.min(...split.map((s) => s.length));
  let i = 0;
  while (i < min - 1) {
    const seg = split[0][i];
    if (!split.every((s) => s[i] === seg)) break;
    i++;
  }
  if (i < 2) return "";
  return split[0].slice(0, i).join("/") + "/";
};

const trimPaths = (set: Set<string>, prefix: string): Set<string> => {
  if (!prefix) return set;
  const out = new Set<string>();
  for (const p of set) out.add(p.startsWith(prefix) ? p.slice(prefix.length) : p);
  return out;
};

export const extractFiles = (blocks: NormalizedBlock[], fileOps?: FileOps) => {
  const read = new Set(fileOps?.readFiles ?? []);
  const modified = new Set(fileOps?.modifiedFiles ?? []);
  const created = new Set(fileOps?.createdFiles ?? []);

  const FILE_READ_TOOLS = new Set(["Read", "read_file", "View"]);
  const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "edit", "write", "edit_file", "write_file", "MultiEdit"]);
  const FILE_CREATE_TOOLS = new Set(["Write", "write", "write_file"]);

  for (const b of blocks) {
    if (b.kind !== "tool_call") continue;
    const p = extractPath(b.args);
    if (!p) continue;
    if (FILE_READ_TOOLS.has(b.name)) read.add(p);
    if (FILE_WRITE_TOOLS.has(b.name)) modified.add(p);
    if (FILE_CREATE_TOOLS.has(b.name)) created.add(p);
  }

  const all = [...read, ...modified, ...created];
  const prefix = longestCommonDirPrefix(all);
  if (prefix) {
    return {
      read: trimPaths(read, prefix),
      modified: trimPaths(modified, prefix),
      created: trimPaths(created, prefix),
    };
  }
  return { read, modified, created };
};

// ── Extract: commits ──

interface CommitInfo {
  hash?: string;
  message: string;
}

const COMMIT_MSG_RE = /git\s+commit[^\n]*?-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\$?'((?:[^'\\]|\\.)*)')/;
const HASH_RE = /\b([0-9a-f]{7,12})\b/;

const cleanMessage = (msg: string): string =>
  msg.replace(/\\"/g, '"').replace(/\\'/g, "'").trim();

export const extractCommits = (blocks: NormalizedBlock[]): CommitInfo[] => {
  const commits: CommitInfo[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "tool_call" || b.name !== "bash") continue;
    const cmd = typeof b.args.command === "string" ? b.args.command : "";
    if (!/\bgit\s+commit\b/.test(cmd)) continue;
    const m = cmd.match(COMMIT_MSG_RE);
    if (!m) continue;
    const message = cleanMessage(m[1] ?? m[2] ?? m[3] ?? "").split(/\\n|\n/)[0]?.trim() ?? "";
    if (!message) continue;

    let hash: string | undefined;
    for (let j = i + 1; j < Math.min(blocks.length, i + 3); j++) {
      const r = blocks[j];
      if (r.kind !== "tool_result") continue;
      const bracket = r.text.match(/\[\S+\s+([0-9a-f]{7,12})\]/);
      if (bracket) { hash = bracket[1]; break; }
      const range = r.text.match(/\b([0-9a-f]{7,12})\.\.([0-9a-f]{7,12})\b/);
      if (range) { hash = range[2]; break; }
      const plain = r.text.match(HASH_RE);
      if (plain) { hash = plain[1]; break; }
    }

    const key = `${hash ?? ""}::${message}`;
    if (!commits.some((c) => `${c.hash ?? ""}::${c.message}` === key)) {
      commits.push({ hash, message });
    }
  }
  return commits;
};

export const formatCommits = (commits: CommitInfo[], limit = 8): string[] =>
  commits.slice(-limit).map((c) => `${c.hash ? `${c.hash}: ` : ""}${c.message}`);

// ── Build sections ──

const BLOCKER_RE =
  /\b(fail(ed|s|ure|ing)?|broken|cannot|can't|won't work|does not work|doesn't work|still (broken|failing|wrong)|blocked|blocker|not (fixed|resolved|working)|crash(es|ed|ing)?)\b/i;

const extractOutstandingContext = (blocks: NormalizedBlock[]): string[] => {
  const items: string[] = [];
  const tail = blocks.slice(-20);
  for (const b of tail) {
    if (b.kind === "tool_result" && b.isError) {
      const body = firstLine(b.text, 150);
      if (body && body !== "(no output)") items.push(`[${b.name}] ${body}`);
      continue;
    }
    if (b.kind === "assistant" || b.kind === "user") {
      for (const line of nonEmptyLines(b.text)) {
        if (!BLOCKER_RE.test(line)) continue;
        if (line.length < 15) continue;
        if (/^\s*[-*+>]\s/.test(line)) continue;
        if (/^\s*\(/.test(line)) continue;
        if (!/^\s*["'`*_]?[A-Z`]/.test(line)) continue;
        const clipped = b.kind === "user" ? `[user] ${clipSentence(line, 150)}` : clipSentence(line, 150);
        if (!items.includes(clipped)) items.push(clipped);
        break;
      }
    }
  }
  return items.slice(0, 5);
};

export const buildSections = (input: { blocks: NormalizedBlock[]; fileOps?: FileOps }): SectionData => {
  const { blocks, fileOps } = input;
  const sessionGoal = extractGoals(blocks);
  const userPreferences = dedupPreferencesAgainstGoals(extractPreferences(blocks), sessionGoal);
  const outstandingContext = extractOutstandingContext(blocks);

  const fileActivity = extractFiles(blocks, fileOps);
  for (const p of fileActivity.modified) fileActivity.created.delete(p);
  const cap = (set: Set<string>, limit: number) => {
    const arr = [...set];
    if (arr.length <= limit) return arr.join(", ");
    return arr.slice(0, limit).join(", ") + ` (+${arr.length - limit} more)`;
  };
  const filesAndChanges: string[] = [];
  if (fileActivity.modified.size > 0) filesAndChanges.push(`Modified: ${cap(fileActivity.modified, 10)}`);
  if (fileActivity.created.size > 0) filesAndChanges.push(`Created: ${cap(fileActivity.created, 10)}`);
  if (fileActivity.read.size > 0) filesAndChanges.push(`Read: ${cap(fileActivity.read, 10)}`);

  const commits = formatCommits(extractCommits(blocks));

  const briefSections = buildBriefSections(blocks);
  return {
    sessionGoal,
    outstandingContext,
    filesAndChanges,
    commits,
    userPreferences,
    briefTranscript: stringifyBrief(briefSections),
    transcriptEntries: sectionsToTranscript(briefSections),
  };
};

// ── Brief transcript ──

const TRUNCATE_USER = 256;
const TRUNCATE_ASSISTANT = 200;

const SELF_TALK_PREFIX_RE =
  /^\s*(?:hmm|wait|actually|oh|okay|ok|well|so|let me (?:try|check|see|think|look))[,.!\s-]+/i;

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

const isWord = (seg: { segment: string; isWordLike: boolean }): boolean =>
  seg.isWordLike || /[\p{L}\p{N}]/u.test(seg.segment);

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "over",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no",
  "that", "this", "these", "those", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "who", "which", "what",
  "if", "then", "than", "when", "where", "how", "just", "also",
]);

const truncateTokens = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  let count = 0;
  let lastEnd = 0;
  for (const seg of segmenter.segment(flat)) {
    if (isWord(seg)) {
      if (!STOP_WORDS.has(seg.segment.toLowerCase())) {
        count++;
        if (count > limit) {
          return flat.slice(0, lastEnd).trimEnd() + "...(truncated)";
        }
      }
    }
    lastEnd = seg.index + seg.segment.length;
  }
  return flat;
};

const BASH_CAP = 120;
const PIPE_TAIL_RE = /\s*\|\s*(?:head|tail|sort|wc|column|tr|cut|awk|uniq|python3|node|bun)(?:\s[^|]*)?$/;

const compressBash = (raw: string): string => {
  let cmd = raw.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? raw;
  cmd = cmd.replace(/^cd\s+\S+\s*&&\s*/, "");
  for (let i = 0; i < 3; i++) {
    const stripped = cmd.replace(PIPE_TAIL_RE, "");
    if (stripped === cmd) break;
    cmd = stripped;
  }
  if (cmd.length > BASH_CAP) return cmd.slice(0, BASH_CAP - 3) + "...";
  return cmd;
};

const toolOneLiner = (name: string, args: Record<string, unknown>): string => {
  const path = extractPath(args);
  if (path) return `* ${name} "${path}"`;
  if (name === "bash" || name === "Bash") {
    const raw = (args.command ?? args.description ?? "") as string;
    return `* ${name} "${compressBash(raw)}"`;
  }
  if (typeof args.query === "string") return `* ${name} "${clip(args.query as string, 60)}"`;
  return `* ${name}`;
};

export const buildBriefSections = (blocks: NormalizedBlock[]): BriefLine[] => {
  const sections: BriefLine[] = [];
  let lastHeader = "";

  const push = (header: string, line: string) => {
    if (header === lastHeader && sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
      return;
    }
    sections.push({ header, lines: [line] });
    lastHeader = header;
  };

  for (const b of blocks) {
    switch (b.kind) {
      case "user": {
        if (!b.text.trim()) break;
        const text = truncateTokens(collapseSkillText(b.text), TRUNCATE_USER);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          push("[user]", text + ref);
        }
        lastHeader = "[user]";
        break;
      }
      case "assistant": {
        let raw = b.text;
        for (let i = 0; i < 2; i++) {
          const stripped = raw.replace(SELF_TALK_PREFIX_RE, "");
          if (stripped === raw) break;
          raw = stripped;
        }
        const text = truncateTokens(raw, TRUNCATE_ASSISTANT);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          push("[assistant]", text + ref);
        }
        break;
      }
      case "tool_call": {
        if (!b.name || b.name.trim() === "") break;
        const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
        push("[assistant]", toolOneLiner(b.name, b.args) + ref);
        break;
      }
      case "tool_result": {
        if (b.isError) {
          const body = firstLine(b.text, 150);
          if (!body || body === "(no output)") break;
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          const header = `[tool_error] ${b.name}${ref}`;
          push(header, body);
          lastHeader = header;
        }
        break;
      }
      case "thinking":
        break;
    }
  }

  // Collapse consecutive identical tool lines
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const out: string[] = [];
    for (const line of sec.lines) {
      if (!line.startsWith("* ")) { out.push(line); continue; }
      const ref = line.match(/\(#(\d+)\)$/)?.[1] ?? "";
      const base = ref ? line.slice(0, -(ref.length + 3)).trimEnd() : line;
      const last = out.length > 0 ? out[out.length - 1] : "";
      const m = last.match(/^(.*) \((#[\d, #]+)\) x(\d+)$/);
      if (m && m[1] === base) {
        out[out.length - 1] = `${base} (${m[2]}, #${ref}) x${parseInt(m[3]) + 1}`;
      } else if (last.match(/\(#\d+\)$/) && last.replace(/\s*\(#\d+\)$/, "") === base) {
        const prevRef = last.match(/\(#(\d+)\)$/)?.[1];
        out[out.length - 1] = `${base} (#${prevRef}, #${ref}) x2`;
      } else {
        out.push(line);
      }
    }
    sec.lines = out;
  }

  // Cap tool calls per assistant turn — keep tail
  const TOOL_CALLS_PER_TURN = 8;
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const toolIdxs = sec.lines.map((l, i) => (l.startsWith("* ") ? i : -1)).filter((i) => i >= 0);
    if (toolIdxs.length <= TOOL_CALLS_PER_TURN) continue;
    const dropCount = toolIdxs.length - TOOL_CALLS_PER_TURN;
    const dropSet = new Set(toolIdxs.slice(0, dropCount));
    const firstKeptToolIdx = toolIdxs[dropCount];
    const next: string[] = [];
    let inserted = false;
    for (let i = 0; i < sec.lines.length; i++) {
      if (dropSet.has(i)) continue;
      if (!inserted && i === firstKeptToolIdx) {
        next.push(`* (${dropCount} earlier tool-call entries omitted)`);
        inserted = true;
      }
      next.push(sec.lines[i]);
    }
    sec.lines = next;
  }

  // Collapse consecutive identical [tool_error] sections
  const collapsedErrors: BriefLine[] = [];
  for (const sec of sections) {
    const m = sec.header.match(/^\[tool_error\]\s+(\S+?)(?:\s*\(#(\d+)\))?$/);
    if (!m || sec.lines.length !== 1) {
      collapsedErrors.push(sec);
      continue;
    }
    const tool = m[1];
    const ref = m[2];
    const body = sec.lines[0];
    const prev = collapsedErrors[collapsedErrors.length - 1];
    const prevMatch = prev?.header.match(
      /^\[tool_error\]\s+(\S+?)\s*\(((?:#\d+(?:,\s*)?)+)\)(?:\s*x(\d+))?$/,
    );
    if (prev && prevMatch && prevMatch[1] === tool && prev.lines.length === 1 && prev.lines[0] === body) {
      const refs = prevMatch[2] + (ref ? `, #${ref}` : "");
      const count = prevMatch[3] ? parseInt(prevMatch[3]) + 1 : 2;
      prev.header = `[tool_error] ${tool} (${refs}) x${count}`;
    } else {
      collapsedErrors.push(sec);
    }
  }

  return collapsedErrors;
};

export const stringifyBrief = (sections: BriefLine[]): string => {
  const out: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (i > 0) {
      const prev = sections[i - 1];
      const prevIsTools = prev.header === "[assistant]" && prev.lines.every((l) => l.startsWith("* "));
      const curIsTools = sec.header === "[assistant]" && sec.lines.every((l) => l.startsWith("* "));
      if (!(prevIsTools && curIsTools)) out.push("");
    }
    out.push(sec.header);
    for (const line of sec.lines) out.push(line);
  }
  return out.join("\n");
};

const parseToolLine = (line: string): { tool: string; cmd?: string; ref?: string; count?: number } | null => {
  const m = line.match(/^\* (\S+)\s*(?:"([^"]*)")?\s*(?:\((#[\d, #]+)\))?\s*(?:x(\d+))?$/);
  if (!m) return null;
  return { tool: m[1], cmd: m[2] || undefined, ref: m[3] || undefined, count: m[4] ? parseInt(m[4]) : undefined };
};

const extractRef = (text: string): { clean: string; ref?: string } => {
  const m = text.match(/\s*\(#(\d+)\)$/);
  if (!m) return { clean: text };
  return { clean: text.slice(0, m.index).trimEnd(), ref: `#${m[1]}` };
};

export const sectionsToTranscript = (sections: BriefLine[]): TranscriptEntry[] => {
  const entries: TranscriptEntry[] = [];
  for (const sec of sections) {
    if (sec.header === "[user]") {
      for (const line of sec.lines) {
        const { clean, ref } = extractRef(line);
        entries.push({ role: "user", text: clean, ...(ref && { ref }) });
      }
    } else if (sec.header === "[assistant]") {
      for (const line of sec.lines) {
        if (line.startsWith("* ")) {
          const parsed = parseToolLine(line);
          if (parsed) {
            entries.push({ role: "assistant", tool: parsed.tool, ...(parsed.cmd && { cmd: parsed.cmd }), ...(parsed.ref && { ref: parsed.ref }), ...(parsed.count && { count: parsed.count }) });
          } else {
            const { clean, ref } = extractRef(line.slice(2));
            entries.push({ role: "assistant", text: clean, ...(ref && { ref }) });
          }
        } else {
          const { clean, ref } = extractRef(line);
          entries.push({ role: "assistant", text: clean, ...(ref && { ref }) });
        }
      }
    } else if (sec.header.startsWith("[tool_error]")) {
      const headerMatch = sec.header.match(/^\[tool_error\]\s+(\S+)\s*(?:\(#(\d+)\))?/);
      const tool = headerMatch?.[1] ?? "unknown";
      const ref = headerMatch?.[2] ? `#${headerMatch[2]}` : undefined;
      for (const line of sec.lines) {
        entries.push({ role: "tool_error", tool, text: line, ...(ref && { ref }) });
      }
    }
  }
  return entries;
};

export const compileBrief = (blocks: NormalizedBlock[]): string =>
  stringifyBrief(buildBriefSections(blocks));

// ── Format ──

const section = (title: string, items: string[]): string => {
  if (items.length === 0) return "";
  return `[${title}]\n${items.map((i) => `- ${i}`).join("\n")}`;
};

const BRIEF_MAX_LINES = 120;

export const capBrief = (text: string): string => {
  const lines = text.split("\n");
  if (lines.length <= BRIEF_MAX_LINES) return text;
  const omitted = lines.length - BRIEF_MAX_LINES;
  const kept = lines.slice(-BRIEF_MAX_LINES);
  const firstHeader = kept.findIndex((l) => /^\[.+\]/.test(l));
  const clean = firstHeader > 0 ? kept.slice(firstHeader) : kept;
  return `...(${omitted} earlier lines omitted)\n\n${clean.join("\n")}`;
};

export const RECALL_NOTE =
  "Use `vcc_recall` to search for prior work, decisions, and context from before this summary. " +
  "Do not redo work already completed.";

export const formatSummary = (data: SectionData): string => {
  const headerParts = [
    section("Session Goal", data.sessionGoal),
    section("Files And Changes", data.filesAndChanges),
    section("Commits", data.commits),
    section("Outstanding Context", data.outstandingContext),
    section("User Preferences", data.userPreferences),
  ].filter(Boolean);

  const parts: string[] = [];
  if (headerParts.length > 0) parts.push(headerParts.join("\n\n"));
  if (data.briefTranscript) parts.push(capBrief(data.briefTranscript));

  if (parts.length === 0) return "";
  return parts.join("\n\n---\n\n");
};

// ── Summarize / compile ──

const HEADER_NAMES = ["Session Goal", "Files And Changes", "Commits", "Outstanding Context", "User Preferences"];
const SEPARATOR = "\n\n---\n\n";

const sectionOf = (text: string, header: string): string => {
  const tag = `[${header}]`;
  const start = text.indexOf(tag);
  if (start < 0) return "";
  const after = text.slice(start);
  const nextSection = HEADER_NAMES.filter((h) => h !== header).map((h) => after.indexOf(`[${h}]`)).filter((n) => n > 0);
  const nextSep = after.indexOf("\n\n---\n\n");
  const candidates = [...nextSection, ...(nextSep > 0 ? [nextSep] : [])].sort((a, b) => a - b);
  const end = candidates[0];
  return (end ? after.slice(0, end) : after).trim();
};

const briefOf = (text: string): string => {
  const idx = text.indexOf(SEPARATOR);
  if (idx < 0) return "";
  return text.slice(idx + SEPARATOR.length).trim();
};

const mergeFileLines = (prev: string, fresh: string): string => {
  const categories = ["Modified", "Created", "Read"] as const;
  const merged: Record<string, Set<string>> = {};
  for (const cat of categories) merged[cat] = new Set();
  for (const text of [prev, fresh]) {
    for (const line of text.split("\n")) {
      for (const cat of categories) {
        const prefix = `- ${cat}: `;
        if (!line.startsWith(prefix)) continue;
        let rest = line.slice(prefix.length).replace(/\s*\(\+\d+ more\)\s*$/, "");
        for (const p of rest.split(",")) {
          const trimmed = p.trim();
          if (trimmed) merged[cat].add(trimmed);
        }
      }
    }
  }
  for (const p of merged.Modified) merged.Created.delete(p);
  const cap = (set: Set<string>, limit: number) => {
    const arr = [...set];
    if (arr.length <= limit) return arr.join(", ");
    return arr.slice(0, limit).join(", ") + ` (+${arr.length - limit} more)`;
  };
  const lines: string[] = [];
  if (merged.Modified.size > 0) lines.push(`- Modified: ${cap(merged.Modified, 10)}`);
  if (merged.Created.size > 0) lines.push(`- Created: ${cap(merged.Created, 10)}`);
  if (merged.Read.size > 0) lines.push(`- Read: ${cap(merged.Read, 10)}`);
  if (lines.length === 0) return "";
  return `[Files And Changes]\n${lines.join("\n")}`;
};

const mergeHeaderSection = (header: string, prev: string, fresh: string): string => {
  if (header === "Outstanding Context") return fresh;
  if (!prev) return fresh;
  if (!fresh) return prev;

  if (header === "Files And Changes") return mergeFileLines(prev, fresh);

  const isClean = (l: string) => l.startsWith("- ") && !l.includes("<skill") && !l.includes("</skill");
  const prevLines = prev.split("\n").filter(isClean);
  const freshLines = fresh.split("\n").filter(isClean);
  const combined = [...new Set([...prevLines, ...freshLines])];
  const CAP = header === "Session Goal" ? 8 : header === "Commits" ? 8 : 15;
  const capped = combined.length > CAP ? combined.slice(-CAP) : combined;
  if (capped.length === 0) return "";
  return `[${header}]\n${capped.join("\n")}`;
};

const mergeBriefTranscript = (prev: string, fresh: string): string => {
  if (!prev) return fresh;
  if (!fresh) return prev;
  return prev + "\n\n" + fresh;
};

const mergePrevious = (prev: string, fresh: string): string => {
  const headers = HEADER_NAMES
    .map((header) => mergeHeaderSection(header, sectionOf(prev, header), sectionOf(fresh, header)))
    .filter(Boolean);

  const mergedBrief = mergeBriefTranscript(briefOf(prev), briefOf(fresh));

  const parts: string[] = [];
  if (headers.length > 0) parts.push(headers.join("\n\n"));
  if (mergedBrief) parts.push(capBrief(mergedBrief));

  return parts.join(SEPARATOR);
};

const stripRecallNote = (text: string): string => {
  const idx = text.lastIndexOf(RECALL_NOTE);
  if (idx < 0) return text;
  return text.slice(0, idx).replace(/\s*(?:\n\n---\n\n)?\s*$/, "").trimEnd();
};

export const compile = (input: CompileInput): string => {
  const blocks = filterNoise(normalize(input.messages));
  const data = buildSections({ blocks, fileOps: input.fileOps });
  const fresh = formatSummary(data);
  const prev = input.previousSummary ? stripRecallNote(input.previousSummary) : undefined;
  const merged = prev ? mergePrevious(prev, fresh) : fresh;
  if (!merged) return "";
  return merged + SEPARATOR + RECALL_NOTE;
};
