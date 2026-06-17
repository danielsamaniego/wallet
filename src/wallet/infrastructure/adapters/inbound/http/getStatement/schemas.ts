import { z } from "zod";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";

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
      enumValues: [
        "deposit",
        "withdrawal",
        "transfer_in",
        "transfer_out",
        "hold_capture",
        "charge",
        "adjustment_credit",
        "adjustment_debit",
      ],
    },
    {
      apiName: "status",
      prismaName: "status",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["completed", "failed", "reversed"],
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
  jsonFilterableFields: [{ apiName: "metadata", prismaName: "metadata", maxDepth: 3 }],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount_minor", prismaName: "amountMinor" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

// Free-text search is an endpoint-specific extra (not a listing filter): a
// case-insensitive substring on reference/reason. Bounded to 256 chars so an
// oversized term can't build a pathological ILIKE pattern; declaring it here
// also emits it into the OpenAPI spec.
export const QueryParamsSchema = createListingQuerySchema<{ q?: string }>(listingConfig, {
  q: z.string().max(256).optional(),
});

// ── Response ────────────────────────────────────────────────────────────────

const StatementEntrySchema = z.object({
  movement_id: z.string(),
  transaction_id: z.string(),
  type: z.string(),
  amount_minor: z.union([z.number(), z.string()]),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  counterpart_wallet_id: z.string().nullable(),
  hold_id: z.string().nullable(),
  status: z.string(),
  balance_before_minor: z.union([z.number(), z.string()]),
  balance_after_minor: z.union([z.number(), z.string()]),
  created_at: z.number(),
});

export const ResponseSchema = z.object({
  entries: z.array(StatementEntrySchema),
  next_cursor: z.string().nullable(),
});
