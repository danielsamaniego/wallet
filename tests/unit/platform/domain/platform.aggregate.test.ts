import { describe, it, expect } from "vitest";
import { ErrorKind } from "@/utils/kernel/appError.js";
import { Platform } from "@/platform/domain/platform/platform.aggregate.js";

describe("Platform aggregate", () => {
  const NOW = 1700000000;

  function createDefault() {
    return Platform.create("p-1", "Acme Corp", "hash-abc", "kid-001", NOW);
  }

  // ── create ───────────────────────────────────────────────────────────

  describe("create", () => {
    it("Given valid params, When create is called, Then returns an active Platform with correct fields", () => {
      const p = createDefault();
      expect(p.id).toBe("p-1");
      expect(p.name).toBe("Acme Corp");
      expect(p.apiKeyHash).toBe("hash-abc");
      expect(p.apiKeyId).toBe("kid-001");
      expect(p.status).toBe("active");
      expect(p.createdAt).toBe(NOW);
      expect(p.updatedAt).toBe(NOW);
    });

    it("Given valid params, When create is called, Then allowNegativeBalance defaults to false", () => {
      const p = createDefault();
      expect(p.allowNegativeBalance).toBe(false);
    });

    it("Given a name with leading/trailing spaces, When create is called, Then name is trimmed", () => {
      const p = Platform.create("p-2", "  Trimmed  ", "hash", "kid", NOW);
      expect(p.name).toBe("Trimmed");
    });

    it("Given an empty name, When create is called, Then throws INVALID_PLATFORM_NAME", () => {
      expect(() => Platform.create("p-3", "", "hash", "kid", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_PLATFORM_NAME",
      );
    });

    it("Given a whitespace-only name, When create is called, Then throws INVALID_PLATFORM_NAME", () => {
      expect(() => Platform.create("p-3", "   ", "hash", "kid", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_PLATFORM_NAME",
      );
    });

    it("Given an empty apiKeyId, When create is called, Then throws INVALID_API_KEY_ID", () => {
      expect(() => Platform.create("p-4", "Name", "hash", "", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_API_KEY_ID",
      );
    });

    it("Given a whitespace-only apiKeyId, When create is called, Then throws INVALID_API_KEY_ID", () => {
      expect(() => Platform.create("p-4", "Name", "hash", "   ", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_API_KEY_ID",
      );
    });

    it("Given an empty apiKeyHash, When create is called, Then throws INVALID_API_KEY_HASH", () => {
      expect(() => Platform.create("p-5", "Name", "", "kid", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_API_KEY_HASH",
      );
    });

    it("Given a whitespace-only apiKeyHash, When create is called, Then throws INVALID_API_KEY_HASH", () => {
      expect(() => Platform.create("p-5", "Name", "   ", "kid", NOW)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_API_KEY_HASH",
      );
    });
  });

  // ── reconstruct ──────────────────────────────────────────────────────

  describe("reconstruct", () => {
    it("Given stored values, When reconstruct is called, Then returns a Platform with those exact values", () => {
      const p = Platform.reconstruct("p-10", "OldName", "h", "k", "suspended", false, 100, 200);
      expect(p.id).toBe("p-10");
      expect(p.name).toBe("OldName");
      expect(p.apiKeyHash).toBe("h");
      expect(p.apiKeyId).toBe("k");
      expect(p.status).toBe("suspended");
      expect(p.allowNegativeBalance).toBe(false);
      expect(p.createdAt).toBe(100);
      expect(p.updatedAt).toBe(200);
    });

    it("Given allowNegativeBalance=true, When reconstruct is called, Then getter returns true", () => {
      const p = Platform.reconstruct("p-11", "Name", "h", "k", "active", true, 100, 200);
      expect(p.allowNegativeBalance).toBe(true);
    });
  });

  // ── rename ───────────────────────────────────────────────────────────

  describe("rename", () => {
    it("Given an active platform, When renamed with a valid name, Then name and updatedAt change", () => {
      const p = createDefault();
      const later = NOW + 1000;
      p.rename("New Name", later);
      expect(p.name).toBe("New Name");
      expect(p.updatedAt).toBe(later);
    });

    it("Given a platform, When renamed with a name having spaces, Then name is trimmed", () => {
      const p = createDefault();
      p.rename("  Padded  ", NOW + 1);
      expect(p.name).toBe("Padded");
    });

    it("Given a platform, When renamed with empty string, Then throws INVALID_PLATFORM_NAME", () => {
      const p = createDefault();
      expect(() => p.rename("", NOW + 1)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_PLATFORM_NAME",
      );
    });

    it("Given a platform, When renamed with whitespace-only, Then throws INVALID_PLATFORM_NAME", () => {
      const p = createDefault();
      expect(() => p.rename("   ", NOW + 1)).toThrowAppError(
        ErrorKind.Validation,
        "INVALID_PLATFORM_NAME",
      );
    });
  });

  // ── suspend ──────────────────────────────────────────────────────────

  describe("suspend", () => {
    it("Given an active platform, When suspended, Then status is suspended and updatedAt changes", () => {
      const p = createDefault();
      const later = NOW + 1000;
      p.suspend(later);
      expect(p.status).toBe("suspended");
      expect(p.updatedAt).toBe(later);
    });

    it("Given a revoked platform, When suspended, Then throws PLATFORM_REVOKED", () => {
      const p = Platform.reconstruct("p-1", "X", "h", "k", "revoked", false, NOW, NOW);
      expect(() => p.suspend(NOW + 1)).toThrowAppError(ErrorKind.DomainRule, "PLATFORM_REVOKED");
    });

    it("Given an already suspended platform, When suspended again, Then throws PLATFORM_ALREADY_SUSPENDED", () => {
      const p = createDefault();
      p.suspend(NOW + 1);
      expect(() => p.suspend(NOW + 2)).toThrowAppError(
        ErrorKind.DomainRule,
        "PLATFORM_ALREADY_SUSPENDED",
      );
    });
  });

  // ── activate ─────────────────────────────────────────────────────────

  describe("activate", () => {
    it("Given a suspended platform, When activated, Then status is active and updatedAt changes", () => {
      const p = createDefault();
      p.suspend(NOW + 1);
      p.activate(NOW + 2);
      expect(p.status).toBe("active");
      expect(p.updatedAt).toBe(NOW + 2);
    });

    it("Given a revoked platform, When activated, Then throws PLATFORM_REVOKED", () => {
      const p = Platform.reconstruct("p-1", "X", "h", "k", "revoked", false, NOW, NOW);
      expect(() => p.activate(NOW + 1)).toThrowAppError(ErrorKind.DomainRule, "PLATFORM_REVOKED");
    });

    it("Given an already active platform, When activated again, Then throws PLATFORM_ALREADY_ACTIVE", () => {
      const p = createDefault();
      expect(() => p.activate(NOW + 1)).toThrowAppError(
        ErrorKind.DomainRule,
        "PLATFORM_ALREADY_ACTIVE",
      );
    });
  });

  // ── revoke ───────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("Given an active platform, When revoked, Then status is revoked and updatedAt changes", () => {
      const p = createDefault();
      const later = NOW + 1000;
      p.revoke(later);
      expect(p.status).toBe("revoked");
      expect(p.updatedAt).toBe(later);
    });

    it("Given a suspended platform, When revoked, Then status is revoked", () => {
      const p = createDefault();
      p.suspend(NOW + 1);
      p.revoke(NOW + 2);
      expect(p.status).toBe("revoked");
    });

    it("Given an already revoked platform, When revoked again, Then throws PLATFORM_ALREADY_REVOKED", () => {
      const p = Platform.reconstruct("p-1", "X", "h", "k", "revoked", false, NOW, NOW);
      expect(() => p.revoke(NOW + 1)).toThrowAppError(
        ErrorKind.DomainRule,
        "PLATFORM_ALREADY_REVOKED",
      );
    });
  });

  // ── setAllowNegativeBalance ──────────────────────────────────────────

  describe("setAllowNegativeBalance", () => {
    it("Given an active platform, When setting allowNegativeBalance to true, Then getter returns true and updatedAt changes", () => {
      const p = createDefault();
      const later = NOW + 1000;
      p.setAllowNegativeBalance(true, later);
      expect(p.allowNegativeBalance).toBe(true);
      expect(p.updatedAt).toBe(later);
    });

    it("Given an active platform with allowNegativeBalance=true, When setting to false, Then getter returns false", () => {
      const p = Platform.reconstruct("p-1", "X", "h", "k", "active", true, NOW, NOW);
      p.setAllowNegativeBalance(false, NOW + 1);
      expect(p.allowNegativeBalance).toBe(false);
    });

    it("Given a revoked platform, When setting allowNegativeBalance, Then throws PLATFORM_REVOKED", () => {
      const p = Platform.reconstruct("p-1", "X", "h", "k", "revoked", false, NOW, NOW);
      expect(() => p.setAllowNegativeBalance(true, NOW + 1)).toThrowAppError(
        ErrorKind.DomainRule,
        "PLATFORM_REVOKED",
      );
    });

    it("Given a suspended platform, When setting allowNegativeBalance to true, Then succeeds", () => {
      const p = createDefault();
      p.suspend(NOW + 1);
      p.setAllowNegativeBalance(true, NOW + 2);
      expect(p.allowNegativeBalance).toBe(true);
    });
  });
});
