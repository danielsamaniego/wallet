import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { FreezeWalletHandler } from "../../../application/command/freezeWallet/handler.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function freezeWalletRoute(handler: FreezeWalletHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Freeze a wallet",
      responses: {
        200: { description: "Wallet frozen", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Wallet already frozen or closed", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "frozen" }, 200);
    },
  );
}
