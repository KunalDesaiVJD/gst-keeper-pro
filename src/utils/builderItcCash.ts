/**
 * The firm's cash-vs-credit policy for a mixed builder project, laid out as a
 * working paper — NOT a description of how the GST portal itself behaves.
 *
 * The portal does not segregate input tax credit by supply type: GSTR-3B
 * nets the whole of a client's available CGST/SGST credit against the whole
 * of its CGST/SGST liability, in aggregate, whatever generated either side.
 * Nothing in GST law would stop leftover commercial-eligible credit from
 * being used against a residential (1.5%/7.5%, no-ITC-condition) liability
 * on the actual return.
 *
 * The firm elects not to do that anyway, as a matter of internal discipline:
 * commercial output tax (18%, proportionate credit) sets off against the
 * credit apportioned to it; residential output tax is paid in cash in full,
 * every period, regardless of any surplus credit sitting in the ledger. This
 * mirrors the conservative-by-design positions already on record — see
 * docs/BUILDER_GST_POSITIONS.md §7 (partial ITC) and §14 (onboarding status).
 *
 * This module only suggests the split; nothing here posts, locks, or writes
 * anything. Whoever prepares the return decides whether to follow it.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ItcCashWorkingPaperInput {
  commercialOutputTax: number;
  residentialOutputTax: number;
  /** Net ITC available for the period (4C) — after the residential-attributable reversal. */
  netItcAvailable: number;
}

export interface ItcCashWorkingPaper {
  commercialOutputTax: number;
  residentialOutputTax: number;
  netItcAvailable: number;
  /** How much of the available credit the policy applies against commercial output tax. */
  commercialSetOff: number;
  /** Commercial shortfall left to pay in cash once credit runs out. */
  commercialCashDue: number;
  /** Residential output tax, always payable in cash under the firm's policy. */
  residentialCashDue: number;
  /** Credit left over after commercial is fully set off — carried forward, never applied to residential. */
  itcCarriedForward: number;
  /** What the firm should arrange in cash for this period, under this policy. */
  totalCashRequired: number;
}

export const computeItcCashWorkingPaper = (input: ItcCashWorkingPaperInput): ItcCashWorkingPaper => {
  const commercialOutputTax = Math.max(0, round2(input.commercialOutputTax));
  const residentialOutputTax = Math.max(0, round2(input.residentialOutputTax));
  const netItcAvailable = Math.max(0, round2(input.netItcAvailable));

  const commercialSetOff = round2(Math.min(commercialOutputTax, netItcAvailable));
  const commercialCashDue = round2(Math.max(0, commercialOutputTax - netItcAvailable));
  const itcCarriedForward = round2(Math.max(0, netItcAvailable - commercialOutputTax));
  // Never applied against residentialOutputTax — that is the entire point of the policy.
  const residentialCashDue = residentialOutputTax;

  return {
    commercialOutputTax,
    residentialOutputTax,
    netItcAvailable,
    commercialSetOff,
    commercialCashDue,
    residentialCashDue,
    itcCarriedForward,
    totalCashRequired: round2(commercialCashDue + residentialCashDue),
  };
};
