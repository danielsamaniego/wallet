import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { asyncDispatch } from "@/wallet/application/worker/asyncDispatch.js";
import { EnqueueMovementCommand } from "@/wallet/application/command/enqueueMovement/command.js";
import type { ICommandBus } from "@/utils/application/cqrs.js";
import type { IResultSubscriber } from "@/wallet/domain/ports/result.subscriber.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";

const PLATFORM_ID = "platform-1";
const IDEM_KEY = "idem-abc";

describe("asyncDispatch", () => {
  const ctx = createTestContext();

  function bus(dispatch: ICommandBus["dispatch"]): ICommandBus {
    return { dispatch };
  }

  describe("Given the worker publishes a posted result before the wait window expires", () => {
    it("Then the helper returns kind=completed with the body carried back so the handler can rebuild the sync-shape JSON", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-1" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-1",
        status: "posted",
        body: { transactionId: "tx-1", movementId: "mov-1" },
      });

      const result = await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "deposit",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: { walletId: "w1", amountMinor: "100" },
        },
      );

      expect(result).toEqual({
        kind: "completed",
        movementId: "mov-1",
        body: { transactionId: "tx-1", movementId: "mov-1" },
      });
    });

    it("Then EnqueueMovementCommand is dispatched with type, platformId, idempotencyKey, queuePayload and reason forwarded verbatim", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-1" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-1",
        status: "posted",
        body: {},
      });

      await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "adjustment",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: { walletId: "w1", amountMinor: "-50", reason: "fee" },
          reason: "fee",
        },
      );

      expect(dispatch).toHaveBeenCalledOnce();
      const [, cmd] = dispatch.mock.calls[0]!;
      expect(cmd).toBeInstanceOf(EnqueueMovementCommand);
      expect(cmd.type).toBe("adjustment");
      expect(cmd.platformId).toBe(PLATFORM_ID);
      expect(cmd.idempotencyKey).toBe(IDEM_KEY);
      expect(cmd.queuePayload).toEqual({ walletId: "w1", amountMinor: "-50", reason: "fee" });
      expect(cmd.reason).toBe("fee");
    });

    it("Then a missing reason forwards as null (the EnqueueMovementCommand contract expects null, not undefined)", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-1" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-1",
        status: "posted",
        body: {},
      });

      await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "deposit",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: {},
        },
      );

      const [, cmd] = dispatch.mock.calls[0]!;
      expect(cmd.reason).toBeNull();
    });

    it("Then waitFor is invoked with the movementId returned by the bus and the configured handlerWaitMs", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-1" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-1",
        status: "posted",
        body: {},
      });

      await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        2500,
        {
          type: "deposit",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: {},
        },
      );

      expect(subscriber.waitFor).toHaveBeenCalledWith(expect.anything(), "mov-1", {
        timeoutMs: 2500,
      });
    });
  });

  describe("Given the worker publishes a posted result without a body (defensive fallback)", () => {
    it("Then the helper returns kind=completed with an empty body so the handler can still respond — never crashes on a missing body", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-1" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-1",
        status: "posted",
        // body intentionally omitted
      });

      const result = await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "deposit",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: {},
        },
      );

      expect(result).toEqual({ kind: "completed", movementId: "mov-1", body: {} });
    });
  });

  describe("Given the worker publishes a failed result", () => {
    it("Then the helper returns kind=failed with the published reason", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-2" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-2",
        status: "failed",
        failedReason: "insufficient funds",
      });

      const result = await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "withdrawal",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: {},
        },
      );

      expect(result).toEqual({
        kind: "failed",
        movementId: "mov-2",
        failedReason: "insufficient funds",
      });
    });
  });

  describe("Given the worker publishes a failed result without a reason (defensive fallback)", () => {
    it("Then the helper returns failedReason='unknown' so the handler always has a non-empty string to surface", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-2" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue({
        movementId: "mov-2",
        status: "failed",
      });

      const result = await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        1500,
        {
          type: "deposit",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: {},
        },
      );

      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        expect(result.failedReason).toBe("unknown");
      }
    });
  });

  describe("Given the wait window expires before any terminal status is observed", () => {
    it("Then the helper returns kind=pending so the handler can fall back to 202 Accepted", async () => {
      const dispatch = vi.fn().mockResolvedValue({ movementId: "mov-3" });
      const subscriber = mock<IResultSubscriber>();
      subscriber.waitFor.mockResolvedValue(null);

      const result = await asyncDispatch(
        ctx,
        bus(dispatch as unknown as ICommandBus["dispatch"]),
        subscriber,
        500,
        {
          type: "transfer",
          platformId: PLATFORM_ID,
          idempotencyKey: IDEM_KEY,
          queuePayload: { sourceWalletId: "a", targetWalletId: "b", amountMinor: "100" },
        },
      );

      expect(result).toEqual({ kind: "pending", movementId: "mov-3" });
    });
  });

  describe("Given the bus throws on dispatch (e.g. EnqueueMovementCommand handler not registered)", () => {
    it("Then the error propagates so the global onError translates it (the handler does not swallow wiring bugs)", async () => {
      const dispatch = vi.fn().mockRejectedValue(new Error("no handler registered"));
      const subscriber = mock<IResultSubscriber>();

      await expect(
        asyncDispatch(
          ctx,
          bus(dispatch as unknown as ICommandBus["dispatch"]),
          subscriber,
          1500,
          {
            type: "deposit",
            platformId: PLATFORM_ID,
            idempotencyKey: IDEM_KEY,
            queuePayload: {},
          },
        ),
      ).rejects.toThrow("no handler registered");
      expect(subscriber.waitFor).not.toHaveBeenCalled();
    });
  });
});
