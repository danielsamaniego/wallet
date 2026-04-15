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
import { ListWalletsQuery } from "../../../../../application/query/listWallets/query.js";
import { QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function listWalletsRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "List wallets",
      description:
        "List platform wallets with Stripe-style filters (owner_id, currency_code, status), dynamic sorting, and keyset cursor pagination.",
      responses: {
        200: {
          description: "Paginated wallets",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Invalid filter, sort, or cursor",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("query", QueryParamsSchema, validationHook),
    async (c) => {
      const listing = c.req.valid("query");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(ctx, new ListWalletsQuery(ctx.platformId, listing));

      return c.json(result, 200);
    },
  );
}
