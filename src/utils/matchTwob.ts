// Import 2B — Phase 3 match/lookup helper.
//
// The books section holds ONLY invoices and debit notes the employee believes
// are missing from 2B. When a books row is added, we look it up against the
// imported (non-RCM) 2B docs to sanity-check that classification:
//   - genuinely not found          → NOT_IN_2B  (correct — it's missing)
//   - found, tax within ₹10        → ALREADY_IN_2B (warn: it's really in 2B)
//   - found, tax differs by > ₹10  → MISMATCHED (pair it to that 2B doc)
//
// Tolerant matching per the agreed rules: GSTIN exact, invoice number fuzzy
// (formatting + slight differences ignored), tax within ₹10 per head. Pure and
// framework-free so it can be unit-tested like parseGstr2b.
//
// A books row is matched only against 2B documents of its own type (an invoice
// against invoices, a debit note against debit notes). A books row is never a
// credit note, so a supplier credit note is never a candidate. When the only
// similar document is of another type (or another type carries exactly the
// row's number while its own type matches only loosely), the row stays
// NOT_IN_2B but the result names that document (otherTypeHint) so the page can
// ask whether the row's type is wrong, without pairing across types. An exact
// number beats a loose one, then the closest tax. An amendment is compared at
// its revised (full) figures; the caller passes those in.

import { docTypeOf } from '@/lib/twobDocs';

export interface TwoBLite {
  id: string;
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  docType?: string | null; // INVOICE / DEBIT_NOTE / CREDIT_NOTE (blank = INVOICE)
}

export interface BookLite {
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  docType?: string | null; // INVOICE / DEBIT_NOTE (blank = INVOICE)
}

export type BookClassification = 'NOT_IN_2B' | 'ALREADY_IN_2B' | 'MISMATCHED';

export interface ClassifyResult {
  classification: BookClassification;
  match: TwoBLite | null; // the 2B doc it matched (for ALREADY_IN_2B / MISMATCHED)
  taxDiff: { igst: number; cgst: number; sgst: number } | null; // book − 2B, per head
  // NOT_IN_2B only: a similar-numbered 2B document from the same supplier, of
  // another type. Never paired; shown so staff can check the row's type.
  otherTypeHint?: TwoBLite | null;
}

export const TAX_TOLERANCE = 10; // ₹ per head
const INVOICE_EDIT_DISTANCE = 2;

export function normalizeInvoiceNo(v: string | null | undefined): string {
  return String(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') // drop spaces, slashes, dashes, etc.
    .replace(/^0+/, ''); // drop leading zeros (e.g. 0036 == 36)
}

function normalizeGstin(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/\s/g, '').trim();
}

// Small Levenshtein — invoice numbers are short, so this is cheap.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// "Slight difference acceptable": equal after normalization, one contains the
// other, or edit-distance within threshold.
export function invoiceSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeInvoiceNo(a);
  const nb = normalizeInvoiceNo(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return editDistance(na, nb) <= INVOICE_EDIT_DISTANCE;
}

export function taxWithinTolerance(a: BookLite | TwoBLite, b: BookLite | TwoBLite, tol = TAX_TOLERANCE): boolean {
  return (
    Math.abs((a.inputIgst || 0) - (b.inputIgst || 0)) <= tol &&
    Math.abs((a.inputCgst || 0) - (b.inputCgst || 0)) <= tol &&
    Math.abs((a.inputSgst || 0) - (b.inputSgst || 0)) <= tol
  );
}

// Same supplier GSTIN + a similar invoice number, of any type.
function findSimilar(book: BookLite, twoB: TwoBLite[]): TwoBLite[] {
  const g = normalizeGstin(book.supplierGstin);
  if (!g) return [];
  return twoB.filter(
    (d) => normalizeGstin(d.supplierGstin) === g && invoiceSimilar(d.supplierInvoiceNumber, book.supplierInvoiceNumber),
  );
}

const sameType = (book: BookLite, d: TwoBLite) =>
  docTypeOf({ doc_type: d.docType }) === docTypeOf({ doc_type: book.docType });

// Candidate = same supplier GSTIN + a similar invoice number + the same type.
export function findTwoBCandidates(book: BookLite, twoB: TwoBLite[]): TwoBLite[] {
  return findSimilar(book, twoB).filter((d) => sameType(book, d));
}

const taxScore = (book: BookLite, d: TwoBLite) =>
  Math.abs((book.inputIgst || 0) - (d.inputIgst || 0)) +
  Math.abs((book.inputCgst || 0) - (d.inputCgst || 0)) +
  Math.abs((book.inputSgst || 0) - (d.inputSgst || 0));

function taxDelta(a: BookLite, b: TwoBLite) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    igst: r2((a.inputIgst || 0) - (b.inputIgst || 0)),
    cgst: r2((a.inputCgst || 0) - (b.inputCgst || 0)),
    sgst: r2((a.inputSgst || 0) - (b.inputSgst || 0)),
  };
}

// Classify a books row being added against the imported 2B set.
export function classifyBookAgainst2b(book: BookLite, twoB: TwoBLite[]): ClassifyResult {
  const similar = findSimilar(book, twoB);
  const no = normalizeInvoiceNo(book.supplierInvoiceNumber);
  const exact = (d: TwoBLite) => normalizeInvoiceNo(d.supplierInvoiceNumber) === no;
  const candidates = similar.filter((d) => sameType(book, d));
  const others = similar.filter((d) => !sameType(book, d));
  const byFit = (x: TwoBLite, y: TwoBLite) => Number(!exact(x)) - Number(!exact(y)) || taxScore(book, x) - taxScore(book, y);
  // No same-type candidate, or only a fuzzy one while another type carries
  // exactly this number (an invoice row "DN/12" next to 2B's debit note
  // DN/12): not paired, and the other document is named.
  if (candidates.length === 0 || (!candidates.some(exact) && others.some(exact))) {
    const other = [...others].sort(byFit)[0];
    return { classification: 'NOT_IN_2B', match: null, taxDiff: null, otherTypeHint: other ?? null };
  }
  // Prefer an exact number, then the candidate whose tax is closest (smallest total absolute diff).
  const best = [...candidates].sort(byFit)[0];

  if (taxWithinTolerance(book, best)) {
    return { classification: 'ALREADY_IN_2B', match: best, taxDiff: taxDelta(book, best) };
  }
  return { classification: 'MISMATCHED', match: best, taxDiff: taxDelta(book, best) };
}
