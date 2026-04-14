import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import {
  buildAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import type { IQueryBus } from "../../../../../../utils/application/cqrs.js";
import { GetHoldQuery } from "../../../../../application/query/getHold/query.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function getHoldRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Get hold details",
      responses: {
        200: {
          description: "Hold details",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        404: {
          description: "Hold not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      const dto = await queryBus.dispatch(ctx, new GetHoldQuery(holdId, ctx.platformId!));

      return c.json(dto, 200);
    },
  );
}
