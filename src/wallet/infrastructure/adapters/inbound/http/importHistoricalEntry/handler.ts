// TODO(historical-import-temp): Remove this handler together with the route
// registration, schemas, use case, command, and all tests once all legacy
// consumers have finished their backfill. Grep for `historical-import-temp`.
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
import { ImportHistoricalEntryCommand } from "../../../../../application/command/importHistoricalEntry/command.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function importHistoricalEntryRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary:
        "(TEMPORARY — migration only) Import a historical journal entry preserving the original timestamp",
      description:
        "Creates a Transaction + LedgerEntries + Movement with an externally supplied " +
        "created_at in the past, so legacy history can be backfilled with original times " +
        "and user-facing references. Gated by the HISTORICAL_IMPORT_ENABLED env var; " +
        "returns 404 if the flag is not set to 'true'. Will be removed after migration.",
      responses: {
        201: {
          description: "Historical entry imported",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        404: {
          description: "Wallet not found (or endpoint disabled)",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await commandBus.dispatch(
        ctx,
        new ImportHistoricalEntryCommand(
          walletId,
          ctx.platformId,
          BigInt(data.amount_minor),
          data.reason,
          data.reference,
          c.req.header("idempotency-key") ?? "",
          data.historical_created_at,
          data.metadata,
        ),
      );

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
