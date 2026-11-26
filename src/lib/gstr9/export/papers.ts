// The working papers, built from the engine's figures (computeWorkings) and
// what staff typed — never recomputed. B1–B5, C1–C5, D1 and D3 reproduce the
// sheets of the firm's MASTER_PMS.xlsx exactly as the previous Excel export
// laid them out (same rows, labels, figures and justifications, in the same
// order); the rest are new: the cover, index and sign-off, the portal figures
// the working used, the official GSTR-9C tables, payables with their set-offs,
// and the revision history.
//
// Links (GSTR-9 D1, GSTR-9C D2, Notice D3): a figure taken from another paper
// links to the row it comes from there — and to the cell under its head — by
// the anchors the source rows carry (`anchor`, `cols`; model.ts SheetLink).
// Only a figure the working takes over unchanged, or totals from, links; a
// figure typed on the GSTR-9 / 9C step itself, or added up on the form, does not.

import { KIND_META, amountText, effectOutOfDate } from '../remarkEffects';
import type { RemarkEffect } from '../types';
import { describeChange, hiddenFromClients, SHEET_LABEL, type ChangeLogEntry } from '../audit';
import {
  addT,
  diffStatus,
  subT,
  EXPENSE_HEAD_LABEL,
  NON_TAX_NATURE_LABEL,
  OUTWARD_CATEGORY_LABEL,
  resolveHead,
  salesBucket,
  STANDARD_RATES,
  T4_ROWS,
  tin,
  type DiffLine,
  type PayableSideWorking,
  type StepKey,
  type Workings,
} from '../engine';
import { drc03MatchesFY, METHOD_LABEL, SIDE_LABEL, type Drc03Filing, type SetOff } from '../payables';
import { BASIS_LABEL, DISPOSAL_LABEL, SHORTFALL_ROUTE_LABEL } from '../capitalGoods';
import { ITC_ROWS, MONTH_FIELDS, monthTitle, T5_ROWS, T9_ROWS } from '../portalImport';
import { hasRateLines, rateLinesByRate, rateLinesTotal } from '../rateWise';
import { REVIEW_CHECKLIST, ROLE_LABEL } from '../signoff';
import { ANSWER_LABEL, selfCheckStatus } from '../selfCheck';
import { buildGstr9cPortalJson } from '../gstr9cJson';
import {
  gatherRemarks, remarksForCell, rulesSummary, systemVariances, varianceByCode, varianceDigest, varianceTitle,
  VARIANCE_COL_LABEL, type VarianceCell, type VarianceRemark,
} from '../variance';
import { displayName, overrideText, toSignoffState, type SignoffState, type Stamp } from '../signoffFlow';
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
  type DtRateLine,
  type ExpenseHead,
  type Formulas,
  type InputSection,
  type MonthKey,
  type PortalMonth,
  type RateWiseRow,
  type Tax,
  type ValTax,
} from '../types';
import { gstr9FormTables, noticeTables, type FormRow, type FormTable } from './formTables';
import {
  FIRM_NAME,
  fmtDate,
  fmtDateTime,
  papersForSteps,
  statusText,
  STEP_PAPERS,
  type Cell,
  type ExportMeta,
  type PaperSet,
  anchorsOf,
  type Phase,
  type RowKind,
  type SheetLink,
  type Src,
  type WorkingPaper,
  type WorkingPapersInput,
  type WpBlock,
  type WpCell,
  type WpRow,
  type WpTable,
} from './model';
import { normalizeBuilderAdv } from '../builderAdvances';

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
  /** Anchor the last row (a link target), with the columns of its figures when they differ from the table's. */
  at(anchor: string | string[] | undefined | false, cols?: Record<string, number>): this {
    const last = this.t.rows[this.t.rows.length - 1];
    if (last && anchor) {
      last.anchor = anchor;
      if (cols) last.cols = cols;
    }
    return this;
  }
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
  duties: '4 · Duties & Taxes', rcm: '5 · RCM', outward: '6 · Outward reco (GSTR 9-OUTPUT)', itc: '7 · ITC reco (GSTR 9-INPUT, incl. 9C Table 14)',
  annexures: '8 · Annexures', gstr9: '9 · GSTR-9', gstr9c: '10 · GSTR-9C',
  notice: '11 · Notice format', review: '12 · Review & lock', payables: '13 · Payables & set-off',
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
  /** The steps a one-step export was asked for (empty = every paper). */
  steps: StepKey[];
  docs: AnnualReturnDocs;
  w: Workings;
  meta: ExportMeta;
  heads: Head[];
  /** Justification text for a diff line key ('' when none). */
  just: (key: string) => string;
  period: AnnualReturnPeriod | null;
  /** The allotment and sign-off stamps (signoffFlow.ts). */
  signoff: SignoffState;
  /** Papers for a client login: no sign-off notes, no allotment. */
  forClient: boolean;
  setOffs: SetOff[];
  drc03s: Drc03Filing[];
  /** The revision log as this audience sees it (hiddenFromClients removed for a client). */
  changeLog: ChangeLogEntry[];
  status: string;
  printed: string;
  preparedText: string;
  verifiedText: string;
  reviewedText: string;
  /** Open difference lines whose key starts with any of the prefixes. */
  openOn: (prefixes: string[]) => number;
  /** Source of a portal field ("months.apr.outTax.i", "gstr9.table4.b2b.c"). */
  portalSrc: (path: string) => Src;
  /** Every anchor of the papers built so far, and its paper's sheet (registered by paper()). */
  anchors: Map<string, string>;
}

/**
 * A link to the first of the anchors that a paper built so far carries, at
 * the figure `col` of that row; none when no paper carries any of them.
 */
const linkTo = (c: Ctx, col: string | undefined, ...anchors: Array<string | false | null | undefined>): SheetLink | undefined => {
  for (const a of anchors) {
    if (!a) continue;
    const sheet = c.anchors.get(a);
    if (sheet) return col === undefined ? { sheet, anchor: a } : { sheet, anchor: a, col };
  }
  return undefined;
};

/** Figure columns of a "label … value, heads" row: the value at `t` (when given), the heads from `from`. */
const figCols = (heads: Head[], from: number, t?: number): Record<string, number> => {
  const out: Record<string, number> = {};
  if (t !== undefined) out.t = t;
  heads.forEach((h, i) => { out[h] = from + i; });
  return out;
};

const taxCells = (t: Tax, heads: Head[]): number[] => heads.map((h) => t[h]);
/** Ledger-row tax cells; the Sales / Purchases grids remember expressions under "tax.i" … "tax.x". */
const typedTax = (t: Tax, heads: Head[], f: Formulas | undefined): Cell[] => heads.map((h) => typed(t[h], f, `tax.${h}`));
const valCells = (v: ValTax, heads: Head[]): number[] => [v.t, ...taxCells(v, heads)];
/** Value, then the two (blank) rate columns, then the heads — rows of a table whose rates follow the taxable value. */
const valRateCells = (v: ValTax, heads: Head[]): Array<number | null> => [v.t, null, null, ...taxCells(v, heads)];
/** Tax cells coloured by where each head comes from. */
const srcTax = (t: Tax, heads: Head[], s: (h: Head) => Src): Cell[] => heads.map((h) => src(t[h], s(h)));
const headRow = (heads: Head[]): string[] => heads.map((h) => HEAD_LABEL[h]);

/** Which papers show which difference lines (by key prefix) — for the index and the cover. */
const DIFF_PREFIX: Record<string, string[]> = {
  B1: ['sales.'], B2: ['purchases.'], B3: ['dto.'], B4: ['dti.'], B5: ['rcm.'],
  C1: ['out.'], C2: ['itc.'], C3: ['gstr9c.14T'], C4: ['ann1.', 'ann2.', 'ann4.'], C5: [''], C6: ['cg.'],
  D1: ['g9.'], D2: ['gstr9c.'], D2A: ['gstr9c.5R'],
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

const paper = (c: Ctx, s: Spec, p: PaperBuilder): WorkingPaper => {
  p.blocks.forEach((b) => {
    if (b.type !== 'table') return;
    b.rows.forEach((r) => anchorsOf(r).forEach((a) => { if (!c.anchors.has(a)) c.anchors.set(a, s.sheet); }));
  });
  return {
    ...s,
    blocks: p.blocks,
    openDiffs: DIFF_PREFIX[s.ref] ? c.openOn(DIFF_PREFIX[s.ref]) : null,
  };
};

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
  t.data('VERIFIED BY', c.verifiedText);
  t.data('REVIEWED BY', c.reviewedText);
  t.data('EXPORTED ON', c.printed);
  if (c.steps.length) t.data('PAPERS IN THIS FILE', `Only ${c.steps.map((k) => STEP_NAME[k] ?? k).join(', ')} (${c.steps.flatMap((k) => STEP_PAPERS[k] ?? []).join(', ')}); the full set has every paper`);
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
  l.data({ v: 123456.78, link: { sheet: 'A2 INDEX' } }, 'Underlined blue — a GSTR-9 / GSTR-9C / Notice figure taken from another paper: click it to go to the row (and the head) it comes from');
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

/** "Amit (GST manager)" — a signer's name with the role they signed as ("Superadmin" alone, not twice). */
const signerName = (st: Stamp | null): string => {
  if (!st) return '';
  const name = displayName(st.name);
  const role = st.role ? ROLE_LABEL[st.role] ?? st.role : '';
  return role && role.toLowerCase() !== name.toLowerCase() ? `${name} (${role})` : name;
};

/** "Amit (GST manager) on 14 Oct 2026", or '' when not signed. */
const signedText = (st: Stamp | null): string => (st ? `${signerName(st)} on ${fmtDate(st.at)}` : '');

const SIGN_HERE = '______________________________   Date ______________';

function signOff(c: Ctx): WorkingPaper {
  const { period, w, signoff: so } = c;
  const p = new PaperBuilder();
  p.h1('Sign-off');
  // Columns: ROLE 22 · ALLOTTED 28 · SIGNED BY 52 · DATE 14 · NOTE 60. The tables below run
  // their text across ALLOTTED + SIGNED BY (80), as the paper's second column was before.
  const note = (n: string | null | undefined): string => (c.forClient ? '' : n ?? '');
  const allotted = (person: { name: string } | null): string => (c.forClient || !person ? '' : displayName(person.name));
  const s = p.table([['ROLE', 'ALLOTTED', 'SIGNED BY', 'DATE', 'NOTE']]);
  s.data('Prepared', allotted(so.preparer), signerName(so.prepared), fmtDate(so.prepared?.at), note(so.prepared?.note));
  s.data('Verified', allotted(so.verifier), signerName(so.verified), fmtDate(so.verified?.at), note(so.verified?.note));
  s.data('Reviewed & locked', allotted(so.reviewer), signerName(so.locked), fmtDate(so.locked?.at), note(so.locked?.note));

  p.h2('Review checklist');
  const ticked = period?.review_checklist ?? {};
  const k = p.table([['#', wide('CHECK', 2), 'DONE', 'BASIS']]);
  REVIEW_CHECKLIST.forEach((item, i) => {
    const done = item.auto ? w.openCount === 0 : !!ticked[item.key];
    const basis = item.auto
      ? w.openCount === 0 ? 'Checked by the app: no difference is open' : `Checked by the app: ${w.openCount} difference${w.openCount === 1 ? ' is' : 's are'} open`
      : done ? 'Ticked by the reviewer' : 'Not ticked';
    k.data(int(i + 1), wide(item.label, 2), { v: done ? '✓' : '✗', tick: true, align: 'center' }, basis);
  });

  p.h2('Preparer’s self-validation');
  {
    const file9c = !w.ctx.no9c;
    const jsonErrors = file9c
      ? buildGstr9cPortalJson({ gstin: w.ctx.gstin, financialYear: w.ctx.financialYear, workings: w, doc: c.docs.gstr9c, tolerance: c.docs.settings?.tolerance ?? 0 }).errors
      : 0;
    const sc = selfCheckStatus({ w, gstr9c: c.docs.gstr9c, file9c }, c.docs.selfcheck, { jsonErrors });
    const v = p.table([['#', wide('QUESTION', 2), 'ANSWER', 'REMARK / BASIS']]);
    sc.items.forEach((it, i) => {
      const e = it.entry;
      const ans = e && !it.problem ? ANSWER_LABEL[e.answer] : 'Not answered';
      const basis = [
        e?.answer === 'no' ? e.note.trim() : '',
        e && !c.forClient ? `${displayName(e.by)} on ${fmtDate(e.at)}` : '',
        it.hint ?? '',
      ].filter(Boolean).join(' · ');
      v.data(int(i + 1), wide(it.q.question, 2), { v: ans, align: 'center', bold: e?.answer === 'no' || !!it.problem }, basis);
    });
    sc.auto.forEach((a, i) => {
      v.data(int(sc.items.length + i + 1), wide(a.label, 2), { v: a.ok ? '✓' : '✗', tick: true, align: 'center' }, `Checked by the app: ${a.detail}`);
    });
    const sub = c.docs.selfcheck?.submitted;
    if (sub) {
      const t = p.table([], { plain: true });
      t.data('Submitted with Mark prepared', { v: `${c.forClient ? '' : `${displayName(sub.by)} on `}${fmtDate(sub.at)}`, span: 2 });
    }
  }

  p.h2('Status');
  const locked = so.stage === 'locked';
  const st = p.table([], { plain: true });
  const kv = (label: string, v: string | WpCell) => st.data(label, { ...(typeof v === 'string' ? { v } : v), span: 2 });
  kv('Status', c.status);
  // A client's papers read a send-back as the stage it went back to (statusText), so the row is staff-only.
  if (so.returned && !c.forClient) {
    kv('Sent back', `To the ${so.returned.to} by ${displayName(so.returned.by)} on ${fmtDate(so.returned.at)}${so.returned.note ? `: “${so.returned.note}”` : ''}`);
  }
  kv('Verified by', signedText(so.verified));
  kv('Locked by', locked ? `${displayName(period?.locked_by)}${period?.locked_at ? ` on ${fmtDateTime(period.locked_at)}` : ''}` : '');
  kv('Changes after verification, checked at the lock', locked && so.changesAtLock !== null ? int(so.changesAtLock) : '—');
  kv('Overrides', so.overrides.length
    ? so.overrides.map((o) => (c.forClient && o.kind !== 'legacy' ? 'Locked with a superadmin override' : overrideText(o))).join('; ')
    : 'None');
  kv('Payables frozen at the lock', period?.payables_at_lock ? 'Yes — see E1' : 'No');
  kv('Open differences', int(w.openCount));

  p.h2('Signatures');
  const g = p.table([], { plain: true, tall: true });
  const line = wide('________________________________________', 2);
  g.data('Prepared by', line, 'Date', '____________________');
  g.data('Verified by', line, 'Date', '____________________');
  g.data('Reviewed by', line, 'Date', '____________________');
  g.data('Partner', line, 'Date', '____________________');
  return paper(c, {
    ref: 'A3', title: 'Sign-off', sheet: 'A3 SIGN-OFF', phase: 'summary', master: '—',
    source: 'Source: the allotment and the preparer’s, verifier’s and reviewer’s sign-off recorded on the working (Review & lock)',
    widths: [22, 28, 52, 14, 60],
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
  // Rates follow the amount (stated, then the rate the tax implies), then the heads.
  const a = p.table([['SR NO', 'PARTICULARS', 'AMOUNT', 'RATE (STATED)', 'RATE OF TAX', ...headRow(heads), 'GSTR-9 TABLE 4', 'SUPPLY']], { freeze: true, keyCols: 2, cols: figCols(heads, 5, 2) });
  // Anchors: the first ledger of each GSTR-9C Table 9 rate row (D2 links its rate rows here).
  const seen = new Set<string>();
  docs.sales.partA.forEach((r, i) => {
    const cc = w.sales.rows[r.id];
    const t = cc?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
    a.data(
      sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), rate(r.rate, 'typed'), rate(cc?.impliedRate),
      ...typedTax(t, heads, r.f),
      cc?.isReturn ? 'Credit note (4I)' : OUTWARD_CATEGORY_LABEL[r.category] ?? r.category,
      r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
    );
    const key = `B1.partA.9c.${t9cSalesKey(r.category, r.rate, cc?.impliedRate ?? null)}`;
    if (!seen.has(key)) a.at(key);
    seen.add(key);
  });
  a.total(lbl('TOTAL INCOME - PART A'), ...valRateCells(w.sales.partA, heads)).at('B1.partA');
  p.note('NOTE : SHOW SALES RETURN OF EACH LEDGER IN A DIFFERENT ROW WITH NEGATIVE VALUES');
  p.h2('PART B - NON-TAXABLE INCOME ONLY');
  const bw = heads.length + 1;
  const b = p.table([['SR NO', 'PARTICULARS', 'AMOUNT', wide('BIFURCATION', bw)]], { keyCols: 2, cols: { t: 2 } });
  // A negative row (a credit note) is reported in 5H, whatever its nature — say so, as Part A does for 4I.
  // Anchors: the first ledger of each nature (GSTR-9 Table 5, GSTR-9C 7B–7D1) and the first credit note (5H).
  const seenB = new Set<string>();
  docs.sales.partB.forEach((r, i) => {
    const neg = (Number(r.amount) || 0) < 0 && r.nature !== 'not_in_gstr9';
    b.data(
      sr(i + 1), r.ledger, typed(r.amount, r.f, 'amount'),
      wide(neg ? 'Credit note (5H)' : NON_TAX_NATURE_LABEL[r.nature] ?? r.nature, bw),
    );
    const keys = [neg ? 'B1.partB.cn' : `B1.partB.${r.nature}`, `B1.partB.net.${r.nature}`].filter((k) => !seenB.has(k));
    keys.forEach((k) => seenB.add(k));
    if (keys.length) b.at(keys);
  });
  b.total(lbl('TOTAL INCOME - PART B'), w.sales.partBTotal).at('B1.partB');
  b.total(lbl('TOTAL INCOME - PART A+B'), w.sales.total, { ...muted('<<< THIS SHOULD BE MATCHED WITH AUDIT REPORT'), span: bw }).at('B1.total');
  b.data(lbl('AS PER REPORT'), src(w.sales.auditReportTotal ?? null, 'typed')).at('B1.audit');
  b.sub(lbl('DIFFERENCE (REPORT - BOOKS)'), w.sales.auditDiff ?? null, wide(just('sales.audit'), bw));
  const n = heads.length;
  return paper(c, {
    ref: 'B1', title: 'PL-OUTPUT — Sales bifurcation', sheet: 'B1 PL-OUTPUT', phase: 'collect', master: 'PL-OUTPUT',
    source: 'Source: books P&L (sales ledgers, audit-report total) — PL-OUTPUT of MASTER_PMS',
    widths: [8, 44, 18, 12, 12, ...Array(n).fill(16), 26, 14],
  }, p);
}

// GSTR-9C Table 9 rows by rate (as the engine keys workings.sales.byRate and the RCM categories) — link targets only.
const RATE_9C: Record<string, string> = { '5': 'A', '6': 'B1', '12': 'C', '18': 'E', '28': 'G', '40': 'H1', '3': 'I', '0.25': 'J', '0.1': 'K' };
const RC_9C: Record<string, string> = { '5': 'B', '12': 'D', '18': 'F', '28': 'H', '40': 'H2' };
const snapRate = (r: number): string | null => {
  let best: number | null = null;
  STANDARD_RATES.forEach((x) => { if (Math.abs(Math.abs(r) - x) <= 0.5 && (best === null || Math.abs(Math.abs(r) - x) < Math.abs(Math.abs(r) - best))) best = x; });
  return best === null ? null : String(best);
};
/** The GSTR-9C 9x row a Sales Part A ledger adds to. */
const t9cSalesKey = (category: unknown, typedRate: number | null | undefined, implied: number | null): string => {
  if (salesBucket(category, false) === 'ecom') return 'K2';
  const r = typedRate !== null && typedRate !== undefined && STANDARD_RATES.includes(Number(typedRate)) ? String(Number(typedRate)) : snapRate(typedRate ?? implied ?? NaN);
  return (r && RATE_9C[r]) || 'K1';
};

const SECTION_TITLE: Record<InputSection, [string, string]> = {
  purchase: ['(A) PURCHASE', 'TOTAL PURCHASE'],
  expense: ['(B) DIRECT & INDIRECT EXPENSE', 'TOTAL INDIRECT EXPENSE'],
  capital_goods: ['(C) CAPITAL GOODS', 'TOTAL CAPITAL GOODS'],
};

function plInput(c: Ctx): WorkingPaper {
  const { docs, w, meta, heads, just } = c;
  const p = new PaperBuilder();
  p.h1('PURCHASE & ITC WORKING');
  const t = p.table([['SR NO', 'HEAD IN BOOKS', 'TAXABLE VALUE', 'RATE (STATED)', 'RATE', ...headRow(heads), 'GSTR-9C EXPENSE HEAD', 'SUPPLY']], { freeze: true, keyCols: 2, cols: figCols(heads, 5, 2) });
  (['purchase', 'expense', 'capital_goods'] as InputSection[]).forEach((sec) => {
    t.band(SECTION_TITLE[sec][0]);
    docs.purchases.rows.filter((r) => r.section === sec).forEach((r, i) => {
      const cc = w.purchases.rows[r.id];
      const tx = cc?.tax ?? tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });
      const head = cc?.head ?? resolveHead(r);
      t.data(
        sr(i + 1), r.ledger, typed(r.taxable, r.f, 'taxable'), rate(r.rate, 'typed'), rate(cc?.impliedRate),
        ...typedTax(tx, heads, r.f), EXPENSE_HEAD_LABEL[head] ?? head,
        r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state',
      );
    });
    t.sub(lbl(SECTION_TITLE[sec][1]), ...valRateCells(w.purchases.sections[sec], heads));
  });
  const P = w.purchases;
  t.total(lbl('TOTAL ITC AS PER P&L'), ...valRateCells(P.totalPl, heads));
  t.data(lbl('SUSPENDED ITC AS PER DUTIES & TAXES (Dr - Cr)'), 0, null, null, ...taxCells(P.suspended, heads));
  t.data(lbl('SUSPENDED ITC AS PER DUTIES & TAXES (OTHER ADJ)'), 0, null, null, ...srcTax(P.otherAdj, heads, () => 'typed'));
  t.data(lbl('RCM CREDIT (RCM SHEET PART B - AS PER BOOKS)'), ...valRateCells(P.rcmCredit, heads));
  t.total(lbl(`NET ITC FOR ${meta.financialYear}`), ...valRateCells(P.netItc, heads)).at('B2.netItc');
  t.data(lbl('AS PER DUTIES & TAXES-INPUT (NET)'), null, null, null, ...taxCells(P.dtNet, heads));
  t.sub(lbl('DIFFERENCE (P&L - D&T)'), null, null, null, ...taxCells(P.diffVsDt, heads), wide(just('purchases.dt'), 2));
  const n = heads.length;
  return paper(c, {
    ref: 'B2', title: 'PL-INPUT — Purchases and ITC', sheet: 'B2 PL-INPUT', phase: 'collect', master: 'PL-INPUT',
    source: 'Source: books P&L (purchase, expense and capital-goods ledgers) — PL-INPUT of MASTER_PMS',
    widths: [8, 44, 18, 12, 10, ...Array(n).fill(16), 36, 12],
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

/**
 * The rate-wise breakup of the months entered rate by rate (Duties & Taxes),
 * one line per month, side, rate and supply. Months typed directly are not
 * listed: their books figure is the month table's own.
 */
function rateWiseBlock(c: Ctx, p: PaperBuilder, title: string, sides: Array<[string, (m: MonthKey) => DtRateLine[] | undefined]>): void {
  const { heads } = c;
  const months = FY_MONTHS.filter((m) => sides.some(([, get]) => hasRateLines(get(m))));
  if (!months.length) return;
  p.h2(title);
  const t = p.table([['MONTH', 'SIDE', 'RATE', 'SUPPLY', 'TAXABLE VALUE', ...headRow(heads)]]);
  sides.forEach(([label, get]) => {
    const used = months.filter((m) => hasRateLines(get(m)));
    if (!used.length) return;
    t.band(label.toUpperCase());
    used.forEach((m) => {
      rateLinesByRate(get(m)).forEach((g) => {
        t.data(MONTH_SHORT[m], label.toUpperCase(), rate(g.rate, 'typed'), g.supply === 'inter' ? 'Inter-state' : 'Intra-state', src(g.total.t, 'typed'), ...srcTax(g.total, heads, () => 'typed'));
      });
    });
    const tot = used.reduce((a, m) => {
      const x = rateLinesTotal(get(m));
      return { t: a.t + x.t, i: a.i + x.i, c: a.c + x.c, s: a.s + x.s, x: a.x + x.x };
    }, { t: 0, i: 0, c: 0, s: 0, x: 0 });
    t.sub(lbl(`TOTAL ${label.toUpperCase()} (${used.map((m) => MONTH_SHORT[m]).join(', ')})`, 4), round2(tot.t), ...heads.map((h) => round2(tot[h])));
  });
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
  rateWiseBlock(c, p, 'RATE-WISE BREAKUP OF BOOKS FIGURES', [
    ['Sales', (m) => docs.duties_output.months[m].rateWise?.sales],
    ['Credit note', (m) => docs.duties_output.months[m].rateWise?.creditNote],
  ]);
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
  // Figure columns of the anchored rows: "<group>.<head>" (D1 links 6A1, 6H and 7H1 to the TOTAL and LAST YEAR EFFECT rows).
  const keys = ['purchase', 'dn', 'sr', 'sr180', 'rc', 'rc180', 'net', 'asPer3B', 'diff'];
  const cols: Record<string, number> = {};
  keys.forEach((k, g) => heads.forEach((h, i) => { cols[`${k}.${h}`] = 1 + g * n + i; }));
  const t = p.table(groupHead('MONTH', groups, heads, 'JUSTIFICATION'), { freeze: true, groups: groupCols(9, n, 1), cols });
  const pad = (k: number) => Array(k * n).fill(null);
  const ty = (x: Tax) => srcTax(x, heads, () => 'typed');
  // Last Year Effect sits in NET PURCHASE only (no 3B month); its difference is carried so the column adds up.
  t.data('LAST YEAR EFFECT', ...pad(6), ...ty(w.dti.lye), ...pad(1), ...taxCells(w.dti.lye, heads)).at('B4.lye');
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
  t.total('TOTAL', ...[T.purchase, T.dn, T.sr, T.sr180, T.rc, T.rc180, T.net, T.asPer3B, T.diff].flatMap((x) => taxCells(x, heads))).at('B4.total');
  t.data(lbl('RCM TAX FIGURES ONLY', 1 + 6 * n), ...taxCells(w.dti.rcmBooks, heads), ...taxCells(w.dti.rcmPortal, heads), ...taxCells(w.dti.rcmDiff, heads));
  t.sub(lbl('TOTAL ITC FOR THE YEAR (TO BE MATCHED WITH ANNUAL GSTR-3B)', 1 + 6 * n), ...taxCells(w.dti.totalItcBooks, heads), ...taxCells(w.dti.totalItcPortal, heads), ...taxCells(w.dti.totalItcDiff, heads));
  t.data(lbl('LAST YEAR EFFECT', 1 + 6 * n), ...taxCells(w.dti.lye, heads));
  t.total(lbl('NET', 1 + 6 * n), ...taxCells(w.dti.net, heads));
  t.data(lbl('AS PER P&L (PL-INPUT NET ITC)', 1 + 6 * n), ...taxCells(w.dti.asPerPl, heads));
  t.sub(lbl('DIFF (P&L - NET)', 1 + 6 * n), ...taxCells(w.dti.plDiff, heads), ...pad(2), just('purchases.dt'));
  adjustmentBlock(c, p, 'OTHER ADJUSTMENTS IN DR SIDE', docs.duties_input.adjustments, w.dti.adjustments, 'REASON OF ADJ.', ['TOTAL DR', w.dti.totalDr]);
  rateWiseBlock(c, p, 'RATE-WISE BREAKUP OF BOOKS FIGURES', [
    ['Purchase', (m) => docs.duties_input.months[m].rateWise?.purchase],
    ['Debit note', (m) => docs.duties_input.months[m].rateWise?.debitNote],
  ]);
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
  const cols = figCols(heads, 3, 2);
  const allV: Array<'t' | Head> = ['t', ...heads];
  const months = (t: TableBuilder, get: (m: MonthKey) => ValTax, extra?: (m: MonthKey) => string, cellSrc?: (m: MonthKey, h: 't' | Head) => Src) =>
    FY_MONTHS.forEach((m, i) => {
      const v = get(m);
      t.data(sr(i + 1), MONTH_FULL[m], ...(cellSrc ? allV.map((h) => src(v[h], cellSrc(m, h))) : valCells(v, heads)), extra ? extra(m) : '');
    });

  const source = w.rcm.partASource;
  p.h2(`PART A - AS PER GST PORTAL (${source === 'monthly' ? 'as-filed GSTR-3B 3.1(d)' : source === 'gstr9' ? 'GSTR-9 Table 4G, annual' : 'not fetched'})`);
  const a = p.table(hdr(), { keyCols: 2, cols });
  if (source === 'gstr9') a.data('', 'ANNUAL (GSTR-9 4G)', ...allV.map((h) => src(w.rcm.partA[h], c.portalSrc(`gstr9.table4.rchrg.${h}`))));
  else months(a, (m) => w.rcm.partAMonths[m], undefined, (m, h) => c.portalSrc(`months.${m}.rcm.${h}`));
  a.total(lbl('TOTAL'), ...valCells(w.rcm.partA, heads)).at('B5.partA');
  p.h2('PART B - AS PER BOOKS');
  const b = p.table(hdr(), { keyCols: 2, cols });
  months(b, (m) => w.rcm.partBMonths[m]);
  b.total(lbl('TOTAL'), ...valCells(w.rcm.partB, heads)).at('B5.partB');
  p.h2('DIFFERENCE (PART B - PART A: BOOKS - PORTAL)');
  const d = p.table(hdr('JUSTIFICATION'), { keyCols: 2 });
  if (source === 'gstr9') d.data('', 'ANNUAL', ...valCells(w.rcm.diff, heads), just('rcm.annual'));
  else months(d, (m) => w.rcm.diffMonths[m], (m) => just(`rcm.${m}`));
  d.total(lbl('TOTAL'), ...valCells(w.rcm.diff, heads));
  p.note('NOTE - PART B IS THE SUM OF THE EXPENSE CATEGORIES BELOW (ALL CATEGORIES, TAXABLE VALUE INCLUDED).');
  docs.rcm.categories.forEach((cat) => {
    const calc = w.rcm.categories[cat.id];
    if (!calc) return;
    p.h2(`${(cat.name || 'RCM EXPENSE').toUpperCase()} (${cat.rate}% · ${cat.supplyType === 'inter' ? 'INTER-STATE' : 'INTRA-STATE'} · ${cat.itcTable === 'none' ? 'NO ITC' : `GSTR-9 TABLE ${cat.itcTable || '6C'}${cat.itcType === 'ip' ? ' INPUTS' : cat.itcType === 'cg' ? ' CAPITAL GOODS' : ''}`})`);
    const k = p.table(hdr(), { keyCols: 2, cols });
    // Taxable is typed; tax is computed from the rate unless typed (RCM F52 `=D52*2.5%`).
    months(k, (m) => calc.months[m], undefined, (m, h) => {
      if (h === 't') return 'typed';
      const cell = cat.months?.[m];
      return cell && cell[h] !== null && cell[h] !== undefined ? 'typed' : 'computed';
    });
    // Anchors (as the engine files the category): GSTR-9 6C / 6D by type, 6F, and the GSTR-9C 9x reverse-charge row by rate.
    const tbl = cat.itcTable && ['6C', '6D', '6F', 'none'].includes(cat.itcTable) ? cat.itcTable : '6C';
    const type = cat.itcType === 'ip' || cat.itcType === 'cg' ? cat.itcType : 'is';
    k.total(lbl('TOTAL'), ...valCells(calc.total, heads)).at([`B5.cat.${tbl}.${type}`, `B5.cat.${tbl}`, `B5.9c.${RC_9C[String(Number(cat.rate))] ?? 'K1'}`]);
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
  const t4 = p.table([['TABLE', 'NATURE OF SUPPLIES', 'TAXABLE', ...headRow(heads)]], { keyCols: 2, cols: figCols(heads, 3, 2) });
  T4_ROWS.forEach((r) => t4.data(r.table, r.label, ...allV.map((h) => src(g.table4[r.key][h], c.portalSrc(`gstr9.table4.${r.key}.${h}`)))).at(`B6.t4.${r.key}`));
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
  const itc = p.table([['TABLE', 'DETAILS', ...headRow(ALL_HEADS)]], { keyCols: 2, cols: figCols(ALL_HEADS, 2) });
  ITC_ROWS(meta.financialYear).forEach((r) => itc.data(r.table, r.label, ...srcTax(g[r.key], ALL_HEADS, (h) => c.portalSrc(`gstr9.${r.key}.${h}`))).at(`B6.itc.${r.key}`));

  p.h3('Table 9 — tax paid as declared in the returns', '9');
  const t9 = p.table([['TABLE', 'DESCRIPTION', 'TAX PAYABLE', 'PAID IN CASH', 'PAID BY ITC: IGST', 'PAID BY ITC: CGST', 'PAID BY ITC: SGST', 'PAID BY ITC: CESS']], {
    keyCols: 2, cols: { payable: 2, cash: 3, itcI: 4, itcC: 5, itcS: 6, itcX: 7 },
  });
  T9_ROWS.forEach((r) => {
    const row = g.table9[r.key] as unknown as Record<string, number>;
    const fields = r.tax ? ['payable', 'cash', 'itcI', 'itcC', 'itcS', 'itcX'] : ['payable', 'cash'];
    t9.data(`9${r.code}`, r.label, ...fields.map((f) => src(row[f], c.portalSrc(`gstr9.table9.${r.key}.${f}`)))).at(`B6.t9.${r.key}`);
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
    // The TOTAL row is anchored "B6.m.<field>", its figures "<field>.<head>" (D1 / D3 link the year's 4A, 4B(1), 4A(5), 4B(2), 4D here).
    const figs: Record<string, number> = {};
    keys.forEach((k, i) => cols[i].forEach((h, j) => { figs[`${String(k)}.${h}`] = groups[i][j]; }));
    const t = p.table(head, { keyCols: 2, groups, cols: figs });
    FY_MONTHS.forEach((k) => {
      const row = P.months[k];
      t.data(lbl(monthTitle(k, meta.financialYear)), ...keys.flatMap((f, i) => cols[i].map((h) => src((row[f] as unknown as Record<string, number>)[h], c.portalSrc(`months.${k}.${f}.${h}`)))));
    });
    t.total(lbl('TOTAL'), ...keys.flatMap((f, i) => cols[i].map((h) => FY_MONTHS.reduce((s, k) => s + ((P.months[k][f] as unknown as Record<string, number>)[h] || 0), 0))))
      .at(keys.map((k) => `B6.m.${String(k)}`));
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

function rule42Paper(c: Ctx): WorkingPaper {
  const { w, heads, just } = c;
  const n = heads.length;
  const R = w.r42;
  const p = new PaperBuilder();
  p.h1('RULE 42 — COMMON CREDIT USED FOR EXEMPT SUPPLIES');
  p.note('C1 = T − (T1 + T2 + T3); C2 = C1 − T4; D1 = E ÷ F × C2; D2 = 5% × C2 (non-business). Provisional per tax period, final for the year under rule 42(2); interest u/s 50 at 18%.');
  const groups = ['T (4A LESS CAPITAL GOODS)', 'T1 + T2 + T3', 'T4', 'C2 COMMON CREDIT', 'D1 + D2 PROVISIONAL', 'REVERSED IN 3B 4(B)(1)', 'SHORT (EXCESS)', 'INTEREST U/S 50'];
  const t = p.table([
    [{ v: 'PERIOD', rowSpan: 2 }, { v: 'E (EXEMPT)', rowSpan: 2 }, { v: 'F (TOTAL)', rowSpan: 2 }, { v: 'E ÷ F', rowSpan: 2 }, ...groups.map((g) => ({ v: g, span: n, align: 'center' as const }))],
    [null, null, null, null, ...groups.flatMap(() => headRow(heads))],
  ], { freeze: true, groups: groupCols(groups.length, n, 0).map((g) => g.map((x) => x + 3)) });
  R.periods.forEach((x) => {
    t.data(
      x.label, x.e, x.f, `${(x.ratio * 100).toFixed(2)}%`,
      ...taxCells(x.t, heads), ...taxCells(addT(x.t1, x.t2, x.t3), heads), ...taxCells(x.t4, heads), ...taxCells(x.c2, heads),
      ...taxCells(x.provisional, heads), ...taxCells(x.reversed, heads), ...taxCells(x.short, heads), ...taxCells(x.interest, heads),
    );
  });
  const A = R.annual;
  t.total('TOTAL', R.periodsE, R.periodsF, null, ...taxCells(A.t, heads), ...taxCells(addT(A.t1, A.t2, A.t3), heads), ...taxCells(A.t4, heads), ...taxCells(A.c2, heads),
    ...taxCells(R.provisional, heads), ...taxCells(R.reversed, heads), ...taxCells(subT(R.provisional, R.reversed), heads), ...taxCells(R.interestShort, heads));
  p.h2('FINAL FOR THE YEAR AND TRUE-UP');
  const f = p.table([['PARTICULARS', ...headRow(heads), 'NOTE']], { freeze: true, keyCols: 1, cols: figCols(heads, 1) });
  f.data('E ÷ F FOR THE YEAR', ...Array(n).fill(null), `${A.e.toLocaleString('en-IN')} ÷ ${A.f.toLocaleString('en-IN')} = ${(A.ratio * 100).toFixed(2)}% (${A.ratioSource === 'books' ? 'Sales, books' : 'Σ periods'})`);
  f.data('C2 COMMON CREDIT', ...taxCells(A.c2, heads), '');
  f.data('D1 = E ÷ F × C2', ...taxCells(A.d1, heads), '');
  f.data('D2 = 5% × C2', ...taxCells(A.d2, heads), R.periods.length && c.docs.gstr9.r42?.d2 ? c.docs.gstr9.r42.d2Reason : 'Not applied');
  const BR = w.builderRev;
  if (!w.r42Turnover) f.data('TURNOVER METHOD', ...Array(n).fill(null), 'Switched off: builder project credit only');
  BR.workings.forEach((b) => f.data(`BUILDER: ${b.project.toUpperCase()} (POSTED ${b.postingPeriod})`, ...taxCells(b.r42, heads), `Approved carpet-area working, completion ${b.completionDate.split('-').reverse().join('-')}`));
  f.total('GSTR-9 TABLE 7C', ...taxCells(w.g9.t7.C, heads), R.t7CSource === 'override' ? 'Typed over by a superadmin' : BR.workings.length ? (w.r42Turnover ? 'Final above + builder working' : 'Builder working') : 'From this working').at('C2A.7C');
  if (heads.some((h) => BR.recredit[h] > 0.005)) f.data('BUILDER RE-CREDIT IN 4(A)(5)', ...taxCells(BR.recredit, heads), 'Check GSTR-9 Table 6H');
  f.data('PROVISIONAL (Σ PERIODS)', ...taxCells(R.provisional, heads), '');
  f.sub('TRUE-UP: FINAL LESS PROVISIONAL', ...taxCells(R.trueUp, heads), `Post by ${R.latestPeriod}; chosen ${R.postingPeriod}`);
  f.data('REVERSED IN THE GSTR-3Bs', ...taxCells(R.reversed, heads), '');
  f.total('STILL TO REVERSE (PAYABLES)', ...taxCells(R.payable, heads), just('itc.r42Net'));
  f.data('CREDIT TO TAKE BACK', ...taxCells(R.recredit, heads), `By ${R.latestPeriod}`);
  f.data(`INTEREST ON TRUE-UP (${R.trueUpInterestDays} DAYS FROM 1 APRIL)`, ...taxCells(R.interestTrueUp, heads), '');
  f.data('INTEREST ON SHORT PERIODS', ...taxCells(R.interestShort, heads), '');
  f.total('INTEREST U/S 50 (PAYABLES)', ...taxCells(R.interest, heads), '');
  R.warnings.forEach((x) => p.note(x));

  // Rule 43: capital goods in common use (same switch, same E ÷ F).
  const Q = w.r43;
  const tsum = (x: Tax) => heads.reduce((a, h) => a + x[h], 0);
  p.h1('RULE 43 — CAPITAL GOODS USED FOR TAXABLE AND EXEMPT SUPPLIES');
  p.note('Tm = Tc ÷ 60 for each month of the 60 from the invoice while the asset is in common use; Tr = Σ Tm of the period; Te = E ÷ F × Tr (the period’s Rule 42 ratio). Exempt-only to common: Tc less 5 points for every quarter or part from the invoice. No annual re-computation: 7D = Σ Te.');
  const ar = p.table([['ASSET', 'INVOICE DATE', 'USE', 'TC', 'TM', 'MONTHS IN YEAR', 'LIFE USED (OF 60)', 'TR', 'TE', 'STATUS']], { freeze: true, keyCols: 1 });
  const cgById = new Map((w.ctx.capitalGoods ?? []).map((a) => [a.id, a]));
  Q.assets.filter((a) => a.monthsInYear > 0 || a.issues.length).forEach((a) => {
    const inv = a.invoiceDate ? a.invoiceDate.split('-').reverse().join('-') : '';
    ar.data(a.description || cgById.get(a.id)?.invoiceNo || 'Asset', inv, a.useClass === 'common' ? 'Common' : a.useClass === 'taxable' ? 'Taxable only' : 'Exempt / non-business',
      tsum(a.tc), tsum(a.tm), a.monthsInYear, a.lifeUsed, tsum(a.tr), tsum(a.te),
      [a.quarters ? `Tc less ${a.quarters * 5} points` : '', ...a.issues].filter(Boolean).join('; ') || (a.excluded ?? 'In Tr'));
  });
  ar.total('TOTAL', null, null, null, null, null, null, tsum(Q.tr), tsum(Q.te), `${Q.commonCount} in common use`);
  const g43 = ['TR = Σ TM', 'TE = E ÷ F × TR', 'REVERSED IN 3B 4(B)(1)', 'SHORT (EXCESS)', 'INTEREST U/S 50'];
  const pt = p.table([
    [{ v: 'PERIOD', rowSpan: 2 }, { v: 'E ÷ F', rowSpan: 2 }, ...g43.map((g) => ({ v: g, span: n, align: 'center' as const }))],
    [null, null, ...g43.flatMap(() => headRow(heads))],
  ], { freeze: true, groups: groupCols(g43.length, n, 0).map((g) => g.map((x) => x + 1)) });
  Q.periods.forEach((x) => {
    pt.data(x.label, `${(x.ratio * 100).toFixed(2)}%`, ...taxCells(x.tr, heads), ...taxCells(x.te, heads), ...taxCells(x.reversed, heads), ...taxCells(x.short, heads), ...taxCells(x.interest, heads));
  });
  pt.total('TOTAL', null, ...taxCells(Q.tr, heads), ...taxCells(Q.te, heads), ...taxCells(Q.reversed, heads), ...taxCells(Q.net, heads), ...taxCells(Q.interest, heads));
  const q = p.table([['PARTICULARS', ...headRow(heads), 'NOTE']], { freeze: true, keyCols: 1, cols: figCols(heads, 1) });
  BR.workings.forEach((b) => q.data(`BUILDER: ${b.project.toUpperCase()} (POSTED ${b.postingPeriod})`, ...taxCells(b.r43, heads), 'Approved carpet-area working'));
  q.total('GSTR-9 TABLE 7D', ...taxCells(w.g9.t7.D, heads), Q.t7DSource === 'override' ? 'Typed over by a superadmin' : BR.workings.length ? 'Σ Te + builder working' : 'Σ Te, this working').at('C2A.7D');
  q.data('REVERSED IN THE GSTR-3Bs', ...taxCells(Q.reversed, heads), '');
  q.total('STILL TO REVERSE (PAYABLES)', ...taxCells(Q.payable, heads), just('itc.r43Net'));
  q.data('REVERSED MORE THAN TE', ...taxCells(Q.recredit, heads), '');
  q.total('INTEREST U/S 50 (PAYABLES)', ...taxCells(Q.interest, heads), `To the GSTR-3B of ${R.postingPeriod}`);
  Q.warnings.forEach((x) => p.note(x));
  return paper(c, {
    ref: 'C2A', title: 'RULE 42 / 43 — Common credit and capital goods for exempt supplies', sheet: 'C2A RULE 42-43', phase: 'reconcile', master: 'RULE 42',
    source: 'Source: as-filed GSTR-3B 4A and 3.1 by period; T1 to T4 from the Purchases / RCM credit-use tags; E and F for the year from Sales Part A and B; Rule 43 from the client’s capital goods register — Rule 42/43 working of the Annual Return',
    widths: [16, 16, 16, 10, ...Array(groups.length * n).fill(13)], freezeCols: 1,
  }, p);
}

/** Builder clients: the customer-advance roll-forward behind GSTR-9C Table 5 (the firm's TURNOVER IN 9C sheet). */
function builderAdvPaper(c: Ctx): WorkingPaper {
  const { w, docs, meta, just } = c;
  const B = w.gstr9c.builderAdv!;
  const doc = normalizeBuilderAdv(docs.gstr9c.builderAdv);
  const fy = meta.financialYear;
  const end = `31.03.${Number(fy.slice(0, 4)) + 1}`;
  const start = `01.04.${fy.slice(0, 4)}`;
  const p = new PaperBuilder();
  p.h1('GSTR-9C SALES RECONCILIATION — CUSTOMER ADVANCES');
  p.note('Advance received in the FY = closing advance − opening advance + revenue recognised. Openings are carried from the year before, which is closed.');
  const t = p.table([['PARTICULARS', 'AMOUNT', 'AMOUNT', 'NOTE']], { keyCols: 1 });
  t.data(`CLOSING BALANCE OF ADVANCE AS ON ${end}`, { v: B.closingAdvance, src: 'typed' }, null, 'Audited balance sheet');
  t.data(`LESS: OPENING BALANCE AS ON ${start}`, B.openingAdvance, null, 'Carried from the year before');
  t.data('ADD: REVENUE RECOGNISED (TRANSFERRED TO WIP / SALES)', { v: B.revenue, src: 'typed' }, null, 'Audited statement of profit and loss');
  t.sub(`TOTAL ADVANCE RECEIVED DURING FY ${fy}`, B.received, B.received, '');
  p.h2('CUMULATIVE');
  const k = p.table([['PARTICULARS', 'AMOUNT', 'NOTE']], { keyCols: 1 });
  k.data(`ADVANCE RECEIVED UP TO ${fy.slice(0, 4)}`, B.receivedBefore, 'Carried from the year before');
  k.data(`ADVANCE RECEIVED IN FY ${fy}`, B.received, '');
  k.sub(`TOTAL ADVANCE RECEIVED UP TO FY ${fy}`, B.receivedToDate, '');
  k.data(`LESS: SALES ACCOUNTED UP TO THE END OF FY ${fy}`, B.salesToDate, `Before: ${B.salesBefore.toLocaleString('en-IN')}`);
  k.total(`UNADJUSTED ADVANCES AT THE END OF FY ${fy}`, B.unadjustedEnd, Math.abs(B.unadjustedEnd - B.closingAdvance) > 0.5 ? 'Does not equal the closing advance' : 'Equals the closing advance');
  p.h2('JUSTIFICATION OF DIFFERENCE IN GSTR-9C (TABLE 5)');
  const j = p.table([['NO.', 'PARTICULARS', 'AMOUNT', 'NOTE']], { keyCols: 2, cols: { t: 2 } });
  j.data('5A', 'Turnover as per audit report', w.gstr9c.t5.A, Math.abs(w.gstr9c.t5.A - B.revenue) > 0.5 ? `Revenue recognised is ${B.revenue.toLocaleString('en-IN')}` : '');
  j.data('5B', 'Add: unbilled revenue at the beginning', B.t5.B, '').at('D2A.5B');
  j.data('5C', 'Add: unadjusted advances at the end (closing advance)', B.t5.C, '').at('D2A.5C');
  j.data('5H', 'Less: unbilled revenue at the end', B.t5.H, '').at('D2A.5H');
  j.data('5I', 'Less: unadjusted advances at the beginning (opening advance)', B.t5.I, '').at('D2A.5I');
  (doc?.adjustments ?? []).forEach((a) => j.data(`5${a.row}`, `${a.row === 'J' ? 'Less' : 'Add'}: ${a.label}`, { v: a.amount, src: 'typed' }, a.reason).at(`D2A.5${a.row}`));
  j.total('5P', 'Annual turnover after adjustments', w.gstr9c.t5.P, '');
  j.data('5Q', 'Turnover as per GSTR-9', w.gstr9c.t5.Q, '');
  j.total('5R', 'Difference (Q − P)', w.gstr9c.t5.R, just('gstr9c.5R'));
  if (B.tieOut && doc?.tieOut) {
    const T = doc.tieOut;
    p.h2('TIE-OUT WITH COLLECTIONS');
    const r = p.table([['PARTICULARS', 'AMOUNT', 'NOTE']], { keyCols: 1 });
    const from = T.source === 'builder' ? `Builder module${T.readAt ? `, read ${fmtDateTime(T.readAt)}` : ''}` : 'Collection register (books)';
    r.data('Total collected from customers in the FY', { v: T.receipts, src: 'typed' }, from);
    r.data('Less: GST included in the collections', { v: T.gstIncluded, src: 'typed' }, '');
    r.data('Less: cheques returned', { v: T.chequeReturns, src: 'typed' }, '');
    r.data('Less: refunds paid to cancelled members', { v: T.refunds, src: 'typed' }, '');
    r.sub('Net advance collected', B.tieOut.net, '');
    r.data('Advance received per this roll-forward', B.received, '');
    r.total('Difference', B.tieOut.diff, T.note || '');
  }
  return paper(c, {
    ref: 'D2A', title: 'GSTR-9C — Builder advance roll-forward (Table 5)', sheet: 'D2A BUILDER ADVANCES', phase: 'returns', master: 'TURNOVER IN 9C',
    source: 'Source: closing advance and revenue from the audited financial statements, openings from the closed year before, receipts and refunds from the Builder module',
    widths: [70, 20, 20, 50],
  }, p);
}

function gstr9Input(c: Ctx): WorkingPaper {
  const { w, heads, just } = c;
  const p = new PaperBuilder();
  const I = w.itc;
  const sum = (t: Tax) => heads.reduce((a, h) => a + t[h], 0);
  p.h1('ITC WORKING FOR GSTR 9');
  const t = p.table([['PARTICULARS', 'TAXABLE', ...headRow(heads), 'TOTAL TAX', 'NOTE']], { freeze: true, keyCols: 1, cols: figCols(heads, 2, 1) });
  const vrow = (kind: RowKind, label: string, v: ValTax | null, x: Tax, note: Cell = '', s?: Src) =>
    t.row(kind, [label, v ? v.t : null, ...(s ? srcTax(x, heads, () => s) : taxCells(x, heads)), sum(x), note]);
  vrow('data', 'INPUT (6B INPUTS)', I.inputs, I.inputs).at('C2.inputs');
  vrow('data', 'INPUT SERVICES (6B INPUT SERVICES — BALANCING FIGURE)', I.inputServices, I.inputServices, muted('Tax = 6A2 less every other row, so 6(O) ties to 6A2')).at('C2.inputServices');
  vrow('data', '   of which: ITC booked on these ledgers (for reference)', null, I.inputServicesBooks);
  vrow('data', 'IMPORT OF GOODS (6E)', I.importGoods, I.importGoods).at('C2.importGoods');
  vrow('data', 'CAPITAL GOODS (6B CAPITAL GOODS)', I.capitalGoods, I.capitalGoods).at('C2.capitalGoods');
  vrow('data', 'RCM (RCM SHEET PART B - AS PER BOOKS)', I.rcm, I.rcm).at('C2.rcm');
  vrow('data', 'ITC RECLAIM (6H)', null, I.reclaim).at('C2.reclaim');
  vrow('data', 'ISD (6G)', null, I.isd).at('C2.isd');
  vrow('data', 'TRAN-1 / TRAN-2 / ITC-01, 02, 02A (6N)', null, I.t6N).at('C2.t6N');
  vrow('subtotal', 'AS PER 3B (6A2 = 6A - 6A1)', null, I.asPer3B).at('C2.asPer3B');
  vrow('total', 'TOTAL (SHOULD BE MATCHED WITH 6(O) OF GSTR 9)', I.total, I.total).at('C2.total');
  vrow('data', 'ITC REVERSAL (7H1 - SUSPENDED ITC REVERSED)', null, I.reversal7H1).at('C2.reversal7H1');
  vrow('data', 'AS PER SECTION 17(5) (7E)', null, I.s17_5).at('C2.s17_5');
  vrow('data', 'OTHER REVERSALS (7A-7D, 7F, 7G, OTHER 7H)', null, I.otherReversals);
  if (nz(w.cg.reversal)) vrow('data', '   of which: reversal u/s 18(6), capital goods sold (C6 Annexure-5)', null, w.cg.reversal);
  vrow('total', 'TOTAL (SHOULD BE MATCHED WITH 7(J) OF GSTR 9)', null, I.total7J).at('C2.total7J');
  if (nz(I.cgNotInBooks)) {
    vrow('data', 'DUTIES & TAXES NET, AFTER LAST YEAR EFFECT', null, I.asPerBookLedger);
    vrow('data', '   Less: s.18(6) reversal not yet in the ITC ledger (C6 Annexure-5)', null, I.cgNotInBooks);
  }
  vrow('data', nz(I.cgNotInBooks) ? 'AS PER BOOK (AFTER THE s.18(6) REVERSAL)' : 'AS PER BOOK (DUTIES & TAXES NET, AFTER LAST YEAR EFFECT)', null, I.asPerBook);
  vrow('subtotal', 'DIFFERENCE (7J - BOOK)', null, I.residual, just('itc.books'));
  vrow('data', 'ITC TO BE REVERSED IN NEXT YEAR (TABLE 12) — SUGGESTED', null, I.t12Suggested);
  vrow('data', `   Table 12 used (${w.g9.t12Source === 'override' ? 'typed' : 'computed'})`, null, w.g9.t12, '', w.g9.t12Source === 'override' ? 'typed' : undefined).at('C2.t12');
  vrow('data', 'ITC TO BE CLAIMED IN NEXT YEAR (TABLE 13; 8C FOLLOWS IT UNLESS TYPED) — SUGGESTED', null, I.t13Suggested);
  vrow('data', '   Table 13 typed', null, w.g9.t13, '', 'typed').at('C2.t13');
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
  const t = p.table([['SR NO', 'PARTICULARS', 'VALUE', ...headRow(heads), 'TOTAL TAX', 'LEDGERS (PL-INPUT)']], { freeze: true, keyCols: 2, cols: figCols(heads, 3, 2) });
  C14_ROWS.forEach(([k, label, head]) => {
    const v = w.c14.rows[k];
    if (!v) return;
    let note = head ? (ledgers[head] ?? []).join(', ') : '';
    if (k === 'A1') note = 'Duties & Taxes suspended ITC (reversed - reclaimed)';
    if (k === 'P') note = 'RCM sheet Part B';
    if (k === 'Q') note = [note, `balancing figure ${round2(w.c14.qBalancing.t)} value / ${round2(sum(w.c14.qBalancing))} tax`].filter(Boolean).join(' · ');
    t.row(k === 'A2' ? 'subtotal' : 'data', [k, label, ...valCells(v, heads), sum(v), note]).at(`C3.${k}`);
  });
  t.total('R', 'TOTAL AMOUNT OF ELIGIBLE ITC AVAILED', ...valCells(w.c14.rows.R, heads), sum(w.c14.rows.R)).at('C3.R');
  t.data('', 'NET ITC AS PER PL-INPUT', ...valCells(w.purchases.netItc, heads), sum(w.purchases.netItc));
  t.sub('', 'CHECK (PL-INPUT - R)', ...valCells(w.c14.check, heads), sum(w.c14.check));
  t.data('S', 'ITC CLAIMED IN GSTR-9 (7J)', null, ...taxCells(w.c14.S, heads), sum(w.c14.S)).at('C3.S');
  t.total('T', 'UN-RECONCILED ITC (S − R)', null, ...taxCells(w.gstr9c.t14.T, heads), sum(w.gstr9c.t14.T), just('gstr9c.14T')).at('C3.T');
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
  if (A1.CG.t || nz(A1.CG)) a1.data('', 'CAPITAL GOODS SOLD OUTSIDE P/L REVENUE (C6 ANNEXURE-5)', ...valCells(A1.CG, heads));
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
  if (nz(A2.A3)) a2('data', 'A3', 's.18(6) REVERSAL ON CAPITAL GOODS SOLD, NOT YET IN THE ITC LEDGER (C6)', A2.A3);
  a2('data', 'B', 'OTHER ADJUSTMENT IN DR./CR. SIDE', A2.B);
  a2('subtotal', nz(A2.A3) ? 'C=A+A1-A2-A3-B' : 'C=A+A1-A2-B', 'NET ITC AVAILED', A2.C);
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
  let a3n = 5;
  if (nz(A3.cg186)) a3.data(sr(a3n++), 'CAPITAL GOODS SOLD u/s 18(6): SHORTFALL NOT YET REVERSED (C6 ANNEXURE-5)', ...taxCells(A3.cg186, all));
  if (nz(A3.rule4243)) a3.data(sr(a3n++), 'RULE 42 / 43 REVERSAL STILL DUE, WITH INTEREST u/s 50 (C2A)', ...taxCells(A3.rule4243, all));
  a3.total(lbl('TOTAL'), ...taxCells(A3.total, all));
  a3.data('', 'DRC-03 PAYABLE (POSITIVE HEADS, OUTPUT AND INPUT SIDE APART)', ...taxCells(A3.payable, all));
  a3.data('', 'EXCESS PAID (NEGATIVE HEADS)', ...taxCells(A3.excessPaid, all));
  a3.data('', 'SET OFF — DRC-03 / GSTR-3B (E1)', ...taxCells(A3.alreadyPaid, all));
  a3.total('', 'BALANCE TO PAY', ...taxCells(A3.balance, all));
  p.note('Annexure-3 and the Payables register (E1) are one register: the same lines and the same set-offs, the payable and balance taken output side and input side apart, so the balance here is the balance on E1.');

  // Annexure-4
  p.h2('ANNEXURE-4 (DETAILS OF PREVIOUS YEAR GSTR-09 CLAUSE-8, 10, 11, 12 & 13)');
  const a4 = p.table([['SR NO', 'PARTICULAR', ...headRow(all)]], { keyCols: 2, cols: figCols(all, 2) });
  (['c8', 'c10', 'c11', 'c12', 'c13'] as const).forEach((k, i) => a4.data(sr(i + 1), `CLAUSE -${k.slice(1)}`, ...srcTax(tin(docs.annexures.a4[k]), all, () => 'typed')).at(`C4.a4.${k}`));
  return paper(c, {
    ref: 'C4', title: 'ANNEXURE — Income, ITC, DRC-03 and previous-year reconciliations', sheet: 'C4 ANNEXURE', phase: 'reconcile', master: 'ANNEXURE',
    source: 'Source: the reconciliations above (B1–B5, C1–C3) and GSTR-9 — ANNEXURE 1–4 of MASTER_PMS',
    widths: [12, 70, 18, 16, 16, 16, 16, 48],
  }, p);
}

const isoDate = (v: string | null): string => (v ? fmtDate(v) : '');

/** C6 — Annexure-5: the s.18(6) computation for each capital asset sold in the year, and where it went. */
function capitalGoodsSold(c: Ctx): WorkingPaper {
  const { w, heads } = c;
  const cg = w.cg;
  const p = new PaperBuilder();
  p.h1('ANNEXURE-5 — CAPITAL GOODS SOLD u/s 18(6)');
  p.note('Section 18(6) CGST Act: on the supply of capital goods or plant and machinery on which ITC was taken, the higher of (a) the tax on the transaction value (s.15) and (b) the ITC taken reduced by 5 percentage points for every quarter or part thereof from the date of the invoice (Rule 40(2); Rule 44(6) read with Rule 44(1)(b), worked per head) is payable. Proviso: refractory bricks, moulds and dies, jigs and fixtures supplied as scrap pay tax on the transaction value only.');
  if (!cg.assets.length) {
    p.note(`No capital goods sold in ${c.meta.financialYear}.`);
  } else {
    p.h2('COMPUTATION SCHEDULE');
    const t = p.table([[
      'SR', 'ASSET', 'HSN', 'PURCHASE INVOICE', 'INVOICE DATE', 'ITC TAKEN', 'DISPOSAL', 'DATE OF SALE', 'SALE INVOICE', 'TRANSACTION VALUE', 'RATE',
      'QUARTERS', 'LESS %', '(b) ITC AS REDUCED', '(a) TAX ON VALUE', 'PAYABLE (HIGHER)', 'SHORTFALL (b − a)', 'SHORTFALL DEALT WITH', 'BASIS / NOTES',
    ]], { keyCols: 2, freeze: true, autoFilter: true });
    const sum = (x: Tax) => x.i + x.c + x.s + x.x;
    cg.assets.forEach((a, i) => {
      const k = cg.calc[a.id];
      t.data(
        sr(i + 1), { v: a.description || 'Asset', src: 'typed' }, a.hsn, a.invoiceNo, isoDate(a.invoiceDate), src(sum(k.itcTaken), 'typed'),
        a.disposalType ? DISPOSAL_LABEL[a.disposalType] : '', isoDate(a.disposalDate), a.disposalInvoiceNo, src(a.disposalValue, 'typed'), rate(a.rate, 'typed'),
        k.quarters === null ? '' : int(k.quarters), k.reductionPct === null ? '' : rate(k.reductionPct), sum(k.reduced), sum(k.outTax), k.payable, sum(k.shortfall),
        sum(k.shortfall) > 0.005 ? SHORTFALL_ROUTE_LABEL[a.shortfallRoute] : '',
        [...k.issues, BASIS_LABEL[k.basis], ...k.notes].join(' '),
      );
    });
    t.total('', lbl('TOTAL', 4), sum(cg.assets.reduce((acc, a) => addTax(acc, cg.calc[a.id].itcTaken), zeroTax())), '', '', '',
      cg.assets.reduce((s2, a) => s2 + a.disposalValue, 0), '', '', '',
      sum(cg.assets.reduce((acc, a) => addTax(acc, cg.calc[a.id].reduced), zeroTax())),
      sum(cg.assets.reduce((acc, a) => addTax(acc, cg.calc[a.id].outTax), zeroTax())), cg.payable,
      sum(cg.assets.reduce((acc, a) => addTax(acc, cg.calc[a.id].shortfall), zeroTax())), '', '');

    p.h2('BY TAX HEAD');
    const hb = p.table([['ASSET', 'FIGURE', ...headRow(ALL_HEADS), 'TOTAL']], { keyCols: 2 });
    cg.assets.forEach((a) => {
      const k = cg.calc[a.id];
      hb.data(a.description || 'Asset', 'ITC taken', ...srcTax(k.itcTaken, ALL_HEADS, () => 'typed'), sum(k.itcTaken));
      if (k.quarters !== null) hb.data('', `(b) ITC as reduced — ${k.quarters} quarter${k.quarters === 1 ? '' : 's'}, less ${k.reductionPct}%`, ...taxCells(k.reduced, ALL_HEADS), sum(k.reduced));
      hb.data('', `(a) Tax on transaction value${k.outTaxComputed ? ' (from the rate)' : ' (as charged)'}`, ...taxCells(k.outTax, ALL_HEADS), sum(k.outTax));
      if (sum(k.itcAfterR43) !== sum(k.itcTaken)) hb.data('', 'ITC after Rule 43 reversals to date (information)', ...taxCells(k.itcAfterR43, ALL_HEADS), sum(k.itcAfterR43));
      hb.sub('', 'Shortfall (b − a), split over the heads of (b)', ...taxCells(k.shortfall, ALL_HEADS), sum(k.shortfall));
    });

    p.h2('WHERE THE FIGURES GO');
    const g = p.table([['PARTICULARS', 'VALUE', ...headRow(heads), 'WHERE']], { keyCols: 1, cols: figCols(heads, 2, 1) });
    g.data('Sales outside the Sales ledgers — registered buyers', cg.table4.b2b.t, ...taxCells(cg.table4.b2b, heads), 'GSTR-9 4B (C1), 9C Table 9');
    g.data('Sales outside the Sales ledgers — unregistered buyers', cg.table4.b2c.t, ...taxCells(cg.table4.b2c, heads), 'GSTR-9 4A (C1), 9C Table 9');
    g.data('Shortfall reported as ITC reversal', null, ...taxCells(cg.reversal, heads), 'GSTR-9 7H (C2), Annexure-2 G2').at('C6.reversal');
    g.data('   of which reversed in GSTR-3B 4(B)(2)', null, ...taxCells(cg.reversed3b, heads), '');
    g.data('   of which paid by DRC-03', null, ...taxCells(cg.drc03, heads), '');
    g.data('   of which not yet dealt with', null, ...taxCells(cg.notDone, heads), 'Annexure-3 row 5, Payables input side (E1)');
    g.data('Shortfall paid as output tax on the invoice', null, ...taxCells(cg.asOutputTax, heads), 'GSTR-9 Table 4');
    g.data('Shortfall not yet in the books’ ITC ledger', null, ...taxCells(cg.notInBooks, heads), 'ITC reco (C2), Annexure-2 A3');
    g.data('Sale value outside the P&L revenue', cg.valueOutsidePl, ...heads.map(() => null), 'Annexure-1 (C4), GSTR-9C 5O (D2)').at('C6.outsidePl');
  }
  p.note('Firm positions (23 Nov 2026, docs/GSTR9_9C_WORKINGS.md §6 items 34–38): the higher of is compared on the total, the shortfall split over the heads of the ITC as reduced; ITC taken is the credit availed before any Rule 42/43 reversal; TRAN-1 credit counts from the original invoice date; a quarter is three months from the invoice date and a part counts in full.');
  return paper(c, {
    ref: 'C6', title: 'ANNEXURE-5 — Capital goods sold u/s 18(6)', sheet: 'C6 ANNEXURE-5 CG SOLD', phase: 'reconcile', master: '—',
    source: 'Source: the client’s capital goods register (Sales · Capital goods sold); s.18(6), Rule 40(2), Rule 44(6)',
    widths: [6, 30, 10, 16, 13, 16, 18, 13, 14, 18, 9, 10, 9, 18, 18, 18, 18, 26, 48],
    freezeCols: 2,
  }, p);
}

const zeroTax = (): Tax => ({ i: 0, c: 0, s: 0, x: 0 });
const addTax = (a: Tax, b: Tax): Tax => ({ i: a.i + b.i, c: a.c + b.c, s: a.s + b.s, x: a.x + b.x });

/** The engine's status label; a re-check says why, since the sheet has no popover to explain it. */
const statusLabel = (d: DiffLine, tolerance: number): WpCell => {
  const st = diffStatus(d, tolerance);
  const text = st.kind === 'recheck' ? `${st.label} (moved since justified)` : st.label;
  const fill = st.kind === 'open' || st.kind === 'recheck' ? 'bad' : st.kind === 'justified' ? 'info' : st.kind === 'matched' || st.kind === 'within' ? 'good' : undefined;
  return { v: text, fill };
};

/** The effect read from a line's remark (remarkEffects.ts): what, next FY, and who decided. */
function effectCells(text: string | undefined, e: RemarkEffect | undefined): [string, string, string] {
  if (!e || !text?.trim()) return ['', '', ''];
  const m = KIND_META[e.kind];
  const what = `${m.label}${m.target ? `: ${amountText(e.amount, m.withTaxable)}` : ''}`;
  const status = e.status === 'applied'
    ? `${e.wrote ? `Added to ${m.short}` : 'Recorded'}${e.decidedBy ? ` by ${e.decidedBy}` : ''}${e.decidedAt ? `, ${fmtDateTime(e.decidedAt)}` : ''}`
    : e.status === 'dismissed' ? 'Dismissed' : `Suggested (${e.source === 'ai' ? 'GST Assistant' : 'rules'}), not applied`;
  return [what, m.nextFy ? e.nextFy || m.nextFy : '', effectOutOfDate(text, e) ? `${status}; remark changed since` : status];
}

function differences(c: Ctx): WorkingPaper {
  const { w } = c;
  const p = new PaperBuilder();
  p.h1(`EVERY DIFFERENCE LINE — a line needs a reason when any head exceeds ₹${w.tolerance}. Open lines: ${w.openCount}.`);
  const t = p.table([['STEP', 'LINE', 'DIRECTION', 'LEFT SIDE', 'RIGHT SIDE', 'VALUE DIFF', 'IGST', 'CGST', 'SGST', 'CESS', 'STATUS', 'JUSTIFICATION', 'EFFECT OF THE REMARK', 'NEXT FY', 'EFFECT STATUS', 'BY', 'WHEN', 'LINE KEY']], {
    freeze: true, autoFilter: true, keyCols: 2, groups: [[2, 3, 4], [5, 6, 7, 8, 9], [10, 11], [12, 13, 14], [15, 16, 17]],
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
      ...effectCells(j?.text, j?.effect),
      j?.text?.trim() ? j.by ?? '' : '',
      j?.text?.trim() ? fmtDateTime(j.at) : '',
      d.key,
    );
  });
  return paper(c, {
    ref: 'C5', title: 'Differences and reasons', sheet: 'C5 DIFFERENCES', phase: 'reconcile', master: 'DIFFERENCES',
    source: 'Source: every difference line of the working (books − portal), its status and the reason recorded against it',
    widths: [30, 60, 18, 26, 26, 16, 16, 16, 16, 14, 26, 70, 48, 48, 26, 16, 20, 18],
  }, p);
}

// ---------------------------------------------------------------------------
// D — Returns
// ---------------------------------------------------------------------------

/** The figure each column of a form table holds ("t", "c", "s", "i", "x", "payable", "cash" …), by its head. */
const FORM_COL_KEY: Record<string, string> = {
  'Taxable Value': 't', 'Central Tax': 'c', 'State Tax / UT Tax': 's', 'Integrated Tax': 'i', Cess: 'x',
  'Tax Payable': 'payable', 'Paid through cash': 'cash', 'ITC: Central Tax': 'itcC', 'ITC: State Tax / UT Tax': 'itcS',
  'ITC: Integrated Tax': 'itcI', 'ITC: Cess': 'itcX', 'Total tax paid': 'paid', Difference: 'diff', Payable: 'payable', Paid: 'paid',
  Interest: 'interest', Penalty: 'penalty', 'Late Fee / Others': 'lateFee', Type: 'type',
  SGST: 's', CGST: 'c', IGST: 'i', CESS: 'x', TOTAL: 'total',
};
const formColKeys = (t: FormTable): string[] => t.head.map((h) => FORM_COL_KEY[h] ?? h);

/** Form-table links: the anchor of each form row ("D1.<table>.<row>"), and where a figure of a row comes from. */
interface FormLinks {
  /** Anchor prefix ("D1"); rows anchor as "<prefix>.<table no>.<row key or code>". */
  prefix: string;
  /** Where the figure under `key` of row `row` comes from. */
  link: (t: FormTable, row: FormRow, key: string) => SheetLink | undefined;
}

const formAnchor = (prefix: string, t: FormTable, row: FormRow): string | undefined => {
  const k = row.key ?? row.code;
  return t.no && k ? `${prefix}.${t.no}.${k}` : undefined;
};

/** A form-table paper (GSTR-9, NOTICE FORMATE): part heading, table title, header row, rows. */
function formBlocks(
  p: PaperBuilder,
  tables: FormTable[],
  opts: {
    numberRow?: boolean;
    cellSrc?: (t: FormTable, rowIdx: number, col: number) => Src | undefined;
    links?: FormLinks;
    /** A figure that differs from the system-computed GSTR-9 (variance.ts): filled, with both figures in its comment. */
    variance?: (t: FormTable, row: FormRow, key: string) => VarianceCell | null;
  } = {},
): void {
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
    const keys = formColKeys(t);
    const cols: Record<string, number> = {};
    keys.forEach((k, i) => { if (!(k in cols)) cols[k] = 2 + i; });
    const b = p.table(head, { keyCols: 2, cols });
    t.rows.forEach((row, ri) => {
      const cells: Cell[] = [row.code, row.label, ...row.cells.map((v, ci) => {
        if (typeof v !== 'number') return v;
        const s = opts.cellSrc?.(t, ri, ci);
        const link = opts.links?.link(t, row, keys[ci]);
        const vr = opts.variance?.(t, row, keys[ci]) ?? null;
        if (vr) return { v, src: s, link, fill: 'variance' as const, note: varianceTitle(vr.portal, vr.final) };
        return s || link ? { v, src: s, link } : v;
      })];
      b.row(row.bold ? 'subtotal' : 'data', cells).at(opts.links && formAnchor(opts.links.prefix, t, row));
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

const D1_SHEET = 'D1 GSTR-9';
const TAX_KEYS: ReadonlySet<string> = new Set(['t', 'i', 'c', 's', 'x']);
const NATURE_5: Record<string, string> = { A: 'export_wo', B: 'sez_wo', C: 'rcm_outward', C1: 'ecom_95', D: 'exempt', E: 'nil', F: 'non_gst' };

/**
 * Where each GSTR-9 figure is taken from (docs/GSTR9_9C_WORKINGS.md §4–5):
 * the paper and row the engine reads it off, never a figure typed on the
 * GSTR-9 step or added up on the form (H, M, N, 5G, 6I …), which stays a value.
 */
function gstr9CellLink(c: Ctx): FormLinks['link'] {
  const { docs, w } = c;
  const G = docs.gstr9;
  const T4_KEY: Record<string, string> = { A: 'b2c', B: 'b2b', C: 'exp', D: 'sez', E: 'deemed', F: 'at', G1: 'ecom', I: 'cr_nt', J: 'dr_nt', K: 'amd_pos', L: 'amd_neg' };
  const HEAD9: Record<string, string> = { A: 'igst', B: 'cgst', C: 'sgst', D: 'cess' };
  const OTHER9: Record<string, string> = { E: 'interest', F: 'lateFee', G: 'penalty', H: 'other' };
  const HEAD_OF9: Record<string, Head> = { igst: 'i', cgst: 'c', sgst: 's', cess: 'x' };
  const self = (anchor: string, col?: string): SheetLink => ({ sheet: D1_SHEET, anchor, ...(col ? { col } : {}) });
  const unset = (v: unknown) => v === null || v === undefined;
  return (t, row, key) => {
    const code = row.key ?? row.code;
    const head = TAX_KEYS.has(key) ? key : undefined;
    switch (t.no) {
      case '4':
        if (T4_KEY[code]) return linkTo(c, head, `B6.t4.${T4_KEY[code]}`);
        // 4G is RCM Part A: the annual GSTR-9 4G, or Σ the as-filed 3.1(d) (B5 Part A).
        if (code === 'G') return w.rcm.partASource === 'gstr9' ? linkTo(c, head, 'B6.t4.rchrg', 'B5.partA') : linkTo(c, head, 'B5.partA');
        return undefined;
      case '5':
        if (key !== 't') return undefined;
        if (NATURE_5[code]) return linkTo(c, 't', `B1.partB.${NATURE_5[code]}`, 'B1.partB');
        if (code === 'H') return linkTo(c, 't', 'B1.partB.cn', 'B1.partB');
        return undefined;
      case '6':
        if (!head) return undefined;
        switch (code) {
          case 'A':
            if (w.g9.t6ASource === 'gstr9') return linkTo(c, head, 'B6.itc.t6A');
            if (w.g9.t6ASource === 'monthly_3b') return linkTo(c, `itc4aTotal.${head}`, 'B6.m.itc4aTotal');
            return undefined;
          case 'A1': return unset(G.t6A1) ? linkTo(c, `net.${head}`, 'B4.lye') : undefined;
          case 'A2': return linkTo(c, head, 'C2.asPer3B');
          case 'B_ip': return linkTo(c, head, 'C2.inputs');
          case 'B_cg': return linkTo(c, head, 'C2.capitalGoods');
          case 'B_is': return linkTo(c, head, 'C2.inputServices');
          case 'C_ip': case 'C_cg': case 'C_is': case 'D_ip': case 'D_cg': case 'D_is':
            return linkTo(c, head, `B5.cat.6${code[0]}.${code.slice(2)}`, `B5.cat.6${code[0]}`);
          case 'E_ip': case 'E_cg': return linkTo(c, head, 'C2.importGoods');
          case 'F': return linkTo(c, head, 'B5.cat.6F');
          case 'G': return unset(G.t6G) ? linkTo(c, head, 'B6.itc.t6G') : undefined;
          case 'H': return linkTo(c, `rc.${head}`, 'B4.total');
          case 'O': return linkTo(c, head, 'C2.total');
          default: return undefined;
        }
      case '7': {
        if (!head) return undefined;
        if (code === 'C' && w.r42.enabled) return linkTo(c, head, 'C2A.7C');
        if (code === 'D' && w.r42.enabled) return linkTo(c, head, 'C2A.7D');
        if (code === 'E') return unset(G.t7.s17_5) ? linkTo(c, `itc4b1.${head}`, 'B6.m.itc4b1') : undefined;
        if (code === 'J') return linkTo(c, head, 'C2.total7J');
        const h = /^H(\d+)$/.exec(code);
        const line = h ? w.g9.t7H[Number(h[1]) - 1] : undefined;
        // 7H1 is the suspended ITC reversed (D&T input, both columns); the s.18(6) line is Annexure-5's.
        if (line?.id === 'h1') return linkTo(c, `sr.${head}`, 'B4.total');
        if (line?.id === 'cg186') return linkTo(c, head, 'C6.reversal');
        return undefined;
      }
      case '8':
        if (!head) return undefined;
        if (code === 'A') return linkTo(c, head, 'B6.itc.t8A');
        if (code === 'C') return unset(G.t8C) ? self('D1.10–13.13', head) : undefined;
        if (code === 'H') return linkTo(c, head, 'C2.importGoods');
        return undefined;
      case '9': {
        if (HEAD9[code]) {
          const k = HEAD9[code];
          if (key === 'payable') {
            const s9 = w.g9.t9[k as 'igst'].payableSource;
            return s9 === 'portal' ? linkTo(c, 'payable', `B6.t9.${k}`) : s9 === '4N' ? self('D1.4.N', HEAD_OF9[k]) : undefined;
          }
          return ['cash', 'itcC', 'itcS', 'itcI', 'itcX'].includes(key) ? linkTo(c, key, `B6.t9.${k}`) : undefined;
        }
        if (OTHER9[code]) return key === 'payable' || key === 'cash' ? linkTo(c, key, `B6.t9.${OTHER9[code]}`) : undefined;
        return undefined;
      }
      case '10–13':
        if (code === '12' && head) return linkTo(c, head, 'C2.t12');
        return undefined;
      default:
        return undefined;
    }
  };
}

const REMARK_KIND: Record<VarianceRemark['kind'], string> = { reason: 'Reason', gstr9c: 'GSTR-9C', selfcheck: 'Self-check' };

/** D1's first block: the figures that differ from the system-computed GSTR-9, the remarks on them and the summary (§12). */
function varianceBlock(c: Ctx, p: PaperBuilder, cells: VarianceCell[]): void {
  if (c.w.g9.t4Source !== 'portal') return;
  p.h2('DIFFERENCES FROM THE SYSTEM-COMPUTED GSTR-9');
  if (!cells.length) {
    p.note(`The final GSTR-9 agrees with the system-computed GSTR-9 (Tables 4, 5, 6A, 6G, 8A and the Table 9 payable) within ₹${c.w.tolerance}.`);
    return;
  }
  const remarks = gatherRemarks(c.docs, c.w);
  const saved = c.docs.gstr9.varianceSummary ?? null;
  const s = saved ?? { ...rulesSummary(cells, remarks), source: 'rules' as const, at: '', by: null, digest: '' };
  const stale = !!saved && saved.digest !== varianceDigest(cells, remarks);
  p.note(
    saved
      ? `Summary: ${s.source === 'ai' ? 'GST Assistant' : 'rules summary'}${c.forClient || !saved.by ? '' : `, by ${displayName(saved.by)}`}, ${fmtDateTime(saved.at)}${stale ? '. The differences or remarks have changed since it was written.' : '.'}`
      : 'Summary: rules summary, built when this file was printed (no summary saved on the GSTR-9 step).',
  );
  p.note(s.overall);
  s.tables.forEach((t) => p.note(`Table ${t.table}. ${t.summary}`));
  if (s.unexplained.length) p.note(`Unexplained: ${s.unexplained.map((u) => `${u.label} (${u.note})`).join('; ')}.`);
  const b = p.table([['ROW', 'PARTICULARS', 'HEAD', 'SYSTEM-COMPUTED', 'FINAL', 'DIFFERENCE', wide('REMARKS THAT BEAR ON IT', 5)]], { keyCols: 2 });
  cells.forEach((v) => {
    const rs = remarksForCell(v, remarks);
    const text = rs.length
      ? rs.map((r) => `${REMARK_KIND[r.kind]} · ${r.label}: ${r.text}${r.effect ? ` (effect: ${r.effect})` : ''}`).join('\n')
      : 'No remark';
    b.data(
      v.row,
      v.rowLabel,
      VARIANCE_COL_LABEL[v.col],
      v.portal,
      { v: v.final, fill: 'variance', link: { sheet: D1_SHEET, anchor: `D1.${v.table}.${v.code}`, col: v.col } },
      v.diff,
      { v: text, span: 5, ...(rs.length ? {} : { fill: 'bad' as const }) },
    );
  });
  p.space();
}

function gstr9Form(c: Ctx): WorkingPaper {
  const { w } = c;
  const p = new PaperBuilder();
  const cells = systemVariances(c.docs, w);
  const at = varianceByCode(cells);
  p.note('(Amount in ₹ in all tables)');
  p.note('A figure underlined in blue comes from another paper: click it to go to the row it is taken from. A figure filled orange differs from the system-computed GSTR-9.');
  varianceBlock(c, p, cells);
  formBlocks(p, gstr9FormTables(w), {
    cellSrc: gstr9CellSrc(c),
    links: { prefix: 'D1', link: gstr9CellLink(c) },
    variance: (t, row, key) => (t.no ? at(t.no, row.key ?? row.code, key) : null),
  });
  return paper(c, {
    ref: 'D1', title: 'GSTR-9 — Annual return, Tables 4 to 19', sheet: 'D1 GSTR-9', phase: 'returns', master: 'GSTR-9',
    source: 'Source: the reconciliations (C1–C4), GSTR-9 system-computed figures (B6) and the cells typed on the GSTR-9 step — GSTR-9 of MASTER_PMS',
    widths: [8, 80, 18, 18, 18, 18, 18, 18, 18, 18, 18],
  }, p);
}

// GSTR-9C (official tables) — labels as the GSTR-9C step shows them (GSTR_9C_Offline_Utility.xlsm v2.9).
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
  P: 'Total amount to be paid as per tables above', Q: 'Total amount paid as declared in annual return (GSTR-9)', R: 'Un-reconciled payment of amount',
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
  const amt = (v: number, s?: Src, link?: SheetLink): Cell => (s || link ? { v, src: s, link } : v);
  /** Where a figure comes from, by its head ("t", "c", "s", "i", "x"). */
  type At = (h: 't' | Head) => SheetLink | undefined;
  /** Value + tax in the form's column order (Value, Central, State/UT, Integrated, Cess), each linked to its source when `at` says. */
  const vt = (r: Partial<ValTax> | null | undefined, s?: Src, withValue = true, at?: At): Cell[] => {
    const x = r ?? {};
    return [withValue ? amt(n0(x.t), s, at?.('t')) : null, amt(n0(x.c), s, at?.('c')), amt(n0(x.s), s, at?.('s')), amt(n0(x.i), s, at?.('i')), amt(n0(x.x), s, at?.('x'))];
  };
  const unset = (v: unknown) => v === null || v === undefined;
  /** The same figure of the row anchored `anchor` (the first that a paper carries). */
  const from = (...anchors: Array<string | false | undefined>): At => (h) => linkTo(c, h, ...anchors);
  const self = (anchor: string): SheetLink => ({ sheet: 'D2 GSTR-9C', anchor, col: 't' });
  /** Part B of Sales, first ledger of the first nature that has one (GSTR-9C 7B–7D1 default to the natures' net). */
  const partB = (...natures: string[]) => linkTo(c, 't', ...natures.map((n) => `B1.partB.net.${n}`), 'B1.partB');
  const reasons = (code: string, title: string, text: string | undefined, diffKey: string) => {
    p.h3(title, code);
    const r = p.table([], { plain: true });
    r.data('', { v: text?.trim() || '—', span: 7 });
    const j = just(diffKey);
    if (j && !(text ?? '').includes(j)) r.data('', { v: `Justification recorded on the difference line: ${j}`, span: 7, italic: true, muted: true });
  };

  p.h2('Pt. II   Reconciliation of turnover declared in audited annual financial statement with turnover declared in annual return (GSTR-9)');
  p.h3('Reconciliation of gross turnover', '5');
  const t5 = p.table([['No.', 'Description', 'Amount', wide('Justification', 5)]], { keyCols: 2, cols: { t: 2 } });
  // 5A defaults to the audit-report total typed on Sales, else the books' Part A + B.
  t5.data('5A', T5_LABEL.A, unset(C.t5A) ? amt(W.t5.A, undefined, linkTo(c, 't', w.sales.auditReportTotal !== null && w.sales.auditReportTotal !== undefined ? 'B1.audit' : 'B1.total')) : amt(W.t5.A, 'typed'));
  GSTR9C_T5_KEYS.forEach((k) => {
    const sign = T5_EITHER.includes(k) ? '(+/−)' : GSTR9C_T5_SUB.includes(k) ? '(−)' : '(+)';
    // A builder's roll-forward fills its rows (D2A); 5O also carries capital goods sold outside the P&L (C6).
    const link = (W.builderAdv && linkTo(c, 't', `D2A.5${k}`)) || (k === 'O' && Math.abs(w.cg.valueOutsidePl) >= 0.005 && unset(C.t5OCg) ? linkTo(c, 't', 'C6.outsidePl') : undefined);
    t5.data(`5${k}`, `${T5_LABEL[k]} ${sign}`, amt(n0(W.t5.rows[k]), 'typed', link));
  });
  t5.total('5P', `${T5_LABEL.P} (A + B + C + D − E + F − G − H − I + J − K − L + M + N + O)`, W.t5.P).at('D2.5P');
  t5.data('5Q', T5_LABEL.Q, unset(C.t5Q) ? amt(W.t5.Q, undefined, linkTo(c, 't', 'D1.10–13.total')) : amt(W.t5.Q, 'typed'));
  t5.total('5R', `${T5_LABEL.R} (Q − P)`, W.t5.R, wide(just('gstr9c.5R'), 5));
  reasons('6', 'Reasons for un-reconciled difference in annual gross turnover', C.t6Reasons, 'gstr9c.5R');

  p.h3('Reconciliation of taxable turnover', '7');
  const t7 = p.table([['No.', 'Description', 'Amount', wide('Justification', 5)]], { keyCols: 2 });
  t7.data('7A', T7_LABEL.A, amt(W.t7.A, undefined, self('D2.5P')));
  const natures7: Record<'B' | 'C' | 'D' | 'D1', string[]> = { B: ['exempt', 'nil', 'non_gst'], C: ['export_wo', 'sez_wo'], D: ['rcm_outward'], D1: ['ecom_95'] };
  (['B', 'C', 'D', 'D1'] as const).forEach((k) => t7.data(`7${k}`, T7_LABEL[k], unset(C.t7?.[k]) ? amt(W.t7[k], undefined, partB(...natures7[k])) : amt(W.t7[k], 'typed')));
  t7.sub('7E', `${T7_LABEL.E} (A − B − C − D − D1)`, W.t7.E);
  // 7F defaults to 4N − 4G − 4G1 + 10 − 11 of GSTR-9: linked to 4N, where it starts.
  t7.data('7F', T7_LABEL.F, unset(C.t7F) ? amt(W.t7.F, undefined, linkTo(c, 't', 'D1.4.N')) : amt(W.t7.F, 'typed'));
  t7.total('7G', `${T7_LABEL.G} (F − E)`, W.t7.G, wide(just('gstr9c.7G'), 5));
  reasons('8', 'Reasons for un-reconciled difference in taxable turnover', C.t8Reasons, 'gstr9c.7G');

  p.h2('Pt. III   Reconciliation of tax paid');
  p.h3('Reconciliation of rate-wise liability and amount payable thereon', '9');
  const t9 = p.table([['No.', 'Description', ...V_HEAD, 'Justification']], { keyCols: 2 });
  // A derived rate row adds the Sales Part A ledgers (B1) and RCM categories (B5) of that rate: linked to the first of them.
  GSTR9C_T9_RATE_KEYS.forEach((k) => t9.data(`9${k}`, T9_LABEL[k], ...(W.t9.derived[k] ? vt(W.t9.rows[k], undefined, true, from(`B1.partA.9c.${k}`, `B5.9c.${k}`)) : vt(W.t9.rows[k], 'typed'))));
  GSTR9C_T9_OTHER_KEYS.forEach((k) => t9.data(`9${k}`, T9_LABEL[k], ...vt(W.t9.rows[k], 'typed', false)));
  t9.total('9P', T9_LABEL.P, ...vt(W.t9.P));
  // 9Q defaults to the tax paid of GSTR-9 Table 9, head by head.
  const paid9: Record<string, string> = { i: 'D1.9.A', c: 'D1.9.B', s: 'D1.9.C', x: 'D1.9.D' };
  t9.data('9Q', T9_LABEL.Q, ...(unset(C.t9Q) ? vt(W.t9.Q, undefined, false, (h) => (h === 't' ? undefined : linkTo(c, 'paid', paid9[h]))) : vt(W.t9.Q, 'typed', false)));
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
  // 12A defaults to the books' net ITC (B2), 12C to GSTR-9 Table 13; 12E is 7J. 12B (last-year effect less 6A1) is a difference, not linked.
  t12.data('12A', T12_LABEL.A, ...vt(W.t12.A, over12('A'), false, over12('A') ? undefined : from('B2.netItc')));
  t12.data('12B', `${T12_LABEL.B} (+)`, ...vt(W.t12.B, over12('B'), false));
  t12.data('12C', `${T12_LABEL.C} (−)`, ...vt(W.t12.C, over12('C'), false, over12('C') ? undefined : from('D1.10–13.13')));
  t12.sub('12D', `${T12_LABEL.D} (A + B − C)`, ...vt(W.t12.D, undefined, false));
  t12.data('12E', T12_LABEL.E, ...vt(W.t12.E, undefined, false, from('D1.7.J')));
  t12.total('12F', `${T12_LABEL.F} (E − D)`, ...vt(W.t12.F, undefined, false), just('gstr9c.12F'));
  reasons('13', 'Reasons for un-reconciled difference in ITC', C.t13Reasons, 'gstr9c.12F');

  p.h3('Reconciliation of ITC declared in annual return (GSTR-9) with ITC availed on expenses as per audited annual financial statement or books of account', '14');
  const t14 = p.table([['No.', 'Description', ...V_HEAD, 'Justification']], { keyCols: 2 });
  // Table 14 is the ITC by expense head of the GSTR 9C working (C3), row for row.
  T14_ROWS.forEach((r) => t14.row(r.k === 'A2' ? 'subtotal' : 'data', [`14${r.k}`, r.label, ...vt(W.t14.rows[r.k], undefined, true, from(`C3.${r.k}`))]));
  t14.total('14R', 'Total amount of eligible ITC availed', ...vt(W.t14.R, undefined, true, from('C3.R')));
  t14.data('14S', 'ITC claimed in annual return (GSTR-9)', ...vt(W.t14.S, undefined, false, from('D1.7.J')));
  // 14T is S − R, the sign C3's T (R − S) reverses: computed here, not linked.
  t14.total('14T', 'Un-reconciled ITC (S − R)', ...vt(W.t14.T, undefined, false), just('gstr9c.14T'));
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
  // Links (head columns only; the TOTAL column adds them): the GSTR-9 row a figure is read from (D1), or the year's as-filed GSTR-3B total (B6).
  const ROW9: Record<string, string> = { i: 'A', c: 'B', s: 'C', x: 'D' };
  const ROW14: Record<string, string> = { i: 'igst', c: 'cgst', s: 'sgst', x: 'cess' };
  const unset = (v: unknown) => !v;
  const outLink = (code: string, h: string): SheetLink | undefined => {
    switch (code) {
      case '1': return linkTo(c, h, 'D1.4.N');
      case '3': return unset(N.deemedSupplies) ? linkTo(c, h, 'D1.16.B') : undefined;
      case '4': return unset(N.unreturnedGoods) ? linkTo(c, h, 'D1.16.C') : undefined;
      case '5': return unset(N.pendingDemands) ? linkTo(c, h, 'D1.15.G') : undefined;
      case '7': return linkTo(c, 'cash', `D1.9.${ROW9[h]}`);
      // Row 8 adds the four ITC columns of the head's Table 9 row: to the row.
      case '8': return linkTo(c, undefined, `D1.9.${ROW9[h]}`);
      case '9': return linkTo(c, 'paid', `D1.14.${ROW14[h]}`);
      default: return undefined;
    }
  };
  const inLink = (code: string, h: string): SheetLink | undefined => {
    switch (code) {
      case '1': return linkTo(c, h, 'D1.8.A');
      case '2': return unset(N.prevYear8C) ? linkTo(c, h, 'C4.a4.c8') : undefined;
      case '3': return linkTo(c, h, 'D1.8.C');
      case '4': return unset(N.ineligible4D) ? linkTo(c, `itc4d.${h}`, 'B6.m.itc4d') : undefined;
      case '7': return unset(N.itcUsed4A5) ? linkTo(c, `itc4a5.${h}`, 'B6.m.itc4a5') : undefined;
      case '8': return unset(N.reversed4B2) ? linkTo(c, `itc4b2.${h}`, 'B6.m.itc4b2') : undefined;
      default: return undefined;
    }
  };
  formBlocks(p, [outward, inward], {
    numberRow: true,
    // The TOTAL column adds the heads; only the head columns carry a source.
    cellSrc: (t, ri, col) => (col >= 1 && col <= 4 ? (t === outward ? outSrc : inSrc)[t.rows[ri].code] : undefined),
    links: { prefix: 'D3', link: (t, row, key) => (TAX_KEYS.has(key) ? (t === outward ? outLink : inLink)(row.code, key) : undefined) },
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
  const described = log.map((e) => ({ e, d: describeChange(e, { forClient: c.forClient }) }));
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
  const forClient = input.audience === 'client';
  const status = statusText(period, { forClient, sheets: input.sheets });
  const signoff = toSignoffState(period, { sheets: input.sheets });
  // "Verified by Amit (GST manager) on 14 Oct 2026", or a line to sign on.
  const preparedText = signedText(signoff.prepared) || SIGN_HERE;
  const verifiedText = signedText(signoff.verified) || SIGN_HERE;
  const reviewedText = signedText(signoff.locked) || SIGN_HERE;
  const preparedLine = `Prepared by ${preparedText}`;
  const verifiedLine = `Verified by ${verifiedText}`;
  const reviewedLine = `Reviewed by ${reviewedText}`;
  const changeLog = (input.changeLog ?? []).filter((e) => !forClient || !hiddenFromClients(e));
  const manual = docs.portal.manual ?? {};
  const monthMeta = docs.portal.monthMeta;
  const gstr9Source = docs.portal.gstr9Meta?.source ?? null;
  const ctx: Ctx = {
    steps: input.steps ?? [],
    docs,
    w,
    meta,
    heads: hasCess(w) ? ['i', 'c', 's', 'x'] : ['i', 'c', 's'],
    just: (key) => lines[key]?.text?.trim() ?? '',
    period,
    signoff,
    forClient,
    setOffs: input.setOffs ?? [],
    drc03s: input.drc03s ?? [],
    changeLog,
    status,
    printed: fmtDateTime(printedAt),
    preparedText,
    verifiedText,
    reviewedText,
    openOn: (prefixes) => w.diffs.filter((d) => d.open && prefixes.some((pre) => d.key.startsWith(pre))).length,
    portalSrc: (path) => {
      if (manual[path]) return 'typed';
      const parts = path.split('.');
      const s = parts[0] === 'months' ? monthMeta?.[parts[1] as MonthKey]?.source ?? null : gstr9Source;
      if (s === 'manual') return 'typed';
      return s ? 'portal' : 'computed';
    },
    anchors: new Map(),
  };
  // Built in this order so a form's links find the rows they point at (paper() registers them): the
  // sources first, then GSTR-9 (D1), the builder roll-forward (D2A), GSTR-9C (D2, reads both) and the Notice format (D3).
  const head = [
    cover(ctx),
    signOff(ctx),
    plOutput(ctx), plInput(ctx), dto(ctx), dti(ctx), rcm(ctx), portalData(ctx),
    gstr9Output(ctx), gstr9Input(ctx), ...(w.r42.enabled ? [rule42Paper(ctx)] : []), gstr9cHeads(ctx), annexure(ctx), differences(ctx), capitalGoodsSold(ctx),
  ];
  const d1 = gstr9Form(ctx);
  const d2a = w.gstr9c.builderAdv ? [builderAdvPaper(ctx)] : [];
  const d2 = gstr9c(ctx);
  const papers = [
    ...head,
    d1, d2, ...d2a, notice(ctx),
    payables(ctx),
    revisionHistory(ctx),
  ];
  // The index lists every paper, itself included, in order.
  const placeholder: WorkingPaper = { ref: 'A2', title: 'Index', sheet: 'A2 INDEX', phase: 'summary', master: '—', source: '', widths: [], blocks: [], openDiffs: null };
  // A one-step export keeps the cover, the index and that step's papers (STEP_PAPERS).
  const keep = papersForSteps(input.steps);
  const chosen = keep ? papers.filter((wp) => keep.has(wp.ref)) : papers;
  const ordered = [chosen[0], placeholder, ...chosen.slice(1)];
  ordered[1] = index(ctx, ordered);
  return {
    papers: ordered,
    firm: FIRM_NAME,
    meta,
    status,
    printed: ctx.printed,
    preparedLine,
    verifiedLine,
    reviewedLine,
    changeCount: ctx.changeLog.length,
  };
}
