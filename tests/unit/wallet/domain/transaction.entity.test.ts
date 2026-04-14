import { describe, it, expect } from "vitest";
import { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";

const NOW = 1700000000000;

describe("Transaction Entity", () => {
  describe("create", () => {
    describe("Given all required parameters", () => {
      describe("When creating a deposit transaction", () => {
        it("Then creates with correct type and all fields", () => {
          const t = Transaction.create({
            id: "tx-1",
            walletId: "w-1",
            counterpartWalletId: "sys-1",
            type: "deposit",
            amountCents: 1000n,
            status: "completed",
            idempotencyKey: "idem-1",
            reference: "ref-1",
            metadata: { source: "api" },
            holdId: null,
            movementId: "mov-1",
            createdAt: NOW,
          });
          expect(t.id).toBe("tx-1");
          expect(t.walletId).toBe("w-1");
          expect(t.counterpartWalletId).toBe("sys-1");
          expect(t.type).toBe("deposit");
          expect(t.amountCents).toBe(1000n);
          expect(t.status).toBe("completed");
          expect(t.idempotencyKey).toBe("idem-1");
          expect(t.reference).toBe("ref-1");
          expect(t.metadata).toEqual({ source: "api" });
          expect(t.holdId).toBeNull();
          expect(t.movementId).toBe("mov-1");
          expect(t.createdAt).toBe(NOW);
        });
      });
    });

    describe.each([
      "deposit", "withdrawal", "transfer_in", "transfer_out", "hold_capture",
    ] as const)("Given type %s", (type) => {
      describe("When creating", () => {
        it("Then type is set correctly", () => {
          const t = Transaction.create({
            id: "tx-1", walletId: "w-1", counterpartWalletId: null, type,
            amountCents: 100n, status: "completed", idempotencyKey: null,
            reference: null, metadata: null, holdId: null, movementId: "mov-1", createdAt: NOW,
          });
          expect(t.type).toBe(type);
        });
      });
    });

    describe.each(["completed", "failed", "reversed"] as const)("Given status %s", (status) => {
      describe("When creating", () => {
        it("Then status is set correctly", () => {
          const t = Transaction.create({
            id: "tx-1", walletId: "w-1", counterpartWalletId: null, type: "deposit",
            amountCents: 100n, status, idempotencyKey: null,
            reference: null, metadata: null, holdId: null, movementId: "mov-1", createdAt: NOW,
          });
          expect(t.status).toBe(status);
        });
      });
    });

    describe("Given nullable fields as null", () => {
      describe("When creating", () => {
        it("Then nullable getters return null", () => {
          const t = Transaction.create({
            id: "tx-1", walletId: "w-1", counterpartWalletId: null, type: "deposit",
            amountCents: 100n, status: "completed", idempotencyKey: null,
            reference: null, metadata: null, holdId: null, movementId: "mov-1", createdAt: NOW,
          });
          expect(t.counterpartWalletId).toBeNull();
          expect(t.idempotencyKey).toBeNull();
          expect(t.reference).toBeNull();
          expect(t.metadata).toBeNull();
          expect(t.holdId).toBeNull();
        });
      });
    });

    describe("Given a hold_capture with holdId", () => {
      describe("When creating", () => {
        it("Then holdId is set", () => {
          const t = Transaction.create({
            id: "tx-1", walletId: "w-1", counterpartWalletId: "sys-1", type: "hold_capture",
            amountCents: 500n, status: "completed", idempotencyKey: null,
            reference: null, metadata: null, holdId: "hold-1", movementId: "mov-1", createdAt: NOW,
          });
          expect(t.holdId).toBe("hold-1");
          expect(t.type).toBe("hold_capture");
        });
      });
    });
  });

  // ── reconstruct ──────────────────────────────────────────────────────
  describe("reconstruct", () => {
    describe("Given arbitrary values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const t = Transaction.reconstruct({
            id: "tx-r", walletId: "w-r", counterpartWalletId: "cp-r", type: "transfer_in",
            amountCents: 777n, status: "reversed", idempotencyKey: "ik-r",
            reference: "ref-r", metadata: { key: "val" }, holdId: "h-r", movementId: "mov-r", createdAt: 999,
          });
          expect(t.id).toBe("tx-r");
          expect(t.type).toBe("transfer_in");
          expect(t.status).toBe("reversed");
          expect(t.counterpartWalletId).toBe("cp-r");
          expect(t.idempotencyKey).toBe("ik-r");
          expect(t.reference).toBe("ref-r");
          expect(t.metadata).toEqual({ key: "val" });
          expect(t.holdId).toBe("h-r");
        });
      });
    });
  });
});
