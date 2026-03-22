import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../shared/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../shared/infrastructure/kernel/hono.context.js";
import type { IDepositUseCase } from "../../../../../application/ports/inbound/deposit.usecase.js";
import { DepositCommand } from "../../../../../application/command/deposit/command.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function depositRoute(handler: IDepositUseCase) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Deposit funds into a wallet",
      responses: {
        201: { description: "Deposit completed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, new DepositCommand(
        walletId,
        ctx.platformId!,
        BigInt(data.amount_cents),
        c.req.header("idempotency-key")!,
        data.reference,
      ));

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
