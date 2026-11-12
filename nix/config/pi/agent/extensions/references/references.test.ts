import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import extension from "./index";
import { cachedReference, cachePath, normalizeRepository, parseConfig, referencePrompt, resolveReference, validBranch, withLock, type GitRunner } from "./references";

const exec = promisify(execFile);
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-references-test-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const remote = "https://example.test/acme/repo.git";

async function fixture() {
  const upstream = path.join(root, "upstream");
  await fs.mkdir(upstream);
  const git: GitRunner = async (args, cwd) => (await exec("git", [
    "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "-c", `url.file://${upstream}.insteadOf=${remote}`,
    "-c", "protocol.file.allow=always", ...args,
  ], { cwd, timeout: 10_000 })).stdout.trim();
  await git(["init", "-b", "main"], upstream);
  const commit = async (text: string) => {
    await fs.writeFile(path.join(upstream, "guide.md"), text);
    await git(["add", "."], upstream);
    await git(["commit", "-m", text], upstream);
    return git(["rev-parse", "HEAD"], upstream);
  };
  const first = await commit("first version");
  return { upstream, git, commit, first, cache: path.join(root, "cache") };
}

describe("reference configuration", () => {
  test("resolves local paths from the config file, including home paths", () => {
    expect(parseConfig({ references: {
      docs: { path: "../../docs", description: "Product docs" },
      home: { path: "~/work/shared" },
      absolute: { path: "/opt/shared" },
    } }, "/work/app/.pi/references.json", "/home/test")).toEqual([
      { name: "docs", path: "/work/docs", description: "Product docs" },
      { name: "home", path: "/home/test/work/shared", description: undefined },
      { name: "absolute", path: "/opt/shared", description: undefined },
    ]);
  });
  test("rejects ambiguous config, invalid aliases, branches, and local Git remotes", () => {
    for (const references of [
      { docs: "../docs" }, { "bad alias": { path: "/docs" } },
      { docs: { path: "/docs", repository: "acme/docs" } },
      { docs: { path: "/docs", branch: "main" } },
      { docs: { repository: "acme/docs", branch: "--upload-pack=bad" } },
      { docs: { repository: "file:///tmp/docs" } },
      { docs: { repository: "ext::bad" } },
      { docs: { repository: "acme/docs", description: 3 } },
    ]) expect(() => parseConfig({ references }, "/app/.pi/references.json")).toThrow();
    for (const value of [null, [], {}, { references: [] }]) expect(() => parseConfig(value, "/app/.pi/references.json")).toThrow();
    expect(parseConfig({ references: {} }, "/app/.pi/references.json")).toEqual([]);
  });
  test("normalizes equivalent Git remotes and separates branches", () => {
    const variants = ["acme/docs", "https://github.com/acme/docs.git", "git@github.com:acme/docs.git", "ssh://git@github.com/acme/docs"];
    expect(new Set(variants.map((r) => normalizeRepository(r).key)).size).toBe(1);
    expect(new Set(variants.map((r) => cachePath(root, r))).size).toBe(1);
    expect(cachePath(root, "acme/docs", "main")).not.toBe(cachePath(root, "acme/docs"));
    expect(normalizeRepository("gitlab.example.com/acme/docs").remote).toBe("https://gitlab.example.com/acme/docs");
    for (const branch of ["main", "release/v2.1", "feature-a"]) expect(validBranch(branch)).toBe(true);
    for (const branch of ["", "-main", "../main", "a//b", "a.lock", "a/", "a b"]) expect(validBranch(branch)).toBe(false);
  });
});

describe("shared Git cache", () => {
  test("clones, refreshes tracked files, and follows default branch changes", async () => {
    const f = await fixture();
    const ref = { name: "sdk", repository: remote };
    const cloned = await resolveReference(ref, f.cache, f.git);
    expect(cloned.status).toBe("cloned");
    expect(cloned.revision).toBe(f.first);
    expect(await fs.readFile(path.join(cloned.path, "guide.md"), "utf8")).toBe("first version");
    await fs.writeFile(path.join(cloned.path, "guide.md"), "local edits");
    const second = await f.commit("second version");
    const refreshed = await resolveReference(ref, f.cache, f.git);
    expect(refreshed.status).toBe("refreshed");
    expect(refreshed.path).toBe(cloned.path);
    expect(refreshed.revision).toBe(second);
    expect(await fs.readFile(path.join(cloned.path, "guide.md"), "utf8")).toBe("second version");
    await f.git(["checkout", "-b", "next"], f.upstream);
    const third = await f.commit("new default");
    expect((await resolveReference(ref, f.cache, f.git)).revision).toBe(third);
  });
  test("honors an explicit branch independently of the remote default", async () => {
    const f = await fixture();
    await f.git(["checkout", "-b", "release/v2"], f.upstream);
    const release = await f.commit("release version");
    const pinned = await resolveReference({ name: "sdk", repository: remote, branch: "main" }, f.cache, f.git);
    const defaultRef = await resolveReference({ name: "sdk", repository: remote }, f.cache, f.git);
    expect(pinned.revision).toBe(f.first);
    expect(defaultRef.revision).toBe(release);
    expect(pinned.path).not.toBe(defaultRef.path);
  });
  test("keeps usable cached content after network failure", async () => {
    const f = await fixture();
    const ref = { name: "sdk", repository: remote };
    await resolveReference(ref, f.cache, f.git);
    const offline: GitRunner = async (args, cwd) => {
      if (args[0] === "ls-remote") throw new Error("offline");
      return f.git(args, cwd);
    };
    const result = await resolveReference(ref, f.cache, offline);
    expect(result.status).toBe("cached");
    expect(result.error).toBe("offline");
    expect(result.revision).toBe(f.first);
  });
  test("cleans failed clones and allows the next attempt", async () => {
    const f = await fixture();
    const ref = { name: "sdk", repository: remote, branch: "missing" };
    expect((await resolveReference(ref, f.cache, f.git)).status).toBe("unavailable");
    expect(await fs.readdir(f.cache)).toEqual([]);
    await f.git(["branch", "missing"], f.upstream);
    expect((await resolveReference(ref, f.cache, f.git)).status).toBe("cloned");
  });
  test("serializes concurrent sessions and aliases using the same checkout", async () => {
    const f = await fixture();
    let clones = 0;
    const git: GitRunner = async (args, cwd) => {
      if (args[0] === "clone") clones++;
      return f.git(args, cwd);
    };
    const results = await Promise.all(["a", "b", "c"].map((name) => resolveReference({ name, repository: remote }, f.cache, git)));
    expect(clones).toBe(1);
    expect(results.map((r) => r.status).sort()).toEqual(["cloned", "refreshed", "refreshed"]);
    expect(new Set(results.map((r) => r.path)).size).toBe(1);
  });
  test("refuses a cache with a mismatched origin", async () => {
    const f = await fixture();
    const ref = { name: "sdk", repository: remote };
    const cloned = await resolveReference(ref, f.cache, f.git);
    await f.git(["remote", "set-url", "origin", "https://other.test/repo"], cloned.path);
    const result = await resolveReference(ref, f.cache, f.git);
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("origin does not match");
    expect(await fs.readFile(path.join(cloned.path, "guide.md"), "utf8")).toBe("first version");
  });
  test("reads a cached checkout without network, and reports a missing one", async () => {
    const f = await fixture();
    const ref = { name: "sdk", repository: remote };
    const offline: GitRunner = async (args, cwd) => {
      if (["ls-remote", "fetch", "clone"].includes(args[0])) throw new Error("network used");
      return f.git(args, cwd);
    };
    const missing = await cachedReference(ref, f.cache, offline);
    expect(missing.status).toBe("unavailable");
    expect(missing.error).toBe("Not cloned yet");
    await resolveReference(ref, f.cache, f.git);
    const cached = await cachedReference(ref, f.cache, offline);
    expect(cached.status).toBe("cached");
    expect(cached.revision).toBe(f.first);
    expect(cached.error).toBeUndefined();
  });
  test("refuses symlinked checkouts", async () => {
    const f = await fixture();
    await fs.mkdir(f.cache);
    await fs.symlink(f.upstream, cachePath(f.cache, remote));
    const result = await resolveReference({ name: "sdk", repository: remote }, f.cache, f.git);
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("symlinked");
  });
});

test("lock is released after errors and never stolen on timeout", async () => {
  const lock = path.join(root, "checkout.lock");
  await expect(withLock(lock, async () => { throw new Error("failure"); })).rejects.toThrow("failure");
  expect(await withLock(lock, async () => "ok")).toBe("ok");
  await fs.mkdir(lock);
  await expect(withLock(lock, async () => "not reached", 0)).rejects.toThrow("Reference cache is locked");
  expect((await fs.stat(lock)).isDirectory()).toBe(true);
});

test("local references and prompt include status without loading contents", async () => {
  await fs.writeFile(path.join(root, "secret.md"), "NOT AUTO LOADED");
  const local = await resolveReference({ name: "docs", path: root }, "unused");
  const missing = await resolveReference({ name: "missing", path: path.join(root, "absent") }, "unused");
  expect(local.status).toBe("local");
  expect(missing.status).toBe("unavailable");
  const prompt = referencePrompt([local, missing]);
  expect(prompt).toContain(root);
  expect(prompt).toContain("unavailable");
  expect(prompt).not.toContain("NOT AUTO LOADED");
  expect(referencePrompt([])).toBe("");
});

test("extension advertises per turn, supports refresh, and respects project trust", async () => {
  const handlers: Record<string, Function> = {};
  let command: any;
  extension({ on: (event: string, handler: Function) => { handlers[event] = handler; }, registerCommand: (_name: string, definition: unknown) => { command = definition; } } as any);
  const ctx: any = { cwd: root, hasUI: false, isProjectTrusted: () => true, isIdle: () => true, ui: { notify() {} } };
  await fs.mkdir(path.join(root, ".pi"));
  const config = path.join(root, ".pi", "references.json");
  await fs.writeFile(config, JSON.stringify({ references: { docs: { path: "..", description: "Project docs" } } }));
  await handlers.session_start({}, ctx);
  const event = { systemPromptOptions: { sections: { existing: "keep" } as Record<string, string> } };
  await handlers.before_agent_start(event, ctx);
  expect(event.systemPromptOptions.sections.project_references).toContain("Project docs");
  expect(event.systemPromptOptions.sections.existing).toBe("keep");
  const first = event.systemPromptOptions.sections.project_references;
  await handlers.before_agent_start(event, ctx);
  expect(event.systemPromptOptions.sections.project_references).toBe(first);
  await fs.writeFile(config, JSON.stringify({ references: {} }));
  await command.handler("refresh", ctx);
  await handlers.before_agent_start(event, ctx);
  expect(event.systemPromptOptions.sections.project_references).toBeUndefined();
  ctx.isProjectTrusted = () => false;
  await fs.writeFile(config, JSON.stringify({ references: { docs: { path: ".." } } }));
  await handlers.session_start({}, ctx);
  await handlers.before_agent_start(event, ctx);
  expect(event.systemPromptOptions.sections.project_references).toContain("require project trust");
  expect(event.systemPromptOptions.sections.project_references).not.toContain('"name":"docs"');
});
