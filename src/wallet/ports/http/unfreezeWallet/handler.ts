import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, factory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { UnfreezeWalletHandler } from "../../../application/command/unfreezeWallet/handler.js";

const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

export function unfreezeWalletRoute(handler: UnfreezeWalletHandler) {
  return factory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "active" }, 200);
    },
  );
}
