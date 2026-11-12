// Run: bun test nix/config/pi/agent/extensions/generate-title/
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanTitle, conversationFromBranch, DEFAULT_CONFIG, parseModelSpec, resolveConfig, REX_LABEL_MAX, rexLabel, splitModel } from "./title.ts";

test("shipped config is the default: Haiku, medium, auto", () => {
  expect(resolveConfig(readFileSync(join(import.meta.dir, "config.json"), "utf8"), undefined)).toEqual(DEFAULT_CONFIG);
  expect(DEFAULT_CONFIG).toEqual({ model: "claude-code/claude-haiku-5-5", thinking: "medium", auto: true });
});

test("config: file, env override, bad values", () => {
  expect(resolveConfig('{"model":"opencode/x","thinking":"low","auto":false}', undefined)).toEqual({ model: "opencode/x", thinking: "low", auto: false });
  expect(resolveConfig('{"model":null}', undefined).model).toBeUndefined();
  expect(resolveConfig('{"thinking":"loud"}', undefined).thinking).toBe("medium");
  expect(resolveConfig("{bad", undefined)).toEqual(DEFAULT_CONFIG);
  expect(resolveConfig(undefined, "openai-codex/gpt-5.5:high")).toMatchObject({ model: "openai-codex/gpt-5.5", thinking: "high" });
});

test("model spec parsing", () => {
  expect(parseModelSpec("claude-code/claude-haiku-5-5:low")).toEqual({ model: "claude-code/claude-haiku-5-5", thinking: "low" });
  expect(parseModelSpec("openrouter/a/b:free")).toEqual({ model: "openrouter/a/b:free" });
  expect(parseModelSpec("")).toEqual({});
  expect(splitModel("openrouter/a/b")).toEqual({ provider: "openrouter", id: "a/b" });
  expect(splitModel("nope")).toBeUndefined();
});

test("conversation from branch", () => {
  const branch = [
    { type: "message", message: { role: "user", content: "fix the footer" } },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "ok" }] } },
    { type: "message", message: { role: "toolResult", content: "noise" } },
    { type: "model_change" },
  ];
  expect(conversationFromBranch(branch)).toBe("user: fix the footer\n\nassistant: ok");
});

test("clean title", () => {
  expect(cleanTitle('"Native Subscription Usage Footer."')).toBe("Native Subscription Usage Footer");
  expect(cleanTitle("Title: **Fix Rex labels**\n\nextra")).toBe("Fix Rex labels");
  expect([...cleanTitle("x".repeat(200))].length).toBe(80);
});

test('rex label: "π - " prefix, 128 code points, no newlines', () => {
  expect(rexLabel("Fix the footer")).toBe("π - Fix the footer");
  expect(rexLabel("a\nb\tc")).toBe("π - a b c");
  const long = rexLabel("🎉".repeat(300));
  expect([...long].length).toBe(REX_LABEL_MAX);
  expect(long.startsWith("π - ")).toBe(true);
});
