/**
 * Vitest globalSetup for e2e tests.
 * Runs ONCE before all e2e test files.
 *
 * Assumes Docker PostgreSQL is already running (`pnpm docker:up`).
 * Syncs schema, applies constraints, and seeds test data.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet";
const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");

export async function setup() {
  console.log("\n[e2e setup] Syncing database schema...");
  execSync("npx prisma db push --config prisma/prisma.config.ts --accept-data-loss", {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL },
  });

  console.log("[e2e setup] Applying immutable ledger constraints...");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const sql = readFileSync(resolve(PROJECT_ROOT, "prisma/immutable_ledger.sql"), "utf-8");
    await prisma.$executeRawUnsafe(sql);

    console.log("[e2e setup] Seeding test platforms...");
    const now = BigInt(Date.now());

    // Test platform
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

    // Attacker platform
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

    console.log("[e2e setup] Done.\n");
  } finally {
    await prisma.$disconnect();
  }
}

export async function teardown() {
  console.log("\n[e2e teardown] Cleaning up...");
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
  console.log("[e2e teardown] Done.\n");
}
