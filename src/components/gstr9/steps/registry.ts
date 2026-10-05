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
import PayablesStep from './PayablesStep';

export interface StepDef {
  key: StepKey;
  /** Label for the step heading. */
  label: string;
  /** Short label for the step bar. */
  short: string;
  /** One line under the title. */
  intro: string;
  /** The Excel sheet(s) this step reproduces. */
  excel: string;
  phase: 'Collect' | 'Reconcile' | 'Returns' | 'Finish';
  component: React.FC;
}

export const STEPS: StepDef[] = [
  { key: 'overview', short: 'Overview', label: 'Overview', phase: 'Collect', excel: 'MASTER', component: OverviewStep,
    intro: 'Where this client’s annual return stands — what is entered, what is fetched, and what still needs a reason.' },
  { key: 'portal', short: 'Portal', label: 'Portal data', phase: 'Collect', excel: 'AS PER 3B · AS PER GST PORTAL · AUTO POPULATE FROM 9', component: PortalStep,
    intro: 'Fetch the GSTR-9 system-computed figures and the as-filed GSTR-3B straight from the portal. Never the app’s own GSTR-1/3B.' },
  { key: 'sales', short: 'Sales', label: 'Sales (P&L)', phase: 'Collect', excel: 'PL-OUTPUT', component: SalesStep,
    intro: 'Income ledgers from the P&L: taxable (Part A) and non-taxable (Part B), matched to the audit report.' },
  { key: 'purchases', short: 'Purchases', label: 'Purchases & ITC (P&L)', phase: 'Collect', excel: 'PL-INPUT', component: PurchasesStep,
    intro: 'Purchase, expense and capital-goods ledgers with ITC, tagged to the GSTR-9C expense heads.' },
  { key: 'duties', short: 'Duties & Taxes', label: 'Duties & Taxes', phase: 'Collect', excel: 'DUTIES & TAXES-OUTPUT / -INPUT', component: DutiesStep,
    intro: 'Month-wise GST ledgers from the books, against the as-filed GSTR-3B, month by month.' },
  { key: 'rcm', short: 'RCM', label: 'RCM', phase: 'Collect', excel: 'RCM', component: RcmStep,
    intro: 'Reverse-charge expenses by month (books) against 3.1(d) of the as-filed GSTR-3B (portal).' },
  { key: 'outward', short: 'Outward reco', label: 'Outward reco', phase: 'Reconcile', excel: 'GSTR 9-OUTPUT', component: OutwardRecoStep,
    intro: 'Books against the GSTR-9 auto-populated Table 4, category by category.' },
  { key: 'itc', short: 'ITC reco', label: 'ITC reco', phase: 'Reconcile', excel: 'GSTR 9-INPUT · GSTR-9 Table 7/12/13', component: ItcRecoStep,
    intro: 'The ITC working for GSTR-9 Tables 6 and 7, next-year ITC (Tables 12/13), and 8C.' },
  { key: 'expense', short: '9C heads', label: '9C expense heads', phase: 'Reconcile', excel: 'GSTR 9C', component: ExpenseHeadStep,
    intro: 'ITC by expense head for GSTR-9C Table 14, computed from the P&L ledgers.' },
  { key: 'annexures', short: 'Annexures', label: 'Annexures', phase: 'Reconcile', excel: 'ANNEXURE 1–4', component: AnnexuresStep,
    intro: 'Income reco, ITC reco, DRC-03 working and the previous year’s GSTR-9 clauses.' },
  { key: 'gstr9', short: 'GSTR-9', label: 'GSTR-9', phase: 'Returns', excel: 'GSTR-9', component: Gstr9FormStep,
    intro: 'The form, Tables 4–19, assembled from the steps above. Only the remaining manual cells are typed here.' },
  { key: 'gstr9c', short: 'GSTR-9C', label: 'GSTR-9C', phase: 'Returns', excel: 'GSTR-9C (official tables)', component: Gstr9cStep,
    intro: 'Reconciliation statement: turnover, taxable turnover, rate-wise tax, ITC and expense heads.' },
  { key: 'notice', short: 'Notice', label: 'Notice format', phase: 'Returns', excel: 'NOTICE FORMATE', component: NoticeStep,
    intro: 'Outward and inward summary in the format officers ask for.' },
  { key: 'review', short: 'Review', label: 'Review & lock', phase: 'Finish', excel: '—', component: ReviewStep,
    intro: 'Every difference in one list, the revision history, and sign-off: staff mark it ready, a GST manager or superadmin verifies and locks.' },
  { key: 'payables', short: 'Payables', label: 'Payables & set-off', phase: 'Finish', excel: 'ANNEXURE-3 · DRC-03', component: PayablesStep,
    intro: 'What is left payable, output-wise and input-wise, and how each part is set off — only by a DRC-03 in the system or a GSTR-3B effect with its copy.' },
];

export const stepByKey = (key: string | null | undefined): StepDef => STEPS.find((s) => s.key === key) ?? STEPS[0];
