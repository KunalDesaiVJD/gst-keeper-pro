// Builder module — receipt derivation, per-unit ledger, and the GSTR-1 / 3B
// posting roll-up.
//
// THE INVARIANT this file exists to protect: every rupee of a unit's
// consideration sits in exactly one state at a time —
//
//     open_advance -> invoiced -> bu_differential_taxed -> reversed
//
// Value moves between states; it is never taxed on entering the second. That is
// why an advance later absorbed into a milestone invoice is reported twice in
// GSTR-1 (once in 11A, once negatively in 11B) but counted once in the unit's
// value-taxed total.

import {
  EFFECTIVE_RATE_PCT,
  backCalculateFromInclusive,
  computeTax,
  type BuilderRateCode,
  type TaxBreakup,
} from '@/utils/builderRates';

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export type ReceiptNature = 'ADVANCE' | 'AGAINST_INVOICE';
export type ChequeStatus = 'Cleared' | 'Pending' | 'Bounced' | 'Replaced';
export type InvoiceType =
  | 'MILESTONE' | 'BU_DIFFERENTIAL' | 'SUPPLEMENTARY' | 'CONVERSION' | 'DELAY_INTEREST';

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  MILESTONE: 'Milestone invoice',
  BU_DIFFERENTIAL: 'BU differential',
  SUPPLEMENTARY: 'Supplementary',
  CONVERSION: 'Unit conversion',
  DELAY_INTEREST: 'Delay interest',
};

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  Cleared: 'Cleared',
  Pending: 'Pending clearance',
  Bounced: 'Bounced',
  Replaced: 'Replaced',
};

// ─── Receipt derivation ─────────────────────────────────────────────────────

export interface ReceiptInput {
  amountEntered: number;
  amountIsGstInclusive: boolean;
  rateCode: BuilderRateCode;
  /** As actually deducted by the buyer; the caller can seed it from computeTds194IA. */
  tds194ia?: number;
  /** Money actually credited, when known. Left undefined we predict it. */
  bankCredit?: number | null;
}

export interface ReceiptDerivation {
  tax: TaxBreakup;
  tds194ia: number;
  /** consideration + tax − TDS: what should hit the bank. */
  expectedBankCredit: number;
  /** actual − expected. Non-zero means the entry needs a second look. */
  bankVariance: number;
}

/**
 * Turn a keyed receipt into its GST components.
 *
 * The inclusive path is Rule 35, applied at the EFFECTIVE rate (1/5/12) because
 * an inclusive receipt is inclusive of tax on the whole amount charged, not on
 * the 2/3rd taxable value. Getting this wrong is precisely the "tax paid on the
 * tax" error the correction path in a later phase has to unwind.
 *
 * TDS u/s 194-IA reduces what the builder banks, never the GST base. Circular
 * 23/2017 keeps GST out of the TDS base where it is shown separately, so TDS is
 * computed on consideration excluding tax.
 */
export const deriveReceipt = (input: ReceiptInput): ReceiptDerivation => {
  const amount = Number(input.amountEntered) || 0;
  const tax = input.amountIsGstInclusive
    ? backCalculateFromInclusive(amount, input.rateCode)
    : computeTax(amount, input.rateCode);

  const tds = round2(Number(input.tds194ia) || 0);
  const expected = round2(tax.consideration + tax.totalTax - tds);
  const actual = input.bankCredit === null || input.bankCredit === undefined
    ? expected
    : round2(Number(input.bankCredit));

  return {
    tax,
    tds194ia: tds,
    expectedBankCredit: expected,
    bankVariance: round2(actual - expected),
  };
};

/**
 * Does this receipt carry tax in its period?
 *
 * Four reasons it might not:
 *  - it is a collection against an invoice already raised, so the tax went out
 *    with that invoice;
 *  - the cheque bounced, so no consideration was ever received;
 *  - it replaces an earlier receipt whose GST already went out — a funding swap
 *    (own money returned, bank disbursement received for the same unit) changes
 *    how the money arrived, not what was sold;
 *  - a BU event has since subsumed it — the differential invoice now carries
 *    this rupee's tax instead, so counting the receipt here too would tax it
 *    twice: once as an open advance, once inside the differential.
 */
export const receiptPostsTax = (r: {
  receipt_nature: ReceiptNature;
  cheque_status: ChequeStatus;
  gst_already_discharged: boolean;
  subsumed_by_bu_event_id?: string | null;
}): boolean =>
  r.receipt_nature === 'ADVANCE'
  && r.cheque_status !== 'Bounced'
  && !r.gst_already_discharged
  && !r.subsumed_by_bu_event_id;

// ─── Per-unit ledger ────────────────────────────────────────────────────────

export interface LedgerReceipt {
  consideration: number;
  cgst: number;
  sgst: number;
  tds_194ia: number;
  bank_credit: number | null;
  receipt_nature: ReceiptNature;
  cheque_status: ChequeStatus;
  gst_already_discharged: boolean;
  subsumed_by_bu_event_id?: string | null;
}

export interface LedgerInvoice { consideration: number; cgst: number; sgst: number }

export interface LedgerAdjustment { consideration_adjusted: number; cgst: number; sgst: number }

export interface LedgerOpening {
  agreement_value?: number;
  cumulative_value_taxed?: number;
  cumulative_cgst?: number;
  cumulative_sgst?: number;
  cumulative_receipts?: number;
  cumulative_tds_194ia?: number;
}

export interface UnitLedger {
  /** Opening + advances + invoices − adjustments. The BU differential's base. */
  valueTaxed: number;
  cgstDischarged: number;
  sgstDischarged: number;
  /** Received but not yet absorbed by an invoice — what a milestone draws down. */
  openAdvance: number;
  totalReceived: number;
  totalTds194ia: number;
  /** Agreement value less value taxed: what a BU event would still have to tax. */
  balanceToTax: number;
  /**
   * Full consideration recognised to date — opening's carried-forward
   * position plus this unit's own advances/invoices, net of absorption.
   * Despite the name, `valueTaxed` is already expressed in full-consideration
   * terms, not the 2/3rd taxable-value basis — it's directly comparable to
   * `agreementValue` via `balanceToTax` above, and every receipt/invoice
   * contributes its own `consideration` field (pre-land-deduction) when
   * accumulating it. So this is a plain alias, not a derived conversion —
   * named separately because "valueTaxed" reads as the 2/3rd figure at every
   * OTHER call site, and conflating the two here would be exactly the kind
   * of silent unit mismatch this field exists to prevent.
   *
   * This is the "running balance" signal for the affordable-housing ₹45L
   * test: a unit cannot legitimately have RECEIVED more than its true
   * agreed price, so if this exceeds base consideration + charges, the unit
   * master is understating the true gross amount charged, not the buyer
   * overpaying — see `knownConsideration` on `classifyUnit()`.
   */
  considerationRecognized: number;
}

/**
 * The per-unit position.
 *
 * Note the shape of valueTaxed: advances add, invoices add, adjustments
 * subtract. An advance of 1L later absorbed into a 5L invoice yields
 * 1 + 5 − 1 = 5, not 6.
 */
export const computeUnitLedger = (params: {
  agreementValue: number;
  opening?: LedgerOpening | null;
  receipts: LedgerReceipt[];
  invoices: LedgerInvoice[];
  adjustments: LedgerAdjustment[];
}): UnitLedger => {
  const ob = params.opening || {};
  let advCons = 0, advCgst = 0, advSgst = 0;
  let received = 0, tds = 0;

  params.receipts.forEach((r) => {
    if (r.cheque_status !== 'Bounced') {
      received += r.bank_credit === null || r.bank_credit === undefined
        ? (Number(r.consideration) || 0) + (Number(r.cgst) || 0) + (Number(r.sgst) || 0) - (Number(r.tds_194ia) || 0)
        : Number(r.bank_credit) || 0;
      tds += Number(r.tds_194ia) || 0;
    }
    if (!receiptPostsTax(r)) return;
    advCons += Number(r.consideration) || 0;
    advCgst += Number(r.cgst) || 0;
    advSgst += Number(r.sgst) || 0;
  });

  const invCons = params.invoices.reduce((s, i) => s + (Number(i.consideration) || 0), 0);
  const invCgst = params.invoices.reduce((s, i) => s + (Number(i.cgst) || 0), 0);
  const invSgst = params.invoices.reduce((s, i) => s + (Number(i.sgst) || 0), 0);

  const adjCons = params.adjustments.reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0);
  const adjCgst = params.adjustments.reduce((s, a) => s + (Number(a.cgst) || 0), 0);
  const adjSgst = params.adjustments.reduce((s, a) => s + (Number(a.sgst) || 0), 0);

  const valueTaxed = round2((Number(ob.cumulative_value_taxed) || 0) + advCons + invCons - adjCons);
  const agreementValue = Number(params.agreementValue) || 0;

  return {
    valueTaxed,
    cgstDischarged: round2((Number(ob.cumulative_cgst) || 0) + advCgst + invCgst - adjCgst),
    sgstDischarged: round2((Number(ob.cumulative_sgst) || 0) + advSgst + invSgst - adjSgst),
    openAdvance: round2(advCons - adjCons),
    totalReceived: round2((Number(ob.cumulative_receipts) || 0) + received),
    totalTds194ia: round2((Number(ob.cumulative_tds_194ia) || 0) + tds),
    balanceToTax: round2(agreementValue - valueTaxed),
    considerationRecognized: valueTaxed,
  };
};

// ─── Tie-out ────────────────────────────────────────────────────────────────

export interface TieOut {
  agreementValue: number;
  valueTaxed: number;
  balanceToTax: number;
  /** True once value taxed plus the balance reconciles to the agreement value. */
  reconciles: boolean;
  /** Positive means more has been taxed than the unit is worth. */
  overTaxedBy: number;
}

/**
 * The check that catches a receipt keyed gross against an agreement value
 * stored net. If tax was computed on a GST-inclusive figure without backing the
 * tax out, value taxed overshoots the agreement value and this flags it —
 * without anyone having to go looking.
 */
export const checkTieOut = (agreementValue: number, valueTaxed: number): TieOut => {
  const agreed = round2(Number(agreementValue) || 0);
  const taxed = round2(Number(valueTaxed) || 0);
  const over = round2(taxed - agreed);
  return {
    agreementValue: agreed,
    valueTaxed: taxed,
    balanceToTax: round2(agreed - taxed),
    // A rupee of tolerance for rounding across many receipts.
    reconciles: over <= 1,
    overTaxedBy: over > 0 ? over : 0,
  };
};

// ─── Advance absorption ─────────────────────────────────────────────────────

export interface AbsorbableAdvance {
  receiptId: string;
  receiptDate: string;
  rateCode: BuilderRateCode;
  /** Consideration on the receipt still unabsorbed. */
  available: number;
}

export interface PlannedAdjustment {
  receiptId: string;
  rateCode: BuilderRateCode;
  ratePct: number;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
}

/**
 * Decide which open advances a milestone invoice absorbs, oldest first.
 *
 * Oldest-first matters beyond tidiness: it keeps the open-advance pool ageing
 * naturally, so an advance does not sit in Table 11A indefinitely while newer
 * money is absorbed around it.
 */
export const planAdvanceAbsorption = (
  invoiceConsideration: number,
  advances: AbsorbableAdvance[],
): { adjustments: PlannedAdjustment[]; absorbed: number; unabsorbed: number } => {
  let remaining = round2(Number(invoiceConsideration) || 0);
  const adjustments: PlannedAdjustment[] = [];

  const ordered = [...advances]
    .filter((a) => a.available > 0)
    .sort((a, b) => a.receiptDate.localeCompare(b.receiptDate));

  ordered.forEach((a) => {
    if (remaining <= 0) return;
    const take = round2(Math.min(remaining, a.available));
    if (take <= 0) return;
    const tax = computeTax(take, a.rateCode);
    adjustments.push({
      receiptId: a.receiptId,
      rateCode: a.rateCode,
      ratePct: tax.ratePct,
      consideration: take,
      taxableValue: tax.taxableValue,
      cgst: tax.cgst,
      sgst: tax.sgst,
    });
    remaining = round2(remaining - take);
  });

  const absorbed = round2(adjustments.reduce((s, a) => s + a.consideration, 0));
  return { adjustments, absorbed, unabsorbed: remaining };
};

// ─── Period roll-up for GSTR-1 / 3B ─────────────────────────────────────────

export type PostingSource = 'ADVANCE_11A' | 'ADVANCE_11B' | 'INVOICE_B2CS';

export interface PostingRow {
  source_type: PostingSource;
  gstr1_table: string;
  rate_code: BuilderRateCode;
  rate_pct: number;
  consideration: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  /** 1/3rd deemed land value (Notif 11/2017 para 2), reported as Non-GST
   *  supply. Zero on Table 10 re-rating legs — see builder_period_postings'
   *  view comment. */
  land_deduction: number;
}

export interface RateBucket {
  rateCode: BuilderRateCode;
  ratePct: number;
  effectiveRatePct: number;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  count: number;
  landDeduction: number;
}

export interface PeriodSummary {
  /** GSTR-1 Table 11A — tax liability on advances received. */
  table11A: RateBucket[];
  /** GSTR-1 Table 11B — adjustment of advances (negative). */
  table11B: RateBucket[];
  /** GSTR-1 Table 7 — B2CS. */
  table7: RateBucket[];
  /** 3B Table 3.1(a): everything above, netted. */
  outward: RateBucket[];
  totals: { taxableValue: number; cgst: number; sgst: number; totalTax: number; landDeduction: number };
}

const emptyBucket = (rateCode: BuilderRateCode, ratePct: number): RateBucket => ({
  rateCode,
  ratePct,
  effectiveRatePct: EFFECTIVE_RATE_PCT[rateCode],
  consideration: 0, taxableValue: 0, cgst: 0, sgst: 0, totalTax: 0, count: 0, landDeduction: 0,
});

const bucketise = (rows: PostingRow[]): RateBucket[] => {
  const map = new Map<string, RateBucket>();
  rows.forEach((r) => {
    const key = `${r.rate_code}|${r.rate_pct}`;
    const b = map.get(key) || emptyBucket(r.rate_code, Number(r.rate_pct) || 0);
    b.consideration = round2(b.consideration + (Number(r.consideration) || 0));
    b.taxableValue = round2(b.taxableValue + (Number(r.taxable_value) || 0));
    b.cgst = round2(b.cgst + (Number(r.cgst) || 0));
    b.sgst = round2(b.sgst + (Number(r.sgst) || 0));
    b.totalTax = round2(b.cgst + b.sgst);
    b.landDeduction = round2(b.landDeduction + (Number(r.land_deduction) || 0));
    b.count += 1;
    map.set(key, b);
  });
  return [...map.values()].sort((a, b) => a.ratePct - b.ratePct);
};

/**
 * Roll postings for one period into the shape the returns are filed in.
 *
 * `outward` nets all three legs, which is what 3B Table 3.1(a) carries: an
 * invoice that fully absorbs an earlier advance contributes its own value in
 * Table 7 and reverses the advance in 11B, so only the incremental liability
 * lands in 3B.
 */
export const summarisePeriod = (rows: PostingRow[]): PeriodSummary => {
  const of = (t: PostingSource) => rows.filter((r) => r.source_type === t);
  const outward = bucketise(rows);
  return {
    table11A: bucketise(of('ADVANCE_11A')),
    table11B: bucketise(of('ADVANCE_11B')),
    table7: bucketise(of('INVOICE_B2CS')),
    outward,
    totals: {
      taxableValue: round2(outward.reduce((s, b) => s + b.taxableValue, 0)),
      cgst: round2(outward.reduce((s, b) => s + b.cgst, 0)),
      sgst: round2(outward.reduce((s, b) => s + b.sgst, 0)),
      totalTax: round2(outward.reduce((s, b) => s + b.totalTax, 0)),
      landDeduction: round2(outward.reduce((s, b) => s + b.landDeduction, 0)),
    },
  };
};

// ─── Period helpers ─────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → 'MM/YYYY', the period key used throughout the app. */
export const dateToPeriod = (isoDate: string): string => {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  return m ? `${m[2]}/${m[1]}` : '';
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const prettyPeriodLabel = (mmYYYY: string): string => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((mmYYYY || '').trim());
  if (!m) return mmYYYY || '';
  const i = Number(m[1]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[2]}` : mmYYYY;
};
