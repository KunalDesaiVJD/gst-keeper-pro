// GST data reminders: which day each reminder goes out, for every return period.
//
// The one source of truth for the dates. The daily job (queue-gst-reminders)
// and the GST Reminders page (src/lib/reminderPlans.ts re-exports this file)
// both read it, so the page shows exactly what the job will do.
//
// Two layers:
//   - the standard schedule (return_reminder_schedules): days of the month
//     after the period, the same every month, e.g. GSTR-3B due on the 20th,
//     reminders on the 14th, 16th and 17th;
//   - a period's own plan (reminder_period_plans): real calendar dates for one
//     period and return, any day from the first of the period month up to its
//     due date (so October's reminders can go out in October, before Diwali),
//     and a due date that follows a CBIC extension.
// A period with no plan of its own uses the standard schedule.
//
// A reminder is due on its date. On any day the job sends at most one
// reminder per client, return and period: the latest step whose date has come.
// An earlier step that was missed is skipped, never sent late in a burst, and
// nothing goes out after the due date. Pure TypeScript, no imports, so the
// Deno function and the Vite app share it.

export const PLAN_RETURN_TYPES = ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)', 'GSTR-6', 'GSTR-7'] as const;
export type PlanReturnType = (typeof PLAN_RETURN_TYPES)[number];
export type ReminderStep = 1 | 2 | 3;
export const STEPS: ReminderStep[] = [1, 2, 3];

export const STEP_TEMPLATE: Record<ReminderStep, string> = { 1: 'reminder_1', 2: 'reminder_2', 3: 'reminder_final' };
export const STEP_LABEL: Record<ReminderStep, string> = { 1: '1st reminder', 2: '2nd reminder', 3: 'Final reminder' };

export interface StandardScheduleRow {
  return_type: string;
  due_day: number;
  due_day_y?: number | null;
  reminder_1_day: number | null;
  reminder_2_day: number | null;
  reminder_final_day: number | null;
}

export interface PeriodPlanRow {
  period_month: string;          // MM/YYYY
  return_type: string;
  due_date: string;              // YYYY-MM-DD
  due_date_y?: string | null;    // GSTR-3B (Q): states of the 24th group
  data_by_date?: string | null;
  reminder_1_date: string | null;
  reminder_2_date: string | null;
  reminder_final_date: string | null;
  note?: string | null;
}

export interface ResolvedPlan {
  period: string;
  returnType: string;
  source: 'period' | 'standard';
  dueDate: string;
  dueDateY: string | null;
  dataByDate: string;
  dates: Record<ReminderStep, string | null>;
  note: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

export function parsePeriod(period: string): { month: number; year: number } | null {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((period ?? '').trim());
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? { month, year: Number(m[2]) } : null;
}

export function periodOf(month: number, year: number): string {
  return `${pad(month)}/${year}`;
}

/** The period before / after, as MM/YYYY. */
export function shiftPeriod(period: string, by: number): string {
  const p = parsePeriod(period);
  if (!p) return period;
  const idx = p.year * 12 + (p.month - 1) + by;
  return periodOf((idx % 12) + 1, Math.floor(idx / 12));
}

export function isoDate(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(Math.max(1, day), last))}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the period month (the earliest date a plan may use). */
export function periodStart(period: string): string {
  const p = parsePeriod(period)!;
  return isoDate(p.year, p.month, 1);
}

/** Today's calendar date in India, YYYY-MM-DD. */
export function todayIST(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The period whose returns are being filed this month (last month). */
export function currentReturnPeriod(now: number = Date.now()): string {
  const t = todayIST(now);
  return shiftPeriod(periodOf(Number(t.slice(5, 7)), Number(t.slice(0, 4))), -1);
}

/** '2026-11-20' → '20 Nov 2026'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function isQuarterEnd(period: string): boolean {
  const p = parsePeriod(period);
  return !!p && p.month % 3 === 0;
}

/** Whether a return is filed for this period at all (GSTR-3B (Q): quarter-end months only). */
export function returnFiledForPeriod(returnType: string, period: string): boolean {
  return returnType === 'GSTR-3B (Q)' ? isQuarterEnd(period) : true;
}

// GSTR-3B (Q) is due on the 22nd for these states and union territories (by
// the first two digits of the GSTIN) and on the 24th for every other state
// (Notification 1/2020 - Central Tax and its successors).
// 22 Chhattisgarh, 23 Madhya Pradesh, 24 Gujarat, 25/26 Daman & Diu and Dadra
// & Nagar Haveli, 27 Maharashtra, 29 Karnataka, 30 Goa, 31 Lakshadweep,
// 32 Kerala, 33 Tamil Nadu, 34 Puducherry, 35 Andaman & Nicobar,
// 36 Telangana, 37 Andhra Pradesh.
const STATES_22ND = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);

export function isTwentySecondState(gstin: string | null | undefined): boolean {
  return STATES_22ND.has((gstin ?? '').slice(0, 2));
}

/** A return's standard row, or its base return's (IFF → GSTR-1, 3B (Q) → GSTR-3B). */
export function standardFor(returnType: string, rows: StandardScheduleRow[]): StandardScheduleRow | null {
  const own = rows.find((r) => r.return_type === returnType);
  if (own) return own;
  const base = returnType === 'GSTR-1 (IFF)' ? 'GSTR-1' : returnType === 'GSTR-3B (Q)' ? 'GSTR-3B' : null;
  return base ? rows.find((r) => r.return_type === base) ?? null : null;
}

/** The dates that apply to one return of one period. */
export function resolvePlan(
  period: string,
  returnType: string,
  standard: StandardScheduleRow[],
  plans: PeriodPlanRow[],
): ResolvedPlan | null {
  if (!parsePeriod(period)) return null;
  const own = plans.find((p) => p.period_month === period && p.return_type === returnType);
  if (own) {
    return {
      period, returnType, source: 'period',
      dueDate: own.due_date,
      dueDateY: own.due_date_y ?? null,
      dataByDate: own.data_by_date || addDays(own.due_date, -3),
      dates: { 1: own.reminder_1_date ?? null, 2: own.reminder_2_date ?? null, 3: own.reminder_final_date ?? null },
      note: own.note ?? null,
    };
  }
  const std = standardFor(returnType, standard);
  if (!std) return null;
  const next = parsePeriod(shiftPeriod(period, 1))!;
  const on = (day: number | null | undefined) => (day ? isoDate(next.year, next.month, day) : null);
  const dueDate = on(std.due_day)!;
  return {
    period, returnType, source: 'standard',
    dueDate,
    dueDateY: on(std.due_day_y ?? null),
    dataByDate: addDays(dueDate, -3),
    dates: { 1: on(std.reminder_1_day), 2: on(std.reminder_2_day), 3: on(std.reminder_final_day) },
    note: null,
  };
}

/** The due date that applies to one client (GSTR-3B (Q) by state). */
export function dueDateFor(plan: ResolvedPlan, gstin: string | null | undefined): string {
  if (plan.dueDateY && !isTwentySecondState(gstin)) return plan.dueDateY;
  return plan.dueDate;
}

export type SkipReason = 'not_yet' | 'already_sent' | 'past_due' | 'sent_today' | 'no_dates';
/** `step` is set when `send` is true, `reason` when it is false. */
export interface StepDecision { send: boolean; step?: ReminderStep; reason?: SkipReason }

/**
 * Which reminder, if any, goes out today. `sent` maps each step already queued
 * or sent for this client, return and period (whatever its status, so a
 * cancelled reminder is not queued again) to the latest IST day it was
 * queued; `sentToday` is true when any reminder for them was queued today.
 * A reminder queued before a step's date does not stand for that step: when a
 * period's dates are set after early reminders went (October 2026: two went
 * on 24 Oct, the dates were then set for 14, 16 and 17 Nov), each date still
 * sends its own.
 */
export function stepDueToday(
  plan: ResolvedPlan,
  today: string,
  dueDate: string,
  sent: Map<number, string>,
  sentToday: boolean,
): StepDecision {
  if (today > dueDate) return { send: false, reason: 'past_due' };
  const reached = STEPS.filter((s) => plan.dates[s] && plan.dates[s]! <= today);
  if (!STEPS.some((s) => plan.dates[s])) return { send: false, reason: 'no_dates' };
  if (!reached.length) return { send: false, reason: 'not_yet' };
  const step = reached[reached.length - 1];
  const from = plan.dates[step]!;
  if ([...sent].some(([s, day]) => s >= step && day >= from)) return { send: false, reason: 'already_sent' };
  if (sentToday) return { send: false, reason: 'sent_today' };
  return { send: true, step };
}

/** Problems with a period plan, in plain words; empty when it can be saved. */
export function planProblems(row: Pick<PeriodPlanRow, 'period_month' | 'due_date' | 'due_date_y' | 'data_by_date' | 'reminder_1_date' | 'reminder_2_date' | 'reminder_final_date'>): string[] {
  const out: string[] = [];
  if (!parsePeriod(row.period_month)) return ['The period is not valid.'];
  if (!row.due_date) return ['Enter the due date.'];
  const start = periodStart(row.period_month);
  if (row.due_date < start) out.push('The due date is before the period starts.');
  if (row.due_date_y && row.due_date_y < row.due_date) out.push('The 24th-group due date is before the 22nd-group one.');
  const lastDue = row.due_date_y && row.due_date_y > row.due_date ? row.due_date_y : row.due_date;
  const dates: [string, string | null][] = [
    ['1st reminder', row.reminder_1_date], ['2nd reminder', row.reminder_2_date], ['Final reminder', row.reminder_final_date],
  ];
  let prev: [string, string] | null = null;
  for (const [label, d] of dates) {
    if (!d) continue;
    if (d < start) out.push(`The ${label.toLowerCase()} is before the period starts (${formatDate(start)}).`);
    if (d > lastDue) out.push(`The ${label.toLowerCase()} is after the due date.`);
    if (prev && d <= prev[1]) out.push(`The ${label.toLowerCase()} must come after the ${prev[0].toLowerCase()}.`);
    prev = [label, d];
  }
  if (!dates.some(([, d]) => d)) out.push('Set at least one reminder date.');
  if (row.data_by_date && row.data_by_date > lastDue) out.push('"Send data by" is after the due date.');
  return out;
}

/** Problems with a standard (every month) row. */
export function standardProblems(row: StandardScheduleRow): string[] {
  const out: string[] = [];
  const days: [string, number | null][] = [
    ['1st reminder', row.reminder_1_day], ['2nd reminder', row.reminder_2_day], ['Final reminder', row.reminder_final_day],
  ];
  const ok = (n: number | null | undefined) => n == null || (Number.isInteger(n) && n >= 1 && n <= 28);
  if (!ok(row.due_day) || !row.due_day) out.push('The due day must be between 1 and 28.');
  if (row.due_day_y != null && (!ok(row.due_day_y) || row.due_day_y < row.due_day)) out.push('The 24th-group due day must be on or after the due day.');
  let prev: [string, number] | null = null;
  for (const [label, d] of days) {
    if (d == null) continue;
    if (!ok(d)) out.push(`The ${label.toLowerCase()} day must be between 1 and 28.`);
    if (d > row.due_day) out.push(`The ${label.toLowerCase()} (day ${d}) is after the due day (${row.due_day}).`);
    if (prev && d <= prev[1]) out.push(`The ${label.toLowerCase()} must come after the ${prev[0].toLowerCase()}.`);
    prev = [label, d];
  }
  if (!days.some(([, d]) => d != null)) out.push('Set at least one reminder day.');
  return out;
}
