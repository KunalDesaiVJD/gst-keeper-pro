// Notice Alert partitions every "Notices & Orders" row into one mutually-
// exclusive legal category by description text, not by the portal's own raw
// notice_type (Order vs Notice — just a technical form type). Confirmed live
// against noticealert.microvistatech.com on 2026-08-25 by clicking through:
// "Registration" (355 records) and "Non filers" (373) and "Demand Notice"
// (20) are all pulled from the exact same get/notices API we already save
// into gst_notices — Notice Alert just re-buckets that same data by
// description. Shared between NoticesDashboardPage (builds the Notice
// Summary table) and AllClientsNoticesPage (the drill-down list each row
// links to) so both classify a row the same way.
interface ClassifiableNotice {
  notice_type: string | null;
  description: string | null;
}

export const isRegistrationRelated = (description: string | null) => /registration/i.test(description || '');
export const isNonFilerRelated = (description: string | null) => /return defaulter|not filing return/i.test(description || '');
export const isDemandNoticeRelated = (description: string | null) =>
  /ITC mismatch|liability mismatch|DRC-01B|DRC-01C/i.test(description || '');

export const classifyNoticeCategory = (r: ClassifiableNotice): string => {
  if (isRegistrationRelated(r.description)) return 'Registration';
  if (isNonFilerRelated(r.description)) return 'Non filers';
  if (isDemandNoticeRelated(r.description)) return 'Demand Notice';
  return r.notice_type || 'Uncategorised';
};

// Notice Alert categories confirmed to come from a portal source ("Additional
// Notices" case/task endpoints) this app has never pulled — shown as zero-
// value, non-clickable placeholder rows in the Notice Summary table so the
// row list matches Notice Alert's fixed taxonomy without fabricating pages
// for data we don't have. Scoped out per the user's 2026-08-25 decision;
// each needs its own reverse-engineering pass against the live GST portal.
export const UNCAPTURED_NOTICE_CATEGORIES = [
  'Appeal', 'ASMT 10', 'Audit', 'DRC 01', 'Enforcement', 'Order Rectification',
  'Others', 'Penalty', 'Recovery', 'Ewaybill', 'AAR', 'TRAN 1', 'Anti evasion', 'Other',
];

// Fixed display order matching Notice Alert's own Notice Summary row order
// (confirmed live 2026-08-25). Categories not listed here (e.g. this app's
// own Registration/Non filers/Demand Notice/Notice/Order buckets) sort after
// these, by descending total — same as before this ordering existed.
export const NOTICE_CATEGORY_DISPLAY_ORDER = [
  'Appeal', 'ASMT 10', 'Audit', 'DRC 01', 'DRC 03', 'Enforcement', 'LUT',
  'Order Rectification', 'Others', 'Penalty', 'Recovery', 'Refund', 'TDRC 03',
  'Ewaybill', 'AAR',
];
