import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, factory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { VoidHoldHandler } from "../../../application/command/voidHold/handler.js";

const ParamSchema = z.object({ holdId: z.string().min(1).max(255) });

export function voidHoldRoute(handler: VoidHoldHandler) {
  return factory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { holdId, platformId: ctx.platformId! });
      return c.json({ status: "voided" }, 200);
    },
  );
}
