import type { Transaction } from "../transaction/entity.js";

export interface TransactionRepository {
  save(transaction: Transaction): Promise<void>;
  saveMany(transactions: Transaction[]): Promise<void>;
}
