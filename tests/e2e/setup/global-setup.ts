/**
 * Vitest globalSetup for e2e tests.
 * Runs ONCE before all e2e test files.
 *
 * 1. Starts PostgreSQL container
 * 2. Syncs schema + applies constraints + seeds
 * 3. Starts App container (needs constraints to exist for startup verification)
 * 4. Waits for App to be healthy
 *
 * Tests make real HTTP requests to the Dockerized app on TEST_PORT (default 3333).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5433/wallet_test";
const TEST_PORT = Number(process.env.TEST_PORT ?? "3333");
const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");
const PORT_FILE = resolve(PROJECT_ROOT, "node_modules/.e2e-port");
const COMPOSE_FILE = "docker-compose.test.yml";

function compose(args: string): void {
  execSync(`docker compose -f ${COMPOSE_FILE} ${args}`, {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
  });
}

function waitForHealthy(service: string, maxRetries = 60): void {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = execSync(
        `docker compose -f ${COMPOSE_FILE} ps ${service} --format json`,
        { cwd: PROJECT_ROOT, stdio: "pipe" },
      ).toString();
      if (result.includes('"healthy"')) return;
    } catch {
      // container not ready yet
    }
    execSync("sleep 1");
  }
  throw new Error(`Service '${service}' did not become healthy in time`);
}

export async function setup() {
  // ── 1. Start PostgreSQL only ───────────────────────────────────
  console.log("\n[e2e setup] Starting PostgreSQL container...");
  compose("up -d postgres");
  console.log("[e2e setup] Waiting for PostgreSQL to be healthy...");
  waitForHealthy("postgres");

  // ── 2. Sync schema ─────────────────────────────────────────────
  console.log("[e2e setup] Syncing database schema...");
  execSync("npx prisma db push --config prisma/prisma.config.ts --accept-data-loss", {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL },
  });

  // ── 3. Apply constraints ───────────────────────────────────────
  console.log("[e2e setup] Applying immutable ledger constraints...");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const sql = readFileSync(resolve(PROJECT_ROOT, "prisma/immutable_ledger.sql"), "utf-8");
    await prisma.$executeRawUnsafe(sql);

    // ── 4. Seed test platforms ─────────────────────────────────────
    console.log("[e2e setup] Seeding test platforms...");
    const now = BigInt(Date.now());

    const testSecret = "e2e-test-secret-that-is-long-enough-for-validation";
    await prisma.platform.upsert({
      where: { apiKeyId: "wk_test_e2e" },
      update: {},
      create: {
        id: "019560a0-0000-7000-8000-e2e000000001",
        name: "E2E Test Platform",
        apiKeyHash: createHash("sha256").update(testSecret).digest("hex"),
        apiKeyId: "wk_test_e2e",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });

    const attackerSecret = "attacker-secret-long-enough-for-validation-purposes";
    await prisma.platform.upsert({
      where: { apiKeyId: "wk_test_attacker" },
      update: {},
      create: {
        id: "019560a0-0000-7000-8000-e2e000000002",
        name: "Attacker Platform",
        apiKeyHash: createHash("sha256").update(attackerSecret).digest("hex"),
        apiKeyId: "wk_test_attacker",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });

    const negativeSecret = "negative-balance-secret-long-enough-for-validation";
    await prisma.platform.upsert({
      where: { apiKeyId: "wk_test_negative" },
      update: {},
      create: {
        id: "019560a0-0000-7000-8000-e2e000000003",
        name: "Negative Balance Platform",
        apiKeyHash: createHash("sha256").update(negativeSecret).digest("hex"),
        apiKeyId: "wk_test_negative",
        status: "active",
        allowNegativeBalance: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  // ── 5. Start App container (DB is ready with constraints) ──────
  console.log("[e2e setup] Building and starting App container...");
  compose("up -d --build app");
  console.log("[e2e setup] Waiting for App to be healthy...");
  waitForHealthy("app");

  // Write port for test-app.ts
  writeFileSync(PORT_FILE, String(TEST_PORT), "utf-8");

  console.log(`[e2e setup] App running on http://localhost:${TEST_PORT}`);
  console.log("[e2e setup] Done.\n");
}

export async function teardown() {
  console.log("\n[e2e teardown] Cleaning up database...");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        ledger_entries, transactions, movements, holds,
        idempotency_records, wallets, platforms
      CASCADE
    `);
  } finally {
    await prisma.$disconnect();
  }

  console.log("[e2e teardown] Stopping Docker containers...");
  compose("down");
  console.log("[e2e teardown] Done.\n");
}
