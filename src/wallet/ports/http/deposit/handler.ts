import type { Context } from "hono";
import { z } from "zod";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { DepositHandler } from "../../../application/command/deposit/handler.js";

const mainLogTag = "DepositHTTP";

const RequestSchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().optional(),
});

export function depositHandler(handler: DepositHandler, logger: ILogger) {
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

    const walletId = c.req.param("walletId")!;

    try {
      const result = await handler.handle(ctx, {
        walletId,
        amountCents: BigInt(parsed.data.amount_cents),
        reference: parsed.data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json({ transaction_id: result.transactionId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
