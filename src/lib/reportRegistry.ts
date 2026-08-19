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
 * One entry per report. `needs` mirrors the filter shapes the app has
 * pickers for: an all-clients snapshot for one month, one client plus the
 * selected month, one client with no period at all (e.g. the Notice/Refund/
 * DRC-03 reports — a notice isn't tied to one GST return period the way a
 * GSTR-1 figure is, so these read everything on record for the client), or
 * (for a master-data report scoped to no period AND no client, e.g. Client
 * Master) neither. The `client+month` shape covers two different meanings
 * depending on the report — "one client across the full financial year
 * containing this month" (the Ledger reports) or "one client for this exact
 * period" (the GSTR-1 family) — the build function alone decides which;
 * ReportRunArgs itself doesn't need to know.
 */
export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  category: ReportCategory;
  status: ReportStatus;
  icon: LucideIcon;
  needs: 'month' | 'client+month' | 'client' | 'none';
  build: (args: ReportRunArgs) => Promise<ReportTable>;
  /**
   * Reports fed by the browser extension's single-section pulls (as opposed
   * to the whole ledger/reco chain behind GST Receivable Reco's "Pull")
   * declare which extension job `mode` populates them, so the Reports Hub
   * can offer a "Pull" action right on the report itself instead of sending
   * staff to an unrelated page to fetch data for an unrelated report.
   * `needsMonth` is only true for the two Ledger reports (Liability/Cash)
   * that are period-scoped; everything else here is client-lifetime data.
   */
  pull?: { mode: string; needsMonth?: boolean };
}
