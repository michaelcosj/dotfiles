import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generatePermissionSummary,
  loadPresets,
  mergePermissionSettings,
  resolveEffectiveMode,
  resolveMode,
} from "../preset-permissions.ts";

describe("preset-permissions", () => {
  it("treats write tool as edit permission", () => {
    const allowEdit = resolveMode(
      { defaultMode: "ask", allow: ["edit"] },
      "write",
      "foo.ts",
      "/tmp",
      new Map(),
    );
    expect(allowEdit).toBe("allow");

    const denyEdit = resolveMode(
      { defaultMode: "ask", deny: ["edit"] },
      "write",
      "foo.ts",
      "/tmp",
      new Map(),
    );
    expect(denyEdit).toBe("deny");
  });

  it("allows bash redirection when edit is allow", () => {
    const mode = resolveMode(
      { defaultMode: "ask", allow: ["bash", "edit"] },
      "bash",
      "echo hi >> out.txt",
      "/tmp",
      new Map(),
    );

    expect(mode).toBe("allow");
  });

  it("asks for bash redirection when edit is not allow", () => {
    const mode = resolveMode(
      { defaultMode: "ask", allow: ["bash"], deny: ["edit"] },
      "bash",
      "echo hi >> out.txt",
      "/tmp",
      new Map(),
    );

    expect(mode).toBe("ask");
  });

  it("supports session bash allow patterns", () => {
    const mode1 = resolveMode(
      { defaultMode: "ask" },
      "bash",
      "grep foo src/file.ts",
      "/tmp",
      new Map(),
      ["grep *"],
    );
    const mode2 = resolveMode(
      { defaultMode: "ask" },
      "bash",
      "grep -R bar src",
      "/tmp",
      new Map(),
      ["grep *"],
    );
    const mode3 = resolveMode(
      { defaultMode: "ask" },
      "bash",
      "awk '{print $1}' file.txt",
      "/tmp",
      new Map(),
      ["grep *"],
    );

    expect(mode1).toBe("allow");
    expect(mode2).toBe("allow");
    expect(mode3).toBe("ask");
  });

  it("permission summary shows only edit, not write", () => {
    const summary = generatePermissionSummary(
      { defaultMode: "ask", allow: ["edit"] },
      ["read", "edit", "write", "bash"],
    );

    expect(summary).toContain("edit");
    expect(summary).not.toContain("write");
  });

  it("global allow overrides preset default deny when preset does not mention tool", () => {
    const mode = resolveEffectiveMode(
      { defaultMode: "deny" },
      { defaultMode: "ask", allow: ["vcc_recall"] },
      "vcc_recall",
      "",
      "/tmp",
      new Map(),
      "ask",
    );

    expect(mode).toBe("allow");
  });

  it("preset explicit rule overrides global rule for same tool", () => {
    const mode = resolveEffectiveMode(
      { defaultMode: "deny", deny: ["vcc_recall"] },
      { defaultMode: "allow", allow: ["vcc_recall"] },
      "vcc_recall",
      "",
      "/tmp",
      new Map(),
      "ask",
    );

    expect(mode).toBe("deny");
  });

  it("merged permissions keep preset rules and inherit global rules for untouched tools", () => {
    const merged = mergePermissionSettings(
      { defaultMode: "deny", allow: ["read"], deny: ["edit"] },
      { defaultMode: "ask", allow: ["vcc_recall", "edit"], ask: ["bash"] },
      "ask",
    );

    expect(resolveMode(merged, "read", "", "/tmp", new Map())).toBe("allow");
    expect(resolveMode(merged, "vcc_recall", "", "/tmp", new Map())).toBe("allow");
    expect(resolveMode(merged, "edit", "file.ts", "/tmp", new Map())).toBe("deny");
    expect(resolveMode(merged, "bash", "pwd", "/tmp", new Map())).toBe("ask");
    expect(resolveMode(merged, "grep", "", "/tmp", new Map())).toBe("deny");
  });

  it("merged permissions inherit global defaultMode when preset omits it", () => {
    const merged = mergePermissionSettings(
      { allow: ["read"] },
      { defaultMode: "deny", allow: ["vcc_recall"] },
      "ask",
    );

    expect(resolveMode(merged, "read", "", "/tmp", new Map())).toBe("allow");
    expect(resolveMode(merged, "vcc_recall", "", "/tmp", new Map())).toBe("allow");
    expect(resolveMode(merged, "grep", "", "/tmp", new Map())).toBe("deny");
  });

  it("loadPresets reads top-level permission field", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pizza-agent-"));
    const projectDir = mkdtempSync(join(tmpdir(), "pizza-project-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

    try {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(
        join(agentDir, "presets.json"),
        JSON.stringify(
          {
            defaultMode: "ask",
            permission: { allow: ["vcc_recall"], ask: ["bash"] },
            presets: {},
          },
          null,
          2,
        ),
      );

      process.env.PI_CODING_AGENT_DIR = agentDir;
      const loaded = loadPresets(projectDir);

      expect(loaded.globalPermission).toEqual({ allow: ["vcc_recall"], ask: ["bash"] });
      expect(loaded.defaultMode).toBe("ask");
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
