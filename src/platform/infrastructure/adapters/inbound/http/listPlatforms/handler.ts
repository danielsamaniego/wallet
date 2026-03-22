import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../utils/infrastructure/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../utils/infrastructure/hono.context.js";
import type { IQueryBus } from "../../../../../../utils/application/cqrs.js";
import { ListPlatformsQuery } from "../../../../../application/query/listPlatforms/query.js";
import { QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function listPlatformsRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Platforms"],
      summary: "List platforms",
      description: "Paginated list of platforms with Stripe-style filters and dynamic sorting.",
      responses: {
        200: { description: "Paginated platforms", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Invalid filter, sort, or cursor", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("query", QueryParamsSchema, validationHook),
    async (c) => {
      const listing = c.req.valid("query");
      const ctx = buildAppContext(c);

      const result = await queryBus.dispatch(ctx, new ListPlatformsQuery(listing));

      return c.json(result, 200);
    },
  );
}
