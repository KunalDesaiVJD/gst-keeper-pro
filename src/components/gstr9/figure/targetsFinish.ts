// Figure links of the finishing steps (Annexures, Notice format, Payables &
// set-off, Overview and Review): where each locked or computed figure there
// comes from, as a FigTarget naming the source step, its tab params, the
// source table's accessible label and the row id (figureLinks.ts). Each label
// and row id here is the one the source component renders; change both
// together. GSTR-9 / GSTR-9C targets that already exist are reused.

import type { DiffLine } from '@/lib/gstr9/engine';
import type { FigTarget } from '@/lib/gstr9/figureLinks';
import { diffTabParams, stepMeta } from '../overview/steps';
import { dutiesLye, dutiesSuspended, itc6A1, itcWorking, portal3bTotal, portalItc } from '../gstr9form/sourceTargets';
import { gstr9T10or11, gstr9T4N, itcNextYear } from '../gstr9form/sourceTargets2';
import { c9Row, rule42Final } from '../gstr9c/sourceTargets';

type Head = 't' | 'i' | 'c' | 's' | 'x';
type TaxHead = 'i' | 'c' | 's' | 'x';
const isTax = (h: string): h is TaxHead => h === 'i' || h === 'c' || h === 's' || h === 'x';
const T9_ROW: Record<TaxHead, string> = { i: 'igst', c: 'cgst', s: 'sgst', x: 'cess' };

// --- Sales -------------------------------------------------------------------------

/** PL-OUTPUT Part A's Total row (sales/PartAGrid.tsx; columns taxable, tax.i … tax.x). */
export const salesPartA = (h: Head): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'a' },
  table: 'PL-OUTPUT Part A — taxable income',
  row: 'footer:total',
  col: h === 't' ? 'taxable' : `tax.${h}`,
  label: 'Sales › Part A total',
});

/** Sales › Capital goods sold, the year's Total row (sales/CapitalGoodsSold.tsx). */
export const salesCg = (col?: 'disposalValue' | 'shortfall' | 'payable'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: 'footer:total',
  col,
  label: 'Sales › Capital goods sold',
});

/** One asset of Sales › Capital goods sold (row id = the asset id). */
export const salesCgAsset = (id: string): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: id,
  label: 'Sales › Capital goods sold',
});

// --- RCM ---------------------------------------------------------------------------

/** RCM Part B's Total row (rcm/RcmPartBCard.tsx; columns b.t, b.i … b.x). */
export const rcmPartBTotal = (h: Head): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'books' },
  table: 'RCM Part B — taxable value by expense and month',
  row: 'footer:total',
  col: `b.${h}`,
  label: 'RCM › Part B total',
});

// --- Duties & Taxes › Input (duties/InputTab.tsx) ----------------------------------

const DTI_TABLE = 'Input tax credit by month';

/** A footer line of "Input tax credit by month" (total / rcm / itc / plDiff); columns `<group>.<head>`. */
export const dtiFooter = (row: 'total' | 'rcm' | 'itc' | 'plDiff', group?: 'purchase' | 'debitNote' | 'net', h?: TaxHead): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: DTI_TABLE,
  row: `footer:${row}`,
  col: group && h ? `${group}.${h}` : undefined,
  label: row === 'rcm' ? 'Duties & Taxes › RCM tax (books)' : 'Duties & Taxes › Input tax credit',
});

/** Suspended ITC totals, the net line I + L − O − R (duties/InputTab.tsx MatrixTable). */
export const dutiesSuspendedNet = (h: Head): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Suspended ITC totals',
  row: 'net',
  col: h,
  label: 'Duties & Taxes › Suspended ITC net',
});

// --- ITC reco › ITC working (steps/ItcRecoStep.tsx FigureTable) --------------------

/** Any line of the ITC working by its key (e.g. res = 7J − books). */
export const itcWorkingLine = (row: string, h?: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR 9-INPUT: ITC working for GSTR-9',
  row,
  col: h,
  label: row === 'res' ? 'ITC reco › 7J − books' : 'ITC reco › ITC working',
});

// --- Portal data › As-filed GSTR-3B (portal/Gstr3bSection.tsx) ---------------------

/** The year's Σ of 4D / 4A(5) / 4B(2) of the as-filed GSTR-3B (Total row; columns `<field>.<head>`). */
export const portal3bOther = (field: 'itc4d' | 'itc4a5' | 'itc4b2', h: TaxHead): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr3b', g3btab: 'other' },
  table: 'As-filed GSTR-3B by month: 4A total, 4A(5), 4B(1), 4B(2), 4D',
  row: 'footer:total',
  col: `${field}.${h}`,
  label: 'Portal data › As-filed GSTR-3B',
});

/** GSTR-9 Table 4 as auto-populated, its Total row (excl. 4G; portal/Gstr9Section.tsx). */
export const portalT4Total = (h: Head): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr9', g9portaltab: 't4' },
  table: 'GSTR-9 Table 4 as auto-populated',
  row: 'footer:total',
  col: h,
  label: 'Portal data › GSTR-9 Table 4 total (F adds RCM Part A)',
});

// --- GSTR-9 form (gstr9form/Part*.tsx) ---------------------------------------------

/** A row of a GSTR-9 MatrixTable keyed by its code (Tables 4, 6, 7, 8). */
export const g9Row = (table: '4' | '6' | '7' | '8', row: string, h?: Head): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: table },
  table: `GSTR-9 Table ${table}`,
  row,
  col: h,
  label: `GSTR-9 › ${row}`,
});

/** GSTR-9 Table 9 (PartIV.tsx SheetGrid, rows igst / cgst / sgst / cess; columns cash, itcC … paid). */
export const g9T9 = (h: Head, col?: 'cash' | 'paid'): FigTarget | undefined =>
  isTax(h)
    ? { step: 'gstr9', tab: { gstr9tab: '9' }, table: 'GSTR-9 Table 9', row: T9_ROW[h], col, label: `GSTR-9 › Table 9${col === 'cash' ? ' paid in cash' : col === 'paid' ? ' tax paid' : ' paid through ITC'}` }
    : undefined;

/** GSTR-9 Table 9 as a whole (the Total of a paid column has no row of its own). */
export const g9T9Table: FigTarget = { step: 'gstr9', tab: { gstr9tab: '9' }, label: 'GSTR-9 › Table 9' };

/** GSTR-9 Table 14 (PartV.tsx SheetGrid, rows igst / cgst / sgst / cess; column paid). */
export const g9T14Paid = (h: TaxHead): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '14' },
  table: 'GSTR-9 Table 14',
  row: T9_ROW[h],
  col: 'paid',
  label: 'GSTR-9 › Table 14 paid',
});

/** GSTR-9 Table 15G (PartVI.tsx SheetGrid, row demandPending). */
export const g9T15G = (h: TaxHead): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '15' },
  table: 'GSTR-9 Table 15',
  row: 'demandPending',
  col: h,
  label: 'GSTR-9 › Table 15G',
});

/** GSTR-9 Table 16B / 16C (PartVI.tsx SheetGrid). */
export const g9T16 = (row: '16B' | '16C', h: TaxHead): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '16' },
  table: 'GSTR-9 Table 16',
  row,
  col: h,
  label: `GSTR-9 › Table ${row}`,
});

// --- Annexures (annexures/*.tsx) ---------------------------------------------------

const ANN1_INCOME = 'Annexure-1 income reconciliation';
const ANN1_PAID = 'Annexure-1 paid and payable';

/** A row of Annexure-1's income reconciliation (row key A … G). */
export const ann1Income = (row: string, h?: Head): FigTarget => ({
  step: 'annexures', tab: { ann: 'a1' }, table: ANN1_INCOME, row, col: h, label: `Annexures › Annexure-1 ${row}`,
});

/** A typed line of Annexure-1 (non-GST income, sale return). */
export const ann1Entry = (row: 'nongst' | 'return', h: Head): FigTarget => ({
  step: 'annexures',
  tab: { ann: 'a1' },
  table: 'Annexure-1 entries: non-GST income and sale return',
  row,
  col: h,
  label: row === 'nongst' ? 'Annexures › Annexure-1 non-GST income (typed)' : 'Annexures › Annexure-1 sale return (typed)',
});

/** Annexure-1 paid & payable: a head's difference (column c), or the Total line. */
export const ann1PaidDiff = (h: TaxHead | 'total'): FigTarget => ({
  step: 'annexures', tab: { ann: 'a1' }, table: ANN1_PAID, row: h, col: 'c', label: 'Annexures › Annexure-1 paid & payable',
});

/** Annexure-3 rows 1 to 3 (FixedTaxGrid rows r1 / r2 / r3). */
export const ann3Top = (row: 'r1' | 'r2' | 'r3', h?: TaxHead): FigTarget => ({
  step: 'annexures', tab: { ann: 'a3' }, table: 'Annexure-3 rows 1 to 3', row, col: h, label: `Annexures › Annexure-3 row ${row.slice(1)}`,
});

/** Annexure-3 row 4, the total of other payments. */
export const ann3Other = (h?: TaxHead): FigTarget => ({
  step: 'annexures', tab: { ann: 'a3' }, table: 'Annexure-3 row 4: any other payment', row: 'footer:sum', col: h ? `o.${h}` : undefined, label: 'Annexures › Annexure-3 row 4',
});

/** Annexure-4, one clause of the previous year's GSTR-9 (label carries that FY). */
export const ann4Clause = (prevFy: string, clause: 'c8' | 'c10' | 'c11' | 'c12' | 'c13', h?: TaxHead): FigTarget => ({
  step: 'annexures',
  tab: { ann: 'a4' },
  table: `Annexure-4: FY ${prevFy} GSTR-9 clauses`,
  row: clause,
  col: h,
  label: `Annexures › Annexure-4 clause ${clause.slice(1)}`,
});

// --- Payables & set-off ------------------------------------------------------------

/** The set-off register (a plain table; opens its tab). */
export const payablesRegister: FigTarget = { step: 'payables', tab: { payablestab: 'register' }, label: 'Payables › Set-off register' };

/** Where a component of the payable disclosure comes from (engine payables components by key). */
export const payableComponent = (side: 'output' | 'input', key: string, h?: TaxHead): FigTarget | undefined => {
  switch (key) {
    case 'clause9': return ann3Top('r1', h);
    case 'rcm': return ann3Top('r2', h);
    case 'excessItc': return ann3Top('r3', h);
    case 'other': return ann3Other(h);
    case 'r42': return rule42Final('pay');
    case 'r42Interest': return rule42Final('int');
    case 'r43': return rule43Year('short');
    case 'r43Interest': return rule43Year('int');
    case 'cg186': return side === 'input' ? salesCg() : undefined;
    default: return undefined;
  }
};

// --- ITC reco › Rule 42/43 (reco/Rule43Card.tsx) -----------------------------------

/** Rule 43 by tax period, the year's line (columns follow the head picked there). */
export const rule43Year = (col: 'short' | 'int'): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'rule42' },
  table: 'Rule 43 by tax period',
  row: 'footer:total',
  col,
  label: col === 'short' ? 'ITC reco › Rule 43 still to reverse' : 'ITC reco › Rule 43 interest',
});

// --- Re-exports used by the finishing steps ----------------------------------------

export { dutiesLye, dutiesSuspended, itc6A1, itcWorking, portal3bTotal, portalItc, gstr9T10or11, gstr9T4N, itcNextYear };

// --- Difference lines → the row that holds them ------------------------------------

/**
 * The row a difference line sits on (the row whose status control shows it),
 * so the Overview / Review lists open the row and not only its step. Lines
 * with no row of their own (a missing-3B note, a Rule 42 cross-check) open
 * their tab.
 */
export const diffTarget = (d: Pick<DiffLine, 'key' | 'step'>): FigTarget => {
  const k = d.key;
  const label = `${stepMeta(d.step).label} › difference`;
  const tabOnly: FigTarget = { step: d.step, tab: diffTabParams(d), label };
  const at = (table: string, row: string, tab: Record<string, string> = diffTabParams(d)): FigTarget => ({ step: d.step, tab, table, row, label });
  const rest = (p: string) => k.slice(p.length);

  if (k === 'sales.audit') return at('Total income: books against the audit report', 'footer:diff');
  if (k.startsWith('cg.')) return at('Capital goods sold', rest('cg.'));
  if (k === 'purchases.dt') return at('PL-INPUT rows 71 to 81', '81');
  if (k === 'itc.r42Net') return at('Rule 42 — final for the year', 'pay', { itctab: 'rule42' });
  if (k === 'itc.r43Net') return at('Rule 43 by tax period', 'footer:total', { itctab: 'rule42' });
  if (k.startsWith('itc.r4')) return { ...tabOnly, tab: { itctab: 'rule42' } };
  if (k === 'itc.6J') return at('GSTR 9-INPUT: ITC working for GSTR-9', '6J');
  if (k === 'itc.books') return at('GSTR 9-INPUT: ITC working for GSTR-9', 'res');
  if (k === 'dto.pl') return at('Output tax by month', 'footer:plDiff');
  if (k === 'dti.lye') return at('Last year effect', 'lye');
  if (k === 'dti.rcm') return at(DTI_TABLE, 'footer:rcm');
  if (k === 'dto.no3b' || k === 'dti.no3b' || k === 'out.portal') return tabOnly;
  if (k.startsWith('dto.')) return at('Output tax by month', rest('dto.'));
  if (k.startsWith('dti.')) return at(DTI_TABLE, rest('dti.'));
  if (k === 'rcm.annual') return at('RCM difference, books minus portal, by month', 'footer:total');
  if (k.startsWith('rcm.')) return at('RCM difference, books minus portal, by month', rest('rcm.'));
  if (k === 'out.total') return at('GSTR 9-OUTPUT: books vs GSTR-9 auto-populated', 'footer:total');
  if (k.startsWith('out.')) return at('GSTR 9-OUTPUT: books vs GSTR-9 auto-populated', rest('out.'));
  if (k === 'ann1.income') return at(ANN1_INCOME, 'G');
  if (k === 'ann1.paid') return at(ANN1_PAID, 'total');
  if (k === 'ann2.J') return at('Annexure-2 ITC reconciliation', 'J');
  if (k === 'ann4.c13') return at('Clause 13 of the previous year next to 6A1 of this year', '6A1');
  if (k === 'g9.8C') return at('GSTR-9 Table 8', '8C', { gstr9tab: '8' });
  if (k === 'g9.8D') return at('GSTR-9 Table 8', '8D');
  if (k.startsWith('g9.t5.')) return at('GSTR-9 Table 5', rest('g9.t5.'));
  if (k.startsWith('g9.t9.')) return at('GSTR-9 Table 9', rest('g9.t9.'));
  const c9 = /^gstr9c\.(5|7|9|12|14)([A-Z])$/.exec(k);
  if (c9) return { ...c9Row(c9[1] as '5' | '7' | '9' | '12' | '14', c9[2]), label };
  return tabOnly;
};
