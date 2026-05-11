import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { CleanupIdempotencyCommand } from "./common/idempotency/application/command/cleanupIdempotency/command.js";
import { platformRoutes } from "./platform/infrastructure/adapters/inbound/http/platforms.routes.js";
import { isConnectionError } from "./utils/infrastructure/connection.retry.extension.js";
import type { HonoVariables } from "./utils/infrastructure/hono.context.js";
import { buildAppContext } from "./utils/infrastructure/hono.context.js";
import { errorResponse, httpStatus } from "./utils/infrastructure/hono.error.js";
import { requestResponseLog } from "./utils/infrastructure/middleware/requestResponseLog.js";
import { trackingCanonical } from "./utils/infrastructure/middleware/trackingCanonical.js";
import { AppError } from "./utils/kernel/appError.js";
import { createAppContext } from "./utils/kernel/context.js";
import { ExpireHoldsCommand } from "./wallet/application/command/expireHolds/command.js";
import { currencyRoutes } from "./wallet/infrastructure/adapters/inbound/http/currencies.routes.js";
import { holdRoutes } from "./wallet/infrastructure/adapters/inbound/http/holds.routes.js";
import { movementRoutes } from "./wallet/infrastructure/adapters/inbound/http/movements.routes.js";
import { transferRoutes } from "./wallet/infrastructure/adapters/inbound/http/transfers.routes.js";
import { walletRoutes } from "./wallet/infrastructure/adapters/inbound/http/wallets.routes.js";
import type { Dependencies } from "./wiring.js";

/**
 * Extracts `name`, `code` (Prisma error codes like P2024 land here) and a
 * truncated `stack` from any Error-like value for structured logging.
 * Returns an empty object for non-Error inputs so the caller can spread
 * unconditionally.
 */
function errorDetails(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return {};
  const code = (err as { code?: unknown }).code;
  return {
    name: err.name,
    ...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
    ...(err.stack ? { stack: err.stack.split("\n").slice(0, 5).join("\n") } : {}),
  };
}

/**
 * Creates the Hono app with all middleware, routes, and error handling.
 * Pure HTTP app — no server, no scheduled jobs, no startup verification.
 * Used by both the local dev server (src/index.ts) and the Vercel handler (api/index.ts).
 */
export function createApp(deps: Dependencies) {
  const app = new Hono<{ Variables: HonoVariables }>();

  // Global error handler — maps AppError to HTTP status, catches unhandled exceptions.
  //
  // Three branches:
  //  1. AppError: maps Kind → status with httpStatus().
  //  2. Transient infra error that escaped the retry layer
  //     (EMAXCONN, ECONNRESET, P2024 pool timeout, P6000 Accelerate engine
  //     error, …): SERVICE_UNAVAILABLE 503 + Retry-After. The standard
  //     "this is transient, retry" signal — clients that follow HTTP
  //     conventions auto-retry 503; clients that follow integration-guide.md
  //     retry the same way they would for 500. Either client wins.
  //  3. Anything else: INTERNAL_ERROR 500. Treated as a server bug.
  //
  // Logs include `code`, `name`, and a truncated `stack` so operators can
  // bucket errors by Prisma code (P2024, P5009, etc.) and pinpoint the
  // origin without needing the full transcript.
  app.onError((err, c) => {
    const ctx = buildAppContext(c);

    if (AppError.is(err)) {
      const status = httpStatus(err.kind);
      if (status >= 500) {
        deps.logger.error(ctx, err.code, {
          error: err.message,
          kind: err.kind,
          ...errorDetails(err.cause),
        });
      } else {
        deps.logger.warn(ctx, err.code);
      }
      return errorResponse(c, err.code, err.msg, status);
    }

    if (isConnectionError(err)) {
      deps.logger.error(ctx, "Service unavailable — transient infra error", {
        error: err.message,
        ...errorDetails(err),
      });
      // Retry-After is in seconds; 1s is conservative — the client backs off
      // exponentially from there if subsequent attempts also return 503.
      c.header("Retry-After", "1");
      return errorResponse(
        c,
        "SERVICE_UNAVAILABLE",
        "service temporarily unavailable; retry with the same Idempotency-Key",
        503,
      );
    }

    deps.logger.error(ctx, "Unhandled exception", {
      error: err.message,
      ...errorDetails(err),
    });
    return errorResponse(c, "INTERNAL_ERROR", "an unexpected error occurred", 500);
  });

  // Structured 404 for undefined routes
  app.notFound((c) => {
    return errorResponse(c, "NOT_FOUND", `${c.req.method} ${c.req.path} not found`, 404);
  });

  // Global middleware chain (order matters: tracking → security → body limit → logging → handler)
  app.use("*", trackingCanonical(deps.idGen, deps.logger));
  app.use("*", cors());
  app.use("*", secureHeaders());
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => errorResponse(c, "PAYLOAD_TOO_LARGE", "request body exceeds 64KB limit", 413),
    }),
  );
  app.use("*", requestResponseLog(deps.logger));

  // Root redirects to the interactive API docs.
  app.get("/", (c) => c.redirect("/docs"));

  // Health check — verifies DB connectivity before reporting healthy.
  app.get("/health", async (c) => {
    let db: "connected" | "disconnected" = "disconnected";
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      db = "connected";
    } catch {
      /* DB unreachable */
    }

    const status = db === "connected" ? "ok" : "degraded";
    const httpCode = db === "connected" ? 200 : 503;
    return c.json({ status, version: "1.0.1", db }, httpCode);
  });

  // Route groups
  const v1 = app.basePath("/v1");

  // Serverless-only: close Prisma connections at the end of every wallet
  // request. Long-lived servers benefit from a warm connection pool, but
  // Vercel Lambdas stay "warm" for minutes after a request — and each warm
  // Lambda's idle Prisma connections still occupy slots in the pgBouncer
  // client cap (max_client_conn=200 on Supabase Micro). Under bursts that
  // create dozens of Lambdas, idle warm Lambdas saturate the pool for
  // minutes after the burst is over, breaking unrelated requests like
  // /health.
  //
  // Disconnecting per request adds ~10-30ms latency at the pgBouncer
  // handshake, but pgBouncer keeps its server-side pool to Postgres
  // persistent — so the real DB connection is hot, only the client→pgBouncer
  // hop is paid each time. Net effect: predictable behaviour under bursts
  // at a small steady-state latency cost.
  //
  // Detected via `process.env.VERCEL` (set to "1" by Vercel runtime). Local
  // dev and tests run as long-lived Node processes and skip this.
  if (process.env.VERCEL) {
    v1.use("*", async (_c, next) => {
      try {
        await next();
      } finally {
        await deps.prisma.$disconnect().catch(() => {});
      }
    });
  }

  v1.route("/wallets", walletRoutes(deps));
  v1.route("/transfers", transferRoutes(deps));
  v1.route("/holds", holdRoutes(deps));
  v1.route("/movements", movementRoutes(deps));
  v1.route("/platforms", platformRoutes(deps));
  v1.route("/currencies", currencyRoutes());

  // OpenAPI spec + interactive docs
  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Wallet API",
          version: "1.0.0",
          description:
            "Digital wallet microservice — deposits, withdrawals, transfers, holds, and ledger.",
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
