import { z } from "zod";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Query Params (filters, sort, pagination) ────────────────────────────────

const listingConfig: ListingConfig = {
  filterableFields: [
    {
      apiName: "type",
      prismaName: "type",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["deposit", "withdrawal", "transfer_in", "transfer_out", "hold_capture"],
    },
    {
      apiName: "status",
      prismaName: "status",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["completed", "failed", "reversed"],
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
      apiName: "counterpart_wallet_id",
      prismaName: "counterpartWalletId",
      type: "string",
      operators: ["eq"],
    },
    {
      apiName: "reference",
      prismaName: "reference",
      type: "string",
      operators: ["eq"],
    },
  ],
  jsonFilterableFields: [
    { apiName: "metadata", prismaName: "metadata", maxDepth: 3 },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount_cents", prismaName: "amountCents" },
    { apiName: "type", prismaName: "type" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);

// ── Response ────────────────────────────────────────────────────────────────

const TransactionSchema = z.object({
  id: z.string(),
  wallet_id: z.string(),
  counterpart_wallet_id: z.string().nullable(),
  type: z.string(),
  amount_cents: z.union([z.number(), z.string()]),
  status: z.string(),
  idempotency_key: z.string().nullable(),
  reference: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  hold_id: z.string().nullable(),
  created_at: z.number(),
});

export const ResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
  next_cursor: z.string().nullable(),
});
