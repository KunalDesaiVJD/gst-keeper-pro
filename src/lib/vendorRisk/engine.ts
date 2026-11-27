// Vendor GSTIN Risk Report: the engine. One client, one financial year: every
// supplier GSTIN seen in the year's portal GSTR-2A / 2B, Import 2B, the books
// register, the 2B ledgers and the uploaded vendor master, each assessed for
// registration, filing, e-invoice and ITC risk. Pure: plain data in, rows and
// a summary out; no Supabase, no clock (today is handed in), so
// scripts/verify-vendor-risk.mjs tests it under Node.
//
// Rules: a finding is made only from evidence and always names its source
// and date; missing data is "Verification required", never non-compliance;
// cancelled, composition, RCM and TDS / TCS vendors are "conditionally
// eligible" / "verify" with the provision, never blanket ineligible.
// Positions and thresholds: rules.ts, docs/VENDOR_GSTIN_RISK.md.
import type { ReasonCode, RecoDoc } from '@/lib/itcReco/types';
import { EINVOICE_THRESHOLD } from '@/lib/einvoice/threshold';
import { checkGstin, GSTIN_KIND_LABEL, normGstin, type GstinCheck } from './gstin';
import {
  BAND_LABEL, BAND_RANK, FINDINGS, MATERIAL_FLOOR, MATERIAL_SHARE, MATERIAL_TAX, NAME_MATCH_MIN, PERSISTENT_MISSING,
  STALE_LOOKUP_DAYS, type FindingCode, type RiskBand, type RiskNature,
} from './rules';

// ── Input ───────────────────────────────────────────────────────────────────

export interface FilingLite {
  rtntype: string;
  fy?: string | null;
  taxp?: string | null;
  dof?: string | null;
  status?: string | null;
  mof?: string | null;
}

/** One row of vendor_gstin_latest. */
export interface LookupLite {
  gstin: string;
  status: 'ok' | 'not_found';
  /** ISO timestamp. */
  lookedUpAt: string;
  source: string | null;
  legalName: string | null;
  tradeName: string | null;
  regStatus: string | null;
  regDate: string | null;
  cancelDate: string | null;
  cancelReason: string | null;
  taxpayerType: string | null;
  constitution: string | null;
  natureOfBusiness: string[] | null;
  atoSlab: string | null;
  einvoiceStatus: string | null;
  filings: FilingLite[] | null;
}

export interface StatementInfo {
  source: '2A' | '2B';
  /** 'MM/YYYY'. */
  period: string;
  state: 'ready' | 'not_pulled' | 'not_generated' | 'failed';
  /** ISO date the statement was pulled. */
  pulledAt: string | null;
}

export interface ImportDocLite { gstin: string; name: string | null; period: string; number: string | null; tax: number; irn: string | null }
export interface BookLite { id: string; gstin: string; name: string | null; period: string; number: string | null; docType: string | null; date: string | null; tax: number }
export interface LedgerLite { gstin: string; name: string | null; tax: number }
export interface MasterLite { gstin: string; name: string | null; code: string | null }

/** One row of a month's GSTR-2A vs 2B reconciliation, reduced to what the vendor view needs. */
export interface RecoFinding { ctin: string; period: string; reason: ReasonCode; notes: ReasonCode[]; tax: number }

export interface VendorRiskInput {
  client: { name: string; gstin: string | null };
  /** '2025-26'. */
  fy: string;
  /** ISO date, IST. */
  today: string;
  statements: StatementInfo[];
  /** Documents of the FY's 2A / 2B statements (April to March). */
  docs2A: RecoDoc[];
  docs2B: RecoDoc[];
  importDocs: ImportDocLite[];
  books: BookLite[];
  /** The open items of the 2B ledgers at `ledgerAsOf` (the FY's latest month holding any). */
  ledgerAsOf: string | null;
  notIn2B: LedgerLite[];
  notInBooks: LedgerLite[];
  /** The months whose 2A vs 2B reconciliation ran, and its rows. */
  recoPeriods: string[];
  reco: RecoFinding[];
  master: MasterLite[];
  masterFile: { fileName: string | null; uploadedAt: string | null } | null;
  /** null: the lookups view is not there (migration not applied); [] : no lookups yet. */
  lookups: LookupLite[] | null;
}

// ── Output ──────────────────────────────────────────────────────────────────

export const COLUMNS = [
  'Vendor Name', 'GSTIN', 'State', 'GST Registration Status', 'Registration Date', 'Cancellation/Suspension Date',
  'Cancellation Reason', 'Taxpayer Type', 'Composition Scheme (Yes/No)', 'RCM Applicability Indicator', 'GST TDS/TCS Status',
  'E-Invoice Applicable (Yes/No)', 'E-Invoice Enablement Status', 'E-Invoice Risk (Yes/No)', 'GSTR-1 Filing Status',
  'GSTR-3B Filing Status', 'Last Return Filing Date', 'GSTR-2B Availability/Matching Status', 'ITC Eligibility Status',
  'ITC Risk Category', 'Reason for ITC Risk', 'Relevant GST Section/Rule/Notification', 'Recommended Corrective Action',
  'Date of Verification', 'Data Source', 'Remarks',
] as const;

export interface Finding {
  code: FindingCode;
  /** The specific sentence: counts, dates. */
  detail: string;
  /** Where it comes from, with its date: "GST portal Search Taxpayer (27-Nov-2026)". */
  source: string;
  /** Overrides the rule's nature (e.g. a retrospective cancellation read from 2A only). */
  nature?: RiskNature;
  /** Overrides the rule's band (an invalid GSTIN with no ITC booked). */
  band?: RiskBand;
}

export type YesNo = 'Yes' | 'No' | 'Verification required';

export interface VendorRow {
  gstin: string;
  name: string;
  band: RiskBand;
  nature: RiskNature | null;
  findings: Finding[];
  check: GstinCheck;
  regState: 'active' | 'cancelled' | 'suspended' | 'other' | 'not_found' | 'unknown';
  composition: YesNo;
  einvApplicable: YesNo;
  einvRisk: YesNo;
  einvNotEnabled: boolean;
  /** ITC at stake for the year: the vendor's ITC in 2B (available), else in the books. */
  itc: number;
  lookedUp: boolean;
  cells: Record<(typeof COLUMNS)[number], string>;
}

export interface SummaryLine { label: string; count: number; itc: number | null; note: string }

export interface VendorRiskResult {
  rows: VendorRow[];
  summary: SummaryLine[];
  bands: Record<RiskBand, number>;
  sources: string[];
  notes: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES: Record<string, number> = {
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12,
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const r2 = (n: number) => Math.round(n * 100) / 100;
const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rupees = (n: number) => `₹${INR.format(r2(n))}`;

/** Any date the portal or the app writes → ISO, or null. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2}|\d{4})$/.exec(s);
  if (m && MONTH_NAMES[m[2].toUpperCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad2(MONTH_NAMES[m[2].toUpperCase()])}-${pad2(+m[1])}`;
  return null;
}
/** ISO → "27-Nov-2026". */
export const dmy = (iso: string | null | undefined): string => {
  const d = isoDate(iso ?? '');
  return d ? `${d.slice(8, 10)}-${MON[+d.slice(5, 7) - 1]}-${d.slice(0, 4)}` : '';
};
const periodLabel = (p: string) => `${MON[+p.slice(0, 2) - 1] ?? '?'} ${p.slice(3)}`;
const pIdx = (p: string) => +p.slice(3) * 12 + +p.slice(0, 2) - 1;
const pFrom = (i: number) => `${pad2((i % 12) + 1)}/${Math.floor(i / 12)}`;
const fyStart = (fy: string) => +fy.slice(0, 4);
export const fyPeriods = (fy: string): string[] => Array.from({ length: 12 }, (_, i) => pFrom(fyStart(fy) * 12 + 3 + i));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const dueOn = (period: string, monthsAfter: number, day: number) => { const p = pFrom(pIdx(period) + monthsAfter); return `${p.slice(3)}-${p.slice(0, 2)}-${pad2(day)}`; };
const listPeriods = (ps: string[], max = 4) => {
  const sorted = [...new Set(ps)].sort((a, b) => pIdx(a) - pIdx(b));
  return sorted.length <= max ? sorted.map(periodLabel).join(', ') : `${sorted.slice(0, max).map(periodLabel).join(', ')} and ${sorted.length - max} more`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const docTax = (d: RecoDoc) => (d.family === 'CN' ? -1 : 1) * (d.igst + d.cgst + d.sgst + d.cess);
const normNo = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+(?=\d)/, '');

// Name comparison: case, punctuation and the usual legal suffixes do not count.
const NAME_NOISE = /\b(M\/S|MESSRS|THE|PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|AND|INC|CORP|CORPORATION|ENTERPRISES?|TRADERS?|INDIA|OPC)\b/g;
const nameTokens = (s: string) => new Set(s.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9/ ]/g, ' ').replace(NAME_NOISE, ' ').split(/\s+/).filter((t) => t.length > 1));
/** Token overlap of two names, 0 to 1 (1 when one name's words all sit in the other). */
export function nameSimilarity(a: string, b: string): number {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.size || !y.size) return 1;
  let common = 0;
  for (const t of x) if (y.has(t)) common += 1;
  return common / Math.min(x.size, y.size);
}

// ── Filing table ────────────────────────────────────────────────────────────

const normFy = (fy: string | null | undefined): string | null => {
  const m = /(20\d{2})\s*[-–/]\s*(\d{2,4})/.exec(fy ?? '');
  return m ? `${m[1]}-${String(+m[1] + 1).slice(-2)}` : null;
};
/** A filing's tax period → 'MM/YYYY'; a quarter gives its last month. */
function filingPeriod(f: FilingLite, fy: string): string | null {
  const t = (f.taxp ?? '').trim().toUpperCase();
  const start = fyStart(normFy(f.fy) ?? fy);
  const ofMonth = (m: number) => `${pad2(m)}/${m >= 4 ? start : start + 1}`;
  let m = /^(\d{2})[/-]?(\d{4})$/.exec(t);
  if (m) return `${m[1]}/${m[2]}`;
  if (MONTH_NAMES[t]) return ofMonth(MONTH_NAMES[t]);
  m = /^Q(?:UARTER)?\s*([1-4])$/.exec(t);
  if (m) return ofMonth([6, 9, 12, 3][+m[1] - 1]);
  m = /^([A-Z]{3,9})\s*[-–]\s*([A-Z]{3,9})$/.exec(t);
  if (m && MONTH_NAMES[m[2]]) return ofMonth(MONTH_NAMES[m[2]]);
  return null;
}

export interface FilingAnalysis {
  state: 'no_data' | 'ok';
  quarterly: boolean;
  filed: string[];
  missing: string[];
  late: { period: string; dof: string; due: string }[];
  lastFiled: string | null;
  due: string[];
}

/**
 * One return type's filing in the FY, from the portal's filing table. Judged
 * only when the table holds the FY at all (any return type); periods are due
 * once their due date has passed. A vendor whose filings are all quarter-end
 * months is read as a quarterly (QRMP) filer: an inference.
 */
export function analyseFilings(filings: FilingLite[] | null, fy: string, today: string, rtn: 'GSTR1' | 'GSTR3B'): FilingAnalysis {
  const none: FilingAnalysis = { state: 'no_data', quarterly: false, filed: [], missing: [], late: [], lastFiled: null, due: [] };
  if (!filings?.length) return none;
  const months = new Set(fyPeriods(fy));
  const inFy = filings.filter((f) => {
    const nf = normFy(f.fy);
    if (nf) return nf === fy;
    const p = filingPeriod(f, fy);
    return !!p && months.has(p);
  });
  if (!inFy.length) return none;
  const isRtn = (f: FilingLite) => {
    const t = f.rtntype.toUpperCase().replace(/[\s-]/g, '');
    return rtn === 'GSTR1' ? t === 'GSTR1' || t === 'GSTR1Q' : t === 'GSTR3B' || t === 'GSTR3BQ';
  };
  const isFiled = (f: FilingLite) => !f.status || /filed/i.test(f.status) && !/not\s*filed/i.test(f.status);
  const mine = inFy.filter((f) => isRtn(f) && isFiled(f));
  const byPeriod = new Map<string, string | null>();
  for (const f of mine) {
    const p = filingPeriod(f, fy);
    if (!p || !months.has(p)) continue;
    const dof = isoDate(f.dof ?? '');
    const cur = byPeriod.get(p);
    if (cur === undefined || (dof && (!cur || dof < cur))) byPeriod.set(p, dof);
  }
  const filed = [...byPeriod.keys()];
  const quarterly = filed.length > 0 && filed.every((p) => [3, 6, 9, 12].includes(+p.slice(0, 2)));
  const dueOf = (p: string) => (rtn === 'GSTR1' ? (quarterly ? dueOn(p, 1, 13) : dueOn(p, 1, 11)) : quarterly ? dueOn(p, 1, 24) : dueOn(p, 1, 20));
  const periods = fyPeriods(fy).filter((p) => !quarterly || [3, 6, 9, 12].includes(+p.slice(0, 2)));
  const due = periods.filter((p) => dueOf(p) < today);
  const late = filed.flatMap((p) => { const dof = byPeriod.get(p); return dof && dof > dueOf(p) ? [{ period: p, dof, due: dueOf(p) }] : []; });
  const dofs = [...byPeriod.values()].filter((d): d is string => !!d).sort();
  return { state: 'ok', quarterly, filed, missing: due.filter((p) => !byPeriod.has(p)), late, lastFiled: dofs[dofs.length - 1] ?? null, due };
}

// ── E-invoice ───────────────────────────────────────────────────────────────

/** The portal's aggregate turnover slab ("Slab: Rs. 5 Cr. to 25 Cr.") → rupee bounds, or null. */
export function parseSlab(slab: string | null | undefined): { lo: number; hi: number | null } | null {
  if (!slab) return null;
  // The extension appends the slab's year, "(FY 2024-25)": not a bound.
  const s = slab.replace(/\(?\s*F\.?Y\.?\s*\d{4}\s*[-–/]\s*\d{2,4}\s*\)?/gi, ' ').replace(/,/g, '');
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakhs?|lacs?|l)?\.?/gi)]
    .map((m) => +m[1] * (/^cr/i.test(m[2] ?? '') ? 1e7 : /^(lakh|lac|l)/i.test(m[2] ?? '') ? 1e5 : 1));
  if (!nums.length) return null;
  if (/above|more than|and above|\+/i.test(s) && nums.length === 1) return { lo: nums[0], hi: null };
  if (/upto|up to|below|less than/i.test(s) && nums.length === 1) return { lo: 0, hi: nums[0] };
  return { lo: nums[0], hi: nums[1] ?? null };
}

// ── The engine ──────────────────────────────────────────────────────────────

interface Bag {
  gstin: string;
  names: { master?: string; books: string[]; twoB: string[]; twoA: string[]; imp: string[] };
  code: string | null;
  in2A: RecoDoc[];
  in2B: RecoDoc[];
  imp: ImportDocLite[];
  books: BookLite[];
  notIn2B: LedgerLite[];
  notInBooks: LedgerLite[];
  reco: RecoFinding[];
  inMaster: boolean;
}

const mostCommon = (xs: string[]): string | null => {
  const c = new Map<string, number>();
  for (const x of xs) if (x?.trim()) c.set(x.trim(), (c.get(x.trim()) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of c) if (best === null || n > (c.get(best) ?? 0)) best = k;
  return best;
};

export function assessVendors(input: VendorRiskInput): VendorRiskResult {
  const { fy, today } = input;
  const fyMonths = new Set(fyPeriods(fy));
  const bags = new Map<string, Bag>();
  const bag = (raw: string): Bag | null => {
    const g = normGstin(raw);
    if (!g) return null;
    let b = bags.get(g);
    if (!b) {
      b = { gstin: g, names: { books: [], twoB: [], twoA: [], imp: [] }, code: null, in2A: [], in2B: [], imp: [], books: [], notIn2B: [], notInBooks: [], reco: [], inMaster: false };
      bags.set(g, b);
    }
    return b;
  };
  for (const d of input.docs2B) { const b = d.ctin ? bag(d.ctin) : null; if (b) { b.in2B.push(d); if (d.supplierName) b.names.twoB.push(d.supplierName); } }
  for (const d of input.docs2A) { const b = d.ctin ? bag(d.ctin) : null; if (b) { b.in2A.push(d); if (d.supplierName) b.names.twoA.push(d.supplierName); } }
  for (const d of input.importDocs) { const b = bag(d.gstin); if (b) { b.imp.push(d); if (d.name) b.names.imp.push(d.name); } }
  for (const d of input.books) { const b = bag(d.gstin); if (b) { b.books.push(d); if (d.name) b.names.books.push(d.name); } }
  for (const d of input.notIn2B) { const b = bag(d.gstin); if (b) { b.notIn2B.push(d); if (d.name) b.names.books.push(d.name); } }
  for (const d of input.notInBooks) { const b = bag(d.gstin); if (b) b.notInBooks.push(d); }
  for (const r of input.reco) { const b = bags.get(normGstin(r.ctin)); if (b) b.reco.push(r); }
  for (const m of input.master) {
    const b = bag(m.gstin);
    if (!b) continue;
    b.inMaster = true;
    if (m.name) b.names.master = m.name;
    if (m.code) b.code = m.code;
  }
  // The client's own GSTIN is not a vendor (an ISD or own-branch entry would be another GSTIN).
  const own = normGstin(input.client.gstin ?? '');
  if (own) bags.delete(own);

  const lookups = new Map((input.lookups ?? []).map((l) => [normGstin(l.gstin), l]));
  const viewMissing = input.lookups === null;

  // Statement coverage, for sources and "not pulled" sentences.
  const ready = (s: '2A' | '2B') => input.statements.filter((x) => x.source === s && x.state === 'ready' && fyMonths.has(x.period));
  const pulledOn = (s: '2A' | '2B') => { const ds = ready(s).map((x) => x.pulledAt).filter((d): d is string => !!d).sort(); return ds[ds.length - 1] ?? null; };
  const src2A = ready('2A').length ? `GSTR-2A (portal pull, ${ready('2A').length} of 12 months, last pulled ${dmy(pulledOn('2A')) || 'date not recorded'})` : null;
  const src2B = ready('2B').length ? `GSTR-2B (portal pull, ${ready('2B').length} of 12 months, last pulled ${dmy(pulledOn('2B')) || 'date not recorded'})` : null;
  const twoBMissing = fyPeriods(fy).filter((p) => dueOn(p, 1, 14) <= today && !ready('2B').some((x) => x.period === p));
  const srcLedger = input.ledgerAsOf ? `Bills not in 2B / not in books ledger (as of ${periodLabel(input.ledgerAsOf)})` : null;
  const srcMaster = input.masterFile ? `Vendor master (upload${input.masterFile.fileName ? ` ${input.masterFile.fileName}` : ''}, ${dmy(input.masterFile.uploadedAt) || 'date not recorded'})` : null;
  const srcReco = input.recoPeriods.length ? `GSTR-2A vs 2B reconciliation (${plural(input.recoPeriods.length, 'month')})` : null;
  const srcCheck = `GSTIN check digit (computed ${dmy(today)})`;

  const allPans = new Map<string, string[]>();
  for (const g of bags.keys()) { const c = checkGstin(g); if (c.pan) allPans.set(c.pan, [...(allPans.get(c.pan) ?? []), g]); }

  const rows: VendorRow[] = [];
  for (const b of bags.values()) {
    const check = checkGstin(b.gstin);
    const lk = lookups.get(b.gstin) ?? null;
    const lkSrc = lk ? `GST portal Search Taxpayer (${dmy(lk.lookedUpAt)})` : '';
    const findings: Finding[] = [];
    const add = (code: FindingCode, detail: string, source: string, extra: Partial<Finding> = {}) => findings.push({ code, detail, source, ...extra });
    const remarks: string[] = [];
    const sources = new Set<string>();
    if (b.in2A.length && src2A) sources.add(src2A);
    if (b.in2B.length && src2B) sources.add(src2B);
    if (b.imp.length) sources.add('Import 2B');
    if (b.books.length) sources.add('Books register');
    if ((b.notIn2B.length || b.notInBooks.length) && srcLedger) sources.add(srcLedger);
    if (b.reco.length && srcReco) sources.add(srcReco);
    if (b.inMaster && srcMaster) sources.add(srcMaster);
    if (lk) sources.add(lkSrc);
    sources.add(srcCheck);

    // Documents, each once: the 2B copy first, then the 2A's.
    const seen = new Set<string>();
    const docs: RecoDoc[] = [];
    for (const d of [...b.in2B, ...b.in2A]) {
      if (d.bucket === 'reversal') continue;
      const k = `${d.family}|${normNo(d.number)}|${d.isAmendment ? 'A' : ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      docs.push(d);
    }
    const itc2B = r2(b.in2B.filter((d) => d.bucket === 'available').reduce((s, d) => s + docTax(d), 0));
    const booksTax = r2(b.books.reduce((s, d) => s + d.tax, 0));
    const itc = itc2B || booksTax;
    const datedDocs = [
      ...docs.filter((d) => d.date).map((d) => ({ date: d.date as string, tax: docTax(d), from: d.source === '2B' ? 'GSTR-2B' : 'GSTR-2A' })),
      ...b.books.filter((d) => d.date && !docs.some((x) => normNo(x.number) === normNo(d.number))).map((d) => ({ date: isoDate(d.date) as string, tax: d.tax, from: 'books' })),
    ].filter((d) => d.date);

    // 1. The GSTIN itself.
    if (!check.valid) {
      add('INVALID_GSTIN', `GSTIN ${check.problem}`, srcCheck, booksTax > 0 || docs.length ? {} : { band: 'Medium', nature: 'Confirmed' });
    } else if (check.kind === 'tds' || check.kind === 'tcs') {
      add('TDS_TCS_REGISTRATION', GSTIN_KIND_LABEL[check.kind], `GSTIN structure (${dmy(today)})`, check.kind === 'tcs' ? { nature: 'Verification required' } : {});
    } else if (check.kind !== 'normal') {
      add('SPECIAL_REGISTRATION', GSTIN_KIND_LABEL[check.kind], `GSTIN structure (${dmy(today)})`);
    }

    // 2. Registration (the portal lookup; else what 2A says).
    let regState: VendorRow['regState'] = 'unknown';
    const cancelled2A = [...b.in2A].map((d) => d.supplierCancelledFrom).filter((d): d is string => !!d).sort()[0] ?? null;
    const cancelled2AFrom = cancelled2A ? b.in2A.find((d) => d.supplierCancelledFrom === cancelled2A)?.statementPeriod ?? null : null;
    if (lk?.status === 'not_found') {
      regState = 'not_found';
      add('NOT_FOUND_ON_PORTAL', 'The portal search answered that no taxpayer holds this GSTIN', lkSrc);
    } else if (lk) {
      const st = lk.regStatus ?? '';
      regState = /cancel/i.test(st) ? 'cancelled' : /suspend/i.test(st) ? 'suspended' : /^active/i.test(st.trim()) ? 'active' : 'other';
      const effective = isoDate(lk.cancelDate ?? '');
      if (regState === 'cancelled') {
        const after = effective ? datedDocs.filter((d) => d.date >= effective) : [];
        if (after.length) {
          add('CANCELLED_RETRO', `${plural(after.length, 'document')} dated on or after the effective date ${dmy(effective)} (tax ${rupees(after.reduce((s, d) => s + d.tax, 0))}; from ${[...new Set(after.map((d) => d.from))].join(', ')})`, lkSrc);
        } else {
          add('CANCELLED', `Cancelled${effective ? ` with effect from ${dmy(effective)}` : ' (effective date not shown)'}; ${datedDocs.length ? 'every document of the year is dated before it' : 'no dated documents in the year'}`, lkSrc);
        }
      } else if (regState === 'suspended') {
        add('SUSPENDED', `Suspended${effective ? ` from ${dmy(effective)}` : ''}`, lkSrc);
        const after = effective ? datedDocs.filter((d) => d.date >= effective) : [];
        if (after.length) add('SUSPENDED_INVOICES', `${plural(after.length, 'document')} dated on or after ${dmy(effective)} (tax ${rupees(after.reduce((s, d) => s + d.tax, 0))})`, lkSrc);
      } else if (regState === 'other') {
        add('STATUS_OTHER', `The portal shows the status "${st || 'blank'}"`, lkSrc);
      }
      if (regState === 'active' && cancelled2A) remarks.push(`GSTR-2A of ${periodLabel(cancelled2AFrom ?? '')} showed a cancellation date ${dmy(cancelled2A)}; the portal now shows Active (revoked?).`);
      const age = daysBetween(isoDate(lk.lookedUpAt) ?? today, today);
      if (age > STALE_LOOKUP_DAYS) add('STALE_LOOKUP', `Looked up ${age} days ago`, lkSrc);
      if (/deductor|collector/i.test(lk.taxpayerType ?? '') && !findings.some((f) => f.code === 'TDS_TCS_REGISTRATION')) {
        add('TDS_TCS_REGISTRATION', `The portal shows taxpayer type "${lk.taxpayerType}"`, lkSrc);
      }
    } else {
      if (cancelled2A) {
        const after = datedDocs.filter((d) => d.date >= cancelled2A);
        add('CANCELLED_2A', `GSTR-2A of ${periodLabel(cancelled2AFrom ?? '')} gives the cancellation date ${dmy(cancelled2A)}${after.length ? `; ${plural(after.length, 'document')} dated on or after it` : ''}`, src2A ?? 'GSTR-2A');
        regState = 'cancelled';
      }
      add('NO_LOOKUP', viewMissing ? 'Portal lookups are not available yet (the lookups table is not set up)' : 'No portal lookup of this GSTIN yet', '-');
    }

    // 3. Composition (portal lookup only: the GSTIN does not show it).
    let composition: YesNo = 'Verification required';
    if (lk?.status === 'ok') {
      composition = /composition/i.test(lk.taxpayerType ?? '') ? 'Yes' : 'No';
      if (composition === 'Yes') {
        const taxed = docs.filter((d) => docTax(d) > 0);
        if (taxed.length || booksTax > 0) {
          add('COMPOSITION_TAX_CHARGED', `Taxpayer type "${lk.taxpayerType}"; ${taxed.length ? `${plural(taxed.length, 'document')} in 2A / 2B show tax ${rupees(taxed.reduce((s, d) => s + docTax(d), 0))}` : ''}${taxed.length && booksTax > 0 ? '; ' : ''}${booksTax > 0 ? `books show tax ${rupees(booksTax)}` : ''}`, lkSrc);
        } else add('COMPOSITION', `Taxpayer type "${lk.taxpayerType}"`, lkSrc);
      }
    }

    // 4. Filing: the portal filing table, else what 2A / 2B say.
    // Returns fall due only while registered: a cancelled vendor's periods after the effective date are not due.
    const effectiveIso = regState === 'cancelled' ? isoDate(lk?.cancelDate ?? '') : null;
    const filingUpTo = effectiveIso && effectiveIso < today ? effectiveIso : today;
    const f1 = lk ? analyseFilings(lk.filings, fy, filingUpTo, 'GSTR1') : null;
    const f3 = lk ? analyseFilings(lk.filings, fy, filingUpTo, 'GSTR3B') : null;
    const filingText = (fa: FilingAnalysis | null, name: string): string | null => {
      if (!fa || fa.state === 'no_data') return null;
      const parts = [`Filed ${fa.filed.length} of ${fa.due.length} due (${fa.quarterly ? 'quarterly' : 'monthly'})`];
      if (fa.missing.length) parts.push(`not filed: ${listPeriods(fa.missing)}`);
      if (fa.late.length) parts.push(`${fa.late.length} late`);
      return `${parts.join('; ')} [${name}, ${lkSrc}]`;
    };
    for (const [fa, name] of [[f3, 'GSTR-3B'], [f1, 'GSTR-1']] as const) {
      if (!fa || fa.state === 'no_data') continue;
      if (fa.missing.length >= PERSISTENT_MISSING) add('NON_FILING_PERSISTENT', `${name} not filed for ${listPeriods(fa.missing)}`, lkSrc);
      else if (fa.missing.length) add('NON_FILING', `${name} not filed for ${listPeriods(fa.missing)}`, lkSrc);
      if (fa.late.length) add('DELAYED_FILING', `${name} filed late for ${plural(fa.late.length, 'period')} (e.g. ${periodLabel(fa.late[0].period)}: due ${dmy(fa.late[0].due)}, filed ${dmy(fa.late[0].dof)})`, lkSrc);
    }
    if (lk && (!f3 || f3.state === 'no_data') && (!f1 || f1.state === 'no_data')) add('FILING_DATA_MISSING', `The lookup of ${dmy(lk.lookedUpAt)} holds no filing for FY ${fy}`, lkSrc);

    // From 2A / 2B: periods the vendor filed GSTR-1 / IFF for, and its GSTR-3B per 2A.
    const filedPeriods = new Set(docs.filter((d) => d.supplierFiled && d.supplierPeriod).map((d) => d.supplierPeriod as string));
    const threeBPending = [...new Set(b.in2A.filter((d) => d.supplier3bFiled === false).map((d) => d.statementPeriod))];
    const threeBFiled = [...new Set(b.in2A.filter((d) => d.supplier3bFiled === true).map((d) => d.statementPeriod))];
    const lastFiled2AB = docs.map((d) => d.supplierFiledOn).filter((d): d is string => !!d).sort().pop() ?? null;
    const notFiled = b.reco.filter((r) => r.reason === 'NOT_FILED_BY_SUPPLIER');
    if (notFiled.length) add('NOT_FILED_GSTR1', `${plural(notFiled.length, 'document')} in ${listPeriods(notFiled.map((r) => r.period))}`, srcReco ?? 'GSTR-2A');
    if (threeBPending.length && !(f3 && f3.state === 'ok')) add('SUPPLIER_3B_PENDING', `GSTR-2A of ${listPeriods(threeBPending)} (cfs3b = N)`, src2A ?? 'GSTR-2A');
    const lateReco = b.reco.filter((r) => r.reason === 'IN_LATER_2B' || r.reason === 'EXPECTED_NEXT_2B' || r.reason === 'EARLIER_PERIOD');
    if (lateReco.length && !(f1 && f1.state === 'ok')) {
      add('DELAYED_FILING', `${plural(lateReco.length, 'document')} filed after the 2B cut-off (${listPeriods(lateReco.map((r) => r.period))})`, srcReco ?? 'GSTR-2A vs 2B', { nature: 'Potential risk' });
    }

    // 5. 2B: reversals, ITC not available, value differences, the ledgers, books not in 2B.
    const reversals = b.in2B.filter((d) => d.bucket === 'reversal');
    if (reversals.length) add('RULE_37A_REVERSAL', `${plural(reversals.length, 'entry', 'entries')} (tax ${rupees(Math.abs(reversals.reduce((s, d) => s + d.igst + d.cgst + d.sgst + d.cess, 0)))}) in ${listPeriods(reversals.map((d) => d.statementPeriod))}`, src2B ?? 'GSTR-2B');
    const notAvail = b.in2B.filter((d) => d.bucket === 'not_available');
    if (notAvail.length) add('ITC_NOT_AVAILABLE_2B', `${plural(notAvail.length, 'document')} (tax ${rupees(notAvail.reduce((s, d) => s + docTax(d), 0))})`, src2B ?? 'GSTR-2B');
    const valueDiff = b.reco.filter((r) => r.reason === 'VALUE_DIFFERENCE');
    if (valueDiff.length) add('VALUE_DIFFERENCE', `${plural(valueDiff.length, 'document')} in ${listPeriods(valueDiff.map((r) => r.period))}`, srcReco ?? 'GSTR-2A vs 2B');
    const openTax = r2(b.notIn2B.reduce((s, d) => s + d.tax, 0));
    if (b.notIn2B.length) {
      const material = openTax >= MATERIAL_TAX || (openTax >= MATERIAL_FLOOR && booksTax > 0 && openTax >= MATERIAL_SHARE * booksTax);
      add(material ? 'MISMATCH_MATERIAL' : 'MISMATCH_MINOR', `${plural(b.notIn2B.length, 'open entry', 'open entries')} not in 2B, tax ${rupees(openTax)}${booksTax > 0 ? ` (${Math.round((openTax / booksTax) * 100)}% of the year's ITC in the books)` : ''}`, srcLedger ?? 'Bills not in 2B');
    }
    if (!docs.length && !b.in2B.length && booksTax > 0 && ready('2B').length) {
      add('BOOKS_NOT_IN_2B', `Books show tax ${rupees(booksTax)} on ${plural(b.books.length, 'entry', 'entries')}; the vendor is in none of the ${plural(ready('2B').length, 'GSTR-2B')} pulled${twoBMissing.length ? ` (${plural(twoBMissing.length, 'month')} not pulled: ${listPeriods(twoBMissing)})` : ''}`, `Books register; ${src2B}`, twoBMissing.length ? { nature: 'Verification required' } : {});
    }
    const nibTax = r2(b.notInBooks.reduce((s, d) => s + d.tax, 0));
    if (b.notInBooks.length) add('NOT_IN_BOOKS', `${plural(b.notInBooks.length, 'open entry', 'open entries')}, tax ${rupees(nibTax)}`, srcLedger ?? 'Bills not in books');
    const byNo = new Map<string, BookLite[]>();
    for (const d of b.books) { const k = `${(d.docType ?? '').toUpperCase()}|${normNo(d.number)}`; if (normNo(d.number)) byNo.set(k, [...(byNo.get(k) ?? []), d]); }
    const dups = [...byNo.values()].filter((xs) => new Set(xs.map((x) => x.id)).size > 1);
    if (dups.length) add('DUPLICATE_BOOKING', `${plural(dups.length, 'invoice number')} booked more than once (e.g. ${dups[0][0].number} in ${listPeriods(dups[0].map((x) => x.period))})`, 'Books register');

    // 6. E-invoice.
    const b2b = docs.filter((d) => (d.section === 'B2B' || d.section === 'CDNR') && (d.family === 'INV' || d.family === 'DN' || d.family === 'CN'));
    const b2bImp = b.imp.filter((d) => !docs.some((x) => normNo(x.number) === normNo(d.number)));
    const withIrn = b2b.filter((d) => d.irn).length + b2bImp.filter((d) => d.irn).length;
    const totalB2b = b2b.length + b2bImp.length;
    const firstIrnDate = b2b.filter((d) => d.irn && d.date).map((d) => d.date as string).sort()[0] ?? null;
    const slab = parseSlab(lk?.atoSlab);
    const exempt = lk && (/sez\s*unit/i.test(lk.taxpayerType ?? '') || /government|local authority/i.test(lk.constitution ?? ''));
    const portalEnabled = lk?.einvoiceStatus ? /yes|enabled|applicable|active/i.test(lk.einvoiceStatus) && !/not|no\b/i.test(lk.einvoiceStatus) : null;
    let einvApplicable: YesNo = 'Verification required';
    let einvBasis = '';
    let einvConfirmed = false;
    if (exempt) { einvApplicable = 'No'; einvBasis = `exempt class (${lk?.taxpayerType || lk?.constitution})`; }
    else if (portalEnabled === true || (slab && slab.lo >= EINVOICE_THRESHOLD)) {
      einvApplicable = 'Yes'; einvConfirmed = true;
      einvBasis = portalEnabled ? `portal shows e-invoice "${lk?.einvoiceStatus}"` : `aggregate turnover slab "${lk?.atoSlab}"`;
    } else if (withIrn > 0) { einvApplicable = 'Yes'; einvBasis = `IRN on ${withIrn} of ${totalB2b} B2B documents`; }
    else if (slab && slab.hi !== null && slab.hi <= EINVOICE_THRESHOLD) { einvApplicable = 'No'; einvBasis = `aggregate turnover slab "${lk?.atoSlab}" (the latest year shown; an earlier year above ₹5 crore would still apply)`; }
    const from = einvConfirmed ? `${fyStart(fy)}-04-01` : firstIrnDate;
    const noIrn = einvApplicable === 'Yes' ? b2b.filter((d) => !d.irn && (!from || !d.date || d.date >= from)) : [];
    const einvRisk: YesNo = einvApplicable === 'Yes' ? (noIrn.length ? 'Yes' : 'No') : einvApplicable === 'No' ? 'No' : totalB2b ? 'Verification required' : 'No';
    if (noIrn.length) {
      const detail = `${plural(noIrn.length, 'B2B document')} in 2A / 2B without an IRN (tax ${rupees(noIrn.reduce((s, d) => s + docTax(d), 0))}); basis: ${einvBasis}`;
      if (einvConfirmed) add('EINVOICE_MISSING_IRN', detail, `${lkSrc}; ${src2B ?? src2A ?? 'GSTR-2A / 2B'}`);
      else add('EINVOICE_VERIFY', detail, src2B ?? src2A ?? 'GSTR-2A / 2B');
    }
    const einvNotEnabled = einvApplicable === 'Yes' && einvConfirmed && withIrn === 0 && portalEnabled !== true;

    // 7. Name.
    const portalName = lk?.legalName || lk?.tradeName || null;
    const ourName = b.names.master || mostCommon(b.names.books) || null;
    if (ourName && lk?.status === 'ok' && (lk.legalName || lk.tradeName)) {
      const sim = Math.max(lk.legalName ? nameSimilarity(ourName, lk.legalName) : 0, lk.tradeName ? nameSimilarity(ourName, lk.tradeName) : 0);
      if (sim < NAME_MATCH_MIN) add('NAME_MISMATCH', `"${ourName}" (${b.names.master ? 'vendor master' : 'books'}) vs "${lk.legalName ?? ''}"${lk.tradeName ? ` / "${lk.tradeName}"` : ''} (portal)`, lkSrc);
    } else if (ourName && !lk) {
      const twoBName = mostCommon(b.names.twoB) ?? mostCommon(b.names.twoA);
      if (twoBName && nameSimilarity(ourName, twoBName) < NAME_MATCH_MIN) add('NAME_MISMATCH', `"${ourName}" (${b.names.master ? 'vendor master' : 'books'}) vs "${twoBName}" (2A / 2B trade name)`, src2B ?? src2A ?? 'GSTR-2A / 2B');
    }

    // 8. Reverse charge.
    const rcm = docs.filter((d) => d.reverseCharge);
    if (rcm.length) add('RCM_DOCS', `${plural(rcm.length, 'document')} marked reverse charge in 2A / 2B`, src2B ?? src2A ?? 'GSTR-2A / 2B');

    // Remarks.
    const pan = check.pan ? allPans.get(check.pan) ?? [] : [];
    if (pan.length > 1) remarks.push(`Multiple registrations: ${pan.length} GSTINs under PAN ${check.pan} (${pan.filter((g) => g !== b.gstin).join(', ')}).`);
    if (b.inMaster && !docs.length && !b.books.length && !b.imp.length && !b.notIn2B.length) remarks.push('No purchases seen in FY (vendor master only).');
    if (b.code) remarks.push(`Vendor code ${b.code}.`);
    if (lk?.cancelReason && regState !== 'cancelled') remarks.push(`Portal note: ${lk.cancelReason}.`);
    if (einvApplicable === 'No' && einvBasis) remarks.push(`E-invoice: ${einvBasis}.`);
    if (lk?.natureOfBusiness?.length) remarks.push(`Nature of business: ${lk.natureOfBusiness.join(', ')}.`);
    if (check.panHolder) remarks.push(`PAN holder: ${check.panHolder}.`);

    // Band and nature.
    const bandOf = (f: Finding): RiskBand => f.band ?? FINDINGS[f.code].band;
    const natureOf = (f: Finding): RiskNature => f.nature ?? FINDINGS[f.code].nature;
    const top = findings.reduce((m, f) => Math.max(m, BAND_RANK[bandOf(f)]), 0);
    const filingKnown = (f3?.state === 'ok' || f1?.state === 'ok') || filedPeriods.size > 0 || threeBFiled.length > 0;
    let band: RiskBand = top >= BAND_RANK.Medium ? (['No Data', 'Low', 'Medium', 'High', 'Critical'] as RiskBand[])[top]
      : regState === 'active' && filingKnown ? 'Low' : 'No Data';
    if (band === 'Low' && !lk) band = 'No Data';
    const atTop = findings.filter((f) => bandOf(f) === band);
    const nature: RiskNature | null = band === 'No Data' ? 'Verification required' : band === 'Low' ? null
      : atTop.some((f) => natureOf(f) === 'Confirmed') ? 'Confirmed' : atTop.some((f) => natureOf(f) === 'Potential risk') ? 'Potential risk' : 'Verification required';

    // Cells.
    const VR = 'Verification required — run Pull (Search Taxpayer)';
    const has = (c: FindingCode) => findings.some((f) => f.code === c);
    const regStatusCell = !check.valid ? `Invalid GSTIN (${check.problem})`
      : lk?.status === 'not_found' ? 'Not found on the GST portal'
        : lk ? lk.regStatus || 'Not shown'
          : cancelled2A ? `Cancelled per GSTR-2A (${VR.toLowerCase()})` : VR;
    const cancelCell = lk?.status === 'ok'
      ? (regState === 'cancelled' || regState === 'suspended' ? dmy(lk.cancelDate) || 'Not shown by the portal search' : '—')
      : cancelled2A ? `${dmy(cancelled2A)} (per GSTR-2A)` : 'Verification required';
    const reasonCell = lk?.status === 'ok'
      ? (regState === 'cancelled' || regState === 'suspended' ? lk.cancelReason || 'Not shown by the portal search' : '—')
      : 'Verification required';
    const tdsTcs = check.kind === 'tds' ? 'TDS deductor registration (s.51)'
      : check.kind === 'tcs' ? 'Appears to be a TCS registration (s.52)'
        : /deductor/i.test(lk?.taxpayerType ?? '') ? 'TDS deductor registration (s.51)'
          : /collector/i.test(lk?.taxpayerType ?? '') ? 'TCS registration (s.52)'
            : 'Not a TDS / TCS registration';
    const rcmCell = rcm.length ? `Yes: ${plural(rcm.length, 'document')} marked reverse charge (s.9(3) / 9(4))`
      : check.kind === 'oidar' || check.kind === 'nrtp' ? 'Verify: reverse charge may apply to imports of services (s.5(3) IGST Act)'
        : docs.length ? 'No reverse charge documents in 2A / 2B' : 'No 2A / 2B documents to read';
    const enablement = lk?.einvoiceStatus ? `${lk.einvoiceStatus} [${lkSrc}]`
      : withIrn ? `IRN seen on ${withIrn} of ${totalB2b} B2B documents (enabled)`
        : totalB2b ? `No IRN on ${plural(totalB2b, 'B2B document')}; not verified on the IRP (CAPTCHA)` : 'No B2B documents; not verified on the IRP (CAPTCHA)';
    const g1Cell = filingText(f1, 'GSTR-1')
      ?? (filedPeriods.size || notFiled.length
        ? `${filedPeriods.size ? `Filed for ${plural(filedPeriods.size, 'period')} with documents` : ''}${filedPeriods.size && notFiled.length ? '; ' : ''}${notFiled.length ? `saved but not filed: ${plural(notFiled.length, 'document')}` : ''} [GSTR-2A / 2B]`
        : 'Verification required');
    const g3Cell = filingText(f3, 'GSTR-3B')
      ?? (threeBFiled.length || threeBPending.length
        ? `${threeBFiled.length ? `Filed per 2A for ${listPeriods(threeBFiled)}` : ''}${threeBFiled.length && threeBPending.length ? '; ' : ''}${threeBPending.length ? `not filed as of the 2A pull: ${listPeriods(threeBPending)}` : ''} [GSTR-2A]`
        : 'Verification required');
    const lastDof = [f1?.lastFiled, f3?.lastFiled].filter((d): d is string => !!d).sort().pop() ?? null;
    const lastCell = lastDof ? dmy(lastDof) : lastFiled2AB ? `${dmy(lastFiled2AB)} (GSTR-1 / IFF, per 2A / 2B)` : 'Verification required';
    const twoBParts: string[] = [];
    if (!ready('2B').length) twoBParts.push('No GSTR-2B pulled for the year');
    else twoBParts.push(b.in2B.length ? `In 2B: ${plural(b.in2B.filter((d) => d.bucket !== 'reversal').length, 'document')} (ITC available ${rupees(itc2B)})` : 'Not in any GSTR-2B pulled');
    if (notAvail.length) twoBParts.push(`ITC not available: ${notAvail.length}`);
    if (b.notIn2B.length) twoBParts.push(`open Not in 2B: ${b.notIn2B.length} (${rupees(openTax)})`);
    if (b.notInBooks.length) twoBParts.push(`open Not in books: ${b.notInBooks.length} (${rupees(nibTax)})`);
    if (valueDiff.length) twoBParts.push(`2A vs 2B value differences: ${valueDiff.length}`);
    if (!b.notIn2B.length && b.in2B.length && !valueDiff.length && input.ledgerAsOf) twoBParts.push('no open mismatch');

    const eligibility = (() => {
      if (has('INVALID_GSTIN') || has('NOT_FOUND_ON_PORTAL')) return 'Verification required: no ITC until a valid, registered GSTIN is confirmed (s.16(2)(aa))';
      if (has('CANCELLED_RETRO')) return 'Potentially ineligible on documents dated on or after the cancellation; earlier ones conditionally eligible (s.16(2)(c))';
      if (has('SUSPENDED_INVOICES') || has('SUSPENDED')) return 'Conditionally eligible: hold pending verification of the suspension (rule 21A)';
      if (has('CANCELLED') || has('CANCELLED_2A')) return "Conditionally eligible: documents before the cancellation, subject to the vendor's returns (s.16(2)(c))";
      if (has('COMPOSITION_TAX_CHARGED')) return 'Not eligible on tax charged after opting into composition (s.10(4)); verify each invoice';
      if (has('TDS_TCS_REGISTRATION')) return 'Verify: the GSTIN is not a supplier registration (s.51 / 52)';
      if (has('EINVOICE_MISSING_IRN')) return 'Conditionally eligible: obtain the e-invoice for documents without an IRN (rule 48(5))';
      if (has('NON_FILING_PERSISTENT') || has('RULE_37A_REVERSAL')) return "Conditionally eligible: subject to the vendor's tax payment (s.16(2)(c), rule 37A)";
      if (has('MISMATCH_MATERIAL') || has('MISMATCH_MINOR') || has('BOOKS_NOT_IN_2B')) return `Eligible only as reflected in GSTR-2B (s.16(2)(aa))${openTax ? `; ${rupees(openTax)} not yet in 2B` : ''}`;
      if (has('COMPOSITION')) return 'No ITC arises (bill of supply, s.10(4))';
      if (band === 'No Data') return 'Verification required';
      return 'Eligible, subject to the conditions of s.16(2)';
    })();

    const shown = findings.filter((f) => f.code !== 'NO_LOOKUP' || band === 'No Data');
    const ordered = [...shown].sort((x, y) => BAND_RANK[bandOf(y)] - BAND_RANK[bandOf(x)]);
    const reasonText = ordered.length
      ? ordered.map((f) => `${natureOf(f)}: ${FINDINGS[f.code].label}: ${f.detail}${f.source && f.source !== '-' ? ` [${f.source}]` : ''}`).join('; ')
      : 'No adverse finding';
    const provisions = [...new Set(ordered.map((f) => FINDINGS[f.code].provision))].join('; ') || '—';
    const actions = [...new Set(ordered.map((f) => FINDINGS[f.code].action))];
    const name = b.names.master || mostCommon(b.names.books) || mostCommon(b.names.twoB) || mostCommon(b.names.twoA) || mostCommon(b.names.imp) || lk?.tradeName || lk?.legalName || '(name not known)';
    if (portalName && portalName !== name) remarks.push(`Portal legal name: ${lk?.legalName ?? portalName}${lk?.tradeName ? `; trade name: ${lk.tradeName}` : ''}.`);

    const cells: VendorRow['cells'] = {
      'Vendor Name': name,
      GSTIN: b.gstin,
      State: check.state ? `${check.stateCode} ${check.state}` : check.stateCode || '—',
      'GST Registration Status': regStatusCell,
      'Registration Date': lk?.status === 'ok' ? dmy(lk.regDate) || 'Not shown' : 'Verification required',
      'Cancellation/Suspension Date': cancelCell,
      'Cancellation Reason': reasonCell,
      'Taxpayer Type': lk?.taxpayerType || (check.kind !== 'normal' ? GSTIN_KIND_LABEL[check.kind] : 'Verification required'),
      'Composition Scheme (Yes/No)': composition,
      'RCM Applicability Indicator': rcmCell,
      'GST TDS/TCS Status': tdsTcs,
      'E-Invoice Applicable (Yes/No)': einvApplicable,
      'E-Invoice Enablement Status': enablement,
      'E-Invoice Risk (Yes/No)': einvRisk,
      'GSTR-1 Filing Status': g1Cell,
      'GSTR-3B Filing Status': g3Cell,
      'Last Return Filing Date': lastCell,
      'GSTR-2B Availability/Matching Status': twoBParts.join('; '),
      'ITC Eligibility Status': eligibility,
      'ITC Risk Category': band === 'No Data' || band === 'Low' ? BAND_LABEL[band] : `${band} (${nature})`,
      'Reason for ITC Risk': reasonText,
      'Relevant GST Section/Rule/Notification': provisions,
      'Recommended Corrective Action': actions.length ? actions.map((a, i) => (actions.length > 1 ? `${i + 1}. ${a}` : a)).join(' ') : 'None: keep the routine checks.',
      'Date of Verification': lk ? dmy(lk.lookedUpAt) : 'Not verified on the portal',
      'Data Source': [...sources].join('; '),
      Remarks: remarks.join(' ') || '—',
    };
    rows.push({ gstin: b.gstin, name, band, nature, findings, check, regState, composition, einvApplicable, einvRisk, einvNotEnabled, itc, lookedUp: !!lk, cells });
  }

  rows.sort((a, b) => BAND_RANK[b.band] - BAND_RANK[a.band] || (a.band === 'No Data' ? 0 : b.itc - a.itc) || a.name.localeCompare(b.name));

  // Summary.
  const bands = { Critical: 0, High: 0, Medium: 0, Low: 0, 'No Data': 0 } as Record<RiskBand, number>;
  for (const r of rows) bands[r.band] += 1;
  const sum = (xs: VendorRow[]) => r2(xs.reduce((s, r) => s + r.itc, 0));
  const withAny = (codes: FindingCode[]) => rows.filter((r) => r.findings.some((f) => codes.includes(f.code)));
  const line = (label: string, xs: VendorRow[], note: string, money = true): SummaryLine => ({ label, count: xs.length, itc: money ? sum(xs) : null, note });
  const summary: SummaryLine[] = [
    line('Total vendor GSTINs', rows, `FY ${fy}: 2A / 2B, Import 2B, books, ledgers and vendor master`),
    line('Active (portal)', rows.filter((r) => r.regState === 'active'), 'GST portal Search Taxpayer'),
    line('Cancelled', rows.filter((r) => r.regState === 'cancelled'), 'Portal, or GSTR-2A where not looked up'),
    line('Suspended', rows.filter((r) => r.regState === 'suspended'), 'GST portal Search Taxpayer'),
    line('Invalid GSTIN / not found on the portal', rows.filter((r) => !r.check.valid || r.regState === 'not_found'), 'Check digit, format, or the portal search'),
    line('Not yet verified on the portal', rows.filter((r) => !r.lookedUp), 'Run Pull (Search Taxpayer)'),
    line('E-invoice applicable', rows.filter((r) => r.einvApplicable === 'Yes'), 'Turnover slab, portal flag or IRNs seen'),
    line('E-invoice liable, no IRN seen', rows.filter((r) => r.einvNotEnabled), 'Liable by the portal, but no IRN on any document'),
    line('E-invoice risk (documents without IRN)', rows.filter((r) => r.einvRisk === 'Yes'), 'rule 48(4) / 48(5)'),
    line('Composition taxpayers', rows.filter((r) => r.composition === 'Yes'), 's.10(4)'),
    line('Potential ITC restrictions (Critical / High)', rows.filter((r) => r.band === 'Critical' || r.band === 'High'), 'ITC at stake: in 2B, else in the books'),
    line('Return filing issues', withAny(['NON_FILING_PERSISTENT', 'NON_FILING', 'NOT_FILED_GSTR1', 'SUPPLIER_3B_PENDING', 'DELAYED_FILING', 'RULE_37A_REVERSAL']), 'Non-filing, late filing, rule 37A'),
    line('2B mismatches', withAny(['MISMATCH_MATERIAL', 'MISMATCH_MINOR', 'BOOKS_NOT_IN_2B', 'VALUE_DIFFERENCE']), 'Open Not in 2B, books not in 2B, value differences'),
  ];

  const notes: string[] = [];
  if (viewMissing) notes.push('Portal lookups are not set up yet (vendor_gstin_latest is missing): every registration field reads "Verification required".');
  else if (!rows.some((r) => r.lookedUp)) notes.push('No vendor GSTIN has been looked up on the portal yet: use Pull (Search Taxpayer).');
  if (!ready('2A').length) notes.push(`No GSTR-2A of FY ${fy} is pulled.`);
  if (twoBMissing.length) notes.push(`GSTR-2B not pulled for ${listPeriods(twoBMissing, 12)}.`);
  if (!input.masterFile) notes.push('No vendor master uploaded: names are compared with the books only.');
  const allSources = [src2A, src2B, srcLedger, srcReco, srcMaster, input.importDocs.length ? 'Import 2B' : null, input.books.length ? 'Books register' : null,
    (input.lookups ?? []).length ? 'GST portal Search Taxpayer' : null, srcCheck].filter((s): s is string => !!s);
  return { rows, summary, bands, sources: allSources, notes };
}
