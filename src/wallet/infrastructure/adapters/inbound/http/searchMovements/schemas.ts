import { z } from "zod";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";

// ── Query Params ─────────────────────────────────────────────────────────────
// Structured filters + sort + cursor are validated by the listing schema. The
// free-text `q` is read directly from the query string in the handler — the
// listing schema's catchall lets it pass through validation.

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
  jsonFilterableFields: [{ apiName: "metadata", prismaName: "metadata", maxDepth: 3 }],
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

const MovementSchema = z.object({
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
  movements: z.array(MovementSchema),
  next_cursor: z.string().nullable(),
});
