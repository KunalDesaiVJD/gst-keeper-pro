// RecoResult → ReportTable. The layout itself (stat band, the document list
// with both sides next to each other, the summary by reason, the analysis
// sheets and the merge across months) lives in viewModel.ts; this module keeps
// the entry point and the cell helpers other code imports from here. Generic
// over the pair of sources, so 2A vs 8A and 8A vs 2B reuse it.
import type { ReportTable } from '@/utils/allClientsReports';
import { signedTax, signedTaxable } from './engine';
import type { RecoResult, RecoRow } from './types';
import { recoReportTable, toViewData, type TableInfo } from './viewModel';

export { diffHeader, evidenceCell, reasonCell } from './viewModel';
export type { TableInfo } from './viewModel';

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The ReportTable of one month's reconciliation (see recoReportTable). */
export function toReportTable(result: RecoResult, info: TableInfo): ReportTable {
  return recoReportTable(toViewData(result, info), { title: info.title });
}

/** Taxable and tax of the documents of one side, signed (for checks and tiles). */
export const sideTotals = (rows: RecoRow[], side: 'left' | 'right') => ({
  taxable: r2(rows.reduce((s, r) => s + signedTaxable(r[side]), 0)),
  tax: r2(rows.reduce((s, r) => s + signedTax(r[side]), 0)),
});
