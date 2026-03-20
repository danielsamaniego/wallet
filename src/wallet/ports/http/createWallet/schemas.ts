import { z } from "zod";

export const BodySchema = z.object({
  owner_id: z.string().min(1).max(255),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "currency_code must be 3 uppercase letters"),
});
