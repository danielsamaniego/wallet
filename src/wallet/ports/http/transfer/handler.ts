import type { Context } from "hono";
import { z } from "zod";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { TransferHandler } from "../../../app/command/transfer/handler.js";

const mainLogTag = "TransferHTTP";

const RequestSchema = z.object({
  source_wallet_id: z.string().min(1),
  target_wallet_id: z.string().min(1),
  amount_cents: z.number().int().positive(),
  reference: z.string().optional(),
});

export function transferHandler(handler: TransferHandler, logger: Logger) {
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

    try {
      const result = await handler.handle(ctx, {
        sourceWalletId: parsed.data.source_wallet_id,
        targetWalletId: parsed.data.target_wallet_id,
        amountCents: BigInt(parsed.data.amount_cents),
        reference: parsed.data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
      });

      return c.json(
        {
          source_transaction_id: result.sourceTransactionId,
          target_transaction_id: result.targetTransactionId,
        },
        201,
      );
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
