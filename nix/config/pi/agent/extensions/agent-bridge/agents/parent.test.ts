import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Agent } from "./parent.ts";

// Resolve Pi's packages from the installed Pi, since this repo has no node_modules.
const PI_MODULES =
  process.env.PI_NODE_MODULES ??
  path.join(path.dirname(fs.realpathSync(execFileSync("which", ["pi"]).toString().trim())), "../lib/node_modules/pi-monorepo/node_modules");
process.env.NODE_PATH = PI_MODULES;
for (const id of ["@earendil-works/pi-ai", "@earendil-works/pi-tui", "@earendil-works/pi-coding-agent", "typebox"]) {
  const mod = await import(Bun.resolveSync(id, path.dirname(PI_MODULES)));
  mock.module(id, () => mod);
}

// Record Rex CLI calls instead of running them.
const rexCalls: string[][] = [];
const rexReplies: ((args: string[]) => string | undefined)[] = [];
const realRex = await import("../../lib/rex.ts");
mock.module("../../lib/rex.js", () => ({
  ...realRex,
  REX_SESSION: "session:here",
  REX_BLOCK: "block:main",
  rex: async (args: string[], _t?: number, server?: string) => {
    const full = [...(server ? ["-S", server] : []), ...args];
    rexCalls.push(full);
    for (const r of rexReplies) {
      const out = r(full);
      if (out !== undefined) return out;
    }
    return "";
  },
}));

process.env.PI_AGENT_TASK_START_MS = "300";
const { registerParent, remoteCwd } = await import("./parent.ts");

const g = globalThis as { __piAgents?: Map<string, Agent> };

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "alpha",
    title: "Alpha",
    block: "block",
    cwd: "/tmp",
    status: "idle",
    startedAt: 0,
    unreported: false,
    notify: true,
    promptFile: "/tmp/prompt",
    ...overrides,
  };
}

function setup() {
  const events: { client: any; event: string; data: any }[] = [];
  const tools = new Map<string, any>();
  const methods = new Map<string, any>();
  let onConnect: ((client: any) => void) | undefined;
  const bridge: any = {
    running: true,
    socketPath: "/tmp/test.sock",
    token: "token",
    listenRemote: async () => ({ address: "tcp://100.64.0.1:4000", token: "remote-token" }),
    registerMethod: (_role: string, name: string, fn: any) => methods.set(name, fn),
    onShutdown: () => {},
    onClient: (kind: string, fn: any) => {
      if (kind === "connect") onConnect = fn;
    },
    event: (client: any, event: string, data: any) => {
      events.push({ client, event, data });
      if (event === "shutdown" && client.socket) client.socket.destroyed = true; // the child leaves
    },
    broadcast: () => {},
    ctx: undefined,
  };
  const pi: any = { on: () => {}, registerTool: (t: any) => tools.set(t.name, t), sendMessage: () => {}, appendEntry: () => {} };
  const parent = registerParent(pi, bridge, { onFilesChanged: () => {}, onRoster: () => {} });
  return {
    parent, events, tools, methods,
    connect: (client: any) => onConnect!(client),
    /** The child connects and begins its task, as a healthy one does. */
    begin: (client: any) => {
      onConnect!(client);
      methods.get("started")(client, {});
    },
  };
}

beforeEach(() => {
  g.__piAgents = new Map();
  rexCalls.length = 0;
  rexReplies.length = 0;
});
afterEach(() => {
  delete g.__piAgents;
});

describe("routeNote", () => {
  test("a connected child receives the note", () => {
    g.__piAgents!.set("alpha", makeAgent());
    const { parent, events } = setup();
    const a = g.__piAgents!.get("alpha")!;
    a.client = { socket: { destroyed: false } } as any;

    expect(parent.routeNote("alpha", "rejected a.ts")).toBe(true);
    expect(events).toEqual([{ client: a.client, event: "note", data: { text: "rejected a.ts" } }]);
  });

  test("a reconnecting child gets the note when it connects", () => {
    g.__piAgents!.set("alpha", makeAgent());
    const { parent, events, connect } = setup();
    const a = g.__piAgents!.get("alpha")!;

    expect(parent.routeNote("alpha", "rejected b.ts")).toBe(true);
    expect(a.pendingNotes).toEqual(["rejected b.ts"]);
    expect(events).toEqual([]);

    const client = { role: "agent", info: { id: a.id }, socket: { destroyed: false } };
    connect(client);
    expect(a.pendingNotes).toEqual([]);
    expect(events).toContainEqual({ client, event: "note", data: { text: "rejected b.ts" } });
  });

  test("review comments reach the child as a review, also after a reconnect", () => {
    g.__piAgents!.set("alpha", makeAgent());
    const { parent, events, connect } = setup();
    const a = g.__piAgents!.get("alpha")!;

    expect(parent.routeNote("alpha", "L3: fix this", true)).toBe(true);
    expect(a.pendingNotes).toEqual([{ text: "L3: fix this", review: true }]);
    const client = { role: "agent", info: { id: a.id }, socket: { destroyed: false } };
    connect(client);
    expect(events).toContainEqual({ client, event: "note", data: { text: "L3: fix this", review: true } });

    parent.routeNote("alpha", "L9: and this", true);
    expect(events.at(-1)).toEqual({ client, event: "note", data: { text: "L9: and this", review: true } });
  });

  test("an unknown or crashed child falls back to this pi", () => {
    g.__piAgents!.set("alpha", makeAgent({ status: "crashed" }));
    const { parent } = setup();

    expect(parent.routeNote("alpha", "rejected c.ts")).toBe(false);
    expect(parent.routeNote("missing", "rejected d.ts")).toBe(false);
  });
});

describe("remote agents", () => {
  /** A host with no pi-agents session yet; the child connects as soon as its tab opens. */
  function fakeHost(connect: (id: string) => void) {
    rexReplies.push((args) => {
      const cmd = args.slice(2).join(" ");
      if (cmd.startsWith("ls --json")) return JSON.stringify({ sessions: [] });
      if (cmd.startsWith("api call session.create")) return JSON.stringify({ session_id: "session:remote" });
      if (cmd.startsWith("block ls")) return JSON.stringify({ blocks: [] });
      if (args.includes("session.new_window")) {
        const params = JSON.parse(args[args.length - 1]);
        const env = params.layout.block.options.command as string[];
        const id = env.find((x) => x.startsWith("PI_AGENT_ID="))!.split("=")[1];
        setTimeout(() => connect(id), 0);
        return JSON.stringify({ window_id: "window:remote", block_ids: ["block:remote"] });
      }
      return undefined;
    });
  }

  test("start opens a tab on the host and sends the task once on connect", async () => {
    const { tools, events, connect, begin } = setup();
    const client = { role: "agent", info: {} as any, socket: { destroyed: false } };
    fakeHost((id) => {
      client.info.id = id;
      begin(client);
    });

    const r = await tools.get("agent").execute("1", { action: "start", host: "devbox", name: "beta", task: "do it", cwd: "~/code" }, undefined, undefined, {});
    expect(r.content[0].text).toContain("on devbox in ~/code");

    // Every Rex call went to the host, except reading this pane's size.
    const local = rexCalls.filter((c) => c[0] !== "-S");
    expect(local).toEqual([["block", "call", "-s", "session:here", "-b", "block:main", "size", "{}"]]);
    for (const c of rexCalls.filter((c) => c[0] === "-S")) expect(c[1]).toBe("devbox");

    const open = rexCalls.find((c) => c.includes("session.new_window"))!;
    const cmd = JSON.parse(open[open.length - 1]).layout.block.options.command as string[];
    expect(cmd.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(cmd.slice(3, 6)).toEqual(["sh", "~/code", ""]);
    expect(cmd).toContain("PI_BRIDGE_PARENT=tcp://100.64.0.1:4000");
    expect(cmd).toContain("PI_BRIDGE_TOKEN=remote-token");
    expect(cmd).toContain("PI_AGENT_HOST=devbox");

    const prompts = events.filter((e) => e.event === "prompt");
    expect(prompts).toEqual([{ client, event: "prompt", data: { text: "do it" } }]);
    // A reconnect does not send it again.
    connect(client);
    expect(events.filter((e) => e.event === "prompt")).toHaveLength(1);

    const a = g.__piAgents!.get("beta")!;
    expect(a.host).toBe("devbox");
    expect(a.remote).toEqual({ session: "session:remote", window: "window:remote" });
  });

  test("resume checks the session file on the host, not here", async () => {
    const client = { role: "agent", info: {} as any, socket: { destroyed: false } };
    // Saved entries are read from the session on session_start.
    const saved = { name: "gamma", title: "G", cwd: "~", sessionFile: "/home/x/.pi/s.jsonl", host: "devbox" };
    const pi: any = { on: (ev: string, fn: any) => ev === "session_start" && (pi.start = fn), registerTool: () => {}, sendMessage: () => {}, appendEntry: () => {} };
    const bridge: any = {
      running: true, socketPath: "/tmp/t.sock", token: "t",
      listenRemote: async () => ({ address: "tcp://100.64.0.1:4000", token: "rt" }),
      registerMethod: () => {}, onShutdown: () => {}, broadcast: () => {}, event: () => {},
      onClient: (k: string, fn: any) => k === "connect" && (bridge.connect = fn),
    };
    const p2 = registerParent(pi, bridge, { onFilesChanged: () => {}, onRoster: () => {} });
    pi.start({}, { sessionManager: { getBranch: () => [{ type: "custom", customType: "agent-child", data: saved }] } });
    fakeHost((id) => {
      client.info.id = id;
      bridge.connect(client);
    });
    expect(p2.resumable().map((d) => d.name)).toEqual(["gamma"]); // not on this disk, still listed
    await p2.resume("gamma");
    const open = rexCalls.find((c) => c.includes("session.new_window"))!;
    const cmd = JSON.parse(open[open.length - 1]).layout.block.options.command as string[];
    expect(cmd.slice(4, 6)).toEqual(["~", "/home/x/.pi/s.jsonl"]);
    expect(cmd.slice(-2)).toEqual(["--session", "/home/x/.pi/s.jsonl"]);
  });

  test("the remote child's view of its own blocks is ignored", () => {
    g.__piAgents!.set("beta", makeAgent({ name: "beta", host: "devbox" }));
    const { parent, methods } = setup();
    const a = g.__piAgents!.get("beta")!;
    const client = { socket: { destroyed: false } };
    a.client = client as any;
    methods.get("view")(client, { block: "block:remote-thing" });
    expect(parent.roster().visible).toBe("block:main");
  });

  test("viewing a remote agent selects its session in the app on that host", async () => {
    g.__piAgents!.set("beta", makeAgent({ name: "beta", host: "devbox", remote: { session: "session:remote", window: "window:w" } }));
    const { parent } = setup();
    rexReplies.push((args) => {
      if (args.join(" ").startsWith("client ls"))
        return JSON.stringify({ clients: [{ client_id: "client:mac", info: { kind: "app", label: "Mac" }, session_ids: ["session:here"] }] });
      if (args.join(" ").startsWith("-S devbox client ls"))
        return JSON.stringify({ clients: [{ client_id: "client:cli", info: { kind: "cli" } }, { client_id: "client:mac-there", info: { kind: "app", label: "Mac" } }] });
      return undefined;
    });
    await parent.view("beta");
    expect(rexCalls.at(-1)).toEqual(["-S", "devbox", "-C", "client:mac-there", "do", "session.select", "session_id=session:remote", "window_id=window:w"]);
  });
});

describe("notify", () => {
  test("a result is steered, and wait returns at once while it is queued", async () => {
    g.__piAgents!.set("alpha", makeAgent());
    const handlers = new Map<string, any>();
    const sent: any[] = [];
    const tools = new Map<string, any>();
    const methods = new Map<string, any>();
    const pi: any = {
      on: (ev: string, fn: any) => handlers.set(ev, fn),
      registerTool: (t: any) => tools.set(t.name, t),
      sendMessage: (...args: any[]) => sent.push(args),
      appendEntry: () => {},
    };
    const bridge: any = {
      running: true, socketPath: "/tmp/t.sock", token: "t",
      registerMethod: (_r: string, name: string, fn: any) => methods.set(name, fn),
      onShutdown: () => {}, onClient: () => {}, broadcast: () => {}, event: () => {},
    };
    registerParent(pi, bridge, { onFilesChanged: () => {}, onRoster: () => {} });
    const a = g.__piAgents!.get("alpha")!;
    const client = { socket: { destroyed: false } };
    a.client = client as any;

    methods.get("settled")(client, { last_message: "done" });
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual({ triggerTurn: true, deliverAs: "steer" });

    const wait = (timeout: number) => tools.get("agent").execute("1", { action: "wait", name: "alpha", timeout }, undefined, undefined, {});
    const r = await wait(30);
    expect(r.content[0].text).toContain("queued as a message");

    // Once pi delivers it, a wait waits for the next result again.
    handlers.get("message_start")({ message: { role: "custom", customType: "agent-result", details: { name: "alpha" } } });
    const t0 = Date.now();
    const r2 = await wait(1);
    expect(Date.now() - t0).toBeGreaterThan(900);
    expect(r2.content[0].text).toContain("No agent settled");
  });
});

describe("remoteCwd", () => {
  test("maps paths under home to ~", () => {
    expect(remoteCwd("/Users/me/.dotfiles", "/Users/me")).toBe("~/.dotfiles");
    expect(remoteCwd("/Users/me", "/Users/me")).toBe("~");
    expect(remoteCwd("/opt/x", "/Users/me")).toBe("/opt/x");
    expect(remoteCwd("/Users/meow", "/Users/me")).toBe("/Users/meow");
  });
});

describe("worktree", () => {
  const SCRIPT = path.resolve(import.meta.dir, "../../../../../../scripts/agent-worktree");

  /** A git repo with one commit, and a pane open that connects at once. */
  function repoAndPane(connect: (id: string) => void) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "wt-test-")));
    const repo = path.join(dir, "repo");
    execFileSync("sh", ["-c", `git init -q -b main ${repo} && cd ${repo} && echo a > a && git add a && git -c user.name=t -c user.email=t@t commit -qm init`]);
    process.env.AGENT_WORKTREES = path.join(dir, "wt");
    process.env.AGENT_WORKTREE_BIN = SCRIPT;
    const opened: any[] = [];
    rexReplies.push((args) => {
      if (!args.includes("session.new_block")) return undefined;
      const params = JSON.parse(args[args.length - 1]);
      opened.push(params);
      const id = (params.options.command as string[]).find((x) => x.startsWith("PI_AGENT_ID="))!.split("=")[1];
      setTimeout(() => connect(id), 0);
      return JSON.stringify({ block_id: "block:child" });
    });
    return { dir, repo, opened };
  }

  afterEach(() => {
    delete process.env.AGENT_WORKTREES;
    delete process.env.AGENT_WORKTREE_BIN;
  });

  test("start creates the worktree and runs the child in it", async () => {
    const { tools, begin } = setup();
    const { dir, repo, opened } = repoAndPane((id) => begin({ role: "agent", info: { id }, socket: { destroyed: false } }));
    try {
      const r = await tools.get("agent").execute("1", { action: "start", name: "alt-a", task: "try it", worktree: true }, undefined, undefined, { cwd: repo });
      const wt = path.join(dir, "wt", "repo", "alt-a");
      expect(r.content[0].text).toContain(`in worktree ${wt} (branch agent/alt-a)`);
      expect(opened[0].options.cwd).toBe(wt);
      expect(execFileSync("git", ["-C", wt, "branch", "--show-current"]).toString().trim()).toBe("agent/alt-a");
      const a = g.__piAgents!.get("alt-a")!;
      expect(a.worktree).toEqual({ name: "alt-a", branch: "agent/alt-a" });
      expect(fs.readFileSync(a.promptFile, "utf8")).toContain("own git worktree on branch agent/alt-a");

      // a named worktree; and cwd with worktree is refused
      await tools.get("agent").execute("1", { action: "start", name: "alt-b", task: "x", worktree: "shared" }, undefined, undefined, { cwd: repo });
      expect(opened[1].options.cwd).toBe(path.join(dir, "wt", "repo", "shared"));
      await expect(
        tools.get("agent").execute("1", { action: "start", name: "alt-c", task: "x", worktree: true, cwd: "." }, undefined, undefined, { cwd: repo }),
      ).rejects.toThrow("not both");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed worktree says why and opens no pane", async () => {
    const { tools } = setup();
    const { dir, opened } = repoAndPane(() => {});
    try {
      await expect(
        tools.get("agent").execute("1", { action: "start", name: "alt-a", task: "x", worktree: true }, undefined, undefined, { cwd: dir }),
      ).rejects.toThrow("not a git repository");
      expect(opened).toHaveLength(0);
      expect(g.__piAgents!.has("alt-a")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("remote agents refuse worktree", async () => {
    const { tools } = setup();
    await expect(tools.get("agent").execute("1", { action: "start", name: "r", host: "devbox", task: "x", worktree: true }, undefined, undefined, {})).rejects.toThrow("not supported");
  });
});

describe("start", () => {
  const fakeClient = () => {
    const socket = { destroyed: false, destroy: () => void (socket.destroyed = true) };
    return { role: "agent", info: {} as any, socket };
  };
  /** A local pane that runs `onOpen` with the child's id; `alive` sets whether its program runs. */
  function pane(onOpen: (id: string) => void, alive = true) {
    rexReplies.push((args) => {
      if (args.includes("session.new_block")) {
        const params = JSON.parse(args[args.length - 1]);
        const id = (params.options.command as string[]).find((x) => x.startsWith("PI_AGENT_ID="))!.split("=")[1];
        setTimeout(() => onOpen(id), 0);
        return JSON.stringify({ block_id: "block:child" });
      }
      if (args[0] === "block" && args[1] === "call" && args.includes("process")) return alive ? JSON.stringify({ child: { pid: 1 } }) : "{}";
      if (args[0] === "capture") return "pi v1\nNo API key found for openai.\n";
      return undefined;
    });
  }
  const start = (tools: Map<string, any>) =>
    tools.get("agent").execute("1", { action: "start", name: "kid", task: "do it" }, undefined, undefined, { cwd: "/tmp" });

  test("waits for the child to begin its task; idle while ready is not idle", async () => {
    const { tools, methods, connect } = setup();
    const client = fakeClient();
    pane((id) => {
      client.info.id = id;
      connect(client);
      methods.get("state")(client, { status: "idle" });
      expect(g.__piAgents!.get("kid")!.status).toBe("starting");
      setTimeout(() => methods.get("started")(client, {}), 20);
    });
    const r = await start(tools);
    expect(r.content[0].text).toContain("Started agent kid");
    expect(g.__piAgents!.get("kid")!.status).toBe("working");
  });

  test("a child that reports a failure fails the start with its error", async () => {
    const { tools, methods, connect } = setup();
    const client = fakeClient();
    pane((id) => {
      client.info.id = id;
      connect(client);
      methods.get("failed")(client, { error: "no model selected" });
    });
    await expect(start(tools)).rejects.toThrow("did not start its task: no model selected");
    expect(g.__piAgents!.has("kid")).toBe(false);
  });

  test("a child that never begins fails with its last screen lines", async () => {
    const { tools, connect } = setup();
    const client = fakeClient();
    pane((id) => {
      client.info.id = id;
      connect(client);
    });
    const t0 = Date.now();
    await expect(start(tools)).rejects.toThrow(/did not start its task\.\nIts screen:\npi v1\nNo API key found for openai\./);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(g.__piAgents!.has("kid")).toBe(false);
  });

  test("a child that exits before hello fails fast", async () => {
    const { tools } = setup();
    pane(() => {}, false);
    const t0 = Date.now();
    await expect(start(tools)).rejects.toThrow(/did not connect[\s\S]*No API key found/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("resume without text does not wait for a task", async () => {
    const pi: any = { on: (ev: string, fn: any) => ev === "session_start" && (pi.start = fn), registerTool: () => {}, sendMessage: () => {}, appendEntry: () => {} };
    const methods = new Map<string, any>();
    const bridge: any = {
      running: true, socketPath: "/tmp/t.sock", token: "t",
      registerMethod: (_r: string, name: string, fn: any) => methods.set(name, fn),
      onShutdown: () => {}, broadcast: () => {}, event: () => {},
      onClient: (k: string, fn: any) => k === "connect" && (bridge.connect = fn),
    };
    const file = path.join(require("node:os").tmpdir(), `pi-agent-test-${process.pid}.jsonl`);
    fs.writeFileSync(file, "");
    try {
      const p2 = registerParent(pi, bridge, { onFilesChanged: () => {}, onRoster: () => {} });
      pi.start({}, { sessionManager: { getBranch: () => [{ type: "custom", customType: "agent-child", data: { name: "kid", title: "K", cwd: "/tmp", sessionFile: file } }] } });
      const client = fakeClient();
      pane((id) => {
        client.info.id = id;
        bridge.connect(client);
        methods.get("state")(client, { status: "idle" });
      });
      await p2.resume("kid");
      expect(g.__piAgents!.get("kid")!.status).toBe("idle");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("sweep", () => {
  test("closes blocks of dead parents; on a host only this machine's", async () => {
    const machine = require("node:os").hostname().split(".")[0];
    const dead = 2 ** 22 + 12345; // above macOS's pid range
    const labels = [
      `pi-agent:a:${dead}`, `pi-agent:b:${process.pid}`, "other",
      `pi-agent:c:${machine}:${dead}`, `pi-agent:d:elsewhere:${dead}`,
    ];
    rexReplies.push((args) => {
      if (args.includes("block") && args.includes("ls")) return JSON.stringify({ blocks: labels.map((label, i) => ({ block_id: `block:${i}`, label })) });
      return undefined;
    });
    const handlers = new Map<string, any>();
    const pi: any = { on: (ev: string, fn: any) => handlers.set(ev, fn), registerTool: () => {}, sendMessage: () => {}, appendEntry: () => {} };
    const bridge: any = { registerMethod: () => {}, onShutdown: () => {}, onClient: () => {}, broadcast: () => {}, event: () => {} };
    registerParent(pi, bridge, { onFilesChanged: () => {}, onRoster: () => {} });
    handlers.get("session_start")({}, {});
    await new Promise((r) => setTimeout(r, 20));
    const closed = rexCalls.filter((c) => c.includes("block.close")).map((c) => JSON.parse(c.at(-1)!).block_id);
    // Locally the label's last field is the owner pid, whatever comes before it.
    expect(closed.sort()).toEqual(["block:0", "block:3", "block:4"]);
  });
});
