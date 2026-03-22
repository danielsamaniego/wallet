import { z } from "zod";
import type { ListingConfig } from "../../../../../../utils/kernel/listing.js";
import { createListingQuerySchema } from "../../../../../../utils/infrastructure/listing.zod.js";

// ── Query Params (filters, sort, pagination) ────────────────────────────────

const listingConfig: ListingConfig = {
  filterableFields: [
    {
      apiName: "status",
      prismaName: "status",
      type: "enum",
      operators: ["eq", "in"],
      enumValues: ["active", "suspended", "revoked"],
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
    { apiName: "name", prismaName: "name" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);

// ── Response ────────────────────────────────────────────────────────────────

const PlatformSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const ResponseSchema = z.object({
  platforms: z.array(PlatformSchema),
  next_cursor: z.string().nullable(),
});
