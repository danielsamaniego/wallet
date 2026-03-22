import { AppError } from "../../../utils/kernel/appError.js";

export const ErrHoldNotFound = (holdId: string) =>
  AppError.notFound("HOLD_NOT_FOUND", `hold ${holdId} not found`);

export const ErrHoldNotActive = (holdId: string) =>
  AppError.domainRule("HOLD_NOT_ACTIVE", `hold ${holdId} is not active`);

export const ErrHoldExpired = (holdId: string) =>
  AppError.domainRule("HOLD_EXPIRED", `hold ${holdId} has expired`);
