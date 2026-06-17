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
import { GetWalletMovementsQuery } from "../../../../../application/query/getWalletMovements/query.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getWalletMovementsRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "List wallet movements (statement)",
      description:
        "Paginated statement of movements with running balance (balance_before/after), cursor-based.",
      responses: {
        200: {
          description: "Paginated wallet movements",
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
      const listing = c.req.valid("query");
      const q = c.req.query("q");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetWalletMovementsQuery(walletId, ctx.platformId, listing, q),
      );

      return c.json(result, 200);
    },
  );
}
