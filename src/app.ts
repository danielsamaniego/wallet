import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { CleanupIdempotencyCommand } from "./common/idempotency/application/command/cleanupIdempotency/command.js";
import { platformRoutes } from "./platform/infrastructure/adapters/inbound/http/platforms.routes.js";
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
  // Logs include `code`, `name`, and a truncated `stack` so operators can
  // bucket errors by Prisma code (P2024, P5009, etc.) and pinpoint the
  // origin without needing the full transcript. The previous shape only
  // emitted `error: <message>` and made it impossible to group errors
  // mechanically — see the load-test post-mortem where `error.code` and
  // `error.name` aggregations came back empty.
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

  // ─── TEMPORARY DEBUG ENDPOINT — DELETE AFTER VERIFYING DEPLOY ───
  // Surfaces non-sensitive runtime config so we can confirm env vars
  // (lock timings, region, transport, etc.) are loaded with the
  // expected values after a deploy. Strips secrets — only prefixes
  // and lengths are exposed for URLs that contain credentials.
  // TODO: remove once the timeout-coordination rollout is verified.
  app.get("/internal/debug/config", (c) => {
    const dbUrl = deps.config.databaseUrl;
    const directUrl = deps.config.directUrl;
    const redisUrl = deps.config.walletLock?.redisUrl ?? "";
    const safePrefix = (s: string) => (s ? `${s.slice(0, 12)}…(${s.length} chars)` : "(unset)");

    return c.json({
      runtime: {
        vercel_region: process.env.VERCEL_REGION ?? "(local)",
        vercel_env: process.env.VERCEL_ENV ?? "(local)",
        node_version: process.version,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "(unset)",
      },
      lock: {
        enabled: deps.config.walletLock !== undefined,
        transport: deps.config.walletLock?.transport ?? "(disabled)",
        ttl_ms: deps.config.walletLock?.ttlMs ?? null,
        wait_ms: deps.config.walletLock?.waitMs ?? null,
        retry_ms: deps.config.walletLock?.retryMs ?? null,
      },
      db: {
        database_url_prefix: safePrefix(dbUrl),
        direct_url_prefix: safePrefix(directUrl),
        accelerate_active: dbUrl.startsWith("prisma://") || dbUrl.startsWith("prisma+postgres://"),
      },
      redis: {
        url_prefix: safePrefix(redisUrl),
      },
      log_level: process.env.LOG_LEVEL ?? "info",
    });
  });

  // Route groups
  const v1 = app.basePath("/v1");
  v1.route("/wallets", walletRoutes(deps));
  v1.route("/transfers", transferRoutes(deps));
  v1.route("/holds", holdRoutes(deps));
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
