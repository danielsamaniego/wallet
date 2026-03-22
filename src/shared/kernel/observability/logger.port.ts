import type { AppContext } from "../context.js";

/**
 * Logger is the port for structured logging. Implementations (e.g. Pino adapter)
 * add tracking_id, platform_id, start_ts from AppContext to every event.
 * Domain and app depend only on this interface; no external logging libraries.
 * Domain and app depend only on this interface; no external logging libraries.
 */
export interface ILogger {
  debug(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void;
  info(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void;
  warn(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void;
  error(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void;
  fatal(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void;
  with(key: string, value: unknown): ILogger;

  addCanonicalMeta(ctx: AppContext, entries: Record<string, unknown>): void;
  incrementCanonical(ctx: AppContext, key: string, delta: number): void;
  decrementCanonical(ctx: AppContext, key: string, delta: number): void;
  dispatchCanonicalDebug(ctx: AppContext, msg: string): void;
  dispatchCanonicalInfo(ctx: AppContext, msg: string): void;
  dispatchCanonicalWarn(ctx: AppContext, msg: string): void;
  dispatchCanonicalError(ctx: AppContext, msg: string): void;
}
