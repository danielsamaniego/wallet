import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { GetLedgerEntriesHandler } from "../../../app/query/getLedgerEntries/handler.js";

const mainLogTag = "GetLedgerEntriesHTTP";

export function getLedgerEntriesHandler(handler: GetLedgerEntriesHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const walletId = c.req.param("walletId")!;
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
