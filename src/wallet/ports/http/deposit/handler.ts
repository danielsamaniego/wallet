import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { DepositHandler } from "../../../application/command/deposit/handler.js";

const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

const BodySchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
});

export function depositRoute(handler: DepositHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        walletId,
        amountCents: BigInt(data.amount_cents),
        reference: data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
