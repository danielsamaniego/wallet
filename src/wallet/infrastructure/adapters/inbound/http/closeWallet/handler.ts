import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../utils/infrastructure/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../utils/infrastructure/hono.context.js";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import { CloseWalletCommand } from "../../../../../application/command/closeWallet/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function closeWalletRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Close a wallet",
      responses: {
        200: { description: "Wallet closed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Wallet has non-zero balance or active holds", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await commandBus.dispatch(ctx, new CloseWalletCommand(walletId, ctx.platformId!));
      return c.json({ status: "closed" }, 200);
    },
  );
}
