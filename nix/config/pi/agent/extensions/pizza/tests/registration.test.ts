import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const entrypointPath = fileURLToPath(new URL("../index.ts", import.meta.url));

const majorTools = [
  "bg_start",
  "bg_status",
  "bg_wait",
  "bg_list",
  "bg_kill",
  "subagent_spawn",
  "subagent_send",
  "subagent_wait",
  "subagent_cancel",
  "subagent_check",
  "subagent_list",
  "questionnaire",
];

const majorCommands = ["ps", "subagents", "btw", "copy-all"];

describe("Pizza registration", () => {
  it("loads the root index through Pi's public loader and composes every major feature", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pizza-loader-"));
    try {
      const result = await discoverAndLoadExtensions(
        [entrypointPath],
        dirname(entrypointPath),
        agentDir,
      );

      expect(result.errors).toEqual([]);
      expect(result.extensions).toHaveLength(1);
      const extension = result.extensions[0]!;
      expect([...extension.tools.keys()]).toEqual(expect.arrayContaining(majorTools));
      expect([...extension.commands.keys()]).toEqual(expect.arrayContaining(majorCommands));
      expect(extension.handlers.has("session_start")).toBe(true);
      expect(extension.handlers.has("session_shutdown")).toBe(true);
      expect(extension.messageRenderers.has("subagent-result")).toBe(true);
      expect(extension.messageRenderers.has("background-terminal-result")).toBe(true);
      expect(extension.entryRenderers?.has("btw-result")).toBe(true);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
