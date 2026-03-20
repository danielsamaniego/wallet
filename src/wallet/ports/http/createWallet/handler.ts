import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CreateWalletHandler } from "../../../application/command/createWallet/handler.js";
import { BodySchema } from "./schemas.js";

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
