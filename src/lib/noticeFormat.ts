// One set of formats for the Notices & Litigation module (audit cross-cutting
// finding "six date formats", U-01-3, U-30-4): calendar dates as "05 Oct 2026",
// short days as "Mon 5 Oct", sync times as a relative age, money as ₹ with
// lakh / crore, financial years as "2026-27", and the portal's Title Case
// ("Determination Of Tax") in sentence case.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "05 Oct 2026" (a calendar date; no time-zone shift). "—" when empty. */
export function fmtDate(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "Mon 5 Oct" — for days near today. */
export function fmtDay(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return '—';
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAYS[wd]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "05 Oct 2026, 07:41" in IST, for a timestamp. */
export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fmtDate(date)}, ${time}`;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", else the date. */
export function fmtAgo(ts: string | null | undefined, now: number = Date.now()): string {
  if (!ts) return 'never';
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return '—';
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return fmtDate(new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
}

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** "₹4,82,690". "—" when there is no amount. */
export function fmtInr(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₹${INR.format(Math.round(v))}`;
}

/** "₹4.82 L", "₹2.86 cr", "₹43,860" (under a lakh in full). */
export function fmtInrShort(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `₹${trim(v / 1e7)} cr`;
  if (abs >= 1e5) return `₹${trim(v / 1e5)} L`;
  return fmtInr(v);
}

/** "2026-2027" / "2026-27" / "FY 2026-27" → "2026-27". */
export function fmtFy(fy: string | null | undefined): string {
  if (!fy) return '';
  const m = String(fy).match(/(\d{4})\s*[-–/]\s*(\d{2,4})/);
  if (!m) return String(fy);
  return `${m[1]}-${m[2].slice(-2)}`;
}

/** "1 notice", "3 notices" (pass the plural when it is not just +s). */
export function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/** Due-date wording from days to due: "due today", "in 3 d", "2 d late". */
export function dueWords(daysToDue: number | null | undefined): string {
  if (daysToDue === null || daysToDue === undefined) return 'no due date';
  if (daysToDue === 0) return 'due today';
  if (daysToDue > 0) return `in ${daysToDue} d`;
  return `${-daysToDue} d late`;
}

const ACRONYM = /^[A-Z0-9][A-Z0-9-/.&()]*$/;

/** The portal's Title Case in sentence case, keeping acronyms and form codes. */
export function sentenceCase(s: string | null | undefined): string {
  if (!s) return '';
  const words = s.trim().split(/\s+/);
  return words.map((w, i) => {
    if (ACRONYM.test(w) && /[A-Z]/.test(w) && w.length > 1) return w;      // GST, DRC-01, ASMT-10, ITC
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    return /^[A-Z][a-z']+$/.test(w) ? w.toLowerCase() : w;
  }).join(' ');
}

const GENERIC_TYPES = new Set(['notice', 'order', 'notices', 'orders', '']);

interface TitleSource {
  form_code?: string | null;
  form_label?: string | null;
  notice_type?: string | null;
  description?: string | null;
  financial_year?: string | null;
}

/**
 * What a notice is, in one line: "ASMT-10 · Scrutiny of returns · FY 2023-24".
 * The form's label when the classifier knows the form; otherwise the portal's
 * type unless it is just "Notice" / "Order", then the start of the description.
 */
export function noticeTitle(n: TitleSource, opts: { fy?: boolean } = {}): string {
  const code = n.form_code && !/^(DROPPED|ACCEPTED|LUT-APPROVED|SPL-APPROVED|REG-SCN)$/.test(n.form_code) ? n.form_code : '';
  let subject = (n.form_label || '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '').trim();
  if (!subject) {
    const type = (n.notice_type || '').trim();
    subject = GENERIC_TYPES.has(type.toLowerCase())
      ? sentenceCase((n.description || type || 'Notice').split(/[.;\n]/)[0]).slice(0, 90)
      : sentenceCase(type);
  }
  const out = [code, subject].filter(Boolean);
  const fy = fmtFy(n.financial_year);
  if (opts.fy !== false && fy) out.push(`FY ${fy}`);
  return out.join(' · ') || 'Notice';
}

const AUTO_REASONS: Record<string, string> = {
  closure: 'closure on the portal',
  refund_paid: 'refund paid',
  refund_order: 'refund order captured',
  lut_approval: 'LUT approved',
  drc03_acknowledged: 'DRC-03 acknowledged',
  proceedings_dropped: 'proceedings dropped',
  accepted: 'response or payment accepted',
  informational_order: 'informational order, nothing to do',
};

/** "Closed automatically: LUT approved" for the sweep's tags; staff reasons as typed. */
export function closeReasonText(reason: string | null | undefined): string {
  if (!reason) return '';
  const m = reason.match(/^auto:(.+)$/);
  if (!m) return reason;
  return `Closed automatically: ${AUTO_REASONS[m[1]] ?? m[1].replace(/_/g, ' ')}`;
}

export const isAutoClosed = (reason: string | null | undefined): boolean => /^auto:/.test(reason || '');

/** Initials for an owner chip. */
export function initials(name: string | null | undefined): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}
