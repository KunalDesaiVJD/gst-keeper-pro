// The filters of the reconciliation view (ReasonReconciliationView): one filter
// state applied to every tab (documents, suppliers, months, reasons,
// breakdowns), to the figures across the top and to the filtered Excel / PDF.
// Facets are OR within one facet (Only in 2A or Only in 2B) and AND across
// facets (Only in 2A and supplier X). A facet's counts are taken with every
// other filter applied but its own, so ticking a second value never shows 0 for
// the one already ticked (standard faceted search). Pure: no React, no clock,
// so scripts/verify-itc-reco.mjs tests it. Generic over the pair of sources:
// labels come from RecoViewData.left / .right.
import { monthLabel } from './dates';
import { statusLabel } from './reasons';
import { STATUS_ORDER } from './types';
import type { DocFamily, RecoStatus } from './types';
import type { RecoViewData, RecoViewRow } from './viewTypes';

// ── The filter state ────────────────────────────────────────────────────────

/** The multi-select facets. Each holds the selected values; empty = any. */
export type Facet =
  | 'status' | 'reason' | 'supplier' | 'period' | 'docType' | 'section'
  | 'itc' | 'rate' | 'reverseCharge' | 'flag' | 'confirmation';

// One collator each, built once: localeCompare with options builds a new one
// on every call, which was most of the cost of sorting a year of documents.
const TEXT = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const NAME = new Intl.Collator('en', { sensitivity: 'base' });
const NUMBERED = new Intl.Collator('en', { numeric: true });

export const FACETS: Facet[] = ['status', 'reason', 'supplier', 'period', 'docType', 'section', 'itc', 'rate', 'reverseCharge', 'flag', 'confirmation'];

export interface RecoFilters extends Record<Facet, string[]> {
  /** |tax difference| at least this (₹); null = any. A row that is not compared has no difference, so it drops out. */
  minDiff: number | null;
  /** Only rows whose taxable value or tax differs by more than this (the pair's tolerance): the "Differences only" preset. */
  aboveTolerance: number | null;
  /** Document date bounds, ISO, inclusive; a row without a date drops out once either is set. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Free text: every word must appear in the GSTIN, name, number, reason, evidence, action or notes. */
  search: string;
}

export const EMPTY_FILTERS: RecoFilters = {
  status: [], reason: [], supplier: [], period: [], docType: [], section: [],
  itc: [], rate: [], reverseCharge: [], flag: [], confirmation: [],
  minDiff: null, aboveTolerance: null, dateFrom: null, dateTo: null, search: '',
};

export const isFiltering = (f: RecoFilters): boolean =>
  FACETS.some((k) => f[k].length > 0) || (f.minDiff ?? 0) > 0 || f.aboveTolerance !== null
  || !!f.dateFrom || !!f.dateTo || f.search.trim() !== '';

// ── A row's value under each facet ──────────────────────────────────────────

/** One supplier: its GSTIN, or its name for an import without one (bySupplier keys them the same way). */
export const supplierKey = (r: RecoViewRow): string => r.ctin || `~${r.supplierName}`;

/** Family plus "A" for an amendment: "INV", "INVA", "CN" … (the By document type sheet groups the same way). */
export const docTypeKey = (r: RecoViewRow): string => `${r.family}${r.isAmendment ? 'A' : ''}`;

/** Where the right-hand statement puts the ITC; "none" when that statement does not have the document. */
export const itcKey = (r: RecoViewRow): string => (r.right ? r.right.itc ?? 'unknown' : 'none');

// Mirrors RATE_BANDS in viewModel.ts: a computed rate is snapped onto one of
// these when within 0.5, so anything else is a document mixing rates.
const STANDARD_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/** The rate of the right-hand document (else the left's): a standard rate, "mixed", or "none" without a taxable value. */
export const rateKey = (r: RecoViewRow): string => {
  const rate = (r.right ?? r.left)?.rate ?? null;
  if (rate === null) return 'none';
  return STANDARD_RATES.includes(rate) ? String(rate) : 'mixed';
};

export const confirmationKey = (r: RecoViewRow): string => (r.confirmed === true ? 'confirmed' : r.confirmed === false ? 'not_confirmed' : 'none');

export const reasonKey = (r: RecoViewRow): string => `${r.status}|${r.reason}`;

/** The values a row holds under a facet (flags: one per note, so a row can hold several). */
export function valuesOf(r: RecoViewRow, facet: Facet): string[] {
  switch (facet) {
    case 'status': return [r.status];
    case 'reason': return [reasonKey(r)];
    case 'supplier': return [supplierKey(r)];
    case 'period': return [r.period];
    case 'docType': return [docTypeKey(r)];
    case 'section': return [r.section || ''];
    case 'itc': return [itcKey(r)];
    case 'rate': return [rateKey(r)];
    case 'reverseCharge': return [r.reverseCharge ? 'yes' : 'no'];
    case 'flag': return [...new Set(r.notes.map((n) => n.code))];
    case 'confirmation': return [confirmationKey(r)];
  }
}

// ── Applying ────────────────────────────────────────────────────────────────

// Lower-cased text a search runs over, built once per row (rows never change).
const haystacks = new WeakMap<RecoViewRow, string>();
const haystackOf = (r: RecoViewRow): string => {
  let h = haystacks.get(r);
  if (h === undefined) {
    h = [
      r.ctin, r.supplierName, r.number, r.left?.number, r.right?.number, r.left?.original?.number, r.right?.original?.number,
      r.docType, r.section, r.statusLabel, r.reasonText, r.evidence, r.action, r.right?.irn, ...r.notes.map((n) => `${n.label} ${n.text}`),
    ].filter(Boolean).join('\n').toLowerCase();
    haystacks.set(r, h);
  }
  return h;
};

const tokensOf = (search: string): string[] => search.trim().toLowerCase().split(/\s+/).filter(Boolean);

type Test = (r: RecoViewRow) => boolean;

/** The checks a filter state makes: one per active facet, and the rest (difference, dates, search) together. */
function compile(f: RecoFilters): { facets: Partial<Record<Facet, Test>>; rest: Test } {
  const facets: Partial<Record<Facet, Test>> = {};
  for (const facet of FACETS) {
    const sel = f[facet];
    if (!sel.length) continue;
    const set = new Set(sel);
    facets[facet] = facet === 'flag'
      ? (r) => r.notes.some((n) => set.has(n.code))
      : (r) => set.has(valuesOf(r, facet)[0]);
  }
  const min = f.minDiff !== null && f.minDiff > 0 ? f.minDiff : null;
  const tol = f.aboveTolerance;
  const from = f.dateFrom || null;
  const to = f.dateTo || null;
  const words = tokensOf(f.search);
  const rest: Test = (r) => {
    if (min !== null && !(r.diff && r.absTaxDiff >= min - 0.005)) return false;
    if (tol !== null && !(r.diff && (Math.abs(r.diff.tax) > tol || Math.abs(r.diff.taxable) > tol))) return false;
    if ((from || to) && !r.date) return false;
    if (from && (r.date as string) < from) return false;
    if (to && (r.date as string) > to) return false;
    if (words.length) {
      const h = haystackOf(r);
      for (const w of words) if (!h.includes(w)) return false;
    }
    return true;
  };
  return { facets, rest };
}

/** The rows that pass every filter. */
export function applyFilters(rows: RecoViewRow[], f: RecoFilters): RecoViewRow[] {
  if (!isFiltering(f)) return rows;
  const { facets, rest } = compile(f);
  const tests = Object.values(facets) as Test[];
  return rows.filter((r) => rest(r) && tests.every((t) => t(r)));
}

/**
 * Every facet's counts in one pass: value → rows that pass every other filter
 * (a facet ignores its own selection). A row failing two facets counts for none.
 */
export function allFacetCounts(rows: RecoViewRow[], f: RecoFilters): Record<Facet, Map<string, number>> {
  const out = Object.fromEntries(FACETS.map((k) => [k, new Map<string, number>()])) as Record<Facet, Map<string, number>>;
  const { facets, rest } = compile(f);
  const active = Object.entries(facets) as [Facet, Test][];
  const bump = (facet: Facet, r: RecoViewRow) => {
    const m = out[facet];
    for (const v of valuesOf(r, facet)) m.set(v, (m.get(v) ?? 0) + 1);
  };
  for (const r of rows) {
    if (!rest(r)) continue;
    let failed: Facet | null = null;
    let fails = 0;
    for (const [facet, test] of active) {
      if (!test(r)) { fails += 1; failed = facet; if (fails > 1) break; }
    }
    if (fails === 0) for (const facet of FACETS) bump(facet, r);
    else if (fails === 1) bump(failed as Facet, r);
  }
  return out;
}

/** One facet's counts: value → rows that pass every filter except this facet's own. */
export const facetCounts = (rows: RecoViewRow[], f: RecoFilters, facet: Facet): Map<string, number> =>
  allFacetCounts(rows, f)[facet];

// ── Labels ──────────────────────────────────────────────────────────────────

const FAMILY_LABEL: Record<DocFamily, string> = {
  INV: 'Invoice', DN: 'Debit note', CN: 'Credit note', ISD: 'ISD credit', BOE: 'Bill of entry', OTHER: 'Other',
};
const FAMILY_ORDER: DocFamily[] = ['INV', 'DN', 'CN', 'ISD', 'BOE', 'OTHER'];
const SECTION_ORDER = ['B2B', 'B2BA', 'CDNR', 'CDNRA', 'ISD', 'ISDA', 'IMPG', 'IMPGSEZ', 'IMPGA', 'ECO', 'ECOA'];
const ITC_ORDER = ['available', 'not_available', 'rejected', 'reversal', 'unknown', 'none'];
const CONFIRMATION_ORDER = ['confirmed', 'not_confirmed', 'none'];

export const FACET_LABEL: Record<Facet, string> = {
  status: 'Status', reason: 'Reason', supplier: 'Supplier', period: 'Month', docType: 'Document type', section: 'Section',
  itc: 'ITC', rate: 'Rate', reverseCharge: 'Reverse charge', flag: 'Flag', confirmation: 'Confirmation',
};

/** "ITC in 2B": the facet's name for this pair of sources. */
export const facetName = (facet: Facet, data: Pick<RecoViewData, 'right'>): string =>
  facet === 'itc' ? `ITC in ${data.right.label}` : FACET_LABEL[facet];

const fmtRate = (n: number) => `${n}%`;

// Supplier and reason labels come from the rows; built once per data set.
const lookups = new WeakMap<RecoViewData, { suppliers: Map<string, { name: string; ctin: string }>; reasons: Map<string, string>; flags: Map<string, string> }>();
const lookupOf = (data: RecoViewData) => {
  let l = lookups.get(data);
  if (!l) {
    l = { suppliers: new Map(), reasons: new Map(), flags: new Map() };
    for (const r of data.rows) {
      const k = supplierKey(r);
      const s = l.suppliers.get(k);
      if (!s) l.suppliers.set(k, { name: r.supplierName, ctin: r.ctin });
      else if (!s.name && r.supplierName) s.name = r.supplierName;
      if (!l.reasons.has(reasonKey(r))) l.reasons.set(reasonKey(r), r.reasonLabel);
      for (const n of r.notes) if (!l.flags.has(n.code)) l.flags.set(n.code, n.label);
    }
    lookups.set(data, l);
  }
  return l;
};

/** The words for a facet value, as the filter bar, the chips and the export's Filter line print it. */
export function facetLabel(facet: Facet, value: string, data: RecoViewData): string {
  const L = data.left.label;
  const R = data.right.label;
  switch (facet) {
    case 'status': return statusLabel(value as RecoStatus, L, R);
    case 'reason': return lookupOf(data).reasons.get(value) ?? value.split('|')[1] ?? value;
    case 'supplier': {
      const s = lookupOf(data).suppliers.get(value);
      if (!s) return value.replace(/^~/, '');
      return s.name || s.ctin || 'Imports (no GSTIN)';
    }
    case 'period': return monthLabel(value);
    case 'docType': {
      const fam = value.replace(/A$/, '') as DocFamily;
      return `${FAMILY_LABEL[fam] ?? fam}${value.endsWith('A') && FAMILY_LABEL[fam] ? ' (amended)' : ''}`;
    }
    case 'section': return value || 'No section';
    case 'itc': return ({
      available: 'Available', not_available: 'Not available', rejected: 'Rejected in IMS', reversal: 'ITC reversal (Rule 37A)',
      unknown: 'Not stated', none: `Not in ${R}`,
    } as Record<string, string>)[value] ?? value;
    case 'rate': return value === 'none' ? 'No taxable value' : value === 'mixed' ? 'Mixed or non-standard' : fmtRate(Number(value));
    case 'reverseCharge': return value === 'yes' ? 'Yes' : 'No';
    case 'flag': return lookupOf(data).flags.get(value) ?? value;
    case 'confirmation': return value === 'confirmed' ? 'Confirmed' : value === 'not_confirmed' ? 'Not confirmed' : 'Needs no confirmation';
  }
}

export interface FacetOption {
  value: string;
  label: string;
  /** A second line (the supplier's GSTIN). */
  sub?: string;
  /** A heading the option sits under (a reason's status). */
  group?: string;
}

const pidx = (p: string): number => {
  const m = /^(\d{2})\/(\d{4})$/.exec(p || '');
  return m ? Number(m[2]) * 12 + Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const rank = (order: string[], v: string) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };

/** Every value a facet takes in the data, in the order a reader expects (status order, months in order, A to Z …). */
export function facetOptions(data: RecoViewData, facet: Facet): FacetOption[] {
  const values = new Set<string>();
  for (const r of data.rows) for (const v of valuesOf(r, facet)) values.add(v);
  if (facet === 'period') for (const p of data.periods) values.add(p);
  const opts = [...values].map((value): FacetOption => {
    const label = facetLabel(facet, value, data);
    if (facet === 'supplier') {
      const s = lookupOf(data).suppliers.get(value);
      return { value, label, sub: s?.ctin || undefined };
    }
    if (facet === 'reason') return { value, label, group: facetLabel('status', value.split('|')[0], data) };
    return { value, label };
  });
  const by = (f: (o: FacetOption) => number | string) => (a: FacetOption, b: FacetOption) => {
    const x = f(a); const y = f(b);
    return typeof x === 'number' && typeof y === 'number' ? x - y : TEXT.compare(String(x), String(y));
  };
  switch (facet) {
    case 'status': return opts.sort(by((o) => rank(STATUS_ORDER, o.value)));
    case 'reason': return opts.sort((a, b) => rank(STATUS_ORDER, a.value.split('|')[0]) - rank(STATUS_ORDER, b.value.split('|')[0]) || a.label.localeCompare(b.label));
    case 'supplier': return opts.sort((a, b) => NAME.compare(a.label || '￿', b.label || '￿') || (a.sub ?? '').localeCompare(b.sub ?? ''));
    case 'period': return opts.sort(by((o) => pidx(o.value)));
    case 'docType': return opts.sort(by((o) => rank(FAMILY_ORDER, o.value.replace(/A$/, '')) * 2 + (o.value.endsWith('A') ? 1 : 0)));
    case 'section': return opts.sort((a, b) => rank(SECTION_ORDER, a.value) - rank(SECTION_ORDER, b.value) || a.value.localeCompare(b.value));
    case 'itc': return opts.sort(by((o) => rank(ITC_ORDER, o.value)));
    case 'rate': return opts.sort(by((o) => (o.value === 'none' ? 1e6 : o.value === 'mixed' ? 1e5 : Number(o.value))));
    case 'reverseCharge': return opts.sort(by((o) => (o.value === 'yes' ? 0 : 1)));
    case 'flag': return opts.sort((a, b) => a.label.localeCompare(b.label));
    case 'confirmation': return opts.sort(by((o) => rank(CONFIRMATION_ORDER, o.value)));
  }
}

// ── Describing the filter (chips, the export's Filter line) ─────────────────

export type ChipKind = Facet | 'minDiff' | 'aboveTolerance' | 'dateFrom' | 'dateTo' | 'search';

export interface FilterChip {
  kind: ChipKind;
  /** The facet value the chip removes (facets only). */
  value?: string;
  /** "Status: Only in 2A". */
  label: string;
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoToDisplay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

/** One removable chip per selected value, then one per other filter. */
export function filterChips(f: RecoFilters, data: RecoViewData): FilterChip[] {
  const out: FilterChip[] = [];
  for (const facet of FACETS) {
    for (const value of f[facet]) out.push({ kind: facet, value, label: `${facetName(facet, data)}: ${facetLabel(facet, value, data)}` });
  }
  if (f.aboveTolerance !== null) out.push({ kind: 'aboveTolerance', label: `Differences above ₹${inr.format(f.aboveTolerance)}` });
  if (f.minDiff !== null && f.minDiff > 0) out.push({ kind: 'minDiff', label: `Tax difference at least ₹${inr.format(f.minDiff)}` });
  if (f.dateFrom) out.push({ kind: 'dateFrom', label: `Document date from ${isoToDisplay(f.dateFrom)}` });
  if (f.dateTo) out.push({ kind: 'dateTo', label: `Document date to ${isoToDisplay(f.dateTo)}` });
  if (f.search.trim()) out.push({ kind: 'search', label: `Search: "${f.search.trim()}"` });
  return out;
}

/** The filter state without one chip. */
export function removeChip(f: RecoFilters, chip: FilterChip): RecoFilters {
  switch (chip.kind) {
    case 'minDiff': return { ...f, minDiff: null };
    case 'aboveTolerance': return { ...f, aboveTolerance: null };
    case 'dateFrom': return { ...f, dateFrom: null };
    case 'dateTo': return { ...f, dateTo: null };
    case 'search': return { ...f, search: '' };
    default: return { ...f, [chip.kind]: f[chip.kind].filter((v) => v !== chip.value) };
  }
}

/** A long list is cut after a few names: "A, B, C and 4 more". */
const listOf = (xs: string[], max = 4): string => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);

/**
 * The filter in one line, for the identification strip of a filtered export:
 * "Status: Only in 2A, Only in 2B; Supplier: ALPHA TRADERS (24AAAPA0001A1Z1); …".
 * '' when nothing is filtered.
 */
export function describeFilters(f: RecoFilters, data: RecoViewData): string {
  const parts: string[] = [];
  for (const facet of FACETS) {
    const sel = f[facet];
    if (!sel.length) continue;
    const opts = facetOptions(data, facet);
    const order = (v: string) => { const i = opts.findIndex((o) => o.value === v); return i < 0 ? opts.length : i; };
    const labels = [...sel].sort((a, b) => order(a) - order(b)).map((v) => {
      const label = facetLabel(facet, v, data);
      if (facet !== 'supplier') return label;
      const ctin = lookupOf(data).suppliers.get(v)?.ctin;
      return ctin && ctin !== label ? `${label} (${ctin})` : label;
    });
    parts.push(`${facetName(facet, data)}: ${listOf(labels)}`);
  }
  if (f.aboveTolerance !== null) parts.push(`Differences above ₹${inr.format(f.aboveTolerance)}`);
  if (f.minDiff !== null && f.minDiff > 0) parts.push(`Tax difference at least ₹${inr.format(f.minDiff)}`);
  if (f.dateFrom && f.dateTo) parts.push(`Document date ${isoToDisplay(f.dateFrom)} to ${isoToDisplay(f.dateTo)}`);
  else if (f.dateFrom) parts.push(`Document date from ${isoToDisplay(f.dateFrom)}`);
  else if (f.dateTo) parts.push(`Document date up to ${isoToDisplay(f.dateTo)}`);
  if (f.search.trim()) parts.push(`Search: "${f.search.trim()}"`);
  return parts.join('; ');
}

// ── Presets ─────────────────────────────────────────────────────────────────

export type PresetKey = 'needs_action' | 'differences' | 'matched' | 'all';

export const PRESETS: { key: PresetKey; label: string; hint: string }[] = [
  { key: 'needs_action', label: 'Needs action', hint: 'Only on one side, or the figures or the ITC differ' },
  { key: 'differences', label: 'Differences only', hint: 'Taxable value or tax differs by more than the tolerance' },
  { key: 'matched', label: 'Matched', hint: 'Same on both sides' },
  { key: 'all', label: 'All', hint: 'Every document' },
];

/** Everything but matched and not compared. */
export const NEEDS_ACTION: RecoStatus[] = STATUS_ORDER.filter((s) => s !== 'matched' && s !== 'not_compared');

/** A preset replaces the whole filter state. */
export function presetFilters(key: PresetKey, tolerance: number): RecoFilters {
  switch (key) {
    case 'needs_action': return { ...EMPTY_FILTERS, status: [...NEEDS_ACTION] };
    case 'differences': return { ...EMPTY_FILTERS, aboveTolerance: tolerance };
    case 'matched': return { ...EMPTY_FILTERS, status: ['matched'] };
    case 'all': return { ...EMPTY_FILTERS };
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

/** The preset the filter state is exactly, or null once anything else is set. */
export function activePreset(f: RecoFilters, tolerance: number): PresetKey | null {
  for (const p of PRESETS) {
    const q = presetFilters(p.key, tolerance);
    const same = FACETS.every((k) => sameSet(f[k], q[k])) && (f.minDiff ?? 0) === (q.minDiff ?? 0) && f.aboveTolerance === q.aboveTolerance
      && (f.dateFrom || null) === q.dateFrom && (f.dateTo || null) === q.dateTo && f.search.trim() === q.search;
    if (same) return p.key;
  }
  return null;
}

// ── Sorting the document list ───────────────────────────────────────────────

export type SortKey =
  | 'period' | 'supplier' | 'docType' | 'number' | 'date' | 'section' | 'filedOn'
  | 'leftTaxable' | 'leftIgst' | 'leftCgst' | 'leftSgst' | 'leftCess' | 'leftTax'
  | 'rightTaxable' | 'rightIgst' | 'rightCgst' | 'rightSgst' | 'rightCess' | 'rightTax'
  | 'itc' | 'diffTaxable' | 'diffTax' | 'status' | 'reason';

export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

const statusRank = (s: RecoStatus) => STATUS_ORDER.indexOf(s);

/** The reader's order (and the Excel's): month, status, supplier (imports last), date, number. */
export const defaultOrder = (a: RecoViewRow, b: RecoViewRow): number =>
  pidx(a.period) - pidx(b.period)
  || statusRank(a.status) - statusRank(b.status)
  || NAME.compare(a.supplierName || '￿', b.supplierName || '￿')
  || (a.date ?? '').localeCompare(b.date ?? '')
  || NUMBERED.compare(a.number, b.number);

type SortValue = number | string | null;
const side = (r: RecoViewRow, s: 'left' | 'right', k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'tax'): SortValue => (r[s] ? (r[s] as NonNullable<RecoViewRow['left']>)[k] : null);

const SORT_VALUE: Record<SortKey, (r: RecoViewRow) => SortValue> = {
  period: (r) => pidx(r.period),
  supplier: (r) => r.supplierName || null,
  docType: (r) => r.docType,
  number: (r) => r.number,
  date: (r) => r.date,
  section: (r) => r.section,
  filedOn: (r) => r.left?.supplierFiledOn ?? r.right?.supplierFiledOn ?? null,
  leftTaxable: (r) => side(r, 'left', 'taxable'),
  leftIgst: (r) => side(r, 'left', 'igst'),
  leftCgst: (r) => side(r, 'left', 'cgst'),
  leftSgst: (r) => side(r, 'left', 'sgst'),
  leftCess: (r) => side(r, 'left', 'cess'),
  leftTax: (r) => side(r, 'left', 'tax'),
  rightTaxable: (r) => side(r, 'right', 'taxable'),
  rightIgst: (r) => side(r, 'right', 'igst'),
  rightCgst: (r) => side(r, 'right', 'cgst'),
  rightSgst: (r) => side(r, 'right', 'sgst'),
  rightCess: (r) => side(r, 'right', 'cess'),
  rightTax: (r) => side(r, 'right', 'tax'),
  itc: (r) => rank(ITC_ORDER, itcKey(r)),
  diffTaxable: (r) => (r.diff ? r.diff.taxable : null),
  diffTax: (r) => (r.diff ? r.diff.tax : null),
  status: (r) => statusRank(r.status),
  reason: (r) => r.reasonLabel,
};

/** Sorted copy: numbers by value, text A to Z (numbers inside it in numeric order); blanks last either way; ties in the reader's order. */
export function sortRows(rows: RecoViewRow[], sort: SortState | null): RecoViewRow[] {
  if (!sort) return [...rows].sort(defaultOrder);
  const get = SORT_VALUE[sort.key];
  const dir = sort.dir === 'asc' ? 1 : -1;
  const keyed = rows.map((r) => ({ r, v: get(r) }));
  keyed.sort((a, b) => {
    if (a.v === null || a.v === '') return b.v === null || b.v === '' ? defaultOrder(a.r, b.r) : 1;
    if (b.v === null || b.v === '') return -1;
    const c = typeof a.v === 'number' && typeof b.v === 'number'
      ? a.v - b.v
      : TEXT.compare(String(a.v), String(b.v));
    return c * dir || defaultOrder(a.r, b.r);
  });
  return keyed.map((k) => k.r);
}

/** Status buckets of the figures across the top: "Figures differ" takes in ITC differs. */
export const STATUS_BUCKETS: { key: string; statuses: RecoStatus[] }[] = [
  { key: 'matched', statuses: ['matched'] },
  { key: 'only_left', statuses: ['only_left'] },
  { key: 'only_right', statuses: ['only_right'] },
  { key: 'differs', statuses: ['differs', 'itc_differs'] },
  { key: 'not_compared', statuses: ['not_compared'] },
];
