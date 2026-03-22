import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { IPlaceHoldUseCase } from "../../../../../application/ports/inbound/place-hold.usecase.js";
import { PlaceHoldCommand } from "../../../../../application/command/placeHold/command.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function placeHoldRoute(handler: IPlaceHoldUseCase) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Place an authorization hold",
      responses: {
        201: { description: "Hold placed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Insufficient available balance", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, new PlaceHoldCommand(
        data.wallet_id,
        ctx.platformId!,
        BigInt(data.amount_cents),
        data.reference,
        data.expires_at,
      ));

      return c.json({ hold_id: result.holdId }, 201);
    },
  );
}
