// Figure links for GSTR-9C (figureLinks.ts): where each prefilled figure of
// the statement comes from. Each target names the source table by its own
// `label` prop and the row id it renders, so FigureFocus finds the row; a
// source without one row per figure (Sales Part A by rate, RCM Part B) opens
// its tab only.

import type { FigTarget } from '@/lib/gstr9/figureLinks';
import type { Table9Head } from '@/lib/gstr9/types';
import type { FormHead } from './formLines';

type TaxHead = 'c' | 's' | 'i' | 'x';
const taxCol = (h: FormHead): TaxHead | undefined => (h === 't' ? undefined : h);

// --------------------------------------------------------------- this step

/** Another row of a GSTR-9C table on this step (FormGrid / MatrixTable `GSTR-9C Table <n>`). */
export const c9Row = (table: '5' | '7' | '9' | '12' | '14', row: string, col?: string): FigTarget => ({
  step: 'gstr9c',
  tab: { gstr9ctab: table },
  table: `GSTR-9C Table ${table}`,
  row,
  col,
  label: `GSTR-9C › ${table}${row}`,
});

// ------------------------------------------------------------------- Sales

/** Sales › Audit report (sales/AuditReconciliation.tsx): the audit-report total, or the books Part A + B when none is typed. */
export const salesAudit = (row: 'report' | 'total'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'audit' },
  table: 'Total income: books against the audit report',
  row,
  col: 'amount',
  label: row === 'report' ? 'Sales › Audit report total' : 'Sales › Books total (Part A + B)',
});

/** Sales › Part A (by ledger; the rate-wise split is not a table of its own). */
export const salesPartA: FigTarget = { step: 'sales', tab: { salestab: 'a' }, label: 'Sales › Part A (ledgers by rate)' };

/** Sales › Capital goods sold (sales/CapitalGoodsSold.tsx): the year's total sale value. */
export const salesCapitalGoods: FigTarget = {
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: 'footer:total',
  col: 'disposalValue',
  label: 'Sales › Capital goods sold',
};

/**
 * Sales › Advances (sales/BuilderAdvances.tsx, builder clients): 5B, 5C, 5H and
 * 5I are typed in the year's figures; 5J and 5O add up the other adjustments
 * and are anchored on the Table 5 justification list.
 */
export const builderAdvance = (k: string): FigTarget =>
  ['B', 'C', 'H', 'I'].includes(k)
    ? { step: 'sales', tab: { salestab: 'advances' }, table: 'Builder advance figures', row: `5${k}`, label: `Sales › Advances (5${k})` }
    : { step: 'sales', tab: { salestab: 'advances' }, table: 'Builder advance Table 5', row: `5${k}`, label: `Sales › Advances (5${k})` };

// ----------------------------------------------------------------- GSTR-9

/** GSTR-9 › Table 4, row 4N (gstr9form/PartII.tsx). */
export const g9T4N: FigTarget = { step: 'gstr9', tab: { gstr9tab: '4' }, table: 'GSTR-9 Table 4', row: '4N', col: 't', label: 'GSTR-9 › Table 4N' };

/** GSTR-9 › Table 5, one row by code (gstr9form/PartII.tsx FormTable). */
export const g9T5 = (code: string): FigTarget => ({ step: 'gstr9', tab: { gstr9tab: '5' }, table: 'GSTR-9 Table 5', row: code, col: 't', label: `GSTR-9 › Table ${code}` });

/** GSTR-9 › Tables 10–13, the total turnover line 5N + 10 − 11 (gstr9form/PartV.tsx). */
export const g9TotalTurnover: FigTarget = {
  step: 'gstr9',
  tab: { gstr9tab: '10' },
  table: 'GSTR-9 Tables 12, 13 and total turnover',
  row: 'tt',
  col: 't',
  label: 'GSTR-9 › Total turnover (5N + 10 − 11)',
};

const T9_ROW: Record<TaxHead, Table9Head> = { i: 'igst', c: 'cgst', s: 'sgst', x: 'cess' };

/** GSTR-9 › Table 9, total tax paid of the head's row (gstr9form/PartIV.tsx). */
export const g9T9Paid = (h: FormHead): FigTarget | undefined => {
  const t = taxCol(h);
  return t ? { step: 'gstr9', tab: { gstr9tab: '9' }, table: 'GSTR-9 Table 9', row: T9_ROW[t], col: 'paid', label: 'GSTR-9 › Table 9 tax paid' } : undefined;
};

/** GSTR-9 › Table 7, row 7J (gstr9form/PartIII.tsx). */
export const g9T7J = (h: FormHead): FigTarget => ({ step: 'gstr9', tab: { gstr9tab: '7' }, table: 'GSTR-9 Table 7', row: '7J', col: taxCol(h), label: 'GSTR-9 › Table 7J' });

// ------------------------------------------------------------ ITC sources

/** Purchases › Summary, PL-INPUT row 79 net ITC (purchases/PurchasesSummary.tsx). */
export const purchasesNetItc = (h: FormHead): FigTarget => ({
  step: 'purchases',
  tab: { purchasestab: 'summary' },
  table: 'PL-INPUT rows 71 to 81',
  row: '79',
  col: h,
  label: 'Purchases › Net ITC (PL-INPUT row 79)',
});

/** Duties & Taxes › Input, Last year effect (duties/InputTab.tsx; columns lye.i / lye.c / lye.s / lye.x). */
export const dutiesLye = (h: FormHead): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Last year effect',
  row: 'lye',
  col: taxCol(h) ? `lye.${h}` : undefined,
  label: 'Duties & Taxes › Last year effect',
});

/** ITC reco › Tables 12 & 13 · 8C, the typed Table 13 (steps/ItcRecoStep.tsx). */
export const itcTable13 = (h: FormHead): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'next' },
  table: 'GSTR-9 Tables 12 and 13',
  row: 't13',
  col: taxCol(h),
  label: 'ITC reco › Table 13',
});

/** ITC reco › 9C Table 14 (reco/Table14Card.tsx FigureTable, rows A … R, columns t i c s x). */
export const expenseHead = (row: string, h: FormHead): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'table14' },
  table: 'GSTR 9C sheet: ITC by expense head',
  row,
  col: h,
  label: `ITC reco › 9C Table 14 › ${row}`,
});

/** RCM › Part B books (by expense and month; the rate-wise split is not a table of its own). */
export const rcmPartB: FigTarget = { step: 'rcm', tab: { rcmtab: 'books' }, label: 'RCM › Part B (books)' };

/** ITC reco › Rule 42/43, the year's final working (reco/Rule42Card.tsx). */
export const rule42Final = (row: 'pay' | 'int'): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'rule42' },
  table: 'Rule 42 — final for the year',
  row,
  label: row === 'pay' ? 'ITC reco › Rule 42/43 still to reverse' : 'ITC reco › Rule 42/43 interest',
});

/** Annexures › Annexure-3, the DRC-03 total and balance (annexures/Annexure3.tsx). */
export const annexure3 = (row: 'payable' | 'already' | 'balance'): FigTarget => ({
  step: 'annexures',
  tab: { ann: 'a3' },
  table: 'Annexure-3 total and DRC-03 balance',
  row,
  label: 'Annexures › Annexure-3',
});
