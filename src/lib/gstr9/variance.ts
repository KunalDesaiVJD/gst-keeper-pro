// The final GSTR-9 against the portal's system-computed GSTR-9 (26 Nov 2026;
// §12 of docs/GSTR9_9C_WORKINGS.md).
//
// The portal pre-fills a GSTR-9 from the year's returns (docs.portal.gstr9:
// Table 4, Table 5's values, 6A, 6G, 8A and Table 9). The working's GSTR-9
// (workings.g9) starts from it and departs where the books say otherwise:
// 4G from RCM Part A, Table 5 from the books, 6A from the as-filed GSTR-3B
// when the portal's is nil, a typed 6G, a typed Table 9 payable. Every cell
// whose final figure differs from the system-computed one by more than the
// working's tolerance is listed here, with the remarks that bear on it: the
// reasons of its difference lines (and their GSTR-9 effects), the GSTR-9C
// reasons and the self-check's No answers. Nothing here writes.

import type { Workings } from './engine';
import { inr } from './varianceStyle';
import { gstr9PortalPresent } from './engine';
import { amountText, KIND_META } from './remarkEffects';
import { SELF_CHECK_QUESTIONS } from './selfCheck';
import { TABLE9_HEADS, type AnnualReturnDocs, type T4Key, type RemarkEffect, type T5Key, type Table9Head, type Tax, type ValTax, type VarianceSummary } from './types';

export type { VarianceSummary } from './types';

export type VarianceTable = '4' | '5' | '6' | '8' | '9';
export const VARIANCE_TABLES: VarianceTable[] = ['4', '5', '6', '8', '9'];
/** A column of the form: a head, or Table 9's tax payable. */
export type VarianceCol = 't' | 'c' | 's' | 'i' | 'x' | 'payable';

export const VARIANCE_COL_LABEL: Record<VarianceCol, string> = {
  t: 'Taxable value', c: 'Central tax', s: 'State/UT tax', i: 'Integrated tax', x: 'Cess', payable: 'Tax payable',
};

export interface VarianceCell {
  /** "<row>.<col>", e.g. "5D.t", "9A.payable". */
  id: string;
  table: VarianceTable;
  /** The row's code within its table as the working paper writes it ("G", "G1", "A"). */
  code: string;
  /** The row as the form numbers it ("4G", "9A"). */
  row: string;
  /** The row's key on the screen (MatrixTable / FormTable key, or Table 9's grid row id). */
  rowKey: string;
  rowLabel: string;
  col: VarianceCol;
  /** System-computed (portal) figure. */
  portal: number;
  /** The final figure of the working's GSTR-9. */
  final: number;
  /** final − portal. */
  diff: number;
  /** Difference lines whose reasons bear on the cell: exact keys, or prefixes ending in ".". */
  related: string[];
}

export type RemarkKind = 'reason' | 'gstr9c' | 'selfcheck';

export interface VarianceRemark {
  /** Stable id: "reason:<line key>", "gstr9c:t6Reasons", "selfcheck:<question key>". */
  id: string;
  kind: RemarkKind;
  /** What the remark is written on (the difference line, the 9C table, the question). */
  label: string;
  text: string;
  /** The GSTR-9 effect read from a reason (remarkEffects.ts), in words, with its status. */
  effect?: string;
  lineKey?: string;
  /** The GSTR-9 tables the remark bears on. */
  tables: VarianceTable[];
}

const r2 = (n: number) => {
  const r = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export { inr, VARIANCE_CELL_CLASS, varianceTitle } from './varianceStyle';

// ---------------------------------------------------------------------------
// The rows compared
// ---------------------------------------------------------------------------

type T4Code = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'G1' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N';
const T4_ROWS: Array<{ code: T4Code; label: string; portal?: T4Key; related: string[] }> = [
  { code: 'A', portal: 'b2c', label: 'B2C supplies', related: ['out.b2c', 'out.total'] },
  { code: 'B', portal: 'b2b', label: 'B2B supplies', related: ['out.b2b', 'out.total'] },
  { code: 'C', portal: 'exp', label: 'Exports on payment of tax', related: ['out.exp', 'out.total'] },
  { code: 'D', portal: 'sez', label: 'SEZ on payment of tax', related: ['out.sez', 'out.total'] },
  { code: 'E', portal: 'deemed', label: 'Deemed exports', related: ['out.deemed', 'out.total'] },
  { code: 'F', portal: 'at', label: 'Advances (tax paid, no invoice)', related: ['out.at', 'out.total'] },
  { code: 'G', portal: 'rchrg', label: 'Inward supplies on reverse charge', related: ['rcm.', 'dti.rcm'] },
  { code: 'G1', portal: 'ecom', label: 'E-commerce operator u/s 9(5)', related: ['out.ecom', 'out.total'] },
  { code: 'H', label: 'Sub-total (A to G1)', related: ['out.', 'rcm.annual'] },
  { code: 'I', portal: 'cr_nt', label: 'Credit notes (−)', related: ['out.cr_nt', 'out.total'] },
  { code: 'J', portal: 'dr_nt', label: 'Debit notes (+)', related: ['out.dr_nt', 'out.total'] },
  { code: 'K', portal: 'amd_pos', label: 'Amendments (+)', related: ['out.amd', 'out.total'] },
  { code: 'L', portal: 'amd_neg', label: 'Amendments (−)', related: ['out.amd', 'out.total'] },
  { code: 'M', label: 'Sub-total (I to L)', related: ['out.'] },
  { code: 'N', label: 'Supplies and advances on which tax is payable (H + M)', related: ['out.', 'rcm.annual'] },
];

type T5Code = 'A' | 'B' | 'C' | 'C1' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N';
const T5_ROWS: Array<{ code: T5Code; label: string; portal?: T5Key; total?: 'G' | 'L' | 'M' | 'N'; related: string[] }> = [
  { code: 'A', portal: 'zero_rtd', label: 'Exports without payment of tax', related: ['g9.t5.5A'] },
  { code: 'B', portal: 'sez', label: 'SEZ without payment of tax', related: ['g9.t5.5B'] },
  { code: 'C', portal: 'rchrg', label: 'Tax payable by the recipient (RCM)', related: ['g9.t5.5C'] },
  { code: 'C1', portal: 'ecom_14', label: 'Tax payable by e-commerce operators u/s 9(5)', related: ['g9.t5.5C1'] },
  { code: 'D', portal: 'exmt', label: 'Exempted', related: ['g9.t5.5D'] },
  { code: 'E', portal: 'nil', label: 'Nil rated', related: ['g9.t5.5E'] },
  { code: 'F', portal: 'non_gst', label: 'Non-GST supply', related: ['g9.t5.5F'] },
  { code: 'G', total: 'G', label: 'Sub-total (A to F)', related: ['g9.t5.', 'sales.'] },
  { code: 'H', portal: 'cr_nt', label: 'Credit notes (−)', related: ['g9.t5.5H'] },
  { code: 'I', portal: 'dr_nt', label: 'Debit notes (+)', related: ['g9.t5.'] },
  { code: 'J', portal: 'amd_pos', label: 'Amendments (+)', related: ['g9.t5.'] },
  { code: 'K', portal: 'amd_neg', label: 'Amendments (−)', related: ['g9.t5.'] },
  { code: 'L', total: 'L', label: 'Sub-total (H to K)', related: ['g9.t5.'] },
  { code: 'M', total: 'M', label: 'Turnover on which tax is not payable (G + L)', related: ['g9.t5.', 'sales.'] },
  { code: 'N', total: 'N', label: 'Total turnover (4N + 5M − 4G − 4G1)', related: ['g9.t5.', 'out.', 'rcm.annual', 'sales.'] },
];

const T9_ROWS: Array<{ head: Table9Head; code: string; label: string }> = [
  { head: 'igst', code: 'A', label: 'Integrated tax' },
  { head: 'cgst', code: 'B', label: 'Central tax' },
  { head: 'sgst', code: 'C', label: 'State/UT tax' },
  { head: 'cess', code: 'D', label: 'Cess' },
];

const VAL_COLS: Array<keyof ValTax> = ['t', 'c', 's', 'i', 'x'];
const TAX_COLS: Array<keyof Tax> = ['c', 's', 'i', 'x'];

const addV = (...xs: ValTax[]): ValTax => xs.reduce((a, b) => ({ t: a.t + num(b.t), i: a.i + num(b.i), c: a.c + num(b.c), s: a.s + num(b.s), x: a.x + num(b.x) }), { t: 0, i: 0, c: 0, s: 0, x: 0 });
const negV = (v: ValTax): ValTax => ({ t: -num(v.t), i: -num(v.i), c: -num(v.c), s: -num(v.s), x: -num(v.x) });

/** The tables a difference line's reason bears on. */
export function lineTables(key: string): VarianceTable[] {
  if (/^out\./.test(key)) return ['4'];
  if (/^rcm\./.test(key) || key === 'dti.rcm') return ['4', '6'];
  if (/^(g9\.t5\.|sales\.)/.test(key)) return ['5'];
  if (/^g9\.8/.test(key)) return ['8'];
  if (/^(itc\.|dti\.|purchases\.)/.test(key)) return key === 'itc.books' ? ['6', '8'] : ['6'];
  if (/^(g9\.t9\.|dto\.)/.test(key) || key === 'ann1.paid') return ['9'];
  return [];
}

const matches = (key: string, related: string[]) => related.some((r) => (r.endsWith('.') ? key.startsWith(r) : key === r));

/**
 * Every cell of Tables 4, 5, 6, 8 and 9 whose final figure differs from the
 * system-computed one by more than the tolerance. Empty while the portal's
 * GSTR-9 is not fetched (nothing to compare with).
 */
export function systemVariances(docs: AnnualReturnDocs, w: Workings): VarianceCell[] {
  if (!gstr9PortalPresent(docs)) return [];
  const P = docs.portal.gstr9;
  const g = w.g9;
  const tol = Math.max(0.005, num(w.tolerance));
  const out: VarianceCell[] = [];
  const push = (table: VarianceTable, code: string, rowKey: string, rowLabel: string, col: VarianceCol, portal: number, final: number, related: string[]) => {
    const p = r2(portal);
    const f = r2(final);
    const d = r2(f - p);
    if (Math.abs(d) <= tol) return;
    const row = table === '9' ? `9${code}` : `${table}${code}`;
    out.push({ id: `${row}.${col}`, table, code, row, rowKey, rowLabel, col, portal: p, final: f, diff: d, related });
  };

  // Table 4: the portal's rows, and its sub-totals added up the form's way.
  const p4 = {} as Record<T4Code, ValTax>;
  T4_ROWS.forEach((r) => { if (r.portal) p4[r.code] = P.table4[r.portal]; });
  p4.H = addV(p4.A, p4.B, p4.C, p4.D, p4.E, p4.F, p4.G, p4.G1);
  p4.M = addV(p4.J, p4.K, negV(p4.I), negV(p4.L));
  p4.N = addV(p4.H, p4.M);
  T4_ROWS.forEach((r) => VAL_COLS.forEach((h) => push('4', r.code, `4${r.code}`, r.label, h, num(p4[r.code]?.[h]), num(g.t4[r.code]?.[h]), r.related)));

  // Table 5: taxable value (5N also carries tax, from Table 4).
  const p5 = (r: (typeof T5_ROWS)[number]): ValTax => {
    if (r.portal) return { t: num(P.table5[r.portal]), i: 0, c: 0, s: 0, x: 0 };
    if (r.total === 'N') {
      const m = num(g.t5PortalTotals.M);
      return addV(p4.N, { t: m, i: 0, c: 0, s: 0, x: 0 }, negV(p4.G), negV(p4.G1));
    }
    return { t: num(g.t5PortalTotals[r.total!]), i: 0, c: 0, s: 0, x: 0 };
  };
  T5_ROWS.forEach((r) => {
    const pv = p5(r);
    (r.total === 'N' ? VAL_COLS : (['t'] as const)).forEach((h) => push('5', r.code, `5${r.code}`, r.label, h, num(pv[h]), num(g.t5[r.code]?.[h]), r.related));
  });

  // Table 6: 6A and 6G (the other rows are the working's own).
  TAX_COLS.forEach((h) => push('6', 'A', '6A', 'ITC availed through GSTR-3B', h, num(P.t6A[h]), num(g.t6.A[h]), ['itc.6J', 'itc.books', 'dti.']));
  TAX_COLS.forEach((h) => push('6', 'G', '6G', 'ITC received from ISD', h, num(P.t6G[h]), num(g.t6.G[h]), ['itc.']));

  // Table 8: 8A (ITC as per GSTR-2B).
  TAX_COLS.forEach((h) => push('8', 'A', '8A', 'ITC as per GSTR-2B', h, num(P.t8A[h]), num(g.t8.A[h]), ['g9.8D', 'g9.8C', 'itc.books']));

  // Table 9: the tax payable, while the portal's Table 9 is in (paid columns are the portal's own).
  const t9In = TABLE9_HEADS.some((h) => {
    const r = P.table9[h];
    return num(r.payable) || num(r.cash) || num(r.itcI) || num(r.itcC) || num(r.itcS) || num(r.itcX);
  });
  if (t9In) {
    T9_ROWS.forEach((r) => push('9', r.code, r.head, r.label, 'payable', num(P.table9[r.head].payable), num(g.t9[r.head].payable), [`g9.t9.${r.head}`, 'ann1.paid', 'dto.']));
  }
  return out;
}

/** Look a cell up by its table, screen row key and column. */
export type VarianceLookup = (table: VarianceTable, rowKey: string, col: VarianceCol | string) => VarianceCell | null;

export function varianceLookup(cells: VarianceCell[]): VarianceLookup {
  const m = new Map(cells.map((c) => [`${c.table}|${c.rowKey}|${c.col}`, c]));
  return (table, rowKey, col) => m.get(`${table}|${rowKey}|${col}`) ?? null;
}

/** Look a cell up as the working paper names it: table no., row code (or key), column key. */
export function varianceByCode(cells: VarianceCell[]): (table: string, code: string, col: string) => VarianceCell | null {
  const m = new Map(cells.map((c) => [`${c.table}|${c.code}|${c.col}`, c]));
  return (table, code, col) => m.get(`${table}|${code}|${col}`) ?? null;
}

export const countByTable = (cells: VarianceCell[]): Record<VarianceTable, number> => {
  const out = { '4': 0, '5': 0, '6': 0, '8': 0, '9': 0 } as Record<VarianceTable, number>;
  cells.forEach((c) => { out[c.table] += 1; });
  return out;
};

// ---------------------------------------------------------------------------
// The remarks given
// ---------------------------------------------------------------------------

const GSTR9C_REASONS: Array<{ key: 't6Reasons' | 't8Reasons' | 't10Reasons' | 't13Reasons' | 't15Reasons'; label: string; tables: VarianceTable[] }> = [
  { key: 't6Reasons', label: 'GSTR-9C Table 6: reasons for un-reconciled gross turnover', tables: ['4', '5'] },
  { key: 't8Reasons', label: 'GSTR-9C Table 8: reasons for un-reconciled taxable turnover', tables: ['4', '5'] },
  { key: 't10Reasons', label: 'GSTR-9C Table 10: reasons for un-reconciled tax paid', tables: ['9'] },
  { key: 't13Reasons', label: 'GSTR-9C Table 13: reasons for un-reconciled ITC', tables: ['6', '8'] },
  { key: 't15Reasons', label: 'GSTR-9C Table 15: reasons for un-reconciled ITC on expenses', tables: ['6', '8'] },
];

const STEP_TABLES: Record<string, VarianceTable[]> = {
  portal: VARIANCE_TABLES, sales: ['4', '5'], outward: ['4', '5'], rcm: ['4', '6'], purchases: ['6', '8'],
  duties: ['6', '9'], itc: ['6', '8'], payables: ['9'], gstr9: VARIANCE_TABLES,
};

/** A reason's GSTR-9 effect in words: "Declared in next FY (Table 10): value ₹… · applied". */
export function effectText(e: RemarkEffect): string {
  const m = KIND_META[e.kind];
  if (!m) return '';
  const amt = m.target || e.kind === 'prev_fy_itc' || e.kind === 'pay_drc03' ? `: ${amountText(e.amount, m.withTaxable)}` : '';
  const status = e.status === 'applied' ? (e.wrote ? `added to ${m.short}` : 'applied, already in the table') : e.status === 'dismissed' ? 'dismissed' : 'suggested, not applied';
  return `${m.label}${amt} (${status})`;
}

/** Every remark the working holds: reasons on difference lines, GSTR-9C reasons, self-check No answers. */
export function gatherRemarks(docs: AnnualReturnDocs, w: Workings): VarianceRemark[] {
  const out: VarianceRemark[] = [];
  w.diffs.forEach((d) => {
    const text = d.justification?.text?.trim();
    if (!text) return;
    const e = d.justification?.effect;
    out.push({ id: `reason:${d.key}`, kind: 'reason', label: d.label, text, lineKey: d.key, tables: lineTables(d.key), ...(e ? { effect: effectText(e) } : {}) });
  });
  const C = docs.gstr9c as unknown as Record<string, unknown>;
  GSTR9C_REASONS.forEach((r) => {
    const text = typeof C[r.key] === 'string' ? (C[r.key] as string).trim() : '';
    if (text) out.push({ id: `gstr9c:${r.key}`, kind: 'gstr9c', label: r.label, text, tables: r.tables });
  });
  Object.entries(docs.selfcheck?.answers ?? {}).forEach(([key, a]) => {
    const text = a?.answer === 'no' ? a.note?.trim() : '';
    if (!text) return;
    const q = SELF_CHECK_QUESTIONS.find((x) => x.key === key);
    out.push({ id: `selfcheck:${key}`, kind: 'selfcheck', label: q ? `Self-check: ${q.short}` : `Self-check: ${key}`, text, tables: q ? STEP_TABLES[q.step] ?? [] : [] });
  });
  return out;
}

/** The remarks that bear on one differing cell: its lines' reasons first, then 9C and self-check remarks on its table. */
export function remarksForCell(cell: VarianceCell, remarks: VarianceRemark[]): VarianceRemark[] {
  const reasons = remarks.filter((r) => r.kind === 'reason' && r.lineKey && matches(r.lineKey, cell.related));
  const others = remarks.filter((r) => r.kind !== 'reason' && r.tables.includes(cell.table));
  return [...reasons, ...others];
}

/** A cell is explained when a reason on one of its difference lines says why. */
export const isExplained = (cell: VarianceCell, remarks: VarianceRemark[]): boolean =>
  remarks.some((r) => r.kind === 'reason' && r.lineKey && matches(r.lineKey, cell.related));

// ---------------------------------------------------------------------------
// Digest, rules summary, the assistant's request
// ---------------------------------------------------------------------------

/** FNV-1a over the differences and the remarks: a summary written from other figures or remarks is stale. */
export function varianceDigest(cells: VarianceCell[], remarks: VarianceRemark[]): string {
  const s = JSON.stringify([cells.map((c) => [c.id, c.portal, c.final]), remarks.map((r) => [r.id, r.text, r.effect ?? ''])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const cellLabel = (c: VarianceCell) => `${c.row} ${c.rowLabel}, ${VARIANCE_COL_LABEL[c.col].toLowerCase()}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The summary built in the browser: grouped by table, quoting the remarks. */
export function rulesSummary(cells: VarianceCell[], remarks: VarianceRemark[]): Pick<VarianceSummary, 'overall' | 'tables' | 'unexplained'> {
  if (!cells.length) return { overall: 'The final GSTR-9 agrees with the system-computed GSTR-9 within the tolerance.', tables: [], unexplained: [] };
  const tables = VARIANCE_TABLES.flatMap((t) => {
    const cs = cells.filter((c) => c.table === t);
    if (!cs.length) return [];
    const figs = cs.slice(0, 6).map((c) => `${c.row} ${VARIANCE_COL_LABEL[c.col].toLowerCase()} final ${inr(c.final)} against ${inr(c.portal)} (${inr(c.diff)})`);
    const rel = new Map<string, VarianceRemark>();
    cs.forEach((c) => remarksForCell(c, remarks).forEach((r) => rel.set(r.id, r)));
    const quoted = [...rel.values()].slice(0, 6).map((r) => `${r.label}: "${clip(r.text, 220)}"${r.effect ? `; effect ${r.effect}` : ''}`);
    const summary = `${cs.length === 1 ? '1 figure differs' : `${cs.length} figures differ`} from the system-computed GSTR-9: ${figs.join('; ')}${cs.length > 6 ? `; and ${cs.length - 6} more` : ''}. ${
      quoted.length ? `Remarks given: ${quoted.join(' | ')}.` : 'No remark is given on it.'
    }`;
    return [{ table: t, summary }];
  });
  const unexplained = cells.filter((c) => !isExplained(c, remarks)).map((c) => ({ id: c.id, label: cellLabel(c), note: 'No reason on a related difference line.' }));
  const n = new Set(cells.map((c) => c.table)).size;
  const overall = `${cells.length === 1 ? '1 figure' : `${cells.length} figures`} in ${n === 1 ? '1 table' : `${n} tables`} of the final GSTR-9 differ from the system-computed GSTR-9; ${
    unexplained.length ? `${unexplained.length} ${unexplained.length === 1 ? 'has' : 'have'} no reason yet.` : 'each has a reason on a related difference line.'
  }`;
  return { overall, tables, unexplained };
}

/** What the GST Assistant is sent (mode variance_summary): the cells, the remarks, and Tables 10 to 14. */
export function varianceRequestBody(cells: VarianceCell[], remarks: VarianceRemark[], w: Workings) {
  const g = w.g9;
  return {
    cells: cells.slice(0, 120).map((c) => ({
      id: c.id, table: c.table, row: c.row, label: c.rowLabel, head: VARIANCE_COL_LABEL[c.col], portal: c.portal, final: c.final, diff: c.diff,
      remarks: remarksForCell(c, remarks).map((r) => r.id).slice(0, 20),
    })),
    remarks: remarks.slice(0, 120).map((r) => ({ id: r.id, kind: r.kind, label: clip(r.label, 300), text: clip(r.text, 1500), effect: r.effect ?? null, tables: r.tables })),
    nextFy: { t10: g.t10, t11: g.t11, t12: g.t12, t13: g.t13, t14: g.t14 },
  };
}
