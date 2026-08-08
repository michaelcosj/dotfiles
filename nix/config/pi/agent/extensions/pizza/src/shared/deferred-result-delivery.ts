export interface DeferredResultClaim<T extends { id: string }> {
  readonly id: string;
  readonly result: T;
  readonly generation: number;
}

/**
 * One-shot delivery for session-scoped results.
 *
 * Claims are generation-aware because a command may temporarily take a result
 * while the same id settles again. If that command fails, it may restore only
 * the claim it actually removed; it can never resurrect an older result over
 * a newer generation.
 */
export function createDeferredResultDelivery<T extends { id: string }>() {
  const pending = new Map<string, DeferredResultClaim<T>>();
  const latestGeneration = new Map<string, number>();
  let generation = 0;

  const take = (id: string) => {
    const claim = pending.get(id);
    if (claim) pending.delete(id);
    return claim;
  };

  return {
    defer(result: T) {
      const nextGeneration = ++generation;
      latestGeneration.set(result.id, nextGeneration);
      pending.set(result.id, {
        id: result.id,
        result,
        generation: nextGeneration,
      });
    },

    take,

    takeAll() {
      const claims = [...pending.values()];
      pending.clear();
      return claims;
    },

    restoreIfAbsent(claim: DeferredResultClaim<T>) {
      if (
        pending.has(claim.id) ||
        latestGeneration.get(claim.id) !== claim.generation
      ) {
        return false;
      }
      pending.set(claim.id, claim);
      return true;
    },

    consume(ids: Iterable<string>) {
      for (const id of ids) pending.delete(id);
    },

    consumeIf(id: string, predicate: (result: T) => boolean) {
      const claim = pending.get(id);
      if (!claim || !predicate(claim.result)) return false;
      pending.delete(id);
      return true;
    },

    /** Simpler terminal-facing view when a claim is not needed. */
    drain() {
      return this.takeAll().map((claim) => claim.result);
    },

    clear() {
      pending.clear();
      latestGeneration.clear();
    },
  };
}
