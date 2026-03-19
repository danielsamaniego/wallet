import type { Context } from "hono";
import { z } from "zod";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { PlaceHoldHandler } from "../../../application/command/placeHold/handler.js";

const mainLogTag = "PlaceHoldHTTP";

const RequestSchema = z.object({
  wallet_id: z.string().min(1).max(255),
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
  expires_at: z.number().int().positive().optional(),
});

export function placeHoldHandler(handler: PlaceHoldHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const body = await c.req.json().catch(() => null);
    if (!body) {
      logger.warn(ctx, `${methodLogTag} invalid JSON body`);
      return c.json({ error: "INVALID_REQUEST", message: "invalid JSON body" }, 400);
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn(ctx, `${methodLogTag} validation failed`, { reason: parsed.error.message });
      return c.json({ error: "INVALID_REQUEST", message: parsed.error.message }, 400);
    }

    try {
      const result = await handler.handle(ctx, {
        walletId: parsed.data.wallet_id,
        amountCents: BigInt(parsed.data.amount_cents),
        reference: parsed.data.reference,
        expiresAt: parsed.data.expires_at,
        platformId: ctx.platformId!,
      });

      return c.json({ hold_id: result.holdId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
