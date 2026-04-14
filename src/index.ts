import { serve } from "@hono/node-server";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { wire } from "./wiring.js";
import { createApp } from "./app.js";
import { startScheduledJobs } from "./utils/infrastructure/scheduler.js";
import { idempotencyJobs } from "./common/idempotency/infrastructure/adapters/inbound/scheduler/jobs.js";
import { walletJobs } from "./wallet/infrastructure/adapters/inbound/scheduler/jobs.js";

/**
 * Verifies that critical DB safety nets (triggers, constraints) exist.
 * These are defined in prisma/immutable_ledger.sql and must be applied
 * after every schema reset. If missing, the app refuses to start.
 */
async function verifyDatabaseSafetyNets(prisma: PrismaClient): Promise<void> {
  const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN ('ledger_entries_immutable', 'transactions_immutable', 'movements_immutable')`;

  const expectedTriggers = [
    "ledger_entries_immutable",
    "transactions_immutable",
    "movements_immutable",
  ];
  const foundTriggers = triggers.map((t) => t.tgname);
  const missingTriggers = expectedTriggers.filter((name) => !foundTriggers.includes(name));

  if (missingTriggers.length > 0) {
    throw new Error(
      `FATAL: missing immutability triggers: ${missingTriggers.join(", ")}. ` +
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

/**
 * Local development entry point.
 * Starts a long-running Node.js server with scheduled jobs and DB verification.
 * For Vercel deployment, see api/index.ts instead.
 */
async function main() {
  const config = loadConfig();
  const deps = wire(config);

  // Preflight: verify DB safety nets before accepting traffic
  await verifyDatabaseSafetyNets(deps.prisma);

  const app = createApp(deps);

  // Background scheduled jobs (only in long-running server, not in serverless)
  startScheduledJobs([...idempotencyJobs, ...walletJobs], deps.commandBus, deps.idGen, deps.logger);

  serve({ fetch: app.fetch, port: config.httpPort }, (info) => {
    console.log(`Wallet service running on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
