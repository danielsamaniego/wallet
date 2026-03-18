import type { AppContext } from "../../domain/kernel/context.js";
import type { ILogger } from "../../domain/observability/logger.port.js";

/**
 * SensitiveKeysFilter wraps a ILogger and omits any key-value pair whose key
 * is in the sensitive set (exact match). Filters recursively through nested
 * plain objects to prevent leaking sensitive data at any depth.
 * Filters recursively through nested plain objects to prevent leaking
 * sensitive data at any depth.
 */
export class SensitiveKeysFilter implements ILogger {
  private readonly inner: ILogger;
  private readonly keys: Set<string>;

  constructor(inner: ILogger, sensitiveKeys: string[]) {
    this.inner = inner;
    this.keys = new Set(sensitiveKeys.filter((k) => k.length > 0));
  }

  private filterValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => this.filterValue(item));

    const obj = value as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (this.keys.has(key)) continue;
      filtered[key] = this.filterValue(val);
    }
    return filtered;
  }

  private filterExtras(extras?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!extras) return undefined;
    return this.filterValue(extras) as Record<string, unknown>;
  }

  debug(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.inner.debug(ctx, msg, this.filterExtras(extras));
  }

  info(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.inner.info(ctx, msg, this.filterExtras(extras));
  }

  warn(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.inner.warn(ctx, msg, this.filterExtras(extras));
  }

  error(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.inner.error(ctx, msg, this.filterExtras(extras));
  }

  fatal(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.inner.fatal(ctx, msg, this.filterExtras(extras));
  }

  with(key: string, value: unknown): ILogger {
    if (this.keys.has(key)) return this;
    const inner = this.inner.with(key, value);
    return new SensitiveKeysFilter(inner, [...this.keys]);
  }

  addCanonicalMeta(ctx: AppContext, entries: Record<string, unknown>): void {
    const filtered = this.filterExtras(entries);
    if (filtered) this.inner.addCanonicalMeta(ctx, filtered);
  }

  incrementCanonical(ctx: AppContext, key: string, delta: number): void {
    this.inner.incrementCanonical(ctx, key, delta);
  }

  decrementCanonical(ctx: AppContext, key: string, delta: number): void {
    this.inner.decrementCanonical(ctx, key, delta);
  }

  dispatchCanonicalDebug(ctx: AppContext, msg: string): void {
    this.inner.dispatchCanonicalDebug(ctx, msg);
  }

  dispatchCanonicalInfo(ctx: AppContext, msg: string): void {
    this.inner.dispatchCanonicalInfo(ctx, msg);
  }

  dispatchCanonicalWarn(ctx: AppContext, msg: string): void {
    this.inner.dispatchCanonicalWarn(ctx, msg);
  }

  dispatchCanonicalError(ctx: AppContext, msg: string): void {
    this.inner.dispatchCanonicalError(ctx, msg);
  }
}
