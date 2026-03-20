import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { UnfreezeWalletHandler } from "../../../application/command/unfreezeWallet/handler.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function unfreezeWalletRoute(handler: UnfreezeWalletHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Unfreeze a wallet",
      responses: {
        200: { description: "Wallet unfrozen", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Wallet not frozen", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "active" }, 200);
    },
  );
}
