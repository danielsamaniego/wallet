import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { CaptureHoldHandler } from "../../../app/command/captureHold/handler.js";

const mainLogTag = "CaptureHoldHTTP";

export function captureHoldHandler(handler: CaptureHoldHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const holdId = c.req.param("holdId")!;

    try {
      const result = await handler.handle(ctx, {
        holdId,
        idempotencyKey: c.req.header("idempotency-key")!,
      });

      return c.json({ transaction_id: result.transactionId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
