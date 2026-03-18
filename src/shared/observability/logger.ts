import type { RequestContext } from "../kernel/context.js";

/**
 * Logger is the port for structured logging. Implementations (e.g. Pino adapter)
 * add tracking_id, platform_id, start_ts from RequestContext to every event.
 * Domain and app depend only on this interface; no external logging libraries.
 * Domain and app depend only on this interface; no external logging libraries.
 */
export interface Logger {
  debug(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void;
  info(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void;
  warn(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void;
  error(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void;
  fatal(ctx: RequestContext, msg: string, extras?: Record<string, unknown>): void;
  with(key: string, value: unknown): Logger;

  addCanonicalMeta(ctx: RequestContext, entries: Record<string, unknown>): void;
  incrementCanonical(ctx: RequestContext, key: string, delta: number): void;
  decrementCanonical(ctx: RequestContext, key: string, delta: number): void;
  dispatchCanonicalDebug(ctx: RequestContext, msg: string): void;
  dispatchCanonicalInfo(ctx: RequestContext, msg: string): void;
  dispatchCanonicalWarn(ctx: RequestContext, msg: string): void;
  dispatchCanonicalError(ctx: RequestContext, msg: string): void;
}
