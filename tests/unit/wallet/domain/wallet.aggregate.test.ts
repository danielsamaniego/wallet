import { describe, it, expect } from "vitest";
import { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const NOW = 1700000000000;
const LATER = NOW + 1000;

// Helpers: pass shardIndex=0 by default (user wallets); system helper uses 0 too (shard 0).
const activeWallet = (balance = 0n, id = "w-1") =>
  Wallet.reconstruct(id, "owner-1", "platform-1", "USD", balance, "active", 1, false, 0, NOW, NOW);

const systemWallet = (balance = 0n) =>
  Wallet.reconstruct("sys-1", "SYSTEM", "platform-1", "USD", balance, "active", 1, true, 0, NOW, NOW);

const frozenWallet = (balance = 0n) =>
  Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", balance, "frozen", 1, false, 0, NOW, NOW);

const closedWallet = () =>
  Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", 0n, "closed", 1, false, 0, NOW, NOW);

describe("Wallet Aggregate", () => {
  // ── create ───────────────────────────────────────────────────────────
  describe("create", () => {
    describe("Given valid parameters", () => {
      describe("When creating a new wallet", () => {
        it("Then creates with status active and version 1", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", NOW);
          expect(w.status).toBe("active");
          expect(w.version).toBe(1);
          expect(w.cachedBalanceMinor).toBe(0n);
        });

        it("Then sets all identity fields correctly", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", NOW);
          expect(w.id).toBe("w-1");
          expect(w.ownerId).toBe("owner-1");
          expect(w.platformId).toBe("plat-1");
          expect(w.isSystem).toBe(false);
        });

        it("Then sets createdAt and updatedAt to now", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "USD", NOW);
          expect(w.createdAt).toBe(NOW);
          expect(w.updatedAt).toBe(NOW);
        });
      });
    });

    describe("Given a lowercase currency code", () => {
      describe("When creating a wallet", () => {
        it("Then uppercases the currency code", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "usd", NOW);
          expect(w.currencyCode).toBe("USD");
        });
      });
    });

    describe("Given a mixed-case currency code", () => {
      describe("When creating a wallet", () => {
        it("Then uppercases the currency code", () => {
          const w = Wallet.create("w-1", "owner-1", "plat-1", "eUr", NOW);
          expect(w.currencyCode).toBe("EUR");
        });
      });
    });

    describe("Given a user wallet", () => {
      describe("When created", () => {
        it("Then shardIndex is 0 and isSystem is false", () => {
          const w = Wallet.create("u-1", "alice", "plat-1", "USD", NOW);
          expect(w.shardIndex).toBe(0);
          expect(w.isSystem).toBe(false);
        });
      });
    });

    describe("Given an invalid currency code (2 chars)", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY validation error", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "US", NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given an invalid currency code (4 chars)", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "USDX", NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given a numeric currency code", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "123", NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given an empty currency code", () => {
      describe("When creating a wallet", () => {
        it("Then throws INVALID_CURRENCY", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "", NOW))
            .toThrowAppError(ErrorKind.Validation, "INVALID_CURRENCY");
        });
      });
    });

    describe("Given a valid-format but unsupported currency code 'JPY'", () => {
      describe("When creating a wallet", () => {
        it("Then throws UNSUPPORTED_CURRENCY validation error", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "JPY", NOW))
            .toThrowAppError(ErrorKind.Validation, "UNSUPPORTED_CURRENCY");
        });
      });
    });

    describe("Given a valid-format but unsupported currency code 'GBP'", () => {
      describe("When creating a wallet", () => {
        it("Then throws UNSUPPORTED_CURRENCY validation error", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "GBP", NOW))
            .toThrowAppError(ErrorKind.Validation, "UNSUPPORTED_CURRENCY");
        });
      });
    });

    describe("Given a valid-format but unsupported currency code 'CHF'", () => {
      describe("When creating a wallet", () => {
        it("Then throws UNSUPPORTED_CURRENCY validation error", () => {
          expect(() => Wallet.create("w-1", "o-1", "p-1", "CHF", NOW))
            .toThrowAppError(ErrorKind.Validation, "UNSUPPORTED_CURRENCY");
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
          expect(w.cachedBalanceMinor).toBe(1500n);
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
          expect(w.cachedBalanceMinor).toBe(1001n);
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
          expect(w.cachedBalanceMinor).toBe(500n);
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
          expect(w.cachedBalanceMinor).toBe(0n);
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
          expect(w.cachedBalanceMinor).toBe(-4000n);
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

  // ── adjust ───────────────────────────────────────────────────────────
  describe("adjust", () => {
    describe("Given an active wallet with balance 1000 cents", () => {
      describe("When adjusting +500 cents (positive)", () => {
        it("Then balance becomes 1500 cents", () => {
          const w = activeWallet(1000n);
          w.adjust(500n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(1500n);
        });

        it("Then version increments", () => {
          const w = activeWallet(1000n);
          w.adjust(500n, 1000n, false, LATER);
          expect(w.version).toBe(2);
        });

        it("Then updatedAt changes", () => {
          const w = activeWallet(1000n);
          w.adjust(500n, 1000n, false, LATER);
          expect(w.updatedAt).toBe(LATER);
        });
      });

      describe("When adjusting -500 cents (negative) with available balance 1000", () => {
        it("Then balance becomes 500 cents", () => {
          const w = activeWallet(1000n);
          w.adjust(-500n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(500n);
        });
      });

      describe("When adjusting -1000 cents (exact available balance)", () => {
        it("Then balance becomes 0", () => {
          const w = activeWallet(1000n);
          w.adjust(-1000n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(0n);
        });
      });

      describe("When adjusting -1500 cents (more than available)", () => {
        it("Then throws INSUFFICIENT_FUNDS", () => {
          const w = activeWallet(1000n);
          expect(() => w.adjust(-1500n, 1000n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When adjusting 0 cents", () => {
        it("Then throws INVALID_AMOUNT", () => {
          const w = activeWallet(1000n);
          expect(() => w.adjust(0n, 1000n, false, LATER))
            .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");
        });
      });
    });

    describe("Given a frozen wallet with balance 1000 cents", () => {
      describe("When adjusting +500 cents (positive)", () => {
        it("Then allows adjustment (admin operation)", () => {
          const w = frozenWallet(1000n);
          w.adjust(500n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(1500n);
        });
      });

      describe("When adjusting -500 cents (negative)", () => {
        it("Then allows adjustment (admin operation)", () => {
          const w = frozenWallet(1000n);
          w.adjust(-500n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(500n);
        });
      });
    });

    describe("Given a closed wallet", () => {
      describe("When adjusting", () => {
        it("Then throws WALLET_CLOSED", () => {
          const w = closedWallet();
          expect(() => w.adjust(100n, 0n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "WALLET_CLOSED");
        });
      });
    });

    describe("Given a system wallet", () => {
      describe("When adjusting negative more than balance (system bypasses funds check)", () => {
        it("Then allows negative balance", () => {
          const w = systemWallet(1000n);
          w.adjust(-5000n, 1000n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(-4000n);
        });
      });
    });

    describe("Given a non-system wallet and allowNegativeBalance=true", () => {
      describe("When adjusting negative beyond cached balance with no active holds", () => {
        it("Then allows negative balance", () => {
          const w = activeWallet(1000n);
          // available = cached = 1000 (no holds)
          w.adjust(-1500n, 1000n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(-500n);
        });
      });

      describe("When adjusting to exactly zero from positive balance with no active holds", () => {
        it("Then balance becomes zero", () => {
          const w = activeWallet(1000n);
          w.adjust(-1000n, 1000n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(0n);
        });
      });

      describe("When adjusting positive with active holds", () => {
        it("Then allows the adjustment (positive never checks holds)", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — positive adjust is unaffected by holds
          w.adjust(500n, 200n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(1500n);
        });
      });

      describe("When adjusting negative that stays above active holds", () => {
        it("Then allows the adjustment", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — adjust -200 leaves balance=800 >= holds
          w.adjust(-200n, 200n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(800n);
        });
      });

      describe("When adjusting negative exactly equal to available balance (holds exist)", () => {
        it("Then allows the adjustment and available balance becomes zero", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — adjust -200 leaves balance=800 = holds exactly
          w.adjust(-200n, 200n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(800n); // 800 == holds (available=0)
        });
      });

      describe("When adjusting negative by 1 cent with available=0 and active holds", () => {
        it("Then throws ADJUST_WOULD_BREAK_ACTIVE_HOLDS (boundary: no room at all)", () => {
          const w = activeWallet(800n);
          // cached=800, holds=800, available=0 — even -1 breaks the hold
          expect(() => w.adjust(-1n, 0n, true, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "ADJUST_WOULD_BREAK_ACTIVE_HOLDS");
        });
      });

      describe("When adjusting negative that would go below active holds", () => {
        it("Then throws ADJUST_WOULD_BREAK_ACTIVE_HOLDS", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — adjust -500 would break holds
          expect(() => w.adjust(-500n, 200n, true, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "ADJUST_WOULD_BREAK_ACTIVE_HOLDS");
        });
      });

      describe("When already at negative balance with no active holds and adjusting further negative", () => {
        it("Then allows going more negative", () => {
          const w = activeWallet(-500n);
          // cached=-500, available=-500 (no holds), adjust -100
          w.adjust(-100n, -500n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(-600n);
        });
      });

      describe("When adjusting by -1 cent with available=0 and no active holds", () => {
        it("Then allows going to -1 (no holds to break)", () => {
          const w = activeWallet(0n);
          // cached=0, available=0, holds=0 — no holds, going negative is fine
          w.adjust(-1n, 0n, true, LATER);
          expect(w.cachedBalanceMinor).toBe(-1n);
        });
      });
    });

    describe("Given a non-system wallet and allowNegativeBalance=false", () => {
      describe("When adjusting negative beyond available balance", () => {
        it("Then throws INSUFFICIENT_FUNDS", () => {
          const w = activeWallet(500n);
          expect(() => w.adjust(-1000n, 500n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When adjusting negative by 1 cent with available=0 and no holds", () => {
        it("Then throws INSUFFICIENT_FUNDS (boundary: minimum overdraft)", () => {
          const w = activeWallet(0n);
          expect(() => w.adjust(-1n, 0n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When adjusting negative beyond available balance due to active holds", () => {
        it("Then throws INSUFFICIENT_FUNDS (same error regardless of holds)", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — adjust -500 fails same as before
          expect(() => w.adjust(-500n, 200n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When adjusting negative by 1 cent with available=0 due to active holds", () => {
        it("Then throws INSUFFICIENT_FUNDS (boundary with holds, flag=false)", () => {
          const w = activeWallet(800n);
          // cached=800, holds=800, available=0
          expect(() => w.adjust(-1n, 0n, false, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "INSUFFICIENT_FUNDS");
        });
      });

      describe("When adjusting positive with active holds", () => {
        it("Then allows the adjustment (positive never blocked)", () => {
          const w = activeWallet(1000n);
          // cached=1000, holds=800, available=200 — positive unaffected
          w.adjust(500n, 200n, false, LATER);
          expect(w.cachedBalanceMinor).toBe(1500n);
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
          expect(w.cachedBalanceMinor).toBe(1000n);
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
        it("Then all getters return the provided values including shardIndex", () => {
          const w = Wallet.reconstruct(
            "r-id", "r-owner", "r-plat", "EUR", 999n, "frozen", 42, true, 7, 111, 222,
          );
          expect(w.id).toBe("r-id");
          expect(w.ownerId).toBe("r-owner");
          expect(w.platformId).toBe("r-plat");
          expect(w.currencyCode).toBe("EUR");
          expect(w.cachedBalanceMinor).toBe(999n);
          expect(w.status).toBe("frozen");
          expect(w.version).toBe(42);
          expect(w.isSystem).toBe(true);
          expect(w.shardIndex).toBe(7);
          expect(w.createdAt).toBe(111);
          expect(w.updatedAt).toBe(222);
        });
      });
    });
  });
});
