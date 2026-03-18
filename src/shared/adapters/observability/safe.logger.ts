import type { AppContext } from "../../domain/kernel/context.js";
import type { ILogger } from "../../domain/observability/logger.port.js";

/**
 * SafeLogger wraps a ILogger and recovers from any exception in logging.
 * Under no circumstance shall a logger error stop execution.
 * Under no circumstance shall a logger error stop execution.
 */
export class SafeLogger implements ILogger {
  private readonly inner: ILogger;

  constructor(inner: ILogger) {
    this.inner = inner;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Swallow — logger failure must never stop execution
    }
  }

  debug(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.debug(ctx, msg, extras));
  }

  info(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.info(ctx, msg, extras));
  }

  warn(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.warn(ctx, msg, extras));
  }

  error(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.error(ctx, msg, extras));
  }

  fatal(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.safe(() => this.inner.fatal(ctx, msg, extras));
    process.exit(1);
  }

  with(key: string, value: unknown): ILogger {
    try {
      const inner = this.inner.with(key, value);
      return new SafeLogger(inner);
    } catch {
      return this;
    }
  }

  addCanonicalMeta(ctx: AppContext, entries: Record<string, unknown>): void {
    this.safe(() => this.inner.addCanonicalMeta(ctx, entries));
  }

  incrementCanonical(ctx: AppContext, key: string, delta: number): void {
    this.safe(() => this.inner.incrementCanonical(ctx, key, delta));
  }

  decrementCanonical(ctx: AppContext, key: string, delta: number): void {
    this.safe(() => this.inner.decrementCanonical(ctx, key, delta));
  }

  dispatchCanonicalDebug(ctx: AppContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalDebug(ctx, msg));
  }

  dispatchCanonicalInfo(ctx: AppContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalInfo(ctx, msg));
  }

  dispatchCanonicalWarn(ctx: AppContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalWarn(ctx, msg));
  }

  dispatchCanonicalError(ctx: AppContext, msg: string): void {
    this.safe(() => this.inner.dispatchCanonicalError(ctx, msg));
  }
}
