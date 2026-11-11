// Small helpers for the Rex CLI, shared by extensions. This directory has no
// index.ts, so pi doesn't load it as an extension.
//
// Every helper acts on this pi's own session unless given a Target: a session
// on another Rex host (`server` is the host's label, passed as `-S`).
import { execFile } from "node:child_process";

export const REX_SESSION = process.env.REX_SESSION;
export const REX_BLOCK = process.env.REX_BLOCK;

export const inRex = () => !!REX_SESSION && !!REX_BLOCK;

export interface Target {
  /** a host's label; undefined is this machine's server */
  server?: string;
  session: string;
}

const here = (): Target => ({ session: REX_SESSION! });

export interface RexBlock {
  block_id: string;
  label?: string;
  placement?: "placed" | "detached";
  window_id?: string;
}

export function rex(args: string[], timeoutMs = 10_000, server?: string): Promise<string> {
  const pre = server ? ["-S", server] : [];
  return new Promise((resolve, reject) => {
    execFile("rex", ["--autostart=false", ...pre, ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

/** Calls a server API method in a Rex session (this one by default). */
export async function call(method: string, params: Record<string, unknown> = {}, t: Target = here()): Promise<any> {
  const out = await rex(["api", "call", "-s", t.session, method, JSON.stringify({ session_id: t.session, ...params })], 10_000, t.server);
  return out.trim() ? JSON.parse(out) : undefined;
}

export async function blockCall(block: string, method: string, params: Record<string, unknown> = {}, t: Target = here()): Promise<any> {
  const out = await rex(["block", "call", "-s", t.session, "-b", block, method, JSON.stringify(params)], 10_000, t.server);
  return out.trim() ? JSON.parse(out) : undefined;
}

export async function blocks(t: Target = here()): Promise<RexBlock[]> {
  return JSON.parse(await rex(["block", "ls", "-s", t.session, "--json"], 10_000, t.server)).blocks ?? [];
}

export async function windowOf(block: string): Promise<string | undefined> {
  return (await blocks()).find((b) => b.block_id === block && b.placement === "placed")?.window_id;
}

export async function capture(block: string, t: Target = here()): Promise<string> {
  return rex(["capture", "-s", t.session, "-b", block, "--trim"], 10_000, t.server);
}

const SHELL = "com.superlogical.terminal.shell";

/**
 * Starts a terminal outside any window; place it later with swap().
 * keepOpen: the block stays after its program exits, so a pane that was
 * swapped out for it can be swapped back into its place (Rex can't place a
 * detached block into an empty slot).
 */
export async function newDetachedTerminal(opts: {
  label: string;
  command: string[];
  cwd: string;
  size?: { columns: number; rows: number };
  keepOpen?: boolean;
}): Promise<string> {
  const r = await call("session.new_block", {
    flavor: SHELL,
    label: opts.label,
    options: {
      command: opts.command,
      cwd: opts.cwd,
      ...(opts.size ? { size: opts.size } : {}),
      ...(opts.keepOpen ? { exit: { on_completion: false } } : {}),
    },
  });
  return r.block_id;
}

/** Opens a terminal in a new tab of `t`'s session, without taking focus. */
export async function newWindowTerminal(
  t: Target,
  opts: { name: string; label: string; command: string[]; size?: { columns: number; rows: number }; keepOpen?: boolean },
): Promise<{ window: string; block: string }> {
  const r = await call(
    "session.new_window",
    {
      window_label: opts.name,
      focus: false,
      layout: {
        block: {
          flavor: SHELL,
          label: opts.label,
          options: {
            command: opts.command,
            ...(opts.size ? { size: opts.size } : {}),
            ...(opts.keepOpen ? { exit: { on_completion: false } } : {}),
          },
        },
      },
    },
    t,
  );
  return { window: r.window_id, block: r.block_ids[0] };
}

/**
 * Puts `target` where `current` is and detaches `current`; both keep
 * running. Move first: a window closes when its last block leaves it.
 */
export async function swap(current: string, target: string) {
  await call("session.move_block", { anchor_block_id: current, block_id: target });
  try {
    await call("session.detach_block", { block_id: current });
  } catch (e) {
    // Leave the split rather than lose a pane; the user sees both.
    throw new Error(`moved in, but could not hide the old pane: ${(e as Error).message}`);
  }
  await call("session.focus_block", { block_id: target }).catch(() => {});
}

/** Whether the block's program has exited (the block itself may remain). */
export async function exited(block: string, t: Target = here()): Promise<boolean> {
  try {
    const p = await blockCall(block, "process", {}, t);
    return !p?.child;
  } catch {
    return true; // block is gone
  }
}

export async function closeBlock(block: string, t: Target = here()) {
  await call("block.close", { block_id: block }, t);
}

// ---- other hosts ----

export interface Host {
  label: string;
  status: string;
  endpoint?: string;
  detail?: string;
}

/** The hosts this machine knows, and whether each answers. */
export async function hosts(): Promise<Host[]> {
  return JSON.parse(await rex(["hosts", "check", "--json"], 30_000)).hosts ?? [];
}

/** A session on `server` with this label, created if missing. */
export async function ensureSession(server: string, label: string): Promise<string> {
  const list = JSON.parse(await rex(["ls", "--json"], 10_000, server)).sessions ?? [];
  const found = list.find((s: any) => s.label === label);
  if (found) return found.session_id;
  const out = await rex(["api", "call", "session.create", JSON.stringify({ label })], 10_000, server);
  return JSON.parse(out).session_id;
}

export async function killSession(t: Target) {
  await rex(["kill", t.session], 10_000, t.server);
}

export interface RexClient {
  client_id: string;
  info?: { kind?: string; label?: string; name?: string };
  session_ids?: string[];
}

export async function clients(server?: string): Promise<RexClient[]> {
  return JSON.parse(await rex(["client", "ls", "--json"], 10_000, server)).clients ?? [];
}

/** The Rex app showing this pi's session (the one the user is looking at). */
export async function ownApp(): Promise<RexClient | undefined> {
  const apps = (await clients()).filter((c) => c.info?.kind === "app");
  return apps.find((c) => c.session_ids?.includes(REX_SESSION!)) ?? (apps.length === 1 ? apps[0] : undefined);
}

/**
 * Makes the user's Rex app show a session (and tab) on `t.server`, or on this
 * machine when unset. The app connects to each host separately, so find its
 * client there by the label it has here.
 */
export async function showSession(t: Target, window?: string) {
  const app = await ownApp();
  if (!app) throw new Error("no Rex app is showing this session");
  let client = app.client_id;
  if (t.server) {
    const there = (await clients(t.server)).filter((c) => c.info?.kind === "app");
    const match = there.filter((c) => c.info?.label === app.info?.label);
    const pick = match.length === 1 ? match[0] : there.length === 1 ? there[0] : undefined;
    if (!pick) throw new Error(`the Rex app is not connected to ${t.server}`);
    client = pick.client_id;
  }
  const args = ["-C", client, "do", "session.select", `session_id=${t.session}`];
  if (window) args.push(`window_id=${window}`);
  await rex(args, 10_000, t.server);
}
