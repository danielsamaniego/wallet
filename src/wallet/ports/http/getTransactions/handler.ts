import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetTransactionsHandler } from "../../../application/query/getTransactions/handler.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getTransactionsRoute(handler: GetTransactionsHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "List wallet transactions",
      description: "Paginated list with Stripe-style filters and dynamic sorting.",
      responses: {
        200: { description: "Paginated transactions", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Invalid filter, sort, or cursor", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
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
