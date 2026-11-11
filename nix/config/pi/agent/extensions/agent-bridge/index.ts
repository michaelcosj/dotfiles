// agent-bridge: connects pi to other programs over a local socket.
//   core.ts     socket, auth, roles, discovery, shared widget
//   editor.ts   Neovim (role "editor"): reviews, plans, follow, context
//   agents/     child agents in Rex panes (role "agent"), the `agent` tool,
//               and the agent list below the editor
// A child agent (PI_BRIDGE_PARENT set) runs no server and no editor plugin;
// it connects up to its parent instead.
import { inRex } from "../lib/rex.js";
import { IS_REMOTE, registerChild } from "./agents/child.js";
import { registerParent } from "./agents/parent.js";
import { ENV } from "./agents/protocol.js";
import { childEditor, registerAgentsUI } from "./agents/ui.js";
import { trackBaseline } from "./baselines.js";
import { createBridge, IS_CHILD } from "./core.js";
import { registerEditor, toolPath } from "./editor.js";
import path from "node:path";

export default function (pi: any) {
  if (IS_CHILD) {
    const name = process.env[ENV.name] ?? "agent";
    let child: ReturnType<typeof registerChild>;
    const ui = registerAgentsUI(pi, {
      self: name,
      onSwitched: (block) => child.view(block),
      switchRemote: (to) => child.switchTo(to),
      remote: IS_REMOTE,
    });
    child = registerChild(pi, { onRoster: (r) => ui.setRoster(r) });
    childEditor(pi, name, process.env[ENV.title] ?? name);
    // Children record baselines for Neovim's change review, tagged with their name.
    // A remote child's files are on its host, out of Neovim's reach here.
    pi.on("tool_call", (event: any, ctx: any) => {
      if (IS_REMOTE) return;
      if (event.toolName !== "edit" && event.toolName !== "write") return;
      const rel = toolPath(event.input);
      if (rel) trackBaseline(path.resolve(ctx?.cwd ?? process.cwd(), rel));
    });
    return;
  }

  const bridge = createBridge(pi);
  let parent: ReturnType<typeof registerParent> | undefined;
  const editor = registerEditor(pi, bridge, { routeNote: (agent, text, review) => parent?.routeNote(agent, text, review) ?? false });
  if (!inRex()) return;
  let ui: ReturnType<typeof registerAgentsUI>;
  parent = registerParent(pi, bridge, {
    onFilesChanged: (paths) => editor.filesChanged(paths),
    onRoster: (r) => ui.setRoster(r),
  });
  ui = registerAgentsUI(pi, {
    self: "main",
    onSwitched: (block) => parent!.setVisible(block),
    selfTokens: () => parent!.selfTokens(),
    resumable: () => parent!.resumable(),
    resume: (name) => parent!.resume(name),
    switchRemote: (name) => parent!.view(name),
  });
}
