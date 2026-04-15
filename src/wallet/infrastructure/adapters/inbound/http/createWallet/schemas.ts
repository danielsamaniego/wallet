import { z } from "zod";
import { isSupportedCurrency } from "../../../../../../utils/kernel/currency.js";

// ── Request ─────────────────────────────────────────────────────────────────

export const BodySchema = z.object({
  owner_id: z.string().min(1).max(255),
  currency_code: z
    .string()
    .regex(/^[A-Z]{3}$/, "currency_code must be 3 uppercase letters")
    .refine(isSupportedCurrency, "unsupported currency code"),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  wallet_id: z.string(),
});
