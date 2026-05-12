import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { ICommandBus } from "../../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../../utils/application/id.generator.js";
import { handlerFactory } from "../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  errorResponse,
} from "../../../../../utils/infrastructure/hono.error.js";
import { createAppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import { ProcessMovementCommand } from "../../../../application/worker/processMovement/command.js";

const mainLogTag = "ProcessMovementWorker";

const BodySchema = z.object({
  movement_id: z.string().min(1).max(255),
});

const ResponseSchema = z.object({
  ok: z.literal(true),
  movement_id: z.string(),
  outcome: z.enum(["posted", "failed", "noop"]),
  failed_reason: z.string().optional(),
});

/**
 * QStash worker endpoint. Once `qstashSignature` has verified the JWT
 * and placed the raw body on the Hono context, this handler:
 *
 *   1. Parses + validates `{ movement_id }` with Zod.
 *   2. Dispatches `ProcessMovementCommand` through the command bus. The
 *      `ProcessMovementUseCase` owns the full lifecycle: atomic claim
 *      (`pending → processing`), per-type hydration of the saved
 *      `queue_payload`, lock + tx envelope around the matching
 *      `<op>Service.execute`, terminal transition (`posted` or
 *      `failed`), and result publish to Redis pub/sub.
 *   3. Returns 200 with `{ outcome, failed_reason? }` regardless of
 *      whether the movement succeeded, failed, or was a noop — QStash
 *      only retries on non-2xx, and we never want to retry a terminal
 *      result. The bus only throws when no handler is registered
 *      (i.e. the result publisher is not wired): that surfaces as a
 *      500 via the global onError, and QStash will retry until the
 *      configuration is fixed or the message hits the DLQ.
 */
export function processMovementRoute(
  commandBus: ICommandBus,
  idGen: IIDGenerator,
  logger: ILogger,
) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Internal"],
      summary: "QStash worker — process a queued movement",
      description:
        "Internal endpoint invoked exclusively by QStash. Authenticated by the " +
        "Upstash-Signature JWT header (verified by the `qstashSignature` middleware). " +
        "Not part of the public API contract.",
      responses: {
        200: {
          description: "Delivery processed (posted, failed, or noop)",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Malformed body",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        401: {
          description: "Missing or invalid Upstash-Signature",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const ctx = createAppContext(idGen);
      const methodLogTag = `${mainLogTag} | handle`;

      const rawBody = c.get("rawBody");
      if (rawBody === undefined) {
        // Wiring bug: signature middleware always sets rawBody before
        // delegating. Surfacing as 500 makes the misconfiguration loud.
        logger.error(ctx, `${methodLogTag} rawBody missing — middleware not wired?`);
        return errorResponse(c, "INTERNAL_ERROR", "raw body not captured", 500);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        logger.warn(ctx, `${methodLogTag} invalid JSON body`);
        return errorResponse(c, "INVALID_BODY", "request body is not valid JSON", 400);
      }

      const result = BodySchema.safeParse(parsed);
      if (!result.success) {
        logger.warn(ctx, `${methodLogTag} body validation failed`, {
          issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return errorResponse(c, "INVALID_BODY", "request body did not match schema", 400);
      }

      const { movement_id } = result.data;
      logger.info(ctx, `${methodLogTag} dispatching`, { movement_id });

      const outcome = await commandBus.dispatch(ctx, new ProcessMovementCommand(movement_id));

      logger.info(ctx, `${methodLogTag} done`, {
        movement_id,
        outcome: outcome.outcome,
      });

      return c.json(
        {
          ok: true as const,
          movement_id,
          outcome: outcome.outcome,
          ...(outcome.failedReason !== undefined ? { failed_reason: outcome.failedReason } : {}),
        },
        200,
      );
    },
  );
}
