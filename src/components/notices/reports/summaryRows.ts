// Rows for the Notice summary's breakdown (audit U-70-1): one per category or
// stage that has notices, biggest open first (stages in the order work moves),
// or by any column. (Totals by financial year were taken out at the firm's
// request of 7 October 2026; the year is a filter.)
import type { NoticeListParams } from '@/lib/noticeQueries';
import { stageIndex, stageLabel } from '@/lib/noticeStages';
import { ageDays, type CountRow, type Counts } from './noticeCounts';

export type SummaryTab = 'category' | 'stage';
export type SummarySort = 'default' | 'name' | 'open' | 'overdue' | 'due7' | 'unassigned' | 'exposure' | 'oldest' | 'replied' | 'closed' | 'total';

export interface SummaryRow {
  key: string;
  label: string;
  /** The list filter for this row; null when the list cannot select it. */
  param: Partial<NoticeListParams> | null;
  counts: Counts;
}

/** What a notice is grouped by on each tab. */
export const groupKey = (tab: SummaryTab) => (r: CountRow): string | null =>
  tab === 'category' ? r.category ?? 'Uncategorised' : r.stage ?? 'new';

const value = (r: SummaryRow, k: SummarySort, today: string): number | null => {
  const c = r.counts;
  switch (k) {
    case 'open': return c.open;
    case 'overdue': return c.overdue;
    case 'due7': return c.due7;
    case 'unassigned': return c.unassigned;
    case 'exposure': return c.exposure;
    case 'oldest': return ageDays(c.oldestOpen, today);
    case 'replied': return c.replied;
    case 'closed': return c.closed;
    case 'total': return c.total;
    default: return null;
  }
};

export function summaryRows(tab: SummaryTab, groups: Map<string, Counts>, sort: SummarySort, dir: 'asc' | 'desc', today: string): SummaryRow[] {
  const rows: SummaryRow[] = [...groups.entries()].map(([key, counts]) => {
    if (tab === 'stage') return { key, label: stageLabel(key), param: { stage: key }, counts };
    return { key, label: key || 'Uncategorised', param: { category: key || 'Uncategorised' }, counts };
  });
  const natural = (a: SummaryRow, b: SummaryRow) => {
    if (tab === 'stage') return stageIndex(a.key) - stageIndex(b.key);
    return b.counts.open - a.counts.open || b.counts.exposure - a.counts.exposure || b.counts.total - a.counts.total || a.label.localeCompare(b.label);
  };
  const sign = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    if (sort === 'default') return natural(a, b);
    if (sort === 'name') return sign * a.label.localeCompare(b.label);
    const va = value(a, sort, today);
    const vb = value(b, sort, today);
    if (va === null && vb === null) return natural(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * (va - vb) || natural(a, b);
  });
}

