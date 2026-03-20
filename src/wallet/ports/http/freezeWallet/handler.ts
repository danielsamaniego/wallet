import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { FreezeWalletHandler } from "../../../application/command/freezeWallet/handler.js";

const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

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
