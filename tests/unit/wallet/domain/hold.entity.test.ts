import { describe, it, expect } from "vitest";
import { Hold } from "@/wallet/domain/hold/hold.entity.js";
import { ErrorKind } from "@/utils/kernel/appError.js";

const NOW = 1700000000000;
const LATER = NOW + 1000;
const PAST = NOW - 1000;
const FUTURE = NOW + 60_000;

const activeHold = (overrides?: Partial<Parameters<typeof Hold.reconstruct>[0]>) =>
  Hold.reconstruct({
    id: "hold-1",
    walletId: "wallet-1",
    amountMinor: 1000n,
    status: "active",
    reference: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

describe("Hold Entity", () => {
  // ── create ───────────────────────────────────────────────────────────
  describe("create", () => {
    describe("Given valid parameters", () => {
      describe("When creating a hold", () => {
        it("Then creates with status active", () => {
          const h = Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 500n, reference: null, expiresAt: FUTURE, now: NOW });
          expect(h.status).toBe("active");
          expect(h.amountMinor).toBe(500n);
        });

        it("Then sets all fields correctly", () => {
          const h = Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 500n, reference: "ref-1", expiresAt: FUTURE, now: NOW });
          expect(h.id).toBe("h-1");
          expect(h.walletId).toBe("w-1");
          expect(h.reference).toBe("ref-1");
          expect(h.expiresAt).toBe(FUTURE);
          expect(h.createdAt).toBe(NOW);
          expect(h.updatedAt).toBe(NOW);
        });
      });
    });

    describe("Given null expiresAt", () => {
      describe("When creating a hold", () => {
        it("Then creates successfully with null expiresAt", () => {
          const h = Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 500n, reference: null, expiresAt: null, now: NOW });
          expect(h.expiresAt).toBeNull();
          expect(h.status).toBe("active");
        });
      });
    });

    describe("Given zero amount", () => {
      describe("When creating a hold", () => {
        it("Then throws INVALID_AMOUNT", () => {
          expect(() => Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 0n, reference: null, expiresAt: null, now: NOW }))
            .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });
    });

    describe("Given negative amount", () => {
      describe("When creating a hold", () => {
        it("Then throws INVALID_AMOUNT", () => {
          expect(() => Hold.create({ id: "h-1", walletId: "w-1", amountMinor: -100n, reference: null, expiresAt: null, now: NOW }))
            .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });
    });

    describe("Given expiresAt in the past", () => {
      describe("When creating a hold", () => {
        it("Then throws HOLD_EXPIRES_IN_PAST", () => {
          expect(() => Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 100n, reference: null, expiresAt: PAST, now: NOW }))
            .toThrowAppError(ErrorKind.Validation, "HOLD_EXPIRES_IN_PAST");
        });
      });
    });

    describe("Given expiresAt exactly equal to now (boundary)", () => {
      describe("When creating a hold", () => {
        it("Then throws HOLD_EXPIRES_IN_PAST", () => {
          expect(() => Hold.create({ id: "h-1", walletId: "w-1", amountMinor: 100n, reference: null, expiresAt: NOW, now: NOW }))
            .toThrowAppError(ErrorKind.Validation, "HOLD_EXPIRES_IN_PAST");
        });
      });
    });
  });

  // ── capture ──────────────────────────────────────────────────────────
  describe("capture", () => {
    describe("Given an active hold", () => {
      describe("When capturing", () => {
        it("Then status becomes captured", () => {
          const h = activeHold();
          h.capture(LATER);
          expect(h.status).toBe("captured");
        });

        it("Then updatedAt changes", () => {
          const h = activeHold();
          h.capture(LATER);
          expect(h.updatedAt).toBe(LATER);
        });
      });
    });

    describe("Given a captured hold", () => {
      describe("When capturing again", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "captured" });
          expect(() => h.capture(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given a voided hold", () => {
      describe("When capturing", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "voided" });
          expect(() => h.capture(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given an expired hold", () => {
      describe("When capturing", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "expired" });
          expect(() => h.capture(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });
  });

  // ── void_ ────────────────────────────────────────────────────────────
  describe("void_", () => {
    describe("Given an active hold", () => {
      describe("When voiding", () => {
        it("Then status becomes voided", () => {
          const h = activeHold();
          h.void_(LATER);
          expect(h.status).toBe("voided");
        });

        it("Then updatedAt changes", () => {
          const h = activeHold();
          h.void_(LATER);
          expect(h.updatedAt).toBe(LATER);
        });
      });
    });

    describe("Given a captured hold", () => {
      describe("When voiding", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "captured" });
          expect(() => h.void_(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given a voided hold", () => {
      describe("When voiding again", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "voided" });
          expect(() => h.void_(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given an expired hold", () => {
      describe("When voiding", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "expired" });
          expect(() => h.void_(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });
  });

  // ── expire ───────────────────────────────────────────────────────────
  describe("expire", () => {
    describe("Given an active hold", () => {
      describe("When expiring", () => {
        it("Then status becomes expired", () => {
          const h = activeHold();
          h.expire(LATER);
          expect(h.status).toBe("expired");
        });

        it("Then updatedAt changes", () => {
          const h = activeHold();
          h.expire(LATER);
          expect(h.updatedAt).toBe(LATER);
        });
      });
    });

    describe("Given a captured hold", () => {
      describe("When expiring", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "captured" });
          expect(() => h.expire(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given a voided hold", () => {
      describe("When expiring", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "voided" });
          expect(() => h.expire(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });

    describe("Given an already expired hold", () => {
      describe("When expiring again", () => {
        it("Then throws HOLD_NOT_ACTIVE", () => {
          const h = activeHold({ status: "expired" });
          expect(() => h.expire(LATER)).toThrowAppError(ErrorKind.DomainRule, "HOLD_NOT_ACTIVE");
        });
      });
    });
  });

  // ── isExpired ────────────────────────────────────────────────────────
  describe("isExpired", () => {
    describe("Given an active hold with expiresAt in the past", () => {
      describe("When checking isExpired", () => {
        it("Then returns true", () => {
          const h = activeHold({ expiresAt: NOW - 1000 });
          expect(h.isExpired(NOW)).toBe(true);
        });
      });
    });

    describe("Given an active hold with expiresAt exactly now (boundary >=)", () => {
      describe("When checking isExpired", () => {
        it("Then returns true", () => {
          const h = activeHold({ expiresAt: NOW });
          expect(h.isExpired(NOW)).toBe(true);
        });
      });
    });

    describe("Given an active hold with expiresAt in the future", () => {
      describe("When checking isExpired", () => {
        it("Then returns false", () => {
          const h = activeHold({ expiresAt: FUTURE });
          expect(h.isExpired(NOW)).toBe(false);
        });
      });
    });

    describe("Given an active hold with null expiresAt (never expires)", () => {
      describe("When checking isExpired", () => {
        it("Then returns false", () => {
          const h = activeHold({ expiresAt: null });
          expect(h.isExpired(NOW)).toBe(false);
        });
      });
    });

    describe("Given a captured hold with past expiresAt", () => {
      describe("When checking isExpired", () => {
        it("Then returns false (not active)", () => {
          const h = activeHold({ status: "captured", expiresAt: PAST });
          expect(h.isExpired(NOW)).toBe(false);
        });
      });
    });

    describe("Given a voided hold with past expiresAt", () => {
      describe("When checking isExpired", () => {
        it("Then returns false (not active)", () => {
          const h = activeHold({ status: "voided", expiresAt: PAST });
          expect(h.isExpired(NOW)).toBe(false);
        });
      });
    });

    describe("Given an expired hold with past expiresAt", () => {
      describe("When checking isExpired", () => {
        it("Then returns false (already expired, not active)", () => {
          const h = activeHold({ status: "expired", expiresAt: PAST });
          expect(h.isExpired(NOW)).toBe(false);
        });
      });
    });
  });

  // ── reconstruct ──────────────────────────────────────────────────────
  describe("reconstruct", () => {
    describe("Given arbitrary field values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const h = Hold.reconstruct({
            id: "r-h",
            walletId: "r-w",
            amountMinor: 999n,
            status: "voided",
            reference: "ref-x",
            expiresAt: 12345,
            createdAt: 111,
            updatedAt: 222,
          });
          expect(h.id).toBe("r-h");
          expect(h.walletId).toBe("r-w");
          expect(h.amountMinor).toBe(999n);
          expect(h.status).toBe("voided");
          expect(h.reference).toBe("ref-x");
          expect(h.expiresAt).toBe(12345);
          expect(h.createdAt).toBe(111);
          expect(h.updatedAt).toBe(222);
        });
      });
    });
  });
});
