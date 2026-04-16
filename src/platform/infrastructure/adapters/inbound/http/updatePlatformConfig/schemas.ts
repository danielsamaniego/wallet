import { z } from "zod";

export const BodySchema = z.object({
  allow_negative_balance: z.boolean(),
});

export const ResponseSchema = z.object({
  platform_id: z.string(),
});
