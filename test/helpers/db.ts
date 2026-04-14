/**
 * E2E test database utilities.
 * Provides a Prisma client for the test DB and helpers for cleanup/seeding.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet";

let _prisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!_prisma) {
    const adapter = new PrismaPg({ connectionString: DATABASE_URL });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}

/**
 * Truncate all tables in the correct FK order.
 * Uses TRUNCATE CASCADE for safety.
 */
export async function truncateAll(): Promise<void> {
  const prisma = getTestPrisma();
  // Order: child tables first (FK dependencies)
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      ledger_entries,
      transactions,
      movements,
      holds,
      idempotency_records,
      wallets,
      platforms
    CASCADE
  `);
}

/**
 * Known test API key credentials.
 * The secret is deterministic so tests can use it without reading seed output.
 */
export const TEST_API_KEY_ID = "wk_test_e2e";
export const TEST_API_KEY_SECRET = "e2e-test-secret-that-is-long-enough-for-validation";
export const TEST_API_KEY_HASH = createHash("sha256").update(TEST_API_KEY_SECRET).digest("hex");
export const TEST_API_KEY = `${TEST_API_KEY_ID}.${TEST_API_KEY_SECRET}`;

export const TEST_PLATFORM_ID = "019560a0-0000-7000-8000-e2e000000001";

/**
 * Seed a test platform with a known API key.
 */
export async function seedTestPlatform(): Promise<void> {
  const prisma = getTestPrisma();
  const now = BigInt(Date.now());

  await prisma.platform.upsert({
    where: { apiKeyId: TEST_API_KEY_ID },
    update: {},
    create: {
      id: TEST_PLATFORM_ID,
      name: "E2E Test Platform",
      apiKeyHash: TEST_API_KEY_HASH,
      apiKeyId: TEST_API_KEY_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Seed a second "attacker" platform for cross-tenant isolation tests.
 */
export const ATTACKER_API_KEY_ID = "wk_test_attacker";
export const ATTACKER_API_KEY_SECRET = "attacker-secret-long-enough-for-validation-purposes";
export const ATTACKER_API_KEY_HASH = createHash("sha256").update(ATTACKER_API_KEY_SECRET).digest("hex");
export const ATTACKER_API_KEY = `${ATTACKER_API_KEY_ID}.${ATTACKER_API_KEY_SECRET}`;
export const ATTACKER_PLATFORM_ID = "019560a0-0000-7000-8000-e2e000000002";

export async function seedAttackerPlatform(): Promise<void> {
  const prisma = getTestPrisma();
  const now = BigInt(Date.now());

  await prisma.platform.upsert({
    where: { apiKeyId: ATTACKER_API_KEY_ID },
    update: {},
    create: {
      id: ATTACKER_PLATFORM_ID,
      name: "Attacker Platform",
      apiKeyHash: ATTACKER_API_KEY_HASH,
      apiKeyId: ATTACKER_API_KEY_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  });
}
