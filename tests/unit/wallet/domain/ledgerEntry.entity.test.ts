import { describe, it, expect } from "vitest";
import { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import { ErrorKind } from "@/utils/kernel/appError.js";

const NOW = 1700000000000;

const baseParams = {
  id: "le-1",
  transactionId: "tx-1",
  walletId: "w-1",
  balanceAfterMinor: 1000n,
  movementId: "mov-1",
  createdAt: NOW,
};

describe("LedgerEntry Entity", () => {
  // ── CREDIT ───────────────────────────────────────────────────────────
  describe("create CREDIT entry", () => {
    describe("Given a positive amount", () => {
      describe("When creating a CREDIT entry", () => {
        it("Then creates successfully", () => {
          const e = LedgerEntry.create({ ...baseParams, entryType: "CREDIT", amountMinor: 500n });
          expect(e.entryType).toBe("CREDIT");
          expect(e.amountMinor).toBe(500n);
        });
      });
    });

    describe("Given zero amount", () => {
      describe("When creating a CREDIT entry", () => {
        it("Then creates successfully (zero is non-negative)", () => {
          const e = LedgerEntry.create({ ...baseParams, entryType: "CREDIT", amountMinor: 0n });
          expect(e.amountMinor).toBe(0n);
        });
      });
    });

    describe("Given a negative amount", () => {
      describe("When creating a CREDIT entry", () => {
        it("Then throws INVALID_LEDGER_SIGN", () => {
          expect(() => LedgerEntry.create({ ...baseParams, entryType: "CREDIT", amountMinor: -100n }))
            .toThrowAppError(ErrorKind.Validation, "INVALID_LEDGER_SIGN");
        });
      });
    });
  });

  // ── DEBIT ────────────────────────────────────────────────────────────
  describe("create DEBIT entry", () => {
    describe("Given a negative amount", () => {
      describe("When creating a DEBIT entry", () => {
        it("Then creates successfully", () => {
          const e = LedgerEntry.create({ ...baseParams, entryType: "DEBIT", amountMinor: -500n });
          expect(e.entryType).toBe("DEBIT");
          expect(e.amountMinor).toBe(-500n);
        });
      });
    });

    describe("Given zero amount", () => {
      describe("When creating a DEBIT entry", () => {
        it("Then creates successfully (zero is non-positive)", () => {
          const e = LedgerEntry.create({ ...baseParams, entryType: "DEBIT", amountMinor: 0n });
          expect(e.amountMinor).toBe(0n);
        });
      });
    });

    describe("Given a positive amount", () => {
      describe("When creating a DEBIT entry", () => {
        it("Then throws INVALID_LEDGER_SIGN", () => {
          expect(() => LedgerEntry.create({ ...baseParams, entryType: "DEBIT", amountMinor: 100n }))
            .toThrowAppError(ErrorKind.Validation, "INVALID_LEDGER_SIGN");
        });
      });
    });
  });

  // ── reconstruct ──────────────────────────────────────────────────────
  describe("reconstruct", () => {
    describe("Given arbitrary values including invalid sign", () => {
      describe("When reconstructing", () => {
        it("Then bypasses sign validation (for DB rebuild)", () => {
          // DEBIT with positive amount would throw in create, but reconstruct allows it
          const e = LedgerEntry.reconstruct({ ...baseParams, entryType: "DEBIT", amountMinor: 100n });
          expect(e.entryType).toBe("DEBIT");
          expect(e.amountMinor).toBe(100n);
        });
      });
    });

    describe("Given valid values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const e = LedgerEntry.reconstruct({
            id: "le-r",
            transactionId: "tx-r",
            walletId: "w-r",
            entryType: "CREDIT",
            amountMinor: 777n,
            balanceAfterMinor: 1777n,
            movementId: "mov-r",
            createdAt: 999,
          });
          expect(e.id).toBe("le-r");
          expect(e.transactionId).toBe("tx-r");
          expect(e.walletId).toBe("w-r");
          expect(e.entryType).toBe("CREDIT");
          expect(e.amountMinor).toBe(777n);
          expect(e.balanceAfterMinor).toBe(1777n);
          expect(e.movementId).toBe("mov-r");
          expect(e.createdAt).toBe(999);
        });
      });
    });
  });
});
