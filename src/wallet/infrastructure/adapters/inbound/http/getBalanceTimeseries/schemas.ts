import { z } from "zod";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Query Params (range in Unix ms, daily granularity) ──────────────────────

export const QueryParamsSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().nonnegative(),
    granularity: z.enum(["day"]).default("day"),
  })
  .refine((q) => q.to >= q.from, { message: "to must be >= from", path: ["to"] });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  points: z.array(
    z.object({
      date: z.string(),
      balance_minor: z.union([z.number(), z.string()]),
    }),
  ),
});
