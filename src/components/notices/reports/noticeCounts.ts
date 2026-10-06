// Counts for the Notice summary and the GSTIN-wise report (audit U-70-2,
// U-72-1, L-12; cross-cutting "numbers disagree between sibling screens").
// Each count uses the All notices list's own predicate over public.notice_facts
// (lib/noticeQueries applyListFilters: open = is_open, overdue = is_overdue,
// due7 = is_due_in_7, unassigned = is_unassigned, replied = is_replied,
// closed = NOT is_open, exposure = open with exposure_amount > 0), and the
// report's filters are applied by that same function, so a number opens
// noticesListHref with the same filter and the list shows the same count.
import { fetchAllRows } from '@/lib/fetchAllRows';
import { applyListFilters, type NoticeListParams } from '@/lib/noticeQueries';
import { daysBetween } from '@/lib/noticeFacts';

export interface CountRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_gstin: string | null;
  category: string | null;
  stage: string | null;
  financial_year: string | null;
  is_open: boolean | null;
  is_overdue: boolean | null;
  is_due_in_7: boolean | null;
  is_unassigned: boolean | null;
  is_replied: boolean | null;
  exposure_amount: number | null;
  effective_due: string | null;
  days_to_due: number | null;
  issue_date: string | null;
}

const COLUMNS = 'id, client_id, client_name, client_gstin, category, stage, financial_year, is_open, is_overdue, is_due_in_7, '
  + 'is_unassigned, is_replied, exposure_amount, effective_due, days_to_due, issue_date';

/** The report's filters (owner, FY, category, priority, client) as the list understands them. */
export type BaseFilters = Pick<NoticeListParams, 'owner' | 'fy' | 'category' | 'priority' | 'client' | 'stage'>;

export async function loadCountRows(base: BaseFilters, meId: string | null): Promise<CountRow[]> {
  return fetchAllRows<CountRow>('notice_facts', COLUMNS,
    (q) => applyListFilters(q, { filter: 'all', page: 1, ...base }, meId).order('id'));
}

export interface Counts {
  total: number;
  open: number;
  overdue: number;
  due7: number;
  unassigned: number;
  replied: number;
  closed: number;
  /** Sum of exposure_amount over open notices, and how many carry one (the 'exposure' list). */
  exposure: number;
  exposureCount: number;
  /** Issue date of the oldest open notice. */
  oldestOpen: string | null;
  /** The next reply date still ahead (open, not replied, due today or later), and how many open notices fall on it. */
  nextDue: string | null;
  nextDueCount: number;
}

export const emptyCounts = (): Counts => ({
  total: 0, open: 0, overdue: 0, due7: 0, unassigned: 0, replied: 0, closed: 0,
  exposure: 0, exposureCount: 0, oldestOpen: null, nextDue: null, nextDueCount: 0,
});

function add(c: Counts, r: CountRow) {
  c.total += 1;
  if (r.is_open) {
    c.open += 1;
    if (r.issue_date && (!c.oldestOpen || r.issue_date < c.oldestOpen)) c.oldestOpen = r.issue_date;
    const amt = Number(r.exposure_amount) || 0;
    if (amt > 0) { c.exposure += amt; c.exposureCount += 1; }
  } else c.closed += 1;
  if (r.is_overdue) c.overdue += 1;
  if (r.is_due_in_7) c.due7 += 1;
  if (r.is_unassigned) c.unassigned += 1;
  if (r.is_replied) c.replied += 1;
}

/** Counts per group (category, stage, FY, client …) plus the total over every row. */
export function groupCounts(rows: CountRow[], key: (r: CountRow) => string | null): { groups: Map<string, Counts>; total: Counts } {
  const groups = new Map<string, Counts>();
  const total = emptyCounts();
  const byGroup = new Map<string, CountRow[]>();
  rows.forEach((r) => {
    add(total, r);
    const k = key(r) ?? '';
    const c = groups.get(k) ?? emptyCounts();
    add(c, r);
    groups.set(k, c);
    const list = byGroup.get(k);
    if (list) list.push(r); else byGroup.set(k, [r]);
  });
  // Next reply date per group: the first one still ahead, counted the way the list's
  // "open + due on that day" filter counts it.
  byGroup.forEach((list, k) => {
    const c = groups.get(k) as Counts;
    const ahead = list.filter((r) => r.is_open && !r.is_replied && r.effective_due && (r.days_to_due ?? -1) >= 0)
      .map((r) => r.effective_due as string).sort();
    if (!ahead.length) return;
    c.nextDue = ahead[0];
    c.nextDueCount = list.filter((r) => r.is_open && r.effective_due === c.nextDue).length;
  });
  return { groups, total };
}

/** Whole days since the oldest open notice was issued. */
export const ageDays = (iso: string | null, today: string): number | null => (iso ? daysBetween(iso, today) : null);
