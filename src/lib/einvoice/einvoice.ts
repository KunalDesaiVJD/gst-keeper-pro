// E-invoice (IRN) documents for GSTR-1. Pure functions, no I/O.
//
// Read docs/GSTR1_EINVOICE_POSITIONS.md before changing anything here.
//
// The elected mechanism is "keep, don't re-send". The GST portal
// auto-populates every e-invoice (IRN generated on the IRP) into the
// taxpayer's GSTR-1 two days after the IRN, with Source, IRN and IRN date.
// GSTN's advisory (para 6) says an edited auto-populated document loses
// those three fields and counts as the taxpayer's own upload, and the
// offline-tool FAQ says an uploaded record overwrites the earlier one. So a
// books document that a pull taken today saw on the draft as an e-invoice,
// with the same figures, is LEFT OUT of the uploaded JSON, and the portal
// keeps its own record with the IRN. A document whose e-invoice is still
// pending auto-population is never left out: it blocks the push until a
// later pull shows it on the draft, or goes up from the books (its IRN not
// linked, para 3(c)) when staff override. Everything else is uploaded as
// before; Table 12 and Table 13 always go in full.
//
// Where the e-invoice records come from (einvoice_docs.source):
//   'portal_gstr1'   the extension's pull of the portal's GSTR-1 JSON (the
//                    documents on the draft that still carry an IRN);
//   'einvoice_excel' the GSTR-1 dashboard's "Download details from
//                    e-invoices (Excel)" (src/lib/einvoice/excel.ts), which
//                    also lists IRNs not (yet) on the draft.
//
// attachIrn (which wrote irn / irngendate / srctyp into the upload) was
// removed on 10 Oct 2026: it rested on the untested assumption that the
// portal keeps an IRN sent inside an uploaded JSON, which the advisory
// contradicts. The app never writes irn, irngendate or srctyp into an
// upload.
//
// extension/background.js carries a plain-JS copy of extractDocs, exactKey
// and the leave-out step (the extension has no bundler). Keep them in step.
// The reverse-charge flag, e-commerce GSTIN and shipping bill are compared
// only here: a pulled record keeps them in `raw` (the document as the portal
// gave it), so the extension's copy does not need them.

export type EinvSection = 'b2b' | 'cdnr' | 'cdnur' | 'exp' | 'b2cl';
export type EinvDocType = 'INV' | 'CRN' | 'DBN';
export type EinvSource = 'portal_gstr1' | 'einvoice_excel';
export type EinvIrnStatus = 'valid' | 'cancelled';
export type EinvAutopopStatus = 'done' | 'pending' | 'failed';

/**
 * A document's identity, shared by the page, the extension and the DB:
 * section, buyer GSTIN upper-cased ('' for exp, cdnur and b2cl), document
 * type (notes from ntty C / D) and the document number exactly as in the
 * JSON, trimmed.
 */
export interface EinvDocIdentity {
  section: EinvSection;
  ctin: string;
  doc_type: EinvDocType;
  doc_no: string;
}

/** One document, from either side (portal e-invoice data or the client's books). */
export interface EinvDoc extends EinvDocIdentity {
  /** exactDocNo(doc_no): upper-cased, inner whitespace collapsed. */
  doc_key: string;
  doc_date: string | null;
  irn: string | null;
  irn_date: string | null;
  inv_typ: string | null;
  pos: string | null;
  doc_value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** The document itself carries a non-empty irn (a JSON downloaded from the portal). */
  books_irn?: boolean;
  /** E-invoice records only: where the record came from. Missing = 'portal_gstr1'. */
  source?: EinvSource | string | null;
  /** E-invoice Excel only: Valid / Cancelled on the IRP. */
  irn_status?: EinvIrnStatus | null;
  /** E-invoice Excel only: GSTR-1 auto-population status. */
  autopop_status?: EinvAutopopStatus | null;
  /** E-invoice Excel only: date of auto-population (or deletion), dd-mm-yyyy. */
  autopop_date?: string | null;
  /** E-invoice Excel only: error in auto-population / deletion. */
  error?: string | null;
  /** Stored rows: when the latest pull last saw the document (a record only; never compared). */
  last_seen_at?: string | null;
  /**
   * Pulled records only: set by the pull that no longer saw the document on
   * the draft (the row is kept, with its IRN, and reads as 'irn_lost'). The
   * only thing that marks a pulled record lost.
   */
  gone_at?: string | null;
  /** Reverse charge, 'Y' or 'N' (B2B and notes); null when the source does not say. */
  rchrg?: string | null;
  /** E-commerce operator's GSTIN, upper-cased; null when none. */
  etin?: string | null;
  /** Exports: shipping bill number, date (dd-mm-yyyy) and port code; null when none. */
  sbnum?: string | null;
  sbdt?: string | null;
  sbpcode?: string | null;
  /** Stored rows: the document as the portal gave it (pull), or the Excel's own fields. */
  raw?: unknown;
}

/** Stored row (einvoice_docs). */
export interface EinvoiceDocRow extends EinvDoc {
  id?: string;
  client_id: string;
  period_month: string;
  raw?: unknown;
  first_seen_at?: string;
  last_seen_at?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
/** 'Y' / 'Yes' → 'Y', 'N' / 'No' → 'N', anything else → null. */
export const yesNo = (v: unknown): 'Y' | 'N' | null => {
  const s = str(v).toUpperCase();
  return s.startsWith('Y') ? 'Y' : s.startsWith('N') ? 'N' : null;
};

/** Sections whose documents can be left out of an upload (GSTN auto-populates these). */
export const KEEPABLE_SECTIONS: readonly EinvSection[] = ['b2b', 'cdnr', 'cdnur', 'exp'];

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The document number as the exact-identity key holds it: trimmed, upper-cased, inner whitespace collapsed. */
export const exactDocNo = (docNo: unknown): string => str(docNo).toUpperCase().replace(/\s+/g, ' ');

/**
 * The exact-identity key: section|ctin|doc_type|DOC NO. The only key that
 * pairs a books document with an e-invoice for leaving it out of an upload.
 */
export const exactKey = (d: Pick<EinvDocIdentity, 'section' | 'ctin' | 'doc_type' | 'doc_no'>): string =>
  `${d.section}|${str(d.ctin).toUpperCase()}|${d.doc_type}|${exactDocNo(d.doc_no)}`;

/**
 * Document number with separators and case stripped ("inv-001" and
 * "INV/001" both give "INV001"). Used ONLY to detect "number differs"
 * pairs, never to pair documents for leaving them out: the portal tells
 * documents apart by their exact number, so those are two documents.
 */
export const normDocKey = (docNo: unknown): string => str(docNo).toUpperCase().replace(/[^A-Z0-9]/g, '');

const normKey = (d: Pick<EinvDocIdentity, 'section' | 'ctin' | 'doc_type' | 'doc_no'>): string =>
  `${d.section}|${str(d.ctin).toUpperCase()}|${d.doc_type}|${normDocKey(d.doc_no)}`;

/** The identity of a document, as the upload job's einvoice.keep lists it. */
export const identityOf = (d: EinvDocIdentity): EinvDocIdentity => ({
  section: d.section,
  ctin: str(d.ctin).toUpperCase(),
  doc_type: d.doc_type,
  doc_no: str(d.doc_no),
});

const noteType = (nt: Record<string, unknown>): EinvDocType =>
  str(nt.ntty).toUpperCase().startsWith('D') ? 'DBN' : 'CRN';

const sumItems = (itms: unknown) => {
  const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  (Array.isArray(itms) ? itms : []).forEach((it: Record<string, unknown>) => {
    const d = ((it?.itm_det as Record<string, unknown>) || it || {}) as Record<string, unknown>;
    t.taxable += num(d.txval);
    t.igst += num(d.iamt);
    t.cgst += num(d.camt);
    t.sgst += num(d.samt);
    t.cess += num(d.csamt);
  });
  return t;
};

/** Every B2B / CDNR / CDNUR / EXP / B2CL document in a GSTR-1 JSON (portal or books shape). */
export function extractDocs(json: unknown): EinvDoc[] {
  const j = (json || {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
  const out: EinvDoc[] = [];
  const push = (section: EinvSection, doc_type: EinvDocType, doc_no: unknown, ctin: unknown, d: Record<string, unknown>, date: unknown, pos: unknown) => {
    const t = sumItems(d.itms);
    const irn = str(d.irn);
    out.push({
      section,
      doc_type,
      doc_no: str(doc_no),
      doc_key: exactDocNo(doc_no),
      ctin: str(ctin).toUpperCase(),
      doc_date: str(date) || null,
      irn: irn || null,
      irn_date: str(d.irngendate) || null,
      books_irn: !!irn,
      inv_typ: str(d.inv_typ ?? d.typ) || null,
      pos: str(pos) || null,
      doc_value: round2(num(d.val)),
      taxable: round2(t.taxable),
      igst: round2(t.igst),
      cgst: round2(t.cgst),
      sgst: round2(t.sgst),
      cess: round2(t.cess),
      rchrg: yesNo(d.rchrg),
      etin: str(d.etin).toUpperCase() || null,
      sbnum: str(d.sbnum) || null,
      sbdt: str(d.sbdt) || null,
      sbpcode: str(d.sbpcode).toUpperCase() || null,
    });
  };
  arr(j.b2b).forEach((p) => arr(p.inv).forEach((inv) => push('b2b', 'INV', inv.inum, p.ctin, inv, inv.idt, inv.pos)));
  arr(j.cdnr).forEach((p) => arr(p.nt).forEach((nt) => push('cdnr', noteType(nt), nt.nt_num, p.ctin, nt, nt.nt_dt, nt.pos)));
  arr(j.cdnur).forEach((nt) => push('cdnur', noteType(nt), nt.nt_num, '', nt, nt.nt_dt, nt.pos));
  arr(j.exp).forEach((e) => arr(e.inv).forEach((inv) => push('exp', 'INV', inv.inum, '', { ...inv, typ: e.exp_typ }, inv.idt, null)));
  arr(j.b2cl).forEach((s) => arr(s.inv).forEach((inv) => push('b2cl', 'INV', inv.inum, '', inv, inv.idt, s.pos)));
  return out.filter((d) => d.doc_key);
}

/** The IRN-bearing documents of a portal GSTR-1 JSON: what a pull stores in einvoice_docs. */
export const extractEinvoiceDocs = (portalJson: unknown): EinvDoc[] => extractDocs(portalJson).filter((d) => !!d.irn);

/**
 * Sections where e-invoicing applies, so a books document there with no IRN
 * is worth flagging: B2B (incl. SEZ / deemed export), registered notes and
 * exports. B2CL (B2C) and unregistered notes other than exports never need one.
 */
export const isEinvoiceableBookDoc = (d: EinvDoc): boolean =>
  d.section === 'b2b' || d.section === 'cdnr' || d.section === 'exp'
  || (d.section === 'cdnur' && /^EXP/i.test(d.inv_typ || ''));

// ---------------------------------------------------------------------------
// Reconciliation: books (client JSON) vs e-invoice records (pull and Excel)
// ---------------------------------------------------------------------------

export type EinvRecoStatus =
  | 'matched'         // on the draft as an e-invoice; same figures, type, reverse charge and e-commerce GSTIN: left out of the upload
  | 'mismatch'        // same document, but figures, date, place of supply, type, reverse charge, e-commerce GSTIN or IRN differ: blocks the push
  | 'number_differs'  // books number differs from the e-invoice's only in separators or case: blocks the push
  | 'books_irn'       // the books document carries its own IRN and no e-invoice record was found: left out
  | 'not_einvoiced'   // in the books, e-invoiceable, no IRN found: uploaded
  | 'not_in_books'    // on the draft as an e-invoice but missing from the books: warning
  | 'pending'         // IRN generated, not on the draft yet: in the books it blocks the push (override uploads it); not in the books, a warning
  | 'autopop_failed'  // Excel: auto-population failed or errored: books document uploaded; with no books copy, missing from GSTR-1
  | 'irn_lost';       // was an e-invoice, but the latest pull no longer shows it with its IRN: books document uploaded; with no books copy, missing from GSTR-1

export interface EinvRecoRow {
  /** exactKey of the document. */
  key: string;
  section: EinvSection;
  doc_type: EinvDocType;
  doc_no: string;
  ctin: string;
  status: EinvRecoStatus;
  books: EinvDoc | null;
  einv: EinvDoc | null;
  /** Books − e-invoice, per figure (only when both sides exist). */
  diff: { doc_value: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number } | null;
  /**
   * Human-readable list of what differs (number, figures, date, place of
   * supply, invoice / export type, reverse charge, e-commerce GSTIN, IRN).
   * Any entry on an exact pair makes it 'mismatch'.
   */
  differences: string[];
  /** Points that do not block, such as an export's shipping bill the e-invoice lacks. */
  notes: string[];
  /** A matched export whose books shipping bill is not on the e-invoice (plan warning shippingBill). */
  shippingBill?: boolean;
}

/** Differences of ₹1 or less are rounding, not a change. */
export const EINV_TOLERANCE = 1;

export interface ReconcileOptions {
  /**
   * pulled_at of the latest successful pull for the period (einvoice_pulls
   * row with source 'portal_gstr1' and status 'ok' or 'none'; never a
   * 'stale' or 'running' pull, never the Excel import's row). With it, an
   * Excel record the pull did not see is never on the draft: pending while
   * IRN date + 2 days is not before the pull day (IST), else 'irn_lost';
   * a books IRN the pull does not show reads 'irn_lost' too. Without it,
   * an Excel record with no status or 'pending' is judged the same way
   * against today, and one that says auto-populated is taken at its word
   * (only Download JSON plans without a pull; the push needs one). A pulled
   * record reads as lost only when gone_at is set, whatever this is: no
   * timestamp is compared with it, so a pull row and records read from two
   * moments can never turn every record lost (review N1/N2).
   */
  pulledAt?: string | null;
  /** "Today" for the rule above when there is no pull; defaults to now. */
  now?: Date;
}

/** dd-mm-yyyy (optionally followed by a time) → yyyy-mm-dd; null when not a date. */
const dmyToIso = (s: string | null | undefined): string | null => {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(str(s));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
/** The IST calendar day (yyyy-mm-dd) of an ISO timestamp. */
const istDay = (iso: string): string | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 330 * 60_000).toISOString().slice(0, 10) : null;
};
const addDays = (isoDay: string, n: number): string => {
  const t = Date.parse(`${isoDay}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * Is a pull fresh enough to push on? Same IST calendar day as `now`. Takes
 * the einvoice_pulls row, of which only status 'ok' or 'none' counts (a
 * 'running', 'stale', 'pending' or 'failed' pull is never fresh: 'running'
 * is a pull still saving its records), or a pulled_at already known to be a
 * successful pull's.
 */
export const isPullFresh = (
  pull: string | { status: string; pulled_at: string } | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!pull) return false;
  const pulledAt = typeof pull === 'string' ? pull : (pull.status === 'ok' || pull.status === 'none' ? pull.pulled_at : null);
  if (!pulledAt) return false;
  const d = istDay(pulledAt);
  return !!d && d === istDay(now.toISOString());
};

type EinvState = 'on_draft' | 'pending' | 'failed' | 'lost';

const isPulledRecord = (e: EinvDoc): boolean => (e.source ?? 'portal_gstr1') !== 'einvoice_excel';

/**
 * Where an e-invoice record stands on the GSTR-1 draft. Cancelled records
 * are dropped before this. A pulled record is decided by gone_at alone; an
 * Excel record by its status and IRN date (positions §3).
 */
function einvState(e: EinvDoc, opts: ReconcileOptions): EinvState {
  if (isPulledRecord(e)) {
    // On the draft unless a later pull marked it gone. No clock is compared:
    // a pull's records and its pull row read at two moments (a pull saving
    // meanwhile, or two overlapping pulls) must not make every record lost.
    return e.gone_at ? 'lost' : 'on_draft';
  }
  // The Excel's word. Auto-population failed: never on the draft.
  if (e.autopop_status === 'failed') return 'failed';
  const pullDay = opts.pulledAt ? istDay(opts.pulledAt) : null;
  // Auto-populated, and no successful pull to say otherwise: taken at its
  // word (Download JSON only; the push needs a pull of the day).
  if (e.autopop_status === 'done' && !pullDay) return 'on_draft';
  // Pending, no status, or (with a pull) auto-populated but not in the
  // pull: auto-population runs two days after the IRN, so once IRN date + 2
  // is before the pull day (or today, without a pull) it is not coming, and
  // the record is lost; until then it is pending. An IRN date that cannot be
  // read stays pending (it blocks in the books until a pull shows it, or
  // staff override).
  const refDay = pullDay ?? istDay((opts.now ?? new Date()).toISOString());
  const irnDay = dmyToIso(e.irn_date);
  if (irnDay && refDay && addDays(irnDay, 2) < refDay) return 'lost';
  return 'pending';
}

const STATE_RANK: Record<EinvState, number> = { on_draft: 0, pending: 1, lost: 2, failed: 3 };

/**
 * A field the typed record may lack: a pulled record keeps the reverse
 * charge, e-commerce GSTIN and shipping bill in `raw` (the document as the
 * portal gave it).
 */
const extra = (d: EinvDoc, k: 'rchrg' | 'etin' | 'sbnum' | 'sbdt' | 'sbpcode'): string | null => {
  const own = str(d[k]);
  if (own) return own;
  const raw = d.raw && typeof d.raw === 'object' && !Array.isArray(d.raw) ? (d.raw as Record<string, unknown>)[k] : undefined;
  return str(raw) || null;
};
const rchrgOf = (d: EinvDoc) => yesNo(extra(d, 'rchrg'));
const etinOf = (d: EinvDoc) => (extra(d, 'etin') || '').toUpperCase() || null;

/**
 * The type code both sides are compared on: B2B and notes R, SEWP, SEWOP,
 * DE, CBW (excel.ts maps the Excel's words to these); exports WPAY / WOPAY
 * (the Excel may say EXPWP / EXPWOP, or "with payment").
 */
const invTypeKey = (section: EinvSection, v: string | null | undefined): string | null => {
  // Letters and digits only: 'B2B' must stay 'B2B' (review N7).
  const s = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (section === 'exp') {
    if (/WOP|WITHOUT/.test(s)) return 'WOPAY';
    if (/WP|WITH/.test(s)) return 'WPAY';
    return s;
  }
  if (s === 'REGULAR' || s === 'REGULARB2B' || s === 'B2B') return 'R';
  return s;
};

/**
 * An export left out to keep its IRN whose books shipping bill is not on
 * the e-invoice: filed that way, Table 6A carries the e-invoice's (none, or
 * another), and the IGST refund on a with-payment export waits for it.
 */
const shippingBillNote = (b: EinvDoc, e: EinvDoc): string | null => {
  if (b.section !== 'exp') return null;
  const bn = extra(b, 'sbnum');
  if (!bn) return null;
  const bd = extra(b, 'sbdt');
  const bp = (extra(b, 'sbpcode') || '').toUpperCase() || null;
  const en = extra(e, 'sbnum');
  const ed = extra(e, 'sbdt');
  const ep = (extra(e, 'sbpcode') || '').toUpperCase() || null;
  const show = (n: string, d: string | null, p: string | null) => `${n}${d ? ` of ${d}` : ''}${p ? ` (${p})` : ''}`;
  if (!en) return `Shipping bill ${show(bn, bd, bp)} in the books; the e-invoice has none`;
  const differs = en.toUpperCase() !== bn.toUpperCase() || (!!bd && !!ed && bd !== ed) || (!!bp && !!ep && bp !== ep);
  return differs ? `Shipping bill ${show(bn, bd, bp)} in the books; ${show(en, ed, ep)} on the e-invoice` : null;
};

function compare(b: EinvDoc, e: EinvDoc) {
  const diff = {
    doc_value: round2(b.doc_value - e.doc_value),
    taxable: round2(b.taxable - e.taxable),
    igst: round2(b.igst - e.igst),
    cgst: round2(b.cgst - e.cgst),
    sgst: round2(b.sgst - e.sgst),
    cess: round2(b.cess - e.cess),
  };
  const label: Record<keyof typeof diff, string> = {
    doc_value: 'Document value', taxable: 'Taxable value', igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess',
  };
  const differences: string[] = [];
  (Object.keys(diff) as (keyof typeof diff)[]).forEach((f) => {
    if (Math.abs(diff[f]) > EINV_TOLERANCE) differences.push(`${label[f]} ${diff[f] > 0 ? '+' : ''}${diff[f].toFixed(2)}`);
  });
  if (b.doc_date && e.doc_date && b.doc_date !== e.doc_date) differences.push(`Date ${b.doc_date} vs ${e.doc_date}`);
  if (b.pos && e.pos && b.pos !== e.pos) differences.push(`Place of supply ${b.pos} vs ${e.pos}`);
  // Who pays the tax, the kind of supply and the e-commerce operator are
  // filed as the e-invoice has them when the books copy is left out.
  // Compared only when both sides say, so a source that does not carry one
  // never blocks.
  const bt = invTypeKey(b.section, b.inv_typ);
  const et = invTypeKey(e.section, e.inv_typ);
  if (bt && et && bt !== et) differences.push(`${b.section === 'exp' ? 'Export type' : 'Invoice type'} ${b.inv_typ} vs ${e.inv_typ}`);
  const br = rchrgOf(b);
  const er = rchrgOf(e);
  if (br && er && br !== er) differences.push(`Reverse charge ${br} vs ${er}`);
  const be = etinOf(b);
  const ee = etinOf(e);
  if (be && ee && be !== ee) differences.push(`E-commerce GSTIN ${be} vs ${ee}`);
  if (b.irn && e.irn && b.irn.toLowerCase() !== e.irn.toLowerCase()) differences.push('IRN in the books differs from the e-invoice');
  return { diff, differences };
}

/**
 * Books documents against e-invoice records. Pairs by exactKey only.
 *
 * Cancelled IRNs (Excel 'Cancelled') are ignored. When the same document
 * comes from both the pull and the Excel, the pull's record decides,
 * whatever the Excel says (on the draft, or lost once marked gone): the pull
 * shows what is on the draft, the Excel only what the IRP sent (review N1 /
 * N2). The Excel fills in only documents the pull has no record of. Books
 * documents outside the e-invoice sections that have no e-invoice (B2CL,
 * CDNUR other than exports) get no row.
 */
export function reconcileEinvoice(books: EinvDoc[], einv: EinvDoc[], opts: ReconcileOptions = {}): EinvRecoRow[] {
  // 1. E-invoice records: drop cancelled ones, one per exact identity. A
  //    pulled record always beats an Excel one; between two of the same
  //    source (the keys keep them unique, so only in tests) the better state.
  const einvBest = new Map<string, { e: EinvDoc; state: EinvState }>();
  einv.forEach((e) => {
    if (e.irn_status === 'cancelled') return;
    const k = exactKey(e);
    const state = einvState(e, opts);
    const cur = einvBest.get(k);
    const better = !cur
      || (isPulledRecord(e) !== isPulledRecord(cur.e) ? isPulledRecord(e) : STATE_RANK[state] < STATE_RANK[cur.state]);
    if (better) einvBest.set(k, { e, state });
  });

  // 2. Books documents, one per exact identity (count duplicates).
  const booksBy = new Map<string, { b: EinvDoc; count: number }>();
  books.forEach((b) => {
    const k = exactKey(b);
    const cur = booksBy.get(k);
    if (cur) cur.count += 1;
    else booksBy.set(k, { b, count: 1 });
  });

  const rows: EinvRecoRow[] = [];
  const usedEinv = new Set<string>();
  const unmatchedBooks: { k: string; b: EinvDoc; count: number }[] = [];
  const row = (key: string, status: EinvRecoStatus, b: EinvDoc | null, e: EinvDoc | null, differences: string[] = [], diff: EinvRecoRow['diff'] = null): EinvRecoRow => {
    const ref = (b || e)!;
    return { key, section: ref.section, doc_type: ref.doc_type, doc_no: (b || e)!.doc_no, ctin: ref.ctin, status, books: b, einv: e, diff, differences, notes: [] };
  };
  const dupNote = (count: number) => `The books have this document ${count} times`;

  // 3. Exact pairs.
  booksBy.forEach(({ b, count }, k) => {
    const hit = einvBest.get(k);
    if (!hit) { unmatchedBooks.push({ k, b, count }); return; }
    usedEinv.add(k);
    const { diff, differences } = compare(b, hit.e);
    if (hit.state === 'failed') { rows.push(row(k, 'autopop_failed', b, hit.e, differences, diff)); return; }
    if (hit.state === 'lost') { rows.push(row(k, 'irn_lost', b, hit.e, differences, diff)); return; }
    if (count > 1) differences.unshift(dupNote(count));
    if (differences.length) { rows.push(row(k, 'mismatch', b, hit.e, differences, diff)); return; }
    if (hit.state === 'pending') { rows.push(row(k, 'pending', b, hit.e, [], diff)); return; }
    const r = row(k, 'matched', b, hit.e, [], diff);
    const sb = shippingBillNote(b, hit.e);
    if (sb) { r.notes.push(sb); r.shippingBill = true; }
    rows.push(r);
  });

  // 4. "Number differs": same section, buyer, type and number but for
  //    separators or case, against an e-invoice that is (or will be) on the
  //    draft. Uploading the books number would leave both on the portal.
  const openEinvByNorm = new Map<string, string[]>();
  einvBest.forEach(({ e, state }, k) => {
    if (usedEinv.has(k) || (state !== 'on_draft' && state !== 'pending')) return;
    const nk = normKey(e);
    openEinvByNorm.set(nk, [...(openEinvByNorm.get(nk) || []), k]);
  });
  unmatchedBooks.forEach(({ k, b, count }) => {
    const cands = (openEinvByNorm.get(normKey(b)) || []).filter((ek) => !usedEinv.has(ek));
    if (cands.length && normDocKey(b.doc_no)) {
      const ek = cands[0];
      usedEinv.add(ek);
      const e = einvBest.get(ek)!.e;
      const { diff, differences } = compare(b, e);
      differences.unshift(`Number ${b.doc_no} in the books, ${e.doc_no} on the e-invoice`);
      rows.push(row(k, 'number_differs', b, e, differences, diff));
      return;
    }
    if (b.books_irn && KEEPABLE_SECTIONS.includes(b.section)) {
      if (opts.pulledAt) {
        // A pull is on record and does not show it: no longer on the draft as an e-invoice.
        rows.push(row(k, 'irn_lost', b, null, ['The books carry an IRN, but the latest pull does not show this document with it']));
      } else if (count > 1) {
        rows.push(row(k, 'mismatch', b, null, [dupNote(count)]));
      } else {
        rows.push(row(k, 'books_irn', b, null));
      }
      return;
    }
    if (!isEinvoiceableBookDoc(b)) return;
    rows.push(row(k, 'not_einvoiced', b, null));
  });

  // 5. E-invoice records left over.
  einvBest.forEach(({ e, state }, k) => {
    if (usedEinv.has(k)) return;
    const status: EinvRecoStatus = state === 'failed' ? 'autopop_failed'
      : state === 'lost' ? 'irn_lost'
        : state === 'pending' ? 'pending'
          : 'not_in_books';
    rows.push(row(k, status, null, e));
  });

  const order: Record<EinvRecoStatus, number> = {
    mismatch: 0, number_differs: 1, autopop_failed: 2, irn_lost: 3, not_in_books: 4, pending: 5, not_einvoiced: 6, books_irn: 7, matched: 8,
  };
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.section.localeCompare(b.section) || a.doc_no.localeCompare(b.doc_no));
}

export const summariseReco = (rows: EinvRecoRow[]) => {
  const n = (s: EinvRecoStatus) => rows.filter((r) => r.status === s).length;
  return {
    matched: n('matched'),
    mismatch: n('mismatch'),
    numberDiffers: n('number_differs'),
    booksIrn: n('books_irn'),
    notEinvoiced: n('not_einvoiced'),
    notInBooks: n('not_in_books'),
    pending: n('pending'),
    autopopFailed: n('autopop_failed'),
    irnLost: n('irn_lost'),
  };
};

// ---------------------------------------------------------------------------
// The upload plan
// ---------------------------------------------------------------------------

export interface EinvUploadPlan {
  /** Books documents to LEAVE OUT of the upload (the upload job's einvoice.keep). */
  keep: EinvDocIdentity[];
  /** Rows that must be resolved before a push: 'mismatch' and 'number_differs'. No override. */
  blockers: EinvRecoRow[];
  /**
   * Books documents whose e-invoice is pending auto-population: not on the
   * draft yet, so leaving them out would leave them out of GSTR-1. They
   * block the push unless staff tick the override, which uploads them from
   * the books; their IRN is then not linked (advisory para 3(c)). To keep the
   * IRN, staff pull again once the portal shows them, then push.
   */
  pendingBlockers: EinvRecoRow[];
  warnings: {
    /** On the draft as an e-invoice but not in the books: it stays and is filed. */
    notInBooks: EinvRecoRow[];
    /** Pending auto-population and not in the books: not on the draft yet, so missing from GSTR-1 if it is filed first. */
    pending: EinvRecoRow[];
    /** Auto-population failed, books copy present: the books document is uploaded (without its IRN). */
    autopopFailed: EinvRecoRow[];
    /** No longer on the draft as an e-invoice, books copy present: the books document is uploaded (the IRN is not restored). */
    irnLost: EinvRecoRow[];
    /**
     * Auto-population failed or IRN lost, and NOT in the books: not among
     * the IRN documents on the portal draft and not in the upload, so
     * missing from GSTR-1 unless added to the books (or the IRN was
     * cancelled on the IRP). One that is on the portal without its IRN (the
     * pull stores only documents carrying one) is filed as uploaded.
     */
    missingFromReturn: EinvRecoRow[];
    /** Exports left out to keep the IRN whose books shipping bill is not on the e-invoice. */
    shippingBill: EinvRecoRow[];
  };
  /** Books documents in the reconciliation that are not left out (pending ones go up only with the override). */
  uploadCount: number;
  /** keep.length */
  keepCount: number;
}

const KEEP_STATUSES: readonly EinvRecoStatus[] = ['matched', 'books_irn'];

/**
 * What to leave out of the upload. A books document is kept out only when
 * a pull showed it on the draft with the same figures ('matched'), or it
 * carries its own IRN with no record against it ('books_irn'). A document
 * whose e-invoice is pending is never kept out (it blocks the push unless
 * overridden), and one whose e-invoice failed auto-population or was lost
 * is uploaded: left out, it would be missing from GSTR-1.
 */
export function planEinvoiceUpload(rows: EinvRecoRow[]): EinvUploadPlan {
  const keep: EinvDocIdentity[] = [];
  const seen = new Set<string>();
  let uploadCount = 0;
  rows.forEach((r) => {
    if (!r.books) return;
    if (KEEP_STATUSES.includes(r.status) && KEEPABLE_SECTIONS.includes(r.books.section)) {
      const k = exactKey(r.books);
      if (!seen.has(k)) { seen.add(k); keep.push(identityOf(r.books)); }
    } else {
      uploadCount += 1;
    }
  });
  const offDraft = (r: EinvRecoRow) => r.status === 'autopop_failed' || r.status === 'irn_lost';
  return {
    keep,
    blockers: rows.filter((r) => r.status === 'mismatch' || r.status === 'number_differs'),
    pendingBlockers: rows.filter((r) => r.status === 'pending' && !!r.books),
    warnings: {
      notInBooks: rows.filter((r) => r.status === 'not_in_books'),
      pending: rows.filter((r) => r.status === 'pending' && !r.books),
      autopopFailed: rows.filter((r) => r.status === 'autopop_failed' && !!r.books),
      irnLost: rows.filter((r) => r.status === 'irn_lost' && !!r.books),
      missingFromReturn: rows.filter((r) => offDraft(r) && !r.books),
      shippingBill: rows.filter((r) => !!r.shippingBill && !!r.books && KEEP_STATUSES.includes(r.status)),
    },
    uploadCount,
    keepCount: keep.length,
  };
}

/**
 * Copy of `json` without the kept documents: what the extension uploads.
 * Removes exactly the documents whose exactKey is in `keep` from b2b, cdnr,
 * cdnur and exp, drops buyer / export-type groups left with no documents
 * and sections left empty, and never touches any other section. Used by
 * the manual "Download JSON" path and the tests; the extension carries its
 * own copy.
 */
export function leaveOutKept(json: unknown, keep: EinvDocIdentity[]): { json: Record<string, unknown>; removed: number } {
  const copy = JSON.parse(JSON.stringify(json || {})) as Record<string, unknown>;
  const keys = new Set(keep.map((k) => exactKey(k)));
  if (!keys.size) return { json: copy, removed: 0 };
  let removed = 0;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
  const hit = (section: EinvSection, ctin: unknown, docType: EinvDocType, docNo: unknown) =>
    keys.has(exactKey({ section, ctin: str(ctin), doc_type: docType, doc_no: str(docNo) }));
  // Rewrites a section only when it lost a document; an emptied section is dropped.
  const rewrite = (section: string, before: number, groups: Record<string, unknown>[], after: number) => {
    if (after === before) return;
    removed += before - after;
    if (groups.length) copy[section] = groups;
    else delete copy[section];
  };
  const count = (groups: Record<string, unknown>[], field: string) => groups.reduce((n, g) => n + arr(g[field]).length, 0);
  if (Array.isArray(copy.b2b)) {
    const groups = arr(copy.b2b).map((p) => ({ ...p, inv: arr(p.inv).filter((inv) => !hit('b2b', p.ctin, 'INV', inv.inum)) }))
      .filter((p) => p.inv.length);
    rewrite('b2b', count(arr(copy.b2b), 'inv'), groups, count(groups, 'inv'));
  }
  if (Array.isArray(copy.cdnr)) {
    const groups = arr(copy.cdnr).map((p) => ({ ...p, nt: arr(p.nt).filter((nt) => !hit('cdnr', p.ctin, noteType(nt), nt.nt_num)) }))
      .filter((p) => p.nt.length);
    rewrite('cdnr', count(arr(copy.cdnr), 'nt'), groups, count(groups, 'nt'));
  }
  if (Array.isArray(copy.cdnur)) {
    const notes = arr(copy.cdnur).filter((nt) => !hit('cdnur', '', noteType(nt), nt.nt_num));
    rewrite('cdnur', arr(copy.cdnur).length, notes, notes.length);
  }
  if (Array.isArray(copy.exp)) {
    const groups = arr(copy.exp).map((e) => ({ ...e, inv: arr(e.inv).filter((inv) => !hit('exp', '', 'INV', inv.inum)) }))
      .filter((e) => e.inv.length);
    rewrite('exp', count(arr(copy.exp), 'inv'), groups, count(groups, 'inv'));
  }
  return { json: copy, removed };
}
