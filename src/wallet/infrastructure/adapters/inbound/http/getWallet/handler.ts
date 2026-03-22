import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { IGetWalletUseCase } from "../../../../../application/ports/inbound/get-wallet.usecase.js";
import { GetWalletQuery } from "../../../../../application/query/getWallet/query.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function getWalletRoute(handler: IGetWalletUseCase) {
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

      const dto = await handler.handle(ctx, new GetWalletQuery(
        walletId,
        ctx.platformId!,
      ));

      return c.json(dto, 200);
    },
  );
}
