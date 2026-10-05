// Who files GSTR-9 and GSTR-9C for a financial year — the register on the
// Annual Return home (components/gstr9/register). Pure; no I/O.
//
// Thresholds are on aggregate turnover (s.2(6)): all GSTINs of the PAN
// together, taxable + exempt + exports + inter-state, excluding the taxes and
// inward supplies under reverse charge. The figure is typed in the register
// (client_annual_turnover.aggregate_turnover) — the app has no other source.

/** ₹1 crore. */
export const CRORE = 1_00_00_000;

export interface Thresholds {
  /** GSTR-9 is required ABOVE this; up to it the year is exempt. */
  gstr9: number;
  /** GSTR-9C is required ABOVE this. */
  gstr9c: number;
  /** Where each threshold comes from, for the register's note. */
  gstr9Basis: string;
  gstr9cBasis: string;
}

/** Year-wise notifications exempting aggregate turnover up to ₹2 crore from GSTR-9 (s.44 proviso). */
const GSTR9_EXEMPTION: Record<string, string> = {
  '2017-18': 'Notification 47/2019-CT',
  '2018-19': 'Notification 47/2019-CT',
  '2019-20': 'Notification 77/2020-CT',
  '2020-21': 'Notification 31/2021-CT',
  '2021-22': 'Notification 10/2022-CT',
  '2022-23': 'Notification 32/2023-CT',
  '2023-24': 'Notification 14/2024-CT',
};

export const fyStart = (fy: string): number => Number(fy.slice(0, 4));

export function thresholdsFor(fy: string): Thresholds {
  const y = fyStart(fy);
  return {
    gstr9: 2 * CRORE,
    // From FY 2024-25 the exemption is standing (17 Sep 2025), no longer notified year by year.
    gstr9Basis: GSTR9_EXEMPTION[fy] ?? 'Notification 15/2025-CT (FY 2024-25 onwards)',
    gstr9c: y <= 2017 ? 2 * CRORE : 5 * CRORE,
    gstr9cBasis:
      y <= 2017 ? 's.35(5) — audited reconciliation'
        : y === 2018 ? 'Notification 16/2020-CT'
          : y === 2019 ? 'Notification 79/2020-CT'
            : 'rule 80(3) — self-certified (Notification 30/2021-CT)',
  };
}

/** "₹2 crore", "₹5 crore". */
export const croreText = (n: number): string => `₹${+(n / CRORE).toFixed(2)} crore`;

/** Required / exempt (or not required) / not applicable to this registration / turnover not typed yet. */
export type Need = 'required' | 'exempt' | 'not_applicable' | 'unknown';

export interface ApplicabilityInput {
  financialYear: string;
  registrationType: string | null;
  registrationDate?: string | null;
  /** Effective cancellation of the registration, if any. */
  cancellationDate?: string | null;
  turnover: number | null;
  gstr9OptIn: boolean;
  gstr9cOptIn: boolean;
}

export interface Applicability {
  gstr9: Need;
  gstr9c: Need;
  /** In scope: required, or exempt and the client wishes it filed. */
  file9: boolean;
  file9c: boolean;
  /** Why the registration files neither (composition, TDS, ISD, not registered in the year). */
  notApplicable?: string;
  thresholds: Thresholds;
}

/** Registrations that never file GSTR-9, and what they file instead. */
const NO_ANNUAL_RETURN: Record<string, string> = {
  Composition: 'Composition — files GSTR-4 (annual), not GSTR-9',
  'Tax Deductor': 'Tax deductor — files GSTR-7, no GSTR-9',
  ISD: 'Input Service Distributor — no annual return',
};

const day = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
};

export function applicability(i: ApplicabilityInput): Applicability {
  const thresholds = thresholdsFor(i.financialYear);
  const none = (why: string): Applicability => ({ gstr9: 'not_applicable', gstr9c: 'not_applicable', file9: false, file9c: false, notApplicable: why, thresholds });

  const type = i.registrationType ?? 'Regular';
  if (NO_ANNUAL_RETURN[type]) return none(NO_ANNUAL_RETURN[type]);

  const y = fyStart(i.financialYear);
  const from = Date.UTC(y, 3, 1);
  const to = Date.UTC(y + 1, 2, 31);
  const reg = day(i.registrationDate);
  const cancel = day(i.cancellationDate);
  if (reg !== null && reg > to) return none(`Registered after FY ${i.financialYear}`);
  if (cancel !== null && cancel < from) return none(`Registration cancelled before FY ${i.financialYear}`);

  if (i.turnover === null || i.turnover === undefined || Number.isNaN(i.turnover)) {
    return { gstr9: 'unknown', gstr9c: 'unknown', file9: false, file9c: false, thresholds };
  }
  const gstr9: Need = i.turnover > thresholds.gstr9 ? 'required' : 'exempt';
  const gstr9c: Need = i.turnover > thresholds.gstr9c ? 'required' : 'exempt';
  const file9 = gstr9 === 'required' || i.gstr9OptIn;
  // 9C reconciles the GSTR-9 it accompanies: only when GSTR-9 is filed.
  const file9c = gstr9c === 'required' || (file9 && i.gstr9cOptIn);
  return { gstr9, gstr9c, file9, file9c, thresholds };
}

/** The PAN inside a GSTIN (characters 3–12), or null. */
export const panOf = (gstin: string | null | undefined): string | null => {
  const g = (gstin ?? '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{10}/.test(g) ? g.slice(2, 12) : null;
};
