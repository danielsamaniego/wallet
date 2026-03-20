import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { FreezeWalletHandler } from "../../../application/command/freezeWallet/handler.js";
import { ParamSchema } from "./schemas.js";

export function freezeWalletRoute(handler: FreezeWalletHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "frozen" }, 200);
    },
  );
}
