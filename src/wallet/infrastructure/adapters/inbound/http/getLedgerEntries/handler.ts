import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { IGetLedgerEntriesUseCase } from "../../../../../application/ports/inbound/get-ledger-entries.usecase.js";
import { GetLedgerEntriesQuery } from "../../../../../application/query/getLedgerEntries/query.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getLedgerEntriesRoute(handler: IGetLedgerEntriesUseCase) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "List wallet ledger entries",
      description: "Paginated double-entry ledger with Stripe-style filters and dynamic sorting.",
      responses: {
        200: { description: "Paginated ledger entries", content: { "application/json": { schema: resolver(ResponseSchema) } } },
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

      const result = await handler.handle(ctx, new GetLedgerEntriesQuery(
        walletId,
        ctx.platformId!,
        listing,
      ));

      return c.json(result, 200);
    },
  );
}
