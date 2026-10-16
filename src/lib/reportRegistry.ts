import type { LucideIcon } from 'lucide-react';
import type { BadgeProps } from '@/components/ui/badge';
import type { ReportTable } from '@/utils/allClientsReports';

/**
 * The categories from the reports roadmap. Kept as a flat union (not derived
 * from report data) so the category rail can render a fixed, predictable
 * order even before any reports in a category exist yet.
 */
export type ReportCategory =
  | 'extra'
  | 'gstr1'
  | 'gstr3b'
  | 'gstr2a2b'
  | 'ledgers'
  | 'tax-liability'
  | 'pan'
  | 'refund'
  | 'drc03'
  | 'notice'
  | 'scrutiny'
  | 'interest'
  | 'eway'
  | 'einvoice';

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  extra: 'Extra Reports',
  gstr1: 'GSTR-1 Reports',
  gstr3b: 'GSTR-3B Reports',
  gstr2a2b: 'GSTR-2A/2B Reports',
  ledgers: 'Ledgers',
  'tax-liability': 'Tax Liability & ITC',
  pan: 'PAN-Based Reports',
  refund: 'Refund Reports',
  drc03: 'DRC-03 Reports',
  notice: 'Notice & Order Reports',
  scrutiny: 'Scrutiny Reports',
  interest: 'Interest Reports',
  eway: 'E-Way Bill Reports',
  einvoice: 'E-Invoice Reports',
};

/** Display order for the category rail — matches the roadmap's build sequence, not alphabetical. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  'gstr1', 'gstr3b', 'gstr2a2b', 'ledgers', 'tax-liability', 'extra',
  'pan', 'refund', 'drc03', 'notice', 'scrutiny', 'interest', 'eway', 'einvoice',
];

/**
 * A report's build status, matching the roadmap doc's status chips exactly —
 * this is what tells staff whether a report is instant or depends on a
 * portal pull that hasn't run yet.
 */
export type ReportStatus = 'ready' | 'ready-approx' | 'extends-login' | 'new-login' | 'ai-assisted';

/**
 * `label` is the full-length text (used in the grid/detail contexts);
 * `shortLabel` is a tight 1-2 word form for dense list rows, with `label`
 * available as its tooltip.
 */
export const REPORT_STATUS_META: Record<ReportStatus, { label: string; shortLabel: string; badgeVariant: BadgeProps['variant'] }> = {
  ready: { label: 'Ready', shortLabel: 'Ready', badgeVariant: 'success' },
  'ready-approx': { label: 'Ready (approx.)', shortLabel: 'Approx.', badgeVariant: 'success' },
  'extends-login': { label: 'Extends portal login — needs a browser-extension pull first', shortLabel: 'Needs Pull', badgeVariant: 'info' },
  'new-login': { label: 'Needs a new portal login (separate credentials)', shortLabel: 'New Login', badgeVariant: 'warning' },
  'ai-assisted': { label: 'AI-assisted analysis', shortLabel: 'AI-Assisted', badgeVariant: 'secondary' },
};

export interface ReportRunArgs {
  month: string;
  clientId?: string;
}

/**
 * Which bespoke view component (src/components/reports/views/*) renders this
 * report's preview body — chosen per report by its actual data shape, not a
 * one-size-fits-all grid:
 *  - ledger-register: transactional ledgers with Debit/Credit + running Balance
 *  - filed-return-summary: one client+period's as-filed return, section by section
 *  - variance-comparison: two (or more) sources side by side with a delta column
 *  - document-line-items: rate/supplier/HSN-wise document-level breakdowns
 *  - evidence-event-list: chronological portal events each with its own PDF
 *  - notice-workflow-list: View Notice and Orders specifically — the same
 *    event-list shape, plus staff-editable case-tracking (status/priority/
 *    reply/order/submission) writing back to the underlying row
 *  - profile-card: reference-data reports that read like a profile, not a grid
 *  - all-clients-snapshot: one row per client roster reports
 *  - annual-trend: one client's figure across all twelve months of an FY
 *  - exceptions-list: pre-filtered "only the flagged clients" reports
 *  - working-paper: a step-by-step legal computation read top to bottom
 *  - reason-reconciliation: two sources matched document by document, every
 *    difference with its reason, under a summary by reason (2A vs 2B; later 8A)
 */
export type ReportViewKind =
  | 'ledger-register'
  | 'filed-return-summary'
  | 'variance-comparison'
  | 'document-line-items'
  | 'evidence-event-list'
  | 'notice-workflow-list'
  | 'profile-card'
  | 'all-clients-snapshot'
  | 'annual-trend'
  | 'exceptions-list'
  | 'working-paper'
  | 'reason-reconciliation';

/**
 * One extension job a report's Pull starts: a `mode`, the periods it walks and,
 * for a combined mode, what to fetch per period (e.g. { '07/2026': ['2A', '2B'],
 * '08/2026': ['2B'] } for gstr2a2b_pull, extension 0.13.0+).
 */
export interface PullJob { mode: string; periods: string[]; want?: Record<string, string[]> }
/** What a report's Pull fetches: jobs[0] starts now; the rest on the next click (the extension runs one job at a time). */
export interface PullPlan { jobs: PullJob[]; note?: string }

/**
 * One entry per report. `needs` mirrors the filter shapes the app has
 * pickers for: an all-clients snapshot for one month, one client plus the
 * selected month, one client with no period at all (e.g. the Notice/Refund/
 * DRC-03 reports — a notice isn't tied to one GST return period the way a
 * GSTR-1 figure is, so these read everything on record for the client), or
 * (for a master-data report scoped to no period AND no client, e.g. Client
 * Master) neither. The `client+month` shape covers two different meanings
 * depending on the report — "one client across the full financial year
 * containing this month" (the Ledger reports) or "one client for this exact
 * period" (the GSTR-1 family) — `periodScope` says which, so several
 * months picked are not the same year built once per month.
 */
export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  category: ReportCategory;
  status: ReportStatus;
  icon: LucideIcon;
  needs: 'month' | 'client+month' | 'client' | 'none';
  /** Which bespoke view component renders this report's preview body — see ReportViewKind. */
  viewKind: ReportViewKind;
  /**
   * What one build covers. 'month' (the default): the month it is given, so
   * several months picked are built one by one and merged. 'fy': the whole
   * financial year of whichever month it is given (the one client across the
   * year reports, the portal ledgers and statements), so building it once per
   * month picked would print the same year, with its own FY TOTAL, once per
   * month. buildForPeriods builds such a report once per financial year among
   * the months picked instead (reportPeriodMerge.ts).
   */
  periodScope?: 'month' | 'fy';
  build: (args: ReportRunArgs) => Promise<ReportTable>;
  /**
   * Reports fed by the browser extension's single-section pulls (as opposed
   * to the whole ledger/reco chain behind GST Receivable Reco's "Pull")
   * declare which extension job `mode` populates them, so the Reports Hub
   * can offer a "Pull" action right on the report itself instead of sending
   * staff to an unrelated page to fetch data for an unrelated report.
   * `needsMonth` is only true for the two Ledger reports (Liability/Cash)
   * that are period-scoped; everything else here is client-lifetime data.
   * `plan`, when set, decides what to fetch from what is already stored (only
   * what is missing), and may pick a mode by the extension's version.
   */
  pull?: {
    mode: string;
    needsMonth?: boolean;
    plan?: (args: { clientId: string; periods: string[]; extVersion: string | null }) => Promise<PullPlan>;
  };
}
