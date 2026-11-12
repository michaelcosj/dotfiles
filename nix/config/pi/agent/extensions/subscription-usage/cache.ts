/** Usage cache shared by all Pi processes, so only one of them polls. Missing or corrupt file means empty. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isSnapshot, mergeSnapshot, PROVIDERS, type ProviderId, type Snapshot } from "./model.ts";

export interface Entry {
  snapshot?: Snapshot;
  /** Epoch ms. No poll before this time: a claim by a polling process, or error back-off. */
  nextPollAt?: number;
  failures?: number;
  lastError?: string;
  rateLimited?: boolean;
}

export interface CacheFile {
  version: 1;
  providers: Partial<Record<ProviderId, Entry>>;
}

export function parseCache(raw: string): CacheFile {
  const empty: CacheFile = { version: 1, providers: {} };
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !data.providers || typeof data.providers !== "object") return empty;
    for (const id of PROVIDERS) {
      const entry = data.providers[id];
      if (!entry || typeof entry !== "object") continue;
      const clean: Entry = {};
      if (isSnapshot(entry.snapshot)) clean.snapshot = entry.snapshot;
      if (typeof entry.nextPollAt === "number") clean.nextPollAt = entry.nextPollAt;
      if (typeof entry.failures === "number") clean.failures = entry.failures;
      if (typeof entry.lastError === "string") clean.lastError = entry.lastError;
      if (entry.rateLimited === true) clean.rateLimited = true;
      empty.providers[id] = clean;
    }
  } catch {}
  return empty;
}

export async function readCache(path: string): Promise<CacheFile> {
  try {
    return parseCache(await readFile(path, "utf8"));
  } catch {
    return { version: 1, providers: {} };
  }
}

/** Read, change one provider entry, and write back atomically (temp file + rename). */
export async function updateEntry(path: string, id: ProviderId, change: (entry: Entry) => void): Promise<CacheFile> {
  const cache = await readCache(path);
  const entry = (cache.providers[id] ??= {});
  change(entry);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(cache), { mode: 0o600 });
  await rename(tmp, path);
  return cache;
}

export function storeSnapshot(entry: Entry, snapshot: Snapshot): void {
  entry.snapshot = mergeSnapshot(entry.snapshot, snapshot);
}
