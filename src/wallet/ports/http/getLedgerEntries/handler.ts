import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetLedgerEntriesHandler } from "../../../application/query/getLedgerEntries/handler.js";
import { ParamSchema, QueryParamsSchema } from "./schemas.js";

export function getLedgerEntriesRoute(handler: GetLedgerEntriesHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    zValidator("query", QueryParamsSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const listing = c.req.valid("query");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        walletId,
        platformId: ctx.platformId!,
        listing,
      });

      return c.json(result, 200);
    },
  );
}
