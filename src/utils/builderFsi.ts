// Builder module — TDR / FSI reverse charge.
//
// Development rights, FSI and long-term lease premium are taxed on the promoter
// under reverse charge at 18% (Notifications 05 and 06/2019-CT(R)), with the
// portion attributable to residential apartments BOOKED before the completion
// certificate exempt (Notification 04/2019). Time of supply is the CC date — in
// Gujarat, the BU permission — which is why this hangs off a BU event rather
// than off a month.
//
// Two legs, and they behave differently:
//
//   RESIDENTIAL  the portion attributable to UNBOOKED residential apartments,
//                at 18%, but CAPPED at 1% / 5% of the value of those unbooked
//                apartments. Because an affordable unit caps at 1% and any
//                other at 5%, the cap has to be summed per unit rather than
//                applied as one blended rate.
//
//   COMMERCIAL   the portion attributable to commercial apartments, at 18% in
//                full. No exemption, no cap.
//
// The ITC of all this is blocked — the 1%/5% scheme requires the credit to be
// forgone — so it is paid in cash through 3B Table 3.1(d) and never reaches
// GSTR-1.

import { EFFECTIVE_RATE_PCT, type BuilderRateCode } from '@/utils/builderRates';

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Reverse charge on development rights and FSI. */
export const FSI_RCM_RATE_PCT = 18;

export type FsiTreatment = 'PAY' | 'IGNORE';
export type FsiStatus = 'DRAFT' | 'POSTED' | 'IGNORED';

export const FSI_STATUS_LABEL: Record<FsiStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted to 3.1(d)',
  IGNORED: 'Held back — client instruction',
};

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface FsiUnit {
  unitId: string;
  unitType: 'Residential' | 'Commercial';
  carpetAreaSqM: number;
  /** Gross consideration; the cap is struck against this for unbooked units. */
  agreementValue: number;
  rateCode: BuilderRateCode;
  /** Booked before this unit's BU cut-off. Unbooked residential drives the leg. */
  bookedAtCutOff: boolean;
}

export interface FsiInput {
  /** Total consideration for the development rights / FSI across the project. */
  tdrFsiTotalValue: number;
  /** Total carpet area of the whole project — the allocation denominator. */
  projectCarpetSqM: number;
  /** Units covered by this BU event. */
  units: FsiUnit[];
}

// ─── Result ─────────────────────────────────────────────────────────────────

export interface FsiWorking {
  eventCarpetSqM: number;
  projectCarpetSqM: number;
  /** Share of the FSI value this BU event carries, allocated by carpet area. */
  allocatedValue: number;

  residentialCarpetSqM: number;
  commercialCarpetSqM: number;
  unbookedResidentialCarpetSqM: number;
  unbookedResidentialValue: number;

  residentialPortion: number;
  residentialRcmUncapped: number;
  capAmount: number;
  capApplied: boolean;
  residentialRcm: number;

  commercialPortion: number;
  commercialRcm: number;

  totalRcm: number;
  cgst: number;
  sgst: number;
}

/**
 * The statutory cap on the residential leg.
 *
 * Summed per unit rather than blended: an affordable unit caps at 1% of its
 * value and any other at 5%, so a mixed inventory has no single rate that
 * gives the right answer.
 */
export const computeFsiCap = (unbookedResidential: FsiUnit[]): number =>
  round2(unbookedResidential.reduce(
    (sum, u) => sum + ((Number(u.agreementValue) || 0) * EFFECTIVE_RATE_PCT[u.rateCode]) / 100,
    0,
  ));

/**
 * Build the FSI working for one BU event.
 *
 * Allocation runs in two steps and the order matters. First the project's FSI
 * value is apportioned to this event by carpet area, so a phased BU
 * crystallises the liability piece by piece. Only then is that allocated value
 * split between the unbooked-residential and commercial legs.
 */
export const computeFsiWorking = (input: FsiInput): FsiWorking => {
  const units = input.units || [];
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

  const residential = units.filter((u) => u.unitType === 'Residential');
  const commercial = units.filter((u) => u.unitType === 'Commercial');
  const unbookedResidential = residential.filter((u) => !u.bookedAtCutOff);

  const residentialCarpet = sum(residential.map((u) => Number(u.carpetAreaSqM) || 0));
  const commercialCarpet = sum(commercial.map((u) => Number(u.carpetAreaSqM) || 0));
  const eventCarpet = round2(residentialCarpet + commercialCarpet);

  // The project total is the denominator; fall back to the event's own carpet
  // area when it is not supplied, which is the single-BU case.
  const projectCarpet = round2(Number(input.projectCarpetSqM) || eventCarpet);
  const totalValue = round2(Number(input.tdrFsiTotalValue) || 0);
  const allocatedValue = projectCarpet > 0
    ? round2((totalValue * eventCarpet) / projectCarpet)
    : 0;

  const unbookedResidentialCarpet = sum(unbookedResidential.map((u) => Number(u.carpetAreaSqM) || 0));
  const unbookedResidentialValue = sum(unbookedResidential.map((u) => Number(u.agreementValue) || 0));

  // Both portions are struck against the EVENT's carpet area, not the
  // project's — the allocation to this event has already happened.
  const residentialPortion = eventCarpet > 0
    ? round2((allocatedValue * unbookedResidentialCarpet) / eventCarpet)
    : 0;
  const commercialPortion = eventCarpet > 0
    ? round2((allocatedValue * commercialCarpet) / eventCarpet)
    : 0;

  const residentialRcmUncapped = round2((residentialPortion * FSI_RCM_RATE_PCT) / 100);
  const capAmount = computeFsiCap(unbookedResidential);
  const capApplied = residentialRcmUncapped > capAmount;
  const residentialRcm = round2(Math.min(residentialRcmUncapped, capAmount));

  // No exemption and no cap on the commercial leg.
  const commercialRcm = round2((commercialPortion * FSI_RCM_RATE_PCT) / 100);

  const totalRcm = round2(residentialRcm + commercialRcm);
  const cgst = round2(totalRcm / 2);

  return {
    eventCarpetSqM: eventCarpet,
    projectCarpetSqM: projectCarpet,
    allocatedValue,
    residentialCarpetSqM: residentialCarpet,
    commercialCarpetSqM: commercialCarpet,
    unbookedResidentialCarpetSqM: unbookedResidentialCarpet,
    unbookedResidentialValue,
    residentialPortion,
    residentialRcmUncapped,
    capAmount,
    capApplied,
    residentialRcm,
    commercialPortion,
    commercialRcm,
    totalRcm,
    cgst,
    sgst: round2(totalRcm - cgst),
  };
};

// ─── Consent gate ───────────────────────────────────────────────────────────

export interface ConsentState {
  emailSentAt: string | null;
  confirmationReceivedAt: string | null;
  approvedAt: string | null;
}

export interface ConsentProgress {
  emailSent: boolean;
  confirmationReceived: boolean;
  approved: boolean;
  /** All three done — the period can file. */
  complete: boolean;
  /** What is outstanding, for the UI to say plainly. */
  nextStep: string;
}

/**
 * Where an ignored FSI liability has got to.
 *
 * The three steps are strictly ordered: the letter goes out, the client's
 * written instruction comes back, and only then does a GST Manager sign it off.
 * Nothing here can be skipped, because the whole point is that the position is
 * the client's and is documented as theirs before anything is filed.
 */
export const consentProgress = (c: ConsentState | null): ConsentProgress => {
  const emailSent = !!c?.emailSentAt;
  const confirmationReceived = !!c?.confirmationReceivedAt;
  const approved = !!c?.approvedAt;
  const complete = emailSent && confirmationReceived && approved;
  return {
    emailSent,
    confirmationReceived,
    approved,
    complete,
    nextStep: !emailSent
      ? 'Send the instruction request to the client'
      : !confirmationReceived
        ? "Attach the client's written confirmation"
        : !approved
          ? 'Awaiting GST Manager approval'
          : 'Complete',
  };
};

/** A period is blocked while an ignored liability lacks a complete consent. */
export const isFilingBlocked = (params: {
  treatment: FsiTreatment;
  totalRcm: number;
  consent: ConsentState | null;
}): boolean =>
  params.treatment === 'IGNORE'
  && (Number(params.totalRcm) || 0) > 0
  && !consentProgress(params.consent).complete;

// ─── Partial ITC apportionment ──────────────────────────────────────────────

export interface CarpetSplit {
  residentialSqM: number;
  commercialSqM: number;
  totalSqM: number;
  /** Share of input tax that is eligible — the commercial side. */
  eligibleShare: number;
  /** Share to reverse — the residential side, treated as exempt supply. */
  reversalShare: number;
}

/**
 * The Rule 42/43 apportionment key for a REP other than an RREP.
 *
 * Residential construction is an exempt supply for this purpose under
 * s.17(2)/(3), so the residential carpet share of input tax is reversed and
 * only the commercial share survives. Monthly, with no annual true-up, per the
 * firm's election.
 */
export const computeCarpetSplit = (residentialSqM: number, commercialSqM: number): CarpetSplit => {
  const resi = Math.max(0, Number(residentialSqM) || 0);
  const comm = Math.max(0, Number(commercialSqM) || 0);
  const total = round2(resi + comm);
  if (total <= 0) {
    return { residentialSqM: resi, commercialSqM: comm, totalSqM: 0, eligibleShare: 0, reversalShare: 0 };
  }
  return {
    residentialSqM: resi,
    commercialSqM: comm,
    totalSqM: total,
    eligibleShare: comm / total,
    reversalShare: resi / total,
  };
};
