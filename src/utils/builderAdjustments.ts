// Builder module — the corrections layer.
//
// Everything here answers the same shape of question: something already
// reported turns out to be wrong, or something already taxed has to move. The
// rule that decides each case is the one from Phase 2 — a change in the flow of
// MONEY is not a change in the SUPPLY. GST adjusts only when the consideration
// or the supply itself changes.

import {
  EFFECTIVE_RATE_PCT, NOTIFIED_RATE_PCT, backCalculateFromInclusive, computeFlatTax,
  computeTax, type BuilderRateCode, type InvoiceRateCode,
} from '@/utils/builderRates';
import { SECTION_50_RATE_PCT, gstr3bDueDate, periodKey } from '@/utils/builderBuEvent';

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ─── 1. Retrospective re-rating ─────────────────────────────────────────────

export interface PeriodTaxed {
  periodMonth: string;
  /** Taxable value reported in that period, at the old rate. */
  taxableValue: number;
}

export interface ReclassPeriod {
  periodMonth: string;
  taxableValue: number;
  oldCgst: number;
  oldSgst: number;
  newCgst: number;
  newSgst: number;
  differentialTax: number;
  dueDate: string;
  interestDays: number;
  interestAmount: number;
}

export interface ReclassSchedule {
  periods: ReclassPeriod[];
  totalValueRetaxed: number;
  totalDifferentialTax: number;
  totalInterest: number;
}

/**
 * The schedule behind a unit that was never actually affordable.
 *
 * Crossing Rs. 45 lakh does not change the rate going forward — it means the
 * concession never applied, so the higher rate is due on everything already
 * offered to tax. Because interest u/s 50 runs from EACH original period's due
 * date, the schedule has to be period-wise; a single aggregate at the trigger
 * date would understate the interest materially on an old unit.
 *
 * Every buyer is unregistered, so the correction goes through Table 10 as an
 * amendment of the earlier B2CS entries rather than as a debit note: the old
 * rate's row is reversed and the same taxable value re-reported at the new one.
 */
export const buildReclassSchedule = (params: {
  periods: PeriodTaxed[];
  fromRateCode: BuilderRateCode;
  toRateCode: BuilderRateCode;
  postingPeriod: string;
}): ReclassSchedule => {
  const oldRate = NOTIFIED_RATE_PCT[params.fromRateCode];
  const newRate = NOTIFIED_RATE_PCT[params.toRateCode];

  const periods: ReclassPeriod[] = params.periods
    .filter((p) => (Number(p.taxableValue) || 0) > 0)
    .sort((a, b) => periodKey(a.periodMonth).localeCompare(periodKey(b.periodMonth)))
    .map((p) => {
      const tv = round2(Number(p.taxableValue) || 0);
      const oldTax = round2((tv * oldRate) / 100);
      const newTax = round2((tv * newRate) / 100);
      const diff = round2(newTax - oldTax);

      const from = gstr3bDueDate(p.periodMonth);
      const to = gstr3bDueDate(params.postingPeriod);
      const days = from && to
        ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000))
        : 0;

      return {
        periodMonth: p.periodMonth,
        taxableValue: tv,
        oldCgst: round2(oldTax / 2),
        oldSgst: round2(oldTax - round2(oldTax / 2)),
        newCgst: round2(newTax / 2),
        newSgst: round2(newTax - round2(newTax / 2)),
        differentialTax: diff,
        dueDate: from ? from.toISOString().slice(0, 10) : '',
        interestDays: days,
        interestAmount: round2((diff * SECTION_50_RATE_PCT * days) / (100 * 365)),
      };
    });

  return {
    periods,
    totalValueRetaxed: round2(periods.reduce((s, p) => s + p.taxableValue, 0)),
    totalDifferentialTax: round2(periods.reduce((s, p) => s + p.differentialTax, 0)),
    totalInterest: round2(periods.reduce((s, p) => s + p.interestAmount, 0)),
  };
};

// ─── 2. Credit-note window ──────────────────────────────────────────────────

export interface CreditNoteWindow {
  expiry: string;      // 'YYYY-MM-DD'
  expiryLabel: string; // 'DD/MM/YYYY'
  isOpen: boolean;
  daysRemaining: number;
}

/**
 * s.34: the tax on a credit note can be adjusted only until 30 November
 * following the financial year of the ORIGINAL document, or the filing of the
 * annual return, whichever is earlier.
 *
 * Past it the builder cannot recover the tax — but Circular 188/20/2022 lets
 * the unregistered buyer claim it as a refund u/s 54 instead, so the position
 * is recoverable by someone, just not by the builder.
 */
export const creditNoteWindow = (
  originalDocDate: string,
  asOn?: string,
): CreditNoteWindow => {
  const m = /^(\d{4})-(\d{2})/.exec(originalDocDate || '');
  if (!m) return { expiry: '', expiryLabel: '', isOpen: false, daysRemaining: 0 };
  const year = Number(m[1]), month = Number(m[2]);
  // Indian FY runs April–March; the window closes 30 Nov after that FY ends.
  const fyEndYear = month >= 4 ? year + 1 : year;
  const expiry = `${fyEndYear}-11-30`;
  const today = asOn || new Date().toISOString().slice(0, 10);
  const days = Math.round(
    (new Date(`${expiry}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000,
  );
  return {
    expiry,
    expiryLabel: `30/11/${fyEndYear}`,
    isOpen: days >= 0,
    daysRemaining: days,
  };
};

// ─── 3. Conversion ──────────────────────────────────────────────────────────

export interface ConversionResult {
  carriedValue: number;
  fromRatePct: number;
  toRatePct: number;
  /** Tax to reverse on the old unit — only if its window is still open. */
  creditNoteTax: number;
  /** Tax on the new unit for the carried value. */
  newInvoiceTax: number;
  /** newInvoiceTax − creditNoteTax. Positive = extra to pay. */
  differentialTax: number;
  /** Same rate both sides: the move is documentation only. */
  isRateNeutral: boolean;
}

/**
 * A member moving between units is a cancellation plus a fresh booking, not a
 * ledger entry.
 *
 * The old unit's tax comes back through a credit note and the carried value is
 * re-taxed at the new unit's rate. Where the rates match, the difference is
 * zero and only the paperwork moves — but the paperwork still has to move, and
 * if the credit-note window on the old unit has closed, the old tax is simply
 * lost while the new tax is still payable.
 */
export const computeConversion = (params: {
  carriedValue: number;
  fromRateCode: BuilderRateCode;
  toRateCode: BuilderRateCode;
}): ConversionResult => {
  const carried = round2(Number(params.carriedValue) || 0);
  const oldTax = computeTax(carried, params.fromRateCode);
  const newTax = computeTax(carried, params.toRateCode);
  return {
    carriedValue: carried,
    fromRatePct: oldTax.ratePct,
    toRatePct: newTax.ratePct,
    creditNoteTax: oldTax.totalTax,
    newInvoiceTax: newTax.totalTax,
    differentialTax: round2(newTax.totalTax - oldTax.totalTax),
    isRateNeutral: params.fromRateCode === params.toRateCode,
  };
};

// ─── 4. Bounce offsets ──────────────────────────────────────────────────────

export interface OffsetCandidate {
  periodMonth: string;
  /** Positive 11A consideration available at this rate in this project. */
  available: number;
}

export interface PlannedOffset {
  periodMonth: string;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
}

export interface OffsetPlan {
  offsets: PlannedOffset[];
  applied: number;
  carriedForward: number;
}

/**
 * Allocate a bounce reversal across later months' bookings.
 *
 * Same rate and same project only — netting a 1.5% reversal against 7.5%
 * bookings would distort the rate-wise B2CS. The portal rejects a negative
 * Table 11A, so a reversal larger than the month's own advances is capped and
 * the remainder carries forward rather than being lost.
 */
export const planBounceOffsets = (params: {
  reversalConsideration: number;
  rateCode: BuilderRateCode;
  candidates: OffsetCandidate[];
}): OffsetPlan => {
  let remaining = round2(Number(params.reversalConsideration) || 0);
  const offsets: PlannedOffset[] = [];

  [...params.candidates]
    .filter((c) => c.available > 0)
    .sort((a, b) => periodKey(a.periodMonth).localeCompare(periodKey(b.periodMonth)))
    .forEach((c) => {
      if (remaining <= 0.005) return;
      const take = round2(Math.min(remaining, c.available));
      if (take <= 0) return;
      const t = computeTax(take, params.rateCode);
      offsets.push({
        periodMonth: c.periodMonth,
        consideration: take,
        taxableValue: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
      });
      remaining = round2(remaining - take);
    });

  return {
    offsets,
    applied: round2(offsets.reduce((s, o) => s + o.consideration, 0)),
    carriedForward: remaining,
  };
};

// ─── 5. Excess tax on a GST-inclusive receipt ───────────────────────────────

export interface RestatementResult {
  originalConsideration: number;
  originalTax: number;
  restatedConsideration: number;
  restatedTax: number;
  excessTax: number;
  /** By how much the unit's value taxed falls — and its BU differential rises. */
  considerationReduction: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
}

/**
 * Restate a receipt that was inclusive of GST but taxed on the whole figure.
 *
 * Two consequences, and both matter. The obvious one is the excess tax. The
 * less obvious one is that the overstated consideration had inflated the unit's
 * value taxed — so restating it RAISES the BU differential by the same amount.
 * The two move together, which is why the per-unit tie-out catches this class
 * of error without anyone going looking: value taxed overshoots the agreement
 * value by exactly the grossed-up portion.
 */
export const restateInclusiveReceipt = (params: {
  amountReceived: number;
  originalConsideration: number;
  originalTax: number;
  rateCode: BuilderRateCode;
}): RestatementResult => {
  const correct = backCalculateFromInclusive(params.amountReceived, params.rateCode);
  const origCons = round2(Number(params.originalConsideration) || 0);
  const origTax = round2(Number(params.originalTax) || 0);
  return {
    originalConsideration: origCons,
    originalTax: origTax,
    restatedConsideration: correct.consideration,
    restatedTax: correct.totalTax,
    excessTax: round2(origTax - correct.totalTax),
    considerationReduction: round2(origCons - correct.consideration),
    taxableValue: correct.taxableValue,
    cgst: correct.cgst,
    sgst: correct.sgst,
  };
};

// ─── 6. Delay interest ──────────────────────────────────────────────────────

export type DelayInterestBasis = 'FLAT_18' | 'UNIT_RATE';

export interface DelayInterestResult {
  rateCode: InvoiceRateCode;
  ratePct: number;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  /** True where the 1/3rd land deduction applied. */
  landDeductionApplied: boolean;
}

/**
 * Tax on interest recovered from a member for a late instalment.
 *
 * Two treatments, and they differ in more than the rate. Under s.15(2)(d) the
 * interest is part of the value of the principal supply, so it takes the unit's
 * rate AND the 1/3rd land deduction. Under the firm's elected flat 18% it is a
 * separate supply, so the whole amount is the taxable value with no deduction.
 */
export const computeDelayInterest = (params: {
  interestAmount: number;
  basis: DelayInterestBasis;
  unitRateCode: BuilderRateCode;
}): DelayInterestResult => {
  if (params.basis === 'FLAT_18') {
    const t = computeFlatTax(params.interestAmount, 18);
    return {
      rateCode: 'DELAY_INTEREST_18',
      ratePct: 18,
      consideration: t.consideration,
      taxableValue: t.taxableValue,
      cgst: t.cgst,
      sgst: t.sgst,
      totalTax: t.totalTax,
      landDeductionApplied: false,
    };
  }
  const t = computeTax(params.interestAmount, params.unitRateCode);
  return {
    rateCode: params.unitRateCode,
    ratePct: t.ratePct,
    consideration: t.consideration,
    taxableValue: t.taxableValue,
    cgst: t.cgst,
    sgst: t.sgst,
    totalTax: t.totalTax,
    landDeductionApplied: true,
  };
};

// ─── Labels ─────────────────────────────────────────────────────────────────

export const NOTE_TYPE_LABEL: Record<string, string> = {
  CANCELLATION: 'Cancellation',
  CONVERSION: 'Unit conversion',
  DASTAVEJ_VARIANCE: 'Dastavej variance',
  OTHER: 'Other',
};

export const EXCESS_TREATMENT_LABEL: Record<string, string> = {
  ADJUST: "Adjust against the project's future liability",
  REFUND: 'Claim refund u/s 54',
  ABSORB: 'Absorb',
};

export const BOUNCE_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTIAL: 'Partly offset',
  ADJUSTED: 'Fully offset',
  WRITTEN_OFF: 'Written off',
};

/** Effective rate for display, for any code an invoice can carry. */
export const effectiveRateOf = (code: InvoiceRateCode): number =>
  code === 'DELAY_INTEREST_18' ? 18 : EFFECTIVE_RATE_PCT[code];

// ─── 7. Cancellation refund set-off ─────────────────────────────────────────

export interface CancellationOffsetResult {
  offsetAmount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  /** amount - offsetAmount: permanently forfeited, never carried forward. */
  forfeitedAmount: number;
}

/**
 * Net a single refund payment against its OWN period's Table 11A pool —
 * the firm's elected alternative to a formal cancellation credit note (§11).
 *
 * Deliberately single-period, unlike a bounce offset: whatever doesn't fit
 * the month the refund is actually paid in is forfeited outright, not carried
 * to a later month. A cancellation refunded across several months is several
 * independent calls to this function, one per payment.
 */
export const planCancellationOffset = (params: {
  refundAmount: number;
  availableInPeriod: number;
  rateCode: BuilderRateCode;
}): CancellationOffsetResult => {
  const refund = round2(Number(params.refundAmount) || 0);
  const available = Math.max(0, round2(Number(params.availableInPeriod) || 0));
  const offsetAmount = round2(Math.min(refund, available));
  const t = computeTax(offsetAmount, params.rateCode);
  return {
    offsetAmount,
    taxableValue: t.taxableValue,
    cgst: t.cgst,
    sgst: t.sgst,
    forfeitedAmount: round2(refund - offsetAmount),
  };
};
