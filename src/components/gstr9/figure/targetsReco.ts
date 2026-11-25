// Figure links of the reconciliation steps (Outward reco, ITC reco, 9C
// expense heads; figureLinks.ts): where each figure they carry from another
// step or tab comes from. Each target names the source table by its own
// `label` prop and the row id it renders, so FigureFocus finds the row;
// change both together. Targets other agents already verified are reused
// from gstr9form/sourceTargets.ts.

import type { FigTarget } from '@/lib/gstr9/figureLinks';
import type { ExpenseHead, InputSection, MonthKey } from '@/lib/gstr9/types';
import { HEAD_LANDING_LABEL } from '../purchases/HeadLanding';
import { SECTION_META } from '../purchases/purchaseRows';

export { portalT4, portalItc, portal3bTotal, dutiesLye, dutiesSuspended, salesCgSold, itcT7, itc6A1 } from '../gstr9form/sourceTargets';

type Head = 't' | 'i' | 'c' | 's' | 'x';
type TaxHead = Exclude<Head, 't'>;
const taxOnly = (h: string): TaxHead | undefined => (h === 'i' || h === 'c' || h === 's' || h === 'x' ? h : undefined);

// --------------------------------------------------------------- Sales (sales/PartAGrid.tsx)

const PART_A = 'PL-OUTPUT Part A — taxable income';

/** A Sales Part A ledger (row id = ledger id; columns taxable, tax.i …). */
export const salesPartARow = (id: string, col?: 'taxable' | `tax.${TaxHead}`): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'a' },
  table: PART_A,
  row: id,
  col,
  label: 'Sales › Part A',
});

/** Sales Part A total (footer). */
export const salesPartATotal = (col?: string): FigTarget => ({ step: 'sales', tab: { salestab: 'a' }, table: PART_A, row: 'footer:total', col, label: 'Sales › Part A total' });

// --------------------------------------------------------------- Outward reco (this step)

/** Outward reco › Sales ledger buckets: the ledgers each Table 4 books figure adds up (no single row). */
export const outwardBuckets: FigTarget = { step: 'outward', tab: { outwardtab: 'ledgers' }, label: 'Outward reco › Sales ledger buckets' };

/** Outward reco › Books-side extras (4F, 4J, 4K, 4L), row at / dr_nt / amd_pos / amd_neg. */
export const outwardExtra = (row: 'at' | 'dr_nt' | 'amd_pos' | 'amd_neg', head: Head): FigTarget => ({
  step: 'outward',
  tab: { outwardtab: 'extras' },
  table: 'Books-side advances, debit notes and amendments',
  row,
  col: head,
  label: 'Outward reco › Books-side extras',
});

/** Portal data › GSTR-9 Table 4 total (portal/Gstr9Section.tsx footer; columns t i c s x). */
export const portalT4Total = (head: Head): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr9', g9portaltab: 't4' },
  table: 'GSTR-9 Table 4 as auto-populated',
  row: 'footer:total',
  col: head,
  label: 'Portal data › GSTR-9 Table 4',
});

// --------------------------------------------------------------- Portal › As-filed GSTR-3B

/** One month of the as-filed GSTR-3B "other" grid (columns `<field>.<head>`). */
export const portal3bMonth = (month: MonthKey, field: 'itc4aTotal' | 'itc4b1', head: TaxHead): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr3b', g3btab: 'other' },
  table: 'As-filed GSTR-3B by month: 4A total, 4A(5), 4B(1), 4B(2), 4D',
  row: month,
  col: `${field}.${head}`,
  label: 'Portal data › As-filed GSTR-3B',
});

// --------------------------------------------------------------- Purchases

/** Purchases › Where each ledger lands (purchases/HeadLanding.tsx; rows = expense head, columns t / tot). */
export const purchasesHead = (head: ExpenseHead, col: Head | 'tot'): FigTarget => ({
  step: 'purchases',
  tab: { purchasestab: 'heads' },
  table: HEAD_LANDING_LABEL,
  row: head,
  col: col === 't' ? 't' : 'tot',
  label: 'Purchases › Where each ledger lands',
});

/** A PL-INPUT ledger in its section grid (purchases/PurchaseSectionGrid.tsx). */
export const purchasesLedger = (section: InputSection, id: string, col?: 'taxable'): FigTarget => ({
  step: 'purchases',
  tab: { purchasestab: section },
  table: `PL-INPUT ${SECTION_META[section].title}`,
  row: id,
  col,
  label: `Purchases › ${SECTION_META[section].title}`,
});

/** Purchases › Summary, a row of PL-INPUT rows 71 to 81 (MatrixTable, columns t i c s x). */
export const purchasesSummaryRow = (row: '73' | '77' | '79' | '80', head: Head | 'tot'): FigTarget => ({
  step: 'purchases',
  tab: { purchasestab: 'summary' },
  table: 'PL-INPUT rows 71 to 81',
  row,
  col: head === 'tot' ? undefined : head,
  label: `Purchases › PL-INPUT row ${row}`,
});

// --------------------------------------------------------------- Duties & Taxes › Input

/** Net ITC (books) after last-year effect, the footer of the month grid (duties/InputTab.tsx, columns net.i …). */
export const dutiesNetItc = (head: string): FigTarget => {
  const h = taxOnly(head);
  return {
    step: 'duties',
    tab: { dutiestab: 'input' },
    table: 'Input tax credit by month',
    row: 'footer:netItc',
    col: h ? `net.${h}` : undefined,
    label: 'Duties & Taxes › Net ITC (books)',
  };
};

// --------------------------------------------------------------- RCM

/** RCM › Where RCM flows, the RCM ITC with credit (row c14P = 9C row P = RCM Part B less blocked). */
export const rcmEligible = (head: Head | 'tot'): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'expenses' },
  table: 'Where the RCM figures are reported',
  row: 'c14P',
  col: head === 'tot' ? undefined : head,
  label: 'RCM › Where RCM flows (Part B, with credit)',
});

// --------------------------------------------------------------- GSTR-9 step (gstr9form/PartIII.tsx)

/** A row of GSTR-9 Table 6 / 7 / 8 (MatrixTable keyed by code; columns c s i x). */
export const gstr9Row = (table: '6' | '7' | '8', row: string, head?: string): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: table },
  table: `GSTR-9 Table ${table}`,
  row,
  col: head ? taxOnly(head) : undefined,
  label: `GSTR-9 › Table ${row}`,
});

// --------------------------------------------------------------- ITC reco (this step)

/** A line of the ITC working (steps/ItcRecoStep.tsx WorkingCard; columns t i c s x). */
export const itcWorkingRow = (row: string, head?: string): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR 9-INPUT: ITC working for GSTR-9',
  row,
  col: head,
  label: 'ITC reco › ITC working',
});

/** ITC reco › Table 7 entries tab (the 7A to 7H lines, no single row). */
export const itcTable7Tab: FigTarget = { step: 'itc', tab: { itctab: 'table7' }, table: 'GSTR-9 Table 7A to 7H1', label: 'ITC reco › Table 7 entries' };

/** ITC reco › Rule 42 by tax period (reco/Rule42Card.tsx), one period's cell. */
export const rule42Period = (periodKey: string, col: string): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'rule42' },
  table: 'Rule 42 by tax period',
  row: periodKey,
  col,
  label: 'ITC reco › Rule 42 by tax period',
});

/** ITC reco › Rule 42 final for the year (7C) and the Rule 43 periods' year total (7D). */
export const rule42Final7C: FigTarget = { step: 'itc', tab: { itctab: 'rule42' }, table: 'Rule 42 — final for the year', row: 'final', label: 'ITC reco › Rule 42 final (7C)' };
export const rule43Year7D: FigTarget = { step: 'itc', tab: { itctab: 'rule42' }, table: 'Rule 43 by tax period', row: 'footer:total', col: 'te', label: 'ITC reco › Rule 43 Σ Te (7D)' };

/** Purchases › Where each ledger lands, the whole table (a figure summed over several heads). */
export const purchasesHeadsTab: FigTarget = { step: 'purchases', tab: { purchasestab: 'heads' }, label: 'Purchases › Where each ledger lands' };
