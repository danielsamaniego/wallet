import { z } from "zod";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Query Params (filters, sort, pagination) ────────────────────────────────

const listingConfig: ListingConfig = {
  filterableFields: [
    {
      apiName: "entry_type",
      prismaName: "entryType",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["CREDIT", "DEBIT"],
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
      apiName: "transaction_id",
      prismaName: "transactionId",
      type: "string",
      operators: ["eq"],
    },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount_minor", prismaName: "amountMinor" },
    { apiName: "balance_after_minor", prismaName: "balanceAfterMinor" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);

// ── Response ────────────────────────────────────────────────────────────────

const LedgerEntrySchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  wallet_id: z.string(),
  entry_type: z.string(),
  amount_minor: z.union([z.number(), z.string()]),
  balance_after_minor: z.union([z.number(), z.string()]),
  created_at: z.number(),
});

export const ResponseSchema = z.object({
  ledger_entries: z.array(LedgerEntrySchema),
  next_cursor: z.string().nullable(),
});
