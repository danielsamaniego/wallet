import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { GetTransactionsHandler } from "../../../application/query/getTransactions/handler.js";
import { parsePathId } from "../../../../api/validation.js";

const mainLogTag = "GetTransactionsHTTP";

export function getTransactionsHandler(handler: GetTransactionsHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const walletId = parsePathId(c.req.param("walletId"));
    if (!walletId) return c.json({ error: "INVALID_REQUEST", message: "invalid walletId" }, 400);
    const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);
    const cursor = c.req.query("cursor");

    try {
      const result = await handler.handle(ctx, {
        walletId,
        platformId: ctx.platformId!,
        limit,
        cursor,
      });

      return c.json(result, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
