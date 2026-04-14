import { describe, it, expect } from "vitest";
import { ErrorKind } from "@/utils/kernel/appError.js";
import {
  ErrWalletNotFound,
  ErrWalletNotActive,
  ErrWalletClosed,
  ErrWalletAlreadyExists,
  ErrVersionConflict,
  ErrInsufficientFunds,
  ErrInvalidAmount,
  ErrInvalidCurrency,
  ErrCannotFreezeSystemWallet,
  ErrCannotCloseSystemWallet,
  ErrCurrencyMismatch,
  ErrSameWallet,
  ErrSystemWalletNotFound,
} from "@/wallet/domain/wallet/wallet.errors.js";

describe("wallet error factories", () => {
  it("Given a wallet id, When ErrWalletNotFound is called, Then returns NotFound with WALLET_NOT_FOUND code", () => {
    const err = ErrWalletNotFound("w-1");
    expect(err.kind).toBe(ErrorKind.NotFound);
    expect(err.code).toBe("WALLET_NOT_FOUND");
    expect(err.msg).toContain("w-1");
  });

  it("Given a wallet id, When ErrWalletNotActive is called, Then returns DomainRule with WALLET_NOT_ACTIVE code", () => {
    const err = ErrWalletNotActive("w-2");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("WALLET_NOT_ACTIVE");
    expect(err.msg).toContain("w-2");
  });

  it("Given a wallet id, When ErrWalletClosed is called, Then returns DomainRule with WALLET_CLOSED code", () => {
    const err = ErrWalletClosed("w-3");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("WALLET_CLOSED");
    expect(err.msg).toContain("w-3");
  });

  it("When ErrWalletAlreadyExists is called, Then returns Conflict with WALLET_ALREADY_EXISTS code", () => {
    const err = ErrWalletAlreadyExists();
    expect(err.kind).toBe(ErrorKind.Conflict);
    expect(err.code).toBe("WALLET_ALREADY_EXISTS");
  });

  it("When ErrVersionConflict is called, Then returns Conflict with VERSION_CONFLICT code", () => {
    const err = ErrVersionConflict();
    expect(err.kind).toBe(ErrorKind.Conflict);
    expect(err.code).toBe("VERSION_CONFLICT");
  });

  it("Given a wallet id, When ErrInsufficientFunds is called, Then returns DomainRule with INSUFFICIENT_FUNDS code", () => {
    const err = ErrInsufficientFunds("w-4");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("INSUFFICIENT_FUNDS");
    expect(err.msg).toContain("w-4");
  });

  it("When ErrInvalidAmount is called, Then returns Validation with INVALID_AMOUNT code", () => {
    const err = ErrInvalidAmount();
    expect(err.kind).toBe(ErrorKind.Validation);
    expect(err.code).toBe("INVALID_AMOUNT");
  });

  it("Given a currency code, When ErrInvalidCurrency is called, Then returns Validation with INVALID_CURRENCY code", () => {
    const err = ErrInvalidCurrency("XYZ");
    expect(err.kind).toBe(ErrorKind.Validation);
    expect(err.code).toBe("INVALID_CURRENCY");
    expect(err.msg).toContain("XYZ");
  });

  it("When ErrCannotFreezeSystemWallet is called, Then returns DomainRule with CANNOT_FREEZE_SYSTEM_WALLET code", () => {
    const err = ErrCannotFreezeSystemWallet();
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("CANNOT_FREEZE_SYSTEM_WALLET");
  });

  it("When ErrCannotCloseSystemWallet is called, Then returns DomainRule with CANNOT_CLOSE_SYSTEM_WALLET code", () => {
    const err = ErrCannotCloseSystemWallet();
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("CANNOT_CLOSE_SYSTEM_WALLET");
  });

  it("When ErrCurrencyMismatch is called, Then returns DomainRule with CURRENCY_MISMATCH code", () => {
    const err = ErrCurrencyMismatch();
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("CURRENCY_MISMATCH");
  });

  it("When ErrSameWallet is called, Then returns Validation with SAME_WALLET code", () => {
    const err = ErrSameWallet();
    expect(err.kind).toBe(ErrorKind.Validation);
    expect(err.code).toBe("SAME_WALLET");
  });

  it("Given platform and currency, When ErrSystemWalletNotFound is called, Then returns Internal with SYSTEM_WALLET_NOT_FOUND code", () => {
    const err = ErrSystemWalletNotFound("p-1", "USD");
    expect(err.kind).toBe(ErrorKind.Internal);
    expect(err.code).toBe("SYSTEM_WALLET_NOT_FOUND");
    expect(err.msg).toContain("p-1");
    expect(err.msg).toContain("USD");
  });
});
