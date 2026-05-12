import { describe, it, expect } from "vitest";
import {
  hydrateAdjustment,
  hydrateCaptureHold,
  hydrateCharge,
  hydrateDeposit,
  hydrateTransfer,
  hydrateWithdraw,
  InvalidQueuePayloadError,
} from "@/wallet/application/worker/processMovement/payload.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type { MovementQueuePayload, MovementType } from "@/wallet/domain/movement/movement.entity.js";

const PLATFORM_ID = "platform-1";

function makePending(type: MovementType, payload: MovementQueuePayload | null): Movement {
  return Movement.reconstruct({
    id: "mov-1",
    type,
    status: "processing",
    platformId: PLATFORM_ID,
    reason: null,
    failedReason: null,
    queuePayload: payload,
    createdAt: 1_700_000_000_000,
  });
}

describe("processMovement payload hydrators", () => {
  describe("Given a movement with no platform_id", () => {
    const movement = Movement.reconstruct({
      id: "mov-orphan",
      type: "deposit",
      status: "processing",
      platformId: null,
      reason: null,
      failedReason: null,
      queuePayload: { walletId: "w1", amountMinor: "100", idempotencyKey: "k", systemWalletShardCount: 32 },
      createdAt: 1_700_000_000_000,
    });

    it("Then hydrateDeposit throws InvalidQueuePayloadError so the worker marks it failed instead of operating on a NULL tenant", () => {
      expect(() => hydrateDeposit(movement)).toThrow(InvalidQueuePayloadError);
      expect(() => hydrateDeposit(movement)).toThrow(/platform_id is null/);
    });
  });

  describe("Given a movement with no queue_payload", () => {
    const movement = makePending("deposit", null);

    it("Then hydrateDeposit throws InvalidQueuePayloadError", () => {
      expect(() => hydrateDeposit(movement)).toThrow(/queue_payload is null/);
    });
  });

  describe("hydrateDeposit", () => {
    describe("Given a well-formed deposit payload", () => {
      const payload = {
        walletId: "wallet-1",
        amountMinor: "1500",
        idempotencyKey: "idem-d",
        systemWalletShardCount: 32,
        reference: "ref-1",
        metadata: { source: "test" },
      };
      const movement = makePending("deposit", payload);

      it("Then it builds a DepositCommand with platform_id from the Movement and BigInt-decoded amount", () => {
        const { command, lockKeys } = hydrateDeposit(movement);
        expect(command.walletId).toBe("wallet-1");
        expect(command.platformId).toBe(PLATFORM_ID);
        expect(command.amountMinor).toBe(1500n);
        expect(command.idempotencyKey).toBe("idem-d");
        expect(command.systemWalletShardCount).toBe(32);
        expect(command.reference).toBe("ref-1");
        expect(command.metadata).toEqual({ source: "test" });
      });

      it("Then the lock key is derived from the wallet id", () => {
        const { lockKeys } = hydrateDeposit(movement);
        expect(lockKeys).toEqual(["wallet-lock:wallet-1"]);
      });
    });

    describe("Given a deposit payload missing walletId", () => {
      const movement = makePending("deposit", {
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit throws referencing walletId", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/queue_payload.walletId/);
      });
    });

    describe("Given a deposit payload with non-string walletId", () => {
      const movement = makePending("deposit", {
        walletId: 123,
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit throws so a bad enqueue cannot dispatch on an unknown wallet", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/walletId/);
      });
    });

    describe("Given a deposit payload with empty string walletId", () => {
      const movement = makePending("deposit", {
        walletId: "",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit rejects the empty string", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/walletId/);
      });
    });

    describe("Given a deposit payload with amountMinor as a number", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: 100,
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit throws (BigInt values must travel as strings — JSON has no native BigInt)", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/amountMinor/);
      });
    });

    describe("Given a deposit payload with empty-string amountMinor", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit throws", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/amountMinor/);
      });
    });

    describe("Given a deposit payload with unparseable BigInt string", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "not-a-number",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit throws referencing the BigInt parse failure", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/not a parseable BigInt/);
      });
    });

    describe("Given a deposit payload with non-integer systemWalletShardCount", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 1.5,
      });
      it("Then hydrateDeposit throws — shard count must be an integer", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/systemWalletShardCount/);
      });
    });

    describe("Given a deposit payload with string systemWalletShardCount", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: "32",
      });
      it("Then hydrateDeposit throws", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/systemWalletShardCount/);
      });
    });

    describe("Given a deposit payload with reference as a non-string", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
        reference: 42,
      });
      it("Then hydrateDeposit throws", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/reference/);
      });
    });

    describe("Given a deposit payload with metadata as an array", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
        metadata: ["not", "an", "object"],
      });
      it("Then hydrateDeposit throws — arrays do not satisfy the plain-object contract", () => {
        expect(() => hydrateDeposit(movement)).toThrow(/metadata/);
      });
    });

    describe("Given a deposit payload with reference and metadata absent", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateDeposit leaves reference and metadata as undefined", () => {
        const { command } = hydrateDeposit(movement);
        expect(command.reference).toBeUndefined();
        expect(command.metadata).toBeUndefined();
      });
    });

    describe("Given a deposit payload with reference and metadata explicitly null", () => {
      const movement = makePending("deposit", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
        reference: null,
        metadata: null,
      });
      it("Then hydrateDeposit accepts null as 'absent' and leaves them undefined", () => {
        const { command } = hydrateDeposit(movement);
        expect(command.reference).toBeUndefined();
        expect(command.metadata).toBeUndefined();
      });
    });
  });

  describe("hydrateWithdraw", () => {
    describe("Given a well-formed withdraw payload", () => {
      const movement = makePending("withdrawal", {
        walletId: "w1",
        amountMinor: "200",
        idempotencyKey: "idem-w",
        systemWalletShardCount: 16,
      });
      it("Then it builds a WithdrawCommand and returns the wallet lock key", () => {
        const { command, lockKeys } = hydrateWithdraw(movement);
        expect(command.walletId).toBe("w1");
        expect(command.amountMinor).toBe(200n);
        expect(command.systemWalletShardCount).toBe(16);
        expect(lockKeys).toEqual(["wallet-lock:w1"]);
      });
    });

    describe("Given a withdraw payload missing idempotencyKey", () => {
      const movement = makePending("withdrawal", {
        walletId: "w1",
        amountMinor: "100",
        systemWalletShardCount: 32,
      });
      it("Then hydrateWithdraw throws", () => {
        expect(() => hydrateWithdraw(movement)).toThrow(/idempotencyKey/);
      });
    });
  });

  describe("hydrateCharge", () => {
    describe("Given a well-formed charge payload", () => {
      const movement = makePending("charge", {
        walletId: "w1",
        amountMinor: "9999",
        idempotencyKey: "idem-c",
        systemWalletShardCount: 32,
        reference: "subscription-2026-05",
      });
      it("Then it builds a ChargeCommand carrying the reference", () => {
        const { command, lockKeys } = hydrateCharge(movement);
        expect(command.amountMinor).toBe(9999n);
        expect(command.reference).toBe("subscription-2026-05");
        expect(lockKeys).toEqual(["wallet-lock:w1"]);
      });
    });
  });

  describe("hydrateAdjustment", () => {
    describe("Given a well-formed adjustment payload", () => {
      const movement = makePending("adjustment", {
        walletId: "w1",
        amountMinor: "-500",
        reason: "Manual fee",
        idempotencyKey: "idem-a",
        allowNegativeBalance: true,
        systemWalletShardCount: 32,
      });
      it("Then it builds an AdjustBalanceCommand carrying reason and allowNegativeBalance", () => {
        const { command } = hydrateAdjustment(movement);
        expect(command.amountMinor).toBe(-500n);
        expect(command.reason).toBe("Manual fee");
        expect(command.allowNegativeBalance).toBe(true);
      });
    });

    describe("Given an adjustment payload missing the reason", () => {
      const movement = makePending("adjustment", {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        allowNegativeBalance: false,
        systemWalletShardCount: 32,
      });
      it("Then hydrateAdjustment throws — reason is mandatory for adjustments", () => {
        expect(() => hydrateAdjustment(movement)).toThrow(/reason/);
      });
    });

    describe("Given an adjustment payload with non-boolean allowNegativeBalance", () => {
      const movement = makePending("adjustment", {
        walletId: "w1",
        amountMinor: "100",
        reason: "x",
        idempotencyKey: "k",
        allowNegativeBalance: "true",
        systemWalletShardCount: 32,
      });
      it("Then hydrateAdjustment throws", () => {
        expect(() => hydrateAdjustment(movement)).toThrow(/allowNegativeBalance/);
      });
    });
  });

  describe("hydrateTransfer", () => {
    describe("Given a well-formed transfer payload", () => {
      const movement = makePending("transfer", {
        sourceWalletId: "src",
        targetWalletId: "tgt",
        amountMinor: "500",
        idempotencyKey: "idem-t",
      });
      it("Then it builds a TransferCommand with both wallet ids and returns both lock keys", () => {
        const { command, lockKeys } = hydrateTransfer(movement);
        expect(command.sourceWalletId).toBe("src");
        expect(command.targetWalletId).toBe("tgt");
        expect(command.amountMinor).toBe(500n);
        expect(lockKeys).toEqual(["wallet-lock:src", "wallet-lock:tgt"]);
      });
    });

    describe("Given a transfer with source === target", () => {
      const movement = makePending("transfer", {
        sourceWalletId: "same",
        targetWalletId: "same",
        amountMinor: "100",
        idempotencyKey: "k",
      });
      it("Then hydrateTransfer rejects the self-transfer attempt at the payload boundary", () => {
        expect(() => hydrateTransfer(movement)).toThrow(/source and target/);
      });
    });

    describe("Given a transfer payload missing sourceWalletId", () => {
      const movement = makePending("transfer", {
        targetWalletId: "tgt",
        amountMinor: "100",
        idempotencyKey: "k",
      });
      it("Then hydrateTransfer throws", () => {
        expect(() => hydrateTransfer(movement)).toThrow(/sourceWalletId/);
      });
    });
  });

  describe("hydrateCaptureHold", () => {
    describe("Given a well-formed capture-hold payload", () => {
      const movement = makePending("hold_capture", {
        holdId: "hold-1",
        walletId: "w-of-hold",
        idempotencyKey: "idem-ch",
        systemWalletShardCount: 32,
      });
      it("Then it builds a CaptureHoldCommand and derives the lock key from the pre-resolved walletId", () => {
        const { command, lockKeys } = hydrateCaptureHold(movement);
        expect(command.holdId).toBe("hold-1");
        expect(command.platformId).toBe(PLATFORM_ID);
        expect(command.idempotencyKey).toBe("idem-ch");
        expect(command.systemWalletShardCount).toBe(32);
        expect(lockKeys).toEqual(["wallet-lock:w-of-hold"]);
      });
    });

    describe("Given a capture-hold payload missing the pre-resolved walletId", () => {
      const movement = makePending("hold_capture", {
        holdId: "hold-1",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateCaptureHold throws — the HTTP handler must pre-resolve walletId for the lock key", () => {
        expect(() => hydrateCaptureHold(movement)).toThrow(/walletId/);
      });
    });

    describe("Given a capture-hold payload missing holdId", () => {
      const movement = makePending("hold_capture", {
        walletId: "w1",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      });
      it("Then hydrateCaptureHold throws", () => {
        expect(() => hydrateCaptureHold(movement)).toThrow(/holdId/);
      });
    });
  });
});
