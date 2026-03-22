import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { ICloseWalletUseCase } from "../../../../../application/ports/inbound/close-wallet.usecase.js";
import { CloseWalletCommand } from "../../../../../application/command/closeWallet/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function closeWalletRoute(handler: ICloseWalletUseCase) {
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

      await handler.handle(ctx, new CloseWalletCommand(walletId, ctx.platformId!));
      return c.json({ status: "closed" }, 200);
    },
  );
}
