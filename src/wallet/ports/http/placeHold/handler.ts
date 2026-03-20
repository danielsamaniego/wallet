import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { PlaceHoldHandler } from "../../../application/command/placeHold/handler.js";

const BodySchema = z.object({
  wallet_id: z.string().min(1).max(255),
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
  expires_at: z.number().int().positive().optional(),
});

export function placeHoldRoute(handler: PlaceHoldHandler) {
  return handlerFactory.createHandlers(
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        walletId: data.wallet_id,
        amountCents: BigInt(data.amount_cents),
        reference: data.reference,
        expiresAt: data.expires_at,
        platformId: ctx.platformId!,
      });

      return c.json({ hold_id: result.holdId }, 201);
    },
  );
}
