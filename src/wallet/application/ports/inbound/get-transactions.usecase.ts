import type { IQueryHandler } from "../../../../shared/application/cqrs.js";
import type { GetTransactionsQuery, PaginatedTransactions } from "../../query/getTransactions/query.js";

export type IGetTransactionsUseCase = IQueryHandler<GetTransactionsQuery, PaginatedTransactions>;
