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
  // Needed to dedupe the "Refunds"/"Voluntary Payment" case-summary rows
  // against gst_refund_applications/gst_drc03_filings by ARN — see
  // computeNoticeSummary below.
  case_id?: string | null;
}

export interface RefundSummarySourceRow {
  arn: string | null;
  status: string | null;
}

export interface Drc03SummarySourceRow {
  arn: string | null;
  status: string | null;
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
// The Additional Notices case-folder sync writes its own case-summary row
// per case into gst_notices, using these two literal notice_type values for
// refund and DRC-03 (voluntary payment) cases. A minority of those same
// cases are ALSO captured by the dedicated Refund/DRC-03 tab sync into
// gst_refund_applications/gst_drc03_filings (confirmed live 2026-08-29: 9 of
// 49 "Refunds" rows and 11 of 146 "Voluntary Payment" rows share an ARN with
// an existing dedicated-table row) — counting both would double-count those
// cases. So these two notice_types are excluded from the normal per-row
// loop below and folded into the Refund/DRC 03 rows via ARN dedup instead.
const CASE_REFUND_TYPE = 'Refunds';
const CASE_DRC03_TYPE = 'Voluntary Payment';

export function computeNoticeSummary(
  filteredRows: NoticeSummarySourceRow[],
  refundRows: RefundSummarySourceRow[],
  drc03Rows: Drc03SummarySourceRow[],
): NoticeSummaryResult {
  const categoryMap = new Map<string, CategoryRow>();
  filteredRows.forEach((r) => {
    if (r.notice_type === CASE_REFUND_TYPE || r.notice_type === CASE_DRC03_TYPE) return;
    const type = classifyNoticeCategory(r);
    const entry = categoryMap.get(type) || { type, total: 0, open: 0, closed: 0, replied: 0 };
    entry.total += 1;
    if (isClosed(r.staff_status)) entry.closed += 1; else entry.open += 1;
    if (r.reply_date) entry.replied += 1;
    categoryMap.set(type, entry);
  });

  // Refund/DRC-03 aren't gst_notices rows for this purpose — they're folded
  // into the same Notice Summary table Notice Alert shows them in, but as
  // their own rows with their own drill-down page (see
  // AllClientsRefundsPage/Drc03Page), deduped against the case-summary rows
  // above by ARN (dedicated table's arn === case row's case_id, both being
  // the portal's own ARN for that case).
  const mergeIntoCategory = (
    label: string,
    dedicated: { arn: string | null; status: string | null }[],
    caseType: string,
    isDedicatedClosed: (s: string | null) => boolean,
    to: string,
  ) => {
    const caseRows = filteredRows.filter((r) => r.notice_type === caseType);
    const keys = new Set<string>();
    dedicated.forEach((d) => { if (d.arn) keys.add(d.arn); });
    caseRows.forEach((r) => { if (r.case_id) keys.add(r.case_id); });
    if (keys.size === 0) return;
    let closed = 0;
    keys.forEach((key) => {
      const d = dedicated.find((x) => x.arn === key);
      if (d) { if (isDedicatedClosed(d.status)) closed += 1; return; }
      const cr = caseRows.find((x) => x.case_id === key);
      if (cr && isClosed(cr.staff_status)) closed += 1;
    });
    categoryMap.set(label, { type: label, total: keys.size, open: keys.size - closed, closed, replied: 0, to });
  };
  mergeIntoCategory('Refund', refundRows, CASE_REFUND_TYPE, isRefundClosed, '/refunds-all');
  mergeIntoCategory('DRC 03', drc03Rows, CASE_DRC03_TYPE, isDrc03Closed, '/drc03-all');

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

export type SummaryCellKind = 'total' | 'open' | 'closed' | 'replied';

// Shared by NoticesDashboardPage and NoticeSummaryReportPage so every number
// in the table — not just the row/Total — is its own hyperlink to the
// correspondingly filtered list, per Notice Alert's own behaviour (each of
// Total/Open/Closed/Replied opens a differently-filtered dashboard).
// Returns null for a placeholder row, a zero cell (nothing to show), or the
// Replied column on a Refund/DRC-03 row (those have no reply concept).
export function summaryCellHref(r: CategoryRow, kind: SummaryCellKind): string | null {
  if (r.placeholder) return null;
  const value = kind === 'total' ? r.total : kind === 'open' ? r.open : kind === 'closed' ? r.closed : r.replied;
  if (!value) return null;
  if (kind === 'total') return r.to || `/notices-all?category=${encodeURIComponent(r.type)}`;
  if (kind === 'replied') {
    if (r.to) return null;
    return `/notices-all?category=${encodeURIComponent(r.type)}&filter=replied`;
  }
  const status = kind === 'open' ? 'Open' : 'Closed';
  return r.to ? `${r.to}?status=${status}` : `/notices-all?category=${encodeURIComponent(r.type)}&status=${status}`;
}
