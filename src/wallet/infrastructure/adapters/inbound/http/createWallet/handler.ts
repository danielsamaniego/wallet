import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { ICommandBus } from "../../../../../../shared/application/cqrs.js";
import { CreateWalletCommand } from "../../../../../application/command/createWallet/command.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function createWalletRoute(commandBus: ICommandBus) {
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

      const result = await commandBus.dispatch(ctx, new CreateWalletCommand(
        data.owner_id,
        ctx.platformId!,
        data.currency_code,
      ));

      return c.json({ wallet_id: result.walletId }, 201);
    },
  );
}
