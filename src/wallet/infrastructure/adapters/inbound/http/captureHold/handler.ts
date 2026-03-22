import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { ICaptureHoldUseCase } from "../../../../../application/ports/inbound/capture-hold.usecase.js";
import { CaptureHoldCommand } from "../../../../../application/command/captureHold/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function captureHoldRoute(handler: ICaptureHoldUseCase) {
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

      const result = await handler.handle(ctx, new CaptureHoldCommand(
        holdId,
        ctx.platformId!,
        c.req.header("idempotency-key")!,
      ));

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
