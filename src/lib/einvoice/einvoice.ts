// E-invoice (IRN) documents for GSTR-1. Pure functions — no I/O.
//
// Where the IRNs come from: the GST portal auto-populates every e-invoice
// (IRN generated on the IRP) into the taxpayer's GSTR-1 tables, and the
// portal's own GSTR-1 JSON download carries `irn`, `irngendate` and
// `srctyp: "e-Invoice"` on those documents. The extension downloads that
// JSON and stores the IRN-bearing documents in `einvoice_docs`
// (extractEinvoiceDocs). The client's own books JSON (gstr1_data.raw_json)
// normally has no IRN at all, so uploading it as-is replaces the
// auto-populated record and the portal drops the IRN. attachIrn() puts the
// IRN back on every matching document before the push.
//
// extension/background.js carries a plain-JS copy of normDocKey /
// docMatchKey / attachIrn (the extension has no bundler) — keep the two in
// step.

export type EinvSection = 'b2b' | 'cdnr' | 'cdnur' | 'exp' | 'b2cl';
export type EinvDocType = 'INV' | 'CRN' | 'DBN';

/** One document, from either side (portal e-invoice data or the client's books). */
export interface EinvDoc {
  section: EinvSection;
  doc_type: EinvDocType;
  doc_no: string;
  doc_key: string;
  ctin: string;
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
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

/**
 * Document number for matching: upper-case, letters and digits only. The IRP
 * and the books often differ only in separators or case ("INV/001" vs
 * "inv-001"); within one buyer and one return period that is never two
 * different documents.
 */
export const normDocKey = (docNo: unknown): string => str(docNo).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The key both sides are matched on: section + buyer GSTIN + document number. */
export const docMatchKey = (d: Pick<EinvDoc, 'section' | 'ctin' | 'doc_key'>): string =>
  `${d.section}|${str(d.ctin).toUpperCase()}|${d.doc_key}`;

const noteType = (nt: Record<string, unknown>): EinvDocType =>
  str(nt.ntty ?? nt.typ ?? 'C').toUpperCase().startsWith('D') ? 'DBN' : 'CRN';

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every B2B / CDNR / CDNUR / EXP / B2CL document in a GSTR-1 JSON (portal or books shape). */
export function extractDocs(json: unknown): EinvDoc[] {
  const j = (json || {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
  const out: EinvDoc[] = [];
  const push = (section: EinvSection, doc_type: EinvDocType, doc_no: unknown, ctin: unknown, d: Record<string, unknown>, date: unknown, pos: unknown) => {
    const t = sumItems(d.itms);
    out.push({
      section,
      doc_type,
      doc_no: str(doc_no),
      doc_key: normDocKey(doc_no),
      ctin: str(ctin).toUpperCase(),
      doc_date: str(date) || null,
      irn: str(d.irn) || null,
      irn_date: str(d.irngendate) || null,
      inv_typ: str(d.inv_typ ?? d.typ) || null,
      pos: str(pos) || null,
      doc_value: round2(num(d.val)),
      taxable: round2(t.taxable),
      igst: round2(t.igst),
      cgst: round2(t.cgst),
      sgst: round2(t.sgst),
      cess: round2(t.cess),
    });
  };
  arr(j.b2b).forEach((p) => arr(p.inv).forEach((inv) => push('b2b', 'INV', inv.inum, p.ctin, inv, inv.idt, inv.pos)));
  arr(j.cdnr).forEach((p) => arr(p.nt).forEach((nt) => push('cdnr', noteType(nt), nt.nt_num, p.ctin, nt, nt.nt_dt, nt.pos)));
  arr(j.cdnur).forEach((nt) => push('cdnur', noteType(nt), nt.nt_num, '', nt, nt.nt_dt, nt.pos));
  arr(j.exp).forEach((e) => arr(e.inv).forEach((inv) => push('exp', 'INV', inv.inum, '', { ...inv, typ: e.exp_typ }, inv.idt, null)));
  arr(j.b2cl).forEach((s) => arr(s.inv).forEach((inv) => push('b2cl', 'INV', inv.inum, '', inv, inv.idt, s.pos)));
  return out.filter((d) => d.doc_key);
}

/** The IRN-bearing documents of a portal GSTR-1 JSON — what goes into einvoice_docs. */
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
// Reconciliation: books (client JSON) vs e-invoice (IRP / portal)
// ---------------------------------------------------------------------------

export type EinvRecoStatus =
  | 'matched'        // same document, same figures
  | 'mismatch'       // same document, figures changed after the IRN was generated
  | 'not_einvoiced'  // in the books, e-invoiceable, but no IRN found
  | 'not_in_books';  // IRN generated, but the document is missing from the books

export interface EinvRecoRow {
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
  /** Human-readable list of what differs (figures, date, place of supply). */
  differences: string[];
}

/** Differences of ₹1 or less are rounding, not a change. */
export const EINV_TOLERANCE = 1;

export function reconcileEinvoice(books: EinvDoc[], einv: EinvDoc[]): EinvRecoRow[] {
  const byKey = new Map<string, { books: EinvDoc | null; einv: EinvDoc | null }>();
  books.forEach((b) => {
    const k = docMatchKey(b);
    const cur = byKey.get(k) || { books: null, einv: null };
    if (!cur.books) cur.books = b;
    byKey.set(k, cur);
  });
  einv.forEach((e) => {
    const k = docMatchKey(e);
    const cur = byKey.get(k) || { books: null, einv: null };
    if (!cur.einv) cur.einv = e;
    byKey.set(k, cur);
  });

  const rows: EinvRecoRow[] = [];
  byKey.forEach(({ books: b, einv: e }, key) => {
    const ref = (b || e)!;
    if (b && e) {
      const diff = {
        doc_value: round2(b.doc_value - e.doc_value),
        taxable: round2(b.taxable - e.taxable),
        igst: round2(b.igst - e.igst),
        cgst: round2(b.cgst - e.cgst),
        sgst: round2(b.sgst - e.sgst),
        cess: round2(b.cess - e.cess),
      };
      const differences: string[] = [];
      const label: Record<keyof typeof diff, string> = {
        doc_value: 'Document value', taxable: 'Taxable value', igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess',
      };
      (Object.keys(diff) as (keyof typeof diff)[]).forEach((f) => {
        if (Math.abs(diff[f]) > EINV_TOLERANCE) differences.push(`${label[f]} ${diff[f] > 0 ? '+' : ''}${diff[f].toFixed(2)}`);
      });
      if (b.doc_date && e.doc_date && b.doc_date !== e.doc_date) differences.push(`Date ${b.doc_date} vs ${e.doc_date}`);
      if (b.pos && e.pos && b.pos !== e.pos) differences.push(`Place of supply ${b.pos} vs ${e.pos}`);
      rows.push({ key, section: ref.section, doc_type: ref.doc_type, doc_no: b.doc_no || e.doc_no, ctin: ref.ctin, status: differences.length ? 'mismatch' : 'matched', books: b, einv: e, diff, differences });
    } else if (b) {
      if (!isEinvoiceableBookDoc(b)) return;
      rows.push({ key, section: b.section, doc_type: b.doc_type, doc_no: b.doc_no, ctin: b.ctin, status: 'not_einvoiced', books: b, einv: null, diff: null, differences: [] });
    } else if (e) {
      rows.push({ key, section: e.section, doc_type: e.doc_type, doc_no: e.doc_no, ctin: e.ctin, status: 'not_in_books', books: null, einv: e, diff: null, differences: [] });
    }
  });

  const order: Record<EinvRecoStatus, number> = { mismatch: 0, not_in_books: 1, not_einvoiced: 2, matched: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.section.localeCompare(b.section) || a.doc_no.localeCompare(b.doc_no));
}

export const summariseReco = (rows: EinvRecoRow[]) => ({
  matched: rows.filter((r) => r.status === 'matched').length,
  mismatch: rows.filter((r) => r.status === 'mismatch').length,
  notEinvoiced: rows.filter((r) => r.status === 'not_einvoiced').length,
  notInBooks: rows.filter((r) => r.status === 'not_in_books').length,
});

// ---------------------------------------------------------------------------
// Attach IRNs to the books JSON before a push
// ---------------------------------------------------------------------------

export interface AttachIrnResult {
  json: Record<string, unknown>;
  /** Documents that received an IRN from einvoice_docs. */
  attached: number;
  /** Documents that already carried an IRN in the books JSON (left as they were). */
  alreadyHad: number;
}

/**
 * Copy of `json` with `irn`, `irngendate` and `srctyp: "e-Invoice"` set on
 * every B2B / CDNR / CDNUR / EXP document that has a stored e-invoice. The
 * books figures are NOT changed — a document whose figures differ from its
 * e-invoice goes up as the books have it, and shows on the reconciliation.
 */
export function attachIrn(json: unknown, einv: Pick<EinvDoc, 'section' | 'ctin' | 'doc_key' | 'irn' | 'irn_date'>[]): AttachIrnResult {
  const copy = JSON.parse(JSON.stringify(json || {})) as Record<string, unknown>;
  const map = new Map<string, { irn: string; irn_date: string | null }>();
  einv.forEach((e) => { if (e.irn) map.set(docMatchKey(e), { irn: e.irn, irn_date: e.irn_date ?? null }); });
  let attached = 0;
  let alreadyHad = 0;
  const apply = (section: EinvSection, ctin: unknown, docNo: unknown, d: Record<string, unknown>) => {
    if (str(d.irn)) { alreadyHad += 1; return; }
    const hit = map.get(docMatchKey({ section, ctin: str(ctin).toUpperCase(), doc_key: normDocKey(docNo) }));
    if (!hit) return;
    d.irn = hit.irn;
    if (hit.irn_date) d.irngendate = hit.irn_date;
    d.srctyp = 'e-Invoice';
    attached += 1;
  };
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
  arr(copy.b2b).forEach((p) => arr(p.inv).forEach((inv) => apply('b2b', p.ctin, inv.inum, inv)));
  arr(copy.cdnr).forEach((p) => arr(p.nt).forEach((nt) => apply('cdnr', p.ctin, nt.nt_num, nt)));
  arr(copy.cdnur).forEach((nt) => apply('cdnur', '', nt.nt_num, nt));
  arr(copy.exp).forEach((e) => arr(e.inv).forEach((inv) => apply('exp', '', inv.inum, inv)));
  return { json: copy, attached, alreadyHad };
}
