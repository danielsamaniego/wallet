import { serve } from "@hono/node-server";
import type { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { setupHoldRoutes } from "./api/holds/setup.js";
import { requestResponseLog } from "./api/middleware/requestResponseLog.js";
import { trackingCanonical } from "./api/middleware/trackingCanonical.js";
import { setupTransferRoutes } from "./api/transfers/setup.js";
import { setupWalletRoutes } from "./api/wallets/setup.js";
import { loadConfig } from "./config.js";
import { startCleanupIdempotencyJob } from "./jobs/cleanupIdempotencyRecords.js";
import { startExpireHoldsJob } from "./jobs/expireHolds.js";
import type { HonoVariables } from "./shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "./shared/adapters/kernel/hono.context.js";
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

  // Global error handler — catches unhandled exceptions and returns
  // a generic 500 response without leaking internal details.
  app.onError((err, c) => {
    const ctx = buildAppContext(c);
    deps.logger.error(ctx, "Unhandled exception", { error: err.message });
    return c.json({ error: "INTERNAL_ERROR", message: "an unexpected error occurred" }, 500);
  });

  // Global middleware chain (order matters: tracking → logging → handler)
  app.use("*", cors());
  app.use("*", trackingCanonical(deps.idGen, deps.logger));
  app.use("*", requestResponseLog(deps.logger));

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Route groups
  setupWalletRoutes(app, deps);
  setupTransferRoutes(app, deps);
  setupHoldRoutes(app, deps);

  // Background cron jobs
  startExpireHoldsJob(deps.prisma, deps.logger, deps.idGen);
  startCleanupIdempotencyJob(deps.prisma, deps.logger, deps.idGen);

  serve({ fetch: app.fetch, port: config.httpPort }, (info) => {
    console.log(`Wallet service running on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
