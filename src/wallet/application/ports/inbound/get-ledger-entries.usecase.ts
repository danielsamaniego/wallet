import type { IQueryHandler } from "../../../../shared/application/cqrs.js";
import type { GetLedgerEntriesQuery, PaginatedLedgerEntries } from "../../query/getLedgerEntries/query.js";

export type IGetLedgerEntriesUseCase = IQueryHandler<GetLedgerEntriesQuery, PaginatedLedgerEntries>;
