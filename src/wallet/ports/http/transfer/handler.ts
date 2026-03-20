import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../shared/adapters/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { TransferHandler } from "../../../application/command/transfer/handler.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function transferRoute(handler: TransferHandler) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Transfers"],
      summary: "Transfer funds between wallets",
      responses: {
        201: { description: "Transfer completed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Insufficient funds or currency mismatch", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        sourceWalletId: data.source_wallet_id,
        targetWalletId: data.target_wallet_id,
        amountCents: BigInt(data.amount_cents),
        reference: data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json(
        {
          source_transaction_id: result.sourceTransactionId,
          target_transaction_id: result.targetTransactionId,
          movement_id: result.movementId,
        },
        201,
      );
    },
  );
}
