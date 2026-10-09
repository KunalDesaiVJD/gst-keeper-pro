// Sign-off of an Annual Return working, in three stages by three different
// people (signoffFlow.ts has the rules; the database enforces them):
//   allotted   — a GST manager or the superadmin allots a preparer, and
//                optionally a verifier and a reviewer (annual_return_allot);
//   Prepared   — the preparer marks it prepared (annual_return_signoff);
//   Verified   — a second person, the allotted verifier or a GST manager /
//                superadmin, verifies it in the working;
//   Reviewed & locked — a GST manager or the superadmin who neither prepared
//                nor verified it reviews it against this checklist and locks
//                the year (set_annual_return_status).
// The checklist and the reviewer's note are stored on the period at the lock
// and printed on the working papers' sign-off page (A3). ROLE_LABEL names the
// role a sign-off was made as.

export interface ChecklistItem {
  key: string;
  label: string;
  /** Checked by the app from the working, not ticked by hand. */
  auto?: boolean;
}

export const REVIEW_CHECKLIST: ChecklistItem[] = [
  { key: 'differences', label: 'Every difference is matched, within tolerance or explained with a reason', auto: true },
  { key: 'portal', label: 'Portal figures — GSTR-9 system-computed and the as-filed GSTR-3B — are fetched from the portal and agree with the returns filed' },
  { key: 'books', label: 'Books figures — P&L sales and purchases, Duties & Taxes, RCM — agree with the audited financial statements and trial balance' },
  { key: 'gstr9', label: 'GSTR-9 Tables 4 to 19 reviewed' },
  { key: 'gstr9c', label: 'GSTR-9C reconciliation (turnover, taxable turnover, rate-wise tax, ITC, expense heads) reviewed' },
  { key: 'payables', label: 'Payables, output-wise and input-wise, reviewed; how each will be set off (DRC-03 or GSTR-3B) is agreed with the client' },
  { key: 'positions', label: 'The firm positions applied (docs/GSTR9_9C_WORKINGS.md §6) are appropriate for this client' },
];

export const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  gst_manager: 'GST manager',
  employee: 'Staff',
  unlock_sheets: 'Staff (unlock permission)',
  client: 'Client',
};
