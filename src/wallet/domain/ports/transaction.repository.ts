import type { AppContext } from "../../../utils/kernel/context.js";
import type { Transaction } from "../transaction/transaction.entity.js";

export interface ITransactionRepository {
  save(ctx: AppContext, transaction: Transaction): Promise<void>;
  saveMany(ctx: AppContext, transactions: Transaction[]): Promise<void>;
}
