// Return periods for the evidence recipes: "MM/YYYY" (how the extension keys
// gst_filed_returns), financial years "2023-24", calendar dates "YYYY-MM-DD".
// Pure: no time zone enters (dates are strings, arithmetic is UTC day counts).
import type { IssueLite, NoticeLite, PeriodInfo } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export const isPeriod = (p: string | null | undefined): p is string => !!p && /^(0[1-9]|1[0-2])\/\d{4}$/.test(p);

export const periodIndex = (p: string): number => {
  const [m, y] = p.split('/').map(Number);
  return y * 12 + (m - 1);
};
export const periodFromIndex = (i: number): string => `${String((i % 12) + 1).padStart(2, '0')}/${Math.floor(i / 12)}`;
export const comparePeriods = (a: string, b: string): number => periodIndex(a) - periodIndex(b);
export const sortPeriods = (ps: string[]): string[] => [...new Set(ps)].sort(comparePeriods);

/** "04/2023" → "Apr 2023". */
export const periodLabel = (p: string): string => {
  if (!isPeriod(p)) return p;
  const [m, y] = p.split('/').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

/** "2023-07-15" → "07/2023". */
export const periodOfDate = (iso: string): string => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const periodStartIso = (p: string): string => `${p.slice(3)}-${p.slice(0, 2)}-01`;
export const periodEndIso = (p: string): string => {
  const [m, y] = p.split('/').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

/** Every month from a to b inclusive, oldest first. */
export const monthRange = (a: string, b: string): string[] => {
  const [lo, hi] = [periodIndex(a), periodIndex(b)].sort((x, y) => x - y);
  return Array.from({ length: hi - lo + 1 }, (_, i) => periodFromIndex(lo + i));
};

// ── Financial years ─────────────────────────────────────────────────────────
/** "2023-2024" / "FY 2023-24" / "2023-24" → "2023-24"; null when it is not an FY. */
export const normalizeFy = (fy: string | null | undefined): string | null => {
  if (!fy) return null;
  const m = String(fy).match(/(20\d{2})\s*[-–/]\s*(\d{2,4})/);
  if (!m) return null;
  const start = Number(m[1]);
  return `${start}-${String(start + 1).slice(-2)}`;
};
export const fyStartYear = (fy: string): number => Number(fy.slice(0, 4));
/** "2023-24" → "2023-2024" (the statements' key). */
export const fyLong = (fy: string): string => `${fyStartYear(fy)}-${fyStartYear(fy) + 1}`;
/** "07/2023" → "2023-24". */
export const fyOfPeriod = (p: string): string => {
  const [m, y] = p.split('/').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};
export const fyOfDate = (iso: string): string => fyOfPeriod(periodOfDate(iso));
/** "2023-24" → ["04/2023", …, "03/2024"]. */
export const fyMonths = (fy: string): string[] => {
  const start = fyStartYear(fy);
  return monthRange(`04/${start}`, `03/${start + 1}`);
};
/** The March that ends the FY — how the agent's FY reports take their period. */
export const fyMarch = (fy: string): string => `03/${fyStartYear(fy) + 1}`;
export const fyLabel = (fy: string): string => `FY ${fy}`;

// ── Days ────────────────────────────────────────────────────────────────────
const utc = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
/** Whole days from a to b (b − a). */
export const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / DAY_MS);
export const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A return for "MM/YYYY" falls due on `day` of the next month (clamped to the month's length). */
export const dueDateIso = (p: string, day: number): string => {
  const [m, y] = p.split('/').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(y, m, Math.min(Math.max(1, day), last)));
};

/** "15-07-2023" / "15/07/2023" / "2023-07-15" → "2023-07-15"; null when it is not a date. */
export const toIsoDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

/** "2023-07-15" → "15 Jul 2023". */
export const dateLabel = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
};

// ── Labels ──────────────────────────────────────────────────────────────────
/** "FY 2023-24", "Apr – Jun 2023", "Aug 2023", "Dec 2022 – Feb 2023". */
export const periodsLabel = (ps: string[]): string => {
  const s = sortPeriods(ps);
  if (!s.length) return 'no period';
  if (s.length === 12 && s[0].startsWith('04/') && fyMonths(fyOfPeriod(s[0])).every((p, i) => p === s[i])) return fyLabel(fyOfPeriod(s[0]));
  if (s.length === 1) return periodLabel(s[0]);
  const contiguous = s.every((p, i) => i === 0 || periodIndex(p) === periodIndex(s[i - 1]) + 1);
  if (contiguous) {
    const [a, b] = [s[0], s[s.length - 1]];
    return a.slice(3) === b.slice(3) ? `${MONTHS[Number(a.slice(0, 2)) - 1]} – ${periodLabel(b)}` : `${periodLabel(a)} – ${periodLabel(b)}`;
  }
  return s.length > 4 ? `${s.slice(0, 3).map(periodLabel).join(', ')} and ${s.length - 3} more` : s.map(periodLabel).join(', ');
};

// ── Which months a notice is about ─────────────────────────────────────────
const monthsOfRange = (from: string | null, to: string | null): string[] => {
  const a = from ? toIsoDate(from) : null;
  const b = to ? toIsoDate(to) : null;
  if (!a && !b) return [];
  return monthRange(periodOfDate(a ?? (b as string)), periodOfDate(b ?? (a as string)));
};

/** Months that have started by `today` (a later month cannot have a return yet). */
const started = (ps: string[], today: string): string[] => ps.filter((p) => periodStartIso(p) <= today);

/**
 * The months a recipe looks at: the issue's period, else the notice's period,
 * else the notice's financial year, else (ASMT-10 and DRC-01A only) the FY of
 * the issue date — that last one is an assumption the tab says so about.
 */
export function resolvePeriod(input: { issue?: IssueLite | null; notice: NoticeLite; today: string }): PeriodInfo {
  const { issue, notice, today } = input;
  const make = (periods: string[], source: PeriodInfo['source'], assumed = false): PeriodInfo => {
    const ps = sortPeriods(started(periods, today));
    const fys = [...new Set(ps.map(fyOfPeriod))];
    return { periods: ps, source, label: periodsLabel(ps), financialYear: fys.length === 1 ? fys[0] : null, assumed };
  };
  const fromIssue = issue ? monthsOfRange(issue.periodFrom, issue.periodTo) : [];
  if (fromIssue.length) return make(fromIssue, 'issue');
  const fromNotice = monthsOfRange(notice.periodFrom, notice.periodTo);
  if (fromNotice.length) return make(fromNotice, 'notice');
  const fy = normalizeFy(notice.financialYear);
  if (fy) return make(fyMonths(fy), 'notice_fy');
  if ((notice.formCode === 'ASMT-10' || notice.formCode === 'DRC-01A') && notice.issueDate) {
    const iso = toIsoDate(notice.issueDate);
    if (iso) return make(fyMonths(fyOfDate(iso)), 'issue_date', true);
  }
  return { periods: [], source: 'none', label: 'no period', financialYear: null, assumed: false };
}

export const PERIOD_SOURCE_WORDS: Record<PeriodInfo['source'], string> = {
  issue: "from the issue's period",
  notice: "from the notice's tax period",
  notice_fy: "from the notice's financial year",
  issue_date: 'assumed: the financial year of the issue date',
  none: 'not stated',
};

/** The financial years a set of months touches, oldest first. */
export const fysOf = (ps: string[]): string[] => [...new Set(sortPeriods(ps).map(fyOfPeriod))];
