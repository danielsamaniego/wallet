/**
 * CanonicalAccumulator holds metadata and counters for the canonical log of a request.
 * Request-scoped; middleware creates one per request and injects it into context.
 * Request-scoped; middleware creates one per request and injects it into context.
 */
export class CanonicalAccumulator {
  private meta: Record<string, unknown> = {};
  private counters: Record<string, number> = {};

  add(key: string, value: unknown): void {
    this.meta[key] = value;
  }

  addMany(entries: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(entries)) {
      this.meta[key] = value;
    }
  }

  increment(key: string, delta: number): void {
    this.counters[key] = (this.counters[key] ?? 0) + delta;
  }

  decrement(key: string, delta: number): void {
    this.increment(key, -delta);
  }

  snapshot(): { meta: Record<string, unknown>; counters: Record<string, number> } {
    return {
      meta: { ...this.meta },
      counters: { ...this.counters },
    };
  }

  clear(): void {
    this.meta = {};
    this.counters = {};
  }
}
