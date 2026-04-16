import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "node:crypto";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet",
});
const prisma = new PrismaClient({ adapter });

/**
 * Dev-consumer API key: deterministic credentials for a local integrator app.
 *
 * The secret is a well-known dev-only value. Do NOT use this in production.
 * Override via env vars if you want different credentials for your dev setup.
 */
const DEV_CONSUMER_PLATFORM_ID =
  process.env.DEV_CONSUMER_PLATFORM_ID ?? "019560a0-0000-7000-8000-000000000002";
const DEV_CONSUMER_PLATFORM_NAME = process.env.DEV_CONSUMER_PLATFORM_NAME ?? "Dev Consumer Platform";
const DEV_CONSUMER_API_KEY_ID = process.env.DEV_CONSUMER_API_KEY_ID ?? "wk_dev_consumer";
const DEV_CONSUMER_SECRET =
  process.env.DEV_CONSUMER_SECRET ?? "dev-consumer-secret-not-for-production-use";

async function seedPlatform({
  id,
  name,
  apiKeyId,
  secret,
  allowNegativeBalance = false,
}: {
  id: string;
  name: string;
  apiKeyId: string;
  secret: string;
  allowNegativeBalance?: boolean;
}) {
  const apiKeyHash = createHash("sha256").update(secret).digest("hex");
  const fullApiKey = `${apiKeyId}.${secret}`;
  const now = BigInt(Date.now());

  const platform = await prisma.platform.upsert({
    where: { apiKeyId },
    update: { allowNegativeBalance },
    create: {
      id,
      name,
      apiKeyHash,
      apiKeyId,
      status: "active",
      allowNegativeBalance,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { platform, fullApiKey };
}

async function main() {
  // Platform 1: "Test Platform" with random credentials (for quick manual testing)
  const testApiKeyId = "wk_test_001";
  const testSecret = randomBytes(32).toString("hex");
  const { platform: testPlatform, fullApiKey: testApiKey } = await seedPlatform({
    id: "019560a0-0000-7000-8000-000000000001",
    name: "Test Platform",
    apiKeyId: testApiKeyId,
    secret: testSecret,
  });

  console.log("=".repeat(70));
  console.log("Platform seeded: Test Platform (random credentials per run)");
  console.log(`  ID:   ${testPlatform.id}`);
  console.log(`  Name: ${testPlatform.name}`);
  console.log("");
  console.log("  API Key (save this — shown only once):");
  console.log(`  ${testApiKey}`);
  console.log("=".repeat(70));

  // Platform 2: "Dev Consumer Platform" with DETERMINISTIC credentials
  // so a local consumer app (a service that integrates this Wallet) can
  // reference stable credentials in its own .env.local.
  const { platform: devPlatform, fullApiKey: devApiKey } = await seedPlatform({
    id: DEV_CONSUMER_PLATFORM_ID,
    name: DEV_CONSUMER_PLATFORM_NAME,
    apiKeyId: DEV_CONSUMER_API_KEY_ID,
    secret: DEV_CONSUMER_SECRET,
    allowNegativeBalance: true,
  });

  console.log("");
  console.log("=".repeat(70));
  console.log(`Platform seeded: ${devPlatform.name} (deterministic credentials)`);
  console.log(`  ID:   ${devPlatform.id}`);
  console.log(`  Name: ${devPlatform.name}`);
  console.log("");
  console.log("  API Key (stable across re-seeds — DEV ONLY):");
  console.log(`  ${devApiKey}`);
  console.log("");
  console.log("  Use in your local consumer app as:");
  console.log(`    WALLET_SERVICE_URL=http://localhost:3000`);
  console.log(`    WALLET_SERVICE_API_KEY=${devApiKey}`);
  console.log("=".repeat(70));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
