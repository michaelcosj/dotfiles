// Agent change tracking: before pi first edits a file, its content is saved
// here (one JSON file per path), so Neovim can review everything pi changed
// against that baseline instead of git. Neovim removes an entry once you
// accept or reject the file, and moves its baseline forward when you commit
// it. Shared by every pi, keyed by absolute path. Neovim's side is
// nvim/lua/config/agent-bridge/changes.lua.
//
// `by` names the pi that edited the file first: "main", or a child agent's
// name (PI_AGENT_NAME). If several agents edit one file, the review shows
// all their changes under the first one's name.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHANGES_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
  "pi",
  "agent-changes",
);

function entryPath(file: string) {
  return path.join(CHANGES_DIR, `${crypto.createHash("sha256").update(file).digest("hex").slice(0, 16)}.json`);
}

// Saves the file as it is now, unless a baseline for it already exists.
export function trackBaseline(file: string) {
  const entry = entryPath(file);
  if (fs.existsSync(entry)) return;
  let baseline = "";
  let exists = true;
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) return; // binary; nothing to diff
    baseline = bytes.toString("utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") return;
    exists = false;
  }
  // Several pi processes share this directory. Write a private temp file,
  // then hard-link it into place: link fails if the entry exists, so the
  // first baseline wins and is never replaced or seen half-written.
  const tmp = `${entry}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(CHANGES_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, agent: "pi", by: process.env.PI_AGENT_NAME || "main", path: file, exists, baseline, created: Date.now() }),
      { mode: 0o600 },
    );
    fs.linkSync(tmp, entry);
  } catch {
    // EEXIST: another pi recorded it first
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

// Files under cwd that differ from their baseline (not yet reviewed).
export function countChanges(cwd: string): number {
  let n = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(CHANGES_DIR).filter((f) => f.endsWith(".json"));
  } catch {}
  for (const name of names) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(CHANGES_DIR, name), "utf8"));
      if (typeof e.path !== "string" || !(e.path === cwd || e.path.startsWith(cwd + path.sep))) continue;
      let current: string | undefined;
      try {
        current = fs.readFileSync(e.path, "utf8");
      } catch {}
      const unchanged = current === undefined ? !e.exists : e.exists && current === e.baseline;
      if (!unchanged) n++;
    } catch {}
  }
  return n;
}
