// Builder module — the BU differential engine.
//
// The firm's practice: for every unit booked before its cut-off, the ENTIRE
// balance consideration becomes taxable in the BU month, received or not.
// s.31(5)(c) r/w s.13(2)(a) — where payment is linked to the completion of an
// event, the invoice falls due on the date that event completes, and BU is that
// event. The construction service is fully rendered.
//
// The consequence the firm has accepted: GST law gives no bad-debt relief, so
// tax paid at BU on an uncollected balance is recoverable only through a s.34
// credit note, and only until 30 November of the following financial year.

import { computeTax, type BuilderRateCode } from '@/utils/builderRates';

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export type PostingBasis = 'DISCOVERY' | 'BU_MONTH' | 'DISCOVERY_WITH_INTEREST';
export type CutOffSource = 'BU' | 'DASTAVEJ';
export type BuEventStatus = 'DRAFT' | 'PREPARED' | 'POSTED';

export const POSTING_BASIS_LABEL: Record<PostingBasis, string> = {
  DISCOVERY: 'Month of discovery — no interest',
  BU_MONTH: 'BU month — needs the return revising if already filed',
  DISCOVERY_WITH_INTEREST: 'Month of discovery, with interest u/s 50 from the BU month',
};

/** Interest u/s 50 on delayed payment of tax. */
export const SECTION_50_RATE_PCT = 18;

// ─── Period helpers ─────────────────────────────────────────────────────────

/** 'MM/YYYY' → a sortable 'YYYYMM'. */
export const periodKey = (mmYYYY: string): string => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((mmYYYY || '').trim());
  return m ? `${m[2]}${m[1].padStart(2, '0')}` : '';
};

/** Is `period` strictly before `reference`? Both 'MM/YYYY'. */
export const isPeriodBefore = (period: string, reference: string): boolean => {
  const a = periodKey(period), b = periodKey(reference);
  return !!a && !!b && a < b;
};

/** 'YYYY-MM-DD' → 'MM/YYYY'. */
export const periodOfDate = (isoDate: string): string => {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  return m ? `${m[2]}/${m[1]}` : '';
};

/**
 * GSTR-3B due date for a period: the 20th of the following month. Interest
 * u/s 50 runs from the day after this.
 */
export const gstr3bDueDate = (mmYYYY: string): Date | null => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((mmYYYY || '').trim());
  if (!m) return null;
  const month = Number(m[1]), year = Number(m[2]);
  // Period MM/YYYY is due on the 20th of MM+1.
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 20));
};

const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));

/**
 * Interest u/s 50 @18% p.a. from the day after the BU month's due date to the
 * day the differential is actually paid (the posting period's due date).
 *
 * Computed per unit rather than on a single lump sum, so the working shows
 * exactly which unit carries which exposure.
 */
export const computeSection50Interest = (
  tax: number,
  buPeriod: string,
  postingPeriod: string,
): { days: number; amount: number } => {
  const from = gstr3bDueDate(buPeriod);
  const to = gstr3bDueDate(postingPeriod);
  if (!from || !to) return { days: 0, amount: 0 };
  const days = daysBetween(from, to);
  if (days <= 0 || tax <= 0) return { days: 0, amount: 0 };
  return {
    days,
    amount: round2((Number(tax) * SECTION_50_RATE_PCT * days) / (100 * 365)),
  };
};

// ─── Cut-off ────────────────────────────────────────────────────────────────

export interface CutOff {
  date: string;
  source: CutOffSource;
}

/**
 * The unit's cut-off is the EARLIER of its block's BU date and its own dastavej
 * (registered sale deed) date.
 *
 * A unit registered before BU therefore closes out at registration rather than
 * waiting for the permission — by then the consideration is fixed and the
 * transfer has happened.
 */
export const resolveCutOff = (buDate: string, dastavejDate?: string | null): CutOff => {
  if (dastavejDate && dastavejDate < buDate) return { date: dastavejDate, source: 'DASTAVEJ' };
  return { date: buDate, source: 'BU' };
};

/**
 * A unit is in the GST net only if it was booked before its cut-off.
 *
 * Unbooked at cut-off means Schedule III para 5 applies to the later sale — not
 * a supply at all — so the unit is omitted from GSTR-1 and 3B entirely, and
 * instead feeds the TDR/FSI unbooked proportion.
 */
export const isBookedAtCutOff = (
  bookingDate: string | null | undefined,
  cutOffDate: string,
): boolean => !!bookingDate && bookingDate <= cutOffDate;

// ─── The differential ───────────────────────────────────────────────────────

export interface DifferentialInput {
  agreementValue: number;
  rateCode: BuilderRateCode;
  /** Opening balance carried in at onboarding. */
  openingValueTaxed?: number;
  /** Advances that posted to 11A in periods BEFORE the BU month. */
  advancesBefore?: number;
  /** Invoices raised in periods BEFORE the BU month. */
  invoicesBefore?: number;
  /** Advance adjustments made in periods BEFORE the BU month. */
  adjustmentsBefore?: number;
}

export interface Differential {
  agreementValue: number;
  /** opening + advances + invoices − adjustments, all up to the BU month's opening. */
  valueTaxedUptoOpening: number;
  invoicedBefore: number;
  openAdvanceBefore: number;

  /** The NET incremental liability: agreement − value taxed. */
  differentialValue: number;
  differentialTaxableValue: number;
  differentialCgst: number;
  differentialSgst: number;
  differentialTax: number;

  /** GROSS legs, which is how it actually posts. */
  invoiceValue: number;        // Table 7  = agreement − invoiced before
  advanceToAdjust: number;     // Table 11B = open advance at opening
  /** True when the gross legs net back to the differential — always should. */
  legsReconcile: boolean;
}

/**
 * Compute one unit's differential.
 *
 * Two views of the same number, and both are needed:
 *
 *   NET   differential = agreement − value taxed up to the BU month's opening.
 *         This is the incremental liability and what 3B Table 3.1(a) receives.
 *
 *   GROSS invoice (Table 7) = agreement − invoices already raised
 *         advance adjusted (11B) = open advances at that opening
 *         These are what GSTR-1 needs: an advance sitting in Table 11A has to
 *         be adjusted out through 11B eventually, not left open forever.
 *
 * The two agree by construction, because
 *   value taxed = opening + advances + invoices − adjustments,
 * so   agreement − value taxed
 *    = (agreement − invoices) − (advances − adjustments) − opening.
 * With no opening balance the identity is exact; where an opening balance
 * exists it is folded into the invoice leg, since the pre-app history is not
 * decomposable into invoices and advances.
 */
export const computeDifferential = (input: DifferentialInput): Differential => {
  const agreement = round2(Number(input.agreementValue) || 0);
  const opening = round2(Number(input.openingValueTaxed) || 0);
  const advances = round2(Number(input.advancesBefore) || 0);
  const invoiced = round2(Number(input.invoicesBefore) || 0);
  const adjusted = round2(Number(input.adjustmentsBefore) || 0);

  const valueTaxed = round2(opening + advances + invoiced - adjusted);
  const openAdvance = round2(advances - adjusted);

  // Never negative: a unit already taxed beyond its agreement value owes
  // nothing further here, and the over-tax surfaces through the tie-out.
  const differentialValue = round2(Math.max(0, agreement - valueTaxed));
  const tax = computeTax(differentialValue, input.rateCode);

  // The invoice leg absorbs the opening balance too, since pre-app history
  // cannot be split into its invoice and advance components.
  const invoiceValue = round2(Math.max(0, agreement - invoiced - opening));
  const advanceToAdjust = round2(Math.min(openAdvance, invoiceValue));

  return {
    agreementValue: agreement,
    valueTaxedUptoOpening: valueTaxed,
    invoicedBefore: invoiced,
    openAdvanceBefore: openAdvance,
    differentialValue,
    differentialTaxableValue: tax.taxableValue,
    differentialCgst: tax.cgst,
    differentialSgst: tax.sgst,
    differentialTax: tax.totalTax,
    invoiceValue,
    advanceToAdjust,
    legsReconcile: Math.abs(round2(invoiceValue - advanceToAdjust) - differentialValue) <= 1,
  };
};

// ─── Whole-event working ────────────────────────────────────────────────────

export interface WorkingUnitInput {
  unitId: string;
  unitNo: string;
  unitType: 'Residential' | 'Commercial';
  carpetAreaSqM: number;
  rateCode: BuilderRateCode;
  ratePct: number;
  agreementValue: number;
  dastavejDate?: string | null;
  bookingId?: string | null;
  bookingDate?: string | null;
  openingValueTaxed?: number;
  advancesBefore?: number;
  invoicesBefore?: number;
  adjustmentsBefore?: number;
  receivedUptoCutOff?: number;
  /** Receipts inside the BU month, which the differential subsumes. */
  receiptsInBuMonth?: number;
}

export interface WorkingUnit extends Differential {
  unitId: string;
  unitNo: string;
  unitType: 'Residential' | 'Commercial';
  carpetAreaSqM: number;
  rateCode: BuilderRateCode;
  ratePct: number;
  cutOffDate: string;
  cutOffSource: CutOffSource;
  bookedAtCutOff: boolean;
  bookingId: string | null;
  receivedUptoCutOff: number;
  subsumedReceiptCount: number;
  interestDays: number;
  interestAmount: number;
  /** agreement − value taxed after posting. Anything non-zero needs a look. */
  tieOutDiff: number;
}

export interface EventWorking {
  units: WorkingUnit[];
  /** Booked before cut-off → taxable. */
  taxable: WorkingUnit[];
  /** Unbooked at cut-off → Schedule III, omitted from the returns entirely. */
  unbooked: WorkingUnit[];
  totals: {
    differentialValue: number;
    differentialTaxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    interest: number;
    invoiceValue: number;
    advanceToAdjust: number;
  };
  /** Carpet area of unbooked residential units — the TDR/FSI proportion. */
  unbookedResidentialCarpet: number;
  totalCarpet: number;
  /** Value of unbooked residential units, for the 1%/5% cap on the FSI RCM. */
  unbookedResidentialValue: number;
}

/**
 * Build the whole unit-wise working for a BU event.
 *
 * Unbooked units are carried through rather than dropped: they contribute no
 * GST, but their carpet area and value are exactly what the TDR/FSI working
 * needs, and showing them makes the Schedule III exclusion visible instead of
 * silent.
 */
export const buildEventWorking = (params: {
  buDate: string;
  buPeriod: string;
  postingPeriod: string;
  postingBasis: PostingBasis;
  units: WorkingUnitInput[];
}): EventWorking => {
  const withInterest = params.postingBasis === 'DISCOVERY_WITH_INTEREST';

  const units: WorkingUnit[] = params.units.map((u) => {
    const cut = resolveCutOff(params.buDate, u.dastavejDate);
    const booked = isBookedAtCutOff(u.bookingDate, cut.date);

    const diff = booked
      ? computeDifferential({
        agreementValue: u.agreementValue,
        rateCode: u.rateCode,
        openingValueTaxed: u.openingValueTaxed,
        advancesBefore: u.advancesBefore,
        invoicesBefore: u.invoicesBefore,
        adjustmentsBefore: u.adjustmentsBefore,
      })
      // Unbooked at cut-off: Schedule III, nothing to tax.
      : computeDifferential({ agreementValue: 0, rateCode: u.rateCode });

    const interest = booked && withInterest
      ? computeSection50Interest(diff.differentialTax, params.buPeriod, params.postingPeriod)
      : { days: 0, amount: 0 };

    return {
      ...diff,
      unitId: u.unitId,
      unitNo: u.unitNo,
      unitType: u.unitType,
      carpetAreaSqM: Number(u.carpetAreaSqM) || 0,
      rateCode: u.rateCode,
      ratePct: u.ratePct,
      // computeDifferential zeroes agreementValue for an unbooked unit so its
      // OWN tax/invoice fields collapse to nothing (Schedule III) — but that
      // zero must not leak past this object. The FSI/TDR cap reads this same
      // field to strike the 1%/5% cap against an unbooked unit's true value
      // (computeFsiCap in builderFsi.ts), and silently zeroing it there forces
      // the residential RCM leg to 0 on every event with an unbooked unit.
      agreementValue: round2(Number(u.agreementValue) || 0),
      cutOffDate: cut.date,
      cutOffSource: cut.source,
      bookedAtCutOff: booked,
      bookingId: u.bookingId ?? null,
      receivedUptoCutOff: round2(Number(u.receivedUptoCutOff) || 0),
      subsumedReceiptCount: booked ? (Number(u.receiptsInBuMonth) || 0) : 0,
      interestDays: interest.days,
      interestAmount: interest.amount,
      // After posting, value taxed becomes the agreement value exactly.
      tieOutDiff: booked
        ? round2(u.agreementValue - (diff.valueTaxedUptoOpening + diff.differentialValue))
        : 0,
    };
  });

  const taxable = units.filter((u) => u.bookedAtCutOff);
  const unbooked = units.filter((u) => !u.bookedAtCutOff);
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

  return {
    units,
    taxable,
    unbooked,
    totals: {
      differentialValue: sum(taxable.map((u) => u.differentialValue)),
      differentialTaxableValue: sum(taxable.map((u) => u.differentialTaxableValue)),
      cgst: sum(taxable.map((u) => u.differentialCgst)),
      sgst: sum(taxable.map((u) => u.differentialSgst)),
      totalTax: sum(taxable.map((u) => u.differentialTax)),
      interest: sum(taxable.map((u) => u.interestAmount)),
      invoiceValue: sum(taxable.map((u) => u.invoiceValue)),
      advanceToAdjust: sum(taxable.map((u) => u.advanceToAdjust)),
    },
    unbookedResidentialCarpet: sum(
      unbooked.filter((u) => u.unitType === 'Residential').map((u) => u.carpetAreaSqM),
    ),
    totalCarpet: sum(units.map((u) => u.carpetAreaSqM)),
    unbookedResidentialValue: sum(
      unbooked.filter((u) => u.unitType === 'Residential')
        .map((u) => Number(params.units.find((x) => x.unitId === u.unitId)?.agreementValue) || 0),
    ),
  };
};

/**
 * The credit-note deadline for a unit taxed in full at BU: 30 November
 * following the financial year of the posting.
 *
 * Front-loading the whole unit's GST at BU enlarges the exposure if the booking
 * later cancels, so the working papers surface this date per unit rather than
 * leaving anyone to discover it after it has passed.
 */
export const creditNoteDeadline = (postingPeriod: string): string => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((postingPeriod || '').trim());
  if (!m) return '';
  const month = Number(m[1]), year = Number(m[2]);
  // Indian FY runs April–March; the deadline is 30 Nov after that FY closes.
  const fyEndYear = month >= 4 ? year + 1 : year;
  return `30/11/${fyEndYear}`;
};

// ─── Late-discovery interest ────────────────────────────────────────────────
//
// A dastavej/BU shortfall that goes unnoticed doesn't necessarily sit unpaid:
// the buyer often keeps paying, and each payment gets taxed normally as an
// ordinary Table 11A advance in ITS OWN month, with no idea it was actually
// covering money that should already have been taxed in full back at the
// cut-off. By the time the missed dastavej surfaces, posting the FULL
// shortfall as a fresh differential would tax that money a second time —
// prepareBuEvent()'s advancesBefore only ever looks at periods before the
// cut-off, so it has no way to see (or credit) a later tranche.
//
// This allocates those later tranches against the shortfall instead, oldest
// first, and prices only the one thing actually still owed on each: s.50
// interest for paying it later than the cut-off period's own due date —
// never the tax again. Whatever the tranches don't cover is a genuine
// residual that was never taxed at all, and still needs an ordinary
// DISCOVERY_WITH_INTEREST differential post for that leftover amount.

export interface LateTranche {
  periodMonth: string;
  amount: number;
}

export interface PricedTranche extends LateTranche {
  allocated: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  tax: number;
  interestDays: number;
  interestAmount: number;
}

export interface LateDiscoveryInterest {
  shortfallValue: number;
  tranches: PricedTranche[];
  totalAllocated: number;
  totalInterest: number;
  /** Never taxed by any tranche — still needs a fresh differential post. */
  residualUnrecovered: number;
}

/**
 * Allocate `tranches` (oldest first) against `shortfallValue`, pricing s.50
 * interest on each allocated amount from `cutOffPeriod`'s own due date to
 * that tranche's own due date. Caller supplies tranches already sorted
 * oldest-first and already known to be genuine, un-subsumed ordinary
 * advances dated after the cut-off — this function only allocates and prices.
 */
export const computeLateDiscoveryInterest = (params: {
  shortfallValue: number;
  rateCode: BuilderRateCode;
  cutOffPeriod: string;
  tranches: LateTranche[];
}): LateDiscoveryInterest => {
  let remaining = round2(Math.max(0, params.shortfallValue));
  const priced: PricedTranche[] = [];

  for (const t of params.tranches) {
    if (remaining <= 0.005) break;
    const allocated = round2(Math.min(remaining, Math.max(0, t.amount)));
    if (allocated <= 0.005) continue;
    remaining = round2(remaining - allocated);

    const tax = computeTax(allocated, params.rateCode);
    const interest = computeSection50Interest(tax.totalTax, params.cutOffPeriod, t.periodMonth);

    priced.push({
      periodMonth: t.periodMonth,
      amount: t.amount,
      allocated,
      taxableValue: tax.taxableValue,
      cgst: tax.cgst,
      sgst: tax.sgst,
      tax: tax.totalTax,
      interestDays: interest.days,
      interestAmount: interest.amount,
    });
  }

  const totalAllocated = round2(priced.reduce((s, t) => s + t.allocated, 0));
  const totalInterest = round2(priced.reduce((s, t) => s + t.interestAmount, 0));

  return {
    shortfallValue: round2(Math.max(0, params.shortfallValue)),
    tranches: priced,
    totalAllocated,
    totalInterest,
    residualUnrecovered: round2(Math.max(0, params.shortfallValue - totalAllocated)),
  };
};
