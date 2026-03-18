import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { VoidHoldHandler } from "../../../app/command/voidHold/handler.js";

const mainLogTag = "VoidHoldHTTP";

export function voidHoldHandler(handler: VoidHoldHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const holdId = c.req.param("holdId")!;

    try {
      await handler.handle(ctx, { holdId });
      return c.json({ status: "voided" }, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
