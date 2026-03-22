import { AppError } from "../../../utils/kernel/appError.js";

export const ErrPlatformNotFound = (platformId: string) =>
  AppError.notFound("PLATFORM_NOT_FOUND", `platform ${platformId} not found`);

export const ErrPlatformAlreadyExists = () =>
  AppError.conflict("PLATFORM_ALREADY_EXISTS", "a platform with this api key id already exists");

export const ErrPlatformRevoked = (platformId: string) =>
  AppError.domainRule("PLATFORM_REVOKED", `platform ${platformId} is revoked`);

export const ErrPlatformSuspended = (platformId: string) =>
  AppError.domainRule("PLATFORM_SUSPENDED", `platform ${platformId} is suspended`);

export const ErrPlatformAlreadyActive = (platformId: string) =>
  AppError.domainRule("PLATFORM_ALREADY_ACTIVE", `platform ${platformId} is already active`);

export const ErrInvalidPlatformName = () =>
  AppError.validation("INVALID_PLATFORM_NAME", "platform name must not be empty");

export const ErrInvalidApiKeyId = () =>
  AppError.validation("INVALID_API_KEY_ID", "api key id must not be empty");
