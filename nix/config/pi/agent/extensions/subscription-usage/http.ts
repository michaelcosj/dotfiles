export class UsageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "UsageError";
  }
}

export async function fetchJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": "pi-subscription-usage", ...headers }, signal });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new UsageError(`HTTP ${response.status}`, response.status);
  }
  return response.json();
}
