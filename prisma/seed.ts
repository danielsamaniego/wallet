import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "node:crypto";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const now = BigInt(Date.now());

  // Generate API key: <api_key_id>.<secret>
  const apiKeyId = "wk_test_001";
  const secret = randomBytes(32).toString("hex");
  const apiKeyHash = createHash("sha256").update(secret).digest("hex");
  const fullApiKey = `${apiKeyId}.${secret}`;

  const platform = await prisma.platform.upsert({
    where: { apiKeyId },
    update: {},
    create: {
      id: "019560a0-0000-7000-8000-000000000001",
      name: "Test Platform",
      apiKeyHash,
      apiKeyId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log("=".repeat(60));
  console.log("Platform seeded:");
  console.log(`  ID:   ${platform.id}`);
  console.log(`  Name: ${platform.name}`);
  console.log("");
  console.log("API Key (save this — shown only once):");
  console.log(`  ${fullApiKey}`);
  console.log("");
  console.log("Usage:");
  console.log(`  curl -H "X-API-Key: ${fullApiKey}" http://localhost:3000/health`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
