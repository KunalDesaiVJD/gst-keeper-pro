// Reading what the extension saved from the portal (gst_filed_returns and the
// two ledger statements), for the evidence recipes. Pure and tolerant.
//
// Shapes (extension/content.js): GSTR-3B = api/gstr3b/summary (sup_details,
// itc_elg, intr_ltfee, optional tx_pmt); GSTR-1 = api/gstr1/summary (sec_sum[]
// with TTL_LIAB); GSTR-2B = gstr2b getdata (docdata.b2b[].inv[] with
// invoice-level igst/cgst/sgst/cess, cdnr[].nt[], isd[].doclist[], impg[]);
// GSTR-2A = { b2b: [{ ctin, trdnm, supfildt, inv: [...] }] } where each invoice
// is as the portal sent it — its tax sits in itms[].itm_det (iamt/camt/samt/
// csamt), not on the invoice. The shared flatteners in src/utils/
// filedReturnReports.ts read iamt/camt on 2B invoices and invoice-level tax on
// 2A, so they come out as zero on real data; this file reads both correctly.
import { pnum, unwrap } from '@/lib/gstr9/portalParser';
import type { FiledReturn, FiledType, HeadAmounts, ReadyState, ReclaimRow } from './types';
import { HEADS } from './types';
import { toIsoDate } from './periods';

type AnyObj = Record<string, unknown>;
const isObj = (v: unknown): v is AnyObj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): AnyObj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ── Head arithmetic ─────────────────────────────────────────────────────────
export const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
export const zeroHeads = (): HeadAmounts => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const addHeads = (...xs: HeadAmounts[]): HeadAmounts => {
  const o = zeroHeads();
  for (const x of xs) for (const h of HEADS) o[h] += x[h];
  return o;
};
export const subHeads = (a: HeadAmounts, b: HeadAmounts): HeadAmounts => {
  const o = zeroHeads();
  for (const h of HEADS) o[h] = a[h] - b[h];
  return o;
};
export const mapHeads = (a: HeadAmounts, f: (v: number) => number): HeadAmounts => {
  const o = zeroHeads();
  for (const h of HEADS) o[h] = f(a[h]);
  return o;
};
export const roundHeads = (a: HeadAmounts): HeadAmounts => mapHeads(a, r2);
export const sumHeads = (a: HeadAmounts): number => HEADS.reduce((s, h) => s + a[h], 0);
export const isZeroHeads = (a: HeadAmounts, eps = 0.005): boolean => HEADS.every((h) => Math.abs(a[h]) <= eps);

/** {iamt, camt, samt, csamt} (returns' own keys). */
export const headsOfAmt = (o: unknown): HeadAmounts =>
  isObj(o) ? { igst: pnum(o.iamt), cgst: pnum(o.camt), sgst: pnum(o.samt), cess: pnum(o.csamt) } : zeroHeads();

// ── GSTR-3B ─────────────────────────────────────────────────────────────────
export interface Gstr3bFigures {
  /** 3.1(a) outward taxable (other than zero rated, nil, exempt). */
  t31a: HeadAmounts;
  /** 3.1(b) zero rated. */
  t31b: HeadAmounts;
  /** 3.1(d) inward supplies liable to reverse charge. */
  t31d: HeadAmounts;
  /** Taxable values of 3.1(a), (b), (d). */
  value: { a: number; b: number; d: number };
  /** 4A(1) imports of goods, 4A(2) imports of services, 4A(3) other RCM, 4A(4) ISD, 4A(5) all other ITC. */
  itc: { impg: HeadAmounts; imps: HeadAmounts; isrc: HeadAmounts; isd: HeadAmounts; oth: HeadAmounts };
  /** 4B(1) as per rules 38/42/43 and s.17(5); 4B(2) others. */
  rev: { rul: HeadAmounts; oth: HeadAmounts };
  /** 4C net ITC (4A − 4B). */
  net: HeadAmounts;
  /** 5.1 interest and late fee paid in this return. */
  interest: HeadAmounts;
  lateFee: HeadAmounts;
  /** Tax paid in cash, from the return's own payment table when the summary carries it. */
  cashPaid: HeadAmounts | null;
}

const byTy = (list: AnyObj[], ty: string): HeadAmounts =>
  addHeads(...list.filter((r) => String(r.ty ?? '').toUpperCase() === ty).map(headsOfAmt));

export function parseGstr3b(summary: unknown): Gstr3bFigures | null {
  const d = unwrap(summary, ['sup_details', 'itc_elg']);
  if (!d) return null;
  const sup = isObj(d.sup_details) ? d.sup_details : {};
  const elg = isObj(d.itc_elg) ? d.itc_elg : {};
  const avl = arr(elg.itc_avl);
  const rev = arr(elg.itc_rev);
  const itc = { impg: byTy(avl, 'IMPG'), imps: byTy(avl, 'IMPS'), isrc: byTy(avl, 'ISRC'), isd: byTy(avl, 'ISD'), oth: byTy(avl, 'OTH') };
  const revs = { rul: byTy(rev, 'RUL'), oth: byTy(rev, 'OTH') };
  const net = isObj(elg.itc_net)
    ? headsOfAmt(elg.itc_net)
    : subHeads(addHeads(itc.impg, itc.imps, itc.isrc, itc.isd, itc.oth), addHeads(revs.rul, revs.oth));
  const il = isObj(d.intr_ltfee) ? d.intr_ltfee : {};
  // tx_pmt.pdcash: [{ ipd, cpd, spd, cspd, … }] — the cash paid per head, when the portal includes it.
  const pdcash = isObj(d.tx_pmt) ? arr(d.tx_pmt.pdcash) : [];
  const hasCash = pdcash.some((r) => ['ipd', 'cpd', 'spd', 'cspd'].some((k) => k in r));
  const cashPaid = hasCash
    ? addHeads(...pdcash.map((r) => ({ igst: pnum(r.ipd), cgst: pnum(r.cpd), sgst: pnum(r.spd), cess: pnum(r.cspd) })))
    : null;
  const val = (o: unknown) => (isObj(o) ? pnum(o.txval) : 0);
  return {
    t31a: headsOfAmt(sup.osup_det),
    t31b: headsOfAmt(sup.osup_zero),
    t31d: headsOfAmt(sup.isup_rev),
    value: { a: val(sup.osup_det), b: val(sup.osup_zero), d: val(sup.isup_rev) },
    itc,
    rev: revs,
    net,
    interest: headsOfAmt(il.intr_details),
    lateFee: headsOfAmt(il.ltfee_details),
    cashPaid,
  };
}

// ── GSTR-1 ──────────────────────────────────────────────────────────────────
export interface Gstr1Figures {
  /** TTL_LIAB: the total liability of the return (what the existing DRC-01B report reads). */
  liability: HeadAmounts;
  value: number;
  /** The summary had a TTL_LIAB section. */
  hasTotal: boolean;
  /** Every section is zero (a nil return): a real zero even without TTL_LIAB. */
  empty: boolean;
}

export function parseGstr1(summary: unknown): Gstr1Figures | null {
  const d = unwrap(summary, ['sec_sum']);
  if (!d || !Array.isArray(d.sec_sum)) return null;
  const secs = arr(d.sec_sum);
  const total = secs.find((s) => String(s.sec_nm ?? '').toUpperCase() === 'TTL_LIAB');
  const headsOfSec = (s: AnyObj): HeadAmounts => ({ igst: pnum(s.ttl_igst), cgst: pnum(s.ttl_cgst), sgst: pnum(s.ttl_sgst), cess: pnum(s.ttl_cess) });
  const empty = secs.every((s) => isZeroHeads(headsOfSec(s)) && Math.abs(pnum(s.ttl_val)) < 0.005);
  return {
    liability: total ? headsOfSec(total) : zeroHeads(),
    value: total ? pnum(total.ttl_val) : 0,
    hasTotal: !!total,
    empty,
  };
}

// ── GSTR-2B / GSTR-2A documents ─────────────────────────────────────────────
export type DocType = 'INV' | 'CN' | 'DN' | 'ISD' | 'ISDC' | 'BOE';

export interface PortalDoc {
  section: string;
  ctin: string | null;
  name: string | null;
  number: string | null;
  date: string | null;
  type: DocType;
  rev: boolean;
  /** ITC available per GSTR-2B (null for GSTR-2A, which has no such flag). */
  itcAvailable: boolean | null;
  reason: string | null;
  value: number;
  tax: HeadAmounts;
}

/** Signed tax: credit notes reduce. */
export const docSign = (d: PortalDoc): number => (d.type === 'CN' || d.type === 'ISDC' ? -1 : 1);

const taxOf2b = (o: AnyObj): HeadAmounts => {
  if (['igst', 'cgst', 'sgst', 'cess'].some((k) => k in o)) return { igst: pnum(o.igst), cgst: pnum(o.cgst), sgst: pnum(o.sgst), cess: pnum(o.cess) };
  if (['iamt', 'camt', 'samt', 'csamt'].some((k) => k in o)) return headsOfAmt(o);
  const items = arr(o.items).length ? arr(o.items) : arr(o.itms).map((i) => (isObj(i.itm_det) ? i.itm_det : i));
  return addHeads(...items.map(taxOf2b));
};

const flag = (v: unknown): boolean | null => (v === 'Y' ? true : v === 'N' ? false : null);

export interface Gstr2bParsed {
  docs: PortalDoc[];
  /** Amendment sections (B2BA, CDNRA, ISDA, IMPGA): listed, not compared. */
  amendments: { count: number; tax: HeadAmounts };
  /** Other non-empty sections this parser does not read. */
  otherSections: string[];
}

const KNOWN_2B = new Set(['b2b', 'cdnr', 'isd', 'impg', 'impgsez', 'b2ba', 'cdnra', 'isda', 'impga', 'impgasez']);

export function parseGstr2b(summary: unknown): Gstr2bParsed | null {
  const d = unwrap(summary, ['docdata', 'itcsumm', 'rtnprd']);
  if (!d) return null;
  const dd = isObj(d.docdata) ? d.docdata : {};
  const docs: PortalDoc[] = [];
  for (const s of arr(dd.b2b)) {
    for (const inv of arr(s.inv)) {
      docs.push({
        section: 'B2B', ctin: str(s.ctin), name: str(s.trdnm), number: str(inv.inum), date: toIsoDate(inv.dt), type: 'INV',
        rev: inv.rev === 'Y', itcAvailable: flag(inv.itcavl), reason: str(inv.rsn), value: pnum(inv.txval), tax: taxOf2b(inv),
      });
    }
  }
  for (const s of arr(dd.cdnr)) {
    for (const nt of arr(s.nt)) {
      const t = String(nt.typ ?? '').toUpperCase();
      docs.push({
        section: 'CDNR', ctin: str(s.ctin), name: str(s.trdnm), number: str(nt.ntnum), date: toIsoDate(nt.dt), type: t === 'D' ? 'DN' : 'CN',
        rev: nt.rev === 'Y', itcAvailable: flag(nt.itcavl), reason: str(nt.rsn), value: pnum(nt.txval), tax: taxOf2b(nt),
      });
    }
  }
  for (const s of arr(dd.isd)) {
    for (const doc of arr(s.doclist)) {
      const credit = /C$/i.test(String(doc.doctyp ?? ''));
      docs.push({
        section: 'ISD', ctin: str(s.ctin), name: str(s.trdnm), number: str(doc.docnum), date: toIsoDate(doc.docdt), type: credit ? 'ISDC' : 'ISD',
        rev: false, itcAvailable: flag(doc.itcelg), reason: null, value: 0, tax: taxOf2b(doc),
      });
    }
  }
  const boe = (b: AnyObj, s?: AnyObj) => docs.push({
    section: 'IMPG', ctin: s ? str(s.ctin) : null, name: s ? str(s.trdnm) : null, number: str(b.boenum), date: toIsoDate(b.boedt), type: 'BOE',
    rev: false, itcAvailable: true, reason: null, value: pnum(b.txval), tax: taxOf2b(b),
  });
  for (const b of arr(dd.impg)) boe(b);
  for (const s of arr(dd.impgsez)) for (const b of arr(s.boe)) boe(b, s);

  const amendments = { count: 0, tax: zeroHeads() };
  for (const key of ['b2ba', 'cdnra', 'isda', 'impga', 'impgasez']) {
    for (const s of arr(dd[key])) {
      const list = [...arr(s.inv), ...arr(s.nt), ...arr(s.doclist), ...arr(s.boe)];
      const own = list.length ? list : [s];
      for (const x of own) { amendments.count += 1; amendments.tax = addHeads(amendments.tax, taxOf2b(x)); }
    }
  }
  const otherSections = Object.keys(dd).filter((k) => !KNOWN_2B.has(k) && Array.isArray(dd[k]) && (dd[k] as unknown[]).length > 0);
  return { docs, amendments, otherSections };
}

export function parseGstr2a(summary: unknown): PortalDoc[] | null {
  const d = unwrap(summary, ['b2b']);
  if (!d || !Array.isArray(d.b2b)) return null;
  const docs: PortalDoc[] = [];
  for (const s of arr(d.b2b)) {
    for (const inv of arr(s.inv)) {
      docs.push({
        section: 'B2B', ctin: str(s.ctin), name: str(s.trdnm), number: str(inv.inum), date: toIsoDate(inv.idt ?? inv.dt), type: 'INV',
        rev: inv.rchrg === 'Y' || inv.rev === 'Y', itcAvailable: null, reason: null,
        value: pnum(inv.txval) || arr(inv.itms).reduce((a, i) => a + pnum(isObj(i.itm_det) ? i.itm_det.txval : i.txval), 0),
        tax: taxOf2b(inv),
      });
    }
  }
  return docs;
}

/** GSTR-2B "all other ITC" from registered suppliers (B2B invoices and notes, not reverse charge, ITC available). */
export const allOtherItc2b = (docs: PortalDoc[]): HeadAmounts =>
  addHeads(...docs.filter((d) => (d.section === 'B2B' || d.section === 'CDNR') && !d.rev && d.itcAvailable !== false)
    .map((d) => mapHeads(d.tax, (v) => v * docSign(d))));
/** GSTR-2A B2B invoices not on reverse charge (2A has no credit/debit notes in the extension's pull). */
export const allOtherItc2a = (docs: PortalDoc[]): HeadAmounts =>
  addHeads(...docs.filter((d) => !d.rev).map((d) => d.tax));
export const rcmItcDocs = (docs: PortalDoc[]): HeadAmounts =>
  addHeads(...docs.filter((d) => d.rev && d.itcAvailable !== false).map((d) => mapHeads(d.tax, (v) => v * docSign(d))));
export const isdItc = (docs: PortalDoc[]): HeadAmounts =>
  addHeads(...docs.filter((d) => d.section === 'ISD' && d.itcAvailable !== false).map((d) => mapHeads(d.tax, (v) => v * docSign(d))));
export const impgItc = (docs: PortalDoc[]): HeadAmounts =>
  addHeads(...docs.filter((d) => d.section === 'IMPG').map((d) => d.tax));

// ── Is the row usable? ──────────────────────────────────────────────────────
const NOT_FILED = /^(NF$|NOT (FILED|FOUND|GENERATED))/i;
const FAILED = /^PULL FAILED/i;

/** Status text the portal / extension wrote for a month the return is not filed (as portalImport.isNotFiled). */
export const isNotFiledStatus = (s: string | null | undefined): boolean => !!s && NOT_FILED.test(s.trim());

export interface RowState { state: ReadyState; why: string | null }

/**
 * ready: figures that count (a filed zero is a real zero); not_filed: the portal
 * says the return is not filed / 2B not generated; failed: the pull failed or
 * the figures cannot be read; not_fetched: nothing usable pulled yet.
 */
export function classifyFiled(row: FiledReturn | undefined, type: FiledType): RowState {
  if (!row) return { state: 'not_fetched', why: null };
  const status = (row.status ?? '').trim();
  if (NOT_FILED.test(status)) return { state: 'not_filed', why: status };
  let usable = false;
  let unreadable: string | null = null;
  if (type === 'GSTR3B') usable = !!parseGstr3b(row.summary);
  else if (type === 'GSTR1') {
    const g = parseGstr1(row.summary);
    usable = !!g && (g.hasTotal || g.empty);
    if (g && !usable) unreadable = 'pulled without a total-liability (TTL_LIAB) section';
  } else if (type === 'GSTR2B') usable = !!parseGstr2b(row.summary);
  else if (type === 'GSTR2A') usable = !!parseGstr2a(row.summary);
  else usable = true;
  // A later failed re-pull rewrites only the status; the saved figures are still the filed ones.
  if (usable) return { state: 'ready', why: null };
  if (unreadable) return { state: 'failed', why: unreadable };
  if (FAILED.test(status)) return { state: 'failed', why: status };
  return { state: 'not_fetched', why: status || null };
}

/** The statement for an FY: ready when it has rows that are not a failure note. */
export function classifyStatement(rows: { description: string | null; isOpening: boolean; period: string | null }[] | null): RowState {
  if (rows === null) return { state: 'failed', why: 'could not be read' };
  if (!rows.length) return { state: 'not_fetched', why: null };
  const failedOnly = rows.every((r) => !r.isOpening && !r.period && FAILED.test((r.description ?? '').trim()));
  return failedOnly ? { state: 'failed', why: rows[0].description } : { state: 'ready', why: null };
}

export const reclaimsByPeriod = (rows: ReclaimRow[]): Map<string, { tax: HeadAmounts; rows: ReclaimRow[] }> => {
  const m = new Map<string, { tax: HeadAmounts; rows: ReclaimRow[] }>();
  for (const r of rows) {
    if (r.isOpening || !r.period || isZeroHeads(r.reclaimed)) continue;
    const cur = m.get(r.period) ?? { tax: zeroHeads(), rows: [] };
    cur.tax = addHeads(cur.tax, r.reclaimed);
    cur.rows.push(r);
    m.set(r.period, cur);
  }
  return m;
};
