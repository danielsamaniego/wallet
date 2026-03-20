import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetWalletHandler } from "../../../application/query/getWallet/handler.js";
import { ParamSchema } from "./schemas.js";

export function getWalletRoute(handler: GetWalletHandler) {
  return handlerFactory.createHandlers(
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
