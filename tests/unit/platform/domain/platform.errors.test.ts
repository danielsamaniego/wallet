import { describe, it, expect } from "vitest";
import { ErrorKind } from "@/utils/kernel/appError.js";
import {
  ErrPlatformNotFound,
  ErrPlatformAlreadyExists,
  ErrPlatformRevoked,
  ErrPlatformSuspended,
  ErrPlatformAlreadyActive,
  ErrInvalidPlatformName,
  ErrInvalidApiKeyId,
} from "@/platform/domain/platform/platform.errors.js";

describe("platform error factories", () => {
  it("Given a platform id, When ErrPlatformNotFound is called, Then returns NotFound with PLATFORM_NOT_FOUND code", () => {
    const err = ErrPlatformNotFound("p-1");
    expect(err.kind).toBe(ErrorKind.NotFound);
    expect(err.code).toBe("PLATFORM_NOT_FOUND");
    expect(err.msg).toContain("p-1");
  });

  it("When ErrPlatformAlreadyExists is called, Then returns Conflict with PLATFORM_ALREADY_EXISTS code", () => {
    const err = ErrPlatformAlreadyExists();
    expect(err.kind).toBe(ErrorKind.Conflict);
    expect(err.code).toBe("PLATFORM_ALREADY_EXISTS");
  });

  it("Given a platform id, When ErrPlatformRevoked is called, Then returns DomainRule with PLATFORM_REVOKED code", () => {
    const err = ErrPlatformRevoked("p-2");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("PLATFORM_REVOKED");
    expect(err.msg).toContain("p-2");
  });

  it("Given a platform id, When ErrPlatformSuspended is called, Then returns DomainRule with PLATFORM_SUSPENDED code", () => {
    const err = ErrPlatformSuspended("p-3");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("PLATFORM_SUSPENDED");
    expect(err.msg).toContain("p-3");
  });

  it("Given a platform id, When ErrPlatformAlreadyActive is called, Then returns DomainRule with PLATFORM_ALREADY_ACTIVE code", () => {
    const err = ErrPlatformAlreadyActive("p-4");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("PLATFORM_ALREADY_ACTIVE");
    expect(err.msg).toContain("p-4");
  });

  it("When ErrInvalidPlatformName is called, Then returns Validation with INVALID_PLATFORM_NAME code", () => {
    const err = ErrInvalidPlatformName();
    expect(err.kind).toBe(ErrorKind.Validation);
    expect(err.code).toBe("INVALID_PLATFORM_NAME");
  });

  it("When ErrInvalidApiKeyId is called, Then returns Validation with INVALID_API_KEY_ID code", () => {
    const err = ErrInvalidApiKeyId();
    expect(err.kind).toBe(ErrorKind.Validation);
    expect(err.code).toBe("INVALID_API_KEY_ID");
  });
});
