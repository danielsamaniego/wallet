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
import { GetWalletMovementBreakdownQuery } from "../../../../../application/query/getWalletMovementBreakdown/query.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getWalletMovementBreakdownRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Wallet movement breakdown",
      description:
        "Aggregated credit/debit/net sums and count of the wallet's movements over a time range, grouped by type, time bucket (day/week/month), or a metadata key.",
      responses: {
        200: {
          description: "Movement breakdown buckets",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Invalid range or parameters",
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
      const {
        from,
        to,
        group_by,
        direction,
        metadata_key,
        metadata_filter_key,
        metadata_filter_value,
      } = c.req.valid("query");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetWalletMovementBreakdownQuery(
          walletId,
          ctx.platformId,
          from,
          to,
          group_by,
          direction,
          metadata_key,
          metadata_filter_key,
          metadata_filter_value,
        ),
      );

      return c.json(result, 200);
    },
  );
}
