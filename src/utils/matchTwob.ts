// Import 2B — Phase 3 match/lookup helper.
//
// The books section holds ONLY invoices the employee believes are missing from
// 2B. When a book invoice is added, we look it up against the imported (non-RCM)
// 2B docs to sanity-check that classification:
//   - genuinely not found          → NOT_IN_2B  (correct — it's missing)
//   - found, tax within ₹10        → ALREADY_IN_2B (warn: it's really in 2B)
//   - found, tax differs by > ₹10  → MISMATCHED (pair it to that 2B doc)
//
// Tolerant matching per the agreed rules: GSTIN exact, invoice number fuzzy
// (formatting + slight differences ignored), tax within ₹10 per head. Pure and
// framework-free so it can be unit-tested like parseGstr2b.

export interface TwoBLite {
  id: string;
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
}

export interface BookLite {
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
}

export type BookClassification = 'NOT_IN_2B' | 'ALREADY_IN_2B' | 'MISMATCHED';

export interface ClassifyResult {
  classification: BookClassification;
  match: TwoBLite | null; // the 2B doc it matched (for ALREADY_IN_2B / MISMATCHED)
  taxDiff: { igst: number; cgst: number; sgst: number } | null; // book − 2B, per head
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

// Candidate = same supplier GSTIN + a similar invoice number.
export function findTwoBCandidates(book: BookLite, twoB: TwoBLite[]): TwoBLite[] {
  const g = normalizeGstin(book.supplierGstin);
  if (!g) return [];
  return twoB.filter(
    (d) => normalizeGstin(d.supplierGstin) === g && invoiceSimilar(d.supplierInvoiceNumber, book.supplierInvoiceNumber),
  );
}

function taxDelta(a: BookLite, b: TwoBLite) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    igst: r2((a.inputIgst || 0) - (b.inputIgst || 0)),
    cgst: r2((a.inputCgst || 0) - (b.inputCgst || 0)),
    sgst: r2((a.inputSgst || 0) - (b.inputSgst || 0)),
  };
}

// Classify a book invoice being added against the imported 2B set.
export function classifyBookAgainst2b(book: BookLite, twoB: TwoBLite[]): ClassifyResult {
  const candidates = findTwoBCandidates(book, twoB);
  if (candidates.length === 0) {
    return { classification: 'NOT_IN_2B', match: null, taxDiff: null };
  }
  // Prefer the candidate whose tax is closest (smallest total absolute diff).
  const best = candidates
    .map((d) => ({
      d,
      score:
        Math.abs((book.inputIgst || 0) - d.inputIgst) +
        Math.abs((book.inputCgst || 0) - d.inputCgst) +
        Math.abs((book.inputSgst || 0) - d.inputSgst),
    }))
    .sort((x, y) => x.score - y.score)[0].d;

  if (taxWithinTolerance(book, best)) {
    return { classification: 'ALREADY_IN_2B', match: best, taxDiff: taxDelta(book, best) };
  }
  return { classification: 'MISMATCHED', match: best, taxDiff: taxDelta(book, best) };
}
