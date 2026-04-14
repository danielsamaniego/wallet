// ── Filter ──────────────────────────────────────────────────────────────────

export type FilterOperator = "eq" | "gt" | "gte" | "lt" | "lte" | "in";

export interface FilterCondition {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: unknown;
}

export interface JsonFilterCondition {
  readonly field: string;
  readonly path: readonly string[];
  readonly value: string;
}

// ── Sort ────────────────────────────────────────────────────────────────────

export type SortDirection = "asc" | "desc";

export interface SortField {
  readonly field: string;
  readonly direction: SortDirection;
}

// ── Listing Query ───────────────────────────────────────────────────────────

export interface ListingQuery {
  readonly filters: readonly FilterCondition[];
  readonly jsonFilters?: readonly JsonFilterCondition[];
  readonly sort: readonly SortField[];
  readonly limit: number;
  readonly cursor?: string;
}

// ── Paginated Result ────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
}

// ── Endpoint Configuration (whitelist) ──────────────────────────────────────

export type FieldType = "string" | "number" | "bigint" | "date" | "enum";

export interface FilterableFieldConfig {
  readonly apiName: string;
  readonly prismaName: string;
  readonly type: FieldType;
  readonly operators: readonly FilterOperator[];
  readonly enumValues?: readonly string[];
}

export interface JsonFilterableFieldConfig {
  readonly apiName: string;
  readonly prismaName: string;
  readonly maxDepth: number;
}

export interface SortableFieldConfig {
  readonly apiName: string;
  readonly prismaName: string;
}

export interface ListingConfig {
  readonly filterableFields: readonly FilterableFieldConfig[];
  readonly jsonFilterableFields?: readonly JsonFilterableFieldConfig[];
  readonly sortableFields: readonly SortableFieldConfig[];
  readonly defaultSort: readonly SortField[];
  readonly maxLimit: number;
  readonly defaultLimit: number;
}

// ── Cursor ──────────────────────────────────────────────────────────────────

interface CursorPayload {
  v: unknown[];
  s: string;
}

export function sortSignature(sort: readonly SortField[]): string {
  const raw = sort.map((s) => `${s.field}:${s.direction}`).join("|");
  return Buffer.from(raw).toString("base64").slice(0, 12);
}

export function ensureTiebreaker(sort: readonly SortField[]): SortField[] {
  const fields = [...sort];
  if (!fields.some((s) => s.field === "id")) {
    const lastDir = fields[fields.length - 1]?.direction ?? "desc";
    fields.push({ field: "id", direction: lastDir });
  }
  return fields;
}

export function encodeCursor(sort: readonly SortField[], lastRow: Record<string, unknown>): string {
  const withTiebreaker = ensureTiebreaker(sort);
  const payload: CursorPayload = {
    v: withTiebreaker.map((s) => {
      const val = lastRow[s.field];
      return typeof val === "bigint" ? val.toString() : val;
    }),
    s: sortSignature(withTiebreaker),
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url").replace(/=+$/, "");
}

export function decodeCursor(cursor: string, expectedSort: readonly SortField[]): unknown[] {
  const withTiebreaker = ensureTiebreaker(expectedSort);
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const payload: CursorPayload = JSON.parse(json);

    if (payload.s !== sortSignature(withTiebreaker)) {
      throw new Error("CURSOR_SORT_MISMATCH");
    }

    return payload.v;
  } catch (e) {
    if (e instanceof Error && e.message === "CURSOR_SORT_MISMATCH") {
      throw e;
    }
    throw new Error("INVALID_CURSOR");
  }
}
