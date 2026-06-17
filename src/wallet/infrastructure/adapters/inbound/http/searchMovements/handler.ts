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
import { SearchMovementsQuery } from "../../../../../application/query/searchMovements/query.js";
import { QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function searchMovementsRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Movements"],
      summary: "Search movements (platform-wide)",
      description:
        "Cross-wallet search scoped to the caller's platform. Free-text `q` matches reference/reason (case-insensitive substring); structured filters (type, status, created_at, metadata[key]) and cursor pagination via the listing params.",
      responses: {
        200: {
          description: "Matching movements",
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
      const q = c.req.query("q");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new SearchMovementsQuery(ctx.platformId, q, listing),
      );

      return c.json(result, 200);
    },
  );
}
