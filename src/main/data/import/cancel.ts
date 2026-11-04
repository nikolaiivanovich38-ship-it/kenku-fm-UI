/** Stopping a long job (an import, a search for moved files) when the game master presses Stop. */

/** The error a cancelled job ends with; jobs that save as they go catch it and report what was saved. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

export const cancelled = (error: unknown): error is CancelledError => error instanceof CancelledError;

/**
 * Runs `fn` over `items`, at most `limit` at a time, keeping the results in
 * order (reading tags and checksums of several files at once is much faster
 * than one by one, and bounded so a 5,000-file import does not open 5,000 files).
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
