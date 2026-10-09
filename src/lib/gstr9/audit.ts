// The revision log of an Annual Return working, as the database records it
// (annual_return_change_log, written by a trigger on every save — see
// supabase/migrations/20260929100000_annual_return_audit_signoff_payables.sql —
// and by the allotment and sign-off functions of
// 20261011100000_annual_return_allotment_signoff.sql) and how it reads to a
// person: which sheet, which place inside it, and the figure before and after.

import { displayName } from './signoffFlow';
import { FY_MONTHS, type MonthKey } from './types';
import { ROLE_LABEL } from './signoff';

export type ChangeKind = 'edit' | 'add' | 'remove' | 'status' | 'setoff';

export interface ChangeLogEntry {
  id: number;
  /** A sheet key (sales, portal …), 'period' for status / sign-off, 'payables' for set-offs. */
  docKey: string;
  /** Sheet version this change produced (null for status and set-off entries). */
  version: number | null;
  /** Where inside the sheet: object keys, "#<row id>" for list rows, list indexes. */
  path: string[];
  /** Ledger / description of the row the change is in, as it was when changed. */
  rowLabel: string | null;
  kind: ChangeKind;
  oldValue: unknown;
  newValue: unknown;
  /** "Edited", "Imported as-filed GSTR-3B", "Restored version 12", "Verified", "Reviewed and locked" … */
  action: string | null;
  changedBy: string | null;
  changedAt: string;
}

export const SHEET_LABEL: Record<string, string> = {
  sales: 'Sales (P&L)',
  purchases: 'Purchases & ITC (P&L)',
  duties_output: 'Duties & Taxes — output',
  duties_input: 'Duties & Taxes — input',
  rcm: 'RCM',
  portal: 'Portal data',
  gstr9: 'GSTR-9',
  annexures: 'Annexures',
  gstr9c: 'GSTR-9C',
  notice: 'Notice format',
  justifications: 'Reasons for differences',
  settings: 'Settings',
  period: 'Status & sign-off',
  payables: 'Payables & set-off',
};

const MONTH_LABEL: Record<MonthKey, string> = {
  apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September',
  oct: 'October', nov: 'November', dec: 'December', jan: 'January', feb: 'February', mar: 'March',
};

/** Readable names for the keys the sheets use. Anything not here is un-camel-cased. */
const KEY_LABEL: Record<string, string> = {
  i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess', t: 'Value',
  igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess',
  itcI: 'ITC paid — IGST', itcC: 'ITC paid — CGST', itcS: 'ITC paid — SGST', itcX: 'ITC paid — Cess',
  partA: 'Part A (taxable)', partB: 'Part B (non-taxable)', rows: 'Ledgers', categories: 'Categories', adjustments: 'Adjustments',
  months: 'Months', monthMeta: 'Month source', lines: 'Reasons',
  ledger: 'Ledger', taxable: 'Taxable value', amount: 'Amount', rate: 'Rate', category: 'Table 4 category', nature: 'Nature',
  supplyType: 'Supply type', head: 'Expense head', section: 'Section', description: 'Description', name: 'Name', text: 'Reason',
  hsn: 'HSN', uqc: 'UQC', qty: 'Quantity', concessional: 'Concessional rate',
  auditReportTotal: 'Total as per audit report', tolerance: 'Tolerance per head',
  outTax: 'Output tax 3.1(a)+(b)', rcm: 'RCM 3.1(d)', itc4aTotal: 'ITC 4A total', itc4a5: 'ITC 4A(5)', itc4b1: 'ITC reversed 4B(1)',
  itc4b2: 'ITC reversed 4B(2)', itc4d: 'Ineligible ITC 4D', itcExclRcm: 'ITC excluding RCM', itcUsed4A5: 'ITC used 4A(5)', reversed4B2: 'Reversed 4B(2)',
  source: 'Source', arn: 'ARN', filedDate: 'Filed on', status: 'Status', manual: 'Typed by hand',
  gstr9Meta: 'GSTR-9 source', table4: 'Table 4', table5: 'Table 5', table9: 'Table 9', gstr9: 'GSTR-9 figures',
  payable: 'Tax payable', cash: 'Paid in cash', interest: 'Interest', lateFee: 'Late fee', penalty: 'Penalty', other: 'Other',
  purchase: 'Purchases', creditNote: 'Credit notes', debitNote: 'Debit notes', lastYearEffect: 'Last year effect',
  suspRev: 'Suspended ITC reversed', suspRev180: 'Reversed (180 days)', suspReclaim: 'Suspended ITC reclaimed', suspReclaim180: 'Reclaimed (180 days)',
  suspendedOtherAdj: 'Other suspended adjustments',
  a1NonGstIncome: 'Annexure-1 · Net non-GST income', a1SaleReturn: 'Annexure-1 · Sale return',
  a3RcmToPay: 'Annexure-3 · RCM to be paid', a3ExcessItc: 'Annexure-3 · Excess ITC claimed', a3Other: 'Annexure-3 · Other payments',
  a3AlreadyPaid: 'Annexure-3 · Already paid', a4: 'Annexure-4 (previous year)', side: 'Output / input',
  c8: 'Clause 8', c10: 'Clause 10', c11: 'Clause 11', c12: 'Clause 12', c13: 'Clause 13',
  prevYear8C: 'Previous year 8C', prevYearT14: 'Previous year Table 14', certification: 'Certification', partV: 'Part V',
  itcTable: 'ITC table', r37: 'Rule 37', r37A: 'Rule 37A', r38: 'Rule 38', r39: 'Rule 39', r42: 'Rule 42', r43: 'Rule 43',
  s17_5: 'Section 17(5)', ineligible4D: 'Ineligible 4D', ineligible164: 'Ineligible u/s 16(4)', tran1: 'TRAN-I', tran2: 'TRAN-II',
  refundClaimed: 'Refund claimed', refundSanctioned: 'Refund sanctioned', refundRejected: 'Refund rejected', refundPending: 'Refund pending',
  demandTotal: 'Total demand', demandPaid: 'Demand paid', demandPending: 'Demand pending',
  compositionSupplies: 'Supplies from composition taxpayers', deemedSupply: 'Deemed supply u/s 143', approvalNotReturned: 'Goods sent on approval not returned',
  status_: 'Status', prepared: 'Prepared',
};

const unCamel = (k: string): string =>
  k.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, (m) => m.toUpperCase());

/** One path element as words. Returns null for elements that add nothing ("months", list indexes of fixed rows). */
const segment = (key: string, rowLabel: string | null): string | null => {
  if (key.startsWith('#')) return rowLabel ? `“${rowLabel}”` : 'row';
  if (/^\d+$/.test(key)) return `line ${Number(key) + 1}`;
  if ((FY_MONTHS as readonly string[]).includes(key)) return MONTH_LABEL[key as MonthKey];
  if (key === 'months') return null;
  if (key === 'f') return 'typed expression';
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  const table = /^t(\d{1,2}[A-Z]?\d?)$/.exec(key);
  if (table) return `Table ${table[1]}`;
  if (/^[A-Z]\d?$/.test(key)) return `row ${key}`;
  return unCamel(key);
};

const ALLOT_SLOT: Record<string, string> = { preparer: 'Preparer', verifier: 'Verifier', reviewer: 'Reviewer' };

/** Where in the sign-off a 'period' entry belongs, by path[0]. */
const periodPlace = (path: string[]): string => {
  switch (path[0]) {
    case 'prepared': return 'Prepared';
    case 'verified': return 'Verified';
    case 'returned': return 'Sent back';
    case 'allot': return `Allotment › ${ALLOT_SLOT[path[1]] ?? unCamel(path[1] ?? 'person')}`;
    default: return 'Status';
  }
};

/**
 * Entries a client login is not shown: the allotment and the send-backs
 * (internal review notes). Everything else of the log is.
 */
export const hiddenFromClients = (e: Pick<ChangeLogEntry, 'docKey' | 'path'>): boolean =>
  e.docKey === 'period' && (e.path[0] === 'allot' || e.path[0] === 'returned');

/** "Part A (taxable) › “Sales @18%” › Taxable value". */
export const describePlace = (e: Pick<ChangeLogEntry, 'docKey' | 'path' | 'rowLabel'>): string => {
  if (e.docKey === 'period') return periodPlace(e.path);
  if (e.docKey === 'payables') return `${e.path[0] === 'input' ? 'Input' : 'Output'} payable › ${e.rowLabel ?? 'set-off'}`;
  if (e.docKey === 'justifications' && e.path[0] === 'lines' && e.path[1]) return `Reason for “${e.path[1]}”`;
  const parts = e.path.map((k) => segment(k, e.rowLabel)).filter((x): x is string => !!x);
  // "typed expression" reads better after the field it belongs to: "Taxable value (typed expression)".
  const out: string[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0 && parts[idx - 1] === 'typed expression') out[out.length - 1] = `${p} (typed expression)`;
    else out.push(p);
  });
  return out.join(' › ') || 'Whole sheet';
};

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A logged value as text: figures in Indian grouping, rows as their name, blanks as "—". */
export const formatLoggedValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return INR.format(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const name = o.ledger ?? o.description ?? o.label ?? o.name;
    const figures = (['taxable', 'amount', 't', 'igst', 'cgst', 'sgst', 'cess', 'i', 'c', 's', 'x'] as const)
      .filter((k) => typeof o[k] === 'number' && Math.abs(o[k] as number) >= 0.005)
      .map((k) => `${KEY_LABEL[k] ?? k} ${INR.format(o[k] as number)}`);
    if (name || figures.length) return [name ? String(name) : null, figures.join(' · ') || null].filter(Boolean).join(' — ');
    if (typeof o.status === 'string') return String(o.status).replace('_', ' ');
    return Object.entries(o)
      .filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object')
      .map(([k, x]) => `${KEY_LABEL[k] ?? k}: ${typeof x === 'number' ? INR.format(x) : String(x)}`)
      .join(' · ') || '—';
  }
  return String(v);
};

export interface DescribedChange {
  when: string;
  who: string;
  sheet: string;
  place: string;
  from: string;
  to: string;
  what: string;
}

/** Stages (status rows from 11 Oct 2026) and the statuses written before them. */
const STATUS_WORD: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', preparing: 'Preparing', sent_back: 'Sent back',
  prepared: 'Prepared', verified: 'Verified', locked: 'Locked',
};

/** Actions written before the three-stage sign-off, in today's words. */
const LEGACY_ACTION: Record<string, string> = {
  'Verified and locked': 'Reviewed and locked (verified in the same step)',
  'Marked ready for review': 'Marked prepared',
  'Withdrew ready for review': 'Withdrew prepared',
};

/** An allotment entry's {id, name} as the name ("—" for nobody). */
const allottedName = (v: unknown): string => {
  const name = v && typeof v === 'object' ? (v as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? displayName(name) : '—';
};

/**
 * A log entry in words, for the revision history screen and the exports.
 * `forClient` leaves out the sign-off notes (a client login never sees them).
 */
export const describeChange = (e: ChangeLogEntry, opts: { forClient?: boolean } = {}): DescribedChange => {
  const sheet = SHEET_LABEL[e.docKey] ?? unCamel(e.docKey);
  const place = describePlace(e);
  let from = formatLoggedValue(e.oldValue);
  let to = formatLoggedValue(e.newValue);
  let what = (e.docKey === 'period' && e.action ? LEGACY_ACTION[e.action] : undefined) ?? (e.action || 'Edited');
  // A superadmin override's reason is the firm's internal note, like the other sign-off notes.
  if (opts.forClient && e.docKey === 'period') what = what.replace(/\(superadmin override: .*\)$/, '(superadmin override)');
  if (e.kind === 'add') { what = `${what} — row added`; from = '—'; }
  if (e.kind === 'remove') { what = `${what} — row removed`; to = '—'; }
  if (e.kind === 'status' && e.path[0] === 'allot') {
    from = allottedName(e.oldValue);
    to = allottedName(e.newValue);
  } else if (e.kind === 'status') {
    // new_value is {stage, role, note, …}; before 11 Oct 2026 it was {status, role, note, checklist}.
    const nv = (e.newValue ?? {}) as { stage?: string; status?: string; role?: string; note?: string };
    const stage = nv.stage ?? nv.status;
    from = typeof e.oldValue === 'string' ? STATUS_WORD[e.oldValue] ?? e.oldValue : '—';
    to = [
      stage ? STATUS_WORD[stage] ?? stage : null,
      nv.role ? `as ${(ROLE_LABEL[nv.role] ?? nv.role.replace(/_/g, ' ')).toLowerCase().replace('gst', 'GST')}` : null,
      nv.note && !opts.forClient ? `“${nv.note}”` : null,
    ].filter(Boolean).join(' · ') || '—';
  }
  if (e.kind === 'setoff') {
    const row = (e.action === 'Removed set-off' ? e.oldValue : e.newValue) as Record<string, unknown> | null;
    const heads = row ? (['igst', 'cgst', 'sgst', 'cess'] as const).filter((k) => Number(row[k]) > 0).map((k) => `${KEY_LABEL[k]} ${INR.format(Number(row[k]))}`).join(' · ') : '';
    if (e.action === 'Removed set-off') {
      from = heads || '—';
      const reason = (e.newValue as { reason?: string } | null)?.reason;
      to = reason ? `Removed — “${reason}”` : 'Removed';
    } else {
      from = '—';
      to = heads || '—';
    }
  }
  return { when: e.changedAt, who: e.changedBy || '—', sheet, place, from, to, what };
};

/** Map a database row to a ChangeLogEntry. */
export const toChangeLogEntry = (r: {
  id: number; doc_key: string; version: number | null; path: string[] | null; row_label: string | null; kind: string;
  old_value: unknown; new_value: unknown; action: string | null; changed_by: string | null; changed_at: string;
}): ChangeLogEntry => ({
  id: r.id,
  docKey: r.doc_key,
  version: r.version,
  path: r.path ?? [],
  rowLabel: r.row_label,
  kind: r.kind as ChangeKind,
  oldValue: r.old_value,
  newValue: r.new_value,
  action: r.action,
  changedBy: r.changed_by,
  changedAt: r.changed_at,
});
