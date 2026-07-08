import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import type { IQueryBus } from "../../../../../../utils/application/cqrs.js";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import { GetStatementQuery } from "../../../../../application/query/getStatement/query.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getStatementRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "List wallet statement entries",
      description:
        "Paginated statement: one entry per movement with running balance (balance_before/after), cursor-based. Optional free-text `q` matches reference/reason, metadata.statementSearchText, and metadata.statementSearchTextByWallet[walletId]; `direction` (credit/debit) keeps only that side; `include_total=true` adds the full match count across pages.",
      responses: {
        200: {
          description: "Paginated wallet statement",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Invalid filter, sort, or cursor",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        404: {
          description: "Wallet not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("query", QueryParamsSchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      // The validated query carries the ListingQuery fields plus the optional
      // endpoint-specific extras (free-text `q`, `direction`, `include_total`).
      const { q, direction, include_total, ...listing } = c.req.valid("query");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetStatementQuery(
          walletId,
          ctx.platformId,
          listing,
          q,
          direction,
          include_total === "true",
        ),
      );

      return c.json(result, 200);
    },
  );
}
