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
  scrutiny: 'GSTR-9 Scrutiny Reports',
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

export const REPORT_STATUS_META: Record<ReportStatus, { label: string; badgeVariant: BadgeProps['variant'] }> = {
  ready: { label: 'Ready', badgeVariant: 'success' },
  'ready-approx': { label: 'Ready (approx.)', badgeVariant: 'success' },
  'extends-login': { label: 'Extends portal login', badgeVariant: 'info' },
  'new-login': { label: 'New portal login', badgeVariant: 'warning' },
  'ai-assisted': { label: 'AI-assisted', badgeVariant: 'secondary' },
};

export interface ReportRunArgs {
  month: string;
  clientId?: string;
}

/**
 * One entry per report. `needs` mirrors the two filter shapes the app
 * already has pickers for: an all-clients snapshot for one month, or one
 * client across the full financial year of the selected month. Reports
 * that need a single client for a single specific period (most of the
 * Phase 1 additions) are a third shape to add once the first one of those
 * lands — not introduced speculatively ahead of an actual report needing it.
 */
export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  category: ReportCategory;
  status: ReportStatus;
  icon: LucideIcon;
  needs: 'month' | 'client+month';
  build: (args: ReportRunArgs) => Promise<ReportTable>;
}
