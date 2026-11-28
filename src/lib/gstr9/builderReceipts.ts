// Builder clients: a rate line of the Duties & Taxes rate-wise breakup can be
// entered from the month's RECEIPTS (amount received, inclusive of GST). The
// taxable value and tax are backed out at the project's rate, as the Builder
// module does (src/utils/builderRates.ts, Notification 11/2017-CT(R) Entry 3):
//
//   consideration = receipt × 100 ÷ (100 + effective rate)   (1 / 5 / 12%)
//   land (1/3)    = consideration ÷ 3
//   taxable value = consideration − land                     (2/3rd)
//   tax           = taxable value × notified rate            (1.5 / 7.5 / 18%)
//
// Pure: no data access here (see builderProjectRates.ts for the projects).

import {
  EFFECTIVE_RATE_PCT,
  NOTIFIED_RATE_PCT,
  type BuilderRateCode,
} from '@/utils/builderRates';

export const BUILDER_RATE_CODES: BuilderRateCode[] = ['AFFORDABLE', 'OTHER_RESIDENTIAL', 'COMMERCIAL_RREP', 'COMMERCIAL_REP'];

/** Short labels for the rate-wise dialog's Type column. */
export const BUILDER_RATE_SHORT: Record<BuilderRateCode, string> = {
  AFFORDABLE: 'Affordable resi. 1.5% (eff. 1%)',
  OTHER_RESIDENTIAL: 'Other resi. 7.5% (eff. 5%)',
  COMMERCIAL_RREP: 'Comm. in RREP 7.5% (eff. 5%)',
  COMMERCIAL_REP: 'Comm. in REP 18% (eff. 12%)',
};

export const isBuilderRateCode = (v: unknown): v is BuilderRateCode =>
  typeof v === 'string' && (BUILDER_RATE_CODES as string[]).includes(v);

const round2 = (n: number): number => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

export interface ReceiptBreakup {
  receipt: number;
  /** Consideration excluding GST, land included. */
  consideration: number;
  /** 1/3rd deemed land value (para 2 of Notif 11/2017). */
  land: number;
  /** 2/3rd: the taxable value the returns carry. */
  taxable: number;
  /** Notified rate on the taxable value (1.5 / 7.5 / 18). */
  ratePct: number;
  /** Effective rate on the whole consideration (1 / 5 / 12). */
  effectivePct: number;
}

/** Back the taxable value out of a GST-inclusive receipt at a builder rate. A negative receipt (a refund) gives negative figures. */
export function receiptBreakup(receipt: number, code: BuilderRateCode): ReceiptBreakup {
  const r = Number.isFinite(receipt) ? receipt : 0;
  const effectivePct = EFFECTIVE_RATE_PCT[code];
  const consideration = round2((r * 100) / (100 + effectivePct));
  const land = round2(consideration / 3);
  return { receipt: round2(r), consideration, land, taxable: round2(consideration - land), ratePct: NOTIFIED_RATE_PCT[code], effectivePct };
}

/** A project of the client with the rate codes its units carry, most units first. */
export interface BuilderProjectRate {
  id: string;
  name: string;
  /** Rate codes of the project's live units, by unit count (empty: no units yet). */
  codes: BuilderRateCode[];
}

/** The code a line takes when its project is chosen: the project's main code, else Other residential. */
export const projectDefaultCode = (p: BuilderProjectRate | undefined): BuilderRateCode => p?.codes[0] ?? 'OTHER_RESIDENTIAL';
