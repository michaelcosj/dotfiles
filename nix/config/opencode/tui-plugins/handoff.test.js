import { describe, expect, test } from "bun:test";
import plugin from "./handoff.js";

function fixture() {
  const calls = [];
  const toasts = [];
  const location = { directory: "/project/worktree", workspaceID: "workspace" };
  let route = { type: "session", sessionID: "source" };
  let command;
  const ctx = {
    keymap: {
      layer: (layer) => { command = layer().commands[0]; },
    },
    client: {
      agent: {
        list: async (input) => {
          calls.push(["agents", input]);
          return { data: [{ id: "reviewer", mode: "subagent" }] };
        },
      },
      session: {
        get: async (input) => {
          calls.push(["get", input]);
          return { id: "source", title: "Current task", location };
        },
        generate: async (input) => {
          calls.push(["generate", input]);
          return { text: "Verified progress and remaining work." };
        },
        create: async (input) => {
          calls.push(["create", input]);
          return { id: "destination" };
        },
        prompt: async (input) => { calls.push(["prompt", input]); },
      },
    },
    ui: {
      router: {
        current: () => route,
        navigate: (input) => { calls.push(["navigate", input]); },
      },
      tabs: {
        enabled: () => true,
        open: (id) => { calls.push(["open", id]); return true; },
        focus: (id) => { calls.push(["focus", id]); return true; },
      },
      toast: { show: (input) => { toasts.push(input); } },
    },
  };
  const cleanup = plugin.setup(ctx);
  return {
    ctx, calls, toasts, command, cleanup, location,
    navigate: (next) => { route = next; },
  };
}

describe("handoff", () => {
  test("creates an independent session with the requested agent and source location", async () => {
    const f = fixture();
    await f.command.run("/handoff reviewer Focus on correctness.\n  Keep this indentation.");
    expect(f.calls.map(([name]) => name)).toEqual([
      "get", "agents", "generate", "create", "prompt", "open", "focus",
    ]);
    expect(f.calls.find(([name]) => name === "agents")[1]).toEqual({ location: f.location });
    expect(f.calls.find(([name]) => name === "create")[1]).toEqual({
      agent: "reviewer", location: f.location, title: "Handoff to reviewer: Current task",
    });
    const prompt = f.calls.find(([name]) => name === "prompt")[1];
    expect(prompt.sessionID).toBe("destination");
    expect(prompt.text).toContain("Source session: source");
    expect(prompt.text).toContain("Verified progress and remaining work.");
    expect(prompt.text).toContain("Focus on correctness.\n  Keep this indentation.");
    expect(f.calls.find(([name]) => name === "generate")[1].prompt).not.toContain("Focus on correctness.");
  });

  test("also accepts arguments without the slash prefix and optional extra context", async () => {
    const f = fixture();
    await f.command.run("reviewer");
    expect(f.calls.find(([name]) => name === "create")[1].agent).toBe("reviewer");
    expect(f.calls.find(([name]) => name === "prompt")[1].text).not.toContain("## Additional context");
  });

  test("missing agent does not invoke the client", async () => {
    const f = fixture();
    await f.command.run("/handoff");
    expect(f.calls).toEqual([]);
    expect(f.toasts.at(-1).message).toContain("Usage:");
  });

  test("unknown agent fails before generation or session creation", async () => {
    const f = fixture();
    await f.command.run("missing context");
    expect(f.calls.map(([name]) => name)).toEqual(["get", "agents"]);
    expect(f.toasts.at(-1).message).toBe("Unknown agent: missing");
  });

  for (const stage of ["get", "agents", "generate", "create", "prompt"]) {
    test(`handles failure at ${stage} without later mutations or automatic retries`, async () => {
      const f = fixture();
      const owner = stage === "agents" ? f.ctx.client.agent : f.ctx.client.session;
      owner[stage === "agents" ? "list" : stage] = async () => { throw new Error("Network error"); };
      await f.command.run("reviewer");
      expect(f.toasts.at(-1).variant).toBe("error");
      expect(f.calls.some(([name]) => name === "open")).toBe(false);
      if (stage === "prompt") {
        expect(f.toasts.at(-1).message).toContain("Destination: destination");
        expect(f.toasts.at(-1).message).toContain("submission may have been accepted");
      } else {
        expect(f.calls.some(([name]) => name === "prompt")).toBe(false);
      }
    });
  }

  test("empty generation does not create a session", async () => {
    const f = fixture();
    f.ctx.client.session.generate = async () => ({ text: "  " });
    await f.command.run("reviewer");
    expect(f.calls.some(([name]) => name === "create")).toBe(false);
    expect(f.toasts.at(-1).message).toContain("empty");
  });

  test("does not open or focus tabs if the user navigated away", async () => {
    const f = fixture();
    f.ctx.client.session.generate = async () => {
      f.navigate({ type: "session", sessionID: "other" });
      return { text: "Summary" };
    };
    await f.command.run("reviewer");
    expect(f.calls.some(([name]) => name === "prompt")).toBe(true);
    expect(f.calls.some(([name]) => ["open", "focus", "navigate"].includes(name))).toBe(false);
    expect(f.toasts.at(-1).variant).toBe("success");
  });

  test("navigates directly when tabs are disabled", async () => {
    const f = fixture();
    f.ctx.ui.tabs.enabled = () => false;
    await f.command.run("reviewer");
    expect(f.calls.at(-1)).toEqual(["navigate", { type: "session", sessionID: "destination" }]);
  });

  test("navigation failure does not misreport a submitted handoff", async () => {
    const f = fixture();
    f.ctx.ui.tabs.open = () => { throw new Error("Navigation failed"); };
    await f.command.run("reviewer");
    expect(f.toasts.at(-1).variant).toBe("success");
    expect(f.toasts.at(-1).message).toContain("Open session destination");
  });

  test("suppresses concurrent handoffs and cancels between stages on unload", async () => {
    const f = fixture();
    let resolve;
    let signal;
    f.ctx.client.session.generate = (_input, options) => {
      signal = options.signal;
      return new Promise((done) => { resolve = done; });
    };
    const first = f.command.run("reviewer");
    // Reach the pending generation without introducing real delays.
    await Promise.resolve();
    await Promise.resolve();
    await f.command.run("reviewer");
    expect(f.toasts.at(-1).message).toContain("already running");
    f.cleanup();
    expect(signal.aborted).toBe(true);
    resolve({ text: "Summary" });
    await first;
    expect(f.calls.some(([name]) => name === "create")).toBe(false);
  });
});
