import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const OperationSchema = z
  .object({
    wallet_id: z.string().min(1).max(255),
    type: z.enum(["deposit", "withdraw", "charge", "adjust"]),
    // Signed for `adjust` (positive = credit, negative = debit); a positive
    // magnitude for deposit/withdraw/charge (enforced below).
    amount_minor: z.number().int(),
    reason: z.string().max(500).optional(),
    // Per-operation metadata, merged over the batch-level `metadata` (operation
    // keys win) onto this operation's transaction.
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((op, ctx) => {
    if (op.type === "adjust") {
      if (op.amount_minor === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["amount_minor"],
          message: "adjust amount must not be zero",
        });
      }
      if (!op.reason || op.reason.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "adjust requires a reason" });
      }
    } else if (op.amount_minor <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["amount_minor"],
        message: "amount must be positive",
      });
    }
  });

export const BodySchema = z.object({
  operations: z.array(OperationSchema).min(2).max(50),
  // When true, apply operations in the exact request order instead of the
  // default deterministic order (credits → fund-requiring debits → adjusts).
  preserve_operation_order: z.boolean().optional(),
  reference: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  operations: z.array(
    z.object({
      movement_id: z.string(),
      transaction_id: z.string(),
    }),
  ),
});
