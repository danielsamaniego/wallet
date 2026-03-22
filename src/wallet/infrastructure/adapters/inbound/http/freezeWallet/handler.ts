import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { ICommandBus } from "../../../../../../shared/application/cqrs.js";
import { FreezeWalletCommand } from "../../../../../application/command/freezeWallet/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function freezeWalletRoute(commandBus: ICommandBus) {
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

      await commandBus.dispatch(ctx, new FreezeWalletCommand(walletId, ctx.platformId!));
      return c.json({ status: "frozen" }, 200);
    },
  );
}
