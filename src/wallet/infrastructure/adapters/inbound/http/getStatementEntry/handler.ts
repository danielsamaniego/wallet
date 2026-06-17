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
import { GetStatementEntryQuery } from "../../../../../application/query/getStatementEntry/query.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function getStatementEntryRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Get a wallet statement entry by movement id",
      description:
        "Returns a single statement entry (the wallet's side of a movement) with running balance and correlation metadata.",
      responses: {
        200: {
          description: "The statement entry",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        404: {
          description: "Movement not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { walletId, movementId } = c.req.valid("param");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await queryBus.dispatch(
        ctx,
        new GetStatementEntryQuery(walletId, movementId, ctx.platformId),
      );

      return c.json(result, 200);
    },
  );
}
