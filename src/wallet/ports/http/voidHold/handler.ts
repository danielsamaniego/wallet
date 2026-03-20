import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { VoidHoldHandler } from "../../../application/command/voidHold/handler.js";
import { ParamSchema } from "./schemas.js";

export function voidHoldRoute(handler: VoidHoldHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await handler.handle(ctx, { holdId, platformId: ctx.platformId! });
      return c.json({ status: "voided" }, 200);
    },
  );
}
