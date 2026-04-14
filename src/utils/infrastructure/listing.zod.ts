import { z } from "zod";
import type {
  FilterableFieldConfig,
  FilterCondition,
  FilterOperator,
  JsonFilterableFieldConfig,
  JsonFilterCondition,
  ListingConfig,
  ListingQuery,
  SortDirection,
  SortField,
} from "../kernel/listing.js";
import { decodeCursor } from "../kernel/listing.js";

/** Safely extracts a message from an unknown caught value, falling back to a default. */
export function safeErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

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

  // Build JSON-filterable prefixes (e.g. "metadata" → config)
  const jsonPrefixes = new Map((config.jsonFilterableFields ?? []).map((f) => [f.apiName, f]));

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
        if (
          key.startsWith("filter[") &&
          !knownKeys.has(key) &&
          !isJsonFilterKey(key, jsonPrefixes)
        ) {
          const allowed = [
            ...config.filterableFields.map((f) => f.apiName),
            ...(config.jsonFilterableFields ?? []).map((f) => `${f.apiName}.*`),
          ].join(", ");
          ctx.addIssue({
            code: "custom",
            message: `unknown filter parameter: ${key}. Allowed fields: ${allowed}`,
          });
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

      // Parse JSON path filters (e.g. filter[metadata.source]=settlement)
      const jsonFiltersResult = parseJsonFilters(raw as Record<string, unknown>, jsonPrefixes);
      if (!jsonFiltersResult.ok) {
        ctx.addIssue({ code: "custom", message: jsonFiltersResult.error });
        return z.NEVER;
      }

      // Validate cursor against sort signature
      if (raw.cursor) {
        try {
          decodeCursor(raw.cursor, sortResult.data);
        } catch (e) {
          ctx.addIssue({
            code: "custom",
            message: safeErrorMessage(e, "INVALID_CURSOR"),
          });
          return z.NEVER;
        }
      }

      return {
        filters: filtersResult.data,
        jsonFilters: jsonFiltersResult.data.length > 0 ? jsonFiltersResult.data : undefined,
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

function coerceSingle(raw: string, fieldConfig: FilterableFieldConfig): Result<unknown> {
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

// ── JSON Filter Helpers ──────────────────────────────────────────────────────

const JSON_FILTER_RE = /^filter\[([a-zA-Z_][a-zA-Z0-9_]*)\.(.+)]$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_]+$/;

/** Extracts typed prefix+path from a JSON filter key, or null if no match. */
function parseJsonFilterKey(key: string): { prefix: string; pathStr: string } | null {
  const match = JSON_FILTER_RE.exec(key);
  if (!match?.[1] || !match[2]) return null;
  return { prefix: match[1], pathStr: match[2] };
}

function isJsonFilterKey(key: string, prefixes: Map<string, JsonFilterableFieldConfig>): boolean {
  const parsed = parseJsonFilterKey(key);
  return parsed !== null && prefixes.has(parsed.prefix);
}

export function parseJsonFilters(
  raw: Record<string, unknown>,
  prefixes: Map<string, JsonFilterableFieldConfig>,
): Result<JsonFilterCondition[]> {
  if (prefixes.size === 0) return { ok: true, data: [] };

  const conditions: JsonFilterCondition[] = [];

  for (const key of Object.keys(raw)) {
    const parsed = parseJsonFilterKey(key);
    if (!parsed) continue;

    const { prefix, pathStr } = parsed;
    const fieldConfig = prefixes.get(prefix);
    if (!fieldConfig) continue;

    const segments = pathStr.split(".");

    if (segments.length > fieldConfig.maxDepth) {
      return {
        ok: false,
        error: `${prefix}: path depth ${segments.length} exceeds max ${fieldConfig.maxDepth}`,
      };
    }

    for (const segment of segments) {
      if (!PATH_SEGMENT_RE.test(segment)) {
        return {
          ok: false,
          error: `${prefix}: invalid path segment "${segment}". Only alphanumeric and underscores allowed`,
        };
      }
    }

    const value = raw[key];
    if (typeof value !== "string" || value === "") continue;

    conditions.push({
      field: fieldConfig.prismaName,
      path: segments,
      value,
    });
  }

  return { ok: true, data: conditions };
}
