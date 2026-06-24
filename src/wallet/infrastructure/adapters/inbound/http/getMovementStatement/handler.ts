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
import { GetMovementStatementQuery } from "../../../../../application/query/getMovementStatement/query.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function getMovementStatementRoute(queryBus: IQueryBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Statement"],
      summary: "Get a movement's statement entries (platform-wide)",
      description:
        "Returns the platform's user-facing statement entries for a movement, without needing the wallet id. By double-entry a movement has two ledger entries; the system/omnibus counterpart is excluded, so a normal movement returns one entry and a transfer returns two (sender debit + receiver credit), each annotated with wallet_id + owner_id.",
      responses: {
        200: {
          description: "The movement's user-facing statement entries",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        404: {
          description: "Movement not found for the platform",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { movementId } = c.req.valid("param");
      const ctx = buildAuthenticatedAppContext(c);

      const entries = await queryBus.dispatch(
        ctx,
        new GetMovementStatementQuery(movementId, ctx.platformId),
      );

      return c.json({ entries }, 200);
    },
  );
}
