import React from 'react';
import type { StepKey } from '@/lib/gstr9/engine';
import OverviewStep from './OverviewStep';
import PortalStep from './PortalStep';
import SalesStep from './SalesStep';
import PurchasesStep from './PurchasesStep';
import DutiesStep from './DutiesStep';
import RcmStep from './RcmStep';
import OutwardRecoStep from './OutwardRecoStep';
import ItcRecoStep from './ItcRecoStep';
import ExpenseHeadStep from './ExpenseHeadStep';
import AnnexuresStep from './AnnexuresStep';
import Gstr9FormStep from './Gstr9FormStep';
import Gstr9cStep from './Gstr9cStep';
import NoticeStep from './NoticeStep';
import ReviewStep from './ReviewStep';

export interface StepDef {
  key: StepKey;
  /** Short label for the step rail. */
  label: string;
  /** One line under the title. */
  intro: string;
  /** The Excel sheet(s) this step reproduces. */
  excel: string;
  phase: 'Collect' | 'Reconcile' | 'Returns' | 'Finish';
  component: React.FC;
}

export const STEPS: StepDef[] = [
  { key: 'overview', label: 'Overview', phase: 'Collect', excel: 'MASTER', component: OverviewStep,
    intro: 'Where this client’s annual return stands — what is entered, what is fetched, and what still needs a reason.' },
  { key: 'portal', label: 'Portal data', phase: 'Collect', excel: 'AS PER 3B · AS PER GST PORTAL · AUTO POPULATE FROM 9', component: PortalStep,
    intro: 'Fetch the GSTR-9 system-computed figures and the as-filed GSTR-3B straight from the portal. Never the app’s own GSTR-1/3B.' },
  { key: 'sales', label: 'Sales (P&L)', phase: 'Collect', excel: 'PL-OUTPUT', component: SalesStep,
    intro: 'Income ledgers from the P&L: taxable (Part A) and non-taxable (Part B), matched to the audit report.' },
  { key: 'purchases', label: 'Purchases & ITC (P&L)', phase: 'Collect', excel: 'PL-INPUT', component: PurchasesStep,
    intro: 'Purchase, expense and capital-goods ledgers with ITC, tagged to the GSTR-9C expense heads.' },
  { key: 'duties', label: 'Duties & Taxes', phase: 'Collect', excel: 'DUTIES & TAXES-OUTPUT / -INPUT', component: DutiesStep,
    intro: 'Month-wise GST ledgers from the books, against the as-filed GSTR-3B, month by month.' },
  { key: 'rcm', label: 'RCM', phase: 'Collect', excel: 'RCM', component: RcmStep,
    intro: 'Reverse-charge expenses by month (books) against 3.1(d) of the as-filed GSTR-3B (portal).' },
  { key: 'outward', label: 'Outward reco', phase: 'Reconcile', excel: 'GSTR 9-OUTPUT', component: OutwardRecoStep,
    intro: 'Books against the GSTR-9 auto-populated Table 4, category by category.' },
  { key: 'itc', label: 'ITC reco', phase: 'Reconcile', excel: 'GSTR 9-INPUT · GSTR-9 Table 7/12/13', component: ItcRecoStep,
    intro: 'The ITC working for GSTR-9 Tables 6 and 7, next-year ITC (Tables 12/13), and 8C.' },
  { key: 'expense', label: '9C expense heads', phase: 'Reconcile', excel: 'GSTR 9C', component: ExpenseHeadStep,
    intro: 'ITC by expense head for GSTR-9C Table 14, computed from the P&L ledgers.' },
  { key: 'annexures', label: 'Annexures', phase: 'Reconcile', excel: 'ANNEXURE 1–4', component: AnnexuresStep,
    intro: 'Income reco, ITC reco, DRC-03 working and the previous year’s GSTR-9 clauses.' },
  { key: 'gstr9', label: 'GSTR-9', phase: 'Returns', excel: 'GSTR-9', component: Gstr9FormStep,
    intro: 'The form, Tables 4–18, assembled from the steps above. Only the remaining manual cells are typed here.' },
  { key: 'gstr9c', label: 'GSTR-9C', phase: 'Returns', excel: 'GSTR-9C (official tables)', component: Gstr9cStep,
    intro: 'Reconciliation statement: turnover, taxable turnover, rate-wise tax, ITC and expense heads.' },
  { key: 'notice', label: 'Notice format', phase: 'Returns', excel: 'NOTICE FORMATE', component: NoticeStep,
    intro: 'Outward and inward summary in the format officers ask for.' },
  { key: 'review', label: 'Review & lock', phase: 'Finish', excel: '—', component: ReviewStep,
    intro: 'Every difference in one list. Lock the year once each one is matched or has a reason.' },
];

export const stepByKey = (key: string | null | undefined): StepDef => STEPS.find((s) => s.key === key) ?? STEPS[0];
