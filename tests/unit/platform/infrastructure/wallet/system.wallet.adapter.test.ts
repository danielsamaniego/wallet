import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { SystemWalletAdapter } from "@/platform/infrastructure/adapters/outbound/wallet/system.wallet.adapter.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";

describe("SystemWalletAdapter", () => {
  const walletRepo = mock<IWalletRepository>();
  const sut = new SystemWalletAdapter(walletRepo);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(walletRepo);
  });

  describe("Given listCurrencies is called", () => {
    describe("When the wallet repo returns currencies", () => {
      it("Then delegates to listSystemWalletCurrencies and returns the result", async () => {
        walletRepo.listSystemWalletCurrencies.mockResolvedValue(["USD", "EUR"]);
        const result = await sut.listCurrencies(ctx, "plat-1");
        expect(result).toEqual(["USD", "EUR"]);
        expect(walletRepo.listSystemWalletCurrencies).toHaveBeenCalledWith(ctx, "plat-1");
      });
    });
  });

  describe("Given ensureShards is called", () => {
    describe("When the wallet repo resolves successfully", () => {
      it("Then delegates to ensureSystemWalletShards with the correct arguments", async () => {
        walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
        await sut.ensureShards(ctx, "plat-1", "USD", 64, 1700000000000);
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledWith(
          ctx,
          "plat-1",
          "USD",
          64,
          1700000000000,
        );
      });
    });
  });
});
