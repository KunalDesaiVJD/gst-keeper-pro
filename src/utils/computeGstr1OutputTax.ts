// Sum the total output tax from a parsed GSTR-1 JSON. Used as a proxy for
// "ITC Utilized this month" (the GST Receivable Reco page and the credit
// closing report), since the output liability computed here flows into
// GSTR-3B Table 3.1, which is then settled out of the Electronic Credit Ledger.
//
// It is the GSTR-3B draft's own figure: the tax of Table 3.1(a) + 3.1(b), from
// buildGstr3bJson's gstr1OutputTax, so the two "ITC utilised" figures cannot
// differ (src/lib/gstr1/supplyKind.ts, docs/GSTR3B_OUTWARD_POSITIONS.md).
// 3.1(b) holds the IGST on exports and SEZ supplies with payment.
//
// Per project decision (June 2026): Cess is ignored entirely.
//
// What that figure takes, in short:
//   - credit notes take off, debit notes add (noteSign);
//   - advance receipts (`at`) add, advance adjustments (`txpd`) take off, on
//     every rate line;
//   - B2B invoices under reverse charge (`rchrg: 'Y'`, Table 4B), and notes
//     carrying the same flag, add no tax, from Aug-2026 only: periods before
//     that were already filed with the un-gated figure, and recomputing them
//     now would show a number that no longer matches what was filed;
//   - amendment tables (9A, 9C, 11(2), a restated Table 10) add nothing: they
//     restate an earlier document in full. A Table 10 re-rating difference
//     (the Builder's) adds its tax difference.

import { gstr1OutputTax } from './buildGstr3bJson';
import type { B2csaBaselines } from '@/lib/gstr1/b2csaBaseline';

export interface Gstr1OutputTotals {
  igst: number;
  cgst: number;
  sgst: number;
}

// baselines: what months amended in Table 10 last reported (loadB2csaBaselines);
// left out, each amended month's figure counts as nil.
export const computeGstr1OutputTax = (rawJson: unknown, periodMonth: string, baselines?: B2csaBaselines): Gstr1OutputTotals => {
  if (!rawJson || typeof rawJson !== 'object') return { igst: 0, cgst: 0, sgst: 0 };
  // alreadyFiled: true keeps the reverse-charge exclusion on its date-only
  // gate (Aug-2026 onward), as this figure always has.
  return gstr1OutputTax(rawJson, periodMonth, true, baselines);
};
