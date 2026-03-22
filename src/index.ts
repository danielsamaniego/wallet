import { serve } from "@hono/node-server";
import type { PrismaClient } from "@prisma/client";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { holdRoutes } from "./wallet/infrastructure/adapters/inbound/http/holds.routes.js";
import { requestResponseLog } from "./utils/middleware/requestResponseLog.js";
import { trackingCanonical } from "./utils/middleware/trackingCanonical.js";
import { errorResponse, httpStatus } from "./utils/infrastructure/hono.error.js";
import { transferRoutes } from "./wallet/infrastructure/adapters/inbound/http/transfers.routes.js";
import { walletRoutes } from "./wallet/infrastructure/adapters/inbound/http/wallets.routes.js";
import { platformRoutes } from "./platform/infrastructure/adapters/inbound/http/platforms.routes.js";
import { loadConfig } from "./config.js";
import { startScheduledJobs } from "./utils/infrastructure/scheduler.js";
import { idempotencyJobs } from "./common/idempotency/infrastructure/adapters/inbound/scheduler/jobs.js";
import { walletJobs } from "./wallet/infrastructure/adapters/inbound/scheduler/jobs.js";
import type { HonoVariables } from "./utils/infrastructure/hono.context.js";
import { buildAppContext } from "./utils/infrastructure/hono.context.js";
import { AppError } from "./utils/kernel/appError.js";
import { wire } from "./wiring.js";

/**
 * Verifies that critical DB safety nets (triggers, constraints) exist.
 * These are defined in prisma/immutable_ledger.sql and must be applied
 * after every schema reset. If missing, the app refuses to start.
 */
async function verifyDatabaseSafetyNets(prisma: PrismaClient): Promise<void> {
  const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'ledger_entries'::regclass
      AND tgname = 'ledger_entries_immutable'`;

  if (triggers.length === 0) {
    throw new Error(
      "FATAL: ledger_entries_immutable trigger is missing. " +
        "Run: cat prisma/immutable_ledger.sql | docker exec -i <container> psql -U wallet -d wallet",
    );
  }

  const constraints = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname IN ('wallets_positive_balance', 'holds_positive_amount', 'transactions_positive_amount')`;

  if (constraints.length < 3) {
    const found = constraints.map((c) => c.conname);
    const missing = [
      "wallets_positive_balance",
      "holds_positive_amount",
      "transactions_positive_amount",
    ].filter((name) => !found.includes(name));
    throw new Error(
      `FATAL: missing DB safety constraints: ${missing.join(", ")}. ` +
        "Run: cat prisma/immutable_ledger.sql | docker exec -i <container> psql -U wallet -d wallet",
    );
  }
}

async function main() {
  const config = loadConfig();
  const deps = wire(config);

  // Preflight: verify DB safety nets before accepting traffic
  await verifyDatabaseSafetyNets(deps.prisma);

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

    const message = err instanceof Error ? err.message : "unknown error";
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
  app.get("/health", (c) => c.json({ status: "ok" }));

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
        servers: [{ url: `http://localhost:${config.httpPort}`, description: "Local" }],
      },
    }),
  );
  app.get("/docs", Scalar({ url: "/openapi" }));

  // Background scheduled jobs
  startScheduledJobs([...idempotencyJobs, ...walletJobs], deps.commandBus, deps.idGen, deps.logger);

  serve({ fetch: app.fetch, port: config.httpPort }, (info) => {
    console.log(`Wallet service running on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
