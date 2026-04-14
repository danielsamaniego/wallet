import type {
  FilterCondition,
  FilterOperator,
  JsonFilterCondition,
  SortField,
} from "../kernel/listing.js";
import { decodeCursor, ensureTiebreaker } from "../kernel/listing.js";

export interface PrismaListingClause {
  where: Record<string, unknown>;
  orderBy: Record<string, string>[];
  take: number;
}

/**
 * Converts domain listing types into Prisma findMany arguments.
 * Uses WHERE-based keyset pagination (not Prisma's native cursor).
 */
export function buildPrismaListing(
  baseWhere: Record<string, unknown>,
  filters: readonly FilterCondition[],
  sort: readonly SortField[],
  limit: number,
  cursor?: string,
  jsonFilters?: readonly JsonFilterCondition[],
): PrismaListingClause {
  const sortWithTiebreaker = ensureTiebreaker(sort);

  // Build filter conditions as individual objects (supports multiple ops on same field)
  const filterConditions: Record<string, unknown>[] = filters.map((f) => ({
    [f.field]: operatorToPrisma(f.operator, f.value),
  }));

  // Build JSON path filter conditions (e.g. metadata.source = "settlement")
  const jsonConditions: Record<string, unknown>[] = (jsonFilters ?? []).map((jf) => ({
    [jf.field]: { path: [...jf.path], equals: jf.value },
  }));

  const allConditions = [...filterConditions, ...jsonConditions];

  // Build WHERE with AND array
  let where: Record<string, unknown>;

  if (cursor) {
    const keysetValues = decodeCursor(cursor, sort);
    const cursorWhere = buildKeysetWhere(sortWithTiebreaker, keysetValues);
    where = { AND: [baseWhere, ...allConditions, cursorWhere] };
  } else if (allConditions.length > 0) {
    where = { AND: [baseWhere, ...allConditions] };
  } else {
    where = baseWhere;
  }

  // Build ORDER BY with tiebreaker
  const orderBy = sortWithTiebreaker.map((s) => ({ [s.field]: s.direction }));

  return { where, orderBy, take: limit + 1 };
}

function operatorToPrisma(operator: FilterOperator, value: unknown): unknown {
  switch (operator) {
    case "eq":
      return value;
    case "gt":
      return { gt: value };
    case "gte":
      return { gte: value };
    case "lt":
      return { lt: value };
    case "lte":
      return { lte: value };
    case "in":
      return { in: value };
  }
}

/**
 * Builds a WHERE clause for keyset (seek) pagination.
 *
 * For sort [createdAt desc, id desc] with cursor values [ts, id]:
 *   (createdAt < ts) OR (createdAt = ts AND id < "abc")
 */
function buildKeysetWhere(
  sort: readonly SortField[],
  values: readonly unknown[],
): Record<string, unknown> {
  const orClauses: Record<string, unknown>[] = [];

  for (let i = 0; i < sort.length; i++) {
    const andParts: Record<string, unknown> = {};

    // All preceding fields must be equal
    for (let j = 0; j < i; j++) {
      andParts[sort[j]!.field] = values[j];
    }

    // Current field uses directional comparator
    const comparator = sort[i]!.direction === "desc" ? "lt" : "gt";
    andParts[sort[i]!.field] = { [comparator]: values[i] };

    orClauses.push(andParts);
  }

  return { OR: orClauses };
}
