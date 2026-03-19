import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, factory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CaptureHoldHandler } from "../../../application/command/captureHold/handler.js";

const ParamSchema = z.object({ holdId: z.string().min(1).max(255) });

export function captureHoldRoute(handler: CaptureHoldHandler) {
  return factory.createHandlers(
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
