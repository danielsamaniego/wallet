import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { PlaceHoldHandler } from "../../../application/command/placeHold/handler.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function placeHoldRoute(handler: PlaceHoldHandler) {
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

      const result = await handler.handle(ctx, {
        walletId: data.wallet_id,
        amountCents: BigInt(data.amount_cents),
        reference: data.reference,
        expiresAt: data.expires_at,
        platformId: ctx.platformId!,
      });

      return c.json({ hold_id: result.holdId }, 201);
    },
  );
}
