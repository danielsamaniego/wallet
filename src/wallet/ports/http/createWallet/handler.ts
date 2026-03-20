import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CreateWalletHandler } from "../../../application/command/createWallet/handler.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function createWalletRoute(handler: CreateWalletHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Create a new wallet",
      responses: {
        201: { description: "Wallet created", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
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
