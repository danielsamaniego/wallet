import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { VoidHoldHandler } from "../../../application/command/voidHold/handler.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function voidHoldRoute(handler: VoidHoldHandler) {
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

      await handler.handle(ctx, { holdId, platformId: ctx.platformId! });
      return c.json({ status: "voided" }, 200);
    },
  );
}
