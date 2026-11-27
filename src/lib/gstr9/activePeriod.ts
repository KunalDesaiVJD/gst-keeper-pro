// The part of a financial year a client was active (docs/GSTR9_9C_WORKINGS.md §13).
//
// A client deactivated during the year (Edit Client → Inactive at hand, with its
// "Inactive from" date), or whose registration was cancelled during it, still files
// GSTR-9 / 9C for that year, covering only the months it was active. The period runs
// from the later of 1 April and the registration date to the day before the earlier
// of the inactive-from date and the registration's cancellation date. A month with
// at least one active day is an active month.

import { FY_MONTHS, type MonthKey } from './types';

export interface ActivePeriodInput {
  financialYear: string;
  registrationDate?: string | null;
  /** clients.registration_cancellation_date: the cancellation's effective date. */
  registrationCancellationDate?: string | null;
  /** clients.inactive_from: the client is inactive from this date (that day is not active). */
  inactiveFrom?: string | null;
}

export interface ActivePeriod {
  /** yyyy-mm-dd, first active day in the FY. */
  from: string;
  /** yyyy-mm-dd, last active day in the FY. */
  to: string;
  /** Active months of the FY, in FY order (empty when the client was not active in the year). */
  months: MonthKey[];
  /** False when the whole year is active. */
  partial: boolean;
  /** Why the period ends early, e.g. "inactive from 15/09/2025"; null when it runs to 31 March. */
  endReason: string | null;
  /** Why it starts late, e.g. "registered 10/06/2025"; null when it starts on 1 April. */
  startReason: string | null;
  /** "01/04/2025 to 14/09/2025 (inactive from 15/09/2025)"; the full year reads "01/04/2025 to 31/03/2026". */
  label: string;
}

const DAY = 86_400_000;

const parse = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

export const dmyOf = (s: string | null | undefined): string => {
  const t = parse(s);
  if (t === null) return '';
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

/** The FY's first calendar year: '2025-26' → 2025. */
const fyStartYear = (fy: string): number => Number(/^(\d{4})/.exec(fy)?.[1]);

/** The FY month key of a UTC day. */
const monthKeyOf = (t: number): MonthKey => {
  const m = new Date(t).getUTCMonth(); // 0 = Jan
  return FY_MONTHS[(m + 9) % 12];
};

export function activePeriod(i: ActivePeriodInput): ActivePeriod {
  const y = fyStartYear(i.financialYear);
  const fyFrom = Date.UTC(y, 3, 1);
  const fyTo = Date.UTC(y + 1, 2, 31);

  const reg = parse(i.registrationDate);
  const inactive = parse(i.inactiveFrom);
  const cancel = parse(i.registrationCancellationDate);

  let from = fyFrom;
  let startReason: string | null = null;
  if (reg !== null && reg > fyFrom) { from = reg; startReason = `registered ${dmyOf(i.registrationDate)}`; }

  // The earlier of the two end dates decides; each is the first day not active.
  let to = fyTo;
  let endReason: string | null = null;
  const ends: Array<{ at: number; why: string }> = [];
  if (inactive !== null) ends.push({ at: inactive, why: `inactive from ${dmyOf(i.inactiveFrom)}` });
  if (cancel !== null) ends.push({ at: cancel, why: `registration cancelled ${dmyOf(i.registrationCancellationDate)}` });
  ends.sort((a, b) => a.at - b.at);
  if (ends.length && ends[0].at - DAY < fyTo) {
    to = ends[0].at - DAY;
    endReason = ends[0].why;
  }

  const months: MonthKey[] = [];
  if (from <= to) {
    const a = FY_MONTHS.indexOf(monthKeyOf(from));
    const b = FY_MONTHS.indexOf(monthKeyOf(to));
    for (let k = a; k <= b; k += 1) months.push(FY_MONTHS[k]);
  }
  const fromIso = iso(from);
  const toIso = iso(Math.max(from, to));
  const why = [startReason, endReason].filter(Boolean).join('; ');
  return {
    from: fromIso,
    to: iso(to),
    months,
    partial: months.length < 12 || from > fyFrom || to < fyTo,
    endReason,
    startReason,
    label: `${dmyOf(fromIso)} to ${dmyOf(toIso)}${why ? ` (${why})` : ''}`,
  };
}

/** The FY's months the client was not active, in FY order. */
export const inactiveMonths = (p: Pick<ActivePeriod, 'months'> | null | undefined): MonthKey[] =>
  p ? FY_MONTHS.filter((m) => !p.months.includes(m)) : [];
