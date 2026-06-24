import { z } from "zod";

// ── Query Params ────────────────────────────────────────────────────────────

// Platform-wide: "owner" groups the whole platform's movements per owner (the
// "top movers" view), which only makes sense across many wallets.
const GroupBySchema = z.enum(["type", "day", "week", "month", "metadata", "owner"]);

export const QueryParamsSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().nonnegative(),
    group_by: GroupBySchema,
    direction: z.enum(["credit", "debit", "all"]).default("all"),
    metadata_key: z.string().min(1).max(255).optional(),
    owner_id: z.string().min(1).max(255).optional(),
    metadata_filter_key: z.string().min(1).max(255).optional(),
    metadata_filter_value: z.string().max(255).optional(),
  })
  .refine((q) => q.to >= q.from, { message: "to must be >= from", path: ["to"] })
  .refine((q) => q.group_by !== "metadata" || q.metadata_key !== undefined, {
    message: "metadata_key is required when group_by=metadata",
    path: ["metadata_key"],
  })
  .refine(
    (q) => (q.metadata_filter_key === undefined) === (q.metadata_filter_value === undefined),
    {
      message: "metadata_filter_key and metadata_filter_value must be provided together",
      path: ["metadata_filter_value"],
    },
  );

// ── Response ────────────────────────────────────────────────────────────────

const BucketSchema = z.object({
  bucket: z.string().nullable(),
  sum_net_minor: z.union([z.number(), z.string()]),
  sum_credits_minor: z.union([z.number(), z.string()]),
  sum_debits_minor: z.union([z.number(), z.string()]),
  min_minor: z.union([z.number(), z.string()]),
  max_minor: z.union([z.number(), z.string()]),
  count: z.number(),
});

export const ResponseSchema = z.array(BucketSchema);
