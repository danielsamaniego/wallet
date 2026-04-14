import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { holdRoutes } from "./wallet/infrastructure/adapters/inbound/http/holds.routes.js";
import { transferRoutes } from "./wallet/infrastructure/adapters/inbound/http/transfers.routes.js";
import { walletRoutes } from "./wallet/infrastructure/adapters/inbound/http/wallets.routes.js";
import { platformRoutes } from "./platform/infrastructure/adapters/inbound/http/platforms.routes.js";
import { requestResponseLog } from "./utils/infrastructure/middleware/requestResponseLog.js";
import { trackingCanonical } from "./utils/infrastructure/middleware/trackingCanonical.js";
import { errorResponse, httpStatus } from "./utils/infrastructure/hono.error.js";
import type { HonoVariables } from "./utils/infrastructure/hono.context.js";
import { buildAppContext } from "./utils/infrastructure/hono.context.js";
import { AppError } from "./utils/kernel/appError.js";
import { createAppContext } from "./utils/kernel/context.js";
import { ExpireHoldsCommand } from "./wallet/application/command/expireHolds/command.js";
import { CleanupIdempotencyCommand } from "./common/idempotency/application/command/cleanupIdempotency/command.js";
import type { Dependencies } from "./wiring.js";

/**
 * Creates the Hono app with all middleware, routes, and error handling.
 * Pure HTTP app — no server, no scheduled jobs, no startup verification.
 * Used by both the local dev server (src/index.ts) and the Vercel handler (api/index.ts).
 */
export function createApp(deps: Dependencies) {
  const app = new Hono<{ Variables: HonoVariables }>();

  // Global error handler — maps AppError to HTTP status, catches unhandled exceptions.
  app.onError((err, c) => {
    const ctx = buildAppContext(c);

    if (AppError.is(err)) {
      const status = httpStatus(err.kind);
      if (status >= 500) {
        deps.logger.error(ctx, err.code, { error: err.message });
      } else {
        deps.logger.warn(ctx, err.code);
      }
      return errorResponse(c, err.code, err.msg, status);
    }

    /* v8 ignore next 3 */
    const message = err instanceof Error
      ? err.message
      : "unknown error";
    deps.logger.error(ctx, "Unhandled exception", { error: message });
    return errorResponse(c, "INTERNAL_ERROR", "an unexpected error occurred", 500);
  });

  // Structured 404 for undefined routes
  app.notFound((c) => {
    return errorResponse(c, "NOT_FOUND", `${c.req.method} ${c.req.path} not found`, 404);
  });

  // Global middleware chain (order matters: tracking → security → logging → handler)
  app.use("*", trackingCanonical(deps.idGen, deps.logger));
  app.use("*", cors());
  app.use("*", secureHeaders());
  app.use("*", requestResponseLog(deps.logger));

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", version: "1.0.1" }));

  // Route groups
  const v1 = app.basePath("/v1");
  v1.route("/wallets", walletRoutes(deps));
  v1.route("/transfers", transferRoutes(deps));
  v1.route("/holds", holdRoutes(deps));
  v1.route("/platforms", platformRoutes(deps));

  // OpenAPI spec + interactive docs
  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Wallet API",
          version: "1.0.0",
          description: "Digital wallet microservice — deposits, withdrawals, transfers, holds, and ledger.",
        },
        servers: [{ url: "/", description: "Current" }],
      },
    }),
  );
  app.get("/docs", Scalar({ url: "/openapi" }));

  // ── Internal cron routes (Vercel Cron Jobs) ──────────────────
  // Protected by CRON_SECRET — Vercel sends it as Authorization: Bearer <secret>.
  const internal = app.basePath("/internal");

  internal.get("/cron/expire-holds", async (c) => {
    const authHeader = c.req.header("authorization");
    if (deps.config.cronSecret && authHeader !== `Bearer ${deps.config.cronSecret}`) {
      return errorResponse(c, "UNAUTHORIZED", "invalid cron secret", 401);
    }
    const ctx = createAppContext(deps.idGen);
    await deps.commandBus.dispatch(ctx, new ExpireHoldsCommand());
    return c.json({ ok: true, job: "expire-holds" });
  });

  internal.get("/cron/cleanup-idempotency", async (c) => {
    const authHeader = c.req.header("authorization");
    if (deps.config.cronSecret && authHeader !== `Bearer ${deps.config.cronSecret}`) {
      return errorResponse(c, "UNAUTHORIZED", "invalid cron secret", 401);
    }
    const ctx = createAppContext(deps.idGen);
    await deps.commandBus.dispatch(ctx, new CleanupIdempotencyCommand());
    return c.json({ ok: true, job: "cleanup-idempotency" });
  });

  return app;
}
