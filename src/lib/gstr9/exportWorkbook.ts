// Excel export of the Annual Return working, laid out like the firm's
// MASTER_PMS.xlsx — one sheet per workbook sheet, same sheet names, same row
// labels — plus a DIFFERENCES sheet with every difference line and its
// justification. Values, not formulas: every figure comes from
// computeWorkings(); the only things read from the docs are what staff typed
// (ledger names, tags, adjustment reasons, Tables 14–18 via exportPdf).
//
// SheetJS community edition writes number formats, column widths and merges
// but ignores fonts/fills, so totals are marked by their labels, not bold.

import * as XLSX from 'xlsx';
import {
  diffStatus,
  EXPENSE_HEAD_LABEL,
  NON_TAX_NATURE_LABEL,
  OUTWARD_CATEGORY_LABEL,
  resolveHead,
  tin,
  type DiffLine,
  type Workings,
} from './engine';
import { exportFileName, gstr9FormTables, noticeTables, type ExportMeta, type FormTable } from './exportPdf';
import {
  FY_MONTHS,
  type AdjustmentRow,
  type AnnualReturnDocs,
  type ExpenseHead,
  type Formulas,
  type InputSection,
  type MonthKey,
  type Tax,
  type ValTax,
} from './types';

export type { ExportMeta } from './exportPdf';

// ---------------------------------------------------------------------------
// A tiny sheet builder: rows start at column B, like the firm's sheets
// ---------------------------------------------------------------------------

const MONEY = '#,##0.00';
const RATE = '0.00';
const GENERAL = 'General';

type Val = string | number | null | undefined;
interface Fmt { v: Val; z?: string; /** Cell comment — the "=a+b" staff typed. */ note?: string }
type Cell = Val | Fmt;

/** A typed figure, carrying the expression staff typed (if any) as a cell comment. */
const typed = (v: number | null | undefined, f: Formulas | undefined, key: string): Cell => {
  const expr = f?.[key];
  return expr ? { v: v ?? 0, note: `Entered as ${expr}` } : v;
};

const sr = (n: number): Fmt => ({ v: n, z: GENERAL });
const rate = (n: number | null | undefined): Fmt => ({ v: n ?? null, z: RATE });

const round2 = (n: number): number => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) || Math.abs(r) < 0.005 ? 0 : r;
};

class Sheet {
  private rows: Cell[][] = [[]];
  private merges: XLSX.Range[] = [];

  /** `party` goes in B2, as on every sheet of the firm's workbook. */
  constructor(public readonly name: string, private widths: number[], party?: string) {
    if (party !== undefined) this.rows.push([null, party]);
  }

  /** Append a row whose first cell lands in column B. Returns its 0-based row index. */
  add(...cells: Cell[]): number {
    this.rows.push([null, ...cells]);
    return this.rows.length - 1;
  }

  blank(): void {
    this.rows.push([]);
  }

  /** Merge columns [from..to] (0-based from column B) on a row, for titles. */
  merge(row: number, from: number, to: number): void {
    if (to > from) this.merges.push({ s: { r: row, c: from + 1 }, e: { r: row, c: to + 1 } });
  }

  /** A title row spanning `span` columns. */
  title(text: string, span: number): void {
    const r = this.add(text);
    this.merge(r, 0, span - 1);
  }

  toWorksheet(): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {};
    let maxC = 1;
    this.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const { v, z, note } = cell !== null && typeof cell === 'object' ? cell : { v: cell, z: undefined, note: undefined };
        if (v === null || v === undefined || v === '') return;
        const ref = XLSX.utils.encode_cell({ r, c });
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) return;
          // Full precision, rounded by the number format — so a column of cells adds up to its TOTAL.
          ws[ref] = { t: 'n', v: z === GENERAL ? v : Math.abs(v) < 0.005 ? 0 : v, z: z ?? MONEY };
        } else {
          ws[ref] = { t: 's', v: String(v) };
        }
        if (note) {
          const comments = [{ a: 'GST Keeper', t: note }] as XLSX.Comments;
          comments.hidden = true;
          ws[ref].c = comments;
        }
        maxC = Math.max(maxC, c);
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(this.rows.length - 1, 1), c: maxC } });
    ws['!cols'] = [{ wch: 2 }, ...this.widths.map((wch) => ({ wch }))];
    if (this.merges.length) ws['!merges'] = this.merges;
    return ws;
  }
}

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

type Head = keyof Tax;

/**
 * The firm's sheets carry IGST/CGST/SGST only; Cess columns are added only
 * when the working has any cess — anywhere (a single D&T adjustment or a
 * typed Table 12 figure counts), so no cess figure is silently dropped.
 */
const hasCess = (w: Workings): boolean => {
  const seen = new WeakSet<object>();
  const walk = (o: unknown, depth: number): boolean => {
    if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return false;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    if (typeof rec.x === 'number' && typeof rec.c === 'number' && Math.abs(rec.x) > 0.004) return true;
    return Object.values(rec).some((v) => walk(v, depth + 1));
  };
  return walk(w, 0);
};

const HEAD_LABEL: Record<Head, string> = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'CESS' };

const MONTH_FULL: Record<MonthKey, string> = {
  apr: 'APRIL', may: 'MAY', jun: 'JUNE', jul: 'JULY', aug: 'AUGUST', sep: 'SEPTEMBER',
  oct: 'OCTOBER', nov: 'NOVEMBER', dec: 'DECEMBER', jan: 'JANUARY', feb: 'FEBRUARY', mar: 'MARCH',
};
const MONTH_SHORT: Record<MonthKey, string> = {
  apr: 'APR', may: 'MAY', jun: 'JUN', jul: 'JUL', aug: 'AUG', sep: 'SEP',
  oct: 'OCT', nov: 'NOV', dec: 'DEC', jan: 'JAN', feb: 'FEB', mar: 'MAR',
};

/** Step names for the DIFFERENCES sheet (mirrors src/components/gstr9/steps/registry.ts). */
const STEP_NAME: Record<string, string> = {
  overview: '0 · Overview', portal: '1 · Portal data', sales: '2 · Sales (PL-OUTPUT)', purchases: '3 · Purchases & ITC (PL-INPUT)',
  duties: '4 · Duties & Taxes', rcm: '5 · RCM', outward: '6 · Outward reco (GSTR 9-OUTPUT)', itc: '7 · ITC reco (GSTR 9-INPUT)',
  expense: '8 · 9C expense heads (GSTR 9C)', annexures: '9 · Annexures', gstr9: '10 · GSTR-9', gstr9c: '11 · GSTR-9C',
  notice: '12 · Notice format', review: '13 · Review & lock',
};

const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-IN');
};

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

interface Ctx {
  docs: AnnualReturnDocs;
  w: Workings;
  meta: ExportMeta & { status?: string };
  heads: Head[];
  /** Justification text for a diff line key ('' when none). */
  just: (key: string) => string;
}

const taxCells = (t: Tax, heads: Head[]): number[] => heads.map((h) => t[h]);
/** Ledger-row tax cells; the Sales / Purchases grids remember expressions under "tax.i" … "tax.x". */
const typedTax = (t: Tax, heads: Head[], f: Formulas | undefined): Cell[] => heads.map((h) => typed(t[h], f, `tax.${h}`));
const valCells = (v: ValTax, heads: Head[]): number[] => [v.t, ...taxCells(v, heads)];

function masterSheet({ meta, w }: Ctx): Sheet {
  const s = new Sheet('MASTER', [22, 48]);
  s.title('PARTY DETAILS', 2);
  s.blank();
  s.add('PARTY NAME', meta.clientName);
  s.add('YEAR', meta.financialYear);
  s.add('GSTIN', meta.gstin);
  s.add('ADDRESS', '');
  s.blank();
  s.add('STATUS', meta.status ?? '');
  s.add('OPEN DIFFERENCES', { v: w.openCount, z: GENERAL });
  s.add('TOLERANCE PER HEAD (₹)', w.tolerance);
  s.add('EXPORTED ON', new Date().toLocaleString('en-IN'));
  return s;
}

function plOutputSheet({ docs, w, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('PL-OUTPUT', [8, 44, 18, ...heads.map(() => 16), 12, 12, 26, 14], meta.clientName);
  const span = 3 + heads.length + 5;
  s.blank();
  s.title('SALES BIFURCATION WORKING', span);
  s.blank();
  s.title('PART A - TAXABLE INCOME ONLY (INCLUDING ALL EXPORTS (WITH OR WITHOUT), SEZ SALES & DEEMED EXPORTS)', span);
  s.blank();
  s.add('SR NO', 'PARTICULARS', 'AMOUNT', ...heads.map((h) => HEAD_LABEL[h]), 'RATE OF TAX', 'RATE (STATED)', 'GSTR-9 TABLE 4', 'SUPPLY');
  docs.sales.partA.forEach((r, i) => {
    const c = w.sales.rows[r.id];
    const t = c?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
    s.add(
      sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), ...typedTax(t, heads, r.f),
      rate(c?.impliedRate), rate(r.rate),
      c?.isReturn ? 'Credit note (4I)' : OUTWARD_CATEGORY_LABEL[r.category] ?? r.category,
      r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
    );
  });
  s.blank();
  s.add('TOTAL INCOME - PART A', '', ...valCells(w.sales.partA, heads));
  s.blank();
  s.title('NOTE : SHOW SALES RETURN OF EACH LEDGER IN A DIFFERENT ROW WITH NEGATIVE VALUES', span);
  s.blank();
  s.title('PART B - NON-TAXABLE INCOME ONLY', span);
  s.blank();
  s.add('SR NO', 'PARTICULARS', 'AMOUNT', 'BIFURCATION');
  // A negative row (a credit note) is reported in 5H, whatever its nature — say so, as Part A does for 4I.
  docs.sales.partB.forEach((r, i) => s.add(
    sr(i + 1), r.ledger, typed(r.amount, r.f, 'amount'),
    (Number(r.amount) || 0) < 0 && r.nature !== 'not_in_gstr9' ? 'Credit note (5H)' : NON_TAX_NATURE_LABEL[r.nature] ?? r.nature,
  ));
  s.blank();
  s.add('TOTAL INCOME - PART B', '', w.sales.partBTotal);
  s.blank();
  s.add('TOTAL INCOME - PART A+B', '', w.sales.total, '<<< THIS SHOULD BE MATCHED WITH AUDIT REPORT');
  s.blank();
  s.add('AS PER REPORT', '', w.sales.auditReportTotal ?? null);
  s.blank();
  s.add('DIFFERENCE (REPORT - BOOKS)', '', w.sales.auditDiff ?? null, just('sales.audit'));
  return s;
}

const SECTION_TITLE: Record<InputSection, [string, string]> = {
  purchase: ['(A) PURCHASE', 'TOTAL PURCHASE'],
  expense: ['(B) DIRECT & INDIRECT EXPENSE', 'TOTAL INDIRECT EXPENSE'],
  capital_goods: ['(C) CAPITAL GOODS', 'TOTAL CAPITAL GOODS'],
};

function plInputSheet({ docs, w, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('PL-INPUT', [8, 44, 18, ...heads.map(() => 16), 10, 12, 36, 12]);
  const span = 3 + heads.length + 4;
  s.add('PARTY NAME :-', meta.clientName);
  s.add('YEAR:-', meta.financialYear);
  s.blank();
  s.add('SR NO', 'HEAD IN BOOKS', 'TAXABLE VALUE', ...heads.map((h) => HEAD_LABEL[h]), 'RATE', 'RATE (STATED)', 'GSTR-9C EXPENSE HEAD', 'SUPPLY');
  (['purchase', 'expense', 'capital_goods'] as InputSection[]).forEach((sec) => {
    s.blank();
    s.title(SECTION_TITLE[sec][0], span);
    s.blank();
    docs.purchases.rows.filter((r) => r.section === sec).forEach((r, i) => {
      const c = w.purchases.rows[r.id];
      const t = c?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
      const head = c?.head ?? resolveHead(r);
      s.add(
        sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), ...typedTax(t, heads, r.f),
        rate(c?.impliedRate), rate(r.rate), EXPENSE_HEAD_LABEL[head] ?? head,
        r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
      );
    });
    s.blank();
    s.add(SECTION_TITLE[sec][1], '', ...valCells(w.purchases.sections[sec], heads));
  });
  const P = w.purchases;
  s.blank();
  s.add('TOTAL ITC AS PER P&L', '', ...valCells(P.totalPl, heads));
  s.blank();
  s.add('SUSPENDED ITC AS PER DUTIES & TAXES (Dr - Cr)', '', 0, ...taxCells(P.suspended, heads));
  s.blank();
  s.add('SUSPENDED ITC AS PER DUTIES & TAXES (OTHER ADJ)', '', 0, ...taxCells(P.otherAdj, heads));
  s.blank();
  s.add('RCM CREDIT (RCM SHEET PART B - AS PER BOOKS)', '', ...valCells(P.rcmCredit, heads));
  s.blank();
  s.add(`NET ITC FOR ${meta.financialYear}`, '', ...valCells(P.netItc, heads));
  s.add('AS PER DUTIES & TAXES-INPUT (NET)', '', null, ...taxCells(P.dtNet, heads));
  s.add('DIFFERENCE (P&L - D&T)', '', null, ...taxCells(P.diffVsDt, heads), just('purchases.dt'));
  return s;
}

function adjustmentBlock(s: Sheet, title: string, rows: AdjustmentRow[], total: Tax, heads: Head[], reasonHead: string): void {
  s.blank();
  s.title(title, 2 + heads.length);
  s.blank();
  s.add('MONTH', ...heads.map((h) => HEAD_LABEL[h]), reasonHead);
  rows.forEach((a) => s.add(a.month ? MONTH_FULL[a.month] : '', ...taxCells(tin(a), heads), a.reason || ''));
  s.add('TOTAL', ...taxCells(total, heads));
}

function dtoSheet({ w, docs, meta, heads, just }: Ctx): Sheet {
  const n = heads.length;
  const s = new Sheet('DUTIES & TAXES-OUTPUT', [12, ...Array(5 * n).fill(15), 48], meta.clientName);
  s.blank();
  s.title('OUTPUT WORKING SHEET', 1 + 5 * n);
  s.blank();
  const groups = ['SALES', 'CREDIT NOTE', 'NET SALES', 'AS PER 3B', 'DIFF (BOOKS - 3B)'];
  const r = s.add('MONTH', ...groups.flatMap((g) => [g, ...Array(n - 1).fill('')]), 'JUSTIFICATION');
  groups.forEach((_, gi) => s.merge(r, 1 + gi * n, gi * n + n));
  s.add('', ...groups.flatMap(() => heads.map((h) => HEAD_LABEL[h])));
  FY_MONTHS.forEach((m) => {
    const x = w.dto.months[m];
    s.add(MONTH_SHORT[m], ...[x.sales, x.cn, x.net, x.asPer3B, x.diff].flatMap((t) => taxCells(t, heads)), just(`dto.${m}`));
  });
  const T = w.dto.totals;
  s.add('TOTAL', ...[T.sales, T.cn, T.net, T.asPer3B, T.diff].flatMap((t) => taxCells(t, heads)));
  s.blank();
  s.add('AS PER P & L (PL-OUTPUT PART A)', ...Array(2 * n).fill(null), ...taxCells(w.dto.asPerPl, heads));
  s.add('DIFF WITH REASON? (P&L - NET SALES)', ...Array(2 * n).fill(null), ...taxCells(w.dto.plDiff, heads), ...Array(2 * n).fill(null), just('dto.pl'));
  adjustmentBlock(s, 'OTHER ADJUSTMENTS IN CR SIDE', docs.duties_output.adjustments, w.dto.adjustments, heads, 'REASON OF ADJ.');
  s.blank();
  s.add('TOTAL CR SIDE', ...taxCells(w.dto.totalCrSide, heads));
  return s;
}

function dtiSheet({ w, docs, meta, heads, just }: Ctx): Sheet {
  const n = heads.length;
  const s = new Sheet('DUTIES & TAXES-INPUT', [30, ...Array(9 * n).fill(14), 48], meta.clientName);
  s.blank();
  s.title('INPUT WORKING SHEET EXCLUDING RCM', 1 + 9 * n);
  s.blank();
  const groups = [
    'PURCHASE', 'DEBIT NOTE', 'SUSPENDED ITC (REVERSED)', 'SUSPENDED ITC (REVERSED)-180DAYS', 'SUSPENDED ITC (RECLAIM)',
    'SUSPENDED ITC (RECLAIM)-180DAYS', 'NET PURCHASE', 'AS PER 3B', 'DIFF (BOOKS - 3B)',
  ];
  const r = s.add('MONTH', ...groups.flatMap((g) => [g, ...Array(n - 1).fill('')]), 'JUSTIFICATION');
  groups.forEach((_, gi) => s.merge(r, 1 + gi * n, gi * n + n));
  s.add('', ...groups.flatMap(() => heads.map((h) => HEAD_LABEL[h])));
  const pad = (k: number) => Array(k * n).fill(null);
  // Last Year Effect sits in NET PURCHASE only (no 3B month); its difference is carried so the column adds up.
  s.add('LAST YEAR EFFECT', ...pad(6), ...taxCells(w.dti.lye, heads), ...pad(1), ...taxCells(w.dti.lye, heads));
  FY_MONTHS.forEach((m) => {
    const x = w.dti.months[m];
    s.add(MONTH_SHORT[m], ...[x.purchase, x.dn, x.sr, x.sr180, x.rc, x.rc180, x.net, x.asPer3B, x.diff].flatMap((t) => taxCells(t, heads)), just(`dti.${m}`));
  });
  const T = w.dti.totals;
  s.add('TOTAL', ...[T.purchase, T.dn, T.sr, T.sr180, T.rc, T.rc180, T.net, T.asPer3B, T.diff].flatMap((t) => taxCells(t, heads)));
  s.add('RCM TAX FIGURES ONLY', ...pad(6), ...taxCells(w.dti.rcmBooks, heads), ...taxCells(w.dti.rcmPortal, heads), ...taxCells(w.dti.rcmDiff, heads));
  s.add('TOTAL ITC FOR THE YEAR (TO BE MATCHED WITH ANNUAL GSTR-3B)', ...pad(6), ...taxCells(w.dti.totalItcBooks, heads), ...taxCells(w.dti.totalItcPortal, heads), ...taxCells(w.dti.totalItcDiff, heads));
  s.add('LAST YEAR EFFECT', ...pad(6), ...taxCells(w.dti.lye, heads));
  s.add('NET', ...pad(6), ...taxCells(w.dti.net, heads));
  s.add('AS PER P&L (PL-INPUT NET ITC)', ...pad(6), ...taxCells(w.dti.asPerPl, heads));
  s.add('DIFF (P&L - NET)', ...pad(6), ...taxCells(w.dti.plDiff, heads), ...pad(2), just('dti.pl'));
  adjustmentBlock(s, 'OTHER ADJUSTMENTS IN DR SIDE', docs.duties_input.adjustments, w.dti.adjustments, heads, 'REASON OF ADJ.');
  s.blank();
  s.add('TOTAL DR', ...taxCells(w.dti.totalDr, heads));
  return s;
}

function rcmSheet({ w, docs, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('RCM', [8, 16, 16, ...heads.map(() => 15), 48], meta.clientName);
  const span = 3 + heads.length;
  const hdr = () => s.add('SR NO', 'MONTH', 'TAXABLE', ...heads.map((h) => HEAD_LABEL[h]));
  const months = (get: (m: MonthKey) => ValTax, extra?: (m: MonthKey) => string) =>
    FY_MONTHS.forEach((m, i) => s.add(sr(i + 1), MONTH_FULL[m], ...valCells(get(m), heads), extra ? extra(m) : ''));

  const src = w.rcm.partASource;
  s.blank();
  s.title(`PART A - AS PER GST PORTAL (${src === 'monthly' ? 'as-filed GSTR-3B 3.1(d)' : src === 'gstr9' ? 'GSTR-9 Table 4G, annual' : 'not fetched'})`, span);
  s.blank();
  hdr();
  if (src === 'gstr9') s.add('', 'ANNUAL (GSTR-9 4G)', ...valCells(w.rcm.partA, heads));
  else months((m) => w.rcm.partAMonths[m]);
  s.add('TOTAL', '', ...valCells(w.rcm.partA, heads));
  s.blank();
  s.title('PART B - AS PER BOOKS', span);
  s.blank();
  hdr();
  months((m) => w.rcm.partBMonths[m]);
  s.add('TOTAL', '', ...valCells(w.rcm.partB, heads));
  s.blank();
  s.title('DIFFERENCE (PART B - PART A: BOOKS - PORTAL)', span);
  s.blank();
  s.add('SR NO', 'MONTH', 'TAXABLE', ...heads.map((h) => HEAD_LABEL[h]), 'JUSTIFICATION');
  if (src === 'gstr9') s.add('', 'ANNUAL', ...valCells(w.rcm.diff, heads), just('rcm.annual'));
  else months((m) => w.rcm.diffMonths[m], (m) => just(`rcm.${m}`));
  s.add('TOTAL', '', ...valCells(w.rcm.diff, heads));
  s.blank();
  s.title('NOTE - PART B IS THE SUM OF THE EXPENSE CATEGORIES BELOW (ALL CATEGORIES, TAXABLE VALUE INCLUDED).', span);
  docs.rcm.categories.forEach((cat) => {
    const calc = w.rcm.categories[cat.id];
    if (!calc) return;
    s.blank();
    s.title(`${(cat.name || 'RCM EXPENSE').toUpperCase()} (${cat.rate}% · ${cat.supplyType === 'inter' ? 'INTER-STATE' : 'INTRA-STATE'} · GSTR-9 TABLE ${cat.itcTable || '6C'})`, span);
    s.blank();
    hdr();
    months((m) => calc.months[m]);
    s.add('TOTAL', '', ...valCells(calc.total, heads));
  });
  return s;
}

/** "B2B (4B)" — the table code is appended unless the engine's label already carries it. */
const outwardLabel = (r: Workings['outward']['rows'][number]): string =>
  /\(4[A-Z]/.test(r.label) ? r.label.toUpperCase() : `${r.label.toUpperCase()} (${r.table})`;

function gstr9OutputSheet({ w, meta, heads, just }: Ctx): Sheet {
  const n = heads.length;
  const s = new Sheet('GSTR 9-OUTPUT', [40, 18, ...heads.map(() => 16), 3, 40, 18, ...heads.map(() => 16), 48], meta.clientName);
  const blockW = 2 + n;
  s.blank();
  const r0 = s.add('(A) DATA AS PER BOOKS', ...Array(blockW).fill(null), '(B) DATA AUTO POPULATED AS PER GSTR 9');
  s.merge(r0, 0, blockW - 1);
  s.merge(r0, blockW + 1, 2 * blockW);
  s.blank();
  const hd = ['PARTICULARS', 'TAXABLE', ...heads.map((h) => HEAD_LABEL[h])];
  s.add(...hd, null, ...hd);
  w.outward.rows.forEach((r) => {
    const label = `${outwardLabel(r)}${r.subtract ? ' (-)' : ''}`;
    s.add(label, ...valCells(r.books, heads), null, label, ...valCells(r.portal, heads));
  });
  s.blank();
  s.add('TOTAL', ...valCells(w.outward.booksTotal, heads), null, 'TOTAL', ...valCells(w.outward.portalTotal, heads));
  s.blank();
  s.title('DIFFERENCE BETWEEN A & B (A - B)', blockW + 1);
  s.blank();
  s.add('PARTICULARS', 'TAXABLE', ...heads.map((h) => HEAD_LABEL[h]), 'JUSTIFICATION');
  w.outward.rows.forEach((r) => s.add(`${outwardLabel(r)}${r.subtract ? ' (-)' : ''}`, ...valCells(r.diff, heads), just(`out.${r.key}`)));
  s.blank();
  s.add('TOTAL', ...valCells(w.outward.diffTotal, heads), just('out.total'));
  return s;
}

function gstr9InputSheet({ w, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('GSTR 9-INPUT', [66, 18, ...heads.map(() => 16), 18, 48], meta.clientName);
  const I = w.itc;
  const sum = (t: Tax) => heads.reduce((a, h) => a + t[h], 0);
  const vrow = (label: string, v: ValTax | null, t: Tax, note = '') => s.add(label, v ? v.t : null, ...taxCells(t, heads), sum(t), note);
  s.blank();
  s.title('ITC WORKING FOR GSTR 9', 4 + heads.length);
  s.blank();
  s.add('PARTICULARS', 'TAXABLE', ...heads.map((h) => HEAD_LABEL[h]), 'TOTAL TAX', 'NOTE');
  vrow('INPUT (6B INPUTS)', I.inputs, I.inputs);
  vrow('INPUT SERVICES (6B INPUT SERVICES — BALANCING FIGURE)', I.inputServices, I.inputServices, 'Tax = 6A2 less every other row, so 6(O) ties to 6A2');
  vrow('   of which: ITC booked on these ledgers (for reference)', null, I.inputServicesBooks);
  vrow('IMPORT OF GOODS (6E)', I.importGoods, I.importGoods);
  vrow('CAPITAL GOODS (6B CAPITAL GOODS)', I.capitalGoods, I.capitalGoods);
  vrow('RCM (RCM SHEET PART B - AS PER BOOKS)', I.rcm, I.rcm);
  vrow('ITC RECLAIM (6H)', null, I.reclaim);
  vrow('ISD (6G)', null, I.isd);
  vrow('TRAN-1 / TRAN-2 / ITC-01, 02, 02A (6N)', null, I.t6N);
  s.blank();
  vrow('AS PER 3B (6A2 = 6A - 6A1)', null, I.asPer3B);
  s.blank();
  vrow('TOTAL (SHOULD BE MATCHED WITH 6(O) OF GSTR 9)', I.total, I.total);
  s.blank();
  vrow('ITC REVERSAL (7H1 - SUSPENDED ITC REVERSED)', null, I.reversal7H1);
  vrow('AS PER SECTION 17(5) (7E)', null, I.s17_5);
  vrow('OTHER REVERSALS (7A-7D, 7F, 7G, OTHER 7H)', null, I.otherReversals);
  s.blank();
  vrow('TOTAL (SHOULD BE MATCHED WITH 7(J) OF GSTR 9)', null, I.total7J);
  s.blank();
  vrow('AS PER BOOK (DUTIES & TAXES NET, AFTER LAST YEAR EFFECT)', null, I.asPerBook);
  vrow('DIFFERENCE (7J - BOOK)', null, I.residual, just('itc.books'));
  s.blank();
  vrow('ITC TO BE REVERSED IN NEXT YEAR (TABLE 12; 8C AS NEGATIVE) — SUGGESTED', null, I.t12Suggested);
  vrow(`   Table 12 used (${w.g9.t12Source === 'override' ? 'typed' : 'computed'})`, null, w.g9.t12);
  vrow('ITC TO BE CLAIMED IN NEXT YEAR (TABLE 13; 8C) — SUGGESTED', null, I.t13Suggested);
  vrow('   Table 13 typed', null, w.g9.t13);
  return s;
}

const C14_ROWS: Array<[string, string, ExpenseHead | null]> = [
  ['A', 'PURCHASES', 'purchases'],
  ['A1', 'SUSPENDED ITC', null],
  ['A2', 'NET PURCHASE ( A - A1 )', null],
  ['B', 'FREIGHT / CARRIAGE', 'freight'],
  ['C', 'POWER AND FUEL', 'power_fuel'],
  ['D', 'IMPORTED GOODS (INCLUDING RECEIVED FROM SEZS)', 'imported_goods'],
  ['E', 'RENT AND INSURANCE', 'rent_insurance'],
  ['F', 'GOODS LOST, STOLEN, DESTROYED, WRITTEN OFF OR DISPOSED OF BY WAY OF GIFT OR FREE SAMPLES', 'goods_lost'],
  ['G', 'ROYALTY', 'royalty'],
  ['H', "EMPLOYEES' COST (SALARIES, BONUS ETC.)", 'employees_cost'],
  ['I', 'CONVEYANCE CHARGES', 'conveyance'],
  ['J', 'BANK CHARGES', 'bank_charges'],
  ['K', 'ENTERTAINMENT CHARGES', 'entertainment'],
  ['L', 'STATIONERY EXPENSES (INCLUDING POSTAGE ETC.)', 'stationery'],
  ['M', 'REPAIR AND MAINTENANCE', 'repair_maintenance'],
  ['N', 'OTHER MISCELLANEOUS EXPENSES', 'other_misc'],
  ['O', 'CAPITAL GOODS', 'capital_goods'],
  ['P', 'ANY OTHER EXPENSE 1 (RCM)', null],
  ['Q', 'ANY OTHER EXPENSE 2', 'other2'],
];

function gstr9cSheet({ w, docs, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('GSTR 9C', [8, 58, 18, ...heads.map(() => 16), 16, 70], meta.clientName);
  const sum = (t: Tax) => heads.reduce((a, h) => a + t[h], 0);
  const ledgers: Partial<Record<ExpenseHead, string[]>> = {};
  docs.purchases.rows.forEach((r) => {
    const h = w.purchases.rows[r.id]?.head ?? resolveHead(r);
    (ledgers[h] ||= []).push(r.ledger || '(unnamed)');
  });
  s.blank();
  s.title('ITC WORKING FOR THE PURPOSE OF GSTR 9C', 5 + heads.length);
  s.blank();
  s.add('SR NO', 'PARTICULARS', 'VALUE', ...heads.map((h) => HEAD_LABEL[h]), 'TOTAL TAX', 'LEDGERS (PL-INPUT)');
  C14_ROWS.forEach(([k, label, head]) => {
    const v = w.c14.rows[k];
    if (!v) return;
    let note = head ? (ledgers[head] ?? []).join(', ') : '';
    if (k === 'A1') note = 'Duties & Taxes suspended ITC (reversed - reclaimed)';
    if (k === 'P') note = 'RCM sheet Part B';
    if (k === 'Q') note = [note, `balancing figure ${round2(w.c14.qBalancing.t)} value / ${round2(sum(w.c14.qBalancing))} tax`].filter(Boolean).join(' · ');
    s.add(k, label, ...valCells(v, heads), sum(v), note);
  });
  s.blank();
  s.add('R', 'TOTAL AMOUNT OF ELIGIBLE ITC AVAILED', ...valCells(w.c14.rows.R, heads), sum(w.c14.rows.R));
  s.add('', 'NET ITC AS PER PL-INPUT', ...valCells(w.purchases.netItc, heads), sum(w.purchases.netItc));
  s.add('', 'CHECK (PL-INPUT - R)', ...valCells(w.c14.check, heads), sum(w.c14.check));
  s.blank();
  s.add('S', 'ITC CLAIMED IN GSTR-9 (7J)', null, ...taxCells(w.c14.S, heads), sum(w.c14.S));
  s.add('T', 'UN-RECONCILED ITC (R - S)', null, ...taxCells(w.c14.T, heads), sum(w.c14.T), just('gstr9c.14T'));
  return s;
}

function annexureSheet({ w, docs, meta, heads, just }: Ctx): Sheet {
  const s = new Sheet('ANNEXURE', [12, 70, 18, 16, 16, 16, 16, 48], meta.clientName);
  const all: Head[] = ['i', 'c', 's', 'x'];
  s.add(`YEAR : ${meta.financialYear}`);
  s.blank();

  // Annexure-1
  const A1 = w.ann1;
  s.title('ANNEXURE-1 (INCOME RECO.)', 3 + heads.length);
  s.blank();
  s.add('SR NO', 'PARTICULARS', 'AMOUNT', ...heads.map((h) => HEAD_LABEL[h]));
  s.add('A', 'GROSS TAXABLE INCOME AS PER P/L', ...valCells(A1.A, heads));
  s.add('', 'NET NON-GST INCOME AS PER P/L', A1.nonGst);
  s.add('B', 'SALE RETURN AS PER P/L', ...valCells(A1.B, heads));
  s.add('C: A-B', 'TOTAL INCOME FROM P/L', ...valCells(A1.C, heads));
  s.add('D', 'TAX PAID ON RCM AS PER BOOKS', ...valCells(A1.D, heads));
  s.add('E: C+D', 'TOTAL AS PER NEW GSTR 9', ...valCells(A1.E, heads));
  s.add('F', 'TOTAL AS PER AUTO CALCULATED GSTR 9', ...valCells(A1.F, heads));
  s.add('G= E-F', 'DIFFERENCE', ...valCells(A1.G, heads), just('ann1.income'));
  s.blank();
  s.add('', 'PAID & PAYABLE');
  s.add('', 'PARTICULARS', 'PAYABLE', 'PAID', 'DIFF.', 'JUSTIFICATION');
  heads.forEach((h, i) => s.add('', HEAD_LABEL[h], A1.payable[h], A1.paid[h], A1.payDiff[h], i === 0 ? just('ann1.paid') : ''));
  s.blank();

  // Annexure-2
  const A2 = w.ann2;
  s.title('ANNEXURE-2 (ITC RECO.)', 2 + heads.length);
  s.blank();
  s.add('SR NO', 'PARTICULARS', ...heads.map((h) => HEAD_LABEL[h]));
  const a2 = (code: string, label: string, t: Tax) => s.add(code, label, ...taxCells(t, heads));
  a2('A', 'DR. BALANCE OF ITC LEDGER', A2.A);
  a2('A1', 'RCM - ITC', A2.A1);
  a2('A2', 'DEBIT NOTE', A2.A2);
  a2('B', 'OTHER ADJUSTMENT IN DR./CR. SIDE', A2.B);
  a2('C=A+A1-A2-B', 'NET ITC AVAILED', A2.C);
  a2('D', 'ITC OF THIS YEAR CLAIMED IN NEXT YEAR (EFFECT TO BE GIVEN IN CLAUSE 11 & 12 OF GSTR-09)', A2.D);
  a2('E=C+D', 'TOTAL', A2.E);
  a2('F', 'AS PER PORTAL (CLAUSE 6A AUTO POPULATED, WHICH INCLUDES ITC OF PREVIOUS YEAR CLAIMED IN THIS YEAR & ITC OF THIS YEAR)', A2.F);
  a2('G1', 'REVERSAL AS PER 7(H1)', A2.G1);
  a2('G2', 'REST OF TABLE 7 (7A-7G AND OTHER 7H LINES)', A2.G2);
  a2('H', 'ITC OF PREVIOUS YEAR CLAIMED IN THIS YEAR', A2.H);
  a2('I=F-G1-G2-H', 'NET ITC', A2.I);
  s.add('J=E-I', 'EXCESS ITC CLAIMED / TO BE CLAIMED', ...taxCells(A2.J, heads), just('ann2.J'));
  s.blank();

  // Annexure-3 (always with Cess, as the sheet)
  const A3 = w.ann3;
  s.title('ANNEXURE-3 (DRC 03 CALCULATION)', 6);
  s.blank();
  s.add('SR NO', 'PARTICULARS', ...all.map((h) => HEAD_LABEL[h]));
  s.add(sr(1), 'CLAUSE 9 DIFFERENCE OF GSTR 9', ...taxCells(A3.clause9, all));
  s.add(sr(2), `RCM TO BE PAID (AS PER RCM SHEET)${docs.annexures.a3RcmToPay === null ? ' — suggested' : ''}`, ...taxCells(A3.rcmToPay, all));
  s.add(sr(3), `EXCESS ITC CLAIMED AS PER RECO${docs.annexures.a3ExcessItc === null ? ' — suggested (Table 12)' : ''}`, ...taxCells(A3.excessItc, all));
  s.add(sr(4), 'ANY OTHER PAYMENT (TO BE SPECIFIED)', ...taxCells(A3.other, all));
  docs.annexures.a3Other.forEach((o) => s.add('', `   ${o.description || 'Other'}`, ...taxCells(tin(o), all)));
  s.add('TOTAL', '', ...taxCells(A3.total, all));
  s.blank();
  s.add('', 'DRC-03 PAYABLE (POSITIVE HEADS)', ...taxCells(A3.payable, all));
  s.add('', 'EXCESS PAID (NEGATIVE HEADS)', ...taxCells(A3.excessPaid, all));
  s.add('', 'DRC-03 ALREADY PAID', ...taxCells(A3.alreadyPaid, all));
  s.add('', 'BALANCE TO PAY', ...taxCells(A3.balance, all));
  s.blank();

  // Annexure-4
  s.title('ANNEXURE-4 (DETAILS OF PREVIOUS YEAR GSTR-09 CLAUSE-8, 10, 11, 12 & 13)', 6);
  s.blank();
  s.add('SR NO', 'PARTICULAR', ...all.map((h) => HEAD_LABEL[h]));
  (['c8', 'c10', 'c11', 'c12', 'c13'] as const).forEach((k, i) => s.add(sr(i + 1), `CLAUSE -${k.slice(1)}`, ...taxCells(tin(docs.annexures.a4[k]), all)));
  return s;
}

/** A form-table sheet (GSTR-9, NOTICE FORMATE): section title, header row, rows. */
function formSheet(s: Sheet, tables: FormTable[], opts: { numberRow?: boolean } = {}): void {
  let part: string | undefined;
  tables.forEach((t) => {
    if (t.part && t.part !== part) {
      part = t.part;
      s.blank();
      s.title(t.part, 2 + t.head.length);
    }
    s.blank();
    if (t.no) s.merge(s.add(t.no, t.title), 1, 1 + t.head.length);
    else s.title(t.title, 2 + t.head.length);
    if (t.note) s.add('', t.note);
    s.add(t.no ? 'No.' : 'S.No', t.labelHead ?? 'Description', ...t.head);
    if (opts.numberRow) s.add(...Array.from({ length: 2 + t.head.length }, (_, i) => sr(i + 1)));
    t.rows.forEach((row) => s.add(row.code, row.label, ...row.cells));
  });
}

function gstr9Sheet({ w, meta }: Ctx): Sheet {
  const s = new Sheet('GSTR-9', [8, 80, 18, 18, 18, 18, 18, 18, 18, 18, 18], meta.clientName);
  s.add('(Amount in ₹ in all tables)');
  formSheet(s, gstr9FormTables(w));
  return s;
}

function noticeSheet({ w, meta }: Ctx): Sheet {
  const s = new Sheet('NOTICE FORMATE', [6, 80, 22, 18, 18, 18, 14, 18], meta.clientName);
  s.add(`YEAR : ${meta.financialYear}`);
  const { outward, inward } = noticeTables(w);
  formSheet(s, [outward, inward], { numberRow: true });
  return s;
}

/** The engine's status label; a re-check says why, since the sheet has no popover to explain it. */
const statusText = (d: DiffLine, tolerance: number): string => {
  const st = diffStatus(d, tolerance);
  return st.kind === 'recheck' ? `${st.label} (moved since justified)` : st.label;
};

function differencesSheet({ w, meta }: Ctx): Sheet {
  const s = new Sheet('DIFFERENCES', [30, 60, 18, 26, 26, 16, 16, 16, 16, 14, 26, 70, 16, 20, 18], meta.clientName);
  s.blank();
  s.title(`EVERY DIFFERENCE LINE — a line needs a reason when any head exceeds ₹${w.tolerance}. Open lines: ${w.openCount}.`, 15);
  s.blank();
  s.add('STEP', 'LINE', 'DIRECTION', 'LEFT SIDE', 'RIGHT SIDE', 'VALUE DIFF', 'IGST', 'CGST', 'SGST', 'CESS', 'STATUS', 'JUSTIFICATION', 'BY', 'WHEN', 'LINE KEY');
  w.diffs.forEach((d) => {
    const j = d.justification;
    s.add(
      STEP_NAME[d.step] ?? d.step,
      d.label,
      d.direction,
      d.aLabel,
      d.bLabel,
      d.hasTaxable ? d.diff.t : null,
      ...(d.hasTax ? [d.diff.i, d.diff.c, d.diff.s, d.diff.x] : [null, null, null, null]),
      statusText(d, w.tolerance),
      j?.text?.trim() ?? '',
      j?.text?.trim() ? j.by ?? '' : '',
      j?.text?.trim() ? fmtWhen(j.at) : '',
      d.key,
    );
  });
  return s;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build and download the Excel working. Returns the file name.
 * `meta.status` (optional) is written on the MASTER sheet.
 */
export function exportWorkbook(docs: AnnualReturnDocs, workings: Workings, meta: ExportMeta & { status?: string }): string {
  const lines = docs.justifications?.lines ?? {};
  const ctx: Ctx = {
    docs,
    w: workings,
    meta,
    heads: hasCess(workings) ? ['i', 'c', 's', 'x'] : ['i', 'c', 's'],
    just: (key) => lines[key]?.text?.trim() ?? '',
  };
  const builders = [
    masterSheet, plOutputSheet, plInputSheet, dtoSheet, dtiSheet, rcmSheet,
    gstr9OutputSheet, gstr9InputSheet, gstr9cSheet, annexureSheet, gstr9Sheet, noticeSheet, differencesSheet,
  ];
  const wb = XLSX.utils.book_new();
  builders.forEach((build) => {
    const sheet = build(ctx);
    XLSX.utils.book_append_sheet(wb, sheet.toWorksheet(), sheet.name);
  });
  const name = exportFileName('GSTR9_Working', meta, 'xlsx');
  XLSX.writeFile(wb, name);
  return name;
}
