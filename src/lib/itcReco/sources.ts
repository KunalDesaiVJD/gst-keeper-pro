// Adapters: one per document source, each turning what the extension saved in
// gst_filed_returns.summary into RecoDoc. Pure and tolerant (response wrappers,
// numeric strings, both tax-key spellings). A new source (GSTR-9 Table 8A) is a
// new adapter here plus a rule set in reasons.ts; the matcher does not change.
//
// Shapes (docs/GSTR2A_2B_RECO_POSITIONS.md §2):
//  - GSTR-2B = gstr2b getdata, stored whole: { gendt, rtnprd, docdata: { b2b:
//    [{ ctin, trdnm, supprd, supfildt, inv: [{ inum, dt, val, pos, rev, txval,
//    igst, cgst, sgst, cess, itcavl, rsn, imsStatus }] }], cdnr: [{ …, nt: [{
//    ntnum, typ C|D, … }] }], b2ba, cdnra, isd, impg, impgsez, … } }.
//  - GSTR-2A = { b2b: [{ ctin, trdnm, supfildt (DD-Mon-YY), inv: [{ inum, idt,
//    val, pos, rchrg, txval, iamt, camt, samt, csamt, itms, irn }] }] }, plus
//    (extension 0.13.0) every field the portal sends on the supplier (cfs,
//    cfs3b, flprdr1, dtcancel) and _meta: { counterparties, failed, failedCtins }.
//    From 0.14.0 also cdn: [{ ctin, trdnm, supfildt, …, nt: [{ ntty C|D,
//    nt_num, nt_dt, val, pos, rchrg, itms }] }] with _meta.sections ['b2b',
//    'cdn'], cdnFailed and cdnFailedCtins; or, when the notes could not be
//    read, no cdn, _meta.sections ['b2b'] and _meta.cdnProblem.
import { pnum, unwrap } from '@/lib/gstr9/portalParser';
import { taxOf2b } from '@/lib/reply/portal';
import { parsePortalDate, parseSupplierPeriod } from './dates';
import type { Bucket, DocFamily, RecoDoc, SourceKey, Statement, StatementMeta, StatementRow, StatementState } from './types';

type AnyObj = Record<string, unknown>;
const isObj = (v: unknown): v is AnyObj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): AnyObj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const flag = (v: unknown): boolean | null => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return s === 'Y' ? true : s === 'N' ? false : null;
};
const gstin = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '');

/** Plain-English names of the sections, for reasons and notes. */
export const SECTION_LABELS: Record<string, string> = {
  B2B: 'B2B invoices',
  CDNR: 'credit and debit notes',
  B2BA: 'amended B2B invoices',
  CDNRA: 'amended credit and debit notes',
  ISD: 'ISD credits',
  ISDA: 'amended ISD credits',
  IMPG: 'imports of goods',
  IMPGSEZ: 'imports from SEZ',
  IMPGA: 'amended imports of goods',
  IMPGASEZ: 'amended imports from SEZ',
  ECO: 'e-commerce supplies',
  ECOA: 'amended e-commerce supplies',
};
export const sectionLabel = (s: string): string => SECTION_LABELS[s] ?? s;

interface SectionSpec { section: string; amendment: boolean }

// docdata key → section. Every one of these is read; anything else non-empty is
// reported as an unknown section.
const SECTIONS_2B: Record<string, SectionSpec> = {
  b2b: { section: 'B2B', amendment: false },
  b2ba: { section: 'B2BA', amendment: true },
  cdnr: { section: 'CDNR', amendment: false },
  cdnra: { section: 'CDNRA', amendment: true },
  isd: { section: 'ISD', amendment: false },
  isda: { section: 'ISDA', amendment: true },
  impg: { section: 'IMPG', amendment: false },
  impgsez: { section: 'IMPGSEZ', amendment: false },
  impga: { section: 'IMPGA', amendment: true },
  impgasez: { section: 'IMPGASEZ', amendment: true },
  ecom: { section: 'ECO', amendment: false },
  ecoma: { section: 'ECOA', amendment: true },
};
/** GSTR-2B reads every section above, so it covers each of them even when a month has none. */
export const SECTIONS_READ_2B = [...new Set(Object.values(SECTIONS_2B).map((s) => s.section))];

// 2A section keys (api/gstr2a/<section>): b2b, and cdn from extension 0.14.0.
const SECTIONS_2A: Record<string, SectionSpec> = {
  b2b: { section: 'B2B', amendment: false },
  b2ba: { section: 'B2BA', amendment: true },
  cdn: { section: 'CDNR', amendment: false },
  cdnr: { section: 'CDNR', amendment: false },
  cdna: { section: 'CDNRA', amendment: true },
  cdnra: { section: 'CDNRA', amendment: true },
};

/** A supplier wrapper with its document list, or a bare document (imports). */
const entriesOf = (s: AnyObj): { wrapper: AnyObj | null; docs: AnyObj[] } => {
  for (const k of ['inv', 'nt', 'doclist', 'boe', 'docs']) if (Array.isArray(s[k])) return { wrapper: s, docs: arr(s[k]) };
  return { wrapper: null, docs: [s] };
};

const familyOf = (section: string, doc: AnyObj): DocFamily => {
  if (section.startsWith('IMPG')) return 'BOE';
  if (section.startsWith('CDNR')) {
    const t = String(doc.typ ?? doc.ntty ?? doc.nttyp ?? '').toUpperCase();
    return t === 'D' ? 'DN' : 'CN';
  }
  if (section.startsWith('ISD')) return /C$/i.test(String(doc.doctyp ?? '')) ? 'CN' : 'ISD';
  return 'INV';
};

// A note's own number and date come first: the older GSTN 2A note layout also
// carries inum / idt, the invoice the note was raised against.
const numberOf = (doc: AnyObj): string =>
  str(doc.ntnum) ?? str(doc.nt_num) ?? str(doc.inum) ?? str(doc.docnum) ?? str(doc.boenum) ?? '';
const dateOf = (doc: AnyObj): string | null =>
  parsePortalDate(doc.nt_dt ?? doc.dt ?? doc.idt ?? doc.docdt ?? doc.boedt);
const originalOf = (doc: AnyObj): RecoDoc['original'] => {
  const number = str(doc.oinum) ?? str(doc.ontnum) ?? str(doc.ont_num) ?? str(doc.odocnum) ?? str(doc.oboenum);
  const date = parsePortalDate(doc.oidt ?? doc.ontdt ?? doc.ont_dt ?? doc.odocdt ?? doc.oboedt);
  return number || date ? { number, date } : null;
};

const taxableOf = (doc: AnyObj): number => {
  if ('txval' in doc) return pnum(doc.txval);
  return arr(doc.itms).reduce((a, i) => a + pnum(isObj(i.itm_det) ? i.itm_det.txval : i.txval), 0)
    + arr(doc.items).reduce((a, i) => a + pnum(i.txval), 0);
};

interface ReadCtx { source: SourceKey; period: string; counter: { n: number } }

function makeDoc(c: ReadCtx, spec: SectionSpec, wrapper: AnyObj | null, doc: AnyObj, bucket: Bucket | null): RecoDoc {
  const ctin = gstin(wrapper?.ctin ?? doc.ctin);
  const number = numberOf(doc);
  const tax = taxOf2b(doc);
  const filedOn = parsePortalDate(wrapper?.supfildt ?? wrapper?.fldtr1);
  const cfs = flag(wrapper?.cfs);
  const itcAvailable = c.source === '2B' ? flag(doc.itcavl ?? doc.itcelg) : null;
  const rsn = str(doc.rsn);
  const ims = str(doc.imsStatus);
  let b = bucket;
  if (c.source === '2B' && !b) b = ims && ims.toUpperCase() === 'R' ? 'rejected' : itcAvailable === false ? 'not_available' : 'available';
  c.counter.n += 1;
  return {
    ref: `${c.source}|${c.period}|${spec.section}|${ctin}|${number}|${c.counter.n}`,
    source: c.source,
    statementPeriod: c.period,
    section: spec.section,
    isAmendment: spec.amendment,
    original: spec.amendment ? originalOf(doc) : null,
    ctin,
    supplierName: str(wrapper?.trdnm ?? doc.trdnm),
    family: familyOf(spec.section, doc),
    number,
    date: dateOf(doc),
    docValue: pnum(doc.val),
    pos: str(doc.pos),
    reverseCharge: String(doc.rev ?? doc.rchrg ?? '').toUpperCase() === 'Y',
    taxable: taxableOf(doc),
    igst: tax.igst,
    cgst: tax.cgst,
    sgst: tax.sgst,
    cess: tax.cess,
    // A 2A lists what suppliers reported for its own period (flprdr1 says so from 0.13.0).
    supplierPeriod: parseSupplierPeriod(wrapper?.supprd ?? wrapper?.flprdr1) ?? (c.source === '2A' ? c.period : null),
    supplierFiledOn: filedOn,
    supplierFiled: cfs !== null ? cfs : filedOn ? true : null,
    supplier3bFiled: flag(wrapper?.cfs3b),
    supplierCancelledFrom: parsePortalDate(wrapper?.dtcancel),
    itcAvailable,
    itcReason: rsn,
    imsStatus: ims,
    bucket: b,
    irn: str(doc.irn),
  };
}

function readSections(c: ReadCtx, container: AnyObj, specs: Record<string, SectionSpec>, bucket: Bucket | null, out: RecoDoc[], found: Set<string>) {
  for (const [key, spec] of Object.entries(specs)) {
    if (!Array.isArray(container[key])) continue;
    found.add(spec.section);
    for (const s of arr(container[key])) {
      const { wrapper, docs } = entriesOf(s);
      for (const doc of docs) out.push(makeDoc(c, spec, wrapper, doc, bucket));
    }
  }
}

const emptyMeta = (source: SourceKey, period: string): StatementMeta => ({
  source, period, state: 'not_pulled', status: null, pulledAt: null, generatedOn: null,
  sectionsRead: [], sectionsUnknown: [], failedSuppliers: null, failedCtins: null, suspectEmpty: false,
});

/** GSTR-2B getdata → documents; null when the summary is not a 2B. */
export function docsFrom2B(summary: unknown, period: string): Statement | null {
  const d = unwrap(summary, ['docdata', 'itcsumm', 'rtnprd']);
  if (!d) return null;
  const dd = isObj(d.docdata) ? d.docdata : {};
  const c: ReadCtx = { source: '2B', period, counter: { n: 0 } };
  const docs: RecoDoc[] = [];
  const found = new Set<string>();
  readSections(c, dd, SECTIONS_2B, null, docs, found);

  // ITC reversal (Rule 37A): docdata.itcrev, per the GSTN API sample; never
  // seen live, so it is read either as a section object or as supplier wrappers.
  const handled = new Set(Object.keys(SECTIONS_2B));
  for (const [key, v] of Object.entries(dd)) {
    if (!/itcrev|reversal/i.test(key)) continue;
    handled.add(key);
    if (Array.isArray(v)) readSections(c, { b2b: v }, { b2b: SECTIONS_2B.b2b }, 'reversal', docs, found);
    else if (isObj(v)) readSections(c, v, SECTIONS_2B, 'reversal', docs, found);
  }
  // Documents rejected in IMS: any object whose key mentions "rej", at the top
  // level or under docdata, holding b2b / cdnr arrays (the key was never seen
  // live). A document with imsStatus 'R' is rejected wherever it sits.
  for (const container of [d, dd]) {
    for (const [key, v] of Object.entries(container)) {
      if (!/rej/i.test(key) || !isObj(v)) continue;
      handled.add(key);
      readSections(c, v, SECTIONS_2B, 'rejected', docs, found);
    }
  }
  const sectionsUnknown = Object.keys(dd).filter((k) => !handled.has(k) && Array.isArray(dd[k]) && (dd[k] as unknown[]).length > 0);
  return {
    docs,
    meta: {
      ...emptyMeta('2B', period),
      state: 'ready',
      generatedOn: parsePortalDate(d.gendt),
      sectionsRead: SECTIONS_READ_2B,
      sectionsUnknown,
    },
  };
}

/** GSTR-2A as the extension stores it → documents; null when the summary is not a 2A. */
export function docsFrom2A(summary: unknown, period: string): Statement | null {
  const d = unwrap(summary, Object.keys(SECTIONS_2A));
  if (!d) return null;
  const c: ReadCtx = { source: '2A', period, counter: { n: 0 } };
  const docs: RecoDoc[] = [];
  const found = new Set<string>();
  readSections(c, d, SECTIONS_2A, null, docs, found);
  const m = isObj(d._meta) ? d._meta : null;
  const declared = m && Array.isArray(m.sections) ? m.sections.map((s) => SECTIONS_2A[String(s).toLowerCase()]?.section ?? String(s).toUpperCase()) : null;
  const failed = m && typeof m.failed === 'number' && Number.isFinite(m.failed) ? m.failed : null;
  const failedCtins = m && Array.isArray(m.failedCtins) ? m.failedCtins.map(gstin).filter(Boolean) : null;
  // 0.14.0: the notes' own outcome, so the report can say why they were not
  // compared, or that a supplier's notes are missing because its fetch failed.
  const cdnProblem = m ? str(m.cdnProblem) : null;
  const cdnFailed = m && typeof m.cdnFailed === 'number' && Number.isFinite(m.cdnFailed) ? m.cdnFailed : null;
  const cdnFailedCtins = m && Array.isArray(m.cdnFailedCtins) ? m.cdnFailedCtins.map(gstin).filter(Boolean) : null;
  return {
    docs,
    meta: {
      ...emptyMeta('2A', period),
      state: 'ready',
      sectionsRead: declared ?? [...found],
      failedSuppliers: failed,
      failedCtins,
      cdnProblem,
      cdnFailedSuppliers: cdnFailed,
      cdnFailedCtins,
      // Before 0.13.0 a failed supplier-list call was saved as an empty 2A
      // (status NO DATA, or Pulled when every supplier failed), with no _meta.
      suspectEmpty: !m && docs.length === 0,
    },
  };
}

// ── GSTR-9 Table 8A ─────────────────────────────────────────────────────────
// The year's 8A document details, as the Reports Hub saves an upload of the
// portal's file (eightA.ts) in gst_filed_returns (return_type GSTR9_8A, period
// '03/YYYY' of the FY): one flat list, every amount positive as on the portal.

/** The format tag of a stored 8A (gst_filed_returns.summary._format). */
export const EIGHT_A_FORMAT = 'gstk-8a-docs-v1';

/** One document of a stored 8A. */
export interface Stored8ADoc {
  /** 'B2B' | 'B2BA' | 'CDNR' | 'CDNRA' (or another section the file held). */
  section: string;
  ctin: string;
  name: string | null;
  number: string;
  /** ISO. */
  date: string | null;
  /** 'INV' | 'DN' | 'CN'. */
  family: DocFamily;
  value: number;
  pos: string | null;
  reverseCharge: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  originalNumber: string | null;
  originalDate: string | null;
  /** 'MM/YYYY' the supplier reported it for. */
  supplierPeriod: string | null;
  /** ISO. */
  supplierFiledOn: string | null;
  itcAvailable: boolean | null;
  itcReason: string | null;
  irn: string | null;
}

export interface Stored8A {
  _format: typeof EIGHT_A_FORMAT;
  /** Where the documents came from: the portal's Excel or JSON. */
  origin: 'portal-excel' | 'portal-json';
  /** '2025-26'. */
  fy: string;
  gstin: string | null;
  /** The file's date of generation (ISO), when it says. */
  generatedOn: string | null;
  fileName: string | null;
  /** ISO timestamp. */
  uploadedAt: string;
  uploadedBy: string | null;
  sheetsRead: string[];
  /** Sheets with rows that were not read, and the parser's warnings. */
  unread: string[];
  warnings: string[];
  docs: Stored8ADoc[];
}

/** The sections GSTR-9 Table 8A holds: B2B invoices, debit and credit notes and their amendments. */
export const EIGHT_A_SECTIONS = ['B2B', 'B2BA', 'CDNR', 'CDNRA'];

export const isStored8A = (v: unknown): v is Stored8A => isObj(v) && v._format === EIGHT_A_FORMAT && Array.isArray(v.docs);

/** A stored 8A → documents; null when the summary is not one. */
export function docsFrom8A(summary: unknown, period: string): Statement | null {
  if (!isStored8A(summary)) return null;
  const docs = summary.docs.map((x, i): RecoDoc => ({
    ref: `8A|${period}|${x.section}|${x.ctin}|${x.number}|${i + 1}`,
    source: '8A',
    statementPeriod: period,
    section: x.section,
    isAmendment: /A$/.test(x.section),
    original: x.originalNumber || x.originalDate ? { number: x.originalNumber, date: x.originalDate } : null,
    ctin: gstin(x.ctin),
    supplierName: x.name,
    family: x.family,
    number: String(x.number ?? '').trim(),
    date: x.date,
    docValue: x.value,
    pos: x.pos,
    reverseCharge: !!x.reverseCharge,
    taxable: x.taxable,
    igst: x.igst,
    cgst: x.cgst,
    sgst: x.sgst,
    cess: x.cess,
    supplierPeriod: x.supplierPeriod,
    supplierFiledOn: x.supplierFiledOn,
    supplierFiled: x.supplierFiledOn ? true : null,
    supplier3bFiled: null,
    supplierCancelledFrom: null,
    itcAvailable: x.itcAvailable,
    itcReason: x.itcReason,
    imsStatus: null,
    bucket: null,
    irn: x.irn,
  }));
  return {
    docs,
    meta: {
      ...emptyMeta('8A', period),
      state: 'ready',
      generatedOn: summary.generatedOn,
      sectionsRead: [...new Set([...EIGHT_A_SECTIONS, ...docs.map((d) => d.section)])],
    },
  };
}

const NOT_GENERATED = /^(NF$|NOT (GENERATED|FOUND|FILED))/i;
const FAILED = /^PULL FAILED/i;

/** "2026-09-20T05:00:00Z" → the date in India, "2026-09-20". */
export const istDateOf = (ts: string | null | undefined): string | null => {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return parsePortalDate(ts);
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
};

/**
 * One stored row → its statement. Ready when the adapter can read the summary
 * (a later failed re-pull rewrites only the status, so saved figures still
 * count); not generated / failed from the status; otherwise not pulled.
 */
export function statementFromRow(row: StatementRow | undefined, source: SourceKey, period: string): Statement {
  if (!row) return { meta: emptyMeta(source, period), docs: [] };
  const adapter = source === '2A' ? docsFrom2A : source === '2B' ? docsFrom2B : docsFrom8A;
  const parsed = adapter ? adapter(row.summary, period) : null;
  const status = row.status ?? null;
  const pulledAt = istDateOf(row.updatedAt);
  if (parsed) return { docs: parsed.docs, meta: { ...parsed.meta, status, pulledAt } };
  const s = (status ?? '').trim();
  const state: StatementState = NOT_GENERATED.test(s) ? 'not_generated' : FAILED.test(s) ? 'failed' : 'not_pulled';
  return { meta: { ...emptyMeta(source, period), state, status, pulledAt }, docs: [] };
}

export const findRow = (rows: StatementRow[], source: SourceKey, period: string): StatementRow | undefined =>
  rows.find((r) => r.source === source && r.period === period);

/** Signed: a credit note counts −1 in every total, and so does an ITC reversal (Rule 37A) entry. */
export const docSign = (d: RecoDoc): number => (d.family === 'CN' ? -1 : 1) * (d.bucket === 'reversal' ? -1 : 1);
export const docTax = (d: RecoDoc): number => d.igst + d.cgst + d.sgst + d.cess;
