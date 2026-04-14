import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import { UnfreezeWalletCommand } from "../../../../../application/command/unfreezeWallet/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function unfreezeWalletRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Unfreeze a wallet",
      responses: {
        200: {
          description: "Wallet unfrozen",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        404: {
          description: "Wallet not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        422: {
          description: "Wallet not frozen",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAuthenticatedAppContext(c);

      await commandBus.dispatch(ctx, new UnfreezeWalletCommand(walletId, ctx.platformId));
      return c.json({ status: "active" }, 200);
    },
  );
}
