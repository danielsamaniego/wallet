import type { MiddlewareHandler } from "hono";

import type { HonoVariables } from "../../shared/infrastructure/kernel/hono.context.js";
import { buildAppContext } from "../../shared/infrastructure/kernel/hono.context.js";
import type { ILogger } from "../../shared/kernel/observability/logger.port.js";

const mainLogTag = "RequestResponseLog";

/**
 * Hono middleware that logs every request (method, path, body) at entry
 * and every response (status, duration_ms) at exit.
 * Must run after trackingCanonical so context has tracking_id and start_ts.
 * Note: Request body is read from a cloned request to avoid consuming the
 * original stream. In Hono, c.req.text() consumes the ReadableStream and
 * downstream handlers (c.req.json(), etc.) would receive an empty body.
 */
export function requestResponseLog(
  logger: ILogger,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  const methodLogTag = `${mainLogTag} | Middleware`;

  return async (c, next) => {
    const ctx = buildAppContext(c);

    const path = c.req.path;
    const method = c.req.method;

    let requestBody: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      try {
        // Clone the request before reading to preserve the body for downstream handlers.
        // Hono's c.req.text() consumes the ReadableStream; without clone, handlers
        // calling c.req.json() would fail with an empty body.
        requestBody = await c.req.raw.clone().text();
      } catch {
        requestBody = "(read error)";
      }
    }

    logger.info(ctx, `${methodLogTag} request started`, {
      method,
      path,
      query: c.req.query(),
      body: requestBody,
    });

    logger.addCanonicalMeta(ctx, { http_method: method, http_path: path });

    await next();

    const durationMs = Date.now() - ctx.startTs;
    const status = c.res.status;

    logger.addCanonicalMeta(ctx, { http_status: status });

    logger.info(ctx, `${methodLogTag} response completed`, {
      status,
      duration_ms: durationMs,
    });
  };
}
