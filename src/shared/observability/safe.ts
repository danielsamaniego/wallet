import type { RequestContext } from "../kernel/context.js";
import type { Logger } from "./logger.js";

/**
 * SafeLogger wraps a Logger and recovers from any exception in logging.
 * Under no circumstance shall a logger error stop execution.
 * Under no circumstance shall a logger error stop execution.
 */
export class SafeLogger implements Logger {
  private readonly inner: Logger;

  constructor(inner: Logger) {
    this.inner = inner;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Swallow — logger failure must never stop execution
    }
  }

  debug(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.debug(ctx, msg, extras));
  }

  info(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.info(ctx, msg, extras));
  }

  warn(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.warn(ctx, msg, extras));
  }

  error(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.error(ctx, msg, extras));
  }

  fatal(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.fatal(ctx, msg, extras));
    process.exit(1);
  }

  with(key: string, value: unknown): Logger {
    try {
      const inner = this.inner.with(key, value);
      return new SafeLogger(inner);
    } catch {
      return this;
    }
  }

  addCanonicalMeta(ctx: RequestContext, entries: Record<string, unknown>): void {
    this.safe(() => this.inner.addCanonicalMeta(ctx, entries));
  }

  incrementCanonical(ctx: RequestContext, key: string, delta: number): void {
    this.safe(() => this.inner.incrementCanonical(ctx, key, delta));
  }

  decrementCanonical(ctx: RequestContext, key: string, delta: number): void {
    this.safe(() => this.inner.decrementCanonical(ctx, key, delta));
  }

  dispatchCanonicalDebug(ctx: RequestContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalDebug(ctx, msg));
  }

  dispatchCanonicalInfo(ctx: RequestContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalInfo(ctx, msg));
  }

  dispatchCanonicalWarn(ctx: RequestContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalWarn(ctx, msg));
  }

  dispatchCanonicalError(ctx: RequestContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalError(ctx, msg));
  }
}
