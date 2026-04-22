import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

function buildPreview(content: string): { preview: string; lines: number; length: number } {
  const lines = content.split("\n");
  const preview = lines.slice(0, 50).join("\n");
  return {
    preview,
    lines: lines.length,
    length: content.length,
  };
}

export function registerDdgsExtension(pi: ExtensionAPI) {
  const liveTempDirs = new Set<string>();

  pi.on("session_shutdown", async () => {
    await Promise.all(Array.from(liveTempDirs).map((dir) => cleanupDir(dir)));
    liveTempDirs.clear();
  });

  pi.registerTool({
    name: "search_text",
    label: "Search Text",
    description:
      "Web text search using DuckDuckGo (ddgs text). Returns search results with title, href, and body.",
    parameters: Type.Object({
      query: Type.String({ description: "Text search query" }),
      max_results: Type.Optional(Type.Number({ description: "Maximum number of results" })),
      page: Type.Optional(Type.Number({ description: "Page number of results" })),
    }),
    async execute(_toolCallId, params, signal) {
      const tmpDir = await mkdtemp(join(tmpdir(), "ddgs-search-"));
      liveTempDirs.add(tmpDir);
      const outputPath = join(tmpDir, "results.csv");

      const args = ["text", "-o", outputPath, "-s", "moderate", "-b", "auto", "-q", params.query];
      if (params.max_results) args.push("-m", params.max_results.toString());
      if (params.page) args.push("-p", params.page.toString());

      const result = await pi.exec("ddgs", args, { signal });
      if (result.code !== 0) {
        await cleanupDir(tmpDir);
        liveTempDirs.delete(tmpDir);
        throw new Error(`ddgs text failed: ${result.stderr || "unknown error"}`);
      }

      const content = await readFile(outputPath, "utf8");
      const { preview, lines, length } = buildPreview(content);

      return {
        content: [
          {
            type: "text",
            text: `${preview}${lines > 50 ? "\n..." : ""} (lines: ${lines}, length: ${length} chars)\ntool output saved in ${outputPath}`,
          },
        ],
        details: { outputPath },
      };
    },
  });

  pi.registerTool({
    name: "extract_content",
    label: "Extract Content",
    description:
      "Extract markdown content from a URL using DuckDuckGo (ddgs extract). Saves formatted markdown to temp file and returns the file path.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract content from" }),
    }),
    async execute(_toolCallId, params, signal) {
      const tmpDir = await mkdtemp(join(tmpdir(), "ddgs-extract-"));
      liveTempDirs.add(tmpDir);

      const outputPath = join(tmpDir, "content.md");
      const jsonPath = join(tmpDir, "raw.json");

      const args = ["extract", "-o", jsonPath, "-f", "text_markdown", "-u", params.url];
      const result = await pi.exec("ddgs", args, { signal });
      if (result.code !== 0) {
        await cleanupDir(tmpDir);
        liveTempDirs.delete(tmpDir);
        throw new Error(`ddgs extract failed: ${result.stderr || "unknown error"}`);
      }

      const rawJson = await readFile(jsonPath, "utf8");
      const extracted = JSON.parse(rawJson) as Array<{ url: string; content: string }>;
      const formatted = extracted
        .map((item) => `# ${item.url}\n${item.content}`)
        .join("\n\n---\n\n");
      await writeFile(outputPath, formatted, "utf8");

      const { preview, lines, length } = buildPreview(formatted);
      return {
        content: [
          {
            type: "text",
            text: `${preview}${lines > 50 ? "\n..." : ""} (lines: ${lines}, length: ${length} chars)\ntool output saved in ${outputPath}`,
          },
        ],
        details: { outputPath },
      };
    },
  });
}
