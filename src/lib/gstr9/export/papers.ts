// The working papers, built from the engine's figures (computeWorkings) and
// what staff typed — never recomputed. B1–B5, C1–C5, D1 and D3 reproduce the
// sheets of the firm's MASTER_PMS.xlsx exactly as the previous Excel export
// laid them out (same rows, labels, figures and justifications, in the same
// order); the rest are new: the cover, index and sign-off, the portal figures
// the working used, the official GSTR-9C tables, payables with their set-offs,
// and the revision history.

import { describeChange, SHEET_LABEL, type ChangeLogEntry } from '../audit';
import {
  diffStatus,
  EXPENSE_HEAD_LABEL,
  NON_TAX_NATURE_LABEL,
  OUTWARD_CATEGORY_LABEL,
  resolveHead,
  T4_ROWS,
  tin,
  type DiffLine,
  type PayableSideWorking,
  type Workings,
} from '../engine';
import { drc03MatchesFY, METHOD_LABEL, SIDE_LABEL, type Drc03Filing, type SetOff } from '../payables';
import { ITC_ROWS, MONTH_FIELDS, monthTitle, T5_ROWS, T9_ROWS } from '../portalImport';
import { REVIEW_CHECKLIST, ROLE_LABEL } from '../signoff';
import type { AnnualReturnPeriod } from '../store';
import {
  FY_MONTHS,
  GSTR9C_PARTV_KEYS,
  GSTR9C_T11_KEYS,
  GSTR9C_T16_KEYS,
  GSTR9C_T5_KEYS,
  GSTR9C_T5_SUB,
  GSTR9C_T9_OTHER_KEYS,
  GSTR9C_T9_RATE_KEYS,
  type AdjustmentRow,
  type AnnualReturnDocs,
  type ExpenseHead,
  type Formulas,
  type InputSection,
  type MonthKey,
  type PortalMonth,
  type RateWiseRow,
  type Tax,
  type ValTax,
} from '../types';
import { gstr9FormTables, noticeTables, type FormTable } from './formTables';
import {
  FIRM_NAME,
  fmtDate,
  fmtDateTime,
  statusText,
  type Cell,
  type ExportMeta,
  type PaperSet,
  type Phase,
  type RowKind,
  type Src,
  type WorkingPaper,
  type WorkingPapersInput,
  type WpBlock,
  type WpCell,
  type WpRow,
  type WpTable,
} from './model';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

class TableBuilder {
  readonly t: WpTable;
  constructor(head: Cell[][], opts: Partial<Omit<WpTable, 'type' | 'head' | 'rows'>> = {}) {
    this.t = { type: 'table', head, rows: [], ...opts };
  }
  row(kind: RowKind, cells: Cell[], extra: Partial<WpRow> = {}): this {
    this.t.rows.push({ kind, cells, ...extra });
    return this;
  }
  data(...cells: Cell[]): this { return this.row('data', cells); }
  sub(...cells: Cell[]): this { return this.row('subtotal', cells); }
  total(...cells: Cell[]): this { return this.row('total', cells); }
  band(text: string): this { return this.row('band', [text]); }
}

class PaperBuilder {
  readonly blocks: WpBlock[] = [];
  h1(text: string): void { this.blocks.push({ type: 'heading', level: 1, text }); }
  h2(text: string): void { this.blocks.push({ type: 'heading', level: 2, text }); }
  h3(text: string, code?: string): void { this.blocks.push({ type: 'heading', level: 3, text, code }); }
  note(text: string): void { this.blocks.push({ type: 'note', text }); }
  space(): void { this.blocks.push({ type: 'spacer' }); }
  table(head: Cell[][], opts: Partial<Omit<WpTable, 'type' | 'head' | 'rows'>> = {}): TableBuilder {
    const b = new TableBuilder(head, opts);
    this.blocks.push(b.t);
    return b;
  }
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

type Head = keyof Tax;

const sr = (n: number): WpCell => ({ v: n, fmt: 'int' });
const int = (n: number): WpCell => ({ v: n, fmt: 'int' });
const rate = (n: number | null | undefined, src?: Src): WpCell => ({ v: n ?? null, fmt: 'rate', src });
/** A label that also covers the empty cell(s) after it (the sheet lets it run across). */
const lbl = (text: string, span = 2): WpCell => ({ v: text, span });
const src = (v: number | null | undefined, s: Src): WpCell => ({ v, src: s });
const muted = (text: string): WpCell => ({ v: text, italic: true, muted: true });
/** A justification (or other free text) run across `span` columns so it has room to read. */
const wide = (text: string, span: number): WpCell => ({ v: text, span });

/** A typed figure, carrying the expression staff typed (if any) as a cell comment. */
const typed = (v: number | null | undefined, f: Formulas | undefined, key: string): WpCell => {
  const expr = f?.[key];
  return expr ? { v: v ?? 0, note: `Entered as ${expr}`, src: 'typed' } : { v, src: 'typed' };
};

const round2 = (n: number): number => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) || Math.abs(r) < 0.005 ? 0 : r;
};

// ---------------------------------------------------------------------------
// Heads and labels (as the previous export)
// ---------------------------------------------------------------------------

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
const ALL_HEADS: Head[] = ['i', 'c', 's', 'x'];

const MONTH_FULL: Record<MonthKey, string> = {
  apr: 'APRIL', may: 'MAY', jun: 'JUNE', jul: 'JULY', aug: 'AUGUST', sep: 'SEPTEMBER',
  oct: 'OCTOBER', nov: 'NOVEMBER', dec: 'DECEMBER', jan: 'JANUARY', feb: 'FEBRUARY', mar: 'MARCH',
};
const MONTH_SHORT: Record<MonthKey, string> = {
  apr: 'APR', may: 'MAY', jun: 'JUN', jul: 'JUL', aug: 'AUG', sep: 'SEP',
  oct: 'OCT', nov: 'NOV', dec: 'DEC', jan: 'JAN', feb: 'FEB', mar: 'MAR',
};

/** Step names for the DIFFERENCES paper (mirrors src/components/gstr9/steps/registry.ts). */
const STEP_NAME: Record<string, string> = {
  overview: '0 · Overview', portal: '1 · Portal data', sales: '2 · Sales (PL-OUTPUT)', purchases: '3 · Purchases & ITC (PL-INPUT)',
  duties: '4 · Duties & Taxes', rcm: '5 · RCM', outward: '6 · Outward reco (GSTR 9-OUTPUT)', itc: '7 · ITC reco (GSTR 9-INPUT)',
  expense: '8 · 9C expense heads (GSTR 9C)', annexures: '9 · Annexures', gstr9: '10 · GSTR-9', gstr9c: '11 · GSTR-9C',
  notice: '12 · Notice format', review: '13 · Review & lock',
};

const PORTAL_SOURCE_LABEL: Record<string, string> = {
  extension: 'Portal (browser extension)',
  upload: 'Uploaded portal JSON',
  as_filed_3b: 'As-filed GSTR-3B (portal)',
  manual: 'Typed',
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Ctx {
  docs: AnnualReturnDocs;
  w: Workings;
  meta: ExportMeta;
  heads: Head[];
  /** Justification text for a diff line key ('' when none). */
  just: (key: string) => string;
  period: AnnualReturnPeriod | null;
  setOffs: SetOff[];
  drc03s: Drc03Filing[];
  changeLog: ChangeLogEntry[];
  status: string;
  printed: string;
  preparedText: string;
  reviewedText: string;
  /** Open difference lines whose key starts with any of the prefixes. */
  openOn: (prefixes: string[]) => number;
  /** Source of a portal field ("months.apr.outTax.i", "gstr9.table4.b2b.c"). */
  portalSrc: (path: string) => Src;
}

const taxCells = (t: Tax, heads: Head[]): number[] => heads.map((h) => t[h]);
/** Ledger-row tax cells; the Sales / Purchases grids remember expressions under "tax.i" … "tax.x". */
const typedTax = (t: Tax, heads: Head[], f: Formulas | undefined): Cell[] => heads.map((h) => typed(t[h], f, `tax.${h}`));
const valCells = (v: ValTax, heads: Head[]): number[] => [v.t, ...taxCells(v, heads)];
/** Tax cells coloured by where each head comes from. */
const srcTax = (t: Tax, heads: Head[], s: (h: Head) => Src): Cell[] => heads.map((h) => src(t[h], s(h)));
const headRow = (heads: Head[]): string[] => heads.map((h) => HEAD_LABEL[h]);

/** Which papers show which difference lines (by key prefix) — for the index and the cover. */
const DIFF_PREFIX: Record<string, string[]> = {
  B1: ['sales.'], B2: ['purchases.'], B3: ['dto.'], B4: ['dti.'], B5: ['rcm.'],
  C1: ['out.'], C2: ['itc.'], C3: ['gstr9c.14T'], C4: ['ann1.', 'ann2.', 'ann4.'], C5: [''],
  D1: ['g9.'], D2: ['gstr9c.'],
};

interface Spec {
  ref: string;
  title: string;
  sheet: string;
  phase: Phase;
  master: string;
  source: string;
  widths: number[];
  freezeCols?: number;
}

const paper = (c: Ctx, s: Spec, p: PaperBuilder): WorkingPaper => ({
  ...s,
  blocks: p.blocks,
  openDiffs: DIFF_PREFIX[s.ref] ? c.openOn(DIFF_PREFIX[s.ref]) : null,
});

// ---------------------------------------------------------------------------
// A — Summary papers
// ---------------------------------------------------------------------------

function cover(c: Ctx): WorkingPaper {
  const { meta, w } = c;
  const p = new PaperBuilder();
  p.h1('Annual Return — GSTR-9 & GSTR-9C working papers');
  p.note('Reproduces the firm’s MASTER_PMS.xlsx working; every figure comes from the working’s computation, never typed into these papers.');
  const t = p.table([], { plain: true });
  t.data('FIRM', FIRM_NAME);
  t.data('PARTY NAME', meta.clientName);
  t.data('YEAR', meta.financialYear);
  t.data('GSTIN', meta.gstin);
  t.data('ADDRESS', '');
  t.data('STATUS', c.status);
  t.data('OPEN DIFFERENCES', int(w.openCount));
  t.data('TOLERANCE PER HEAD (₹)', w.tolerance);
  t.data('PREPARED BY', c.preparedText);
  t.data('REVIEWED BY', c.reviewedText);
  t.data('EXPORTED ON', c.printed);
  return paper(c, {
    ref: 'A1', title: 'Cover', sheet: 'A1 COVER', phase: 'summary', master: 'MASTER',
    source: 'Source: party details and status of the working — MASTER of MASTER_PMS', widths: [30, 90],
  }, p);
}

/** The index needs every paper's ref, title and open differences — filled in once they are built. */
function index(c: Ctx, all: WorkingPaper[]): WorkingPaper {
  const p = new PaperBuilder();
  p.h1('Index of working papers');
  const t = p.table([['WP REF', 'TITLE', 'PHASE', 'SOURCE (MASTER_PMS SHEET)', 'OPEN DIFFERENCES', 'SHEET']], { keyCols: 1, role: 'index' });
  let phase: Phase | null = null;
  all.forEach((wp) => {
    if (wp.phase !== phase) {
      phase = wp.phase;
      t.band(PHASE_BAND[wp.phase]);
    }
    t.data(
      { v: wp.ref, link: { sheet: wp.sheet }, bold: true },
      { v: wp.title, link: { sheet: wp.sheet } },
      PHASE_WORD[wp.phase],
      wp.master,
      wp.openDiffs === null ? { v: '—', align: 'right' } : int(wp.openDiffs),
      { v: wp.sheet, link: { sheet: wp.sheet } },
    );
  });
  p.h2('Colour convention');
  const l = p.table([['FIGURE', 'MEANING']]);
  l.data({ v: 123456.78, src: 'typed' }, 'Typed by staff — ledger figures from the books, adjustments, overrides (blue)');
  l.data({ v: 123456.78, src: 'portal' }, 'Fetched from the GST portal — GSTR-9 system-computed, as-filed GSTR-3B (dark green); a portal figure typed over by hand shows blue');
  l.data({ v: 123456.78, src: 'computed' }, 'Computed by the working (black)');
  p.h2('Symbols');
  const s = p.table([['SYMBOL', 'MEANING']]);
  s.data({ v: -1234.5 }, 'Negative figures are shown in brackets');
  s.data({ v: 0 }, 'A dash is nil');
  s.data({ v: '✓  /  ✗', tick: true }, 'Review checklist item done / not done (A3)');
  s.data({ v: 'Struck through, grey', strike: true, muted: true }, 'A removed set-off (E1), kept with who removed it and why');
  s.data('Comment on a cell', 'The expression staff typed (“Entered as =a+b”)');
  s.data({ v: 'TOTAL', bold: true }, 'Totals: bold, rule above, double rule below');
  return paper(c, {
    ref: 'A2', title: 'Index', sheet: 'A2 INDEX', phase: 'summary', master: '—',
    source: 'Source: this workbook — every paper, where it comes from and its open differences', widths: [10, 60, 30, 34, 18, 26],
  }, p);
}

const PHASE_BAND: Record<Phase, string> = {
  summary: 'A — SUMMARY',
  collect: 'B — COLLECT: BOOKS AND PORTAL',
  reconcile: 'C — RECONCILE',
  returns: 'D — RETURNS',
  finish: 'E / F — PAYABLES AND AUDIT TRAIL',
};
const PHASE_WORD: Record<Phase, string> = { summary: 'Summary', collect: 'Collect', reconcile: 'Reconcile', returns: 'Returns', finish: 'Finish' };

function signOff(c: Ctx): WorkingPaper {
  const { period, w } = c;
  const p = new PaperBuilder();
  p.h1('Sign-off');
  const s = p.table([['ROLE', 'NAME', 'DATE', 'NOTE']]);
  s.data('Prepared by', period?.prepared_by_name ?? '', fmtDate(period?.prepared_at), period?.prepared_note ?? '');
  const role = period?.reviewed_role ? ROLE_LABEL[period.reviewed_role] ?? period.reviewed_role : '';
  s.data('Reviewed by', period?.reviewed_by_name ? `${period.reviewed_by_name}${role ? ` (${role})` : ''}` : '', fmtDate(period?.reviewed_at), period?.review_note ?? '');

  p.h2('Review checklist');
  const ticked = period?.review_checklist ?? {};
  const k = p.table([['#', 'CHECK', 'DONE', 'BASIS']]);
  REVIEW_CHECKLIST.forEach((item, i) => {
    const done = item.auto ? w.openCount === 0 : !!ticked[item.key];
    const basis = item.auto
      ? w.openCount === 0 ? 'Checked by the app: no difference is open' : `Checked by the app: ${w.openCount} difference${w.openCount === 1 ? ' is' : 's are'} open`
      : done ? 'Ticked by the reviewer' : 'Not ticked';
    k.data(int(i + 1), item.label, { v: done ? '✓' : '✗', tick: true, align: 'center' }, basis);
  });

  p.h2('Status');
  const st = p.table([], { plain: true });
  st.data('Status', c.status);
  st.data('Locked by', period?.status === 'locked' ? period.locked_by ?? '' : '');
  st.data('Locked on', period?.status === 'locked' ? fmtDateTime(period.locked_at) : '');
  st.data('Payables frozen at the lock', period?.payables_at_lock ? 'Yes — see E1' : 'No');
  st.data('Open differences', int(w.openCount));

  p.h2('Signatures');
  const g = p.table([], { plain: true, tall: true });
  g.data('Prepared by', '________________________________________', 'Date', '____________________');
  g.data('Reviewed by', '________________________________________', 'Date', '____________________');
  g.data('Partner', '________________________________________', 'Date', '____________________');
  return paper(c, {
    ref: 'A3', title: 'Sign-off', sheet: 'A3 SIGN-OFF', phase: 'summary', master: '—',
    source: 'Source: the preparer’s and reviewer’s sign-off recorded on the working (Review & lock)', widths: [22, 80, 14, 60],
  }, p);
}

// ---------------------------------------------------------------------------
// B — Collect: books and portal
// ---------------------------------------------------------------------------

function plOutput(c: Ctx): WorkingPaper {
  const { docs, w, heads, just } = c;
  const p = new PaperBuilder();
  p.h1('SALES BIFURCATION WORKING');
  p.h2('PART A - TAXABLE INCOME ONLY (INCLUDING ALL EXPORTS (WITH OR WITHOUT), SEZ SALES & DEEMED EXPORTS)');
  const a = p.table([['SR NO', 'PARTICULARS', 'AMOUNT', ...headRow(heads), 'RATE OF TAX', 'RATE (STATED)', 'GSTR-9 TABLE 4', 'SUPPLY']], { freeze: true, keyCols: 2 });
  docs.sales.partA.forEach((r, i) => {
    const cc = w.sales.rows[r.id];
    const t = cc?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
    a.data(
      sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), ...typedTax(t, heads, r.f),
      rate(cc?.impliedRate), rate(r.rate, 'typed'),
      cc?.isReturn ? 'Credit note (4I)' : OUTWARD_CATEGORY_LABEL[r.category] ?? r.category,
      r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
    );
  });
  a.total(lbl('TOTAL INCOME - PART A'), ...valCells(w.sales.partA, heads));
  p.note('NOTE : SHOW SALES RETURN OF EACH LEDGER IN A DIFFERENT ROW WITH NEGATIVE VALUES');
  p.h2('PART B - NON-TAXABLE INCOME ONLY');
  const bw = heads.length + 1;
  const b = p.table([['SR NO', 'PARTICULARS', 'AMOUNT', wide('BIFURCATION', bw)]], { keyCols: 2 });
  // A negative row (a credit note) is reported in 5H, whatever its nature — say so, as Part A does for 4I.
  docs.sales.partB.forEach((r, i) => b.data(
    sr(i + 1), r.ledger, typed(r.amount, r.f, 'amount'),
    wide((Number(r.amount) || 0) < 0 && r.nature !== 'not_in_gstr9' ? 'Credit note (5H)' : NON_TAX_NATURE_LABEL[r.nature] ?? r.nature, bw),
  ));
  b.total(lbl('TOTAL INCOME - PART B'), w.sales.partBTotal);
  b.total(lbl('TOTAL INCOME - PART A+B'), w.sales.total, { ...muted('<<< THIS SHOULD BE MATCHED WITH AUDIT REPORT'), span: bw });
  b.data(lbl('AS PER REPORT'), src(w.sales.auditReportTotal ?? null, 'typed'));
  b.sub(lbl('DIFFERENCE (REPORT - BOOKS)'), w.sales.auditDiff ?? null, wide(just('sales.audit'), bw));
  const n = heads.length;
  return paper(c, {
    ref: 'B1', title: 'PL-OUTPUT — Sales bifurcation', sheet: 'B1 PL-OUTPUT', phase: 'collect', master: 'PL-OUTPUT',
    source: 'Source: books P&L (sales ledgers, audit-report total) — PL-OUTPUT of MASTER_PMS',
    widths: [8, 44, 18, ...Array(n).fill(16), 12, 12, 26, 14],
  }, p);
}

const SECTION_TITLE: Record<InputSection, [string, string]> = {
  purchase: ['(A) PURCHASE', 'TOTAL PURCHASE'],
  expense: ['(B) DIRECT & INDIRECT EXPENSE', 'TOTAL INDIRECT EXPENSE'],
  capital_goods: ['(C) CAPITAL GOODS', 'TOTAL CAPITAL GOODS'],
};

function plInput(c: Ctx): WorkingPaper {
  const { docs, w, meta, heads, just } = c;
  const p = new PaperBuilder();
  p.h1('PURCHASE & ITC WORKING');
  const t = p.table([['SR NO', 'HEAD IN BOOKS', 'TAXABLE VALUE', ...headRow(heads), 'RATE', 'RATE (STATED)', 'GSTR-9C EXPENSE HEAD', 'SUPPLY']], { freeze: true, keyCols: 2 });
  (['purchase', 'expense', 'capital_goods'] as InputSection[]).forEach((sec) => {
    t.band(SECTION_TITLE[sec][0]);
    docs.purchases.rows.filter((r) => r.section === sec).forEach((r, i) => {
      const cc = w.purchases.rows[r.id];
      const tx = cc?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
      const head = cc?.head ?? resolveHead(r);
      t.data(
        sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), ...typedTax(tx, heads, r.f),
        rate(cc?.impliedRate), rate(r.rate, 'typed'), EXPENSE_HEAD_LABEL[head] ?? head,
        r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
      );
    });
    t.sub(lbl(SECTION_TITLE[sec][1]), ...valCells(w.purchases.sections[sec], heads));
  });
  const P = w.purchases;
  t.total(lbl('TOTAL ITC AS PER P&L'), ...valCells(P.totalPl, heads));
  t.data(lbl('SUSPENDED ITC AS PER DUTIES & TAXES (Dr - Cr)'), 0, ...taxCells(P.suspended, heads));
  t.data(lbl('SUSPENDED ITC AS PER DUTIES & TAXES (OTHER ADJ)'), 0, ...srcTax(P.otherAdj, heads, () => 'typed'));
  t.data(lbl('RCM CREDIT (RCM SHEET PART B - AS PER BOOKS)'), ...valCells(P.rcmCredit, heads));
  t.total(lbl(`NET ITC FOR ${meta.financialYear}`), ...valCells(P.netItc, heads));
  t.data(lbl('AS PER DUTIES & TAXES-INPUT (NET)'), null, ...taxCells(P.dtNet, heads));
  t.sub(lbl('DIFFERENCE (P&L - D&T)'), null, ...taxCells(P.diffVsDt, heads), wide(just('purchases.dt'), 4));
  const n = heads.length;
  return paper(c, {
    ref: 'B2', title: 'PL-INPUT — Purchases and ITC', sheet: 'B2 PL-INPUT', phase: 'collect', master: 'PL-INPUT',
    source: 'Source: books P&L (purchase, expense and capital-goods ledgers) — PL-INPUT of MASTER_PMS',
    widths: [8, 44, 18, ...Array(n).fill(16), 10, 12, 36, 12],
  }, p);
}

function adjustmentBlock(c: Ctx, p: PaperBuilder, title: string, rows: AdjustmentRow[], total: Tax, reasonHead: string, grand: [string, Tax]): void {
  const { heads } = c;
  p.h2(title);
  const t = p.table([['MONTH', ...headRow(heads), reasonHead]]);
  rows.forEach((a) => t.data(a.month ? MONTH_FULL[a.month] : '', ...srcTax(tin(a), heads, () => 'typed'), a.reason || ''));
  t.sub('TOTAL', ...taxCells(total, heads));
  t.total(grand[0], ...taxCells(grand[1], heads));
}

/** Column groups of a "MONTH | group × heads … | JUSTIFICATION" table. */
const groupCols = (groups: number, n: number, trailing: number): number[][] => {
  const out: number[][] = [];
  for (let g = 0; g < groups; g++) out.push(Array.from({ length: n }, (_, i) => 1 + g * n + i));
  for (let k = 0; k < trailing; k++) out.push([1 + groups * n + k]);
  return out;
};

const groupHead = (first: string, groups: string[], heads: Head[], last?: string): Cell[][] => [
  [{ v: first, rowSpan: 2 }, ...groups.map((g) => ({ v: g, span: heads.length, align: 'center' as const })), ...(last ? [{ v: last, rowSpan: 2 }] : [])],
  [null, ...groups.flatMap(() => headRow(heads)), ...(last ? [null] : [])],
];

/** Where a month's as-filed GSTR-3B figure came from. */
const monthSrc = (c: Ctx, m: MonthKey, field: keyof PortalMonth) => (h: string): Src => c.portalSrc(`months.${m}.${field}.${h}`);

function dto(c: Ctx): WorkingPaper {
  const { w, docs, heads, just } = c;
  const n = heads.length;
  const p = new PaperBuilder();
  p.h1('OUTPUT WORKING SHEET');
  const groups = ['SALES', 'CREDIT NOTE', 'NET SALES', 'AS PER 3B', 'DIFF (BOOKS - 3B)'];
  const t = p.table(groupHead('MONTH', groups, heads, 'JUSTIFICATION'), { freeze: true, groups: groupCols(5, n, 1) });
  FY_MONTHS.forEach((m) => {
    const x = w.dto.months[m];
    t.data(
      MONTH_SHORT[m],
      ...srcTax(x.sales, heads, () => 'typed'), ...srcTax(x.cn, heads, () => 'typed'), ...taxCells(x.net, heads),
      ...srcTax(x.asPer3B, heads, monthSrc(c, m, 'outTax')), ...taxCells(x.diff, heads),
      just(`dto.${m}`),
    );
  });
  const T = w.dto.totals;
  t.total('TOTAL', ...[T.sales, T.cn, T.net, T.asPer3B, T.diff].flatMap((x) => taxCells(x, heads)));
  t.data(lbl('AS PER P & L (PL-OUTPUT PART A)', 1 + 2 * n), ...taxCells(w.dto.asPerPl, heads));
  t.sub(lbl('DIFF WITH REASON? (P&L - NET SALES)', 1 + 2 * n), ...taxCells(w.dto.plDiff, heads), ...Array(2 * n).fill(null), just('dto.pl'));
  adjustmentBlock(c, p, 'OTHER ADJUSTMENTS IN CR SIDE', docs.duties_output.adjustments, w.dto.adjustments, 'REASON OF ADJ.', ['TOTAL CR SIDE', w.dto.totalCrSide]);
  return paper(c, {
    ref: 'B3', title: 'DUTIES & TAXES-OUTPUT — Output tax by month', sheet: 'B3 DUTIES & TAXES-OUTPUT', phase: 'collect', master: 'DUTIES & TAXES-OUTPUT',
    source: 'Source: books Duties & Taxes output ledgers by month; AS PER 3B from the as-filed GSTR-3B 3.1(a)+(b) — DUTIES & TAXES-OUTPUT of MASTER_PMS',
    widths: [12, ...Array(5 * n).fill(15), 48], freezeCols: 1,
  }, p);
}

function dti(c: Ctx): WorkingPaper {
  const { w, docs, heads, just } = c;
  const n = heads.length;
  const p = new PaperBuilder();
  p.h1('INPUT WORKING SHEET EXCLUDING RCM');
  const groups = [
    'PURCHASE', 'DEBIT NOTE', 'SUSPENDED ITC (REVERSED)', 'SUSPENDED ITC (REVERSED)-180DAYS', 'SUSPENDED ITC (RECLAIM)',
    'SUSPENDED ITC (RECLAIM)-180DAYS', 'NET PURCHASE', 'AS PER 3B', 'DIFF (BOOKS - 3B)',
  ];
  const t = p.table(groupHead('MONTH', groups, heads, 'JUSTIFICATION'), { freeze: true, groups: groupCols(9, n, 1) });
  const pad = (k: number) => Array(k * n).fill(null);
  const ty = (x: Tax) => srcTax(x, heads, () => 'typed');
  // Last Year Effect sits in NET PURCHASE only (no 3B month); its difference is carried so the column adds up.
  t.data('LAST YEAR EFFECT', ...pad(6), ...ty(w.dti.lye), ...pad(1), ...taxCells(w.dti.lye, heads));
  FY_MONTHS.forEach((m) => {
    const x = w.dti.months[m];
    t.data(
      MONTH_SHORT[m],
      ...[x.purchase, x.dn, x.sr, x.sr180, x.rc, x.rc180].flatMap(ty), ...taxCells(x.net, heads),
      ...srcTax(x.asPer3B, heads, monthSrc(c, m, 'itcExclRcm')), ...taxCells(x.diff, heads),
      just(`dti.${m}`),
    );
  });
  const T = w.dti.totals;
  t.total('TOTAL', ...[T.purchase, T.dn, T.sr, T.sr180, T.rc, T.rc180, T.net, T.asPer3B, T.diff].flatMap((x) => taxCells(x, heads)));
  t.data(lbl('RCM TAX FIGURES ONLY', 1 + 6 * n), ...taxCells(w.dti.rcmBooks, heads), ...taxCells(w.dti.rcmPortal, heads), ...taxCells(w.dti.rcmDiff, heads));
  t.sub(lbl('TOTAL ITC FOR THE YEAR (TO BE MATCHED WITH ANNUAL GSTR-3B)', 1 + 6 * n), ...taxCells(w.dti.totalItcBooks, heads), ...taxCells(w.dti.totalItcPortal, heads), ...taxCells(w.dti.totalItcDiff, heads));
  t.data(lbl('LAST YEAR EFFECT', 1 + 6 * n), ...taxCells(w.dti.lye, heads));
  t.total(lbl('NET', 1 + 6 * n), ...taxCells(w.dti.net, heads));
  t.data(lbl('AS PER P&L (PL-INPUT NET ITC)', 1 + 6 * n), ...taxCells(w.dti.asPerPl, heads));
  t.sub(lbl('DIFF (P&L - NET)', 1 + 6 * n), ...taxCells(w.dti.plDiff, heads), ...pad(2), just('dti.pl'));
  adjustmentBlock(c, p, 'OTHER ADJUSTMENTS IN DR SIDE', docs.duties_input.adjustments, w.dti.adjustments, 'REASON OF ADJ.', ['TOTAL DR', w.dti.totalDr]);
  return paper(c, {
    ref: 'B4', title: 'DUTIES & TAXES-INPUT — Input tax credit by month', sheet: 'B4 DUTIES & TAXES-INPUT', phase: 'collect', master: 'DUTIES & TAXES-INPUT',
    source: 'Source: books Duties & Taxes input ledgers by month; AS PER 3B from the as-filed GSTR-3B 4A(1)+4A(4)+4A(5) − 4B(1) − 4B(2) — DUTIES & TAXES-INPUT of MASTER_PMS',
    widths: [30, ...Array(9 * n).fill(14), 48], freezeCols: 1,
  }, p);
}

function rcm(c: Ctx): WorkingPaper {
  const { w, docs, heads, just } = c;
  const p = new PaperBuilder();
  const hdr = (extra?: string): Cell[][] => [['SR NO', 'MONTH', 'TAXABLE', ...headRow(heads), ...(extra ? [extra] : [])]];
  const allV: Array<'t' | Head> = ['t', ...heads];
  const months = (t: TableBuilder, get: (m: MonthKey) => ValTax, extra?: (m: MonthKey) => string, cellSrc?: (m: MonthKey, h: 't' | Head) => Src) =>
    FY_MONTHS.forEach((m, i) => {
      const v = get(m);
      t.data(sr(i + 1), MONTH_FULL[m], ...(cellSrc ? allV.map((h) => src(v[h], cellSrc(m, h))) : valCells(v, heads)), extra ? extra(m) : '');
    });

  const source = w.rcm.partASource;
  p.h2(`PART A - AS PER GST PORTAL (${source === 'monthly' ? 'as-filed GSTR-3B 3.1(d)' : source === 'gstr9' ? 'GSTR-9 Table 4G, annual' : 'not fetched'})`);
  const a = p.table(hdr(), { keyCols: 2 });
  if (source === 'gstr9') a.data('', 'ANNUAL (GSTR-9 4G)', ...allV.map((h) => src(w.rcm.partA[h], c.portalSrc(`gstr9.table4.rchrg.${h}`))));
  else months(a, (m) => w.rcm.partAMonths[m], undefined, (m, h) => c.portalSrc(`months.${m}.rcm.${h}`));
  a.total(lbl('TOTAL'), ...valCells(w.rcm.partA, heads));
  p.h2('PART B - AS PER BOOKS');
  const b = p.table(hdr(), { keyCols: 2 });
  months(b, (m) => w.rcm.partBMonths[m]);
  b.total(lbl('TOTAL'), ...valCells(w.rcm.partB, heads));
  p.h2('DIFFERENCE (PART B - PART A: BOOKS - PORTAL)');
  const d = p.table(hdr('JUSTIFICATION'), { keyCols: 2 });
  if (source === 'gstr9') d.data('', 'ANNUAL', ...valCells(w.rcm.diff, heads), just('rcm.annual'));
  else months(d, (m) => w.rcm.diffMonths[m], (m) => just(`rcm.${m}`));
  d.total(lbl('TOTAL'), ...valCells(w.rcm.diff, heads));
  p.note('NOTE - PART B IS THE SUM OF THE EXPENSE CATEGORIES BELOW (ALL CATEGORIES, TAXABLE VALUE INCLUDED).');
  docs.rcm.categories.forEach((cat) => {
    const calc = w.rcm.categories[cat.id];
    if (!calc) return;
    p.h2(`${(cat.name || 'RCM EXPENSE').toUpperCase()} (${cat.rate}% · ${cat.supplyType === 'inter' ? 'INTER-STATE' : 'INTRA-STATE'} · GSTR-9 TABLE ${cat.itcTable || '6C'})`);
    const k = p.table(hdr(), { keyCols: 2 });
    // Taxable is typed; tax is computed from the rate unless typed (RCM F52 `=D52*2.5%`).
    months(k, (m) => calc.months[m], undefined, (m, h) => {
      if (h === 't') return 'typed';
      const cell = cat.months?.[m];
      return cell && cell[h] !== null && cell[h] !== undefined ? 'typed' : 'computed';
    });
    k.total(lbl('TOTAL'), ...valCells(calc.total, heads));
  });
  return paper(c, {
    ref: 'B5', title: 'RCM — Reverse charge, portal vs books', sheet: 'B5 RCM', phase: 'collect', master: 'RCM',
    source: 'Source: Part A from the as-filed GSTR-3B 3.1(d) (or GSTR-9 4G); Part B from the books RCM expense categories — RCM of MASTER_PMS',
    widths: [8, 16, 16, ...heads.map(() => 15), 48],
  }, p);
}

function portalData(c: Ctx): WorkingPaper {
  const { docs, w, heads, meta } = c;
  const P = docs.portal;
  const g = P.gstr9;
  const gm = P.gstr9Meta;
  const p = new PaperBuilder();
  const n = heads.length;
  p.h1('PORTAL FIGURES USED BY THE WORKING');
  p.note('Only what the GST portal returned (fetched by the browser extension from the client’s own login, or uploaded) or what staff typed in its place — never the app’s own GSTR-1 / GSTR-3B.');

  p.h2('GSTR-9 SYSTEM-COMPUTED (returns2/auth/api/gstr9/details/calc)');
  const m = p.table([], { plain: true });
  m.data(lbl('Source'), gm?.source ? PORTAL_SOURCE_LABEL[gm.source] ?? gm.source : 'Not fetched');
  m.data(lbl('Fetched on'), fmtDateTime(gm?.fetchedAt));
  m.data(lbl('ARN'), gm?.arn ?? '');
  m.data(lbl('Filed on'), fmtDate(gm?.filedDate));
  m.data(lbl('Status'), gm?.status ?? '');

  const allV: Array<'t' | Head> = ['t', ...heads];
  p.h3('Table 4 — outward supplies on which tax is payable, as auto-populated', '4');
  const t4 = p.table([['TABLE', 'NATURE OF SUPPLIES', 'TAXABLE', ...headRow(heads)]], { keyCols: 2 });
  T4_ROWS.forEach((r) => t4.data(r.table, r.label, ...allV.map((h) => src(g.table4[r.key][h], c.portalSrc(`gstr9.table4.${r.key}.${h}`)))));
  t4.total(lbl('TOTAL (EXCLUDING 4G; 4I AND 4L DEDUCTED) — GSTR 9-OUTPUT COLUMN B'), ...valCells(w.outward.portalTotal, heads));

  p.h3('Table 5 — outward supplies on which tax is not payable, as auto-populated (cross-check only)', '5');
  const t5 = p.table([['TABLE', 'NATURE OF SUPPLIES', 'VALUE']], { keyCols: 2 });
  T5_ROWS.forEach((r) => {
    if (r.table === '5H') t5.sub('5G', 'Sub-total (5A to 5F)', w.g9.t5PortalTotals.G);
    t5.data(r.table, r.label, src(g.table5[r.key], c.portalSrc(`gstr9.table5.${r.key}`)));
  });
  t5.sub('5L', 'Sub-total (5H to 5K)', w.g9.t5PortalTotals.L);
  t5.total('5M', 'Turnover on which tax is not to be paid (5G + 5L)', w.g9.t5PortalTotals.M);

  p.h3('Tables 6 and 8 — ITC figures filled by the portal', '6/8');
  const itc = p.table([['TABLE', 'DETAILS', ...headRow(ALL_HEADS)]], { keyCols: 2 });
  ITC_ROWS(meta.financialYear).forEach((r) => itc.data(r.table, r.label, ...srcTax(g[r.key], ALL_HEADS, (h) => c.portalSrc(`gstr9.${r.key}.${h}`))));

  p.h3('Table 9 — tax paid as declared in the returns', '9');
  const t9 = p.table([['TABLE', 'DESCRIPTION', 'TAX PAYABLE', 'PAID IN CASH', 'PAID BY ITC: IGST', 'PAID BY ITC: CGST', 'PAID BY ITC: SGST', 'PAID BY ITC: CESS']], { keyCols: 2 });
  T9_ROWS.forEach((r) => {
    const row = g.table9[r.key] as unknown as Record<string, number>;
    const fields = r.tax ? ['payable', 'cash', 'itcI', 'itcC', 'itcS', 'itcX'] : ['payable', 'cash'];
    t9.data(`9${r.code}`, r.label, ...fields.map((f) => src(row[f], c.portalSrc(`gstr9.table9.${r.key}.${f}`))));
  });

  p.h2('AS-FILED GSTR-3B, MONTH BY MONTH (gst_filed_returns · GSTR3B)');
  const mm = p.table([[lbl('MONTH'), 'SOURCE', 'ARN', 'FILED ON', 'STATUS', 'FETCHED ON']], { keyCols: 1 });
  FY_MONTHS.forEach((k) => {
    const meta3b = P.monthMeta[k];
    mm.data(lbl(monthTitle(k, meta.financialYear)), meta3b?.source ? PORTAL_SOURCE_LABEL[meta3b.source] ?? meta3b.source : 'Not fetched', meta3b?.arn ?? '', fmtDate(meta3b?.filedDate), meta3b?.status ?? '', fmtDateTime(meta3b?.fetchedAt));
  });

  const field = (k: keyof PortalMonth) => MONTH_FIELDS.find((f) => f.key === k);
  const monthTable = (keys: Array<keyof PortalMonth>, title: string) => {
    p.h3(title);
    const cols = keys.map((k) => (k === 'rcm' ? allV : heads) as Array<'t' | Head>);
    const head: Cell[][] = [
      [{ ...lbl('MONTH'), rowSpan: 2 }, ...keys.map((k, i) => ({ v: (field(k)?.label ?? k).toUpperCase(), span: cols[i].length, align: 'center' as const }))],
      [null, null, ...cols.flatMap((hs) => hs.map((h) => (h === 't' ? 'VALUE' : HEAD_LABEL[h])))],
    ];
    let at = 2;
    const groups = cols.map((hs) => hs.map(() => at++));
    const t = p.table(head, { keyCols: 2, groups });
    FY_MONTHS.forEach((k) => {
      const row = P.months[k];
      t.data(lbl(monthTitle(k, meta.financialYear)), ...keys.flatMap((f, i) => cols[i].map((h) => src((row[f] as unknown as Record<string, number>)[h], c.portalSrc(`months.${k}.${f}.${h}`)))));
    });
    t.total(lbl('TOTAL'), ...keys.flatMap((f, i) => cols[i].map((h) => FY_MONTHS.reduce((s, k) => s + ((P.months[k][f] as unknown as Record<string, number>)[h] || 0), 0))));
  };
  monthTable(['outTax', 'itcExclRcm', 'rcm'], 'Figures the reconciliation compares');
  monthTable(['itc4aTotal', 'itc4a5', 'itc4b1', 'itc4b2', 'itc4d'], 'Other figures (GSTR-9 6A fallback, 7E, Notice format)');
  const where = p.table([[lbl('FIGURE'), { v: 'WHERE IT GOES', span: 8 }]], { keyCols: 2 });
  MONTH_FIELDS.forEach((f) => where.data(lbl(f.label), { v: f.explain, span: 8 }));
  return paper(c, {
    ref: 'B6', title: 'Portal data — GSTR-9 system-computed and as-filed GSTR-3B', sheet: 'B6 PORTAL DATA', phase: 'collect', master: 'AS PER 3B / AUTO POPULATE cells',
    source: 'Source: GST portal — GSTR-9 system-computed JSON (GSTR9_CALC) and the as-filed GSTR-3B of each month (GSTR3B) — the "AS PER 3B" and "AUTO POPULATE FROM 9" cells of MASTER_PMS',
    widths: [8, 56, ...Array(Math.max(3 * n + 1, 8)).fill(16)],
  }, p);
}

// ---------------------------------------------------------------------------
// C — Reconcile
// ---------------------------------------------------------------------------

/** "B2B (4B)" — the table code is appended unless the engine's label already carries it. */
const outwardLabel = (r: Workings['outward']['rows'][number]): string =>
  /\(4[A-Z]/.test(r.label) ? r.label.toUpperCase() : `${r.label.toUpperCase()} (${r.table})`;

function gstr9Output(c: Ctx): WorkingPaper {
  const { w, heads, just } = c;
  const n = heads.length;
  const p = new PaperBuilder();
  const blockW = 2 + n;
  const hd = ['PARTICULARS', 'TAXABLE', ...headRow(heads)];
  const portalKey: Record<string, string> = { amd: 'amd_pos' };
  const t = p.table([
    [{ v: '(A) DATA AS PER BOOKS', span: blockW, align: 'center' }, null, { v: '(B) DATA AUTO POPULATED AS PER GSTR 9', span: blockW, align: 'center' }],
    [...hd, null, ...hd],
  ], { freeze: true, keyCols: 1, groups: [Array.from({ length: blockW - 1 }, (_, i) => 1 + i), [blockW], Array.from({ length: blockW }, (_, i) => blockW + 1 + i)] });
  const allV: Array<'t' | Head> = ['t', ...heads];
  w.outward.rows.forEach((r) => {
    const label = `${outwardLabel(r)}${r.subtract ? ' (-)' : ''}`;
    t.data(label, ...valCells(r.books, heads), null, label, ...allV.map((h) => src(r.portal[h], c.portalSrc(`gstr9.table4.${portalKey[r.key] ?? r.key}.${h}`))));
  });
  t.total('TOTAL', ...valCells(w.outward.booksTotal, heads), null, 'TOTAL', ...valCells(w.outward.portalTotal, heads));
  p.h2('DIFFERENCE BETWEEN A & B (A - B)');
  // The justification runs across the (B) block's columns, which this table leaves free.
  const jw = n + 4;
  const d = p.table([['PARTICULARS', 'TAXABLE', ...headRow(heads), wide('JUSTIFICATION', jw)]], { keyCols: 1 });
  w.outward.rows.forEach((r) => d.data(`${outwardLabel(r)}${r.subtract ? ' (-)' : ''}`, ...valCells(r.diff, heads), wide(just(`out.${r.key}`), jw)));
  d.total('TOTAL', ...valCells(w.outward.diffTotal, heads), wide(just('out.total'), jw));
  return paper(c, {
    ref: 'C1', title: 'GSTR 9-OUTPUT — Outward supplies, books vs GSTR-9', sheet: 'C1 GSTR 9-OUTPUT', phase: 'reconcile', master: 'GSTR 9-OUTPUT',
    source: 'Source: books (B1 PL-OUTPUT, by Table 4 category) against GSTR-9 Table 4 as auto-populated (B6) — GSTR 9-OUTPUT of MASTER_PMS',
    widths: [40, 18, ...heads.map(() => 16), 3, 40, 18, ...heads.map(() => 16), 48], freezeCols: 1,
  }, p);
}

function gstr9Input(c: Ctx): WorkingPaper {
  const { w, heads, just } = c;
  const p = new PaperBuilder();
  const I = w.itc;
  const sum = (t: Tax) => heads.reduce((a, h) => a + t[h], 0);
  p.h1('ITC WORKING FOR GSTR 9');
  const t = p.table([['PARTICULARS', 'TAXABLE', ...headRow(heads), 'TOTAL TAX', 'NOTE']], { freeze: true, keyCols: 1 });
  const vrow = (kind: RowKind, label: string, v: ValTax | null, x: Tax, note: Cell = '', s?: Src) =>
    t.row(kind, [label, v ? v.t : null, ...(s ? srcTax(x, heads, () => s) : taxCells(x, heads)), sum(x), note]);
  vrow('data', 'INPUT (6B INPUTS)', I.inputs, I.inputs);
  vrow('data', 'INPUT SERVICES (6B INPUT SERVICES — BALANCING FIGURE)', I.inputServices, I.inputServices, muted('Tax = 6A2 less every other row, so 6(O) ties to 6A2'));
  vrow('data', '   of which: ITC booked on these ledgers (for reference)', null, I.inputServicesBooks);
  vrow('data', 'IMPORT OF GOODS (6E)', I.importGoods, I.importGoods);
  vrow('data', 'CAPITAL GOODS (6B CAPITAL GOODS)', I.capitalGoods, I.capitalGoods);
  vrow('data', 'RCM (RCM SHEET PART B - AS PER BOOKS)', I.rcm, I.rcm);
  vrow('data', 'ITC RECLAIM (6H)', null, I.reclaim);
  vrow('data', 'ISD (6G)', null, I.isd);
  vrow('data', 'TRAN-1 / TRAN-2 / ITC-01, 02, 02A (6N)', null, I.t6N);
  vrow('subtotal', 'AS PER 3B (6A2 = 6A - 6A1)', null, I.asPer3B);
  vrow('total', 'TOTAL (SHOULD BE MATCHED WITH 6(O) OF GSTR 9)', I.total, I.total);
  vrow('data', 'ITC REVERSAL (7H1 - SUSPENDED ITC REVERSED)', null, I.reversal7H1);
  vrow('data', 'AS PER SECTION 17(5) (7E)', null, I.s17_5);
  vrow('data', 'OTHER REVERSALS (7A-7D, 7F, 7G, OTHER 7H)', null, I.otherReversals);
  vrow('total', 'TOTAL (SHOULD BE MATCHED WITH 7(J) OF GSTR 9)', null, I.total7J);
  vrow('data', 'AS PER BOOK (DUTIES & TAXES NET, AFTER LAST YEAR EFFECT)', null, I.asPerBook);
  vrow('subtotal', 'DIFFERENCE (7J - BOOK)', null, I.residual, just('itc.books'));
  vrow('data', 'ITC TO BE REVERSED IN NEXT YEAR (TABLE 12; 8C AS NEGATIVE) — SUGGESTED', null, I.t12Suggested);
  vrow('data', `   Table 12 used (${w.g9.t12Source === 'override' ? 'typed' : 'computed'})`, null, w.g9.t12, '', w.g9.t12Source === 'override' ? 'typed' : undefined);
  vrow('data', 'ITC TO BE CLAIMED IN NEXT YEAR (TABLE 13; 8C) — SUGGESTED', null, I.t13Suggested);
  vrow('data', '   Table 13 typed', null, w.g9.t13, '', 'typed');
  return paper(c, {
    ref: 'C2', title: 'GSTR 9-INPUT — ITC working for GSTR-9', sheet: 'C2 GSTR 9-INPUT', phase: 'reconcile', master: 'GSTR 9-INPUT',
    source: 'Source: books ITC (B2 PL-INPUT, B4 D&T INPUT, B5 RCM) against GSTR-9 6A from the portal — GSTR 9-INPUT of MASTER_PMS',
    widths: [66, 18, ...heads.map(() => 16), 18, 48],
  }, p);
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

function gstr9cHeads(c: Ctx): WorkingPaper {
  const { w, docs, heads, just } = c;
  const p = new PaperBuilder();
  const sum = (t: Tax) => heads.reduce((a, h) => a + t[h], 0);
  const ledgers: Partial<Record<ExpenseHead, string[]>> = {};
  docs.purchases.rows.forEach((r) => {
    const h = w.purchases.rows[r.id]?.head ?? resolveHead(r);
    (ledgers[h] ||= []).push(r.ledger || '(unnamed)');
  });
  p.h1('ITC WORKING FOR THE PURPOSE OF GSTR 9C');
  const t = p.table([['SR NO', 'PARTICULARS', 'VALUE', ...headRow(heads), 'TOTAL TAX', 'LEDGERS (PL-INPUT)']], { freeze: true, keyCols: 2 });
  C14_ROWS.forEach(([k, label, head]) => {
    const v = w.c14.rows[k];
    if (!v) return;
    let note = head ? (ledgers[head] ?? []).join(', ') : '';
    if (k === 'A1') note = 'Duties & Taxes suspended ITC (reversed - reclaimed)';
    if (k === 'P') note = 'RCM sheet Part B';
    if (k === 'Q') note = [note, `balancing figure ${round2(w.c14.qBalancing.t)} value / ${round2(sum(w.c14.qBalancing))} tax`].filter(Boolean).join(' · ');
    t.row(k === 'A2' ? 'subtotal' : 'data', [k, label, ...valCells(v, heads), sum(v), note]);
  });
  t.total('R', 'TOTAL AMOUNT OF ELIGIBLE ITC AVAILED', ...valCells(w.c14.rows.R, heads), sum(w.c14.rows.R));
  t.data('', 'NET ITC AS PER PL-INPUT', ...valCells(w.purchases.netItc, heads), sum(w.purchases.netItc));
  t.sub('', 'CHECK (PL-INPUT - R)', ...valCells(w.c14.check, heads), sum(w.c14.check));
  t.data('S', 'ITC CLAIMED IN GSTR-9 (7J)', null, ...taxCells(w.c14.S, heads), sum(w.c14.S));
  t.total('T', 'UN-RECONCILED ITC (R - S)', null, ...taxCells(w.c14.T, heads), sum(w.c14.T), just('gstr9c.14T'));
  return paper(c, {
    ref: 'C3', title: 'GSTR 9C — ITC by expense head (Table 14)', sheet: 'C3 GSTR 9C', phase: 'reconcile', master: 'GSTR 9C',
    source: 'Source: books ITC by GSTR-9C expense head (B2 PL-INPUT, B5 RCM) against GSTR-9 7J — GSTR 9C of MASTER_PMS',
    widths: [8, 58, 18, ...heads.map(() => 16), 16, 70],
  }, p);
}

function annexure(c: Ctx): WorkingPaper {
  const { w, docs, heads, just } = c;
  const p = new PaperBuilder();
  const all = ALL_HEADS;

  // Annexure-1
  const A1 = w.ann1;
  p.h2('ANNEXURE-1 (INCOME RECO.)');
  const a1 = p.table([['SR NO', 'PARTICULARS', 'AMOUNT', ...headRow(heads), wide('JUSTIFICATION', 5 - heads.length)]], { keyCols: 2 });
  a1.data('A', 'GROSS TAXABLE INCOME AS PER P/L', ...valCells(A1.A, heads));
  a1.data('', 'NET NON-GST INCOME AS PER P/L', src(A1.nonGst, 'typed'));
  a1.data('B', 'SALE RETURN AS PER P/L', ...(['t', ...heads] as Array<'t' | Head>).map((h) => src(A1.B[h], 'typed')));
  a1.sub('C: A-B', 'TOTAL INCOME FROM P/L', ...valCells(A1.C, heads));
  a1.data('D', 'TAX PAID ON RCM AS PER BOOKS', ...valCells(A1.D, heads));
  a1.sub('E: C+D', 'TOTAL AS PER NEW GSTR 9', ...valCells(A1.E, heads));
  a1.data('F', 'TOTAL AS PER AUTO CALCULATED GSTR 9', ...valCells(A1.F, heads));
  a1.total('G= E-F', 'DIFFERENCE', ...valCells(A1.G, heads), wide(just('ann1.income'), 5 - heads.length));
  p.h3('PAID & PAYABLE');
  const pp = p.table([['', 'PARTICULARS', 'PAYABLE', 'PAID', 'DIFF.', wide('JUSTIFICATION', 3)]], { keyCols: 2 });
  heads.forEach((h, i) => pp.data('', HEAD_LABEL[h], A1.payable[h], A1.paid[h], A1.payDiff[h], wide(i === 0 ? just('ann1.paid') : '', 3)));

  // Annexure-2
  const A2 = w.ann2;
  p.h2('ANNEXURE-2 (ITC RECO.)');
  const a2t = p.table([['SR NO', 'PARTICULARS', ...headRow(heads), wide('JUSTIFICATION', 6 - heads.length)]], { keyCols: 2 });
  const a2 = (kind: RowKind, code: string, label: string, t: Tax, extra?: Cell) => a2t.row(kind, [code, label, ...taxCells(t, heads), ...(extra === undefined ? [] : [extra])]);
  a2('data', 'A', 'DR. BALANCE OF ITC LEDGER', A2.A);
  a2('data', 'A1', 'RCM - ITC', A2.A1);
  a2('data', 'A2', 'DEBIT NOTE', A2.A2);
  a2('data', 'B', 'OTHER ADJUSTMENT IN DR./CR. SIDE', A2.B);
  a2('subtotal', 'C=A+A1-A2-B', 'NET ITC AVAILED', A2.C);
  a2('data', 'D', 'ITC OF THIS YEAR CLAIMED IN NEXT YEAR (EFFECT TO BE GIVEN IN CLAUSE 11 & 12 OF GSTR-09)', A2.D);
  a2('subtotal', 'E=C+D', 'TOTAL', A2.E);
  a2('data', 'F', 'AS PER PORTAL (CLAUSE 6A AUTO POPULATED, WHICH INCLUDES ITC OF PREVIOUS YEAR CLAIMED IN THIS YEAR & ITC OF THIS YEAR)', A2.F);
  a2('data', 'G1', 'REVERSAL AS PER 7(H1)', A2.G1);
  a2('data', 'G2', 'REST OF TABLE 7 (7A-7G AND OTHER 7H LINES)', A2.G2);
  a2('data', 'H', 'ITC OF PREVIOUS YEAR CLAIMED IN THIS YEAR', A2.H);
  a2('subtotal', 'I=F-G1-G2-H', 'NET ITC', A2.I);
  a2('total', 'J=E-I', 'EXCESS ITC CLAIMED / TO BE CLAIMED', A2.J, wide(just('ann2.J'), 6 - heads.length));

  // Annexure-3 (always with Cess, as the sheet)
  const A3 = w.ann3;
  p.h2('ANNEXURE-3 (DRC 03 CALCULATION)');
  const a3 = p.table([['SR NO', 'PARTICULARS', ...headRow(all)]], { keyCols: 2 });
  a3.data(sr(1), 'CLAUSE 9 DIFFERENCE OF GSTR 9', ...taxCells(A3.clause9, all));
  a3.data(sr(2), `RCM TO BE PAID (AS PER RCM SHEET)${docs.annexures.a3RcmToPay === null ? ' — suggested' : ''}`, ...(docs.annexures.a3RcmToPay === null ? taxCells(A3.rcmToPay, all) : srcTax(A3.rcmToPay, all, () => 'typed')));
  a3.data(sr(3), `EXCESS ITC CLAIMED AS PER RECO${docs.annexures.a3ExcessItc === null ? ' — suggested (Table 12)' : ''}`, ...(docs.annexures.a3ExcessItc === null ? taxCells(A3.excessItc, all) : srcTax(A3.excessItc, all, () => 'typed')));
  a3.data(sr(4), 'ANY OTHER PAYMENT (TO BE SPECIFIED)', ...taxCells(A3.other, all));
  docs.annexures.a3Other.forEach((o) => a3.data('', `   ${o.description || 'Other'}`, ...srcTax(tin(o), all, () => 'typed')));
  a3.total(lbl('TOTAL'), ...taxCells(A3.total, all));
  a3.data('', 'DRC-03 PAYABLE (POSITIVE HEADS)', ...taxCells(A3.payable, all));
  a3.data('', 'EXCESS PAID (NEGATIVE HEADS)', ...taxCells(A3.excessPaid, all));
  a3.data('', 'DRC-03 ALREADY PAID', ...taxCells(A3.alreadyPaid, all));
  a3.total('', 'BALANCE TO PAY', ...taxCells(A3.balance, all));
  p.note('DRC-03 already paid is what the set-off register (E1) records against an imported DRC-03 or a GSTR-3B effect.');

  // Annexure-4
  p.h2('ANNEXURE-4 (DETAILS OF PREVIOUS YEAR GSTR-09 CLAUSE-8, 10, 11, 12 & 13)');
  const a4 = p.table([['SR NO', 'PARTICULAR', ...headRow(all)]], { keyCols: 2 });
  (['c8', 'c10', 'c11', 'c12', 'c13'] as const).forEach((k, i) => a4.data(sr(i + 1), `CLAUSE -${k.slice(1)}`, ...srcTax(tin(docs.annexures.a4[k]), all, () => 'typed')));
  return paper(c, {
    ref: 'C4', title: 'ANNEXURE — Income, ITC, DRC-03 and previous-year reconciliations', sheet: 'C4 ANNEXURE', phase: 'reconcile', master: 'ANNEXURE',
    source: 'Source: the reconciliations above (B1–B5, C1–C3) and GSTR-9 — ANNEXURE 1–4 of MASTER_PMS',
    widths: [12, 70, 18, 16, 16, 16, 16, 48],
  }, p);
}

/** The engine's status label; a re-check says why, since the sheet has no popover to explain it. */
const statusLabel = (d: DiffLine, tolerance: number): WpCell => {
  const st = diffStatus(d, tolerance);
  const text = st.kind === 'recheck' ? `${st.label} (moved since justified)` : st.label;
  const fill = st.kind === 'open' || st.kind === 'recheck' ? 'bad' : st.kind === 'justified' ? 'info' : st.kind === 'matched' || st.kind === 'within' ? 'good' : undefined;
  return { v: text, fill };
};

function differences(c: Ctx): WorkingPaper {
  const { w } = c;
  const p = new PaperBuilder();
  p.h1(`EVERY DIFFERENCE LINE — a line needs a reason when any head exceeds ₹${w.tolerance}. Open lines: ${w.openCount}.`);
  const t = p.table([['STEP', 'LINE', 'DIRECTION', 'LEFT SIDE', 'RIGHT SIDE', 'VALUE DIFF', 'IGST', 'CGST', 'SGST', 'CESS', 'STATUS', 'JUSTIFICATION', 'BY', 'WHEN', 'LINE KEY']], {
    freeze: true, autoFilter: true, keyCols: 2, groups: [[2, 3, 4], [5, 6, 7, 8, 9], [10, 11], [12, 13, 14]],
  });
  w.diffs.forEach((d) => {
    const j = d.justification;
    t.data(
      STEP_NAME[d.step] ?? d.step,
      d.label,
      d.direction,
      d.aLabel,
      d.bLabel,
      d.hasTaxable ? d.diff.t : null,
      ...(d.hasTax ? [d.diff.i, d.diff.c, d.diff.s, d.diff.x] : [null, null, null, null]),
      statusLabel(d, w.tolerance),
      j?.text?.trim() ?? '',
      j?.text?.trim() ? j.by ?? '' : '',
      j?.text?.trim() ? fmtDateTime(j.at) : '',
      d.key,
    );
  });
  return paper(c, {
    ref: 'C5', title: 'Differences and reasons', sheet: 'C5 DIFFERENCES', phase: 'reconcile', master: 'DIFFERENCES',
    source: 'Source: every difference line of the working (books − portal), its status and the reason recorded against it',
    widths: [30, 60, 18, 26, 26, 16, 16, 16, 16, 14, 26, 70, 16, 20, 18],
  }, p);
}

// ---------------------------------------------------------------------------
// D — Returns
// ---------------------------------------------------------------------------

/** A form-table paper (GSTR-9, NOTICE FORMATE): part heading, table title, header row, rows. */
function formBlocks(p: PaperBuilder, tables: FormTable[], opts: { numberRow?: boolean; cellSrc?: (t: FormTable, rowIdx: number, col: number) => Src | undefined } = {}): void {
  let part: string | undefined;
  tables.forEach((t) => {
    if (t.part && t.part !== part) {
      part = t.part;
      p.h2(t.part);
    }
    if (t.no) p.h3(t.title, t.no);
    else p.h3(t.title);
    if (t.note) p.note(t.note);
    const head: Cell[][] = [[t.no ? 'No.' : 'S.No', t.labelHead ?? 'Description', ...t.head]];
    if (opts.numberRow) head.push(Array.from({ length: 2 + t.head.length }, (_, i) => sr(i + 1)));
    const b = p.table(head, { keyCols: 2 });
    t.rows.forEach((row, ri) => {
      const cells: Cell[] = [row.code, row.label, ...row.cells.map((v, ci) => {
        const s = typeof v === 'number' ? opts.cellSrc?.(t, ri, ci) : undefined;
        return s ? src(v as number, s) : v;
      })];
      b.row(row.bold ? 'subtotal' : 'data', cells);
    });
  });
}

/** Where each GSTR-9 figure comes from (docs/GSTR9_9C_WORKINGS.md §5), for the colour convention. */
function gstr9CellSrc(c: Ctx): (t: FormTable, rowIdx: number, col: number) => Src | undefined {
  const { docs, w } = c;
  const G = docs.gstr9;
  const T4_KEY: Record<string, string> = { A: 'b2c', B: 'b2b', C: 'exp', D: 'sez', E: 'deemed', F: 'at', G1: 'ecom', I: 'cr_nt', J: 'dr_nt', K: 'amd_pos', L: 'amd_neg' };
  const VAL_KEYS = ['t', 'c', 's', 'i', 'x'];
  const TAX_KEYS = ['c', 's', 'i', 'x'];
  const HEAD9: Record<string, string> = { A: 'igst', B: 'cgst', C: 'sgst', D: 'cess' };
  const OTHER9: Record<string, string> = { E: 'interest', F: 'lateFee', G: 'penalty', H: 'other' };
  return (t, ri, col) => {
    const row = t.rows[ri];
    const code = row.code;
    switch (t.no) {
      case '4':
        if (T4_KEY[code]) return w.g9.t4Source === 'portal' ? c.portalSrc(`gstr9.table4.${T4_KEY[code]}.${VAL_KEYS[col]}`) : 'typed';
        if (code === 'G') return w.rcm.partASource === 'none' ? undefined : w.rcm.partASource === 'gstr9' ? c.portalSrc(`gstr9.table4.rchrg.${VAL_KEYS[col]}`) : 'portal';
        return undefined;
      case '5':
        return code === 'I' || code === 'J' || code === 'K' ? 'typed' : undefined;
      case '6': {
        const h = TAX_KEYS[col - 1];
        if (code === 'A') return w.g9.t6ASource === 'gstr9' ? c.portalSrc(`gstr9.t6A.${h}`) : w.g9.t6ASource === 'monthly_3b' ? 'portal' : undefined;
        if (code === 'A1') return G.t6A1 === null || G.t6A1 === undefined ? undefined : 'typed';
        if (code === 'G') return G.t6G === null || G.t6G === undefined ? c.portalSrc(`gstr9.t6G.${h}`) : 'typed';
        if (code === 'K' || code === 'L' || code === 'M') return 'typed';
        return undefined;
      }
      case '7':
        if (['A', 'A1', 'A2', 'B', 'C', 'D', 'F', 'G'].includes(code)) return 'typed';
        if (code === 'E') return G.t7.s17_5 === null || G.t7.s17_5 === undefined ? 'portal' : 'typed';
        if (/^H\d+$/.test(code)) return code === 'H1' ? undefined : 'typed';
        return undefined;
      case '8':
        if (code === 'A') return c.portalSrc(`gstr9.t8A.${TAX_KEYS[col]}`);
        if (code === 'E' || code === 'F' || code === 'H1') return 'typed';
        return undefined;
      case '9': {
        if (HEAD9[code]) {
          if (col === 0) {
            const s = w.g9.t9[HEAD9[code] as 'igst'].payableSource;
            return s === 'override' ? 'typed' : s === 'portal' ? c.portalSrc(`gstr9.table9.${HEAD9[code]}.payable`) : undefined;
          }
          const f = ['payable', 'cash', 'itcC', 'itcS', 'itcI', 'itcX'][col];
          return col >= 1 && col <= 5 ? c.portalSrc(`gstr9.table9.${HEAD9[code]}.${f}`) : undefined;
        }
        if (OTHER9[code]) return col === 0 ? c.portalSrc(`gstr9.table9.${OTHER9[code]}.payable`) : col === 1 ? c.portalSrc(`gstr9.table9.${OTHER9[code]}.cash`) : undefined;
        return undefined;
      }
      case '10–13':
        if (code === '10' || code === '11' || code === '13') return 'typed';
        if (code === '12') return w.g9.t12Source === 'override' ? 'typed' : undefined;
        return undefined;
      case '14': case '15': case '16': case '17': case '18': case '19':
        return row.label === 'Total' && !code ? undefined : 'typed';
      default:
        return undefined;
    }
  };
}

function gstr9Form(c: Ctx): WorkingPaper {
  const { w } = c;
  const p = new PaperBuilder();
  p.note('(Amount in ₹ in all tables)');
  formBlocks(p, gstr9FormTables(w), { cellSrc: gstr9CellSrc(c) });
  return paper(c, {
    ref: 'D1', title: 'GSTR-9 — Annual return, Tables 4 to 19', sheet: 'D1 GSTR-9', phase: 'returns', master: 'GSTR-9',
    source: 'Source: the reconciliations (C1–C4), GSTR-9 system-computed figures (B6) and the cells typed on the GSTR-9 step — GSTR-9 of MASTER_PMS',
    widths: [8, 80, 18, 18, 18, 18, 18, 18, 18, 18, 18],
  }, p);
}

// GSTR-9C (official tables) — labels as the GSTR-9C step shows them (GSTR_9C_Offline_Utility.xlsm v2.8).
const T5_LABEL: Record<string, string> = {
  A: 'Turnover (including exports) as per audited financial statement',
  B: 'Unbilled revenue at the beginning of the FY',
  C: 'Unadjusted advances at the end of the FY',
  D: 'Deemed supply under Schedule I',
  E: 'Credit notes issued after the end of the FY but reflected in the annual return',
  F: 'Trade discounts accounted for in the financials but not permissible under GST',
  G: 'Turnover from April 2017 to June 2017',
  H: 'Unbilled revenue at the end of the FY',
  I: 'Unadjusted advances at the beginning of the FY',
  J: 'Credit notes accounted for in the financials but not permissible under GST',
  K: 'Adjustments on account of supply of goods by SEZ units to DTA units',
  L: 'Turnover for the period under composition scheme',
  M: 'Adjustments in turnover under section 15 and rules thereunder',
  N: 'Adjustments in turnover due to foreign exchange fluctuation',
  O: 'Adjustment in turnover due to reasons not listed above',
  P: 'Annual turnover after adjustments',
  Q: 'Turnover as declared in annual return (GSTR-9)',
  R: 'Un-reconciled turnover',
};
const T5_EITHER = ['M', 'N', 'O'];
const T7_LABEL: Record<string, string> = {
  A: 'Annual turnover after adjustments (from 5P)',
  B: 'Value of exempted, nil rated, non-GST supplies, no-supply turnover',
  C: 'Zero rated supplies without payment of tax',
  D: 'Supplies on which tax is to be paid by recipient on reverse charge',
  D1: 'Supplies on which tax is to be paid by e-commerce operators u/s 9(5)',
  E: 'Taxable turnover as per adjustments above',
  F: 'Taxable turnover as per liability declared in annual return (GSTR-9)',
  G: 'Unreconciled taxable turnover',
};
const T9_LABEL: Record<string, string> = {
  A: '5%', B: '5% (RC)', B1: '6%', C: '12%', D: '12% (RC)', E: '18%', F: '18% (RC)', G: '28%', H: '28% (RC)', H1: '40%', H2: '40% (RC)',
  I: '3%', J: '0.25%', K: '0.10%', K1: 'Others %', K2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  L: 'Interest', M: 'Late fee', N: 'Penalty', O: 'Others',
  P: 'Total amount to be paid as per tables above', Q: 'Total amount payable as declared in annual return (GSTR-9)', R: 'Un-reconciled payment of amount',
};
const T11_LABEL: Record<string, string> = {
  A: '5%', A1: '6%', B: '12%', C: '18%', D: '28%', D1: '40%', E: '3%', F: '0.25%', G: '0.10%', G1: 'Others %',
  G2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)', H: 'Interest', I: 'Late fee', J: 'Penalty', K: 'Others',
};
const T11_TAX_ONLY = ['H', 'I', 'J', 'K'];
const T12_LABEL: Record<string, string> = {
  A: 'ITC availed as per audited annual financial statement / books of account',
  B: 'ITC booked in earlier financial years claimed in current financial year',
  C: 'ITC booked in current financial year to be claimed in subsequent financial years',
  D: 'ITC availed as per audited financial statement or books of account',
  E: 'ITC claimed in annual return (GSTR-9)',
  F: 'Un-reconciled ITC',
};
const T14_ROWS: Array<{ k: string; label: string }> = [
  { k: 'A', label: 'Purchases' },
  { k: 'A1', label: '   Less: suspended ITC (reversed, net of reclaims)' },
  { k: 'A2', label: '   Net purchases (A − A1) — reported in 14A' },
  { k: 'B', label: 'Freight / carriage' },
  { k: 'C', label: 'Power and fuel' },
  { k: 'D', label: 'Imported goods (including received from SEZs)' },
  { k: 'E', label: 'Rent and insurance' },
  { k: 'F', label: 'Goods lost, stolen, destroyed, written off or disposed of by way of gift or free samples' },
  { k: 'G', label: 'Royalty' },
  { k: 'H', label: "Employees' cost (salaries, wages, bonus etc.)" },
  { k: 'I', label: 'Conveyance charges' },
  { k: 'J', label: 'Bank charges' },
  { k: 'K', label: 'Entertainment charges' },
  { k: 'L', label: 'Stationery expenses (including postage etc.)' },
  { k: 'M', label: 'Repair and maintenance' },
  { k: 'N', label: 'Other miscellaneous expenses' },
  { k: 'O', label: 'Capital goods' },
  { k: 'P', label: 'Any other expense 1 (RCM)' },
  { k: 'Q', label: 'Any other expense 2' },
];
const T16_LABEL: Record<string, string> = { A: 'Central tax', B: 'State/UT tax', C: 'Integrated tax', D: 'Cess', E: 'Interest', F: 'Penalty' };
const PART_V_LABEL: Record<string, string> = {
  A: '5%', A1: '6%', B: '12%', C: '18%', D: '28%', D1: '40%', E: '3%', F: '0.25%', G: '0.10%', G1: 'Others %',
  G2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)', H: 'Input tax credit', I: 'Interest', J: 'Late fee', K: 'Penalty',
  L: 'Any other amount paid for supplies not included in annual return (GSTR-9)', M: 'Erroneous refund to be paid back',
  N: 'Outstanding demands to be settled', O: 'Other',
};
const PART_V_TAX_ONLY = ['H', 'I', 'J', 'K', 'M', 'N', 'O'];
const CERT_LABEL: Array<[string, string]> = [
  ['signatory_name', 'Name of the signatory'], ['membership_no', 'Membership no.'], ['place', 'Place'], ['signature_date', 'Date'], ['pan', 'PAN'],
  ['building_no', 'Building no. / flat no.'], ['floor_number', 'Floor number'], ['premises_name', 'Name of the premises / building'],
  ['road_street', 'Road / street'], ['city_town_locality', 'City / town / locality / village'], ['district', 'District'], ['state', 'State'], ['pin_code', 'PIN code'],
];

const V_HEAD = ['Value', 'Central tax', 'State/UT tax', 'Integrated tax', 'Cess'];

function gstr9c(c: Ctx): WorkingPaper {
  const { docs, w, just } = c;
  const C = docs.gstr9c;
  const W = w.gstr9c;
  const p = new PaperBuilder();
  const n0 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const amt = (v: number, s?: Src): Cell => (s ? src(v, s) : v);
  /** Value + tax in the form's column order (Value, Central, State/UT, Integrated, Cess). */
  const vt = (r: Partial<ValTax> | null | undefined, s?: Src, withValue = true): Cell[] => {
    const x = r ?? {};
    return [withValue ? amt(n0(x.t), s) : null, amt(n0(x.c), s), amt(n0(x.s), s), amt(n0(x.i), s), amt(n0(x.x), s)];
  };
  const reasons = (code: string, title: string, text: string | undefined, diffKey: string) => {
    p.h3(title, code);
    const r = p.table([], { plain: true });
    r.data('', { v: text?.trim() || '—', span: 7 });
    const j = just(diffKey);
    if (j && !(text ?? '').includes(j)) r.data('', { v: `Justification recorded on the difference line: ${j}`, span: 7, italic: true, muted: true });
  };

  p.h2('Pt. II   Reconciliation of turnover declared in audited annual financial statement with turnover declared in annual return (GSTR-9)');
  p.h3('Reconciliation of gross turnover', '5');
  const t5 = p.table([['No.', 'Description', 'Amount', wide('Justification', 5)]], { keyCols: 2 });
  t5.data('5A', T5_LABEL.A, amt(W.t5.A, C.t5A === null || C.t5A === undefined ? undefined : 'typed'));
  GSTR9C_T5_KEYS.forEach((k) => {
    const sign = T5_EITHER.includes(k) ? '(+/−)' : GSTR9C_T5_SUB.includes(k) ? '(−)' : '(+)';
    t5.data(`5${k}`, `${T5_LABEL[k]} ${sign}`, amt(n0(W.t5.rows[k]), 'typed'));
  });
  t5.total('5P', `${T5_LABEL.P} (A + B + C + D − E + F − G − H − I + J − K − L + M + N + O)`, W.t5.P);
  t5.data('5Q', T5_LABEL.Q, amt(W.t5.Q, C.t5Q === null || C.t5Q === undefined ? undefined : 'typed'));
  t5.total('5R', `${T5_LABEL.R} (Q − P)`, W.t5.R, wide(just('gstr9c.5R'), 5));
  reasons('6', 'Reasons for un-reconciled difference in annual gross turnover', C.t6Reasons, 'gstr9c.5R');

  p.h3('Reconciliation of taxable turnover', '7');
  const t7 = p.table([['No.', 'Description', 'Amount', wide('Justification', 5)]], { keyCols: 2 });
  t7.data('7A', T7_LABEL.A, W.t7.A);
  (['B', 'C', 'D', 'D1'] as const).forEach((k) => t7.data(`7${k}`, T7_LABEL[k], amt(W.t7[k], C.t7?.[k] === null || C.t7?.[k] === undefined ? undefined : 'typed')));
  t7.sub('7E', `${T7_LABEL.E} (A − B − C − D − D1)`, W.t7.E);
  t7.data('7F', T7_LABEL.F, amt(W.t7.F, C.t7F === null || C.t7F === undefined ? undefined : 'typed'));
  t7.total('7G', `${T7_LABEL.G} (F − E)`, W.t7.G, wide(just('gstr9c.7G'), 5));
  reasons('8', 'Reasons for un-reconciled difference in taxable turnover', C.t8Reasons, 'gstr9c.7G');

  p.h2('Pt. III   Reconciliation of tax paid');
  p.h3('Reconciliation of rate-wise liability and amount payable thereon', '9');
  const t9 = p.table([['No.', 'Description', ...V_HEAD, 'Justification']], { keyCols: 2 });
  GSTR9C_T9_RATE_KEYS.forEach((k) => t9.data(`9${k}`, T9_LABEL[k], ...vt(W.t9.rows[k], W.t9.derived[k] ? undefined : 'typed')));
  GSTR9C_T9_OTHER_KEYS.forEach((k) => t9.data(`9${k}`, T9_LABEL[k], ...vt(W.t9.rows[k], 'typed', false)));
  t9.total('9P', T9_LABEL.P, ...vt(W.t9.P));
  t9.data('9Q', T9_LABEL.Q, ...vt(W.t9.Q, C.t9Q === null || C.t9Q === undefined ? undefined : 'typed', false));
  t9.total('9R', `${T9_LABEL.R} (Q − P)`, ...vt(W.t9.R, undefined, false), just('gstr9c.9R'));
  reasons('10', 'Reasons for un-reconciled payment of amount', C.t10Reasons, 'gstr9c.9R');

  p.h3('Additional amount payable but not paid (due to reasons specified in Tables 6, 8 and 10 above)', '11');
  const t11 = p.table([['No.', 'Description', ...V_HEAD]], { keyCols: 2 });
  const sum11: ValTax = { t: 0, i: 0, c: 0, s: 0, x: 0 };
  GSTR9C_T11_KEYS.forEach((k) => {
    const r: RateWiseRow | undefined = C.t11?.[k];
    const taxOnly = T11_TAX_ONLY.includes(k);
    if (!taxOnly) sum11.t += n0(r?.t);
    (['i', 'c', 's', 'x'] as const).forEach((h) => { sum11[h] += n0(r?.[h]); });
    t11.data(`11${k}`, T11_LABEL[k], ...vt(r, 'typed', !taxOnly));
  });
  t11.total('', 'Total', ...vt(sum11));

  p.h2('Pt. IV   Reconciliation of Input Tax Credit (ITC)');
  p.h3('Reconciliation of net input tax credit (ITC)', '12');
  const t12 = p.table([['No.', 'Description', ...V_HEAD, 'Justification']], { keyCols: 2 });
  const over12 = (k: 'A' | 'B' | 'C'): Src | undefined => (C[`t12${k}`] === null || C[`t12${k}`] === undefined ? undefined : 'typed');
  t12.data('12A', T12_LABEL.A, ...vt(W.t12.A, over12('A'), false));
  t12.data('12B', `${T12_LABEL.B} (+)`, ...vt(W.t12.B, over12('B'), false));
  t12.data('12C', `${T12_LABEL.C} (−)`, ...vt(W.t12.C, over12('C'), false));
  t12.sub('12D', `${T12_LABEL.D} (A + B − C)`, ...vt(W.t12.D, undefined, false));
  t12.data('12E', T12_LABEL.E, ...vt(W.t12.E, undefined, false));
  t12.total('12F', `${T12_LABEL.F} (E − D)`, ...vt(W.t12.F, undefined, false), just('gstr9c.12F'));
  reasons('13', 'Reasons for un-reconciled difference in ITC', C.t13Reasons, 'gstr9c.12F');

  p.h3('Reconciliation of ITC declared in annual return (GSTR-9) with ITC availed on expenses as per audited annual financial statement or books of account', '14');
  const t14 = p.table([['No.', 'Description', ...V_HEAD, 'Justification']], { keyCols: 2 });
  T14_ROWS.forEach((r) => t14.row(r.k === 'A2' ? 'subtotal' : 'data', [`14${r.k}`, r.label, ...vt(W.t14.rows[r.k])]));
  t14.total('14R', 'Total amount of eligible ITC availed', ...vt(W.t14.R));
  t14.data('14S', 'ITC claimed in annual return (GSTR-9)', ...vt(W.t14.S, undefined, false));
  t14.total('14T', 'Un-reconciled ITC (R − S)', ...vt(W.t14.T, undefined, false), just('gstr9c.14T'));
  reasons('15', 'Reasons for un-reconciled difference in ITC', C.t15Reasons, 'gstr9c.14T');

  p.h3('Tax payable on un-reconciled difference in ITC (due to reasons specified in Tables 13 and 15 above)', '16');
  const t16 = p.table([['No.', 'Description', 'Amount payable']], { keyCols: 2 });
  GSTR9C_T16_KEYS.forEach((k) => t16.data(`16${k}`, T16_LABEL[k], amt(n0(C.t16?.[k]), 'typed')));

  p.h2('Pt. V   Additional liability due to non-reconciliation');
  const pv = p.table([['No.', 'Description', ...V_HEAD]], { keyCols: 2 });
  const sumV: ValTax = { t: 0, i: 0, c: 0, s: 0, x: 0 };
  GSTR9C_PARTV_KEYS.forEach((k) => {
    const r: RateWiseRow | undefined = C.partV?.[k];
    const taxOnly = PART_V_TAX_ONLY.includes(k);
    if (!taxOnly) sumV.t += n0(r?.t);
    (['i', 'c', 's', 'x'] as const).forEach((h) => { sumV[h] += n0(r?.[h]); });
    pv.data(k, PART_V_LABEL[k], ...vt(r, 'typed', !taxOnly));
  });
  pv.total('', 'Total', ...vt(sumV));
  p.note(`For reference — Annexure-3 (C4): DRC-03 payable ${fmtHeads(w.ann3.payable)}; already paid ${fmtHeads(w.ann3.alreadyPaid)}; balance to pay ${fmtHeads(w.ann3.balance)}.`);

  p.h2('Verification');
  const v = p.table([], { plain: true });
  CERT_LABEL.forEach(([k, label]) => {
    const raw = (C.certification as Record<string, string> | undefined)?.[k] ?? '';
    v.data(lbl(label), { v: k === 'signature_date' ? fmtDate(raw) : raw, span: 6 });
  });
  return paper(c, {
    ref: 'D2', title: 'GSTR-9C — Reconciliation statement (official tables)', sheet: 'D2 GSTR-9C', phase: 'returns', master: '— (9C offline utility)',
    source: 'Source: the working (books, GSTR-9) as the GSTR-9C step prefills it, with the figures typed over there — GSTR-9C offline utility tables 5–16 and Part V',
    widths: [8, 80, 18, 18, 18, 18, 18, 48],
  }, p);
}

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "IGST 1,200.00 · CGST 600.00" or "nil". */
const fmtHeads = (t: Tax): string => {
  const parts = ALL_HEADS.filter((h) => Math.abs(t[h]) >= 0.005).map((h) => `${HEAD_LABEL[h]} ${INR.format(t[h])}`);
  return parts.length ? parts.join(' · ') : 'nil';
};

function notice(c: Ctx): WorkingPaper {
  const { w, docs } = c;
  const N = docs.notice;
  const p = new PaperBuilder();
  const { outward, inward } = noticeTables(w);
  // Rows 3–5, 9, 10 (outward) and 2, 5 (inward) are typed here or on the GSTR-9 step / Annexure-4; 7–8 and 1, 4, 7, 8 come from the portal unless typed over.
  const outSrc: Record<string, Src | undefined> = { '3': 'typed', '4': 'typed', '5': 'typed', '7': 'portal', '8': 'portal', '9': 'typed', '10': 'typed' };
  const inSrc: Record<string, Src | undefined> = {
    '1': 'portal', '2': 'typed', '4': N.ineligible4D ? 'typed' : 'portal', '5': 'typed',
    '7': N.itcUsed4A5 ? 'typed' : 'portal', '8': N.reversed4B2 ? 'typed' : 'portal',
  };
  formBlocks(p, [outward, inward], {
    numberRow: true,
    // The TOTAL column adds the heads; only the head columns carry a source.
    cellSrc: (t, ri, col) => (col >= 1 && col <= 4 ? (t === outward ? outSrc : inSrc)[t.rows[ri].code] : undefined),
  });
  return paper(c, {
    ref: 'D3', title: 'NOTICE FORMATE — Outward and inward summary', sheet: 'D3 NOTICE FORMATE', phase: 'returns', master: 'NOTICE FORMATE',
    source: 'Source: GSTR-9 (D1) and the as-filed GSTR-3B (B6), with the cells typed on the Notice step — NOTICE FORMATE of MASTER_PMS',
    widths: [6, 80, 22, 18, 18, 18, 14, 18],
  }, p);
}

// ---------------------------------------------------------------------------
// E — Payables and set-off
// ---------------------------------------------------------------------------

const totalOf = (t: Tax): number => t.i + t.c + t.s + t.x;
const nz = (t: Tax): boolean => ALL_HEADS.some((h) => Math.abs(t[h]) >= 0.005);

function payables(c: Ctx): WorkingPaper {
  const { w, period, setOffs, drc03s, meta } = c;
  const P = w.payables;
  const p = new PaperBuilder();
  const heads = ALL_HEADS;
  const line = (t: TableBuilder, kind: RowKind, label: Cell, x: Tax) => t.row(kind, [label, ...taxCells(x, heads), totalOf(x)]);
  const hd = [['PARTICULARS', ...headRow(heads), 'TOTAL']];
  p.h1('PAYABLES FOUND BY THE ANNUAL RECONCILIATION, AND HOW EACH IS SET OFF');
  p.note('Disclosed output-wise and input-wise; heads and sides are never netted against each other. A set-off counts only against evidence: a DRC-03 imported into the system, or an effect given in a filed GSTR-3B.');
  const frozen = period?.payables_at_lock as { output?: PayableSideWorking; input?: PayableSideWorking } | null | undefined;
  if (frozen && period?.status === 'locked') {
    p.note(`The payable below is as frozen at the lock${period.locked_at ? ` on ${fmtDateTime(period.locked_at)}` : ''}${period.locked_by ? ` by ${period.locked_by}` : ''}; set-offs recorded since then are applied to it.`);
  } else if (frozen) {
    p.note('A payable was frozen at an earlier lock; the year has since been unlocked, so the payable below is the working as it stands now (a head that differs from the frozen figure is flagged).');
  }
  (['output', 'input'] as const).forEach((side) => {
    const S = P[side];
    p.h2(SIDE_LABEL[side].toUpperCase());
    const t = p.table(hd, { keyCols: 1, freeze: side === 'output' });
    S.components.forEach((k) => line(t, 'data', k.label, k.value));
    line(t, 'subtotal', 'Net (signed)', S.net);
    line(t, 'total', 'Payable (positive heads)', S.payable);
    line(t, 'data', muted('Excess — paid or reversed in excess; not a payable'), S.excess);
    line(t, 'data', 'Set off by DRC-03', S.setOffDrc03);
    line(t, 'data', 'Set off by GSTR-3B', S.setOffGstr3b);
    line(t, 'total', 'Balance outstanding', S.balance);
    if (nz(S.overSetOff)) line(t, 'data', { v: 'Over-set-off — set off beyond the payable', fill: 'bad' }, S.overSetOff);
    const f = frozen?.[side]?.payable;
    if (f && ALL_HEADS.some((h) => Math.abs((Number(f[h]) || 0) - S.payable[h]) >= 0.005)) {
      line(t, 'data', { v: 'Payable as frozen at the lock (differs from the working now)', fill: 'bad' }, { i: Number(f.i) || 0, c: Number(f.c) || 0, s: Number(f.s) || 0, x: Number(f.x) || 0 });
    }
  });
  p.h2('BOTH SIDES');
  const both = p.table(hd, { keyCols: 1 });
  line(both, 'data', 'Payable — output and input', P.totals.payable);
  line(both, 'data', 'Set off so far', P.totals.setOff);
  line(both, 'total', 'Balance outstanding', P.totals.balance);

  p.h2('SET-OFF REGISTER');
  p.note('Every set-off recorded, oldest first. Removed entries stay on the register, struck through, with who removed them and why; only live entries count above.');
  const reg = p.table([['SET-OFF', ...headRow(heads), 'TOTAL', 'REFERENCE (ARN)', 'DATE', 'GSTR-3B PERIOD', 'GSTR-3B TABLE', 'EVIDENCE', 'NOTE', 'BY', 'WHEN', 'STATUS']], {
    keyCols: 1, groups: [[1, 2, 3, 4, 5], [6, 7, 8, 9], [10, 11], [12, 13, 14]],
  });
  const live: Tax = { i: 0, c: 0, s: 0, x: 0 };
  setOffs.forEach((o) => {
    const removed = !!o.deletedAt;
    if (!removed) heads.forEach((h) => { live[h] += Number(o.tax[h]) || 0; });
    reg.row('data', [
      `${SIDE_LABEL[o.side]} — ${METHOD_LABEL[o.method]}`,
      ...taxCells(o.tax, heads), totalOf(o.tax),
      o.reference ?? '', fmtDate(o.docDate), o.gstr3bPeriod ?? '', o.gstr3bTable ?? '',
      o.evidenceUrl ? { v: o.evidenceName || 'Evidence', link: { url: o.evidenceUrl } } : o.evidenceName ?? '',
      o.note ?? '', o.createdBy ?? '', fmtDateTime(o.createdAt),
      removed ? `Removed${o.deletedBy ? ` by ${o.deletedBy}` : ''}${o.deletedAt ? ` on ${fmtDateTime(o.deletedAt)}` : ''}${o.deleteReason ? ` — “${o.deleteReason}”` : ''}` : 'Live',
    ], { struck: removed });
  });
  if (!setOffs.length) reg.data(muted('No set-off recorded yet.'));
  reg.total('Total of live set-offs', ...taxCells(live, heads), totalOf(live));

  const fy = meta.financialYear;
  const mine = drc03s.filter((d) => drc03MatchesFY(d.financialYear, fy));
  p.h2(`DRC-03s ON RECORD FOR FY ${fy}`);
  const dr = p.table([['DRC-03 (ARN)', ...headRow(heads), 'TOTAL TAX', 'FILED ON', 'INTEREST', 'LATE FEE', 'PENALTY', 'SET OFF AGAINST PAYABLES', 'NOT YET USED', 'CAUSE', 'SECTION', 'STATUS']], {
    keyCols: 1, groups: [[1, 2, 3, 4, 5], [6, 7, 8, 9], [10, 11], [12, 13, 14]],
  });
  mine.forEach((d) => {
    const used = setOffs
      .filter((o) => !o.deletedAt && o.method === 'drc03' && ((o.drc03Id && o.drc03Id === d.id) || (!o.drc03Id && o.reference && d.arn && o.reference === d.arn)))
      .reduce((s, o) => s + totalOf(o.tax), 0);
    const tt = totalOf(d.tax);
    dr.data(
      d.pdfUrl ? { v: d.arn || '(no ARN)', link: { url: d.pdfUrl } } : d.arn || '(no ARN)',
      ...taxCells(d.tax, heads), tt, fmtDate(d.filedDate), d.interest, d.lateFee, d.penalty, used, tt - used,
      d.cause ?? '', d.section ?? '', d.status ?? '',
    );
  });
  if (!mine.length) dr.data(muted(`No DRC-03 synced from the portal for FY ${fy}.`));
  return paper(c, {
    ref: 'E1', title: 'Payables and set-off', sheet: 'E1 PAYABLES & SET-OFF', phase: 'finish', master: '— (Annexure-3 by nature)',
    source: 'Source: Annexure-3 (C4) disclosed output-wise and input-wise; set-offs from the payable register; DRC-03s synced from the portal',
    widths: [46, 14, 14, 14, 12, 16, 20, 13, 12, 12, 22, 26, 16, 17, 32],
  }, p);
}

// ---------------------------------------------------------------------------
// F — Audit trail
// ---------------------------------------------------------------------------

function revisionHistory(c: Ctx): WorkingPaper {
  const log = c.changeLog;
  const p = new PaperBuilder();
  const described = log.map((e) => ({ e, d: describeChange(e) }));
  // Summary: changes per sheet and user (crosstab), plus first and last change.
  const users = [...new Set(described.map(({ d }) => d.who))];
  const shown = users.length > 7 ? users.slice(0, 6) : users;
  const others = users.length > 7;
  const sheets = [...new Set(described.map(({ e }) => SHEET_LABEL[e.docKey] ?? e.docKey))];
  const count = (sheet: string | null, user: string | null) =>
    described.filter(({ e, d }) => (sheet === null || (SHEET_LABEL[e.docKey] ?? e.docKey) === sheet) && (user === null || d.who === user)).length;
  const countOthers = (sheet: string | null) => described.filter(({ e, d }) => (sheet === null || (SHEET_LABEL[e.docKey] ?? e.docKey) === sheet) && !shown.includes(d.who)).length;
  const span = shown.length + (others ? 1 : 0) + 1;
  const sum = p.table([['CHANGES BY SHEET AND USER', ...shown, ...(others ? ['OTHERS'] : []), 'TOTAL']], { beside: true, keyCols: 1 });
  sheets.forEach((s) => sum.data(s, ...shown.map((u) => int(count(s, u))), ...(others ? [int(countOthers(s))] : []), int(count(s, null))));
  sum.total('TOTAL', ...shown.map((u) => int(count(null, u))), ...(others ? [int(countOthers(null))] : []), int(log.length));
  const first = described[0];
  const last = described[described.length - 1];
  sum.data('First change', { v: first ? `${fmtDateTime(first.d.when)} · ${first.d.who}` : '—', span });
  sum.data('Last change', { v: last ? `${fmtDateTime(last.d.when)} · ${last.d.who}` : '—', span });

  const t = p.table([['#', 'DATE & TIME', 'USER', 'SHEET', 'PLACE', 'FROM', 'TO', 'ACTION']], {
    freeze: true, autoFilter: true, keyCols: 1, role: 'log',
  });
  described.forEach(({ d }, i) => t.data(int(i + 1), fmtDateTime(d.when), d.who, d.sheet, d.place, d.from, d.to, d.what));
  if (!log.length) t.data('', muted('No change recorded.'));
  const maxUsers = Math.max(1, shown.length + (others ? 1 : 0));
  return paper(c, {
    ref: 'F1', title: 'Revision history', sheet: 'F1 REVISION HISTORY', phase: 'finish', master: '—',
    source: 'Source: the revision log the database writes on every save, status change and set-off (annual_return_change_log), oldest first',
    widths: [7, 18, 18, 24, 48, 30, 30, 34, 3, 30, ...Array(maxUsers + 1).fill(12)],
  }, p);
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export function buildWorkingPapers(input: WorkingPapersInput): PaperSet {
  const { docs, workings: w, meta, period } = input;
  const lines = docs.justifications?.lines ?? {};
  const printedAt = input.printedAt ?? new Date();
  const status = statusText(period);
  const role = period?.reviewed_role ? ROLE_LABEL[period.reviewed_role] ?? period.reviewed_role : '';
  const preparedLine = period?.prepared_by_name
    ? `Prepared by ${period.prepared_by_name}${period.prepared_at ? ` on ${fmtDate(period.prepared_at)}` : ''}`
    : 'Prepared by ______________________________   Date ______________';
  const reviewedLine = period?.reviewed_by_name
    ? `Reviewed by ${period.reviewed_by_name}${role ? ` (${role})` : ''}${period.reviewed_at ? ` on ${fmtDate(period.reviewed_at)}` : ''}`
    : 'Reviewed by ______________________________   Date ______________';
  const manual = docs.portal.manual ?? {};
  const monthMeta = docs.portal.monthMeta;
  const gstr9Source = docs.portal.gstr9Meta?.source ?? null;
  const ctx: Ctx = {
    docs,
    w,
    meta,
    heads: hasCess(w) ? ['i', 'c', 's', 'x'] : ['i', 'c', 's'],
    just: (key) => lines[key]?.text?.trim() ?? '',
    period,
    setOffs: input.setOffs ?? [],
    drc03s: input.drc03s ?? [],
    changeLog: input.changeLog ?? [],
    status,
    printed: fmtDateTime(printedAt),
    preparedText: preparedLine.replace(/^Prepared by /, ''),
    reviewedText: reviewedLine.replace(/^Reviewed by /, ''),
    openOn: (prefixes) => w.diffs.filter((d) => d.open && prefixes.some((pre) => d.key.startsWith(pre))).length,
    portalSrc: (path) => {
      if (manual[path]) return 'typed';
      const parts = path.split('.');
      const s = parts[0] === 'months' ? monthMeta?.[parts[1] as MonthKey]?.source ?? null : gstr9Source;
      if (s === 'manual') return 'typed';
      return s ? 'portal' : 'computed';
    },
  };
  const papers = [
    cover(ctx),
    signOff(ctx),
    plOutput(ctx), plInput(ctx), dto(ctx), dti(ctx), rcm(ctx), portalData(ctx),
    gstr9Output(ctx), gstr9Input(ctx), gstr9cHeads(ctx), annexure(ctx), differences(ctx),
    gstr9Form(ctx), gstr9c(ctx), notice(ctx),
    payables(ctx),
    revisionHistory(ctx),
  ];
  // The index lists every paper, itself included, in order.
  const placeholder: WorkingPaper = { ref: 'A2', title: 'Index', sheet: 'A2 INDEX', phase: 'summary', master: '—', source: '', widths: [], blocks: [], openDiffs: null };
  const ordered = [papers[0], placeholder, ...papers.slice(1)];
  ordered[1] = index(ctx, ordered);
  return {
    papers: ordered,
    firm: FIRM_NAME,
    meta,
    status,
    printed: ctx.printed,
    preparedLine,
    reviewedLine,
    changeCount: ctx.changeLog.length,
  };
}
