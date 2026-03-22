import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { ICommandBus } from "../../../../../../shared/application/cqrs.js";
import { VoidHoldCommand } from "../../../../../application/command/voidHold/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function voidHoldRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Void an authorization hold",
      responses: {
        200: { description: "Hold voided", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        404: { description: "Hold not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Hold not active", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAppContext(c);

      await commandBus.dispatch(ctx, new VoidHoldCommand(holdId, ctx.platformId!));
      return c.json({ status: "voided" }, 200);
    },
  );
}
