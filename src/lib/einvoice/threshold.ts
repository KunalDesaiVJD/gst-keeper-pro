// E-invoice applicability by turnover. Pure functions — no I/O.
//
// Rule 48(4) CGST Rules read with Notification 13/2020-CT as amended (last by
// 10/2023-CT): e-invoicing is mandatory for a registered person whose
// aggregate turnover in ANY preceding financial year from 2017-18 onwards
// exceeded ₹5 crore. Once a year crosses the limit it applies from the next
// financial year. Certain classes are exempt whatever their turnover
// (EINVOICE_EXEMPTIONS below) — those clients are left out of the alerts.
//
// "Approaching" is the firm's early warning, not a legal test: any year's
// turnover — including the current year's running figure — at or above
// EINVOICE_APPROACH_SHARE of the limit. Aggregate turnover is PAN-wide; the
// app only sees this GSTIN's returns, so the running figure is a floor, and
// the per-year figures entered on the client (client_annual_turnover) take
// precedence where they exist.

import type { Gstr1Summary } from '@/utils/buildGstr1Summary';

export const EINVOICE_THRESHOLD = 5_00_00_000; // ₹5 crore
export const EINVOICE_APPROACH_SHARE = 0.8;    // alert from ₹4 crore
export const EINVOICE_APPROACH_AT = EINVOICE_THRESHOLD * EINVOICE_APPROACH_SHARE;

/** Classes exempt from e-invoicing (rule 48(4) proviso / Notification 13/2020-CT para 2, as amended). */
export const EINVOICE_EXEMPTIONS = [
  { value: 'gta', label: 'Goods Transport Agency (GTA) / transporter' },
  { value: 'banking', label: 'Insurer, banking company or financial institution (incl. NBFC)' },
  { value: 'passenger_transport', label: 'Passenger transportation service' },
  { value: 'cinema', label: 'Admission to exhibition of cinematograph films (multiplex)' },
  { value: 'sez_unit', label: 'SEZ unit (not developer)' },
  { value: 'government', label: 'Government department / local authority' },
] as const;

export type EinvoiceExemption = (typeof EINVOICE_EXEMPTIONS)[number]['value'];

export const exemptionLabel = (v: string | null | undefined): string | null =>
  EINVOICE_EXEMPTIONS.find((e) => e.value === v)?.label ?? (v ? v : null);

export type EinvoiceStatus =
  | 'exempt'        // an exempt class — never applicable
  | 'mandatory'     // a preceding FY exceeded ₹5 crore
  | 'next_fy'       // the current FY has already exceeded ₹5 crore: applies from next 1 April
  | 'approaching'   // some year is at or above ₹4 crore
  | 'below';

export interface FyTurnover {
  financial_year: string; // "2026-27"
  turnover: number;
  /** Where the figure came from — the client's entered aggregate turnover, or this GSTIN's GSTR-1s. */
  source: 'entered' | 'gstr1';
}

export interface EinvoiceAssessment {
  status: EinvoiceStatus;
  /** The year that decided the status (highest relevant turnover). */
  decidingYear: FyTurnover | null;
  /** True when the client is not ticked as an e-invoice client but should be. */
  shouldBeTicked: boolean;
  message: string;
}

/** FY label ("2026-27") for a date. */
export const fyOf = (d: Date): string => {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

/** FY label for an MM/YYYY return period. */
export const fyOfPeriod = (period: string): string => {
  const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
  if (!mm || !yyyy) return '';
  const y = mm >= 4 ? yyyy : yyyy - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

/**
 * A month's turnover from its GSTR-1: taxable outward supplies (4A–6C, 7),
 * nil-rated / exempt / non-GST (8), net of credit and debit notes (9B, which
 * buildGstr1Summary already carries net and at taxable value). Advances
 * (11A/11B), HSN and documents are not turnover.
 */
export const gstr1MonthTurnover = (summary: Gstr1Summary): number => {
  const pick = new Set(['4A', '4B', '5', '6A', '6B', '6C', '7', '8', '9B']);
  return summary.sections.filter((s) => pick.has(s.code)).reduce((t, s) => t + s.value, 0);
};

const crore = (n: number) => `₹${(n / 1_00_00_000).toFixed(2)} crore`;

export function assessEinvoice(args: {
  ticked: boolean;
  exemption: string | null | undefined;
  years: FyTurnover[];
  today?: Date;
}): EinvoiceAssessment {
  const { ticked, exemption, years } = args;
  const currentFy = fyOf(args.today ?? new Date());

  if (exemption) {
    return { status: 'exempt', decidingYear: null, shouldBeTicked: false, message: `Exempt from e-invoicing: ${exemptionLabel(exemption)}.` };
  }

  // One figure per FY: an entered aggregate turnover wins over the GSTR-1 sum.
  const perFy = new Map<string, FyTurnover>();
  years.forEach((y) => {
    if (!y.financial_year || !(y.turnover > 0)) return;
    const cur = perFy.get(y.financial_year);
    if (!cur || (y.source === 'entered' && cur.source !== 'entered')) perFy.set(y.financial_year, y);
  });
  const all = [...perFy.values()].filter((y) => y.financial_year >= '2017-18');
  const preceding = all.filter((y) => y.financial_year < currentFy);
  const current = all.find((y) => y.financial_year === currentFy) || null;
  const maxOf = (arr: FyTurnover[]) => arr.reduce<FyTurnover | null>((m, y) => (!m || y.turnover > m.turnover ? y : m), null);

  const topPreceding = maxOf(preceding);
  if (topPreceding && topPreceding.turnover > EINVOICE_THRESHOLD) {
    return {
      status: 'mandatory', decidingYear: topPreceding, shouldBeTicked: !ticked,
      message: `E-invoicing is mandatory: FY ${topPreceding.financial_year} turnover was ${crore(topPreceding.turnover)} (limit ₹5 crore).`,
    };
  }
  if (current && current.turnover > EINVOICE_THRESHOLD) {
    return {
      status: 'next_fy', decidingYear: current, shouldBeTicked: false,
      message: `FY ${current.financial_year} turnover has reached ${crore(current.turnover)} — e-invoicing applies from 1 April of the next financial year.`,
    };
  }
  const top = maxOf(all);
  if (top && top.turnover >= EINVOICE_APPROACH_AT) {
    return {
      status: 'approaching', decidingYear: top, shouldBeTicked: false,
      message: `Approaching the e-invoice limit: FY ${top.financial_year} turnover is ${crore(top.turnover)} of ₹5 crore.`,
    };
  }
  return { status: 'below', decidingYear: top, shouldBeTicked: false, message: 'Below the e-invoice threshold.' };
}
