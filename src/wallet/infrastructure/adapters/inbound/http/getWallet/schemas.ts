import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  platform_id: z.string(),
  currency_code: z.string(),
  balance_minor: z.union([z.number(), z.string()]),
  available_balance_minor: z.union([z.number(), z.string()]),
  status: z.string(),
  is_system: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});
