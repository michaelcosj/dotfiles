/** Trusts an agent worktree (agent-worktree, under $AGENT_WORKTREES) when its main checkout is
 * trusted, so a child agent started with `worktree: true` does not stop at the trust prompt.
 * The decision is not saved: trust.json keeps one entry per repository, and a worktree follows it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import type { ExtensionAPI, ProjectTrustEventResult } from "@earendil-works/pi-coding-agent";

const UNDECIDED: ProjectTrustEventResult = { trusted: "undecided" };

const real = (path: string) => (existsSync(path) ? realpathSync(path) : path);

const worktreesDir = () =>
  real(process.env.AGENT_WORKTREES ?? join(homedir(), ".local", "share", "worktrees"));

const trustFile = () =>
  join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "trust.json");

/** The main checkout of the repository that holds `cwd`. */
const mainCheckout = (cwd: string) => {
  const common = execFileSync(
    "git",
    ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();

  return common.endsWith(`${sep}.git`) ? dirname(common) : undefined;
};

/** The saved decision for `path` or its closest parent, as Pi resolves it. */
const savedDecision = (path: string): boolean | undefined => {
  const saved: Record<string, unknown> = JSON.parse(readFileSync(trustFile(), "utf8"));

  for (let dir = path; ; dir = dirname(dir)) {
    const decision = saved[dir];

    if (typeof decision === "boolean") return decision;
    if (dirname(dir) === dir) return undefined;
  }
};

export default function registerWorktreeTrust(pi: ExtensionAPI) {
  pi.on("project_trust", (event): ProjectTrustEventResult => {
    try {
      const cwd = real(event.cwd);

      if (!cwd.startsWith(worktreesDir() + sep)) return UNDECIDED;

      const root = mainCheckout(cwd);

      if (root === undefined || savedDecision(real(root)) !== true) return UNDECIDED;

      return { trusted: "yes" };
    } catch {
      return UNDECIDED;
    }
  });
}
