// Figure links of GSTR-9 Tables 4 to 8 (figure/FigLink.tsx): where each
// figure on the form comes from, as a FigTarget naming the source step, its
// tab params, the source table's accessible label and the row id. Each label
// and row id here is the one the source component renders; change both
// together.

import type { FigTarget } from '@/lib/gstr9/figureLinks';
import type { T4Key, T5Key } from '@/lib/gstr9/types';
import type { MatrixHead } from '../ui';

type Head = MatrixHead;

// --- Portal data › GSTR-9 system computed (portal/Gstr9Section.tsx) --------

const G9_PORTAL = (inner: string) => ({ portaltab: 'gstr9', g9portaltab: inner });

/** A Table 4 figure as auto-populated (portal grid, columns t / i / c / s / x). */
export const portalT4 = (key: T4Key, head: Head): FigTarget => ({
  step: 'portal',
  tab: G9_PORTAL('t4'),
  table: 'GSTR-9 Table 4 as auto-populated',
  row: key,
  col: head,
  label: 'Portal data › GSTR-9 Table 4',
});

/** A Table 5 figure as auto-populated (portal grid, value only). */
export const portalT5 = (key: T5Key): FigTarget => ({
  step: 'portal',
  tab: G9_PORTAL('t5'),
  table: 'GSTR-9 Table 5 as auto-populated',
  row: key,
  col: 't',
  label: 'Portal data › GSTR-9 Table 5',
});

/** 6A, 6G or 8A as auto-populated (portal grid, columns c / s / i / x). */
export const portalItc = (key: 't6A' | 't6G' | 't8A', head: Head): FigTarget => ({
  step: 'portal',
  tab: G9_PORTAL('itc'),
  table: 'GSTR-9 ITC figures from the portal',
  row: key,
  col: head,
  label: `Portal data › GSTR-9 ${key.slice(1)}`,
});

// --- Portal data › As-filed GSTR-3B (portal/Gstr3bSection.tsx) ---------------

/** The year's Σ of a month field of the as-filed GSTR-3B (the grid's Total row; columns `<field>.<head>`). */
export const portal3bTotal = (field: 'itc4aTotal' | 'itc4b1', head: Head): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr3b', g3btab: 'other' },
  table: 'As-filed GSTR-3B by month: 4A total, 4A(5), 4B(1), 4B(2), 4D',
  row: 'footer:total',
  col: `${field}.${head}`,
  label: 'Portal data › As-filed GSTR-3B',
});

// --- RCM (rcm/RcmPartACard.tsx, rcm/RcmFlowsCard.tsx) ------------------------

/** 4G: the year's total of RCM Part A (3.1(d) month by month, or the annual 4G). */
export const rcmPartA = (head: Head): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'portal' },
  table: 'RCM Part A — as per GST portal',
  row: 'footer:total',
  col: head,
  label: 'RCM › Part A · portal',
});

/** 6C / 6D / 6F: the RCM ITC per GSTR-9 table, from the expenses set to it. */
export const rcmFlow = (table: '6C' | '6D' | '6F', head: Head): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'expenses' },
  table: 'Where the RCM figures are reported',
  row: table,
  col: head,
  label: `RCM › Where RCM flows (${table})`,
});

// --- Sales (sales/PartBGrid.tsx, sales/CapitalGoodsSold.tsx) ------------------

/**
 * A books Table 5 line (5A to 5F, 5G, 5H): Sales › Part B, whose ledgers carry the nature that lands
 * them in Table 5 (its "GSTR-9" column). 5H opens Part B's "of which credit notes" line, the rest its Total.
 */
export const salesT5 = (code: 'A' | 'B' | 'C' | 'C1' | 'D' | 'E' | 'F' | 'G' | 'H'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'b' },
  table: 'PL-OUTPUT Part B — non-taxable income',
  row: code === 'H' ? 'footer:5h' : 'footer:total',
  col: 'amount',
  label: code === 'H' ? 'Sales › Part B (credit notes → 5H)' : `Sales › Part B (ledgers of nature 5${code})`,
});

/** 7H: the s.18(6) shortfall on capital goods sold. */
export const salesCgSold: FigTarget = {
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: 'footer:total',
  col: 'shortfall',
  label: 'Sales › Capital goods sold',
};

// --- Duties & Taxes › Input (duties/InputTab.tsx) ----------------------------

/** 6A1 while not typed: the last year effect. */
export const dutiesLye = (head: Head): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Last year effect',
  row: 'lye',
  col: `lye.${head}`,
  label: 'Duties & Taxes › Last year effect',
});

/** 6H (reclaimed) and 7H1 (reversed): the suspended-ITC totals. */
export const dutiesSuspended = (row: 'rev' | 'rec', head: Head): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Suspended ITC totals',
  row,
  col: head,
  label: `Duties & Taxes › Suspended ITC ${row === 'rev' ? 'reversed' : 'reclaimed'}`,
});

// --- ITC reco (steps/ItcRecoStep.tsx) ------------------------------------------

/** A line of the ITC working (GSTR 9-INPUT; columns t / i / c / s / x). */
export const itcWorking = (row: 'inputs' | 'is' | 'cg' | 'imp' | 'total6O' | 'asPer3B' | '6J' | 't7J', head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR 9-INPUT: ITC working for GSTR-9',
  row,
  col: head,
  label: 'ITC reco › ITC working',
});

/** 6A1 typed on ITC reco. */
export const itc6A1 = (head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR-9 6A1',
  row: 't6A1',
  col: head,
  label: 'ITC reco › 6A1',
});

/** 8C while not typed here: Table 13 (the 8C line under Tables 12 and 13). */
export const itc8C = (head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'next' },
  table: 'GSTR-9 Tables 12 and 13',
  row: 'footer:8C',
  col: head,
  label: 'ITC reco › Tables 12 & 13',
});

/** 7A to 7G and 7H1 rows of the Table 7 entries (row ids r37 … tran2, h1). */
export type T7EntryRow = 'r37' | 'r37A' | 'r38' | 'r39' | 'r42' | 'r43' | 's17_5' | 'tran1' | 'tran2' | 'h1';
export const itcT7 = (row: T7EntryRow, head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'table7' },
  table: 'GSTR-9 Table 7A to 7H1',
  row,
  col: head,
  label: 'ITC reco › Table 7 entries',
});

/** ITC reco › Rule 42/43 (its tab): the approved Builder › ITC Reversal working posted in this FY, shown on that tab, which adds to 7C / 7D. */
export const itcBuilderReversal: FigTarget = {
  step: 'itc',
  tab: { itctab: 'rule42' },
  label: 'ITC reco › Rule 42/43 (Builder ITC Reversal working)',
};

/** A further 7H line (by its id), or the 7I / 7J totals under them (`footer:7I`, `footer:7J`). */
export const itcT7Extra = (row: string, head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'table7' },
  table: 'GSTR-9 Table 7H — further other reversals',
  row,
  col: `x7h.${head}`,
  label: 'ITC reco › Table 7 entries',
});

/** ITC reco › Table 6 / Table 8 entries (gstr9form/ItcEntries.tsx): the typed rows of GSTR-9 Tables 6 and 8, typed on ITC reco since 26 Nov 2026. */
export const itcEntry6 = (row: '6G' | '6K' | '6L' | '6M') => (head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR-9 Table 6 typed rows',
  row,
  col: head === 'i' || head === 'c' || head === 's' || head === 'x' ? head : undefined,
  label: `ITC reco › Table 6 entries › ${row}`,
});
export const itcEntry8 = (row: '8C' | '8E' | '8F' | '8G' | '8H1') => (head: Head): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'next' },
  table: 'GSTR-9 Table 8 typed rows',
  row,
  col: head === 'i' || head === 'c' || head === 's' || head === 'x' ? head : undefined,
  label: `ITC reco › Table 8 entries › ${row}`,
});
