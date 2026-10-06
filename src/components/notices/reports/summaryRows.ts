// Rows for the Notice summary's breakdown (audit U-70-1): one per category,
// stage or financial year that has notices, biggest open first (stages in the
// order work moves, years newest first), or by any column.
import type { NoticeListParams } from '@/lib/noticeQueries';
import { stageIndex, stageLabel } from '@/lib/noticeStages';
import { fmtFy } from '@/lib/noticeFormat';
import { ageDays, type CountRow, type Counts } from './noticeCounts';

export type SummaryTab = 'category' | 'stage' | 'fy';
export type SummarySort = 'default' | 'name' | 'open' | 'overdue' | 'due7' | 'unassigned' | 'exposure' | 'oldest' | 'replied' | 'closed' | 'total';

export interface SummaryRow {
  key: string;
  label: string;
  /** The list filter for this row; null when the list cannot select it (no financial year). */
  param: Partial<NoticeListParams> | null;
  counts: Counts;
}

/** What a notice is grouped by on each tab. */
export const groupKey = (tab: SummaryTab) => (r: CountRow): string | null =>
  tab === 'category' ? r.category ?? 'Uncategorised' : tab === 'stage' ? r.stage ?? 'new' : r.financial_year;

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
    if (tab === 'fy') return key ? { key, label: `FY ${fmtFy(key)}`, param: { fy: key }, counts } : { key, label: 'Year not stated', param: null, counts };
    return { key, label: key || 'Uncategorised', param: { category: key || 'Uncategorised' }, counts };
  });
  const natural = (a: SummaryRow, b: SummaryRow) => {
    if (tab === 'stage') return stageIndex(a.key) - stageIndex(b.key);
    if (tab === 'fy') return (b.key || '0').localeCompare(a.key || '0');
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

