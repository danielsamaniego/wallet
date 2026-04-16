import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import { UpdatePlatformConfigCommand } from "../../../../../application/command/updatePlatformConfig/command.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function updatePlatformConfigRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Platforms"],
      summary: "Update platform configuration",
      description: "Update configuration flags for the authenticated platform.",
      responses: {
        200: {
          description: "Configuration updated",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        401: {
          description: "Authentication error",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        404: {
          description: "Platform not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await commandBus.dispatch(
        ctx,
        new UpdatePlatformConfigCommand(ctx.platformId, data.allow_negative_balance),
      );

      return c.json({ platform_id: result.platformId }, 200);
    },
  );
}
