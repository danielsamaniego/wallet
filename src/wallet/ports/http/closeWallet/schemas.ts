import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  status: z.literal("closed"),
});
