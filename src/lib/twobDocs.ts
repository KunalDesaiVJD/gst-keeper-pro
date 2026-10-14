// What a GSTR-2B document is in Import 2B, in one place: its type (invoice,
// supplier debit note, supplier credit note, or an amendment of one), the
// colour it is shown in, what it changes this month, and which treatments it
// may take. Pure and framework-free; Import 2B, the posting engine, ITC
// Summary and GSTR-3B all read documents through these helpers.
//
// The firm's positions (14 Oct 2026, docs/2B_RECONCILIATION_FLOW.md §10):
//  - A supplier debit note is claimed like an invoice (ITC Summary row 5.1).
//  - A supplier credit note reduces ITC through row 5.3 "Debit Note" (what the
//    firm's books call the purchase return). Amounts stay positive as on the
//    2B; the type gives the sign.
//  - An amendment (B2BA / B2B-CDNRA) counts only its difference: its full
//    figures minus base_*, the figures of the earlier version Import 2B
//    already counted. It follows that version's treatment; the confirmed
//    original is never touched. With no earlier version in Import 2B it is
//    HELD and counted nowhere until staff decide, or until staff enter what
//    the earlier version counted (base_* with no amends_doc_id). A note
//    amendment that flips the type (credit into debit, or the reverse) adds
//    the base instead (flipsNoteType), so the whole change lands in the
//    revised type's row.

import { normalizeInvoiceNo } from '@/utils/matchTwob';

export type TwobDocType = 'INVOICE' | 'DEBIT_NOTE' | 'CREDIT_NOTE';

/** The columns these helpers read (a twob_import_docs row, or part of one). */
export interface TwobDocLike {
  doc_type?: string | null;
  is_amendment?: boolean | null;
  original_doc_type?: string | null;
  taxable_value?: number | null;
  input_igst?: number | null;
  input_cgst?: number | null;
  input_sgst?: number | null;
  cess?: number | null;
  base_taxable_value?: number | null;
  base_input_igst?: number | null;
  base_input_cgst?: number | null;
  base_input_sgst?: number | null;
  base_cess?: number | null;
  ims_reduce_required?: string | null;
  declared_igst?: number | null;
  declared_cgst?: number | null;
  declared_sgst?: number | null;
  declared_cess?: number | null;
}

export interface DocFigures { taxable: number; igst: number; cgst: number; sgst: number; cess: number }

const n = (v: number | null | undefined) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export const docTypeOf = (d: { doc_type?: string | null }): TwobDocType =>
  d.doc_type === 'DEBIT_NOTE' || d.doc_type === 'CREDIT_NOTE' ? d.doc_type : 'INVOICE';

export const isCreditNote = (d: { doc_type?: string | null }) => docTypeOf(d) === 'CREDIT_NOTE';

/** +1 adds ITC (invoice, debit note); −1 reduces it (credit note). */
export const itcSign = (d: { doc_type?: string | null }): 1 | -1 => (isCreditNote(d) ? -1 : 1);

/**
 * The document's full figures as they count for ITC. As on the 2B, except a
 * credit note the recipient accepted in IMS with "ITC to be reduced: Yes" and
 * a declared amount: then the declared tax is what reduces ITC (GSTN advisory,
 * from the October 2025 tax period). A blank declared head counts as zero
 * when any head was declared.
 */
export function fullFigures(d: TwobDocLike): DocFigures {
  const declared = isCreditNote(d) && d.ims_reduce_required === 'YES'
    && [d.declared_igst, d.declared_cgst, d.declared_sgst, d.declared_cess].some((v) => v !== null && v !== undefined);
  return {
    taxable: n(d.taxable_value),
    igst: declared ? n(d.declared_igst) : n(d.input_igst),
    cgst: declared ? n(d.declared_cgst) : n(d.input_cgst),
    sgst: declared ? n(d.declared_sgst) : n(d.input_sgst),
    cess: declared ? n(d.declared_cess) : n(d.cess),
  };
}

/**
 * A note amendment (B2B-CDNRA) that turns a credit note into a debit note, or
 * the reverse. The earlier version's effect had the other sign, so undoing it
 * moves ITC the same way as the revised note.
 */
export const flipsNoteType = (d: { doc_type?: string | null; is_amendment?: boolean | null; original_doc_type?: string | null }) =>
  !!d.is_amendment && !!d.original_doc_type && itcSign({ doc_type: d.original_doc_type }) !== itcSign(d);

/**
 * What the document changes this month, before its sign: for an amendment its
 * full figures minus the base (what the earlier version counted; zero when no
 * earlier version is in Import 2B); for anything else its full figures. When
 * the amendment flips the note type the base is added instead, all in the
 * revised type's terms: a credit note of 100 revised into a debit note of 100
 * adds 200 (the reduction undone, and the debit note claimed).
 */
export function effectFigures(d: TwobDocLike): DocFigures {
  const f = fullFigures(d);
  if (!d.is_amendment) return f;
  const k = flipsNoteType(d) ? 1 : -1;
  return {
    taxable: r2(f.taxable + k * n(d.base_taxable_value)),
    igst: r2(f.igst + k * n(d.base_input_igst)),
    cgst: r2(f.cgst + k * n(d.base_input_cgst)),
    sgst: r2(f.sgst + k * n(d.base_input_sgst)),
    cess: r2(f.cess + k * n(d.base_cess)),
  };
}

/** The effect with its sign: what the document does to this month's ITC. */
export function signedEffect(d: TwobDocLike): DocFigures {
  const e = effectFigures(d);
  const s = itcSign(d);
  return { taxable: s * e.taxable, igst: s * e.igst, cgst: s * e.cgst, sgst: s * e.sgst, cess: s * e.cess };
}

// ---- Labels and colours ----------------------------------------------------

export const DOC_TYPE_LABEL: Record<TwobDocType, string> = {
  INVOICE: 'Invoice',
  DEBIT_NOTE: 'Debit note',
  CREDIT_NOTE: 'Credit note',
};

/** "Invoice", "Credit note", "Amended invoice", "Amended debit note", … */
export const docLabel = (d: { doc_type?: string | null; is_amendment?: boolean | null }) => {
  const base = DOC_TYPE_LABEL[docTypeOf(d)];
  return d.is_amendment ? `Amended ${base.toLowerCase()}` : base;
};

/** One colour per kind of document; an amendment has its own whatever it amends. */
export type TwobTone = 'invoice' | 'debit' | 'credit' | 'amendment';

export const docTone = (d: { doc_type?: string | null; is_amendment?: boolean | null }): TwobTone => {
  if (d.is_amendment) return 'amendment';
  const t = docTypeOf(d);
  return t === 'DEBIT_NOTE' ? 'debit' : t === 'CREDIT_NOTE' ? 'credit' : 'invoice';
};

export const TONE_LABEL: Record<TwobTone, string> = {
  invoice: 'Invoice',
  debit: 'Debit note',
  credit: 'Credit note',
  amendment: 'Amendment',
};

/** Row tint (on the <tr>), light and dark. Invoices stay plain. */
export const TONE_ROW: Record<TwobTone, string> = {
  invoice: '',
  debit: 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50',
  credit: 'bg-rose-50 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50',
  amendment: 'bg-violet-50 hover:bg-violet-100/70 dark:bg-violet-950/30 dark:hover:bg-violet-950/50',
};

/** A stripe on the row's first cell, so the kind reads even on a hovered or selected row. */
export const TONE_STRIPE: Record<TwobTone, string> = {
  invoice: 'border-l-4 border-l-transparent',
  debit: 'border-l-4 border-l-amber-500',
  credit: 'border-l-4 border-l-rose-500',
  amendment: 'border-l-4 border-l-violet-500',
};

/** The small type badge. */
export const TONE_BADGE: Record<TwobTone, string> = {
  invoice: 'border-border bg-muted text-muted-foreground',
  debit: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100',
  credit: 'border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-700 dark:bg-rose-900/50 dark:text-rose-100',
  amendment: 'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-900/50 dark:text-violet-100',
};

// ---- Treatments ------------------------------------------------------------

export const TWOB_ACTION_LABEL: Record<string, string> = {
  MATCHED: 'Matched',
  INELIGIBLE: 'Ineligible',
  ITC_OF_OTHERS: 'ITC of Others',
  MISMATCHED: 'Mismatched',
  NOT_IN_BOOKS: 'Not in Books',
  RECLAIM: 'Reclaim',
  HELD: 'Held, not counted',
};

/** Actions that count a document in this month's ITC (row 5.1, or 5.3 for a credit note). */
export const COUNTED_ACTIONS = ['MATCHED', 'MISMATCHED'] as const;

export const isCountedAction = (a: string | null | undefined) => a === 'MATCHED' || a === 'MISMATCHED';

/**
 * A treatment under which a document counted nowhere, by staff's or the
 * portal's decision (blocked, or not the client's ITC). An amendment of such a
 * version has nothing to undo: its base is zero. HELD is not one of these: a
 * held version is still to be decided, so a later amendment waits for it.
 */
export const countedNothing = (a: string | null | undefined) => a === 'INELIGIBLE' || a === 'ITC_OF_OTHERS';

/**
 * The treatments a document may take. A credit note reduces ITC or is left
 * out: it is never parked as Not in Books (the portal has already reduced the
 * ITC) and never evidences a reclaim. An amendment never evidences a reclaim
 * either (its original was already in an earlier 2B). HELD is set only by the
 * import; it is offered back only on a row that holds it.
 */
export function allowedActions(d: { doc_type?: string | null; is_amendment?: boolean | null }, current?: string | null): string[] {
  let list: string[];
  if (isCreditNote(d)) list = ['MATCHED', 'MISMATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS'];
  else if (d.is_amendment) list = ['MATCHED', 'MISMATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'NOT_IN_BOOKS'];
  else list = ['MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS', 'RECLAIM'];
  if (current === 'HELD') list = ['HELD', ...list];
  return list;
}

export const canEvidenceReclaim = (d: { doc_type?: string | null; is_amendment?: boolean | null }) =>
  !d.is_amendment && !isCreditNote(d);

export interface DefaultActionInput {
  reverseCharge: boolean;
  bucket: string;
  itcAvailable: boolean | null;
  docType: TwobDocType;
  isAmendment: boolean;
  imsReduceRequired?: string | null;
}

/** The revised document itself says it gives no ITC: ITC Availability No, or for a credit note IMS "no ITC to be reduced". */
export const revisedNotAvailable = (r: Pick<DefaultActionInput, 'docType' | 'itcAvailable' | 'imsReduceRequired'>) =>
  r.docType === 'CREDIT_NOTE' ? r.imsReduceRequired === 'NO' : r.itcAvailable === false;

/**
 * The treatment a freshly imported document starts with. For an amendment,
 * `earlierAction` is the treatment of the version it amends (undefined when
 * none is in Import 2B, which makes it HELD) and `earlierItcAvailable` that
 * version's ITC Availability.
 *  - Reverse charge: hidden here (RCM Summary), left Matched as before.
 *  - IMS rejected, or Rule 37A ITC reversal: Ineligible (not claimed in 5.1;
 *    a Rule 37A reversal is typed in 4B(2)(ii)).
 *  - Amendment: HELD while the earlier version is missing or itself held.
 *    Ineligible when the revised document gives no ITC (revisedNotAvailable;
 *    the import then names the earlier version's counted figures, which stay
 *    claimed in their month and are reversed by hand). Otherwise the earlier
 *    version's treatment (a reclaim or a mismatch counts as Matched; a debit
 *    note parked Not in Books and revised into a credit note is Matched,
 *    reducing in full: see baseFrom), except that a version the portal had
 *    made ineligible (ITC Availability No) and the revision makes available
 *    is Matched: the usual place of supply correction.
 *  - Credit note: reduces ITC (Matched) even when ITC Availability is No (the
 *    2B's instructions keep the reversal on credit notes), unless the
 *    recipient declared in IMS that no ITC is to be reduced.
 *  - Otherwise: Ineligible when ITC Availability is No, else Matched.
 */
export function defaultAction(r: DefaultActionInput, earlierAction?: string | null, earlierItcAvailable?: boolean | null): string {
  if (r.reverseCharge) return 'MATCHED';
  if (r.bucket === 'rejected' || r.bucket === 'reversal') return 'INELIGIBLE';
  if (r.isAmendment) {
    if (!earlierAction || earlierAction === 'HELD') return 'HELD';
    if (revisedNotAvailable(r)) return 'INELIGIBLE';
    if (earlierAction === 'RECLAIM' || earlierAction === 'MISMATCHED') return 'MATCHED';
    if (earlierAction === 'NOT_IN_BOOKS' && r.docType === 'CREDIT_NOTE') return 'MATCHED';
    if (earlierAction === 'INELIGIBLE' && earlierItcAvailable === false && r.itcAvailable === true && r.docType !== 'CREDIT_NOTE') return 'MATCHED';
    return earlierAction;
  }
  if (r.docType === 'CREDIT_NOTE') return r.imsReduceRequired === 'NO' ? 'INELIGIBLE' : 'MATCHED';
  return r.itcAvailable === false ? 'INELIGIBLE' : 'MATCHED';
}

// ---- Identity, amendments and re-import ------------------------------------

/** MM/YYYY → a number that orders periods. */
export const periodOrder = (p: string | null | undefined) => {
  const [mm, yyyy] = String(p || '').split('/').map((x) => parseInt(x, 10));
  return (yyyy || 0) * 12 + (mm || 0);
};

const gstinKey = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/\s/g, '');

/**
 * A document's identity within one month's import: type, amendment or not,
 * supplier and number (and, for an amendment, the number it amends). Exact
 * after normalising the number (case, punctuation, leading zeros), never fuzzy.
 * A re-import keeps the row (its id, treatment and links) whose key matches.
 */
export const docKey = (d: {
  doc_type?: string | null; is_amendment?: boolean | null; supplier_gstin?: string | null;
  supplier_invoice_number?: string | null; original_doc_number?: string | null;
}) => [
  docTypeOf(d), d.is_amendment ? 'A' : 'O', gstinKey(d.supplier_gstin),
  normalizeInvoiceNo(d.supplier_invoice_number), d.is_amendment ? normalizeInvoiceNo(d.original_doc_number) : '',
].join('|');

export interface EarlierVersionCandidate extends TwobDocLike {
  id: string;
  period_month: string;
  supplier_gstin: string | null;
  supplier_invoice_number: string | null;
  original_doc_number?: string | null;
  original_doc_date?: string | null;
  date?: string | null;
  itc_action: string;
  itc_available?: boolean | null;
  imported_at?: string | null;
}

/** Invoices form one family, debit and credit notes another (a note amendment may flip the note type). */
const docFamily = (t: string | null | undefined) => (docTypeOf({ doc_type: t }) === 'INVOICE' ? 'INVOICE' : 'NOTE');
const sameDay = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a.slice(0, 10) === b.slice(0, 10);

/**
 * The earlier version an amendment amends, among this client's documents from
 * the same supplier: from EARLIER periods, or an original in the same period
 * (a late filer's invoice and its amendment can arrive in one 2B; the caller
 * passes the file's originals in). It is
 *  - an original of the amended type whose number (and date, when both are
 *    known) is the amendment's original number and date, or
 *  - an earlier amendment of the same document: of the same family (a note
 *    amendment may have flipped the note type, so not filtered by type) that
 *    names the same original, or whose revised number and date are this
 *    amendment's original.
 * The date check keeps a number reused in a later year (numbering that
 * restarts each April) from being taken for the original. The latest period
 * wins; within a period an amendment beats the original it amended.
 */
export function findEarlierVersion<T extends EarlierVersionCandidate>(
  amend: {
    supplier_gstin: string | null; original_doc_number: string | null; original_doc_date?: string | null;
    original_doc_type?: string | null; doc_type?: string | null;
  },
  currentPeriod: string,
  candidates: T[],
): T | null {
  const g = gstinKey(amend.supplier_gstin);
  const no = normalizeInvoiceNo(amend.original_doc_number);
  if (!g || !no) return null;
  const type = docTypeOf({ doc_type: amend.original_doc_type || amend.doc_type });
  const date = amend.original_doc_date;
  const cur = periodOrder(currentPeriod);
  const hits = candidates.filter((c) => {
    const p = periodOrder(c.period_month);
    if (p > cur || (p === cur && c.is_amendment)) return false;
    if (gstinKey(c.supplier_gstin) !== g) return false;
    if (!c.is_amendment) {
      return docTypeOf(c) === type && normalizeInvoiceNo(c.supplier_invoice_number) === no && sameDay(c.date, date);
    }
    if (docFamily(c.doc_type) !== docFamily(type)) return false;
    if (normalizeInvoiceNo(c.original_doc_number) === no) return sameDay(c.original_doc_date, date);
    return normalizeInvoiceNo(c.supplier_invoice_number) === no && sameDay(c.date, date);
  });
  if (hits.length === 0) return null;
  return hits.sort((a, b) =>
    periodOrder(b.period_month) - periodOrder(a.period_month)
    || Number(!!b.is_amendment) - Number(!!a.is_amendment)
    || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))[0];
}

/**
 * The base_* columns an amendment stores from its earlier version: what that
 * version counted, its full figures. Zero when it counted nothing:
 *  - it was Ineligible or ITC of Others (countedNothing), so a revision that
 *    makes it eligible claims in full (a place of supply correction claims
 *    the revised CGST and SGST, not those less the old IGST);
 *  - it was a debit note parked Not in Books and the revision is a credit
 *    note: its figures sit on the Not in Books ledger, never claimed, so the
 *    credit note reduces in full and the parked entry stays for staff to
 *    clear.
 * A held earlier version keeps its figures: it is to be counted once settled
 * (the amendment waits for it, HELD).
 *
 * The sign. effectFigures adds the base when the 2B's original type differs
 * from the revised type (flipsNoteType) and subtracts it otherwise. What is
 * right is decided by the earlier version's own type, which can differ from
 * the 2B's "original" type when an earlier amendment already flipped it (the
 * 2B names the first note of a chain). So the base is stored negative when
 * the two disagree: credit note 100, amended into a debit note 100 (+200),
 * then into a debit note 150 against that debit note gives +50, not +250.
 */
export function baseFrom(
  earlier: (TwobDocLike & { itc_action?: string | null }) | null,
  amend?: { doc_type?: string | null; is_amendment?: boolean | null; original_doc_type?: string | null },
) {
  if (!earlier) {
    return { base_taxable_value: null, base_input_igst: null, base_input_cgst: null, base_input_sgst: null, base_cess: null };
  }
  const zero = { base_taxable_value: 0, base_input_igst: 0, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 };
  if (countedNothing(earlier.itc_action)) return zero;
  if (amend && isCreditNote(amend) && !isCreditNote(earlier) && earlier.itc_action === 'NOT_IN_BOOKS') return zero;
  const f = fullFigures(earlier);
  const reverses = !!amend && itcSign(earlier) !== itcSign(amend);
  const k = !amend || reverses === flipsNoteType({ ...amend, is_amendment: true }) ? 1 : -1;
  return {
    base_taxable_value: k * f.taxable, base_input_igst: k * f.igst, base_input_cgst: k * f.cgst,
    base_input_sgst: k * f.sgst, base_cess: k * f.cess,
  };
}
