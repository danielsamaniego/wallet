import { z } from "zod";
import type { ListingConfig } from "../../../../shared/domain/kernel/listing.js";
import { createListingQuerySchema } from "../../../../shared/adapters/kernel/listing.zod.js";

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
      apiName: "amount_cents",
      prismaName: "amountCents",
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
    { apiName: "amount_cents", prismaName: "amountCents" },
    { apiName: "balance_after_cents", prismaName: "balanceAfterCents" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);
