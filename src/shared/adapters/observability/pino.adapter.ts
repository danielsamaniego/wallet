import pino from "pino";

import type { AppContext } from "../../domain/kernel/context.js";
import type { ILogger } from "../../domain/observability/logger.port.js";

/**
 * PinoAdapter implements ILogger using pino (structured JSON logging).
 * Adds tracking_id, platform_id, start_ts from AppContext to every event.
 * Adds tracking_id, platform_id, start_ts from AppContext to every event.
 */
export class PinoAdapter implements ILogger {
  private readonly log: pino.Logger;

  constructor(level: string = "info") {
    this.log = pino({ level });
  }

  private fromExisting(pinoLogger: pino.Logger): PinoAdapter {
    const adapter = Object.create(PinoAdapter.prototype) as PinoAdapter;
    Object.defineProperty(adapter, "log", { value: pinoLogger, writable: false });
    return adapter;
  }

  private contextFields(ctx: AppContext): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      tracking_id: ctx.trackingId,
      start_ts: ctx.startTs,
    };
    if (ctx.platformId) {
      fields.platform_id = ctx.platformId;
    }
    return fields;
  }

  private logEvent(
    level: pino.Level,
    ctx: AppContext,
    msg: string,
    extras?: Record<string, unknown>,
  ): void {
    const fields = { ...this.contextFields(ctx), ...extras };
    this.log[level](fields, msg);
  }

  debug(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.logEvent("debug", ctx, msg, extras);
  }

  info(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.logEvent("info", ctx, msg, extras);
  }

  warn(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.logEvent("warn", ctx, msg, extras);
  }

  error(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.logEvent("error", ctx, msg, extras);
  }

  fatal(ctx: AppContext, msg: string, extras?: Record<string, unknown>): void {
    this.logEvent("fatal", ctx, msg, extras);
  }

  with(key: string, value: unknown): ILogger {
    const child = this.log.child({ [key]: value });
    return this.fromExisting(child);
  }

  addCanonicalMeta(ctx: AppContext, entries: Record<string, unknown>): void {
    ctx.canonical.addMany(entries);
  }

  incrementCanonical(ctx: AppContext, key: string, delta: number): void {
    ctx.canonical.increment(key, delta);
  }

  decrementCanonical(ctx: AppContext, key: string, delta: number): void {
    ctx.canonical.decrement(key, delta);
  }

  private dispatchCanonical(level: pino.Level, ctx: AppContext, msg: string): void {
    const endTs = Date.now();
    const durationMs = endTs - ctx.startTs;
    const { meta, counters } = ctx.canonical.snapshot();

    const fields: Record<string, unknown> = {
      ...this.contextFields(ctx),
      end_ts: endTs,
      duration_ms: durationMs,
    };
    if (Object.keys(meta).length > 0) fields.canonical_meta = meta;
    if (Object.keys(counters).length > 0) fields.canonical_counters = counters;

    this.log[level](fields, msg);
    ctx.canonical.clear();
  }

  dispatchCanonicalDebug(ctx: AppContext, msg: string): void {
    this.dispatchCanonical("debug", ctx, msg);
  }

  dispatchCanonicalInfo(ctx: AppContext, msg: string): void {
    this.dispatchCanonical("info", ctx, msg);
  }

  dispatchCanonicalWarn(ctx: AppContext, msg: string): void {
    this.dispatchCanonical("warn", ctx, msg);
  }

  dispatchCanonicalError(ctx: AppContext, msg: string): void {
    this.dispatchCanonical("error", ctx, msg);
  }
}
