// Step metadata and progress status for the Overview checklist and the
// Review list. The keys/labels mirror src/components/gstr9/steps/registry.ts;
// they are repeated here (not imported) because registry.ts imports the step
// components, and the Overview/Review steps importing it back would cycle.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gstr9PortalPresent, tin, type StepKey, type Workings } from '@/lib/gstr9/engine';
import type { AnnualReturnPeriod } from '@/lib/gstr9/store';
import { FY_MONTHS, type AnnualReturnDocs, type MonthKey, type Tax, type ValTax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';

export type Phase = 'Collect' | 'Reconcile' | 'Returns' | 'Finish';

export interface StepMeta {
  key: StepKey;
  /** Number shown in the step rail. */
  n: number;
  label: string;
  phase: Phase;
}

export const STEP_META: StepMeta[] = [
  { key: 'overview', n: 0, label: 'Overview', phase: 'Collect' },
  { key: 'portal', n: 1, label: 'Portal data', phase: 'Collect' },
  { key: 'sales', n: 2, label: 'Sales (P&L)', phase: 'Collect' },
  { key: 'purchases', n: 3, label: 'Purchases & ITC (P&L)', phase: 'Collect' },
  { key: 'duties', n: 4, label: 'Duties & Taxes', phase: 'Collect' },
  { key: 'rcm', n: 5, label: 'RCM', phase: 'Collect' },
  { key: 'outward', n: 6, label: 'Outward reco', phase: 'Reconcile' },
  { key: 'itc', n: 7, label: 'ITC reco', phase: 'Reconcile' },
  { key: 'expense', n: 8, label: '9C expense heads', phase: 'Reconcile' },
  { key: 'annexures', n: 9, label: 'Annexures', phase: 'Reconcile' },
  { key: 'gstr9', n: 10, label: 'GSTR-9', phase: 'Returns' },
  { key: 'gstr9c', n: 11, label: 'GSTR-9C', phase: 'Returns' },
  { key: 'notice', n: 12, label: 'Notice format', phase: 'Returns' },
  { key: 'review', n: 13, label: 'Review & lock', phase: 'Finish' },
  { key: 'payables', n: 14, label: 'Payables & set-off', phase: 'Finish' },
];

export const PHASES: Phase[] = ['Collect', 'Reconcile', 'Returns', 'Finish'];

/** The Review & lock step's tabs, kept in the URL as ?reviewtab=. */
export const REVIEW_TAB_PARAM = 'reviewtab';
export type ReviewTab = 'differences' | 'signoff' | 'history' | 'snapshots';

export const stepMeta = (key: string): StepMeta => STEP_META.find((s) => s.key === key) ?? STEP_META[0];

/** Navigate to another step, keeping the rest of the URL (the open client) as it is. */
export const useGoToStep = (): ((key: StepKey, extra?: Record<string, string>) => void) => {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (key: StepKey, extra?: Record<string, string>) => {
      const next = new URLSearchParams(params);
      next.set('step', key);
      Object.entries(extra ?? {}).forEach(([k, v]) => next.set(k, v));
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );
};

/**
 * The tab of its step that shows a difference line, as URL params — so a
 * link from the Overview or Review lands on the table the difference is in,
 * not on the step's first tab.
 */
export const diffTabParams = (d: { key: string; step: StepKey }): Record<string, string> => {
  const k = d.key;
  switch (d.step) {
    case 'sales': return k === 'sales.audit' ? { salestab: 'audit' } : {};
    case 'purchases': return k === 'purchases.dt' ? { purchasestab: 'summary' } : {};
    case 'duties': return { dutiestab: k.startsWith('dti.') ? 'input' : 'output' };
    case 'rcm': return { rcmtab: 'compare' };
    case 'outward': return { outwardtab: 'compare' };
    case 'itc': return { itctab: 'working' };
    case 'expense': return { expensetab: 'table14' };
    case 'annexures': {
      const m = /^ann([1-4])\./.exec(k);
      return m ? { ann: `a${m[1]}` } : {};
    }
    case 'gstr9':
      if (k === 'g9.8D') return { gstr9tab: '8' };
      if (k.startsWith('g9.t5.')) return { gstr9tab: '5' };
      if (k.startsWith('g9.t9.')) return { gstr9tab: '9' };
      return {};
    case 'gstr9c': {
      const m = /^gstr9c\.(\d+)/.exec(k);
      return m ? { gstr9ctab: m[1] } : {};
    }
    default:
      return {};
  }
};

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** "₹1,23,456.00" / "-₹9,899.99" (sign before the symbol). */
export const rupees = (n: number | null | undefined): string => {
  const v = n ?? 0;
  return v <= -0.005 ? `-₹${fmtMoney(-v)}` : `₹${fmtMoney(v)}`;
};

/** A tolerance / threshold in words: "₹10", "₹1,00,000", "₹0.5". */
export const rupeesShort = (n: number): string => `₹${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const EPS = 0.004;
export const nzT = (t: Tax | null | undefined): boolean => !!t && (Math.abs(t.i) > EPS || Math.abs(t.c) > EPS || Math.abs(t.s) > EPS || Math.abs(t.x) > EPS);
export const nzV = (v: ValTax | null | undefined): boolean => !!v && (Math.abs(v.t) > EPS || nzT(v));
export const sumTax = (t: Tax): number => t.i + t.c + t.s + t.x;

const HEAD_NAME: Record<keyof Tax, string> = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };

/** The head with the largest absolute difference, signed. */
export const worstHead = (t: Tax): { head: string; value: number } => {
  let best: keyof Tax = 'i';
  (['i', 'c', 's', 'x'] as const).forEach((h) => { if (Math.abs(t[h]) > Math.abs(t[best])) best = h; });
  return { head: HEAD_NAME[best], value: t[best] };
};

// ---------------------------------------------------------------------------
// Period status
// ---------------------------------------------------------------------------

export type BadgeTone = 'success' | 'warning' | 'destructive' | 'info' | 'secondary' | 'outline';

export const periodStatus = (period: AnnualReturnPeriod | null): { key: 'not_started' | 'in_progress' | 'locked'; label: string; tone: BadgeTone } => {
  if (period?.status === 'locked') return { key: 'locked', label: 'Locked', tone: 'success' };
  if (period?.status === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'warning' };
  return { key: 'not_started', label: 'Not started', tone: 'outline' };
};

// ---------------------------------------------------------------------------
// Portal presence (as-filed 3B months)
// ---------------------------------------------------------------------------

/** Months of the as-filed GSTR-3B the engine counts as present (either side). */
export const monthsApplied = (w: Workings): MonthKey[] => FY_MONTHS.filter((m) => w.monthsPresent[m]?.any);

// ---------------------------------------------------------------------------
// Step progress
// ---------------------------------------------------------------------------

export type StepState = 'todo' | 'progress' | 'done' | 'open' | 'nil' | 'ready' | 'locked';

export interface StepStatus {
  key: StepKey;
  state: StepState;
  label: string;
  tone: BadgeTone;
  /** One short line on what is (or isn't) there. */
  detail: string;
}

const STATE_LABEL: Record<Exclude<StepState, 'open'>, { label: string; tone: BadgeTone }> = {
  todo: { label: 'Not started', tone: 'outline' },
  progress: { label: 'In progress', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  nil: { label: 'Nil', tone: 'secondary' },
  ready: { label: 'Ready to lock', tone: 'info' },
  locked: { label: 'Locked', tone: 'success' },
};

const tri = (all: boolean, any: boolean): StepState => (all ? 'done' : any ? 'progress' : 'todo');

const SOURCE_LABEL: Record<string, string> = {
  extension: 'fetched from the portal',
  upload: 'uploaded',
  as_filed_3b: 'from the as-filed 3B',
  manual: 'typed',
};

export function stepStatuses(docs: AnnualReturnDocs, w: Workings, period: AnnualReturnPeriod | null): Record<StepKey, StepStatus> {
  const S = docs.sales;
  const PR = docs.purchases;
  const gstr9 = gstr9PortalPresent(docs);
  const applied = monthsApplied(w);
  const hasSales = S.partA.length > 0;
  const hasPurch = PR.rows.length > 0;

  const base: Partial<Record<StepKey, { state: StepState; detail: string }>> = {};

  // 1 Portal data
  const g9src = docs.portal.gstr9Meta?.source;
  base.portal = {
    state: tri(gstr9 && applied.length === 12, gstr9 || applied.length > 0),
    detail: `GSTR-9 ${gstr9 ? SOURCE_LABEL[g9src ?? ''] ?? 'entered' : 'not fetched'} · as-filed 3B ${applied.length}/12 months`,
  };

  // 2 Sales
  const audit = S.auditReportTotal !== null && S.auditReportTotal !== undefined;
  const salesMismatch = Object.values(w.sales.rows).filter((r) => r.rateMismatch).length;
  base.sales = {
    state: tri(hasSales && audit, hasSales || S.partB.length > 0 || audit),
    detail: `${S.partA.length} taxable · ${S.partB.length} non-taxable ledgers · audit-report total ${audit ? 'entered' : 'missing'}${salesMismatch ? ` · ${salesMismatch} rate check${salesMismatch === 1 ? '' : 's'}` : ''}`,
  };

  // 3 Purchases
  const bySection = { purchase: 0, expense: 0, capital_goods: 0 };
  PR.rows.forEach((r) => { bySection[r.section] = (bySection[r.section] ?? 0) + 1; });
  const purchMismatch = Object.values(w.purchases.rows).filter((r) => r.rateMismatch).length;
  base.purchases = {
    state: hasPurch ? 'done' : 'todo',
    detail: hasPurch
      ? `${PR.rows.length} ledgers (${bySection.purchase} purchase · ${bySection.expense} expense · ${bySection.capital_goods} capital goods)${purchMismatch ? ` · ${purchMismatch} rate check${purchMismatch === 1 ? '' : 's'}` : ''}`
      : 'No ledgers entered',
  };

  // 4 Duties & Taxes — every month the as-filed 3B has figures for should have books figures too.
  const DO = docs.duties_output.months;
  const DI = docs.duties_input.months;
  const outMonths = FY_MONTHS.filter((m) => nzT(tin(DO[m].sales)) || nzT(tin(DO[m].creditNote)));
  const inMonths = FY_MONTHS.filter((m) => {
    const x = DI[m];
    return [x.purchase, x.debitNote, x.suspRev, x.suspRev180, x.suspReclaim, x.suspReclaim180].some((t) => nzT(tin(t)));
  });
  // Expected: months whose 3B (present on that side, per the engine) has figures; all 12 while no 3B is in.
  const expected = (side: 'out' | 'itc', has3B: (m: MonthKey) => boolean): MonthKey[] =>
    FY_MONTHS.some((m) => w.monthsPresent[m]?.[side]) ? FY_MONTHS.filter((m) => w.monthsPresent[m]?.[side] && has3B(m)) : [...FY_MONTHS];
  const expOut = expected('out', (m) => nzT(w.dto.months[m].asPer3B));
  const expIn = expected('itc', (m) => nzT(w.dti.months[m].asPer3B));
  const dutiesAll = expOut.every((m) => outMonths.includes(m)) && expIn.every((m) => inMonths.includes(m));
  base.duties = {
    state: tri(dutiesAll && outMonths.length + inMonths.length > 0, outMonths.length + inMonths.length > 0),
    detail: `Output ${outMonths.length}/12 · input ${inMonths.length}/12 months${nzT(tin(docs.duties_input.lastYearEffect)) ? ' · last-year effect entered' : ''}`,
  };

  // 5 RCM
  const cats = docs.rcm.categories.length;
  const booksRcm = nzV(w.rcm.partB);
  const portalRcm = nzV(w.rcm.partA);
  let rcmState: StepState;
  let rcmDetail: string;
  if (cats === 0 && !portalRcm && applied.length > 0) {
    rcmState = 'nil';
    rcmDetail = 'No reverse charge in the as-filed 3B';
  } else if (cats === 0 && portalRcm) {
    rcmState = 'todo';
    rcmDetail = `Portal shows RCM on ${rupees(w.rcm.partA.t)} — enter the expense categories`;
  } else {
    rcmState = cats === 0 ? 'todo' : booksRcm ? 'done' : 'progress';
    rcmDetail = cats === 0 ? 'No categories entered' : `${cats} categor${cats === 1 ? 'y' : 'ies'} · books ${rupees(w.rcm.partB.t)} vs portal ${rupees(w.rcm.partA.t)}`;
  }
  base.rcm = { state: rcmState, detail: rcmDetail };

  // 6 Outward reco
  const t4 = w.g9.t4Source === 'portal';
  base.outward = {
    state: tri(hasSales && t4, hasSales || t4),
    detail: t4
      ? `Books ${rupees(w.outward.booksTotal.t)} vs GSTR-9 ${rupees(w.outward.portalTotal.t)} (taxable)`
      : 'Needs the GSTR-9 system-computed Table 4 (Portal data)',
  };

  // 7 ITC reco
  const t6A = w.g9.t6ASource !== 'none';
  base.itc = {
    state: tri(hasPurch && t6A, hasPurch || t6A),
    detail: t6A
      ? `6A ${w.g9.t6ASource === 'gstr9' ? 'from GSTR-9' : 'from the monthly 3B'} · 7J ${rupees(sumTax(w.g9.t7J))}`
      : 'Needs 6A (GSTR-9 or the as-filed 3B) from Portal data',
  };

  // 8 9C expense heads (computed from Purchases)
  base.expense = {
    state: hasPurch ? 'done' : 'todo',
    detail: hasPurch ? `Computed from Purchases · eligible ITC (R) ${rupees(sumTax(w.c14.rows.R ?? { i: 0, c: 0, s: 0, x: 0 }))}` : 'Computed once purchases are entered',
  };

  // 9 Annexures
  base.annexures = {
    state: tri(hasSales && hasPurch && gstr9, hasSales || hasPurch || gstr9),
    detail: `DRC-03 balance to pay ${rupees(sumTax(w.ann3.balance))}`,
  };

  // 10 GSTR-9
  base.gstr9 = {
    state: tri(hasSales && hasPurch && gstr9, hasSales || hasPurch || gstr9),
    detail: `4N tax ${rupees(sumTax(w.g9.t4.N))} · 7J ${rupees(sumTax(w.g9.t7J))}`,
  };

  // 11 GSTR-9C
  const signer = docs.gstr9c.certification.signatory_name?.trim();
  base.gstr9c = {
    state: tri(hasSales && hasPurch && gstr9 && !!signer, hasSales || hasPurch || gstr9),
    detail: `Certification ${signer ? `by ${signer}` : 'not filled'} · 5R ${rupees(w.gstr9c.t5.R)}`,
  };

  // 12 Notice format
  base.notice = {
    state: tri(gstr9 && applied.length > 0, gstr9 || applied.length > 0),
    detail: `Net tax payable ${rupees(sumTax(w.notice.outward.r11))} · net excess ITC used ${rupees(sumTax(w.notice.inward.r9))}`,
  };

  // 13 Review & lock
  const anyData = hasSales || hasPurch || gstr9 || applied.length > 0 || cats > 0 || outMonths.length > 0 || inMonths.length > 0;
  if (period?.status === 'locked') {
    base.review = { state: 'locked', detail: `Locked${period.locked_by ? ` by ${period.locked_by}` : ''}${period.locked_at ? ` on ${fmtWhen(period.locked_at)}` : ''}` };
  } else {
    base.review = {
      state: w.openCount > 0 ? 'open' : anyData ? 'ready' : 'todo',
      detail: w.openCount > 0 ? `${w.openCount} difference${w.openCount === 1 ? '' : 's'} still need a reason` : anyData ? 'Every difference is matched, within tolerance or justified' : 'Nothing entered yet',
    };
  }

  // 14 Payables & set-off
  const P = w.payables.totals;
  if (sumTax(P.payable) < 0.5) {
    base.payables = { state: anyData ? 'done' : 'todo', detail: anyData ? 'Nothing payable' : '' };
  } else {
    const bal = sumTax(P.balance);
    base.payables = {
      state: bal < 0.5 ? 'done' : 'progress',
      detail: bal < 0.5 ? `${rupees(sumTax(P.payable))} payable — fully set off` : `${rupees(bal)} of ${rupees(sumTax(P.payable))} still to set off`,
    };
  }

  base.overview = { state: 'done', detail: '' };

  const out = {} as Record<StepKey, StepStatus>;
  STEP_META.forEach(({ key }) => {
    const b = base[key] ?? { state: 'todo' as StepState, detail: '' };
    const open = key === 'overview' ? 0 : w.stepOpen[key] ?? 0;
    if (open > 0 && b.state !== 'locked') {
      out[key] = { key, state: 'open', label: `${open} open`, tone: 'destructive', detail: b.detail };
    } else {
      const s = STATE_LABEL[b.state === 'open' ? 'progress' : b.state];
      out[key] = { key, state: b.state, label: s.label, tone: s.tone, detail: b.detail };
    }
  });
  return out;
}
