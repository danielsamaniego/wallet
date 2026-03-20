import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CaptureHoldHandler } from "../../../application/command/captureHold/handler.js";
import { ParamSchema } from "./schemas.js";

export function captureHoldRoute(handler: CaptureHoldHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        holdId,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
