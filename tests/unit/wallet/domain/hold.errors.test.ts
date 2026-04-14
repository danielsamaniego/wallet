import { describe, it, expect } from "vitest";
import { ErrorKind } from "@/utils/kernel/appError.js";
import {
  ErrHoldNotFound,
  ErrHoldNotActive,
  ErrHoldExpired,
} from "@/wallet/domain/hold/hold.errors.js";

describe("hold error factories", () => {
  it("Given a hold id, When ErrHoldNotFound is called, Then returns NotFound with HOLD_NOT_FOUND code", () => {
    const err = ErrHoldNotFound("h-1");
    expect(err.kind).toBe(ErrorKind.NotFound);
    expect(err.code).toBe("HOLD_NOT_FOUND");
    expect(err.msg).toContain("h-1");
  });

  it("Given a hold id, When ErrHoldNotActive is called, Then returns DomainRule with HOLD_NOT_ACTIVE code", () => {
    const err = ErrHoldNotActive("h-2");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("HOLD_NOT_ACTIVE");
    expect(err.msg).toContain("h-2");
  });

  it("Given a hold id, When ErrHoldExpired is called, Then returns DomainRule with HOLD_EXPIRED code", () => {
    const err = ErrHoldExpired("h-3");
    expect(err.kind).toBe(ErrorKind.DomainRule);
    expect(err.code).toBe("HOLD_EXPIRED");
    expect(err.msg).toContain("h-3");
  });
});
