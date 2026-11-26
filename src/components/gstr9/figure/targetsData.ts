// Figure links of the data steps (Portal data, Sales, Purchases & ITC, Duties
// & Taxes, RCM): where a locked or computed figure on those steps comes from,
// as a FigTarget naming the source step, its tab params, the source table's
// accessible label and the row id (figureLinks.ts). Each label and row id
// here is the one the source component renders; change both together.

import React from 'react';
import type { FigTarget } from '@/lib/gstr9/figureLinks';
import type { MonthKey, T5Key } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { FigLink } from './FigLink';

type Head = 't' | 'i' | 'c' | 's' | 'x';
type TaxHead = 'i' | 'c' | 's' | 'x';
const isTaxHead = (h: string): h is TaxHead => h === 'i' || h === 'c' || h === 's' || h === 'x';

/**
 * A computed money cell that opens its source (SheetGrid `render`), keeping
 * the grid's own look: blank for null, the "fx" mark for a remembered
 * expression.
 */
export const linkedMoney = (value: number | null | undefined, to: FigTarget | undefined, formula?: string): React.ReactNode => {
  if (value === null || value === undefined) return null;
  const link = React.createElement(FigLink, { to, children: fmtMoney(value) });
  if (!formula) return link;
  return React.createElement(
    'span',
    { className: 'inline-flex items-center gap-1' },
    React.createElement('span', { className: 'text-[9px] font-semibold text-info', 'aria-label': 'entered as a formula' }, 'fx'),
    link,
  );
};

// --- Portal data › As-filed GSTR-3B (portal/Gstr3bSection.tsx) -------------------

const G3B_RECO = 'As-filed GSTR-3B by month: output tax, ITC excluding RCM, RCM';

/**
 * A month (or the Total row) of the as-filed GSTR-3B grid "Output, ITC & RCM";
 * columns `<field>.<head>` (rcm has a value column `rcm.t` too).
 */
export const portal3b = (field: 'outTax' | 'itcExclRcm' | 'rcm', row: MonthKey | 'total', head?: Head): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr3b', g3btab: 'reco' },
  table: G3B_RECO,
  row: row === 'total' ? 'footer:total' : row,
  col: head ? `${field}.${head}` : undefined,
  label: 'Portal data › As-filed GSTR-3B',
});

// --- Portal data › GSTR-9 system computed (portal/Gstr9Section.tsx) ---------------

const g9Tab = (inner: string) => ({ portaltab: 'gstr9', g9portaltab: inner });

/** GSTR-9 Table 4 as auto-populated: a row (e.g. rchrg) or the Total row (excl. 4G). */
export const portalG9T4 = (row: 'total' | 'rchrg', head: Head): FigTarget => ({
  step: 'portal',
  tab: g9Tab('t4'),
  table: 'GSTR-9 Table 4 as auto-populated',
  row: row === 'total' ? 'footer:total' : row,
  col: head,
  label: row === 'total' ? 'Portal data › GSTR-9 Table 4' : 'Portal data › GSTR-9 Table 4G',
});

/** 6A / 6G / 8A as auto-populated (columns c / s / i / x). */
export const portalG9Itc = (key: 't6A' | 't6G' | 't8A', head: Head): FigTarget | undefined =>
  isTaxHead(head)
    ? { step: 'portal', tab: g9Tab('itc'), table: 'GSTR-9 ITC figures from the portal', row: key, col: head, label: `Portal data › GSTR-9 ${key.slice(1)}` }
    : undefined;

const T9_ROW: Record<TaxHead, string> = { i: 'igst', c: 'cgst', s: 'sgst', x: 'cess' };

/** GSTR-9 Table 9 from the portal: a head's tax payable, or its total paid (the grid's extra column). */
export const portalG9T9 = (col: 'payable' | 'paid', head: Head): FigTarget | undefined =>
  isTaxHead(head)
    ? {
        step: 'portal',
        tab: g9Tab('t9'),
        table: 'GSTR-9 Table 9 from the portal',
        row: T9_ROW[head],
        col: col === 'paid' ? '_extra' : 'payable',
        label: col === 'paid' ? 'Portal data › GSTR-9 Table 9 total paid' : 'Portal data › GSTR-9 Table 9 payable',
      }
    : undefined;

// --- Sales (sales/*.tsx) ------------------------------------------------------------

/** PL-OUTPUT Part A's Total row (columns taxable, tax.i / tax.c / tax.s / tax.x). */
export const salesPartATotal = (col: 'taxable' | TaxHead): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'a' },
  table: 'PL-OUTPUT Part A — taxable income',
  row: 'footer:total',
  col: col === 'taxable' ? 'taxable' : `tax.${col}`,
  label: 'Sales › Part A total',
});

/** PL-OUTPUT Part B's Total row. */
export const salesPartBTotal: FigTarget = {
  step: 'sales',
  tab: { salestab: 'b' },
  table: 'PL-OUTPUT Part B — non-taxable income',
  row: 'footer:total',
  col: 'amount',
  label: 'Sales › Part B total',
};

/** A line of the audit-report reconciliation (sales/AuditReconciliation.tsx). */
export const salesAuditLine = (row: 'total' | 'report' | 'diff'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'audit' },
  table: 'Total income: books against the audit report',
  row: row === 'diff' ? 'footer:diff' : row,
  col: 'amount',
  label: row === 'report' ? 'Sales › Audit report total' : row === 'total' ? 'Sales › Books total (Part A + B)' : 'Sales › Audit report difference',
});

/**
 * GSTR-9 › Table 5 (gstr9form/PartII.tsx, FormTable "GSTR-9 Table 5" keyed by code, e.g. 5A): the one
 * place books (Sales Part B, by nature) and the portal's Table 5 are compared (Position C). Without a
 * code it opens the table.
 */
export const gstr9T5Row = (code?: string): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '5' },
  table: code ? 'GSTR-9 Table 5' : undefined,
  row: code ? `5${code}` : undefined,
  col: code ? 't' : undefined,
  label: code ? `GSTR-9 › Table 5${code} (books vs portal)` : 'GSTR-9 › Table 5 (books vs portal)',
});

/** A books Table 5 line (A to H, as T5_BOOKS_CODE gives it): its row on GSTR-9 › Table 5, books beside the portal. */
const T5_BOOKS_ROWS = ['A', 'B', 'C', 'C1', 'D', 'E', 'F', 'G', 'H'];
export const salesT5Books = (code: string): FigTarget | undefined => (T5_BOOKS_ROWS.includes(code) ? gstr9T5Row(code) : undefined);

/** The books Table 5 row a GSTR-9 Table 5 key is compared with (as Gstr9Section's T5_BOOKS_ROW). */
export const T5_BOOKS_CODE: Partial<Record<T5Key, string>> = {
  zero_rtd: 'A', sez: 'B', rchrg: 'C', ecom_14: 'C1', exmt: 'D', nil: 'E', non_gst: 'F', cr_nt: 'H',
};

/** Capital goods sold: the year's Total row (sales/CapitalGoodsSold.tsx). */
export const salesCgTotal = (col: 'payable' | 'shortfall' | 'disposalValue'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: 'footer:total',
  col,
  label: 'Sales › Capital goods sold',
});

/**
 * The output tax on capital goods sold (the Total row's tax-on-value column):
 * where the part of Duties & Taxes › Output "As per P&L" from sales outside the
 * P&L revenue comes from (engine: cg.outTaxOutsidePl, the sales not ticked "In Sales ledgers").
 */
export const salesCgOutsidePl: FigTarget = {
  step: 'sales',
  tab: { salestab: 'cgsold' },
  table: 'Capital goods sold',
  row: 'footer:total',
  col: 'tv',
  label: 'Sales › Capital goods sold (output tax outside the P&L)',
};

/** A typed figure of the builder advance roll-forward (sales/BuilderAdvances.tsx, "FY … figures"). */
export const builderAdvFigure = (code: '5B' | '5C' | '5H' | '5I'): FigTarget => ({
  step: 'sales',
  tab: { salestab: 'advances' },
  table: 'Builder advance figures',
  row: code,
  label: `Sales › Advances (${code})`,
});

/** A row of GSTR-9C Table 5 (gstr9c/TurnoverPart.tsx FormGrid). */
export const c9T5 = (row: 'A' | 'P' | 'Q' | 'R'): FigTarget => ({
  step: 'gstr9c',
  tab: { gstr9ctab: '5' },
  table: 'GSTR-9C Table 5',
  row,
  col: 't',
  label: `GSTR-9C › 5${row}`,
});

// --- Purchases & ITC (purchases/PurchasesSummary.tsx) -----------------------------

/** A row of PL-INPUT rows 71 to 81 (columns t / i / c / s / x). */
export const purchasesSummaryRow = (row: '71' | '79' | '81', head?: Head): FigTarget => ({
  step: 'purchases',
  tab: { purchasestab: 'summary' },
  table: 'PL-INPUT rows 71 to 81',
  row,
  col: head,
  label: `Purchases › PL-INPUT row ${row}`,
});

// --- Duties & Taxes › Input (duties/InputTab.tsx) ---------------------------------

/** A footer line of the Input grid, e.g. netItc (row 26) — columns net.<head>. */
export const dutiesInputFooter = (row: 'netItc', head?: Head): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Input tax credit by month',
  row: `footer:${row}`,
  col: head && isTaxHead(head) ? `net.${head}` : undefined,
  label: 'Duties & Taxes › Net ITC (books, row 26)',
});

/** Suspended ITC net (I + L − O − R), the Suspended ITC totals card. */
export const dutiesSuspendedNet = (head: Head): FigTarget | undefined =>
  isTaxHead(head)
    ? { step: 'duties', tab: { dutiestab: 'input' }, table: 'Suspended ITC totals', row: 'net', col: head, label: 'Duties & Taxes › Suspended ITC net' }
    : undefined;

/** The Last year effect row (columns lye.<head>). */
export const dutiesLyeRow = (head: Head): FigTarget => ({
  step: 'duties',
  tab: { dutiestab: 'input' },
  table: 'Last year effect',
  row: 'lye',
  col: isTaxHead(head) ? `lye.${head}` : undefined,
  label: 'Duties & Taxes › Last year effect',
});

/** 6A1 typed on ITC reco (steps/ItcRecoStep.tsx). */
export const itcReco6A1 = (head: TaxHead): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'working' },
  table: 'GSTR-9 6A1',
  row: 't6A1',
  col: head,
  label: 'ITC reco › 6A1',
});

// --- RCM (rcm/*.tsx) -----------------------------------------------------------------

const RCM_B = 'RCM Part B — taxable value by expense and month';
const RCM_A = 'RCM Part A — as per GST portal';

/**
 * RCM Part B (books): a month or the Total row; columns b.t / b.<head>, or
 * `cat:<id>` for one expense. `lessNoItc`: the figure leaves out the expenses
 * with no ITC, which Part B's own total still holds.
 */
export const rcmPartB = (row: MonthKey | 'total', col: string, lessNoItc = false): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'books' },
  table: RCM_B,
  row: row === 'total' ? 'footer:total' : row,
  col,
  label: lessNoItc ? 'RCM › Part B · books (less the No ITC expenses)' : 'RCM › Part B · books',
});

/** RCM Part A (3.1(d) of the as-filed 3B): a month or the Total row; columns t / i / c / s / x. */
export const rcmPartA = (row: MonthKey | 'total', head?: Head, lessNoItc = false): FigTarget => ({
  step: 'rcm',
  tab: { rcmtab: 'portal' },
  table: RCM_A,
  row: row === 'total' ? 'footer:total' : row,
  col: head,
  label: lessNoItc ? 'RCM › Part A · portal (less the No ITC expenses)' : 'RCM › Part A · portal',
});

/** The RCM difference grid's Total row (Books − Portal). */
export const rcmDiffTotal: FigTarget = {
  step: 'rcm',
  tab: { rcmtab: 'compare' },
  table: 'RCM difference, books minus portal, by month',
  row: 'footer:total',
  label: 'RCM › Books vs portal',
};
