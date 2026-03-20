import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { CaptureHoldHandler } from "../../../application/command/captureHold/handler.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function captureHoldRoute(handler: CaptureHoldHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Capture an authorization hold",
      responses: {
        201: { description: "Hold captured", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Hold not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Hold not active", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
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
