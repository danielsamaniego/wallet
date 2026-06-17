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
import { GetCashFlowQuery } from "../../../../../application/query/getCashFlow/query.js";
import { ParamSchema, QueryParamsSchema, ResponseSchema } from "./schemas.js";

export function getCashFlowRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Wallet cash-flow summary",
      description: "Total income (credits) vs expense (debits) and net over a time range.",
      responses: {
        200: {
          description: "Cash-flow summary",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Invalid range",
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
      const { from, to } = c.req.valid("query");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetCashFlowQuery(walletId, ctx.platformId, from, to),
      );

      return c.json(result, 200);
    },
  );
}
