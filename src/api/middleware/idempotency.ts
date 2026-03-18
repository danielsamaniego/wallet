import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

export interface IdempotencyRecord {
  idempotencyKey: string;
  platformId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: number;
  expiresAt: number;
}

/**
 * IIdempotencyStore provides atomic operations for idempotency records.
 *
 * Implementations must guarantee:
 * - `acquire` is atomic: concurrent calls with the same key must result in
 *   exactly one returning `null` (winner) and others returning the existing record.
 *   Use INSERT ... ON CONFLICT or equivalent to prevent race conditions.
 * - `complete` updates the pending record with the actual response.
 */
export interface IIdempotencyStore {
  /**
   * Atomically attempt to acquire the idempotency key.
   * - Returns `null` if this caller won the race (key inserted as "pending").
   * - Returns the existing `IdempotencyRecord` if the key was already acquired
   *   (either pending or completed).
   */
  acquire(
    idempotencyKey: string,
    platformId: string,
    requestHash: string,
    createdAt: number,
    expiresAt: number,
  ): Promise<IdempotencyRecord | null>;

  /**
   * Update a pending record with the actual response after handler execution.
   */
  complete(
    idempotencyKey: string,
    platformId: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void>;

  /**
   * Delete a pending record so the idempotency key can be reused.
   * Called when the handler fails with a transient error (e.g. VERSION_CONFLICT, 5xx).
   */
  release(idempotencyKey: string, platformId: string): Promise<void>;
}

/**
 * Middleware that checks for Idempotency-Key header on mutating requests.
 * Uses an atomic acquire-then-complete pattern to prevent race conditions:
 *
 * 1. Acquire: atomically INSERT a "pending" record (INSERT ... ON CONFLICT).
 *    - If insert succeeds → this request is the winner; proceed to handler.
 *    - If insert fails (conflict) → another request owns this key; return stored response.
 * 2. Execute: run the downstream handler.
 * 3. Complete: update the pending record with the actual response.
 *
 * This guarantees that concurrent requests with the same idempotency key
 * result in exactly one handler execution. Equivalent to DB-level uniqueness
 * enforcement via the transactions.idempotency_key unique constraint.
 */
export function idempotency(
  store: IIdempotencyStore,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      await next();
      return;
    }

    const key = c.req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      return c.json(
        { error: "MISSING_IDEMPOTENCY_KEY", message: "Idempotency-Key header is required" },
        400,
      );
    }

    const platformId = c.get("platformId");
    if (!platformId) {
      return c.json(
        {
          error: "MISSING_PLATFORM_CONTEXT",
          message: "apiKeyAuth middleware must run before idempotency",
        },
        500,
      );
    }
    const now = Date.now();
    const expiresAt = now + 48 * 60 * 60 * 1000;

    // Hash request method + path + body for payload mismatch detection.
    // Including method:path ensures the same idempotency key used on a different
    // endpoint is rejected as a payload mismatch (per IETF draft recommendation).
    const rawBody = await c.req.text();
    const requestHash = createHash("sha256")
      .update(`${c.req.method}:${c.req.path}:${rawBody}`)
      .digest("hex");

    // Atomic acquire: INSERT pending record or return existing
    const existing = await store.acquire(key, platformId, requestHash, now, expiresAt);

    if (existing) {
      // Key already processed — return cached response
      if (existing.responseStatus === 0) {
        // Another request is still processing this key (pending)
        return c.json(
          {
            error: "IDEMPOTENCY_KEY_IN_PROGRESS",
            message: "this request is already being processed",
          },
          409,
        );
      }

      // Payload mismatch: same key, different body
      if (existing.requestHash !== requestHash) {
        return c.json(
          {
            error: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "idempotency key was already used with a different request body",
          },
          422,
        );
      }

      return c.json(
        existing.responseBody as object,
        existing.responseStatus as ContentfulStatusCode,
      );
    }

    // This request won the race — execute handler
    await next();

    const status = c.res.status;

    // Transient errors (5xx, 409 Conflict) must NOT be cached —
    // release the key so clients can retry with the same idempotency key.
    if (status >= 500 || status === 409) {
      store.release(key, platformId).catch(() => {});
      return;
    }

    // Deterministic responses (2xx, 4xx validation/domain) are safe to cache
    const responseBody = await c.res
      .clone()
      .json()
      .catch(() => null);

    store.complete(key, platformId, status, responseBody).catch(() => {
      // Non-critical: record stays pending; will be overwritten on next acquire after TTL
    });
  };
}
