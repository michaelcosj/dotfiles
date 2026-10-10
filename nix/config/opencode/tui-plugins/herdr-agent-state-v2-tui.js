// Per-TUI Herdr reporter. The V2 server is shared, so only the client process
// has the HERDR_PANE_ID belonging to each terminal pane.

import net from "node:net";
import { Rpc } from "@opencode-ai/plugin/rpc";
import { Plugin } from "@opencode-ai/plugin/tui";

const SOURCE = "herdr:opencode";
const AGENT = "opencode";
const states = new Map();
let seq = Date.now() * 1000;
let queue = Promise.resolve();

function controlClient(ctx) {
  const contract = Rpc.define({
    id: "herdr",
    methods: Object.fromEntries(
      ["tui_acquire", "tui_release"].map((name) => [
        name,
        {
          input: { type: "object", additionalProperties: false },
          output: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      ]),
    ),
    events: {},
  });
  return ctx.client.rpc(contract);
}

function enabled() {
  return (
    process.env.HERDR_ENV === "1" &&
    !!process.env.HERDR_SOCKET_PATH &&
    !!process.env.HERDR_PANE_ID
  );
}

function send(method, params = {}) {
  queue = queue.then(() => sendOnce(method, params)).catch(() => {});
  return queue;
}

function sendOnce(method, params) {
  const { HERDR_PANE_ID: paneId, HERDR_SOCKET_PATH: socketPath } = process.env;
  if (!paneId || !socketPath) return Promise.resolve();
  const endpoint =
    process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const payload = {
    id: `${SOURCE}:tui:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: ++seq,
      ...params,
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(endpoint, () =>
      client.write(`${JSON.stringify(payload)}\n`),
    );
    const done = () => {
      client.destroy();
      resolve();
    };
    client.setTimeout(500, done);
    client.on("data", done);
    client.on("error", done);
    client.on("end", done);
    client.on("close", resolve);
  });
}

function parseEvent(event) {
  const type = event?.details?.type ?? event?.type;
  const props =
    event?.details?.properties ??
    event?.details?.data ??
    event?.data ??
    event?.properties ??
    {};
  return {
    type,
    props,
    sessionID:
      typeof props.sessionID === "string" ? props.sessionID : undefined,
  };
}

function tabSessionIDs(ctx) {
  if (!ctx.ui.tabs.enabled()) return [];
  return ctx.ui.tabs
    .list()
    .map((tab) => (typeof tab === "string" ? tab : (tab?.sessionID ?? tab?.id)))
    .filter((id) => typeof id === "string");
}

function focusedSessionID(ctx) {
  const route = ctx.ui.router.current();
  return route?.type === "session" ? route.sessionID : undefined;
}

function trackedSessionIDs(ctx) {
  const tabs = tabSessionIDs(ctx);
  if (tabs.length > 0) return tabs;
  const focused = focusedSessionID(ctx);
  return focused ? [focused] : [];
}

function statusState(status) {
  const name = (
    typeof status === "string" ? status : status?.type
  )?.toLowerCase();
  if (name === "idle") return "idle";
  if (
    [
      "active",
      "busy",
      "pending",
      "retry",
      "running",
      "streaming",
      "working",
    ].includes(name)
  ) {
    return "working";
  }
}

function eventState(type, props) {
  if (type === "session.status") return statusState(props.status);
  if (["permission.asked", "question.asked", "session.error"].includes(type))
    return "blocked";
  if (
    [
      "session.execution.started",
      "tool.execute.before",
      "tool.execute.after",
      "permission.replied",
      "question.replied",
      "question.rejected",
      "session.compacted",
    ].includes(type)
  )
    return "working";
  if (
    [
      "session.execution.succeeded",
      "session.execution.failed",
      "session.idle",
    ].includes(type)
  ) {
    return "idle";
  }
}

async function publish(ctx, force = false) {
  const tracked = trackedSessionIDs(ctx);
  const focused = focusedSessionID(ctx) ?? tracked[0];
  if (!focused) return;

  const values = tracked.map(
    (id) =>
      states.get(id) ?? statusState(ctx.data.session.status(id)) ?? "idle",
  );
  const state = values.includes("blocked")
    ? "blocked"
    : values.includes("working")
      ? "working"
      : "idle";
  const key = `${focused}:${state}:${tracked.join(",")}`;
  if (!force && publish.last === key) return;
  publish.last = key;
  await send("pane.report_agent_session", { agent_session_id: focused });
  await send("pane.report_agent", { state, agent_session_id: focused });
}

export default Plugin.define({
  id: "herdr.agent-state.v2.tui",
  async setup(ctx) {
    if (!enabled()) return;

    const control = controlClient(ctx);
    await control.tui_acquire({});
    await publish(ctx, true);

    const stop = ctx.data.listen((event) => {
      const { type, props, sessionID } = parseEvent(event);
      const state = eventState(type, props);
      if (sessionID && state) states.set(sessionID, state);
      void publish(ctx);
    });

    return async () => {
      stop();
      await control.tui_release({}).catch(() => {});
      await send("pane.release_agent", {});
    };
  },
});
