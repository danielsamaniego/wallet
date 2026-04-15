import { z } from "zod";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Query Params (filters, sort, pagination) ────────────────────────────────

const listingConfig: ListingConfig = {
  filterableFields: [
    {
      apiName: "status",
      prismaName: "status",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["active", "captured", "voided", "expired"],
    },
    {
      apiName: "amount_minor",
      prismaName: "amountMinor",
      type: "bigint",
      operators: ["eq", "gt", "gte", "lt", "lte"],
    },
    {
      apiName: "created_at",
      prismaName: "createdAt",
      type: "bigint",
      operators: ["gt", "gte", "lt", "lte"],
    },
    {
      apiName: "reference",
      prismaName: "reference",
      type: "string",
      operators: ["eq"],
    },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount_minor", prismaName: "amountMinor" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);

// ── Response ────────────────────────────────────────────────────────────────

const HoldSchema = z.object({
  id: z.string(),
  wallet_id: z.string(),
  amount_minor: z.union([z.number(), z.string()]),
  status: z.string(),
  reference: z.string().nullable(),
  expires_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const ResponseSchema = z.object({
  holds: z.array(HoldSchema),
  next_cursor: z.string().nullable(),
});
