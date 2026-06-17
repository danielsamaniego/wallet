import { z } from "zod";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Query Params (range in Unix ms) ─────────────────────────────────────────

export const QueryParamsSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().nonnegative(),
  })
  .refine((q) => q.to >= q.from, { message: "to must be >= from", path: ["to"] });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  income_minor: z.union([z.number(), z.string()]),
  expense_minor: z.union([z.number(), z.string()]),
  net_minor: z.union([z.number(), z.string()]),
  days: z.number(),
});
