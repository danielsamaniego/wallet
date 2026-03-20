import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetTransactionsHandler } from "../../../application/query/getTransactions/handler.js";
import { ParamSchema, QueryParamsSchema } from "./schemas.js";

export function getTransactionsRoute(handler: GetTransactionsHandler) {
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
