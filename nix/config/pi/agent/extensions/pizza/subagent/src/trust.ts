import { stat } from "node:fs/promises";
import path from "node:path";
import {
  getAgentDir,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
export async function resolveChildCwd(
  input: string | undefined,
  parentCwd: string,
  parentTrusted: boolean,
) {
  const cwd = path.resolve(parentCwd, input ?? ".");
  const info = await stat(cwd).catch(() => undefined);
  if (!info?.isDirectory())
    throw new Error(`Working directory is not a directory: ${cwd}`);
  if (cwd === path.resolve(parentCwd))
    return { cwd, projectTrusted: parentTrusted };
  let decision: boolean | null = null;
  try {
    decision = new ProjectTrustStore(getAgentDir()).get(cwd);
  } catch {}
  if (decision !== true)
    throw new Error(
      `Child working directory is not explicitly trusted: ${cwd}`,
    );
  return { cwd, projectTrusted: true };
}
