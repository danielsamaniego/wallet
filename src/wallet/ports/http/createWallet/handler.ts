import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CreateWalletHandler } from "../../../application/command/createWallet/handler.js";

const BodySchema = z.object({
  owner_id: z.string().min(1).max(255),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "currency_code must be 3 uppercase letters"),
});

export function createWalletRoute(handler: CreateWalletHandler) {
  return handlerFactory.createHandlers(
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        ownerId: data.owner_id,
        platformId: ctx.platformId!,
        currencyCode: data.currency_code,
      });

      return c.json({ wallet_id: result.walletId }, 201);
    },
  );
}
