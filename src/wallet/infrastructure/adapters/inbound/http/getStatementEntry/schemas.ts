import { z } from "zod";

// ── Path Params ─────────────────────────────────────────────────────────────

export const ParamSchema = z.object({
  walletId: z.string().min(1).max(255),
  movementId: z.string().min(1).max(255),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
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
