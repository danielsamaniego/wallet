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
import { GetPlatformMovementBreakdownQuery } from "../../../../../application/query/getPlatformMovementBreakdown/query.js";
import { QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getPlatformMovementBreakdownRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Analytics"],
      summary: "Platform movement breakdown",
      description:
        "Aggregated credit/debit/net sums and count of the authenticated platform's movements (all wallets) over a time range, grouped by type, time bucket (day/week/month), owner, or a metadata key. Optionally narrowed to a single owner.",
      responses: {
        200: {
          description: "Movement breakdown buckets",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Invalid range or parameters",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("query", QueryParamsSchema, validationHook),
    async (c) => {
      const {
        from,
        to,
        group_by,
        direction,
        metadata_key,
        owner_id,
        metadata_filter_key,
        metadata_filter_value,
      } = c.req.valid("query");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetPlatformMovementBreakdownQuery(
          ctx.platformId,
          from,
          to,
          group_by,
          direction,
          metadata_key,
          owner_id,
          metadata_filter_key,
          metadata_filter_value,
        ),
      );

      return c.json(result, 200);
    },
  );
}
