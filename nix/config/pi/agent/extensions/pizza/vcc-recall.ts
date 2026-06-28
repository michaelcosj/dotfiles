import { readFile } from "node:fs/promises";
import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ── Types ──

export interface RenderedEntry {
  index: number;
  role: string;
  summary: string;
  files?: string[];
}

export interface SearchHit extends RenderedEntry {
  snippet?: string;
  matchCount?: number;
}

// ── Load messages ──

async function loadAllMessages(sessionFile: string, full = false): Promise<{ rendered: RenderedEntry[]; rawMessages: Message[] }> {
  const content = await readFile(sessionFile, "utf-8");
  const entries: any[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }
  const messageEntries = entries.filter((e) => e.type === "message" && e.message);
  const rendered = messageEntries.map((e, i) => renderMessage(e.message, i, full));
  const rawMessages = messageEntries.map((e) => e.message);
  return { rendered, rawMessages };
}

// ── Render entries ──

function textParts(content: Message["content"]): string[] {
  if (!content) return [];
  if (typeof content === "string") return [content];
  return content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text);
}

function textOf(content: Message["content"]): string {
  return textParts(content).join("\n");
}

function clip(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  let end = cut > max * 0.6 ? cut : max;
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return text.slice(0, end);
}

function extractPath(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filePath", "file"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

function toolCalls(content: Message["content"]): string {
  if (!content || typeof content === "string") return "";
  return content
    .filter((c) => c.type === "toolCall")
    .map((c) => `${c.name}(${extractPath(c.arguments) ?? (typeof c.arguments?.query === "string" ? c.arguments.query : Object.keys(c.arguments ?? {}).join(", "))})`)
    .join(", ");
}

function extractFilesFromContent(content: Message["content"]): string[] {
  if (!content || typeof content === "string") return [];
  return content
    .filter((c) => c.type === "toolCall")
    .map((c) => extractPath(c.arguments))
    .filter((p): p is string => p !== null);
}

function renderMessage(msg: Message, index: number, full = false): RenderedEntry {
  if (msg.role === "user") {
    return { index, role: "user", summary: full ? textOf(msg.content) : clip(textOf(msg.content), 300) };
  }
  if (msg.role === "toolResult") {
    const prefix = msg.isError ? "ERROR " : "";
    const text = full ? textOf(msg.content) : clip(textOf(msg.content), 200);
    return { index, role: "tool_result", summary: `${prefix}[${msg.toolName}] ${text}` };
  }
  if ((msg as any).role === "bashExecution") {
    const cmd = (msg as any).command ?? "";
    const out = (msg as any).output ?? "";
    const text = full ? `$ ${cmd}\n${out}` : clip(`$ ${cmd}\n${out}`, 300);
    return { index, role: "bash", summary: text };
  }
  const text = full ? textOf(msg.content) : clip(textOf(msg.content), 300);
  const tools = toolCalls(msg.content);
  const files = extractFilesFromContent(msg.content);
  const summary = tools ? `${tools}\n${text}` : text;
  return { index, role: "assistant", summary, ...(files.length > 0 && { files }) };
}

// ── Search ──

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const safeRegex = (pattern: string): RegExp => {
  try { return new RegExp(pattern, "i"); }
  catch { return new RegExp(escapeRegex(pattern), "i"); }
};

const looksLikeRegex = (query: string): boolean => /[|*+?{}()[\]\\^$.]/.test(query);

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "of", "in", "to", "for",
  "with", "on", "at", "from", "by", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "about", "it", "its", "that",
  "this", "what", "which", "who", "whom", "these", "those",
]);

const filterStopwords = (terms: string[]): string[] => {
  const meaningful = terms.filter((t) => !STOPWORDS.has(t.toLowerCase()) && t.length > 1);
  return meaningful.length > 0 ? meaningful : terms;
};

const countMatches = (hay: string, terms: string[]): number => {
  let count = 0;
  for (const t of terms) {
    if (safeRegex(t).test(hay)) count++;
  }
  return count;
};

const termFreq = (text: string, pattern: RegExp): number => {
  const matches = text.match(new RegExp(pattern.source, "gi"));
  return matches ? matches.length : 0;
};

const BM25_K = 1.2;
const BM25_B = 0.75;

interface BM25Context {
  n: number;
  avgDl: number;
  df: Map<string, number>;
}

const buildBM25Context = (docs: string[], terms: string[]): BM25Context => {
  const n = docs.length;
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.split(/\s+/).length;
    for (const t of terms) {
      if (safeRegex(t).test(doc)) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return { n, avgDl: totalLen / Math.max(n, 1), df };
};

const bm25Score = (doc: string, terms: string[], ctx: BM25Context): number => {
  const dl = doc.split(/\s+/).length;
  let score = 0;
  for (const t of terms) {
    const tf = termFreq(doc, safeRegex(t));
    if (tf === 0) continue;
    const docFreq = ctx.df.get(t) ?? 0;
    const idf = Math.log((ctx.n - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const tfNorm = (tf * (BM25_K + 1)) / (tf + BM25_K * (1 - BM25_B + BM25_B * dl / ctx.avgDl));
    score += idf * tfNorm;
  }
  return score;
};

const lineSnippet = (text: string, regex: RegExp, contextLines = 2): string | undefined => {
  const lines = text.split("\n");
  let matchIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) { matchIdx = i; break; }
  }
  if (matchIdx === -1) return undefined;
  const start = Math.max(0, matchIdx - contextLines);
  const end = Math.min(lines.length, matchIdx + contextLines + 1);
  const slice = lines.slice(start, end);
  const parts: string[] = [];
  if (start > 0) parts.push(`...(${start} lines above)`);
  parts.push(...slice);
  if (end < lines.length) parts.push(`...(${lines.length - end} lines below)`);
  return parts.join("\n");
};

const fullText = (msg: Message): string => {
  if ((msg as any).role === "bashExecution") {
    return `${(msg as any).command ?? ""} ${(msg as any).output ?? ""}`;
  }
  return textOf(msg.content);
};

const snippetRegex = (terms: string[]): RegExp => {
  const alts = terms.map((t) => {
    try { new RegExp(t, "i"); return t; }
    catch { return escapeRegex(t); }
  });
  return new RegExp(alts.join("|"), "i");
};

export function searchEntries(
  entries: RenderedEntry[],
  messages: Message[],
  query?: string,
): SearchHit[] {
  if (!query?.trim()) return entries;

  const rawQuery = query.trim();

  if (looksLikeRegex(rawQuery)) {
    const regex = safeRegex(rawQuery);
    const hits: SearchHit[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const msg = messages[i];
      const text = msg ? fullText(msg) : e.summary;
      const filePart = e.files?.join(" ") ?? "";
      const hay = `${e.role} ${text} ${filePart}`;
      if (regex.test(hay)) {
        const snip = lineSnippet(text, regex);
        hits.push({ ...e, snippet: snip, matchCount: 1 });
      }
    }
    return hits;
  }

  const rawTerms = rawQuery.split(/\s+/);
  const terms = filterStopwords(rawTerms);
  const snipRe = snippetRegex(terms);

  const docs: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const msg = messages[i];
    const text = msg ? fullText(msg) : e.summary;
    const filePart = e.files?.join(" ") ?? "";
    docs.push(`${e.role} ${text} ${filePart}`);
  }

  const ctx = buildBM25Context(docs, terms);

  const scored: Array<{ hit: SearchHit; score: number }> = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const hay = docs[i];
    const mc = countMatches(hay, terms);
    if (mc === 0) continue;
    const score = bm25Score(hay, terms, ctx);
    const text = messages[i] ? fullText(messages[i]) : e.summary;
    const snip = lineSnippet(text, snipRe);
    scored.push({ hit: { ...e, snippet: snip, matchCount: mc }, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.hit);
}

// ── Format ──

const formatRecallOutput = (
  entries: SearchHit[],
  query?: string,
  headerOverride?: string,
): string => {
  if (entries.length === 0) {
    return query
      ? `No matches for "${query}" in session history.`
      : "No entries in session history.";
  }

  const header = headerOverride
    ? `${headerOverride} for "${query}":`
    : query
      ? `Found ${entries.length} matches for "${query}":`
      : `Session history (${entries.length} entries):`;

  const lines = entries.map((e) => {
    const fileSuffix = e.files?.length ? ` files:[${e.files.join(", ")}]` : "";
    const body = query && e.snippet ? e.snippet : e.summary;
    return `#${e.index} [${e.role}]${fileSuffix} ${body}`;
  });

  return `${header}\n\n${lines.join("\n\n")}`;
};

// ── Register recall system ──

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;

interface RecallResult {
  output: string;
  header?: string;
}

async function searchRecall(
  sessionFile: string,
  opts: { query?: string; expand?: number[]; page?: number },
): Promise<RecallResult> {
  const expandSet = new Set(opts.expand ?? []);
  const hasExpand = expandSet.size > 0;

  if (hasExpand && !opts.query) {
    const { rendered: fullMsgs } = await loadAllMessages(sessionFile, true);
    const expanded = fullMsgs.filter((m) => expandSet.has(m.index));
    if (expanded.length === 0) {
      return { output: `No entries found for indices: ${[...expandSet].join(", ")}` };
    }
    return { output: formatRecallOutput(expanded) };
  }

  const { rendered: msgs, rawMessages } = await loadAllMessages(sessionFile, false);
  const allResults = opts.query?.trim()
    ? searchEntries(msgs, rawMessages, opts.query)
    : msgs.slice(-DEFAULT_RECENT);

  if (opts.query?.trim()) {
    const page = Math.max(1, opts.page ?? 1);
    const start = (page - 1) * PAGE_SIZE;
    const pageResults = allResults.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
    const header = totalPages > 1
      ? `Page ${page}/${totalPages} (${allResults.length} total matches)`
      : `${allResults.length} matches`;
    const footer = page < totalPages
      ? `\n--- Use page:${page + 1} for more results ---`
      : "";
    return { output: formatRecallOutput(pageResults, opts.query, header) + footer, header };
  }

  return { output: formatRecallOutput(allResults, opts.query) };
}

export function registerVccRecallExtension(pi: ExtensionAPI) {
  // 1) Tool
  pi.registerTool({
    name: "vcc_recall",
    label: "VCC Recall",
    description:
      "Search full conversation history in this session, including before compaction. " +
      "Use without query to see recent brief history. " +
      "Use with query to search all history. Query supports regex (e.g. 'hook|inject', 'fail.*build'). " +
      "Multi-word queries use OR logic ranked by relevance. " +
      "Use expand with entry indices to get full content.",
    promptSnippet: "vcc_recall: Search full conversation history including compacted parts.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Search terms or regex pattern" })),
      expand: Type.Optional(Type.Array(Type.Number(), { description: "Entry indices to return full untruncated content for" })),
      page: Type.Optional(Type.Number({ description: "Page number (1-based). Default: 1." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        return { content: [{ type: "text", text: "No session file available." }], details: undefined };
      }

      const { output } = await searchRecall(sessionFile, {
        query: params.query,
        expand: params.expand,
        page: params.page,
      });
      return { content: [{ type: "text", text: output }], details: undefined };
    },
  });

  // 2) Command
  pi.registerCommand("vcc-recall", {
    description: "Search conversation history (same as vcc_recall tool). Usage: /vcc-recall <query> [page:N]",
    handler: async (args: string, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No session file available.", "error");
        return;
      }

      const raw = args.trim();
      if (!raw) {
        const { output } = await searchRecall(sessionFile, {});
        pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
        return;
      }

      const pageMatch = raw.match(/\bpage:(\d+)\b/i);
      const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
      const query = raw.replace(/\bpage:\d+\b/i, "").trim();

      if (!query) {
        const { output } = await searchRecall(sessionFile, {});
        pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
        return;
      }

      const { output } = await searchRecall(sessionFile, { query, page });
      pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
    },
  });
}
