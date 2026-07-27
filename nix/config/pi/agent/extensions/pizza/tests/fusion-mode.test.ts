import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFusionModeExtension, type FusionModeOptions } from "../fusion-mode.ts";

const tempPaths: string[] = [];
afterAll(async () => Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true }))));

function setup(entries: unknown[] = [], options: FusionModeOptions = {}) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const tools = new Map<string, { execute: Function }>();
  const resourceCommands: Array<{ name: string; source: "skill" | "prompt"; sourceInfo: { path: string; baseDir?: string } }> = [];
  const statuses = new Map<string, string | undefined>();
  const notifications: string[] = [];
  const persisted: Array<{ customType: string; data: unknown }> = [];
  let activeTools = [
    "read",
    "bash",
    "edit",
    "write",
    "subagent_spawn",
    "subagent_send",
    "subagent_wait",
    "subagent_check",
    "subagent_list",
    "subagent_cancel",
    "questionnaire",
  ];
  const pi = {
    on(name: string, handler: Function) { handlers.set(name, handler); },
    registerCommand(name: string, command: { handler: Function }) { commands.set(name, command); },
    registerTool(tool: { name: string; execute: Function }) {
      tools.set(tool.name, tool);
      activeTools.push(tool.name);
    },
    getCommands() { return resourceCommands; },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names: string[]) { activeTools = [...names]; },
    appendEntry(customType: string, data: unknown) { persisted.push({ customType, data }); },
  };
  const ctx = {
    sessionManager: { getEntries: () => entries },
    ui: {
      setStatus(key: string, value: string | undefined) { statuses.set(key, value); },
      notify(message: string) { notifications.push(message); },
    },
  };
  const controller = registerFusionModeExtension(pi as never, options);
  handlers.get("session_start")?.({}, ctx);
  return { handlers, commands, tools, resourceCommands, ctx, controller, statuses, notifications, persisted, getTools: () => activeTools };
}

describe("fusion mode", () => {
  it("injects the canonical subagent skill while fusion is enabled", async () => {
    const state = setup();
    await state.commands.get("fusion")!.handler("on", state.ctx);
    expect(state.getTools()).toEqual([
      "subagent_spawn", "subagent_send", "subagent_wait", "subagent_check",
      "subagent_list", "subagent_cancel", "questionnaire",
      "fusion_load_skill", "fusion_load_prompt",
    ]);
    expect(state.statuses.get("fusion-mode")).toBe("FUSION");
    expect(state.controller.getSidekickTools()).toContain("read");
    expect(state.handlers.get("tool_call")({ toolName: "read" })).toMatchObject({ block: true });
    expect(state.handlers.get("tool_call")({ toolName: "subagent_spawn" })).toBeUndefined();
    expect(state.handlers.get("tool_call")({ toolName: "subagent_send" })).toBeUndefined();

    const result = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    const repeatedResult = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    for (const prompt of [result.systemPrompt, repeatedResult.systemPrompt]) {
      expect(prompt).toContain("You are the orchestrator");
      expect(prompt).toContain('<skill name="subagent" location="');
      expect(prompt).toContain("References are relative to ");
      expect(prompt).toContain("# Lightweight Subagents");
      expect(prompt).not.toContain("---\nname: subagent");
      expect(prompt.match(/<skill name="subagent" location="/g)).toHaveLength(1);
      expect(prompt.indexOf("[FUSION MODE ACTIVE]")).toBeLessThan(
        prompt.indexOf('<skill name="subagent"'),
      );
    }

    await state.commands.get("fusion")!.handler("off", state.ctx);
    expect(state.getTools()).toContain("edit");
    expect(state.statuses.get("fusion-mode")).toBeUndefined();
  });

  it("does not inject the subagent skill while fusion is disabled", async () => {
    const state = setup();
    const result = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    expect(result).toBeUndefined();
  });

  it("keeps the fusion prompt on skill-load failures and retries until recovery", async () => {
    let fail = true;
    const state = setup([], {
      loadSubagentSkill: async () => {
        if (fail) throw new Error("missing skill");
        return '<skill name="subagent" location="/skill">\nReferences are relative to /skill.\n\nbody\n</skill>';
      },
    });
    await state.commands.get("fusion")!.handler("on", state.ctx);

    const first = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    const second = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    expect(first.systemPrompt).toContain("[FUSION MODE ACTIVE]");
    expect(first.systemPrompt).not.toContain('<skill name="subagent"');
    expect(second.systemPrompt).not.toContain('<skill name="subagent"');
    expect(state.notifications.filter((message) => message.includes("could not load the subagent skill"))).toHaveLength(1);

    fail = false;
    const recovered = await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    expect(recovered.systemPrompt).toContain('<skill name="subagent"');

    fail = true;
    await state.handlers.get("before_agent_start")({ systemPrompt: "base" }, state.ctx);
    expect(state.notifications.filter((message) => message.includes("could not load the subagent skill"))).toHaveLength(2);
  });

  it("toggles fusion mode on and then off with the bare command", async () => {
    const state = setup();
    const fusion = state.commands.get("fusion")!;
    const initialTools = state.getTools();

    await fusion.handler("", state.ctx);
    expect(state.getTools()).toEqual([
      "subagent_spawn", "subagent_send", "subagent_wait", "subagent_check",
      "subagent_list", "subagent_cancel", "questionnaire",
      "fusion_load_skill", "fusion_load_prompt",
    ]);
    expect(state.statuses.get("fusion-mode")).toBe("FUSION");
    expect(state.persisted.at(-1)).toMatchObject({ data: { enabled: true, toolsBeforeFusion: initialTools } });

    await fusion.handler("", state.ctx);
    expect(state.getTools()).toEqual(initialTools);
    expect(state.statuses.get("fusion-mode")).toBeUndefined();
    expect(state.persisted.at(-1)).toMatchObject({ data: { enabled: false, toolsBeforeFusion: undefined } });
  });

  it("loads only discovered skills and prompts while fusion is enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pizza-fusion-"));
    tempPaths.push(directory);
    const skillPath = join(directory, "SKILL.md");
    const promptPath = join(directory, "review.md");
    await writeFile(skillPath, "---\nname: review\ndescription: Review code\n---\n# Review skill\n");
    await writeFile(promptPath, "---\ndescription: Review prompt\n---\nReview the implementation.\n");

    const state = setup();
    expect(state.getTools()).not.toContain("fusion_load_skill");
    state.resourceCommands.push(
      { name: "review", source: "skill", sourceInfo: { path: skillPath, baseDir: directory } },
      { name: "review", source: "prompt", sourceInfo: { path: promptPath } },
    );

    const skillTool = state.tools.get("fusion_load_skill")!;
    const promptTool = state.tools.get("fusion_load_prompt")!;
    expect((await skillTool.execute("id", { name: "review" })).isError).toBe(true);

    await state.commands.get("fusion")!.handler("on", state.ctx);
    const skill = await skillTool.execute("id", { name: "review" });
    const prompt = await promptTool.execute("id", { name: "review" });
    expect(skill.content[0].text).toContain('<skill name="review"');
    expect(skill.content[0].text).toContain("# Review skill");
    expect(skill.content[0].text).not.toContain("description: Review code");
    expect(prompt.content[0].text).toBe("Review the implementation.");
    expect((await skillTool.execute("id", { name: "missing" })).isError).toBe(true);

    await state.commands.get("fusion")!.handler("off", state.ctx);
    expect(state.getTools()).not.toContain("fusion_load_skill");
    expect(state.getTools()).not.toContain("fusion_load_prompt");
  });

  it("restores persisted fusion state on session start", () => {
    const state = setup([{ type: "custom", customType: "fusion-mode", data: {
      enabled: true,
      toolsBeforeFusion: ["read", "write", "subagent_spawn", "subagent_send"],
    } }]);
    expect(state.getTools()).toEqual(["subagent_spawn", "subagent_send", "subagent_wait", "subagent_check", "subagent_list", "subagent_cancel", "questionnaire", "fusion_load_skill", "fusion_load_prompt"]);
    expect(state.controller.getSidekickTools()).toEqual(["read", "write", "subagent_spawn", "subagent_send"]);
  });
});
