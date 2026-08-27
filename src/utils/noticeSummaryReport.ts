// Shared "Notice Summary" category-breakdown computation — was inline in
// NoticesDashboardPage.tsx only; extracted so the new dedicated Notice
// Summary report page (Report > Notice Summary, matching Notice Alert's own
// dropdown) can reuse the exact same categorization/ordering logic instead
// of duplicating it.
import { classifyNoticeCategory, UNCAPTURED_NOTICE_CATEGORIES, NOTICE_CATEGORY_DISPLAY_ORDER } from '@/utils/noticeCategoryClassifier';

export interface NoticeSummarySourceRow {
  notice_type: string | null;
  description: string | null;
  staff_status: string | null;
  reply_date: string | null;
}

export interface CategoryRow {
  type: string;
  total: number;
  open: number;
  closed: number;
  replied: number;
  // Refund/DRC-03 rows come from separate tables entirely (not gst_notices),
  // so clicking them can't reuse a local categoryFilter mechanism — they
  // link straight to their own firm-wide drill-down page instead.
  to?: string;
  // Zero-value row for a category this app has no portal capture for yet —
  // rendered plain/non-clickable, matching Notice Alert's own convention.
  placeholder?: boolean;
}

export const isClosed = (s: string | null) => (s || '').trim().toLowerCase() === 'closed';

// Refund status strings observed from the real portal pull (see
// noticeRefundDrc03Reports.ts) — "filed"/"deficiency memo" are still pending
// action, everything else (disbursed/withdrawn/recredit) is final.
export const isRefundClosed = (s: string | null) => /disburs|withdraw|reject|recredit/i.test(s || '');
// DRC-03 status strings observed: "Acknowledged" (final) vs "Pending for
// Action by Tax Officer" (still open).
export const isDrc03Closed = (s: string | null) => /acknowledg/i.test(s || '');

export interface NoticeSummaryResult {
  categoryRows: CategoryRow[];
  grandTotal: { total: number; open: number; closed: number; replied: number };
}

// Row order matches Notice Alert's own Notice Summary table exactly
// (confirmed live 2026-08-25): every canonical category gets its fixed slot
// whether we have real data for it or not (zero-value placeholder rows,
// matching Notice Alert's own dashes-not-links convention), then any
// category this app tracks but Notice Alert's fixed list doesn't cover
// (Registration/Non filers/Demand Notice/raw notice_type buckets) is
// appended after, by descending total.
export function computeNoticeSummary(
  filteredRows: NoticeSummarySourceRow[],
  refundStatuses: (string | null)[],
  drc03Statuses: (string | null)[],
): NoticeSummaryResult {
  const categoryMap = new Map<string, CategoryRow>();
  filteredRows.forEach((r) => {
    const type = classifyNoticeCategory(r);
    const entry = categoryMap.get(type) || { type, total: 0, open: 0, closed: 0, replied: 0 };
    entry.total += 1;
    if (isClosed(r.staff_status)) entry.closed += 1; else entry.open += 1;
    if (r.reply_date) entry.replied += 1;
    categoryMap.set(type, entry);
  });
  // Refund/DRC-03 aren't gst_notices rows — they're folded into the same
  // Notice Summary table Notice Alert shows them in, but as their own rows
  // with their own drill-down page (see AllClientsRefundsPage/Drc03Page)
  // since a local categoryFilter mechanism only works over gst_notices rows.
  if (refundStatuses.length > 0) {
    const closed = refundStatuses.filter((s) => isRefundClosed(s)).length;
    categoryMap.set('Refund', { type: 'Refund', total: refundStatuses.length, open: refundStatuses.length - closed, closed, replied: 0, to: '/refunds-all' });
  }
  if (drc03Statuses.length > 0) {
    const closed = drc03Statuses.filter((s) => isDrc03Closed(s)).length;
    categoryMap.set('DRC 03', { type: 'DRC 03', total: drc03Statuses.length, open: drc03Statuses.length - closed, closed, replied: 0, to: '/drc03-all' });
  }

  const FULL_DISPLAY_ORDER = [
    ...NOTICE_CATEGORY_DISPLAY_ORDER,
    ...UNCAPTURED_NOTICE_CATEGORIES.filter((t) => !NOTICE_CATEGORY_DISPLAY_ORDER.includes(t)),
  ];
  const canonicalRows: CategoryRow[] = FULL_DISPLAY_ORDER.map((type) => {
    const real = categoryMap.get(type);
    if (real) { categoryMap.delete(type); return real; }
    return { type, total: 0, open: 0, closed: 0, replied: 0, placeholder: true };
  });
  const extraRealRows = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
  const categoryRows = [...canonicalRows, ...extraRealRows];
  const grandTotal = categoryRows.reduce(
    (acc, r) => ({ total: acc.total + r.total, open: acc.open + r.open, closed: acc.closed + r.closed, replied: acc.replied + r.replied }),
    { total: 0, open: 0, closed: 0, replied: 0 },
  );
  return { categoryRows, grandTotal };
}
