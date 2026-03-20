import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetWalletHandler } from "../../../application/query/getWallet/handler.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function getWalletRoute(handler: GetWalletHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Get wallet details",
      responses: {
        200: { description: "Wallet details", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      const dto = await handler.handle(ctx, {
        walletId,
        platformId: ctx.platformId!,
      });

      return c.json(dto, 200);
    },
  );
}
