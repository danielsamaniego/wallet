// TODO(historical-import-temp): Remove these schemas together with the rest
// of the import-historical-entry feature once all legacy consumers have
// finished their backfill.
import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

export const BodySchema = z.object({
  amount_minor: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: "amount must not be zero" }),
  reason: z.string().min(1).max(1000),
  reference: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
  historical_created_at: z
    .number()
    .int()
    .positive()
    .refine((v) => v < Date.now(), {
      message: "historical_created_at must be in the past",
    }),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  transaction_id: z.string(),
  movement_id: z.string(),
});
