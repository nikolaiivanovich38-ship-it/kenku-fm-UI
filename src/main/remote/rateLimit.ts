/**
 * SEC-4: at most `limit` hits per caller in any `windowMs`. Used by the remote-control server for requests in
 * general and for wrong secret codes, keyed by the caller's network address. Old callers are forgotten first beyond
 * `maxCallers`, so a flood of addresses cannot fill memory.
 */
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxCallers?: number;
}

/** `retryAfterMs` is there only when the caller is refused. */
export type RateAnswer = { allowed: boolean; retryAfterMs?: number };

export class RateLimit {
  private hits = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxCallers: number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
    this.maxCallers = options.maxCallers ?? 1000;
  }

  /** Count a hit for `caller`, unless it is already over the limit. */
  hit(caller: string): RateAnswer {
    const answer = this.check(caller);
    if (answer.allowed) {
      const recent = this.recent(caller);
      recent.push(this.now());
      this.hits.delete(caller);
      this.hits.set(caller, recent);
      while (this.hits.size > this.maxCallers) {
        this.hits.delete(this.hits.keys().next().value as string);
      }
    }
    return answer;
  }

  /** Whether `caller` may go on, without counting a hit. */
  check(caller: string): RateAnswer {
    const recent = this.recent(caller);
    if (recent.length < this.options.limit) return { allowed: true };
    return { allowed: false, retryAfterMs: recent[recent.length - this.options.limit] + this.options.windowMs - this.now() };
  }

  callerCount(): number {
    return this.hits.size;
  }

  private recent(caller: string): number[] {
    const since = this.now() - this.options.windowMs;
    return (this.hits.get(caller) ?? []).filter((time) => time > since);
  }
}
