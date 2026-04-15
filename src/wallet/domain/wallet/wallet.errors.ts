import { AppError } from "../../../utils/kernel/appError.js";

export const ErrWalletNotFound = (walletId: string) =>
  AppError.notFound("WALLET_NOT_FOUND", `wallet ${walletId} not found`);

export const ErrWalletNotActive = (walletId: string) =>
  AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${walletId} is not active`);

export const ErrWalletClosed = (walletId: string) =>
  AppError.domainRule("WALLET_CLOSED", `wallet ${walletId} is closed`);

export const ErrWalletAlreadyExists = () =>
  AppError.conflict(
    "WALLET_ALREADY_EXISTS",
    "wallet already exists for this owner/platform/currency",
  );

export const ErrVersionConflict = () =>
  AppError.conflict(
    "VERSION_CONFLICT",
    "wallet was modified by another request; retry with same idempotency key",
  );

export const ErrInsufficientFunds = (walletId: string) =>
  AppError.domainRule("INSUFFICIENT_FUNDS", `wallet ${walletId} has insufficient available funds`);

export const ErrInvalidAmount = () =>
  AppError.validation("INVALID_AMOUNT", "amount must be positive");

export const ErrInvalidCurrency = (code: string) =>
  AppError.validation("INVALID_CURRENCY", `invalid currency code: ${code}`);

export const ErrUnsupportedCurrency = (code: string) =>
  AppError.validation("UNSUPPORTED_CURRENCY", `unsupported currency: ${code}`);

export const ErrCannotFreezeSystemWallet = () =>
  AppError.domainRule("CANNOT_FREEZE_SYSTEM_WALLET", "system wallets cannot be frozen");

export const ErrCannotCloseSystemWallet = () =>
  AppError.domainRule("CANNOT_CLOSE_SYSTEM_WALLET", "system wallets cannot be closed");

export const ErrCurrencyMismatch = () =>
  AppError.domainRule("CURRENCY_MISMATCH", "source and target wallets must have the same currency");

export const ErrSameWallet = () =>
  AppError.validation("SAME_WALLET", "source and target wallets must be different");

export const ErrSystemWalletNotFound = (platformId: string, currencyCode: string) =>
  AppError.internal(
    "SYSTEM_WALLET_NOT_FOUND",
    `system wallet not found for platform ${platformId} / currency ${currencyCode}`,
  );
