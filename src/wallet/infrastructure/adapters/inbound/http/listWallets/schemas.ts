import { z } from "zod";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";

// ── Query Params (filters, sort, pagination) ────────────────────────────
const listingConfig: ListingConfig = {
  filterableFields: [
    {
      apiName: "owner_id",
      prismaName: "ownerId",
      type: "string",
      operators: ["eq"],
    },
    {
      apiName: "currency_code",
      prismaName: "currencyCode",
      type: "string",
      operators: ["eq"],
    },
    {
      apiName: "status",
      prismaName: "status",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["active", "frozen", "closed"],
    },
    {
      apiName: "created_at",
      prismaName: "createdAt",
      type: "bigint",
      operators: ["gt", "gte", "lt", "lte"],
    },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "owner_id", prismaName: "ownerId" },
    { apiName: "balance_minor", prismaName: "cachedBalanceMinor" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);

// ── Response ────────────────────────────────────────────────────────────
const WalletSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  platform_id: z.string(),
  currency_code: z.string(),
  balance_minor: z.union([z.number(), z.string()]),
  available_balance_minor: z.union([z.number(), z.string()]),
  status: z.string(),
  is_system: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const ResponseSchema = z.object({
  wallets: z.array(WalletSchema),
  next_cursor: z.string().nullable(),
});
