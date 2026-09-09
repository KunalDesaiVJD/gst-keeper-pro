// Data gathering for the advance working papers.
//
// Kept separate from the renderers (advanceReportsPdf.ts) for the same reason
// the builder module splits builderReportData from builderReportsPdf: a report
// that fetches while it draws can't be checked without a database, and the
// figures are the part worth checking.

import { supabase } from '@/integrations/supabase/client';
import {
  fetchAdvanceLedger, parseKey, describeKey, periodOrdinal, keyOf,
  type AdvanceLedger, type TaxAmount,
} from './advanceBalance';
import {
  fetchRegister, receiptPositions, registerClosingByKey, reconcileRegister,
  receiptKey,
  type AdvanceReceipt, type ReceiptPosition, type RegisterReconcileRow,
} from './advanceRegister';
import { fetchProjects, fetchRaBills, recoverySchedule, projectWorkingPaper } from './contractProjects';
import type { AdvanceOverride } from './advanceSetoffOverrides';

export interface AdvanceReportContext {
  clientId: string;
  clientName: string;
  clientGstin: string;
  periodMonth: string;
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ─── R1 / R4 — the ledger, and the as-filed vs as-amended bridge ────────────

export interface LedgerReport {
  ledger: AdvanceLedger;
  /** Keys still carrying an open balance, with their age in months. */
  openKeys: { key: string; label: string; amount: TaxAmount; since: string; ageMonths: number }[];
}

export async function buildLedgerReport(ctx: AdvanceReportContext): Promise<LedgerReport> {
  const ledger = await fetchAdvanceLedger({
    clientId: ctx.clientId, gstin: ctx.clientGstin, upto: ctx.periodMonth,
  });
  const openKeys = Array.from(ledger.closingByKey.entries()).map(([key, amount]) => {
    const since = ledger.openSinceByKey.get(key) || ctx.periodMonth;
    return {
      key,
      label: describeKey(parseKey(key)),
      amount,
      since,
      ageMonths: Math.max(0, periodOrdinal(ctx.periodMonth) - periodOrdinal(since)),
    };
  }).sort((a, b) => b.ageMonths - a.ageMonths || b.amount.taxable - a.amount.taxable);
  return { ledger, openKeys };
}

/** The four buckets the ageing statement reports in. */
export const AGE_BUCKETS = ['0-3 months', '3-6 months', '6-12 months', 'Over 12 months'] as const;
export type AgeBucket = typeof AGE_BUCKETS[number];

export const bucketFor = (ageMonths: number): AgeBucket =>
  ageMonths < 3 ? '0-3 months'
    : ageMonths < 6 ? '3-6 months'
      : ageMonths < 12 ? '6-12 months'
        : 'Over 12 months';

// ─── R3 — the set-off register ──────────────────────────────────────────────

export interface RegisterReport {
  positions: ReceiptPosition[];
  reconciliation: RegisterReconcileRow[];
  totals: { received: number; adjusted: number; open: number };
}

export async function buildRegisterReport(
  ctx: AdvanceReportContext,
  ledger: AdvanceLedger,
): Promise<RegisterReport> {
  const reg = await fetchRegister(ctx.clientId);
  const positions = receiptPositions(reg.receipts, reg.adjustments);
  const reconciliation = reg.receipts.length
    ? reconcileRegister(
      registerClosingByKey(reg.receipts, reg.adjustments, ctx.periodMonth),
      ledger.closingByKey,
    )
    : [];
  return {
    positions,
    reconciliation,
    totals: {
      // GOODS receipts carry no Table 11A value, so they contribute nothing to
      // the received total even though they appear on the register.
      received: r2(positions.reduce((t, p) => t + (p.receipt.supply_nature === 'GOODS' ? 0 : Number(p.receipt.taxable_value) || 0), 0)),
      adjusted: r2(positions.reduce((t, p) => t + p.adjusted, 0)),
      open: r2(positions.reduce((t, p) => t + p.open, 0)),
    },
  };
}

// ─── R5 — the firm-wide control sheet ───────────────────────────────────────

export interface ControlSheetRow {
  clientName: string;
  clientGstin: string;
  managedBy: 'Advance Register' | 'Builder module';
  open: number;
  oldest: string | null;
  ageMonths: number;
  bucket: AgeBucket | '—';
  adjustedThisMonth: number;
}

export async function buildControlSheet(periodMonth: string): Promise<ControlSheetRow[]> {
  const { data } = await supabase
    .from('clients').select('id, name, gstin, regular_sub_type').order('name');
  const clients = (data as { id: string; name: string; gstin: string; regular_sub_type: string | null }[]) || [];

  const rows: ControlSheetRow[] = [];
  // Sequential: each client's ledger reads that client's whole GSTR-1 history,
  // and firing a hundred of those at once gets rate-limited rather than fast.
  for (const c of clients) {
    if (!c.gstin) continue;
    const ledger = await fetchAdvanceLedger({ clientId: c.id, gstin: c.gstin, upto: periodMonth });
    if (ledger.closingTotal.taxable <= 1) continue;
    const ageMonths = ledger.oldestOpenPeriod
      ? Math.max(0, periodOrdinal(periodMonth) - periodOrdinal(ledger.oldestOpenPeriod))
      : 0;
    const thisMonth = ledger.months.find((m) => m.period === periodMonth);
    rows.push({
      clientName: c.name,
      clientGstin: c.gstin,
      managedBy: c.regular_sub_type === 'Builder' ? 'Builder module' : 'Advance Register',
      open: r2(ledger.closingTotal.taxable),
      oldest: ledger.oldestOpenPeriod,
      ageMonths,
      bucket: ledger.oldestOpenPeriod ? bucketFor(ageMonths) : '—',
      adjustedThisMonth: r2(thisMonth?.effective.adjusted.taxable || 0),
    });
  }
  return rows.sort((a, b) => b.open - a.open);
}

// ─── R6 — the exception & override certificate ──────────────────────────────

export async function fetchOverridesForCertificate(
  clientId: string,
  periodMonth: string,
): Promise<AdvanceOverride[]> {
  const { data, error } = await supabase
    .from('advance_setoff_overrides' as never)
    .select('*')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .order('requested_at', { ascending: true });
  if (error) return [];
  return (data as unknown as AdvanceOverride[]) || [];
}

// ─── R7 — the project working paper ─────────────────────────────────────────

export async function buildProjectReport(clientId: string, projectId: string, homeState: string) {
  const [projects, bills, reg] = await Promise.all([
    fetchProjects(clientId), fetchRaBills(projectId), fetchRegister(clientId),
  ]);
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    project,
    bills,
    schedule: recoverySchedule({ project, bills, receipts: reg.receipts, adjustments: reg.adjustments }),
    workingPaper: projectWorkingPaper({
      project, bills, receipts: reg.receipts, adjustments: reg.adjustments, homeState,
    }),
    receipts: reg.receipts.filter((r) => r.project_id === projectId) as AdvanceReceipt[],
  };
}

export { keyOf, receiptKey };
