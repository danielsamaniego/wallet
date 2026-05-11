import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { IIDGenerator } from "../../../../../utils/application/id.generator.js";
import { handlerFactory } from "../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  errorResponse,
} from "../../../../../utils/infrastructure/hono.error.js";
import { createAppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";

const mainLogTag = "ProcessMovementWorker";

const BodySchema = z.object({
  movement_id: z.string().min(1).max(255),
});

const ResponseSchema = z.object({
  ok: z.literal(true),
  movement_id: z.string(),
});

/**
 * QStash worker endpoint scaffolding for the async movement-processing
 * pipeline (Phase 1C — no business logic yet).
 *
 * The QStash signature middleware has already verified the JWT and
 * stored the raw body on the Hono context. This handler:
 *
 *   1. Parses + validates the body with Zod.
 *   2. Logs receipt with a tracking id.
 *   3. Returns 200 so QStash acknowledges the delivery.
 *
 * Phase 2 replaces step 2 with the actual `ProcessMovementUseCase`
 * dispatch (claim pending → run the existing deposit/withdraw/etc.
 * use case → publish result to Redis pub/sub).
 */
export function processMovementRoute(idGen: IIDGenerator, logger: ILogger) {
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
          description: "Delivery accepted",
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
        // Shouldn't happen in production — the middleware always sets rawBody
        // before delegating. Treated as a 500 because it indicates a wiring
        // bug, not a client mistake.
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
      logger.info(ctx, `${methodLogTag} received`, { movement_id });

      // Phase 1C scaffolding: ack and return. Real processing lands in Phase 2.
      return c.json({ ok: true, movement_id } as const, 200);
    },
  );
}
