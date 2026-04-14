import { describe, it, expect } from "vitest";
import { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const NOW = 1700000000000;
const LATER = NOW + 1000;

// Helper: creates a fresh active wallet with given balance via reconstruct
const activeWallet = (balance = 0n, id = "w-1") =>
  Wallet.reconstruct(id, "owner-1", "platform-1", "USD", balance, "active", 1, false, NOW, NOW);

const systemWallet = (balance = 0n) =>
  Wallet.reconstruct("sys-1", "SYSTEM", "platform-1", "USD", balance, "active", 1, true, NOW, NOW);

const frozenWallet = (balance = 0n) =>
  Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", balance, "frozen", 1, false, NOW, NOW);

const closedWallet = () =>
  Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", 0n, "closed", 1, false, NOW, NOW);

describe("Wallet Aggregate", () => {
  // ── create ───────────────────────────────────────────────────────────
  describe("create", () => {
    describe("Given valid parameters", () => {
      describe("When creating a new wallet", () => {
        it("Then creates with status active and version 1", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", false, NOW);
          expect(w.status).toBe("active");
          expect(w.version).toBe(1);
          expect(w.cachedBalanceCents).toBe(0n);
        });

        it("Then sets all identity fields correctly", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", false, NOW);
          expect(w.id).toBe("w-1");
          expect(w.ownerId).toBe("owner-1");
          expect(w.platformId).toBe("plat-1");
          expect(w.isSystem).toBe(false);
        });

        it("Then sets createdAt and updatedAt to now", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", false, NOW);
          expect(w.createdAt).toBe(NOW);
          expect(w.updatedAt).toBe(NOW);
        });
      });
    });

    describe("Given a lowercase currency code", () => {
      describe("When creating a wallet", () => {
        it("Then uppercases the currency code", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "usd", false, NOW);
          expect(w.currencyCode).toBe("USD");
        });
      });
    });

    describe("Given a mixed-case currency code", () => {
      describe("When creating a wallet", () => {
        it("Then uppercases the currency code", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "eUr", false, NOW);
          expect(w.currencyCode).toBe("EUR");
        });
      });
    });

    describe("Given a system wallet flag", () => {
      describe("When creating", () => {
        it("Then isSystem is true", () => {
          const w = Wallet.create("sys-1", "SYSTEM", "plat-1", "USD", true, NOW);
          expect(w.isSystem).toBe(true);
        });
      });
    });

    describe("Given an invalid currency code (2 chars)", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY validation error", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "US", false, NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given an invalid currency code (4 chars)", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "USDX", false, NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given a numeric currency code", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "123", false, NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given an empty currency code", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "", false, NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });
  });

  // ── deposit ──────────────────────────────────────────────────────────
  describe("deposit", () => {
    describe("Given an active wallet with balance 1000 cents", () => {
      describe("When depositing 500 cents", () => {
        it("Then balance becomes 1500 cents", () => {
          const w = activeWallet(1000n);
          w.deposit(500n, LATER);
          expect(w.cachedBalanceCents).toBe(1500n);
        });

        it("Then version increments by 1", () => {
          const w = activeWallet(1000n);
          w.deposit(500n, LATER);
          expect(w.version).toBe(2);
        });

        it("Then updatedAt changes to now", () => {
          const w = activeWallet(1000n);
          w.deposit(500n, LATER);
          expect(w.updatedAt).toBe(LATER);
        });
      });

      describe("When depositing 1 cent (minimum)", () => {
        it("Then balance becomes 1001 cents", () => {
          const w = activeWallet(1000n);
          w.deposit(1n, LATER);
          expect(w.cachedBalanceCents).toBe(1001n);
        });
      });

      describe("When depositing zero", () => {
        it("Then throws INVALID_AMOUNT", () => {
          const w = activeWallet(1000n);
          expect(() => w.deposit(0n, LATER)).toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });

      describe("When depositing a negative amount", () => {
        it("Then throws INVALID_AMOUNT", () => {
          const w = activeWallet(1000n);
          expect(() => w.deposit(-100n, LATER)).toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });
    });

    describe("Given a frozen wallet", () => {
      describe("When depositing", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = frozenWallet(1000n);
          expect(() => w.deposit(100n, LATER)).toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When depositing", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = closedWallet();
          expect(() => w.deposit(100n, LATER)).toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });
  });

  // ── withdraw ─────────────────────────────────────────────────────────
  describe("withdraw", () => {
    describe("Given an active non-system wallet with balance 1000 cents", () => {
      describe("When withdrawing 500 cents with available balance 1000", () => {
        it("Then balance becomes 500 cents", () => {
          const w = activeWallet(1000n);
          w.withdraw(500n, 1000n, LATER);
          expect(w.cachedBalanceCents).toBe(500n);
        });

        it("Then version increments", () => {
          const w = activeWallet(1000n);
          w.withdraw(500n, 1000n, LATER);
          expect(w.version).toBe(2);
        });

        it("Then updatedAt changes", () => {
          const w = activeWallet(1000n);
          w.withdraw(500n, 1000n, LATER);
          expect(w.updatedAt).toBe(LATER);
        });
      });

      describe("When withdrawing exact available balance (boundary)", () => {
        it("Then balance becomes zero", () => {
          const w = activeWallet(1000n);
          w.withdraw(1000n, 1000n, LATER);
          expect(w.cachedBalanceCents).toBe(0n);
        });
      });

      describe("When withdrawing more than available balance", () => {
        it("Then throws INSUFFICIENT_FUNDS", () => {
          const w = activeWallet(1000n);
          expect(() => w.withdraw(1500n, 1000n, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When available balance is less than cached (holds exist)", () => {
        it("Then throws INSUFFICIENT_FUNDS when withdraw > available", () => {
          const w = activeWallet(1000n);
          // available = 700 (300 in holds), trying to withdraw 800
          expect(() => w.withdraw(800n, 700n, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When withdrawing zero", () => {
        it("Then throws INVALID_AMOUNT", () => {
          const w = activeWallet(1000n);
          expect(() => w.withdraw(0n, 1000n, LATER))
            .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });

      describe("When withdrawing a negative amount", () => {
        it("Then throws INVALID_AMOUNT", () => {
          const w = activeWallet(1000n);
          expect(() => w.withdraw(-100n, 1000n, LATER))
            .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });
    });

    describe("Given a system wallet with balance 1000 cents", () => {
      describe("When withdrawing more than balance (system bypasses funds check)", () => {
        it("Then allows negative balance", () => {
          const w = systemWallet(1000n);
          w.withdraw(5000n, 1000n, LATER);
          expect(w.cachedBalanceCents).toBe(-4000n);
        });
      });
    });

    describe("Given a frozen wallet", () => {
      describe("When withdrawing", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = frozenWallet(1000n);
          expect(() => w.withdraw(100n, 1000n, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When withdrawing", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = closedWallet();
          expect(() => w.withdraw(100n, 0n, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });
  });

  // ── freeze ───────────────────────────────────────────────────────────
  describe("freeze", () => {
    describe("Given an active non-system wallet", () => {
      describe("When freezing", () => {
        it("Then status becomes frozen", () => {
          const w = activeWallet();
          w.freeze(LATER);
          expect(w.status).toBe("frozen");
        });

        it("Then version increments", () => {
          const w = activeWallet();
          w.freeze(LATER);
          expect(w.version).toBe(2);
        });
      });
    });

    describe("Given a system wallet", () => {
      describe("When freezing", () => {
        it("Then throws CANNOT_FREEZE_SYSTEM_WALLET", () => {
          const w = systemWallet();
          expect(() => w.freeze(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "CANNOT_FREEZE_SYSTEM_WALLET");
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When freezing", () => {
        it("Then throws WALLET_CLOSED", () => {
          const w = closedWallet();
          expect(() => w.freeze(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_CLOSED");
        });
      });
    });

    describe("Given an already frozen wallet", () => {
      describe("When freezing again", () => {
        it("Then throws WALLET_ALREADY_FROZEN", () => {
          const w = frozenWallet();
          expect(() => w.freeze(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_ALREADY_FROZEN");
        });
      });
    });
  });

  // ── unfreeze ─────────────────────────────────────────────────────────
  describe("unfreeze", () => {
    describe("Given a frozen wallet", () => {
      describe("When unfreezing", () => {
        it("Then status becomes active", () => {
          const w = frozenWallet();
          w.unfreeze(LATER);
          expect(w.status).toBe("active");
        });

        it("Then version increments", () => {
          const w = frozenWallet();
          w.unfreeze(LATER);
          expect(w.version).toBe(2);
        });
      });
    });

    describe("Given an active wallet", () => {
      describe("When unfreezing", () => {
        it("Then throws WALLET_NOT_FROZEN", () => {
          const w = activeWallet();
          expect(() => w.unfreeze(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_FROZEN");
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When unfreezing", () => {
        it("Then throws WALLET_NOT_FROZEN", () => {
          const w = closedWallet();
          expect(() => w.unfreeze(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_FROZEN");
        });
      });
    });
  });

  // ── close ────────────────────────────────────────────────────────────
  describe("close", () => {
    describe("Given an active wallet with zero balance and zero holds", () => {
      describe("When closing", () => {
        it("Then status becomes closed", () => {
          const w = activeWallet(0n);
          w.close(0, LATER);
          expect(w.status).toBe("closed");
        });

        it("Then version increments", () => {
          const w = activeWallet(0n);
          w.close(0, LATER);
          expect(w.version).toBe(2);
        });
      });
    });

    describe("Given a system wallet", () => {
      describe("When closing", () => {
        it("Then throws CANNOT_CLOSE_SYSTEM_WALLET", () => {
          const w = systemWallet();
          expect(() => w.close(0, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "CANNOT_CLOSE_SYSTEM_WALLET");
        });
      });
    });

    describe("Given a wallet with non-zero balance", () => {
      describe("When closing", () => {
        it("Then throws WALLET_BALANCE_NOT_ZERO", () => {
          const w = activeWallet(100n);
          expect(() => w.close(0, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_BALANCE_NOT_ZERO");
        });
      });
    });

    describe("Given a wallet with active holds", () => {
      describe("When closing", () => {
        it("Then throws WALLET_HAS_ACTIVE_HOLDS", () => {
          const w = activeWallet(0n);
          expect(() => w.close(3, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_HAS_ACTIVE_HOLDS");
        });
      });
    });

    describe("Given an already closed wallet", () => {
      describe("When closing again", () => {
        it("Then throws WALLET_CLOSED", () => {
          const w = closedWallet();
          expect(() => w.close(0, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_CLOSED");
        });
      });
    });

    describe("Given a frozen wallet with zero balance and zero holds", () => {
      describe("When closing", () => {
        it("Then status becomes closed (frozen can be closed)", () => {
          const w = frozenWallet(0n);
          w.close(0, LATER);
          expect(w.status).toBe("closed");
        });
      });
    });
  });

  // ── touchForHoldChange ───────────────────────────────────────────────
  describe("touchForHoldChange", () => {
    describe("Given an active wallet", () => {
      describe("When touching for hold change", () => {
        it("Then version increments without changing balance", () => {
          const w = activeWallet(1000n);
          w.touchForHoldChange(LATER);
          expect(w.version).toBe(2);
          expect(w.cachedBalanceCents).toBe(1000n);
        });

        it("Then updatedAt changes", () => {
          const w = activeWallet(1000n);
          w.touchForHoldChange(LATER);
          expect(w.updatedAt).toBe(LATER);
        });
      });
    });

    describe("Given a frozen wallet", () => {
      describe("When touching for hold change", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = frozenWallet();
          expect(() => w.touchForHoldChange(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When touching for hold change", () => {
        it("Then throws WALLET_NOT_ACTIVE", () => {
          const w = closedWallet();
          expect(() => w.touchForHoldChange(LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
        });
      });
    });
  });

  // ── reconstruct ──────────────────────────────────────────────────────
  describe("reconstruct", () => {
    describe("Given arbitrary field values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const w = Wallet.reconstruct(
            "r-id", "r-owner", "r-plat", "EUR", 999n, "frozen", 42, true, 111, 222,
          );
          expect(w.id).toBe("r-id");
          expect(w.ownerId).toBe("r-owner");
          expect(w.platformId).toBe("r-plat");
          expect(w.currencyCode).toBe("EUR");
          expect(w.cachedBalanceCents).toBe(999n);
          expect(w.status).toBe("frozen");
          expect(w.version).toBe(42);
          expect(w.isSystem).toBe(true);
          expect(w.createdAt).toBe(111);
          expect(w.updatedAt).toBe(222);
        });
      });
    });
  });
});
