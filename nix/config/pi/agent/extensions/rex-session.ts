// Records which pi session runs in which Rex pane, so Rex session restore can
// resume it with `pi --session <file>` after the Rex server restarts.
// Writes $XDG_STATE_HOME/rex/agents/<block>.json; nothing outside Rex.
// @ts-nocheck

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const block = process.env.REX_BLOCK;
const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
const dir = path.join(stateHome, "rex", "agents");
const file = block ? path.join(dir, `${block.replace(/^block:/, "").replace(/[^A-Za-z0-9_-]/g, "_")}.json`) : undefined;

function record(ctx: any) {
  if (!file) return;
  const sessionFile = ctx?.sessionManager?.getSessionFile?.();
  if (!sessionFile) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      kind: "pi",
      block,
      session: process.env.REX_SESSION,
      pid: process.pid,
      cwd: ctx?.cwd ?? process.cwd(),
      session_file: sessionFile,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // restore is best effort; never disturb pi
  }
}

function clear() {
  if (!file) return;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.pid === process.pid) fs.unlinkSync(file);
  } catch {}
}

export default function (pi: any) {
  if (!block) return;
  // session_start also fires for /new, /resume and forks, so the file follows the session
  pi.on("session_start", (_event: any, ctx: any) => record(ctx));
  pi.on("agent_settled", (_event: any, ctx: any) => record(ctx));
  // a clean exit means nothing to resume; a killed pi (server stop) never gets here
  pi.on("session_shutdown", () => clear());
}
