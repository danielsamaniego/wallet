import type { Context } from "hono";
import { z } from "zod";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { DepositHandler } from "../../../app/command/deposit/handler.js";

const mainLogTag = "DepositHTTP";

const RequestSchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().optional(),
});

export function depositHandler(handler: DepositHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "INVALID_REQUEST", message: "invalid JSON body" }, 400);
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "INVALID_REQUEST", message: parsed.error.message }, 400);
    }

    const walletId = c.req.param("walletId")!;

    try {
      const result = await handler.handle(ctx, {
        walletId,
        amountCents: BigInt(parsed.data.amount_cents),
        reference: parsed.data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
      });

      return c.json({ transaction_id: result.transactionId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
