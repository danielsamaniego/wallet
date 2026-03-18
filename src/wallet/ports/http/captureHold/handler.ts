import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { CaptureHoldHandler } from "../../../application/command/captureHold/handler.js";

const mainLogTag = "CaptureHoldHTTP";

export function captureHoldHandler(handler: CaptureHoldHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const holdId = c.req.param("holdId")!;

    try {
      const result = await handler.handle(ctx, {
        holdId,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
