// Dates and periods as the portal writes them, for the ITC reconciliation.
// Pure: no time zone enters except istToday(), which only the report builder
// calls (the engine is handed "today" so a test can fix it).
import { periodFromIndex, periodIndex, toIsoDate } from '@/lib/reply/periods';

const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

const validIso = (y: number, m: number, d: number): string | null => {
  if (!(y >= 2000 && y <= 2100) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

/**
 * "2026-08-14", "14-08-2026", "14/08/2026" (2B, invoices), "11-Sep-25" and
 * "11-Sep-2025" (2A's fldtr1) → ISO; null for anything else. A two-digit year is 20YY.
 */
export function parsePortalDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const mon = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2}|\d{4})$/);
  if (mon) {
    const m = MON[mon[2].toUpperCase()];
    return m ? validIso(year4(mon[3]), m, Number(mon[1])) : null;
  }
  const iso = toIsoDate(s);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return validIso(y, m, d);
}

/** "072026", "07/2026", "Jul-26", "Jul-2026" → "07/2026"; null for anything else. */
export function parseSupplierPeriod(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{2})\/?(\d{4})$/);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[1]}/${m[2]}` : null;
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2}|\d{4})$/);
  if (m) {
    const mo = MON[m[1].toUpperCase()];
    return mo ? `${pad2(mo)}/${year4(m[2])}` : null;
  }
  return null;
}

export const addMonths = (period: string, n: number): string => periodFromIndex(periodIndex(period) + n);
export const nextPeriod = (period: string): string => addMonths(period, 1);
export const prevPeriod = (period: string): string => addMonths(period, -1);

/** Day `day` of the month after `period`, ISO. */
export const dayOfNextMonth = (period: string, day: number): string => {
  const [m, y] = period.split('/').map(Number);
  return `${m === 12 ? y + 1 : y}-${pad2(m === 12 ? 1 : m + 1)}-${pad2(day)}`;
};

/** The date a month's GSTR-2B is generated on the portal: the 14th of the next month. */
export const due2BDate = (period: string): string => dayOfNextMonth(period, 14);

export const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export interface Cutoff {
  /** A supplier filing by this date (the 11th of M+1, the monthly GSTR-1 date) is in this 2B for certain. */
  sureBy: string;
  /** Filed after this date (the 13th of M+1, the IFF date), a document belongs to a later 2B. */
  latest: string;
  generatedOn: string | null;
}

/**
 * The cut-off of a month's GSTR-2B (rule 60(7): the GSTR-1 / IFF due dates).
 * The 12th and 13th are ambiguous: a quarterly (IFF / QRMP) supplier's filing
 * up to the 13th is in this 2B, a monthly filer's is not. The 2B's generation
 * date does not move it: a 2B generated late (on demand once the previous
 * GSTR-3B is filed, or recomputed after IMS actions) does not take in later
 * filings. A notified extension of the GSTR-1 / IFF due date would; none is
 * modelled.
 */
export function cutoffOf2B(period: string, generatedOn: string | null): Cutoff {
  return { sureBy: dayOfNextMonth(period, 11), latest: dayOfNextMonth(period, 13), generatedOn };
}

/** "2026-08-14" → "14 Aug 2026". */
export const dayLabel = (iso: string | null | undefined): string => {
  if (!iso) return 'unknown';
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
};

/** "2026-08-14" → "14-08-2026" (the portal's own spelling, for the document list). */
export const portalDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

/** "07/2026" → "Jul 2026". */
export const monthLabel = (period: string | null | undefined): string => {
  if (!period) return '';
  const m = period.match(/^(\d{2})\/(\d{4})$/);
  return m ? `${MONTHS[Number(m[1]) - 1]} ${m[2]}` : period;
};

/** Today in India (the portal's clock). Only the report builder calls this. */
export const istToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
