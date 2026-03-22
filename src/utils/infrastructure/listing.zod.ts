import { z } from "zod";
import type {
  FilterCondition,
  FilterableFieldConfig,
  FilterOperator,
  ListingConfig,
  ListingQuery,
  SortDirection,
  SortField,
} from "../kernel/listing.js";
import { decodeCursor } from "../kernel/listing.js";

// ── Schema Factory ──────────────────────────────────────────────────────────

/**
 * Creates a Zod schema from a ListingConfig that validates Stripe-style query params.
 * Use with `zValidator("query", schema, validationHook)`.
 *
 * Supported query param formats:
 *   ?filter[field]=value          → eq operator
 *   ?filter[field]=a,b,c          → implicit "in" (when field allows it)
 *   ?filter[field][op]=value      → explicit operator (gt, gte, lt, lte, in)
 *   ?sort=-field1,field2          → multi-field sort (- prefix = desc)
 *   ?limit=N                      → page size
 *   ?cursor=base64url             → opaque keyset cursor
 *
 * Output type: ListingQuery
 */
export function createListingQuerySchema(config: ListingConfig) {
  // Build explicit keys for each filterable field + operator combination.
  // This makes every possible query param visible to hono-openapi for documentation.
  const filterShape: Record<string, z.ZodOptional<z.ZodString>> = {};

  for (const field of config.filterableFields) {
    // filter[field] → shorthand for eq (or implicit in with CSV)
    filterShape[`filter[${field.apiName}]`] = z.string().optional();
    // filter[field][op] → explicit operator
    for (const op of field.operators) {
      filterShape[`filter[${field.apiName}][${op}]`] = z.string().optional();
    }
  }

  // Build set of all known keys for unknown-key detection
  const knownKeys = new Set(["limit", "cursor", "sort", ...Object.keys(filterShape)]);

  return z
    .object({
      limit: z.coerce.number().int().min(1).max(config.maxLimit).default(config.defaultLimit),
      cursor: z.string().optional(),
      sort: z.string().optional(),
      ...filterShape,
    })
    .catchall(z.unknown())
    .transform((raw, ctx) => {
      // Reject unknown filter[...] keys
      for (const key of Object.keys(raw)) {
        if (key.startsWith("filter[") && !knownKeys.has(key)) {
          const allowed = config.filterableFields.map((f) => f.apiName).join(", ");
          ctx.addIssue({ code: "custom", message: `unknown filter parameter: ${key}. Allowed fields: ${allowed}` });
          return z.NEVER;
        }
      }

      // Parse sort
      const sortResult = parseSort(raw.sort as string | undefined, config);
      if (!sortResult.ok) {
        ctx.addIssue({ code: "custom", message: sortResult.error });
        return z.NEVER;
      }

      // Parse filters from explicit keys
      const filtersResult = parseFiltersFromShape(raw as Record<string, unknown>, config);
      if (!filtersResult.ok) {
        ctx.addIssue({ code: "custom", message: filtersResult.error });
        return z.NEVER;
      }

      // Validate cursor against sort signature
      if (raw.cursor) {
        try {
          decodeCursor(raw.cursor, sortResult.data);
        } catch (e) {
          ctx.addIssue({
            code: "custom",
            message: e instanceof Error ? e.message : "INVALID_CURSOR",
          });
          return z.NEVER;
        }
      }

      return {
        filters: filtersResult.data,
        sort: sortResult.data,
        limit: raw.limit,
        cursor: raw.cursor,
      } satisfies ListingQuery;
    });
}

// ── Sort Parser ─────────────────────────────────────────────────────────────

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function parseSort(raw: string | undefined, config: ListingConfig): Result<SortField[]> {
  if (!raw) return { ok: true, data: [...config.defaultSort] };

  const tokens = raw.split(",").filter(Boolean);
  const fields: SortField[] = [];

  for (const token of tokens) {
    const desc = token.startsWith("-");
    const apiName = desc ? token.slice(1) : token;
    const allowed = config.sortableFields.find((f) => f.apiName === apiName);

    if (!allowed) {
      const valid = config.sortableFields.map((f) => f.apiName).join(", ");
      return { ok: false, error: `unknown sort field: ${apiName}. Allowed: ${valid}` };
    }

    fields.push({
      field: allowed.prismaName,
      direction: (desc ? "desc" : "asc") as SortDirection,
    });
  }

  return { ok: true, data: fields };
}

// ── Filter Parser ───────────────────────────────────────────────────────────

function parseFiltersFromShape(
  raw: Record<string, unknown>,
  config: ListingConfig,
): Result<FilterCondition[]> {
  const conditions: FilterCondition[] = [];

  for (const field of config.filterableFields) {
    // Check explicit operator keys first: filter[field][op]
    for (const op of field.operators) {
      const key = `filter[${field.apiName}][${op}]`;
      const value = raw[key] as string | undefined;
      if (!value) continue;

      const coerced = coerceFilterValue(value, field, op);
      if (!coerced.ok) return coerced;
      conditions.push({ field: field.prismaName, operator: op, value: coerced.data });
    }

    // Check shorthand: filter[field] (eq or implicit in)
    const shorthandKey = `filter[${field.apiName}]`;
    const shorthandValue = raw[shorthandKey] as string | undefined;
    if (!shorthandValue) continue;

    // CSV with commas → implicit "in" (if allowed)
    if (shorthandValue.includes(",") && field.operators.includes("in")) {
      const coerced = coerceFilterValue(shorthandValue, field, "in");
      if (!coerced.ok) return coerced;
      conditions.push({ field: field.prismaName, operator: "in", value: coerced.data });
    } else if (field.operators.includes("eq")) {
      const coerced = coerceFilterValue(shorthandValue, field, "eq");
      if (!coerced.ok) return coerced;
      conditions.push({ field: field.prismaName, operator: "eq", value: coerced.data });
    }
  }

  return { ok: true, data: conditions };
}

// ── Value Coercion ──────────────────────────────────────────────────────────

function coerceFilterValue(
  raw: string,
  fieldConfig: FilterableFieldConfig,
  operator: FilterOperator,
): Result<unknown> {
  if (operator === "in") {
    const parts = raw.split(",").map((p) => p.trim());
    const values: unknown[] = [];
    for (const part of parts) {
      const result = coerceSingle(part, fieldConfig);
      if (!result.ok) return result;
      values.push(result.data);
    }
    return { ok: true, data: values };
  }
  return coerceSingle(raw, fieldConfig);
}

function coerceSingle(
  raw: string,
  fieldConfig: FilterableFieldConfig,
): Result<unknown> {
  switch (fieldConfig.type) {
    case "string":
      return { ok: true, data: raw };

    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        return { ok: false, error: `${fieldConfig.apiName}: expected a number, got "${raw}"` };
      }
      return { ok: true, data: n };
    }

    case "bigint": {
      try {
        return { ok: true, data: BigInt(raw) };
      } catch {
        return { ok: false, error: `${fieldConfig.apiName}: expected an integer, got "${raw}"` };
      }
    }

    case "date": {
      const asNum = Number(raw);
      if (!Number.isNaN(asNum)) {
        return { ok: true, data: BigInt(Math.floor(asNum)) };
      }
      const d = Date.parse(raw);
      if (Number.isNaN(d)) {
        return { ok: false, error: `${fieldConfig.apiName}: invalid date "${raw}"` };
      }
      return { ok: true, data: BigInt(d) };
    }

    case "enum": {
      if (fieldConfig.enumValues && !fieldConfig.enumValues.includes(raw)) {
        return {
          ok: false,
          error: `${fieldConfig.apiName}: must be one of ${fieldConfig.enumValues.join(", ")}. Got "${raw}"`,
        };
      }
      return { ok: true, data: raw };
    }
  }
}
